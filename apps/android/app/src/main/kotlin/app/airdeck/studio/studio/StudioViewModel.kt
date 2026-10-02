// STUDIO/REMOTE-Modus: Fernsteuerung eines laufenden AnMaCha-Cast-Servers über dieselbe REST+SSE-API
// wie das Web-Studio (keine eigene Android-API). Aktualisiert sich per Server-Sent-Events statt Polling.
package app.airdeck.studio.studio

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.airdeck.studio.AnMaChaCastApp
import app.airdeck.studio.data.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ConnectionPhase { CONNECTED, RECONNECTING, DISCONNECTED }

data class StudioUiState(
    val stationId: String? = null,
    val station: StationDto? = null,
    val nowPlaying: NowPlayingDto? = null,
    val queue: List<QueueItemDto> = emptyList(),
    val sources: List<SourceDto> = emptyList(),
    val playout: PlayoutStatusDto? = null,
    val connectionPhase: ConnectionPhase = ConnectionPhase.DISCONNECTED,
    val loading: Boolean = true,
    val error: String? = null,
    val busySourceId: String? = null,
)

class StudioViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = (application as AnMaChaCastApp).connectionRepository
    private val _ui = MutableStateFlow(StudioUiState())
    val ui: StateFlow<StudioUiState> = _ui.asStateFlow()
    private var sseJob: Job? = null

    init {
        val connection = repo.connection.value
        val stationId = connection?.stationIds?.firstOrNull()
        if (stationId == null) {
            _ui.value = _ui.value.copy(loading = false, error = "Kein Sender für dieses Gerät freigegeben.")
        } else {
            _ui.value = _ui.value.copy(stationId = stationId)
            refresh()
            listenForEvents(connection, stationId)
        }
    }

    fun refresh() {
        val stationId = _ui.value.stationId ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(loading = true, error = null)
            try {
                val stations = repo.api.stations()
                val nowPlaying = runCatching { repo.api.nowPlaying(stationId) }.getOrNull()
                val queue = runCatching { repo.api.queue(stationId) }.getOrNull()
                val sources = runCatching { repo.api.sources(stationId) }.getOrDefault(emptyList())
                val playout = runCatching { repo.api.playout(stationId) }.getOrNull()
                _ui.value = _ui.value.copy(
                    loading = false,
                    station = stations.firstOrNull { it.id == stationId },
                    nowPlaying = nowPlaying,
                    queue = queue?.items ?: emptyList(),
                    sources = sources,
                    playout = playout?.status,
                    connectionPhase = ConnectionPhase.CONNECTED,
                )
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(loading = false, error = e.message, connectionPhase = ConnectionPhase.DISCONNECTED)
            } catch (e: Exception) {
                _ui.value = _ui.value.copy(loading = false, error = "Verbindung verloren: ${e.message}", connectionPhase = ConnectionPhase.DISCONNECTED)
            }
        }
    }

    private fun listenForEvents(connection: SavedConnection, stationId: String) {
        sseJob?.cancel()
        sseJob = viewModelScope.launch {
            sseEvents(connection.serverUrl, connection.token, stationId).collect { event ->
                _ui.value = _ui.value.copy(connectionPhase = ConnectionPhase.CONNECTED)
                when (event.type) {
                    "playout", "queue", "sources", "now-playing", "nowPlaying" -> refresh()
                }
            }
        }
    }

    fun takeover(sourceId: String, force: Boolean = false) {
        val stationId = _ui.value.stationId ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busySourceId = sourceId)
            try {
                repo.api.takeover(stationId, sourceId, force)
                refresh()
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(error = e.message)
            } finally {
                _ui.value = _ui.value.copy(busySourceId = null)
            }
        }
    }

    fun release(sourceId: String) {
        val stationId = _ui.value.stationId ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busySourceId = sourceId)
            try {
                repo.api.release(stationId, sourceId)
                refresh()
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(error = e.message)
            } finally {
                _ui.value = _ui.value.copy(busySourceId = null)
            }
        }
    }

    override fun onCleared() {
        sseJob?.cancel()
        super.onCleared()
    }
}
