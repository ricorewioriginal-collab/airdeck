package app.anmachacast.studio

import android.app.Application
import app.anmachacast.studio.data.ConnectionRepository

class AnMaChaCastApp : Application() {
    lateinit var connectionRepository: ConnectionRepository
        private set

    override fun onCreate() {
        super.onCreate()
        connectionRepository = ConnectionRepository(this)
    }
}
