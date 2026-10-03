// Radioadmin-API von laut.fm (https://api.radioadmin.laut.fm) direkt vom Handy: Bearer-Token der gemeinsamen
// laut.fm-Sitzung, Origin passend zum Token. Bei 401/403 wird einmal der Origin neu ermittelt und wiederholt.
package app.anmachacast.studio.radioadmin

import app.anmachacast.studio.live.LautFmClient
import app.anmachacast.studio.live.LautFmSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.source
import java.io.IOException
import java.util.concurrent.TimeUnit

class RaException(val status: Int, message: String) : IOException(message)

/** Kleine Hilfen zum Lesen von JSON ohne starre Modelle (die API liefert je nach Version leicht abweichende Felder). */
fun JsonElement?.obj(): JsonObject? = this as? JsonObject
fun JsonElement?.arr(): JsonArray? = this as? JsonArray
fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
fun JsonElement?.lng(): Long? = (this as? JsonPrimitive)?.let { it.longOrNull ?: it.doubleOrNull?.toLong() }
fun JsonElement?.dbl(): Double? = (this as? JsonPrimitive)?.doubleOrNull
fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.booleanOrNull
fun JsonObject.s(k: String): String = this[k].str() ?: ""
fun JsonObject.l(k: String): Long = this[k].lng() ?: 0L

class RaClient(private val session: LautFmSession) {
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()

    private val json = Json { ignoreUnknownKeys = true }

    val stationId: Long get() = session.account?.stationId ?: 0

    /** Pfad unterhalb der gewählten Station, z. B. st("/playlists") */
    fun st(path: String = ""): String {
        val id = stationId
        if (id <= 0) throw RaException(409, "Bitte zuerst eine Station wählen")
        return "/stations/$id$path"
    }

    suspend fun get(path: String): JsonElement? = call("GET", path, null)
    suspend fun post(path: String, body: JsonElement? = null): JsonElement? = call("POST", path, body)
    suspend fun patch(path: String, body: JsonElement?): JsonElement? = call("PATCH", path, body)
    suspend fun delete(path: String, body: JsonElement? = null): JsonElement? = call("DELETE", path, body)

    private suspend fun call(method: String, path: String, body: JsonElement?, multipart: MultipartBody? = null): JsonElement? {
        var acc = session.account ?: throw RaException(401, "Nicht bei laut.fm angemeldet")
        var retried = false
        while (true) {
            val (code, text) = withContext(Dispatchers.IO) { exec(acc.token, acc.origin, method, path, body, multipart) }
            if (code == 401 || code == 403) {
                if (!retried) {
                    retried = true
                    acc = session.reauthorize() ?: throw RaException(401, "laut.fm-Anmeldung abgelaufen – bitte neu verbinden")
                    continue
                }
                throw RaException(code, "laut.fm hat den Zugriff abgelehnt${errorText(text)}")
            }
            if (code !in 200..299) throw RaException(code, "laut.fm antwortete mit $code${errorText(text)}")
            if (text.isBlank()) return null
            return runCatching { json.parseToJsonElement(text) }.getOrElse { JsonPrimitive(text.trim().trim('"')) }
        }
    }

    private fun errorText(text: String): String {
        val m = runCatching { json.parseToJsonElement(text) }.getOrNull() ?: return ""
        val o = m.obj() ?: return ""
        val found = (o["messages"] ?: o["_errors"] ?: o["_errors:"] ?: o["error"] ?: o["message"])
        val t = when (found) {
            is JsonObject -> found.entries.joinToString("; ") { (k, v) -> "$k: ${v.str() ?: v}" }
            is JsonArray -> found.joinToString("; ") { it.str() ?: it.toString() }
            else -> found.str() ?: ""
        }
        return if (t.isBlank()) "" else " ($t)"
    }

    private fun exec(token: String, origin: String, method: String, path: String, body: JsonElement?, multipart: MultipartBody?): Pair<Int, String> {
        val rb: RequestBody? = when {
            multipart != null -> multipart
            body != null -> json.encodeToString(JsonElement.serializer(), body).toRequestBody("application/json".toMediaType())
            method == "POST" || method == "PUT" || method == "PATCH" -> ByteArray(0).toRequestBody()
            else -> null
        }
        val req = Request.Builder().url(LautFmClient.RADIOADMIN + path)
            .header("Authorization", "Bearer $token").header("Origin", origin)
            .header("Accept", "application/json").header("User-Agent", "AnMaCha Cast")
            .method(method, if (method == "GET" || method == "HEAD") null else rb ?: ByteArray(0).toRequestBody())
            .build()
        http.newCall(req).execute().use { return it.code to (it.body?.string() ?: "") }
    }

    /**
     * Datei hochladen (multipart), ohne sie komplett in den Speicher zu laden: der Inhalt wird beim Senden aus `open()` gelesen.
     * @param part Name des Formularfelds, z. B. "track" oder "image"
     */
    suspend fun upload(method: String, path: String, part: String, fileName: String, mime: String, length: Long, open: () -> java.io.InputStream, fields: Map<String, String> = emptyMap()): JsonElement? {
        val body = object : RequestBody() {
            override fun contentType() = mime.toMediaType()
            override fun contentLength() = length
            override fun writeTo(sink: okio.BufferedSink) {
                open().use { sink.writeAll(it.source()) }
            }
        }
        val mb = MultipartBody.Builder().setType(MultipartBody.FORM)
        fields.forEach { (k, v) -> mb.addFormDataPart(k, v) }
        mb.addFormDataPart(part, fileName, body)
        return call(method, path, null, mb.build())
    }

    /** Rohdaten holen, z. B. Vorhören eines Titels. */
    suspend fun bytes(path: String): ByteArray {
        val acc = session.account ?: throw RaException(401, "Nicht bei laut.fm angemeldet")
        return withContext(Dispatchers.IO) {
            val req = Request.Builder().url(LautFmClient.RADIOADMIN + path)
                .header("Authorization", "Bearer ${acc.token}").header("Origin", acc.origin).header("User-Agent", "AnMaCha Cast").build()
            http.newCall(req).execute().use {
                if (!it.isSuccessful) throw RaException(it.code, "Vorhören nicht möglich (${it.code})")
                it.body!!.bytes()
            }
        }
    }

    /** Öffentliche laut.fm-API (ohne Anmeldung): aktueller Titel, letzte Titel, Hörer. */
    suspend fun public(path: String): JsonElement? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("https://api.laut.fm$path").header("Accept", "application/json").build()
            http.newCall(req).execute().use { r -> if (r.isSuccessful) json.parseToJsonElement(r.body?.string() ?: "") else null }
        }.getOrNull()
    }
}
