// Sender-Admin: laut.fm Radioadmin mobil (Übersicht, Playlists, Titel, Sendeplan, Statistik, Benutzer, Station, Live).
// Alle Aufrufe gehen direkt vom Handy an die Radioadmin-API; der Token bleibt verschlüsselt auf dem Gerät.
package app.anmachacast.studio.radioadmin

import android.app.Application
import android.media.MediaPlayer
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.live.LautStation
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException

data class RaPlaylist(val id: Long, val title: String, val color: String, val size: Int, val durationSec: Long, val description: String, val shuffled: Boolean, val algorithm: String = "")

data class RaTrack(
    val id: Long, val artist: String, val title: String, val genre: String, val durationSec: Long,
    val tags: List<String>, val year: Int?, val type: String, val private: Boolean,
    val album: String = "", val month: Int? = null, val day: Int? = null, val deletable: Boolean = true,
)

data class RaUser(val id: Long, val name: String, val email: String, val role: String)
data class RaEntry(val playlistId: Long, val slot: Int, val duration: Int)
data class RaSchedule(val baseId: Long?, val entries: List<RaEntry>)
data class RaPlayed(val start: String, val title: String, val listeners: Int, val live: Boolean, val type: String)

data class RaOverview(
    val name: String, val description: String, val format: String, val genres: String, val active: Boolean?,
    val nowTitle: String?, val listeners: Long?, val position: Long?, val playlist: String?, val reason: String?,
    val upcoming: List<String>, val last: List<String>, val apiRunning: Boolean?,
)

data class RaStats(val listenersNow: Long?, val position: Long?, val log: List<Pair<String, Int>>, val played: List<RaPlayed>, val hours: List<Pair<String, Int>> = emptyList())

/** Automation-Algorithmus (JavaScript-Funktion, die die Reihenfolge einer Playlist bestimmt); `exists` = bei laut.fm vorhanden. */
data class RaAlgorithm(val name: String, val body: String, val exists: Boolean)
data class RaLive(val server: String, val port: Int, val mount: String, val user: String, val format: String, val password: String, val active: Boolean)

data class RaUi(
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val overview: RaOverview? = null,
    val playlists: List<RaPlaylist> = emptyList(),
    val openPlaylist: RaPlaylist? = null,
    val playlistTracks: List<RaTrack> = emptyList(),
    val tracks: List<RaTrack> = emptyList(),
    val tracksSearched: Boolean = false,
    val tracksNext: Int? = null,
    val lastFilter: RaFilter = RaFilter(),
    val playlistNext: Int? = null,
    val algorithm: RaAlgorithm? = null,
    val statsDay: String? = null,
    val processing: List<RaTrack> = emptyList(),
    val schedule: RaSchedule? = null,
    val stats: RaStats? = null,
    val users: List<RaUser> = emptyList(),
    val station: JsonObject? = null,
    val stationActive: Boolean? = null,
    val live: RaLive? = null,
    val playingTrack: Long? = null,
    val tagSuggestions: List<String> = emptyList(),
)

/**
 * Belegt `hours` Stunden ab `slot` (Tag * 24 + Stunde, Montag = 0) mit der Playlist, `null` leert die Stunden
 * (es gilt wieder die Basis-Playlist). Aufeinanderfolgende Stunden derselben Playlist werden zu einem Eintrag.
 */
fun applySlots(current: List<RaEntry>, slot: Int, hours: Int, playlistId: Long?): List<RaEntry> {
    val grid = HashMap<Int, Long>()
    for (e in current) for (i in 0 until e.duration) grid[e.slot + i] = e.playlistId
    for (i in 0 until hours.coerceIn(1, 168 - slot)) {
        if (playlistId != null) grid[slot + i] = playlistId else grid.remove(slot + i)
    }
    val entries = ArrayList<RaEntry>()
    for (i in 0 until 168) {
        val id = grid[i] ?: continue
        val last = entries.lastOrNull()
        if (last != null && last.playlistId == id && last.slot + last.duration == i) entries[entries.size - 1] = last.copy(duration = last.duration + 1)
        else entries += RaEntry(id, i, 1)
    }
    return entries
}

val IMAGE_TYPES = listOf("logo", "background", "website")

