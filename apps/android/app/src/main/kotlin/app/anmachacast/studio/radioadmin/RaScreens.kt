// Seiten des Sender-Admins (laut.fm Radioadmin mobil).
package app.anmachacast.studio.radioadmin

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.golive.Note
import app.anmachacast.studio.golive.Panel
import app.anmachacast.studio.ui.theme.*

// ---------- Übersicht ----------

@Composable
fun RaOverviewScreen(vm: RadioadminViewModel, onGoLive: () -> Unit) {
    val ui by vm.ui.collectAsState()
    RaFrame(vm, onReload = vm::loadOverview) {
        val o = ui.overview
        if (o == null) return@RaFrame
        Panel(title = o.name.ifBlank { "Station" }) {
            Text(o.description.ifBlank { "Keine Beschreibung" }, color = BrandMuted, fontSize = 13.sp)
            KV("Format", o.format); KV("Genres", o.genres)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(if (o.active == true) BrandGood else BrandWarn, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(if (o.active == true) "Streaming-Server aktiv" else if (o.active == false) "Streaming-Server inaktiv" else "Status unbekannt", color = BrandText, fontSize = 14.sp, modifier = Modifier.weight(1f))
                if (o.active == false) Button(onClick = vm::activateStation) { Text("Aktivieren") }
            }
        }
        Panel(title = "Jetzt") {
            KV("Titel", o.nowTitle); KV("Hörer jetzt", o.listeners?.toString()); KV("Playlist", o.playlist); KV("Grund", o.reason)
            Button(onClick = onGoLive, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Podcasts, null); Spacer(Modifier.width(8.dp)); Text("Vom Handy live senden") }
        }
        if (o.upcoming.isNotEmpty()) Panel(title = "Als Nächstes") { o.upcoming.forEach { Text(it, color = BrandText, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
        if (o.last.isNotEmpty()) Panel(title = "Zuletzt gespielt") { o.last.forEach { Text(it, color = BrandMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) } }
        Note("laut.fm-Dienst: " + when (o.apiRunning) { true -> "läuft"; false -> "gestört"; null -> "nicht erreichbar" })
    }
}

// ---------- Programm: Playlists und Titel ----------

@Composable
fun RaProgramScreen(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    // Vorhören endet, sobald der Bereich verlassen wird
    DisposableEffect(Unit) { onDispose { vm.stopPrelisten() } }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab, containerColor = Color.Transparent, contentColor = BrandBlue) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Playlists") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Titel") })
            Tab(selected = tab == 2, onClick = { tab = 2 }, text = { Text("Automation") })
        }
        when (tab) { 0 -> RaPlaylists(vm); 1 -> RaTracks(vm); else -> RaAutomation(vm) }
    }
    if (ui.playingTrack != null) { /* Vorhören läuft: Anzeige in der Titelzeile */ }
}

