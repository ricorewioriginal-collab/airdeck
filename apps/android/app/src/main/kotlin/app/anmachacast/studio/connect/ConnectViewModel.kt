// Kopplung an einen AnMaCha-Cast-Server per 6-stelligem Code (POST /api/v1/pair, siehe services/devices.ts).
// Kein QR-Scan in diesem Schritt (CameraX/MLKit bewusst zurückgestellt) - manuelle Eingabe ist ehrlich
// vollständig, ein Scanner kommt als eigener Schritt dazu statt hier als Attrappe zu stehen.
package app.anmachacast.studio.connect

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.data.ApiException
import app.anmachacast.studio.data.SavedConnection
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ConnectUiState(
    val serverUrl: String = "",
    val code: String = "",
    val deviceName: String = android.os.Build.MODEL ?: "AnMaCha Cast Handy",
    val loading: Boolean = false,
    val error: String? = null,
    val connected: Boolean = false,
)

class ConnectViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = (application as AnMaChaCastApp).connectionRepository
    private val _ui = MutableStateFlow(ConnectUiState())
    val ui: StateFlow<ConnectUiState> = _ui.asStateFlow()

    fun setServerUrl(v: String) {
        _ui.value = _ui.value.copy(serverUrl = v, error = null)
    }

    fun setCode(v: String) {
        _ui.value = _ui.value.copy(code = v.filter { it.isDigit() }.take(6), error = null)
    }

    fun setDeviceName(v: String) {
        _ui.value = _ui.value.copy(deviceName = v)
    }

    fun pair() {
        val state = _ui.value
        val serverUrl = state.serverUrl.trim().trimEnd('/')
        if (serverUrl.isBlank()) {
            _ui.value = state.copy(error = "Server-Adresse fehlt (z. B. https://dein-server:8750)")
            return
        }
        if (state.code.length != 6) {
            _ui.value = state.copy(error = "Kopplungscode hat 6 Ziffern")
            return
        }
        _ui.value = state.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                repo.api.updateAuth(serverUrl, null)
                val resp = repo.api.pair(state.code, state.deviceName)
                repo.setConnection(
                    SavedConnection(
                        serverUrl = serverUrl,
                        token = resp.token,
                        deviceName = resp.device.name.ifBlank { state.deviceName },
                        stationIds = resp.device.stationIds,
                    )
                )
                _ui.value = _ui.value.copy(loading = false, connected = true)
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(loading = false, error = e.message)
            } catch (e: Exception) {
                _ui.value = _ui.value.copy(loading = false, error = "Verbindung fehlgeschlagen: ${e.message}")
            }
        }
    }
}