class RadioadminViewModel(application: Application) : AndroidViewModel(application) {
    val session = (application as AnMaChaCastApp).lautSession
    private val ra = RaClient(session)
    private val _ui = MutableStateFlow(RaUi())
    val ui: StateFlow<RaUi> = _ui.asStateFlow()
    private var player: MediaPlayer? = null

    /** Alle laufenden Aktionen hängen hier; bei einem Stationswechsel werden sie abgebrochen. */
    private val ops = SupervisorJob(viewModelScope.coroutineContext[Job])
    private var stationFor = 0L

    /** Station gewechselt: Aktionen und Daten der alten Station verwerfen. Wird vor dem Neuladen aufgerufen. */
    fun enterStation(id: Long) {
        if (id == stationFor) return
        ops.cancelChildren()
        stopPrelisten()
        stationFor = id
        _ui.value = RaUi()
    }

    fun clearMessage() = _ui.update { it.copy(message = null, error = null) }

    /** Ablauf einer Aktion mit Ladebalken und lesbarer Fehlermeldung. */
    private fun op(done: String? = null, block: suspend () -> Unit) {
        // Ohne vollzogenen Stationswechsel (enterStation) wird nichts ausgeführt - schützt vor Schreibzugriffen auf die falsche Station
        if (stationFor != ra.stationId) return
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch(ops) {
            try {
                block()
                _ui.update { it.copy(loading = false, message = done ?: it.message) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e // Stationswechsel: nichts mehr in den neuen Zustand schreiben
            } catch (e: IOException) {
                _ui.update { it.copy(loading = false, error = e.message ?: "Netzwerkfehler") }
            } catch (e: RuntimeException) {
                _ui.update { it.copy(loading = false, error = e.message ?: "Fehler") }
            }
        }
    }

    // ---------- Station ----------

    val stationId: Long get() = ra.stationId
    fun selectStation(s: LautStation) = session.select(s)

    // ---------- Übersicht ----------

    fun loadOverview() = op {
        val slug = session.account?.stationSlug.orEmpty()
        val r = coroutineScope {
            val info = async { ra.get(ra.st()).obj() }
            val state = async { runCatching { ra.get(ra.st("/state")).obj() }.getOrNull() }
            val stats = async { runCatching { ra.get(ra.st("/stats")).obj() }.getOrNull() }
            val current = async { runCatching { ra.get(ra.st("/current_playlist")).obj() }.getOrNull() }
            val api = async { runCatching { ra.get("/server_status").obj() }.getOrNull() }
            val song = async { if (slug.isNotBlank()) ra.public("/station/$slug/current_song").obj() else null }
            val last = async { if (slug.isNotBlank()) ra.public("/station/$slug/last_songs").arr() else null }
            listOf(info, state, stats, current, api, song, last).map { it.await() }
        }
        val info = r[0] as? JsonObject
        val state = r[1] as? JsonObject
        val stats = r[2] as? JsonObject
        val current = r[3] as? JsonObject
        val api = r[4] as? JsonObject
        val song = r[5] as? JsonObject
        val last = r[6] as? JsonArray
        fun who(o: JsonObject) = "${o["artist"].obj()?.s("name") ?: o["artist"].str() ?: ""} – ${o.s("title")}".trim(' ', '–')
        _ui.update {
            it.copy(
                overview = RaOverview(
                    name = info?.s("display_name")?.ifBlank { null } ?: info?.s("name").orEmpty(),
                    description = info?.s("description").orEmpty(), format = info?.s("format").orEmpty(),
                    genres = info?.get("genres").arr()?.joinToString(", ") { g -> g.str().orEmpty() }.orEmpty(),
                    active = state?.get("active").bool(),
                    nowTitle = song?.let(::who), listeners = stats?.get("listeners_now").lng(), position = stats?.get("position_now").lng(),
                    playlist = current?.get("playlist_info").obj()?.s("title"), reason = current?.get("playlist_info").obj()?.s("reason"),
                    upcoming = current?.get("tracks").arr()?.take(10)?.mapNotNull { t -> t.obj()?.let { o -> who(o) } }.orEmpty(),
                    last = last?.take(8)?.mapNotNull { t -> t.obj()?.let { o -> who(o) } }.orEmpty(),
                    apiRunning = api?.get("running").bool(),
                ),
                stationActive = state?.get("active").bool(),
            )
        }
    }

    fun activateStation() = op("Station aktiviert") {
        ra.post(ra.st("/state"))
        loadOverviewInline()
    }

    private suspend fun loadOverviewInline() {
        val state = runCatching { ra.get(ra.st("/state")).obj() }.getOrNull()
        _ui.update { it.copy(stationActive = state?.get("active").bool(), overview = it.overview?.copy(active = state?.get("active").bool())) }
    }

    // ---------- Playlists ----------

    private fun parsePlaylist(o: JsonObject) = RaPlaylist(
        o.l("id"), o.s("title"), o.s("color"), (o["size"].lng() ?: 0).toInt(), o["duration"].lng() ?: 0, o.s("description"), o["shuffled"].bool() ?: false,
        o.s("automation_algorithm_name"),
    )

    private fun parseTrack(o: JsonObject) = RaTrack(
        id = o.l("id"),
        artist = o["artist"].obj()?.s("name") ?: o["artist"].str() ?: "",
        title = o.s("title"), genre = o.s("genre"),
        durationSec = o["duration"].lng() ?: o["length"].lng() ?: 0,
        tags = o["tags"].arr()?.mapNotNull { it.str() }.orEmpty(),
        year = o["release_year"].lng()?.toInt(), type = o.s("type").ifBlank { "song" }, private = o["private"].bool() ?: false,
        album = o.s("album"), month = o["release_month"].lng()?.toInt(), day = o["release_day"].lng()?.toInt(), deletable = o["deletable"].bool() ?: o["own"].bool() ?: true,
    )

    private suspend fun fetchPlaylists(): List<RaPlaylist> =
        ra.get(ra.st("/playlists")).obj()?.get("playlists").arr()?.mapNotNull { it.obj()?.let(::parsePlaylist) }.orEmpty()

    fun loadPlaylists() = op { _ui.update { it.copy(playlists = fetchPlaylists()) } }

    fun openPlaylist(p: RaPlaylist?) {
        _ui.update { it.copy(openPlaylist = p, playlistTracks = emptyList(), playlistNext = null) }
        if (p != null) op { reloadPlaylistTracks(p) }
    }

    private suspend fun reloadPlaylistTracks(p: RaPlaylist, page: Int = 1) {
        val o = ra.get(ra.st("/playlists/${p.id}/tracks" + if (page > 1) "?page=$page" else "")).obj()
        val t = o?.get("tracks").arr()?.mapNotNull { it.obj()?.let(::parseTrack) }.orEmpty()
        _ui.update { it.copy(playlistTracks = if (page > 1) (it.playlistTracks + t).distinctBy { x -> x.id } else t, playlistNext = nextPage(o)) }
    }

    /** Nächste Seite der Titel einer langen Playlist. */
    fun morePlaylistTracks() {
        val p = _ui.value.openPlaylist ?: return
        val page = _ui.value.playlistNext ?: return
        op { reloadPlaylistTracks(p, page) }
    }

    fun savePlaylist(existing: RaPlaylist?, title: String, color: String, description: String, shuffled: Boolean) = op(if (existing == null) "Playlist angelegt" else "Playlist gespeichert") {
        val body = buildJsonObject {
            put("title", title.trim()); put("description", description.trim()); put("shuffled", shuffled)
            if (Regex("^#[0-9a-fA-F]{6}$").matches(color)) put("color", color)
        }
        if (existing == null) ra.post(ra.st("/playlists"), body) else ra.patch(ra.st("/playlists/${existing.id}"), body)
        val list = fetchPlaylists()
        _ui.update { st -> st.copy(playlists = list, openPlaylist = existing?.let { e -> list.firstOrNull { it.id == e.id } }) }
    }

    fun deletePlaylist(p: RaPlaylist) = op("Playlist gelöscht") {
        ra.delete(ra.st("/playlists/${p.id}"))
        _ui.update { it.copy(playlists = fetchPlaylists(), openPlaylist = null, playlistTracks = emptyList()) }
    }

    fun removeFromPlaylist(p: RaPlaylist, t: RaTrack) = op("Entfernt") {
        ra.delete(ra.st("/playlists/${p.id}/entries/${t.id}"))
        reloadPlaylistTracks(p)
    }

    fun addToPlaylist(playlistId: Long, t: RaTrack) = op("„${t.title}“ hinzugefügt") {
        ra.post(ra.st("/playlists/$playlistId"), buildJsonObject { put("track_id", t.id) })
    }

    // ---------- Titel ----------

    /** Titel suchen; `more` holt die nächste Seite zur letzten Suche dazu. */
    fun searchTracks(f: RaFilter, more: Boolean = false) = op {
        val page = if (more) (_ui.value.tracksNext ?: return@op) else 1
        val q = trackQuery(f, page)
        val o = ra.get(ra.st("/tracks" + if (q.isEmpty()) "" else "?$q")).obj()
        val t = o?.get("tracks").arr()?.mapNotNull { it.obj()?.let(::parseTrack) }.orEmpty()
        _ui.update { it.copy(tracks = if (more) (it.tracks + t).distinctBy { x -> x.id } else t, tracksSearched = true, tracksNext = nextPage(o), lastFilter = f) }
    }

    fun loadProcessing() = op {
        val (q, inc) = coroutineScope {
            val a = async { runCatching { ra.get(ra.st("/tracks;queued")).obj() }.getOrNull() }
            val b = async { runCatching { ra.get(ra.st("/tracks;incomplete")).obj() }.getOrNull() }
            a.await() to b.await()
        }
        val all = listOfNotNull(q, inc).flatMap { it["tracks"].arr().orEmpty().mapNotNull { x -> x.obj()?.let(::parseTrack) } }
        _ui.update { it.copy(processing = all) }
    }

    fun saveTrack(t: RaTrack, artist: String, title: String, genre: String, album: String, year: String, month: String, day: String, type: String, private: Boolean, refresh: () -> Unit) = op("Titel gespeichert") {
        ra.patch(ra.st("/tracks/${t.id}"), buildJsonObject {
            put("artist", artist); put("title", title); put("genre", genre); put("album", album)
            year.toIntOrNull()?.let { put("release_year", it) } ?: put("release_year", JsonNull)
            month.toIntOrNull()?.takeIf { it in 1..12 }?.let { put("release_month", it) } ?: put("release_month", JsonNull)
            day.toIntOrNull()?.takeIf { it in 1..31 }?.let { put("release_day", it) } ?: put("release_day", JsonNull)
            put("type", type); put("private", private)
        })
        refresh()
    }

    fun deleteTrack(t: RaTrack, refresh: () -> Unit) = op("Titel gelöscht") {
        ra.delete(ra.st("/tracks/${t.id}"))
        refresh()
    }

    fun loadTagSuggestions() = viewModelScope.launch {
        val tags = runCatching { ra.get(ra.st("/tracks/tags")).arr()?.mapNotNull { it.str() } }.getOrNull().orEmpty()
        _ui.update { it.copy(tagSuggestions = tags) }
    }

    fun saveTags(t: RaTrack, tagsText: String, refresh: () -> Unit) = op("Tags gespeichert") {
        val want = tagsText.split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        val add = want - t.tags.toSet()
        val del = t.tags - want.toSet()
        fun arr(l: List<String>) = buildJsonObject { put("tags", buildJsonArray { l.forEach { add(JsonPrimitive(it)) } }) }
        if (add.isNotEmpty()) ra.post(ra.st("/tracks/${t.id}/tags"), arr(add))
        if (del.isNotEmpty()) ra.delete(ra.st("/tracks/${t.id}/tags"), arr(del))
        refresh()
    }

    /** Vorhören: Titel laden und abspielen; zweiter Aufruf für denselben Titel stoppt. */
    fun prelisten(t: RaTrack) {
        if (_ui.value.playingTrack == t.id) return stopPrelisten()
        stopPrelisten()
        op {
            val data = ra.bytes(ra.st("/tracks/${t.id}/prelisten"))
            val f = File(getApplication<Application>().cacheDir, "prelisten.mp3").apply { writeBytes(data) }
            val mp = MediaPlayer()
            mp.setDataSource(f.absolutePath)
            mp.setOnCompletionListener { stopPrelisten() }
            mp.prepare()
            mp.start()
            player = mp
            _ui.update { it.copy(playingTrack = t.id) }
        }
    }

    fun stopPrelisten() {
        runCatching { player?.stop(); player?.release() }
        player = null
        _ui.update { it.copy(playingTrack = null) }
    }

    /** MP3-Dateien hochladen; laut.fm verarbeitet sie danach (siehe „In Verarbeitung“). */
    fun upload(uris: List<Uri>, private: Boolean) = op {
        val cr = getApplication<Application>().contentResolver
        var done = 0
        for (u in uris) {
            val (name, size) = cr.query(u, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) (c.getString(0) ?: "titel.mp3") to (if (c.isNull(1)) -1L else c.getLong(1)) else null
            } ?: ("titel.mp3" to -1L)
            _ui.update { it.copy(message = "Lade hoch: $name (${done + 1}/${uris.size}) …") }
            ra.upload("POST", ra.st("/tracks"), "track", name, "audio/mpeg", size, { cr.openInputStream(u) ?: throw IOException("$name nicht lesbar") }, mapOf("private" to private.toString()))
            done++
        }
        _ui.update { it.copy(message = "$done Datei(en) hochgeladen – laut.fm verarbeitet sie jetzt") }
        loadProcessingInline()
    }

