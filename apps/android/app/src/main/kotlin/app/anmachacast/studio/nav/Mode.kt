// Betriebsart der App: GO LIVE (Handy sendet selbst) oder SERVER/STUDIO (Fernsteuerung). Die letzte Wahl
// bleibt gespeichert, der Umschalter ist in beiden Betriebsarten dauerhaft sichtbar.
package app.anmachacast.studio.nav

import android.content.Context

enum class Mode { GOLIVE, STUDIO }

class ModeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("anmachacast_ui", Context.MODE_PRIVATE)

    fun get(): Mode? = runCatching { Mode.valueOf(prefs.getString("mode", "") ?: "") }.getOrNull()
    fun set(m: Mode) = prefs.edit().putString("mode", m.name).apply()
}
