// laut.fm Radioadmin: Anmeldung per Login-Seite (Token kommt im Adress-Anker zurück), Stationsliste und
// Live-Zugangsdaten. Derselbe Ablauf wie im Studio (src/server/services/lautfm.ts); der Token bleibt auf dem Handy.
package app.anmachacast.studio.live

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class LautStation(val id: Long, val name: String, val displayName: String, val role: String)

data class LautLive(
    val server: String,
    val port: Int,
    val tls: Boolean,
    val mount: String,
    val user: String,
    val password: String,
    val bitrate: Int,
)

class LautFmException(message: String, val unauthorized: Boolean = false) : IOException(message)

class LautFmClient(private val http: OkHttpClient = defaultHttp()) {
    companion object {
        const val RADIOADMIN = "https://api.radioadmin.laut.fm"

        /** Wohin laut.fm nach dem Login zurückleitet; die App fängt die Adresse in der WebView ab. */
        const val CALLBACK = "https://anmachacast.app/laut-fm"
        private val json = Json { ignoreUnknownKeys = true }

        fun defaultHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

        fun loginUrl(): String = "https://radioadmin.laut.fm/login?callback_url=" + URLEncoder.encode(CALLBACK, "UTF-8")

        /**
         * Token aus der Rückleit-Adresse (…#lautfm_radioadmin_token=… oder ?lautfm_radioadmin_token=…).
         * Bewusst tolerant: egal wie laut.fm die Adresse zusammensetzt, solange der Parameter drinsteht
         * und es nicht die Login-Seite selbst ist.
         */
        fun tokenFromRedirect(url: String): String? {
            if (!url.contains(TOKEN_PARAM)) return null
            val host = runCatching { java.net.URI(url).host }.getOrNull() ?: ""
            if (host.endsWith("laut.fm") && !url.startsWith("https://anmachacast.app")) return null
            val raw = url.substringAfter(TOKEN_PARAM).substringBefore('&').substringBefore('#')
            return runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrNull()?.let(::cleanToken)?.takeIf { TOKEN_RE.matches(it) }
        }

        /** Token aus dem sichtbaren Text einer laut.fm-Seite (Skript-Token-Anzeige), sonst null. */
        fun tokenFromPageText(text: String): String? =
            UUID_RE.find(text.lowercase())?.value

        private const val TOKEN_PARAM = "lautfm_radioadmin_token="
        private val TOKEN_RE = Regex("[A-Za-z0-9._~+/=-]{16,400}")
        private val UUID_RE = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

        /** „Bearer “, Anführungszeichen und Leerraum aus eingefügten Tokens entfernen. */
        fun cleanToken(v: String): String =
            v.trim().replace(Regex("^bearer\\s+", RegexOption.IGNORE_CASE), "").trim('"', '\'', ' ', '\n').trim()

        fun parseStations(body: String): List<LautStation>? {
            val el = runCatching { json.parseToJsonElement(body) }.getOrNull() ?: return null
            val list: JsonArray = when (el) {
                is JsonArray -> el
                is JsonObject -> (el["stations"] as? JsonArray) ?: return null
                else -> return null
            }
            return list.mapNotNull { s ->
                val o = (s as? JsonObject) ?: return@mapNotNull null
                val id = o.long("id") ?: return@mapNotNull null
                if (id <= 0) return@mapNotNull null
                val name = o.str("name").lowercase()
                LautStation(id, name, o.str("display_name").ifBlank { name }, o.str("role").ifBlank { "dj" }.lowercase())
            }
        }

        private fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull?.trim() ?: ""
        private fun JsonObject.long(k: String) = (this[k] as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }
        private fun JsonObject.int(k: String) = (this[k] as? JsonPrimitive)?.let { it.intOrNull ?: it.contentOrNull?.toIntOrNull() }
    }

    private fun call(path: String, token: String, origin: String): Pair<Int, String> {
        val req = Request.Builder().url(RADIOADMIN + path)
            .header("Authorization", "Bearer $token").header("Origin", origin)
            .header("Accept", "application/json").header("User-Agent", "AnMaCha Cast").build()
        http.newCall(req).execute().use { return it.code to (it.body?.string() ?: "") }
    }

    /**
     * Stationen laden. Der Origin-Header muss zur callback_url des Tokens passen: erst die Rückleit-Adresse,
     * dann deren Origin, dann der Studio-Standard. Frisch ausgestellte Tokens brauchen manchmal einen zweiten Versuch.
     */
    suspend fun verify(token: String, extraOrigin: String? = null): Pair<String, List<LautStation>> = withContext(Dispatchers.IO) {
        val candidates = listOfNotNull(extraOrigin?.takeIf { it.isNotBlank() }, CALLBACK, "https://anmachacast.app", "airdeck").distinct()
        var reached = false
        var unauthorized = false
        val tried = ArrayList<String>()
        for ((i, origin) in candidates.withIndex()) {
            repeat(if (i == 0) 3 else 1) { attempt ->
                try {
                    val (code, body) = call("/stations", token, origin)
                    reached = true
                    if (code == 200) parseStations(body)?.let { return@withContext origin to it }
                    if (code == 401) unauthorized = true
                    if (attempt == 0) tried += "$code"
                } catch (_: IOException) {
                }
                if (i == 0 && attempt < 2) delay(400)
            }
        }
        throw LautFmException(
            if (!reached) "laut.fm ist nicht erreichbar" else "laut.fm hat das Token nicht akzeptiert (Antworten: ${tried.joinToString(", ")}). Bitte neu anmelden.",
            unauthorized,
        )
    }

    /** Live-Zugangsdaten der Station (Server, Port, Mountpoint, Benutzer, Passwort). */
    suspend fun live(account: LautFmAccount, stationId: Long): LautLive = withContext(Dispatchers.IO) {
        val (code, body) = try {
            call("/stations/$stationId/live", account.token, account.origin)
        } catch (e: IOException) {
            throw LautFmException("laut.fm ist nicht erreichbar")
        }
        if (code == 401 || code == 403) throw LautFmException("Keine Berechtigung für diese Station – bitte neu anmelden", true)
        if (code != 200) throw LautFmException("laut.fm antwortete mit $code")
        val o = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: throw LautFmException("Unerwartete Antwort von laut.fm")
        var password = o.str("password")
        if (password.isBlank()) {
            val (pc, pb) = call("/stations/$stationId/live/password", account.token, account.origin)
            if (pc == 200) password = pb.trim().trim('"')
        }
        val server = o.str("server")
        val mount = o.str("mountpoint")
        if (server.isBlank() || mount.isBlank() || password.isBlank()) throw LautFmException("laut.fm lieferte keine vollständigen Zugangsdaten")
        val tls = o.str("protocol") == "https"
        LautLive(server, o.int("port") ?: if (tls) 443 else 80, tls, mount, o.str("user").ifBlank { "source" }, password, o.int("bitrate") ?: 128)
    }
}