    private suspend fun loadProcessingInline() {
        val q = runCatching { ra.get(ra.st("/tracks;queued")).obj() }.getOrNull()
        val inc = runCatching { ra.get(ra.st("/tracks;incomplete")).obj() }.getOrNull()
        val all = listOfNotNull(q, inc).flatMap { it["tracks"].arr().orEmpty().mapNotNull { x -> x.obj()?.let(::parseTrack) } }
        _ui.update { it.copy(processing = all) }
    }

    // ---------- Sendeplan (Slots: Tag * 24 + Stunde, Montag = 0) ----------

    fun loadSchedule() = op {
        val (sched, pls) = coroutineScope {
            val a = async { ra.get(ra.st("/schedule")) }
            val b = async { fetchPlaylists() }
            a.await() to b.await()
        }
        val s = (sched.arr()?.firstOrNull() ?: sched).obj()
        _ui.update {
            it.copy(
                playlists = pls,
                schedule = RaSchedule(
                    s?.get("base_playlist_id").lng(),
                    s?.get("entries").arr()?.mapNotNull { e -> e.obj()?.let { o -> RaEntry(o.l("playlist_id"), o.l("slot").toInt(), o.l("duration").toInt().coerceAtLeast(1)) } }.orEmpty(),
                ),
            )
        }
    }

