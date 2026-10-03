// GO LIVE: Bindeglied zwischen der nativen Oberfläche und der Handy-Engine (EngineHub, reines Java,
// siehe apps/android/native und apps/android/engine/src) plus laut.fm- und Nextcloud-Anbindung.
package app.anmachacast.studio.golive

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.anmachacast.engine.android.EngineHub
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.live.LautFmAccount
import app.anmachacast.studio.live.LautFmClient
import app.anmachacast.studio.live.LautFmUi
import app.anmachacast.studio.live.LautStation
import app.anmachacast.studio.live.LiveStore
import app.anmachacast.studio.live.NcEntry
import app.anmachacast.studio.live.NcLoginStart
import app.anmachacast.studio.live.NextcloudAccount
import app.anmachacast.studio.live.NextcloudClient
import app.anmachacast.studio.live.NextcloudException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MicSource(val id: Int, val label: String)

data class NextcloudUi(
    val account: NextcloudAccount? = null,
    val folder: String = "",
    val entries: List<NcEntry> = emptyList(),
    val loading: Boolean = false,
    val message: String? = null,
    val loginUrl: String? = null,
    val adding: String? = null,
)

data class DeckUi(
    val state: String = "empty",
    val title: String? = null,
    val trackIndex: Int = -1,
    val positionMs: Long = 0,
    val durationMs: Long = -1,
    val volume: Float = 1f,
    val levelDb: Float = -90f,
)

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
    val startedAt: Long = 0,
    val decks: List<DeckUi> = List(4) { DeckUi() },
    val notice: String? = null,
    val playlist: List<String> = emptyList(),
    val hasMicPermission: Boolean = false,
    val config: EngineHub.ConfigView? = null,
    val micSources: List<MicSource> = emptyList(),
    val latch: Boolean = false,
    val starting: Boolean = false,
    val lautfm: LautFmUi = LautFmUi(),
    val nextcloud: NextcloudUi = NextcloudUi(),
)

class GoLiveViewModel(application: Application) : AndroidViewModel(application) {
    private val hub = EngineHub.get(application)
    private val store = LiveStore(application)
    private val session = (application as AnMaChaCastApp).lautSession
    private val laut = session.client
    private val nc = NextcloudClient()
    private val _ui = MutableStateFlow(GoLiveUiState())
    val ui: StateFlow<GoLiveUiState> = _ui.asStateFlow()
    private var ncPoll: Job? = null
    private var localError: String? = null

    init {
        nc.clearCache(application)
        val ncAcc = runCatching { store.loadNextcloud() }.getOrNull()
        _ui.update { it.copy(nextcloud = it.nextcloud.copy(account = ncAcc)) }
        viewModelScope.launch { session.state.collect { st -> _ui.update { it.copy(lautfm = st) } } }
        // Neue/gewählte laut.fm-Station: Sende-Zugangsdaten übernehmen (nicht während einer laufenden Sendung)
        viewModelScope.launch {
            session.selected.collect { acc ->
                if (hub.running()) return@collect
                try {
                    applyLautFmCredentials(acc)
                    session.setMessage("Zugangsdaten für ${acc.stationName} übernommen")
                } catch (e: Exception) {
                    session.setMessage(e.message)
                }
            }
        }
        refreshConfig()
        refreshPermission()
        refreshMicSources()
        viewModelScope.launch {
            while (true) {
                pullStatus()
                // Schnell, solange gesendet wird (Pegel); sonst sparsam
                delay(if (_ui.value.running) 100 else 600)
            }
        }
    }

