// Verschlüsselte Ablage der Go-Live-Zugänge (laut.fm-Token, Nextcloud-App-Passwort) - nie im Klartext.
package app.anmachacast.studio.live

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class LautFmAccount(val token: String, val origin: String, val stationId: Long = 0, val stationName: String = "")
data class NextcloudAccount(val server: String, val user: String, val appPassword: String)

class LiveStore(context: Context) {
    private val appContext = context.applicationContext

    private val prefs by lazy {
        val key = MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            appContext, "anmachacast_live", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun loadLautFm(): LautFmAccount? {
        val token = prefs.getString("laut_token", null) ?: return null
        return LautFmAccount(token, prefs.getString("laut_origin", "") ?: "", prefs.getLong("laut_station", 0), prefs.getString("laut_station_name", "") ?: "")
    }

    fun saveLautFm(a: LautFmAccount) {
        prefs.edit().putString("laut_token", a.token).putString("laut_origin", a.origin)
            .putLong("laut_station", a.stationId).putString("laut_station_name", a.stationName).apply()
    }

    fun clearLautFm() {
        prefs.edit().remove("laut_token").remove("laut_origin").remove("laut_station").remove("laut_station_name").apply()
    }

    fun loadNextcloud(): NextcloudAccount? {
        val server = prefs.getString("nc_server", null) ?: return null
        val user = prefs.getString("nc_user", null) ?: return null
        val pw = prefs.getString("nc_pw", null) ?: return null
        return NextcloudAccount(server, user, pw)
    }

    fun saveNextcloud(a: NextcloudAccount) {
        prefs.edit().putString("nc_server", a.server).putString("nc_user", a.user).putString("nc_pw", a.appPassword).apply()
    }

    fun clearNextcloud() {
        prefs.edit().remove("nc_server").remove("nc_user").remove("nc_pw").apply()
    }
}