    /** Belegt `hours` Stunden ab `slot` mit der Playlist (null = Basis-Playlist) und speichert den Plan. */
    fun setSlots(slot: Int, hours: Int, playlistId: Long?) = op("Sendeplan gespeichert") {
        val s = _ui.value.schedule ?: return@op
        val entries = applySlots(s.entries, slot, hours, playlistId)
        saveSchedule(s.baseId, entries)
    }

    fun setBasePlaylist(id: Long) = op("Basis-Playlist gespeichert") {
        val s = _ui.value.schedule ?: return@op
        saveSchedule(id, s.entries)
    }

    private suspend fun saveSchedule(baseId: Long?, entries: List<RaEntry>) {
        ra.patch(ra.st("/schedule"), buildJsonObject {
            baseId?.let { put("base_playlist_id", it) }
            put("entries", buildJsonArray {
                entries.forEach { e -> add(buildJsonObject { put("playlist_id", e.playlistId); put("slot", e.slot); put("duration", e.duration) }) }
            })
        })
        _ui.update { it.copy(schedule = RaSchedule(baseId, entries)) }
    }

    // ---------- Mehrere Titel auf einmal ----------

    /** Führt `block` je Titel aus und zählt Fehlschläge, statt bei dem ersten abzubrechen. */
    private suspend fun each(ids: Collection<Long>, block: suspend (Long) -> Unit): Int {
        var failed = 0
        for (id in ids) {
            try { block(id) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: IOException) { failed++ } catch (e: RuntimeException) { failed++ }
        }
        return failed
    }

