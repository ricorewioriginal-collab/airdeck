// Hält die aktuelle Server-Verbindung (eine pro App-Prozess) und reicht sie an alle ViewModels weiter.
package app.anmachacast.studio.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ConnectionRepository(context: Context) {
    private val tokenStore = TokenStore(context.applicationContext)

    private val _connection = MutableStateFlow(tokenStore.load())
    val connection: StateFlow<SavedConnection?> = _connection.asStateFlow()

    val api: ApiClient = ApiClient(_connection.value?.serverUrl ?: "", _connection.value?.token)

    fun setConnection(c: SavedConnection) {
        tokenStore.save(c)
        _connection.value = c
        api.updateAuth(c.serverUrl, c.token)
    }

    fun disconnect() {
        tokenStore.clear()
        _connection.value = null
        api.updateAuth("", null)
    }

    fun isConnected(): Boolean = _connection.value != null
}
