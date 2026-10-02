// Verschlüsselte Ablage der Geräte-Verbindung (Server-URL + Token) - nie im Klartext, nie in Logs.
package app.airdeck.studio.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class TokenStore(context: Context) {
    private val appContext = context.applicationContext

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            "anmachacast_connection",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun save(connection: SavedConnection) {
        prefs.edit()
            .putString(KEY_SERVER, connection.serverUrl)
            .putString(KEY_TOKEN, connection.token)
            .putString(KEY_DEVICE_NAME, connection.deviceName)
            .putString(KEY_STATION_IDS, connection.stationIds.joinToString(","))
            .apply()
    }

    fun load(): SavedConnection? {
        val server = prefs.getString(KEY_SERVER, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val name = prefs.getString(KEY_DEVICE_NAME, "") ?: ""
        val stations = prefs.getString(KEY_STATION_IDS, "")?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
        return SavedConnection(server, token, name, stations)
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_SERVER = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_STATION_IDS = "station_ids"
    }
}