    private fun summary(ok: String, total: Int, failed: Int) = if (failed == 0) "$total $ok" else "${total - failed} von $total $ok, $failed fehlgeschlagen"

    fun bulkTags(ids: Set<Long>, add: List<String>, remove: List<String>, refresh: () -> Unit) = op {
        fun body(l: List<String>) = buildJsonObject { put("tags", buildJsonArray { l.forEach { add(JsonPrimitive(it)) } }) }
        for (chunk in idChunks(ids)) {
            if (add.isNotEmpty()) ra.post(ra.st("/tracks/$chunk/tags"), body(add))
            if (remove.isNotEmpty()) ra.delete(ra.st("/tracks/$chunk/tags"), body(remove))
        }
        _ui.update { it.copy(message = "Tags bei ${ids.size} Titeln geändert") }
        refresh()
    }

    fun bulkToPlaylist(ids: Set<Long>, playlistId: Long) = op {
        val failed = each(ids) { ra.post(ra.st("/playlists/$playlistId"), buildJsonObject { put("track_id", it) }) }
        _ui.update { it.copy(message = summary("Titel zur Playlist hinzugefügt", ids.size, failed)) }
    }

    fun bulkDelete(ids: Set<Long>, refresh: () -> Unit) = op {
        val failed = each(ids) { ra.delete(ra.st("/tracks/$it")) }
        _ui.update { it.copy(message = summary("Titel gelöscht", ids.size, failed)) }
        refresh()
    }

