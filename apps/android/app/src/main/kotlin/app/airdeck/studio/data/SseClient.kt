// Realtime-Ereignisse vom Server (GET /api/v1/events, Server-Sent Events) - dieselbe Quelle, die auch
// das Web-Studio nutzt (EventSource). Hier über OkHttp gelesen, weil das Auth per Header statt per
// Query-Token im Klartext in der URL erlaubt (OkHttp kann im Gegensatz zum Browser-EventSource Header setzen).
package app.airdeck.studio.data

import android.util.Log
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.util.concurrent.TimeUnit

data class ServerEvent(val type: String, val data: String, val stationId: String? = null)

private const val TAG = "AnMaChaCastSSE"

/** Verbindet sich dauerhaft (mit Neuverbindung bei Abbruch) und liefert jedes Ereignis einzeln. */
fun sseEvents(serverUrl: String, token: String?, stationId: String? = null): Flow<ServerEvent> = flow {
    val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // Streaming: nie wegen Inaktivität trennen
        .build()
    var backoffMs = 1000L
    while (true) {
        try {
            val urlBuilder = StringBuilder("${serverUrl.trimEnd('/')}/api/v1/events")
            if (stationId != null) urlBuilder.append("?station=").append(stationId)
            val reqBuilder = Request.Builder().url(urlBuilder.toString()).get()
            token?.let { reqBuilder.header("Authorization", "Bearer $it") }
            client.newCall(reqBuilder.build()).execute().use { resp ->
                if (!resp.isSuccessful) throw IllegalStateException("SSE HTTP ${resp.code}")
                backoffMs = 1000L
                val reader: BufferedReader = resp.body!!.charStream().buffered()
                var eventType: String? = null
                val dataLines = StringBuilder()
                while (true) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("event:") -> eventType = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> {
                            if (dataLines.isNotEmpty()) dataLines.append('\n')
                            dataLines.append(line.removePrefix("data:").trim())
                        }
                        line.isBlank() -> {
                            if (eventType != null) emit(ServerEvent(eventType, dataLines.toString(), stationId))
                            eventType = null
                            dataLines.setLength(0)
                        }
                        // "retry:"/": ping" Zeilen bewusst ignoriert
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Verbindung verloren, erneuter Versuch in ${backoffMs}ms: ${e.message}")
        }
        delay(backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(30_000)
    }
}