@Composable
private fun RaPlaylists(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var edit by remember { mutableStateOf<RaPlaylist?>(null) }
    var creating by remember { mutableStateOf(false) }
    var confirmDel by remember { mutableStateOf<RaPlaylist?>(null) }
    val open = ui.openPlaylist
    RaFrame(vm, onReload = { if (open != null) vm.openPlaylist(open) else vm.loadPlaylists() }) {
        if (open == null) {
            Button(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Add, null); Spacer(Modifier.width(8.dp)); Text("Neue Playlist") }
            if (ui.playlists.isEmpty() && !ui.loading) Note("Noch keine Playlists.")
            ui.playlists.forEach { p ->
                Surface(onClick = { vm.openPlaylist(p) }, shape = RoundedCornerShape(14.dp), color = BrandPanel, border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine)) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(14.dp).background(parseColor(p.color), CircleShape))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.title, color = BrandText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${p.size} Titel · ${fmtSec(p.durationSec)}" + (if (p.shuffled) " · gemischt" else "") + (if (p.algorithm.isNotBlank()) " · ${p.algorithm}" else ""), fontSize = 12.sp, color = BrandMuted)
                        }
                        Icon(Icons.Filled.ChevronRight, null, tint = BrandMuted)
                    }
                }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.openPlaylist(null); vm.loadPlaylists() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                Box(Modifier.size(14.dp).background(parseColor(open.color), CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(open.title, color = BrandText, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                IconButton(onClick = { edit = open }) { Icon(Icons.Filled.Edit, "Bearbeiten") }
                IconButton(onClick = { confirmDel = open }) { Icon(Icons.Filled.Delete, "Löschen", tint = BrandBad) }
            }
            if (open.description.isNotBlank()) Note(open.description)
            Note("Titel zu dieser Playlist fügst du unter „Titel“ über das Menü der Titelzeile hinzu.")
            if (ui.playlistTracks.isEmpty() && !ui.loading) Note("Diese Playlist ist leer.")
            ui.playlistTracks.forEach { t ->
                TrackRow(t, playing = ui.playingTrack == t.id, onPlay = { vm.prelisten(t) }, menu = {
                    DropdownMenuItem(text = { Text("Aus Playlist entfernen") }, onClick = { it(); vm.removeFromPlaylist(open, t) })
                })
            }
            if (ui.playlistNext != null) OutlinedButton(onClick = vm::morePlaylistTracks, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) { Text("Mehr laden (${ui.playlistTracks.size} geladen)") }
        }
    }
    if (creating) PlaylistDialog(null, { creating = false }) { t, c, d, s -> creating = false; vm.savePlaylist(null, t, c, d, s) }
    edit?.let { p -> PlaylistDialog(p, { edit = null }) { t, c, d, s -> edit = null; vm.savePlaylist(p, t, c, d, s) } }
    confirmDel?.let { p -> ConfirmDialog("Playlist löschen?", "„${p.title}“ wird bei laut.fm gelöscht. Die Titel bleiben erhalten.", "Löschen", { confirmDel = null }) { vm.deletePlaylist(p) } }
}

@Composable
private fun PlaylistDialog(p: RaPlaylist?, onDismiss: () -> Unit, onOk: (String, String, String, Boolean) -> Unit) {
    var shuffled by remember { mutableStateOf(p?.shuffled ?: true) }
    FormDialog(
        if (p == null) "Neue Playlist" else "Playlist bearbeiten",
        listOf(Triple("title", "Name", p?.title.orEmpty()), Triple("color", "Farbe (z. B. #19c3e6)", p?.color?.ifBlank { null } ?: "#19c3e6"), Triple("desc", "Beschreibung", p?.description.orEmpty())),
        onDismiss = onDismiss, onOk = { v -> if (v["title"].orEmpty().isNotBlank()) onOk(v["title"]!!, v["color"].orEmpty(), v["desc"].orEmpty(), shuffled) },
        extra = {
            Row(Modifier.clickable { shuffled = !shuffled }, verticalAlignment = Alignment.CenterVertically) { Checkbox(shuffled, { shuffled = it }); Text("Gemischt abspielen") }
        },
    )
}

@Composable
private fun TrackRow(t: RaTrack, playing: Boolean, onPlay: () -> Unit, check: Boolean? = null, onCheck: (Boolean) -> Unit = {}, menu: @Composable ColumnScope.(close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Surface(shape = RoundedCornerShape(12.dp), color = BrandPanel, border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine)) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            if (check != null) Checkbox(check, onCheck)
            IconButton(onClick = onPlay) { Icon(if (playing) Icons.Filled.Stop else Icons.Filled.PlayArrow, if (playing) "Stoppen" else "Vorhören", tint = if (playing) BrandBad else BrandBlue) }
            Column(Modifier.weight(1f)) {
                Text(t.title.ifBlank { "Titel ${t.id}" }, color = BrandText, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(t.artist, t.genre, fmtSec(t.durationSec)).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 12.sp, color = BrandMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (t.tags.isNotEmpty()) Text(t.tags.joinToString("  ") { "#$it" }, fontSize = 11.sp, color = BrandBlue, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box {
                IconButton(onClick = { open = true }) { Icon(Icons.Filled.MoreVert, "Mehr") }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) { menu { open = false } }
            }
        }
    }
}