    // ---------- Automation-Algorithmen ----------

    /** Algorithmus nach Namen holen; gibt es ihn noch nicht, beginnt ein neuer. */
    fun loadAlgorithm(name: String) = op {
        val n = name.trim()
        if (!ALGORITHM_NAME.matches(n)) throw IOException(algorithmError(n, "function") ?: "Ungültiger Name")
        val found = try { ra.get("/automation_algorithms/$n").obj() } catch (e: RaException) { if (e.status == 404) null else throw e }
        _ui.update { it.copy(algorithm = RaAlgorithm(n, found?.s("body").orEmpty(), found != null), message = if (found == null) "„$n“ gibt es noch nicht – neuen Algorithmus anlegen" else it.message) }
    }

    fun saveAlgorithm(name: String, body: String) = op("Algorithmus gespeichert") {
        val n = name.trim()
        algorithmError(n, body)?.let { throw IOException(it) }
        val exists = _ui.value.algorithm?.takeIf { it.name == n }?.exists == true
        val json = buildJsonObject { put("body", body.trim()) }
        if (exists) ra.patch("/automation_algorithms/$n", json) else ra.call("PUT", "/automation_algorithms/$n", json)
        _ui.update { it.copy(algorithm = RaAlgorithm(n, body.trim(), true)) }
    }

    fun deleteAlgorithm(name: String) = op("Algorithmus gelöscht") {
        ra.delete("/automation_algorithms/${name.trim()}")
        _ui.update { it.copy(algorithm = null) }
    }

    // ---------- Statistik ----------

    /** Statistik; `dayText` leer = letzte 24 Stunden, sonst ein Tag als JJJJ-MM-TT. */
    fun loadStats(dayText: String? = null) = op {
        val wanted = dayText?.trim()?.takeIf { it.isNotEmpty() }
        if (wanted != null && !validDay(wanted)) throw IOException("Datum bitte als JJJJ-MM-TT eingeben, z. B. 2026-10-03")
        val (s, day) = coroutineScope {
            val a = async { ra.get(ra.st("/stats")).obj() }
            val b = async { runCatching { ra.get(ra.st("/tracks/stats/${wanted ?: "24h"}")).arr() }.getOrNull() }
            a.await() to b.await()
        }
        _ui.update {
            it.copy(
                statsDay = wanted,
                stats = RaStats(
                    s?.get("listeners_now").lng(), s?.get("position_now").lng(),
                    s?.get("switchons_log").obj()?.entries?.map { (k, v) -> k to (v.lng() ?: 0).toInt() }?.sortedBy { p -> p.first }.orEmpty(),
                    day?.mapNotNull { x ->
                        x.obj()?.let { o ->
                            RaPlayed(
                                o.s("started_at"), "${o["artist"].obj()?.s("name") ?: o["artist"].str() ?: ""} – ${o.s("title")}".trim(' ', '–'),
                                (o["listeners"].lng() ?: 0).toInt(), o["live"].bool() ?: false, o.s("type"),
                            )
                        }
                    }.orEmpty(),
                    s?.get("tlh_log").obj()?.entries?.map { (k, v) -> k to (v.lng() ?: 0).toInt() }?.sortedBy { p -> p.first }.orEmpty(),
                ),
            )
        }
    }

