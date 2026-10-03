// Reine Logik des Sender-Admins (ohne Android): Titelfilter, Seitenwechsel, Algorithmen. Gegen die Radioadmin-API-Spezifikation geprüft.
package app.anmachacast.studio.radioadmin

import kotlinx.serialization.json.JsonObject
import java.net.URLEncoder

/** Suchfilter der Titelliste (GET /stations/{id}/tracks). */
data class RaFilter(
    val artist: String = "", val title: String = "", val album: String = "", val genre: String = "", val type: String = "",
    val playlist: String = "", val own: Boolean = false, val privateOnly: Boolean = false,
    val minYear: String = "", val maxYear: String = "", val minMinutes: String = "", val maxMinutes: String = "",
) {
    val active: Boolean get() = this != RaFilter()
}

private fun enc(s: String) = URLEncoder.encode(s.trim(), "UTF-8")
private fun digits(s: String, max: Int) = s.filter(Char::isDigit).take(max)

/** Abfrage-Teil ohne führendes „?“; leer, wenn nichts gefiltert wird und die erste Seite gemeint ist. Minuten werden zu Sekunden. */
fun trackQuery(f: RaFilter, page: Int = 1): String = buildList {
    fun text(k: String, v: String) { if (v.isNotBlank()) add("$k=${enc(v)}") }
    text("artist", f.artist); text("title", f.title); text("album", f.album); text("genre", f.genre); text("type", f.type); text("playlist", f.playlist)
    if (f.own) add("own=true")
    if (f.privateOnly) add("private=true")
    digits(f.minYear, 4).takeIf { it.length == 4 }?.let { add("min_release_year=$it") }
    digits(f.maxYear, 4).takeIf { it.length == 4 }?.let { add("max_release_year=$it") }
    digits(f.minMinutes, 4).takeIf { it.isNotEmpty() }?.let { add("min_duration=${it.toInt() * 60}") }
    digits(f.maxMinutes, 4).takeIf { it.isNotEmpty() }?.let { add("max_duration=${it.toInt() * 60}") }
    if (page > 1) add("page=$page")
}.joinToString("&")

/** Nächste Seite aus `_paging` (Titelsuche: next_page, Playlist-Titel: current_page/total_pages); null = letzte Seite. */
fun nextPage(o: JsonObject?): Int? {
    val p = o?.get("_paging").obj() ?: return null
    p["next_page"].lng()?.takeIf { it > 0 }?.let { return it.toInt() }
    val cur = p["current_page"].lng() ?: return null
    val total = p["total_pages"].lng() ?: return null
    return if (cur < total) (cur + 1).toInt() else null
}

/** Datum für die Tagesstatistik (JJJJ-MM-TT), prüft auch Monat und Tag. */
fun validDay(s: String): Boolean {
    val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$").matchEntire(s) ?: return false
    val (y, mo, d) = m.destructured
    return y.toInt() >= 2000 && mo.toInt() in 1..12 && d.toInt() in 1..31
}

val ALGORITHM_NAME = Regex("^[A-Za-z0-9_-]{1,64}$")

/** Fehlertext, wenn der Algorithmus nicht gespeichert werden sollte, sonst null. */
fun algorithmError(name: String, body: String): String? = when {
    !ALGORITHM_NAME.matches(name) -> "Name: Buchstaben, Ziffern, - und _ (höchstens 64 Zeichen)"
    body.isBlank() -> "Der Algorithmus ist leer"
    body.length > 20_000 -> "Der Algorithmus ist zu lang (höchstens 20 000 Zeichen)"
    !body.contains("function") -> "Erwartet wird eine JavaScript-Funktion, z. B. (function(tracks){return tracks.reverse()})"
    else -> null
}

/** Vorlagen: jede bekommt die Titelliste `tracks` und gibt die neue Reihenfolge zurück. */
val ALGORITHM_TEMPLATES = listOf(
    "Umkehren" to "(function(tracks){return tracks.reverse()})",
    "Nach Titel" to "(function(tracks){return tracks.slice().sort(function(a,b){return String(a.title).localeCompare(String(b.title))})})",
    "Nach Interpret" to "(function(tracks){return tracks.slice().sort(function(a,b){return String(a.artist).localeCompare(String(b.artist))})})",
    "Kürzeste zuerst" to "(function(tracks){return tracks.slice().sort(function(a,b){return a.duration-b.duration})})",
    "Mischen" to "(function(tracks){var a=tracks.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a})",
)

/** Kommagetrennte Ids in Päckchen, damit die Adresse kurz bleibt (Tags mehrerer Titel auf einmal). */
fun idChunks(ids: Collection<Long>, size: Int = 50): List<String> = ids.chunked(size).map { it.joinToString(",") }

/** Id des fertig verarbeiteten Titels aus der Antwort auf `/tracks/{id}`; null, solange der Upload noch läuft (Id negativ). */
fun finalTrackId(o: JsonObject?): Long? = o?.get("tracks").arr()?.firstOrNull().obj()?.l("id")?.takeIf { it > 0 }
