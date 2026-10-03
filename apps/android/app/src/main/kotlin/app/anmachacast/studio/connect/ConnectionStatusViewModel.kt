package app.anmachacast.studio.connect

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.data.SavedConnection
import kotlinx.coroutines.flow.StateFlow

/** Liest die aktuelle Verbindung nur zur Anzeige/Trennung - keine eigene Kopplungslogik. */
class ConnectionStatusViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = (application as AnMaChaCastApp).connectionRepository
    val connection: StateFlow<SavedConnection?> = repo.connection

    fun disconnect() = repo.disconnect()
}