    // ---------- Benutzer ----------

    private suspend fun fetchUsers(): List<RaUser> = ra.get(ra.st("/users")).obj()?.get("users").arr()?.mapNotNull { it.obj() }?.map {
        RaUser(it.l("id"), "${it.s("name")} ${it.s("surname")}".trim(), it.s("email"), it.s("role"))
    }.orEmpty()

    fun loadUsers() = op { _ui.update { it.copy(users = fetchUsers()) } }

    fun setRole(u: RaUser, role: String) = op("Rolle geändert") {
        ra.patch(ra.st("/users/${u.id}"), buildJsonObject { put("role", role) })
        _ui.update { it.copy(users = fetchUsers()) }
    }

    fun removeUser(u: RaUser) = op("Benutzer entfernt") {
        ra.delete(ra.st("/users/${u.id}"))
        _ui.update { it.copy(users = fetchUsers()) }
    }

    fun invite(email: String, role: String) = op("Einladung versendet") {
        ra.post(ra.st("/users"), buildJsonObject { put("email", email.trim()); put("role", role) })
        _ui.update { it.copy(users = fetchUsers()) }
    }

    // ---------- Station ----------

    fun loadStation() = op {
        val (s, state) = coroutineScope {
            val a = async { ra.get(ra.st()).obj() }
            val b = async { runCatching { ra.get(ra.st("/state")).obj() }.getOrNull() }
            a.await() to b.await()
        }
        _ui.update { it.copy(station = s, stationActive = state?.get("active").bool()) }
    }

    fun saveStation(values: Map<String, String>, genres: String) = op("Station gespeichert") {
        val cur = _ui.value.station
        val body = buildJsonObject {
            values.forEach { (k, v) -> if (v != cur?.s(k).orEmpty()) put(k, v) }
            val g = genres.split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(3)
            if (g != cur?.get("genres").arr()?.mapNotNull { it.str() }.orEmpty()) put("genres", buildJsonArray { g.forEach { add(JsonPrimitive(it)) } })
        }
        if (body.isEmpty()) { _ui.update { it.copy(message = "Keine Änderungen") }; return@op }
        ra.patch(ra.st(), body)
        _ui.update { it.copy(station = ra.get(ra.st()).obj()) }
    }

    /** Stationsbild hochladen: `type` ist logo, background oder website. */
    fun uploadImage(type: String, uri: Uri) = op("Bild hochgeladen") {
        require(type in IMAGE_TYPES) { "Unbekannter Bildtyp" }
        val cr = getApplication<Application>().contentResolver
        val mime = cr.getType(uri) ?: "image/png"
        val size = cr.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
        ra.upload("PUT", ra.st("/images/$type"), "image", "$type." + mime.substringAfter('/', "png"), mime, size, { cr.openInputStream(uri) ?: throw IOException("Bild nicht lesbar") })
        _ui.update { it.copy(station = ra.get(ra.st()).obj()) }
    }

    // ---------- Live-Zugang ----------

    fun loadLive() = op {
        val o = ra.get(ra.st("/live")).obj()
        var pw = o?.s("password").orEmpty()
        if (pw.isBlank()) pw = runCatching { ra.get(ra.st("/live/password")).str() }.getOrNull().orEmpty()
        _ui.update {
            it.copy(
                live = o?.let { x ->
                    RaLive(
                        x.s("server"), (x["port"].lng() ?: 0).toInt(), x.s("mountpoint"), x.s("user"),
                        "${x.s("format")} ${x["bitrate"].lng() ?: ""} kbit/s ${x["samplerate"].lng() ?: ""} Hz".trim(), pw, x["active"].bool() ?: false,
                    )
                },
            )
        }
    }

    override fun onCleared() {
        stopPrelisten()
        super.onCleared()
    }
}
