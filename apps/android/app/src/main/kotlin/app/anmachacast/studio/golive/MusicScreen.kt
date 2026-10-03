// GO LIVE Musikpool: Playlist, Titel vom Handy und aus der eigenen Nextcloud.
package app.anmachacast.studio.golive

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.live.NcEntry
import app.anmachacast.studio.live.NextcloudClient
import app.anmachacast.studio.ui.theme.*

@Composable
fun MusicScreen(vm: GoLiveViewModel) {
    val ui by vm.ui.collectAsState()
    var tab by remember { mutableIntStateOf(0) }

    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab, containerColor = Color.Transparent, contentColor = BrandBlue) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Playlist (${ui.playlist.size})") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Handy") })
            Tab(selected = tab == 2, onClick = { tab = 2 }, text = { Text("Nextcloud") })
        }
        when (tab) {
            0 -> PlaylistTab(ui, vm)
            1 -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Panel(title = "Titel vom Handy") {
                    Note("Wähle mehrere Audiodateien auf einmal (MP3, AAC, FLAC, OGG, WAV …) oder einen ganzen Ordner. Danach ordnest du sie auf der Live-Seite den Decks zu.")
                    AddTracksRow(vm)
                    ui.notice?.let { Note(it) }
                }
            }
            else -> NextcloudTab(ui, vm)
        }
    }
}

@Composable
private fun PlaylistTab(ui: GoLiveUiState, vm: GoLiveViewModel) {
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "auto") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Deck A spielt automatisch weiter", color = BrandText, fontSize = 14.sp)
                    Note("Nach dem Ende startet der nächste Titel der Liste")
                }
                Switch(checked = ui.autoNext, onCheckedChange = { vm.toggleAutoNext() })
            }
        }
        libraryItems(ui, vm, "Titelliste")
    }
}

@Composable
private fun NextcloudTab(ui: GoLiveUiState, vm: GoLiveViewModel) {
    val nc = ui.nextcloud
    val uri = LocalUriHandler.current
    var server by remember { mutableStateOf("") }
    if (nc.account == null) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Panel(title = "Mit Nextcloud verbinden") {
                Note("Deine Musik aus der eigenen Nextcloud. Die Anmeldung läuft im Browser, die App speichert nur ein App-Passwort.")
                OutlinedTextField(
                    value = server, onValueChange = { server = it }, label = { Text("Nextcloud-Adresse") }, placeholder = { Text("cloud.beispiel.de") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !nc.loading,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri),
                )
                if (nc.loginUrl == null) {
                    Button(onClick = { vm.startNextcloudLogin(server) }, enabled = server.isNotBlank() && !nc.loading, modifier = Modifier.fillMaxWidth()) {
                        if (nc.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Verbinden")
                    }
                } else {
                    Button(onClick = { uri.openUri(nc.loginUrl) }, modifier = Modifier.fillMaxWidth()) { Text("Anmeldung im Browser öffnen") }
                    TextButton(onClick = vm::cancelNextcloudLogin, modifier = Modifier.fillMaxWidth()) { Text("Abbrechen") }
                }
                nc.message?.let { Note(it, bad = !nc.loading && !it.startsWith("Verbunden")) }
            }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = vm::folderUp, enabled = nc.folder.isNotEmpty()) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Ordner hoch") }
            Text("/" + nc.folder, modifier = Modifier.weight(1f), color = BrandText, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            val audio = nc.entries.filter { !it.isDir && NextcloudClient.isAudio(it.name) }
            TextButton(onClick = { vm.addFromNextcloud(audio) }, enabled = audio.isNotEmpty() && nc.adding == null) { Text("Alle (${audio.size})") }
            IconButton(onClick = vm::disconnectNextcloud) { Icon(Icons.Filled.LinkOff, "Trennen") }
        }
        nc.adding?.let { Column(Modifier.padding(horizontal = 16.dp)) { LinearProgressIndicator(Modifier.fillMaxWidth()); Note(it) } }
        nc.message?.let { Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { Note(it) } }
        if (nc.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.fillMaxSize()) {
            items(nc.entries.filter { it.isDir || NextcloudClient.isAudio(it.name) }) { e -> NcRow(e, vm) }
        }
    }
}

@Composable
private fun NcRow(e: NcEntry, vm: GoLiveViewModel) {
    ListItem(
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable { if (e.isDir) vm.openFolder(e.path) else vm.addFromNextcloud(listOf(e)) },
        headlineContent = { Text(e.name, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
        supportingContent = if (e.isDir) null else ({ Text("%.1f MB".format(e.size / 1048576f), fontSize = 12.sp) }),
        leadingContent = { Icon(if (e.isDir) Icons.Filled.Folder else Icons.Filled.MusicNote, null, tint = if (e.isDir) BrandBlue else BrandMuted) },
        trailingContent = { if (!e.isDir) Icon(Icons.Filled.AddCircleOutline, "Zur Playlist") },
    )
}
