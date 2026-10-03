// GO LIVE: vier Decks (A–D) und die Titelliste mit Zuordnung "Titel → Deck", direkt auf der Hauptseite.
package app.anmachacast.studio.golive

import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.ui.theme.*

private val DECK_NAMES = listOf("A", "B", "C", "D")
private val DECK_COLORS = listOf(BrandBlue, BrandGood, BrandWarn, BrandPurple)

@Composable
fun DecksPanel(ui: GoLiveUiState, vm: GoLiveViewModel) {
    Panel(title = "Decks") {
        if (!ui.running) Note("Titel lassen sich schon jetzt laden. Abspielen geht, sobald der Sender läuft.")
        ui.decks.forEachIndexed { i, d -> DeckCard(i, d, ui.running, vm) }
    }
}

@Composable
private fun DeckCard(index: Int, d: DeckUi, running: Boolean, vm: GoLiveViewModel) {
    val color = DECK_COLORS[index]
    val playing = d.state == "playing"
    var seeking by remember { mutableStateOf<Float?>(null) }
    val dur = d.durationMs.coerceAtLeast(0)
    val progress = seeking ?: if (dur > 0) (d.positionMs.toFloat() / dur).coerceIn(0f, 1f) else 0f
    Surface(
        shape = RoundedCornerShape(14.dp), color = BrandPanelSolid,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (playing) color else BrandLine),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(28.dp).background(color.copy(alpha = 0.2f), CircleShape), contentAlignment = Alignment.Center) {
                    Text(DECK_NAMES[index], color = color, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.title ?: "Leer – Titel unten zuordnen", color = if (d.title != null) BrandText else BrandMuted, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        when (d.state) { "playing" -> "spielt"; "paused" -> "pausiert"; "cued" -> "bereit"; else -> "leer" } +
                            if (d.state != "empty") " · ${fmtDuration(d.positionMs)}" + (if (dur > 0) " / ${fmtDuration(dur)}" else "") else "",
                        fontSize = 12.sp, color = if (playing) color else BrandMuted,
                    )
                }
            }
            if (d.state != "empty") {
                Slider(
                    value = progress, onValueChange = { seeking = it },
                    onValueChangeFinished = { seeking?.let { f -> if (dur > 0) vm.seekDeck(index, (f * dur).toLong()) }; seeking = null },
                    enabled = dur > 0, modifier = Modifier.height(28.dp),
                    colors = SliderDefaults.colors(thumbColor = color, activeTrackColor = color),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilledIconButton(
                    onClick = { if (playing) vm.pauseDeck(index) else vm.playDeck(index) },
                    enabled = d.state != "empty" && (running || playing),
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color(0xFF00101C)),
                ) { Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pause" else "Abspielen") }
                IconButton(onClick = { vm.stopDeck(index) }, enabled = d.state != "empty") { Icon(Icons.Filled.Stop, "Stopp") }
                IconButton(onClick = { vm.ejectDeck(index) }, enabled = d.state != "empty") { Icon(Icons.Filled.Eject, "Auswerfen") }
                Icon(Icons.AutoMirrored.Filled.VolumeUp, null, tint = BrandMuted, modifier = Modifier.padding(start = 6.dp).size(18.dp))
                Slider(value = d.volume.coerceAtMost(1.5f), onValueChange = { vm.setDeckVolume(index, it) }, valueRange = 0f..1.5f, modifier = Modifier.weight(1f).height(28.dp))
            }
            if (playing) LevelBar("Pegel", d.levelDb, color)
        }
    }
}

/** Dateien- und Ordner-Auswahl; legt Titel in die Bibliothek (mehrere auf einmal). */
@Composable
fun AddTracksRow(vm: GoLiveViewModel) {
    val ctx = LocalContext.current
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val titles = uris.map { u ->
            runCatching { ctx.contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            runCatching {
                ctx.contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0).substringBeforeLast('.') else null }
            }.getOrNull() ?: u.lastPathSegment.orEmpty()
        }
        vm.addTracks(uris, titles)
    }
    val folder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree -> if (tree != null) vm.addFolder(tree) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { files.launch(arrayOf("audio/*")) }, modifier = Modifier.weight(1f)) { Icon(Icons.Filled.AudioFile, null); Spacer(Modifier.width(6.dp)); Text("Dateien") }
        OutlinedButton(onClick = { folder.launch(null) }, modifier = Modifier.weight(1f)) { Icon(Icons.Filled.FolderOpen, null); Spacer(Modifier.width(6.dp)); Text("Ordner") }
    }
}

/**
 * Titelliste als Teil einer LazyColumn: nur sichtbare Zeilen werden aufgebaut, auch bei 1000 importierten Titeln.
 * Die Zeilen bekommen nur die Deck-Daten, nicht den ganzen Zustand.
 */
fun androidx.compose.foundation.lazy.LazyListScope.libraryItems(ui: GoLiveUiState, vm: GoLiveViewModel, title: String = "Titel") {
    item(key = "lib-head") {
        Panel(title = "$title (${ui.playlist.size})") {
            AddTracksRow(vm)
            ui.notice?.let { Note(it) }
            if (ui.playlist.isEmpty()) Note("Noch keine Titel. Wähle mehrere Dateien oder einen ganzen Ordner.")
        }
    }
    items(ui.playlist.size, key = { "lib-$it" }) { i -> LibraryRow(i, ui.playlist[i], ui.decks, ui.running, vm) }
    if (ui.playlist.isNotEmpty()) item(key = "lib-clear") { TextButton(onClick = vm::clearPlaylist) { Text("Liste leeren") } }
}

@Composable
fun LibraryRow(index: Int, name: String, decks: List<DeckUi>, running: Boolean, vm: GoLiveViewModel) {
    var menu by remember { mutableStateOf(false) }
    val onDecks = decks.withIndex().filter { it.value.trackIndex == index }
    Surface(onClick = { menu = true }, shape = RoundedCornerShape(10.dp), color = Color.Transparent) {
        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.MusicNote, null, tint = BrandMuted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(name, color = BrandText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            onDecks.forEach { (d, st) ->
                Box(Modifier.padding(start = 4.dp).size(22.dp).background(DECK_COLORS[d].copy(alpha = if (st.state == "playing") 0.9f else 0.25f), CircleShape), contentAlignment = Alignment.Center) {
                    Text(DECK_NAMES[d], fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (st.state == "playing") Color(0xFF00101C) else DECK_COLORS[d])
                }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Zuordnen") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    Text("In Deck laden", fontSize = 11.sp, color = BrandMuted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                    DECK_NAMES.forEachIndexed { d, n ->
                        DropdownMenuItem(
                            text = { Text("Deck $n" + (decks[d].title?.let { " (belegt)" } ?: "")) },
                            leadingIcon = { Box(Modifier.size(10.dp).background(DECK_COLORS[d], CircleShape)) },
                            onClick = { menu = false; vm.loadDeck(d, index) },
                        )
                    }
                    HorizontalDivider()
                    Text("Laden und starten", fontSize = 11.sp, color = BrandMuted, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                    DECK_NAMES.forEachIndexed { d, n ->
                        DropdownMenuItem(text = { Text("Deck $n starten") }, enabled = running, leadingIcon = { Icon(Icons.Filled.PlayArrow, null) }, onClick = { menu = false; vm.loadAndPlay(d, index) })
                    }
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text("Aus Liste entfernen", color = BrandBad) }, onClick = { menu = false; vm.removeTrack(index) })
                }
            }
        }
    }
}
