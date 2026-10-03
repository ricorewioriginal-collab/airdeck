// Nextcloud als Musikpool: Anmeldung per Login Flow v2 (kein Passwort in der App, nur ein App-Passwort),
// Ordner lesen per WebDAV (PROPFIND) und Titel in den Zwischenspeicher laden.
package app.anmachacast.studio.live

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Credentials
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.w3c.dom.Element
import java.io.File
import java.io.IOException
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import javax.xml.parsers.DocumentBuilderFactory

data class NcEntry(val name: String, val path: String, val isDir: Boolean, val size: Long)
data class NcLoginStart(val loginUrl: String, val pollEndpoint: String, val pollToken: String)

class NextcloudException(message: String) : IOException(message)

class NextcloudClient(private val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()) {

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        val AUDIO_EXT = setOf("mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav")

        fun normalizeServer(input: String): String {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) throw NextcloudException("Bitte die Nextcloud-Adresse eintragen")
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            return s.removeSuffix("/index.php/login/v2").removeSuffix("/index.php")
        }

        fun isAudio(name: String) = name.substringAfterLast('.', "").lowercase() in AUDIO_EXT

        /** Pfad-Segmente einzeln kodieren (Leerzeichen, Umlaute) - Schrägstriche bleiben. */
        fun encodePath(path: String) = path.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }

        /** Antwort eines PROPFIND (Depth 1) in Einträge umwandeln; der Ordner selbst wird ausgelassen. */
        fun parseListing(xml: String, davRoot: String, folder: String): List<NcEntry> {
            val f = DocumentBuilderFactory.newInstance()
            f.isNamespaceAware = true
            runCatching { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
            val doc = f.newDocumentBuilder().parse(xml.byteInputStream())
            val responses = doc.getElementsByTagNameNS("DAV:", "response")
            val out = ArrayList<NcEntry>()
            val self = folder.trim('/')
            for (i in 0 until responses.length) {
                val r = responses.item(i) as Element
                val href = r.getElementsByTagNameNS("DAV:", "href").item(0)?.textContent ?: continue
                val full = URLDecoder.decode(href.replace("+", "%2B"), "UTF-8")
                val rel = full.substringAfter(davRoot, full).trim('/')
                if (rel == self) continue
                val isDir = r.getElementsByTagNameNS("DAV:", "collection").length > 0
                val size = r.getElementsByTagNameNS("DAV:", "getcontentlength").item(0)?.textContent?.toLongOrNull() ?: 0
                out += NcEntry(rel.substringAfterLast('/'), rel, isDir, size)
            }
            return out.sortedWith(compareBy({ !it.isDir }, { it.name.lowercase() }))
        }
    }

    suspend fun startLogin(server: String): NcLoginStart = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val req = Request.Builder().url("$base/index.php/login/v2").header("User-Agent", "AnMaCha Cast")
            .post(ByteArray(0).toRequestBody()).build()
        try {
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) throw NextcloudException("Das ist keine erreichbare Nextcloud (${r.code})")
                val o = json.parseToJsonElement(r.body?.string() ?: "").jsonObject
                val poll = o["poll"]!!.jsonObject
                NcLoginStart(o["login"]!!.jsonPrimitive.content, poll["endpoint"]!!.jsonPrimitive.content, poll["token"]!!.jsonPrimitive.content)
            }
        } catch (e: NextcloudException) {
            throw e
        } catch (e: Exception) {
            throw NextcloudException("Nextcloud nicht erreichbar oder zu alt (Login Flow v2 nötig)")
        }
    }

    /** Wartet, bis die Anmeldung im Browser bestätigt wurde; null = noch nicht. */
    suspend fun pollLogin(start: NcLoginStart): NextcloudAccount? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(start.pollEndpoint).header("User-Agent", "AnMaCha Cast")
            .post(FormBody.Builder().add("token", start.pollToken).build()).build()
        try {
            http.newCall(req).execute().use { r ->
                if (r.code == 404) return@withContext null
                if (!r.isSuccessful) return@withContext null
                val o = json.parseToJsonElement(r.body?.string() ?: "").jsonObject
                NextcloudAccount(o["server"]!!.jsonPrimitive.content.trimEnd('/'), o["loginName"]!!.jsonPrimitive.content, o["appPassword"]!!.jsonPrimitive.content)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun davRoot(a: NextcloudAccount) = "/remote.php/dav/files/${encodePath(a.user)}"
    private fun davUrl(a: NextcloudAccount, path: String) = a.server + davRoot(a) + "/" + encodePath(path.trim('/'))

    suspend fun list(a: NextcloudAccount, folder: String): List<NcEntry> = withContext(Dispatchers.IO) {
        val body = """<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"""
        val req = Request.Builder().url(davUrl(a, folder).trimEnd('/') + "/")
            .header("Authorization", Credentials.basic(a.user, a.appPassword)).header("Depth", "1")
            .method("PROPFIND", body.toRequestBody("application/xml".toMediaType())).build()
        try {
            http.newCall(req).execute().use { r ->
                if (r.code == 401) throw NextcloudException("Nextcloud-Zugang abgelaufen – bitte neu verbinden")
                if (r.code != 207) throw NextcloudException("Ordner nicht lesbar (${r.code})")
                parseListing(r.body?.string() ?: "", URLDecoder.decode(davRoot(a), "UTF-8"), folder)
            }
        } catch (e: NextcloudException) {
            throw e
        } catch (e: Exception) {
            throw NextcloudException("Nextcloud nicht erreichbar")
        }
    }

    /** Titel in den Zwischenspeicher laden (nur Audio); gibt die lokale Datei zurück. */
    suspend fun download(context: Context, a: NextcloudAccount, entry: NcEntry): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "nextcloud").apply { mkdirs() }
        val target = File(dir, "${entry.path.hashCode().toUInt()}-${entry.name.replace(Regex("[^A-Za-z0-9._-]"), "_")}")
        if (target.exists() && target.length() == entry.size) return@withContext target
        val req = Request.Builder().url(davUrl(a, entry.path)).header("Authorization", Credentials.basic(a.user, a.appPassword)).build()
        try {
            http.newCall(req).execute().use { r ->
                if (!r.isSuccessful) throw NextcloudException("Download fehlgeschlagen (${r.code})")
                val tmp = File(dir, target.name + ".part")
                r.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
                if (!tmp.renameTo(target)) throw NextcloudException("Datei nicht speicherbar")
            }
        } catch (e: NextcloudException) {
            throw e
        } catch (e: Exception) {
            throw NextcloudException("Download fehlgeschlagen: ${entry.name}")
        }
        target
    }

    /** Alte Downloads entfernen (Playlist liegt nur im Speicher, nach App-Start sind sie verwaist). */
    fun clearCache(context: Context) {
        File(context.cacheDir, "nextcloud").deleteRecursively()
    }
}
