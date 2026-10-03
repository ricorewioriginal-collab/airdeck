// Gemeinsame laut.fm-Anmeldung der App: Go Live (Sendezugang) und Sender-Admin (Verwaltung) nutzen dieselbe
// Sitzung. Token und Station bleiben verschlüsselt auf dem Handy (LiveStore).
package app.anmachacast.studio.live

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LautFmUi(
    val account: LautFmAccount? = null,
    val stations: List<LautStation> = emptyList(),
    val busy: Boolean = false,
    val message: String? = null,
    val showLogin: Boolean = false,
    /** laut.fm hat das Token abgelehnt: neu anmelden */
    val expired: Boolean = false,
)

class LautFmSession(context: Context) {
    private val store = LiveStore(context)
    val client = LautFmClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(LautFmUi(account = runCatching { store.loadLautFm() }.getOrNull()))
    val state: StateFlow<LautFmUi> = _state.asStateFlow()

    /** Meldet jede neue oder gewechselte Station (Go Live übernimmt dann die Sende-Zugangsdaten). */
    private val _selected = MutableSharedFlow<LautFmAccount>(extraBufferCapacity = 4)
    val selected: SharedFlow<LautFmAccount> = _selected.asSharedFlow()

    val account: LautFmAccount? get() = _state.value.account

    init {
        if (account != null) loadStations()
    }

    fun openLogin() = _state.update { it.copy(showLogin = true, message = null) }
    fun closeLogin() = _state.update { it.copy(showLogin = false) }
    fun setMessage(m: String?) = _state.update { it.copy(message = m) }

    /** Token aus der Anmeldung (oder eingefügt) prüfen und Stationen laden. */
    fun connect(token: String) {
        if (_state.value.busy) return
        val clean = LautFmClient.cleanToken(token)
        if (clean.length < 16) {
            _state.update { it.copy(message = "Das sieht nicht wie ein laut.fm-Token aus") }
            return
        }
        _state.update { it.copy(busy = true, showLogin = false, message = null) }
        scope.launch {
            try {
                val (origin, stations) = client.verify(clean)
                val mine = stations.filter { it.role != "listener" }.ifEmpty { stations }
                val keep = account
                var acc = LautFmAccount(clean, origin)
                // Bei genau einer Station direkt wählen, sonst bleibt die Auswahl dem Nutzer
                if (mine.size == 1) acc = acc.withStation(mine[0])
                else if (keep != null) mine.firstOrNull { it.id == keep.stationId }?.let { acc = acc.withStation(it) }
                store.saveLautFm(acc)
                _state.update { it.copy(account = acc, stations = mine, busy = false, expired = false, message = "Verbunden – ${mine.size} Station(en)") }
                if (acc.stationId > 0) _selected.tryEmit(acc)
            } catch (e: LautFmException) {
                _state.update { it.copy(busy = false, message = e.message) }
            }
        }
    }

    fun loadStations() {
        val acc = account ?: return
        scope.launch {
            try {
                val (origin, stations) = client.verify(acc.token, acc.origin)
                val mine = stations.filter { it.role != "listener" }.ifEmpty { stations }
                // Slug der gewählten Station nachtragen (ältere Speicherstände kennen ihn nicht)
                var next = if (origin != acc.origin) acc.copy(origin = origin) else acc
                mine.firstOrNull { it.id == next.stationId }?.let { if (next.stationSlug != it.name) next = next.withStation(it) }
                if (next != acc) store.saveLautFm(next)
                _state.update { it.copy(stations = mine, account = next, expired = false) }
            } catch (e: LautFmException) {
                _state.update { it.copy(expired = e.unauthorized, message = if (e.unauthorized) "laut.fm-Anmeldung abgelaufen – bitte neu verbinden" else e.message) }
            }
        }
    }

    fun select(s: LautStation) {
        val acc = account ?: return
        val next = acc.withStation(s)
        store.saveLautFm(next)
        _state.update { it.copy(account = next, message = null) }
        _selected.tryEmit(next)
    }

    /** Ein Aufruf bekam 401/403: Origin neu ermitteln; liefert das neue Konto oder null, wenn neu angemeldet werden muss. */
    suspend fun reauthorize(): LautFmAccount? {
        val acc = account ?: return null
        return try {
            val (origin, _) = client.verify(acc.token, acc.origin)
            val next = acc.copy(origin = origin)
            if (next != acc) { store.saveLautFm(next); _state.update { it.copy(account = next) } }
            next
        } catch (e: LautFmException) {
            _state.update { it.copy(expired = true, message = "laut.fm-Anmeldung abgelaufen – bitte neu verbinden") }
            null
        }
    }

    fun disconnect() {
        store.clearLautFm()
        _state.value = LautFmUi()
    }

    fun setBusy(b: Boolean) = _state.update { it.copy(busy = b) }

    private fun LautFmAccount.withStation(s: LautStation) = copy(stationId = s.id, stationName = s.displayName, stationSlug = s.name)
}
