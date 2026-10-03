package app.anmachacast.studio

import android.app.Application
import app.anmachacast.studio.data.ConnectionRepository
import app.anmachacast.studio.live.LautFmSession

class AnMaChaCastApp : Application() {
    lateinit var connectionRepository: ConnectionRepository
        private set

    /** gemeinsame laut.fm-Sitzung für Go Live und Sender-Admin */
    val lautSession: LautFmSession by lazy { LautFmSession(this) }

    override fun onCreate() {
        super.onCreate()
        connectionRepository = ConnectionRepository(this)
    }
}
