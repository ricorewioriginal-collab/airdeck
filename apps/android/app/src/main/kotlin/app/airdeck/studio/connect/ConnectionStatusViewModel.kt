package app.airdeck.studio.connect

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import app.airdeck.studio.AnMaChaCastApp
import app.airdeck.studio.data.SavedConnection
import kotlinx.coroutines.flow.StateFlow

/** Liest die aktuelle Verbindung nur zur Anzeige/Trennung - keine eigene Kopplungslogik. */
class ConnectionStatusViewModel(application: Application) : AndroidViewModel(application) {
    private val repo = (application as AnMaChaCastApp).connectionRepository
    val connection: StateFlow<SavedConnection?> = repo.connection

    fun disconnect() = repo.disconnect()
}