    fun refreshPermission() {
        val granted = ContextCompat.checkSelfPermission(getApplication(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        _ui.update { it.copy(hasMicPermission = granted) }
        if (granted) {
            hub.ensureMic()
            refreshMicSources()
        }
    }

    fun refreshMicSources() {
        val list = runCatching { hub.micDevices().map { MicSource(it.id, it.label) } }.getOrDefault(emptyList())
        _ui.update { it.copy(micSources = list) }
    }

    private fun pullStatus() {
        val s = hub.status()
        _ui.update {
            it.copy(
                running = s.running,
                state = s.state ?: "stopped",
                error = s.error ?: localError,
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
                startedAt = s.startedAt,
                decks = s.decks?.map { d -> DeckUi(d.state, d.title, d.trackIndex, d.positionMs, d.durationMs, d.volume, d.levelDb) } ?: it.decks,
                playlist = s.playlist?.map { t -> t.title } ?: emptyList(),
            )
        }
    }

    fun refreshConfig() {
        _ui.update { it.copy(config = hub.getConfigView()) }
    }

    fun clearError() {
        localError = null
        _ui.update { it.copy(error = null) }
    }

    private fun fail(msg: String?) {
        localError = msg ?: "Unbekannter Fehler"
        _ui.update { it.copy(error = localError) }
    }

    fun saveConfig(host: String, port: Int, tls: Boolean, mount: String, user: String, name: String, bitrate: Int, password: String) {
        runCatching { hub.saveConfig(host, port, tls, mount, user, name, bitrate, password) }
            .onSuccess { refreshConfig(); clearError() }
            .onFailure { fail(it.message) }
    }

    // ---------- Sendung ----------

    /** Startet die Sendung. Ist eine laut.fm-Station gewählt, werden deren Zugangsdaten vorher frisch geholt. */
    fun start() {
        if (_ui.value.starting || _ui.value.running) return
        clearError()
        _ui.update { it.copy(starting = true) }
        viewModelScope.launch {
            try {
                val acc = _ui.value.lautfm.account
                if (acc != null && acc.stationId > 0) applyLautFmCredentials(acc)
                hub.start(_ui.value.hasMicPermission)
            } catch (e: Exception) {
                fail(e.message)
            } finally {
                _ui.update { it.copy(starting = false) }
                pullStatus()
            }
        }
    }

    fun stop() {
        hub.stop()
        pullStatus()
    }

    // ---------- Mikrofon / Push-to-Talk ----------

    /** Direkt an die Engine, ohne Umweg über die Statusabfrage - reagiert innerhalb eines Mischtakts (20 ms). */
    fun pttPress() {
        runCatching { hub.setMic(true) }.onFailure { fail(it.message) }
    }

    fun pttRelease() {
        runCatching { hub.setMic(false) }
    }

    fun setLatch(on: Boolean) {
        _ui.update { it.copy(latch = on) }
        if (!on) pttRelease()
    }

    fun toggleMicLatched() {
        val on = !_ui.value.micOn
        runCatching { hub.setMic(on) }.onFailure { fail(it.message) }
    }

    fun setMicSource(id: Int, raw: Boolean) {
        runCatching { hub.setMicDevice(id, raw) }.onFailure { fail(it.message) }
        refreshConfig()
    }

    fun setLevels(micDb: Float? = null, musicDb: Float? = null, duckDb: Float? = null) {
        hub.setLevels(micDb, musicDb, duckDb)
        refreshConfig()
    }

    fun toggleMonitor() {
        hub.setMonitor(!_ui.value.monitor)
        refreshConfig()
    }

    fun toggleAutoNext() {
        hub.setAutoNext(!_ui.value.autoNext)
    }

    // ---------- Titel und Decks ----------

    private var noticeJob: Job? = null

    private fun notice(text: String) {
        _ui.update { it.copy(notice = text) }
        noticeJob?.cancel()
        noticeJob = viewModelScope.launch { delay(4000); _ui.update { it.copy(notice = null) } }
    }

    fun addTracks(uris: List<Uri>, titles: List<String>) {
        hub.addTracks(uris.indices.map { EngineHub.Track(uris[it].toString(), titles[it]) })
        notice("${uris.size} Titel hinzugefügt")
        pullStatus()
    }

    /** Alle Audiodateien eines Ordners (bis drei Ebenen tief) in die Bibliothek legen. */
    fun addFolder(tree: Uri) {
        val app = getApplication<Application>()
        runCatching { app.contentResolver.takePersistableUriPermission(tree, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        viewModelScope.launch {
            val found = withContext(Dispatchers.IO) { scanTree(app, tree) }
            if (found.isEmpty()) notice("Keine Audiodateien im Ordner gefunden")
            else {
                hub.addTracks(found.map { EngineHub.Track(it.first.toString(), it.second) })
                notice("${found.size} Titel aus dem Ordner hinzugefügt")
            }
            pullStatus()
        }
    }

    private fun scanTree(app: Application, tree: Uri): List<Pair<Uri, String>> {
        val out = ArrayList<Pair<Uri, String>>()
        fun walk(docId: String, depth: Int) {
            if (out.size >= 1000) return
            val children = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            app.contentResolver.query(
                children,
                arrayOf(android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID, android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME, android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE),
                null, null, null,
            )?.use { c ->
                val entries = ArrayList<Triple<String, String, String>>()
                while (c.moveToNext()) entries += Triple(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "")
                entries.sortedBy { it.second.lowercase() }.forEach { (id, name, mime) ->
                    if (mime == android.provider.DocumentsContract.Document.MIME_TYPE_DIR) { if (depth < 3) walk(id, depth + 1) }
                    else if (mime.startsWith("audio/") || name.substringAfterLast('.', "").lowercase() in setOf("mp3", "m4a", "aac", "ogg", "opus", "flac", "wav")) {
                        out += android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, id) to name.substringBeforeLast('.')
                    }
                }
            }
        }
        walk(android.provider.DocumentsContract.getTreeDocumentId(tree), 0)
        return out
    }

    private fun deckAction(block: () -> Unit) {
        runCatching(block).onFailure { fail(it.message) }
        pullStatus()
    }

    fun loadDeck(deck: Int, trackIndex: Int) = viewModelScope.launch {
        // Dauer ermitteln kann kurz dauern: nicht im Oberflächen-Thread
        withContext(Dispatchers.IO) { runCatching { hub.loadDeck(deck, trackIndex) }.onFailure { fail(it.message) } }
        pullStatus()
    }

    /** Titel in ein Deck laden und sofort starten. */
    fun loadAndPlay(deck: Int, trackIndex: Int) = viewModelScope.launch {
        withContext(Dispatchers.IO) {
            runCatching { hub.loadDeck(deck, trackIndex); hub.playDeck(deck) }.onFailure { fail(it.message) }
        }
        pullStatus()
    }

    fun playDeck(deck: Int) = deckAction { hub.playDeck(deck) }
    fun pauseDeck(deck: Int) = deckAction { hub.pauseDeck(deck) }
    fun stopDeck(deck: Int) = deckAction { hub.stopDeck(deck) }
    fun ejectDeck(deck: Int) = deckAction { hub.ejectDeck(deck) }
    fun seekDeck(deck: Int, ms: Long) = deckAction { hub.seekDeck(deck, ms) }
    fun setDeckVolume(deck: Int, volume: Float) = deckAction { hub.setDeckVolume(deck, volume) }

    fun removeTrack(index: Int) {
        hub.removeTrack(index)
        pullStatus()
    }

    fun clearPlaylist() {
        hub.clearPlaylist()
        pullStatus()
    }

    // ---------- laut.fm (gemeinsame Sitzung) ----------

    fun openLautFmLogin() = session.openLogin()
    fun closeLautFmLogin() = session.closeLogin()
    fun connectLautFm(token: String) = session.connect(token)
    fun loadStations() = session.loadStations()
    fun selectLautFmStation(s: LautStation) = session.select(s)
    fun disconnectLautFm() = session.disconnect()

    /** Live-Zugangsdaten der gewählten Station in den Encoder übernehmen (Passwort bleibt in der App). */
    private suspend fun applyLautFmCredentials(acc: LautFmAccount) {
        val live = laut.live(acc, acc.stationId)
        val bitrate = listOf(64, 96, 128, 160, 192, 256, 320).minByOrNull { kotlin.math.abs(it - live.bitrate) } ?: 128
        hub.saveConfig(live.server, live.port, live.tls, live.mount, live.user, "laut.fm ${acc.stationName}", bitrate, live.password)
        refreshConfig()
    }

    // ---------- Nextcloud ----------

    fun startNextcloudLogin(server: String) {
        _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = true, message = null)) }
        viewModelScope.launch {
            try {
                val start = nc.startLogin(server)
                _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = true, loginUrl = start.loginUrl, message = "Im Browser bestätigen, dann hierher zurückkehren …")) }
                pollNextcloud(start)
            } catch (e: NextcloudException) {
                _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = false, loginUrl = null, message = e.message)) }
            }
        }
    }

    private fun pollNextcloud(start: NcLoginStart) {
        ncPoll?.cancel()
        ncPoll = viewModelScope.launch {
            repeat(150) { // ca. 5 Minuten
                val acc = nc.pollLogin(start)
                if (acc != null) {
                    store.saveNextcloud(acc)
                    _ui.update { it.copy(nextcloud = NextcloudUi(account = acc, message = "Verbunden mit ${acc.server}")) }
                    openFolder("")
                    return@launch
                }
                delay(2000)
            }
            _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = false, loginUrl = null, message = "Zeit abgelaufen – bitte neu verbinden")) }
        }
    }

    fun cancelNextcloudLogin() {
        ncPoll?.cancel()
        _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = false, loginUrl = null, message = null)) }
    }

    fun disconnectNextcloud() {
        ncPoll?.cancel()
        store.clearNextcloud()
        nc.clearCache(getApplication())
        _ui.update { it.copy(nextcloud = NextcloudUi()) }
    }

    fun openFolder(folder: String) {
        val acc = _ui.value.nextcloud.account ?: return
        _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = true, message = null)) }
        viewModelScope.launch {
            try {
                val list = nc.list(acc, folder)
                _ui.update { it.copy(nextcloud = it.nextcloud.copy(folder = folder.trim('/'), entries = list, loading = false)) }
            } catch (e: NextcloudException) {
                _ui.update { it.copy(nextcloud = it.nextcloud.copy(loading = false, message = e.message)) }
            }
        }
    }

    fun folderUp() {
        val f = _ui.value.nextcloud.folder
        if (f.isNotEmpty()) openFolder(f.substringBeforeLast('/', ""))
    }

    /** Einzelne Titel oder alle Titel eines Ordners laden und in die Playlist legen. */
    fun addFromNextcloud(entries: List<NcEntry>) {
        val acc = _ui.value.nextcloud.account ?: return
        val files = entries.filter { !it.isDir && NextcloudClient.isAudio(it.name) }
        if (files.isEmpty()) {
            _ui.update { it.copy(nextcloud = it.nextcloud.copy(message = "Keine Audiodateien ausgewählt")) }
            return
        }
        viewModelScope.launch {
            var done = 0
            for (f in files) {
                _ui.update { it.copy(nextcloud = it.nextcloud.copy(adding = "Lade ${f.name} (${done + 1}/${files.size})")) }
                try {
                    val local = nc.download(getApplication(), acc, f)
                    hub.addTracks(listOf(EngineHub.Track(Uri.fromFile(local).toString(), f.name.substringBeforeLast('.'))))
                    done++
                } catch (e: NextcloudException) {
                    _ui.update { it.copy(nextcloud = it.nextcloud.copy(message = e.message)) }
                }
            }
            _ui.update { it.copy(nextcloud = it.nextcloud.copy(adding = null, message = "$done Titel in der Playlist")) }
            pullStatus()
        }
    }
}