@Composable
private fun NumField(label: String, value: String, modifier: Modifier, onChange: (String) -> Unit) =
    OutlinedTextField(value, { onChange(it.filter(Char::isDigit).take(4)) }, label = { Text(label) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = modifier)

@Composable
private fun RaTracks(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var f by remember { mutableStateOf(ui.lastFilter) }
    var advanced by remember { mutableStateOf(f.active && (f.album.isNotBlank() || f.type.isNotBlank() || f.playlist.isNotBlank() || f.minYear.isNotBlank() || f.maxYear.isNotBlank() || f.minMinutes.isNotBlank() || f.maxMinutes.isNotBlank() || f.privateOnly)) }
    var showProcessing by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<RaTrack?>(null) }
    var tagging by remember { mutableStateOf<RaTrack?>(null) }
    var deleting by remember { mutableStateOf<RaTrack?>(null) }
    var privateUpload by remember { mutableStateOf(false) }
    var selectMode by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(setOf<Long>()) }
    var bulkTags by remember { mutableStateOf(false) }
    var bulkDelete by remember { mutableStateOf(false) }
    var bulkMenu by remember { mutableStateOf(false) }
    val refresh = { selected = emptySet(); if (showProcessing) vm.loadProcessing() else vm.searchTracks(f) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) vm.upload(uris, privateUpload) }
    RaFrame(vm, onReload = { vm.loadPlaylists(); vm.loadTagSuggestions() }) {
        Panel(title = "Titel suchen") {
            OutlinedTextField(f.artist, { f = f.copy(artist = it) }, label = { Text("Interpret") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(f.title, { f = f.copy(title = it) }, label = { Text("Titel") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(f.genre, { f = f.copy(genre = it) }, label = { Text("Genre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (advanced) {
                OutlinedTextField(f.album, { f = f.copy(album = it) }, label = { Text("Album") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(f.playlist, { f = f.copy(playlist = it) }, label = { Text("In Playlist (Name)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NumField("Jahr ab", f.minYear, Modifier.weight(1f)) { f = f.copy(minYear = it) }
                    NumField("Jahr bis", f.maxYear, Modifier.weight(1f)) { f = f.copy(maxYear = it) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NumField("Minuten ab", f.minMinutes, Modifier.weight(1f)) { f = f.copy(minMinutes = it) }
                    NumField("Minuten bis", f.maxMinutes, Modifier.weight(1f)) { f = f.copy(maxMinutes = it) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = f.type == "", onClick = { f = f.copy(type = "") }, label = { Text("Alle Arten") })
                    FilterChip(selected = f.type == "song", onClick = { f = f.copy(type = "song") }, label = { Text("Songs") })
                    FilterChip(selected = f.type == "jingle", onClick = { f = f.copy(type = "jingle") }, label = { Text("Jingles") })
                }
                Row(Modifier.clickable { f = f.copy(privateOnly = !f.privateOnly) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(f.privateOnly, { f = f.copy(privateOnly = it) }); Text("nur private Titel") }
            }
            Row(Modifier.clickable { f = f.copy(own = !f.own) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(f.own, { f = f.copy(own = it) }); Text("nur eigene Titel") }
            Button(onClick = { showProcessing = false; selected = emptySet(); vm.searchTracks(f) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Search, null); Spacer(Modifier.width(8.dp)); Text("Suchen") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Weniger Filter" else "Mehr Filter") }
                if (f.active) TextButton(onClick = { f = RaFilter() }) { Text("Zurücksetzen") }
            }
        }
        Panel(title = "Hochladen") {
            Row(Modifier.clickable { privateUpload = !privateUpload }, verticalAlignment = Alignment.CenterVertically) { Checkbox(privateUpload, { privateUpload = it }); Text("Privat (nicht in der öffentlichen Songdatenbank)") }
            OutlinedButton(onClick = { picker.launch(arrayOf("audio/mpeg", "audio/*")) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Upload, null); Spacer(Modifier.width(8.dp)); Text("MP3 zu laut.fm hochladen") }
            TextButton(onClick = { showProcessing = true; vm.loadProcessing() }) { Text("In Verarbeitung anzeigen") }
        }
        val list = if (showProcessing) ui.processing else ui.tracks
        if (showProcessing && list.isEmpty() && !ui.loading) Note("Nichts in Verarbeitung.")
        if (!showProcessing && ui.tracksSearched && list.isEmpty() && !ui.loading) Note("Keine Titel gefunden.")
        if (list.isNotEmpty() && !showProcessing) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${list.size} Titel" + if (ui.tracksNext != null) " (weitere vorhanden)" else "", color = BrandMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                FilterChip(selected = selectMode, onClick = { selectMode = !selectMode; if (!selectMode) selected = emptySet() }, label = { Text("Auswählen") })
            }
        }
        if (selectMode && selected.isNotEmpty()) {
            Panel(title = "${selected.size} ausgewählt") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box {
                        OutlinedButton(onClick = { bulkMenu = true }, enabled = ui.playlists.isNotEmpty()) { Text("Zur Playlist") }
                        DropdownMenu(expanded = bulkMenu, onDismissRequest = { bulkMenu = false }) {
                            ui.playlists.forEach { p -> DropdownMenuItem(text = { Text(p.title) }, onClick = { bulkMenu = false; vm.bulkToPlaylist(selected, p.id); selected = emptySet() }) }
                        }
                    }
                    OutlinedButton(onClick = { bulkTags = true }) { Text("Tags") }
                    OutlinedButton(onClick = { bulkDelete = true }) { Text("Löschen", color = BrandBad) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { selected = list.map { it.id }.toSet() }) { Text("Alle ${list.size}") }
                    TextButton(onClick = { selected = emptySet() }) { Text("Keine") }
                }
            }
        }
        list.forEach { t ->
            TrackRow(t, playing = ui.playingTrack == t.id, onPlay = { vm.prelisten(t) },
                check = if (selectMode && !showProcessing) t.id in selected else null,
                onCheck = { on -> selected = if (on) selected + t.id else selected - t.id },
                menu = { close ->
                    if (ui.playlists.isNotEmpty()) {
                        Text("Zu Playlist hinzufügen", fontSize = 11.sp, color = BrandMuted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                        ui.playlists.forEach { p -> DropdownMenuItem(text = { Text(p.title) }, onClick = { close(); vm.addToPlaylist(p.id, t) }) }
                        HorizontalDivider()
                    }
                    DropdownMenuItem(text = { Text("Bearbeiten") }, onClick = { close(); editing = t })
                    DropdownMenuItem(text = { Text("Tags") }, onClick = { close(); tagging = t })
                    if (t.deletable) DropdownMenuItem(text = { Text("Löschen", color = BrandBad) }, onClick = { close(); deleting = t })
                })
        }
        if (!showProcessing && ui.tracksNext != null) OutlinedButton(onClick = { vm.searchTracks(ui.lastFilter, more = true) }, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) { Text("Mehr laden") }
    }
    editing?.let { t -> TrackDialog(t, { editing = null }) { a, ti, g, al, y, mo, d, ty, pr -> editing = null; vm.saveTrack(t, a, ti, g, al, y, mo, d, ty, pr) { refresh() } } }
    tagging?.let { t ->
        FormDialog("Tags: ${t.title}", listOf(Triple("tags", "Tags (mit Komma getrennt)", t.tags.joinToString(", "))), onDismiss = { tagging = null }, onOk = { v -> tagging = null; vm.saveTags(t, v["tags"].orEmpty()) { refresh() } },
            extra = { if (ui.tagSuggestions.isNotEmpty()) Note("Vorhanden: " + ui.tagSuggestions.take(30).joinToString(", ")) })
    }
    deleting?.let { t -> ConfirmDialog("Titel löschen?", "„${t.title}“ wird bei laut.fm endgültig gelöscht.", "Löschen", { deleting = null }) { vm.deleteTrack(t) { refresh() } } }
    if (bulkTags) {
        FormDialog(
            "Tags für ${selected.size} Titel", listOf(Triple("add", "Hinzufügen (mit Komma getrennt)", ""), Triple("del", "Entfernen (mit Komma getrennt)", "")),
            onDismiss = { bulkTags = false },
            onOk = { v ->
                bulkTags = false
                fun parse(k: String) = v[k].orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                val add = parse("add"); val del = parse("del")
                if (add.isNotEmpty() || del.isNotEmpty()) vm.bulkTags(selected, add, del) { refresh() }
            },
            extra = { if (ui.tagSuggestions.isNotEmpty()) Note("Vorhanden: " + ui.tagSuggestions.take(30).joinToString(", ")) },
        )
    }
    if (bulkDelete) ConfirmDialog("${selected.size} Titel löschen?", "Eigene Titel werden bei laut.fm endgültig gelöscht; fremde lassen sich nicht löschen und werden übersprungen.", "Löschen", { bulkDelete = false }) { bulkDelete = false; vm.bulkDelete(selected) { refresh() } }
}

@Composable
private fun TrackDialog(t: RaTrack, onDismiss: () -> Unit, onOk: (String, String, String, String, String, String, String, String, Boolean) -> Unit) {
    var type by remember { mutableStateOf(t.type) }
    var priv by remember { mutableStateOf(t.private) }
    FormDialog(
        "Titel bearbeiten",
        listOf(
            Triple("artist", "Interpret", t.artist), Triple("title", "Titel", t.title), Triple("genre", "Genre", t.genre), Triple("album", "Album", t.album),
            Triple("year", "Jahr", t.year?.toString().orEmpty()), Triple("month", "Monat (1–12)", t.month?.toString().orEmpty()), Triple("day", "Tag (1–31)", t.day?.toString().orEmpty()),
        ),
        onDismiss = onDismiss,
        onOk = { v -> onOk(v["artist"].orEmpty(), v["title"].orEmpty(), v["genre"].orEmpty(), v["album"].orEmpty(), v["year"].orEmpty(), v["month"].orEmpty(), v["day"].orEmpty(), type, priv) },
        extra = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = type == "song", onClick = { type = "song" }, label = { Text("Song") })
                FilterChip(selected = type == "jingle", onClick = { type = "jingle" }, label = { Text("Jingle") })
            }
            Row(Modifier.clickable { priv = !priv }, verticalAlignment = Alignment.CenterVertically) { Checkbox(priv, { priv = it }); Text("Privat") }
        },
    )
}

// ---------- Automation-Algorithmen ----------

@Composable
private fun RaAutomation(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var name by remember { mutableStateOf(ui.algorithm?.name.orEmpty()) }
    var body by remember(ui.algorithm) { mutableStateOf(ui.algorithm?.body.orEmpty()) }
    var confirmDel by remember { mutableStateOf(false) }
    RaFrame(vm, onReload = { vm.loadPlaylists() }) {
        Panel(title = "Automation-Algorithmen") {
            Note("Ein Algorithmus ist eine kleine JavaScript-Funktion: Sie bekommt die Titelliste einer Playlist (tracks) und gibt sie in neuer Reihenfolge zurück. Er gilt für den ganzen laut.fm-Account.")
            OutlinedTextField(name, { name = it.filter { c -> c.isLetterOrDigit() || c == '-' || c == '_' }.take(64) }, label = { Text("Name des Algorithmus") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = { vm.loadAlgorithm(name) }, enabled = name.isNotBlank() && !ui.loading, modifier = Modifier.fillMaxWidth()) { Text("Laden oder neu anlegen") }
        }
        ui.algorithm?.let { a ->
            Panel(title = a.name + if (a.exists) "" else " (neu)") {
                Text("Vorlage einsetzen", fontSize = 12.sp, color = BrandMuted)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ALGORITHM_TEMPLATES.forEach { (label, code) -> AssistChip(onClick = { body = code }, label = { Text(label) }) }
                }
                OutlinedTextField(body, { body = it }, label = { Text("JavaScript") }, minLines = 6, textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp), modifier = Modifier.fillMaxWidth())
                Button(onClick = { vm.saveAlgorithm(a.name, body) }, enabled = !ui.loading, modifier = Modifier.fillMaxWidth()) { Text("Speichern") }
                if (a.exists) TextButton(onClick = { confirmDel = true }) { Text("Löschen", color = BrandBad) }
            }
        }
        val used = ui.playlists.filter { it.algorithm.isNotBlank() }
        if (used.isNotEmpty()) Panel(title = "In Playlists verwendet") {
            used.forEach { p -> Row { Text(p.title, color = BrandText, fontSize = 13.sp, modifier = Modifier.weight(1f)); Text(p.algorithm, color = BrandMuted, fontSize = 13.sp) } }
        }
        Note("Welche Playlist welchen Algorithmus nutzt, legt laut.fm fest; die API beschreibt das Zuweisen nicht. Zugewiesene Algorithmen erscheinen hier.")
    }
    if (confirmDel) ConfirmDialog("Algorithmus löschen?", "„${ui.algorithm?.name.orEmpty()}“ wird bei laut.fm gelöscht.", "Löschen", { confirmDel = false }) { confirmDel = false; ui.algorithm?.let { vm.deleteAlgorithm(it.name) } }
}

// ---------- Sendeplan ----------

private val DAYS = listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")

@Composable
fun RaScheduleScreen(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var day by remember { mutableIntStateOf(((java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK) + 5) % 7)) }
    var slot by remember { mutableStateOf<Int?>(null) }
    var baseMenu by remember { mutableStateOf(false) }
    RaFrame(vm, onReload = vm::loadSchedule) {
        val s = ui.schedule ?: return@RaFrame
        val byId = ui.playlists.associateBy { it.id }
        val grid = HashMap<Int, Long>()
        for (e in s.entries) for (i in 0 until e.duration) grid[e.slot + i] = e.playlistId
        Panel(title = "Basis-Playlist") {
            Box {
                OutlinedButton(onClick = { baseMenu = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(byId[s.baseId]?.title ?: "– keine –", modifier = Modifier.weight(1f)); Icon(Icons.Filled.ArrowDropDown, null)
                }
                DropdownMenu(expanded = baseMenu, onDismissRequest = { baseMenu = false }) {
                    ui.playlists.forEach { p -> DropdownMenuItem(text = { Text(p.title) }, onClick = { baseMenu = false; vm.setBasePlaylist(p.id) }) }
                }
            }
            Note("Läuft, wenn im Sendeplan nichts anderes steht.")
        }
        ScrollableTabRow(selectedTabIndex = day, containerColor = Color.Transparent, contentColor = BrandBlue, edgePadding = 0.dp) {
            DAYS.forEachIndexed { i, d -> Tab(selected = day == i, onClick = { day = i }, text = { Text(d) }) }
        }
        for (hour in 0 until 24) {
            val sl = day * 24 + hour
            val p = byId[grid[sl]]
            val c = parseColor(p?.color.orEmpty(), BrandLine)
            Surface(onClick = { slot = sl }, shape = RoundedCornerShape(10.dp), color = if (p != null) c.copy(alpha = 0.18f) else BrandPanel, border = androidx.compose.foundation.BorderStroke(1.dp, if (p != null) c else BrandLine)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("%02d:00".format(hour), color = BrandMuted, fontSize = 13.sp, modifier = Modifier.width(54.dp))
                    Text(p?.title ?: (byId[s.baseId]?.title?.let { "Basis: $it" } ?: "–"), color = if (p != null) BrandText else BrandMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    slot?.let { sl ->
        var hours by remember(sl) { mutableStateOf("1") }
        AlertDialog(
            onDismissRequest = { slot = null },
            title = { Text("${DAYS[sl / 24]} %02d:00".format(sl % 24)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(hours, { hours = it.filter(Char::isDigit) }, label = { Text("Für wie viele Stunden") }, singleLine = true)
                    Text("Playlist wählen", fontSize = 12.sp, color = BrandMuted)
                    TextButton(onClick = { slot = null; vm.setSlots(sl, hours.toIntOrNull() ?: 1, null) }) { Text("– Basis-Playlist –") }
                    ui.playlists.filter { it.id != ui.schedule?.baseId }.forEach { p ->
                        TextButton(onClick = { slot = null; vm.setSlots(sl, hours.toIntOrNull() ?: 1, p.id) }) {
                            Box(Modifier.size(12.dp).clip(CircleShape).background(parseColor(p.color))); Spacer(Modifier.width(8.dp)); Text(p.title)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { slot = null }) { Text("Abbrechen") } },
        )
    }
}

// ---------- Statistik ----------

@Composable
fun RaStatsScreen(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var adsOnly by remember { mutableStateOf(false) }
    var day by remember(ui.statsDay) { mutableStateOf(ui.statsDay.orEmpty()) }
    RaFrame(vm, onReload = { vm.loadStats(ui.statsDay) }) {
        val s = ui.stats ?: return@RaFrame
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Hörer jetzt", s.listenersNow?.toString() ?: "–", Modifier.weight(1f))
            StatTile("Position", s.position?.toString() ?: "–", Modifier.weight(1f))
        }
        if (s.log.isNotEmpty()) Panel(title = "Einschaltungen pro Tag") { BarChart(s.log, "") }
        if (s.hours.isNotEmpty()) Panel(title = "Hörstunden pro Tag") { BarChart(s.hours, " h") }
        Panel(title = "Tag wählen") {
            OutlinedTextField(day, { day = it.filter { c -> c.isDigit() || c == '-' }.take(10) }, label = { Text("Datum (JJJJ-MM-TT)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.loadStats(day) }, enabled = day.isNotBlank() && !ui.loading) { Text("Anzeigen") }
                OutlinedButton(onClick = { day = ""; vm.loadStats(null) }, enabled = ui.statsDay != null && !ui.loading) { Text("Letzte 24 h") }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Gespielte Titel (${ui.statsDay ?: "24 h"})", color = BrandText, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            FilterChip(selected = adsOnly, onClick = { adsOnly = !adsOnly }, label = { Text("Nur Werbung") })
        }
        val isAd = Regex("^(ad|ads|advert|advertisement|commercial|werbung)$", RegexOption.IGNORE_CASE)
        val list = s.played.filter { !adsOnly || isAd.matches(it.type) }
        if (adsOnly) Note("Werbe-Trigger: ${list.size} · Hörer bei Werbung: ${list.sumOf { it.listeners }}")
        if (list.isEmpty()) Note(if (adsOnly) "Keine Werbe-Trigger in diesem Zeitraum." else "Keine Daten.")
        list.take(200).forEach { t ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(t.start.substringAfter('T').take(5), color = BrandMuted, fontSize = 12.sp, modifier = Modifier.width(46.dp))
                Text(t.title, color = BrandText, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (t.live) Text("live", color = BrandBad, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 6.dp))
                Text("${t.listeners}", color = BrandMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun BarChart(log: List<Pair<String, Int>>, unit: String) {
    val max = (log.maxOf { it.second }).coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().height(110.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
        log.takeLast(30).forEach { (_, v) ->
            Box(Modifier.weight(1f).fillMaxHeight((v.toFloat() / max).coerceIn(0.03f, 1f)).clip(RoundedCornerShape(3.dp)).background(BrandBlue))
        }
    }
    Note("${log.last().first.takeLast(5)}: ${log.last().second}$unit  ·  Spitze: $max$unit")
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(16.dp), color = BrandPanel, border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine)) {
        Column(Modifier.padding(14.dp)) {
            Text(value, color = BrandBlue, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            Text(label, color = BrandMuted, fontSize = 12.sp)
        }
    }
}

// ---------- Verwalten: Benutzer, Station, Live ----------

@Composable
fun RaManageScreen(vm: RadioadminViewModel, onGoLive: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab, containerColor = Color.Transparent, contentColor = BrandBlue) {
            listOf("Station", "Benutzer", "Live").forEachIndexed { i, t -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t) }) }
        }
        when (tab) {
            0 -> RaStation(vm)
            1 -> RaUsers(vm)
            else -> RaLiveInfo(vm, onGoLive)
        }
    }
}

private val STATION_FIELDS = listOf(
    "description" to "Beschreibung", "format" to "Format", "djs" to "DJs", "location" to "Ort", "website" to "Website",
    "twitter_name" to "X/Twitter", "facebook_page" to "Facebook", "instagram_name" to "Instagram",
)

@Composable
private fun RaStation(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var imageType by remember { mutableStateOf("logo") }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { u -> if (u != null) vm.uploadImage(imageType, u) }
    RaFrame(vm, onReload = vm::loadStation) {
        val s = ui.station ?: return@RaFrame
        val values = remember(s) { STATION_FIELDS.associate { (k, _) -> k to mutableStateOf(s.s(k)) } }
        var genres by remember(s) { mutableStateOf(s["genres"].arr()?.joinToString(", ") { it.str().orEmpty() }.orEmpty()) }
        Panel(title = "Station ${s.s("name")}") {
            STATION_FIELDS.forEach { (k, label) -> OutlinedTextField(values[k]!!.value, { values[k]!!.value = it }, label = { Text(label) }, modifier = Modifier.fillMaxWidth()) }
            OutlinedTextField(genres, { genres = it }, label = { Text("Genres (max. 3, mit Komma)") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { vm.saveStation(values.mapValues { it.value.value }, genres) }, modifier = Modifier.fillMaxWidth()) { Text("Speichern") }
        }
        Panel(title = "Sender-Status") {
            Text(if (ui.stationActive == true) "Streaming-Server aktiv" else "Streaming-Server inaktiv", color = BrandText)
            if (ui.stationActive != true) Button(onClick = vm::activateStation) { Text("Station aktivieren") }
        }
        Panel(title = "Bilder") {
            Note("JPG oder PNG")
            listOf("logo" to "Logo", "background" to "Hintergrund", "website" to "Website-Bild").forEach { (type, label) ->
                val has = s.s("${type}_image_url").isNotBlank()
                OutlinedButton(onClick = { imageType = type; imagePicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Image, null); Spacer(Modifier.width(8.dp)); Text(if (has) "$label ersetzen" else "$label hochladen")
                }
            }
        }
    }
}

private val ROLES = listOf("owner" to "Inhaber", "editor" to "Editor", "dj" to "DJ")

@Composable
private fun RaUsers(vm: RadioadminViewModel) {
    val ui by vm.ui.collectAsState()
    var inviting by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<RaUser?>(null) }
    RaFrame(vm, onReload = vm::loadUsers) {
        Button(onClick = { inviting = true }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.PersonAdd, null); Spacer(Modifier.width(8.dp)); Text("Benutzer einladen") }
        ui.users.forEach { u ->
            var menu by remember { mutableStateOf(false) }
            Surface(shape = RoundedCornerShape(12.dp), color = BrandPanel, border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine)) {
                Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(u.name.ifBlank { u.email }, color = BrandText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(u.email, color = BrandMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Box {
                        AssistChip(onClick = { menu = true }, label = { Text(ROLES.firstOrNull { it.first == u.role }?.second ?: u.role) })
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            ROLES.forEach { (v, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { menu = false; vm.setRole(u, v) }) }
                        }
                    }
                    IconButton(onClick = { removing = u }) { Icon(Icons.Filled.Close, "Entfernen") }
                }
            }
        }
    }
    if (inviting) {
        var role by remember { mutableStateOf("dj") }
        FormDialog("Benutzer einladen", listOf(Triple("email", "E-Mail", "")), "Einladen", { inviting = false }, { v -> inviting = false; if (v["email"].orEmpty().contains('@')) vm.invite(v["email"]!!, role) }) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { ROLES.forEach { (v, l) -> FilterChip(selected = role == v, onClick = { role = v }, label = { Text(l) }) } }
        }
    }
    removing?.let { u -> ConfirmDialog("Benutzer entfernen?", "${u.name.ifBlank { u.email }} verliert den Zugang zu dieser Station.", "Entfernen", { removing = null }) { vm.removeUser(u) } }
}

@Composable
private fun RaLiveInfo(vm: RadioadminViewModel, onGoLive: () -> Unit) {
    val ui by vm.ui.collectAsState()
    val clip = LocalClipboardManager.current
    var show by remember { mutableStateOf(false) }
    RaFrame(vm, onReload = vm::loadLive) {
        val l = ui.live ?: return@RaFrame
        Panel(title = "Live-Zugang (Encoder)") {
            KV("Server", l.server); KV("Port", l.port.toString()); KV("Mountpoint", l.mount); KV("Benutzer", l.user); KV("Format", l.format)
            KV("Passwort", if (show) l.password else "••••••••"); KV("Status", if (l.active) "live verbunden" else "nicht live")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { show = !show }) { Text(if (show) "Verbergen" else "Anzeigen") }
                OutlinedButton(onClick = { clip.setText(AnnotatedString(l.password)) }) { Icon(Icons.Filled.ContentCopy, null); Spacer(Modifier.width(6.dp)); Text("Passwort kopieren") }
            }
        }
        Panel(title = "Vom Handy senden") {
            Note("Go Live nutzt diese Station automatisch: Zugangsdaten werden vor jedem Start frisch geholt.")
            Button(onClick = onGoLive, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Podcasts, null); Spacer(Modifier.width(8.dp)); Text("Zu Go Live wechseln") }
        }
    }
}
