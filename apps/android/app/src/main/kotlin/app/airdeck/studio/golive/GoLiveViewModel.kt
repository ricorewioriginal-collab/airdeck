// GO LIVE: Bindeglied zwischen der nativen Oberfläche und der Handy-Engine (EngineHub, reines Java,
// kein Capacitor mehr dazwischen - siehe apps/android/native und apps/android/engine/src).
package app.airdeck.studio.golive

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.airdeck.engine.android.EngineHub
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GoLiveUiState(
    val running: Boolean = false,
    val state: String = "stopped",
    val error: String? = null,
    val micAvailable: Boolean = false,
    val micOn: Boolean = false,
    val monitor: Boolean = false,
    val autoNext: Boolean = true,
    val micDb: Float = -90f,
    val musicDb: Float = -90f,
    val masterDb: Float = -90f,
    val peakDb: Float = -90f,
    val bytesSent: Long = 0,
    val dropped: Long = 0,
    val currentIndex: Int = -1,
    val positionMs: Long = 0,
    val durationMs: Long = -1,
    val playlist: List<String> = emptyList(),
    val hasMicPermission: Boolean = false,
    val config: EngineHub.ConfigView? = null,
)

class GoLiveViewModel(application: Application) : AndroidViewModel(application) {
    private val hub = EngineHub.get(application)
    private val _ui = MutableStateFlow(GoLiveUiState())
    val ui: StateFlow<GoLiveUiState> = _ui.asStateFlow()

    init {
        refreshConfig()
        refreshPermission()
        viewModelScope.launch {
            while (true) {
                pullStatus()
                delay(300)
            }
        }
    }

    fun refreshPermission() {
        val granted = ContextCompat.checkSelfPermission(getApplication(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        _ui.value = _ui.value.copy(hasMicPermission = granted)
    }

    private fun pullStatus() {
        val s = hub.status()
        _ui.value = _ui.value.copy(
            running = s.running,
            state = s.state ?: "stopped",
            error = s.error,
            micAvailable = s.micAvailable,
            micOn = s.micOn,
            monitor = s.monitor,
            autoNext = s.autoNext,
            micDb = s.micDb,
            musicDb = s.musicDb,
            masterDb = s.masterDb,
            peakDb = s.peakDb,
            bytesSent = s.bytesSent,
            dropped = s.dropped,
            currentIndex = s.current,
            positionMs = s.positionMs,
            durationMs = s.durationMs,
            playlist = s.playlist?.map { it.title } ?: emptyList(),
        )
    }

    fun refreshConfig() {
        _ui.value = _ui.value.copy(config = hub.getConfigView())
    }

    fun saveConfig(host: String, port: Int, tls: Boolean, mount: String, user: String, name: String, bitrate: Int, password: String) {
        runCatching { hub.saveConfig(host, port, tls, mount, user, name, bitrate, password) }
            .onSuccess { refreshConfig() }
            .onFailure { _ui.value = _ui.value.copy(error = it.message) }
    }

    fun start(withMic: Boolean) {
        runCatching { hub.start(withMic) }.onFailure { _ui.value = _ui.value.copy(error = it.message) }
        pullStatus()
    }

    fun stop() {
        hub.stop()
        pullStatus()
    }

    fun toggleMic() {
        runCatching { hub.setMic(!_ui.value.micOn) }.onFailure { _ui.value = _ui.value.copy(error = it.message) }
    }

    fun setLevels(micDb: Float? = null, musicDb: Float? = null, duckDb: Float? = null) {
        hub.setLevels(micDb, musicDb, duckDb)
    }

    fun toggleMonitor() {
        hub.setMonitor(!_ui.value.monitor)
    }

    fun toggleAutoNext() {
        hub.setAutoNext(!_ui.value.autoNext)
    }

    fun addTracks(uris: List<Uri>, titles: List<String>) {
        hub.addTracks(uris.indices.map { EngineHub.Track(uris[it].toString(), titles[it]) })
        pullStatus()
    }

    fun play(index: Int) {
        runCatching { hub.play(index) }.onFailure { _ui.value = _ui.value.copy(error = it.message) }
        pullStatus()
    }

    fun stopTrack() {
        hub.stopTrack()
        pullStatus()
    }

    fun removeTrack(index: Int) {
        hub.removeTrack(index)
        pullStatus()
    }

    fun clearPlaylist() {
        hub.clearPlaylist()
        pullStatus()
    }
}
