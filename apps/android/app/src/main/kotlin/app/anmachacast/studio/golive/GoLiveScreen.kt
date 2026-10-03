// GO LIVE: das Handy selbst als Sendestudio - Oberfläche über der bestehenden EngineHub/Engine (Java),
// keine neue Audio-Engine. Mikrofonrecht wird hier aktiv angefragt, nicht nur im Manifest deklariert.
package app.anmachacast.studio.golive

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.anmachacast.studio.ui.theme.BrandBad
import app.anmachacast.studio.ui.theme.BrandGood

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GoLiveScreen(viewModel: GoLiveViewModel = viewModel()) {
    val ui by viewModel.ui.collectAsState()
    var showSettings by remember { mutableStateOf(false) }
    var showStopConfirm by remember { mutableStateOf(false) }

    val micPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        viewModel.refreshPermission()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Go Live") },
                actions = {
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Filled.Settings, contentDescription = "Encoder-Einstellungen")
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { OnAirCard(running = ui.running, state = ui.state, error = ui.error) }

            item {
                Button(
                    onClick = {
                        if (ui.running) showStopConfirm = true else viewModel.start(withMic = ui.hasMicPermission)
                    },
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (ui.running) BrandBad else BrandGood,
                    ),
                ) {
                    Icon(if (ui.running) Icons.Filled.Stop else Icons.Filled.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (ui.running) "Sendung beenden" else "Live gehen", fontWeight = FontWeight.Bold)
                }
            }

            item { MicCard(ui = ui, onToggle = viewModel::toggleMic, onRequestPermission = { micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }) }

            item { LevelsCard(ui) }

            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Playlist", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    TextButton(onClick = viewModel::clearPlaylist, enabled = ui.playlist.isNotEmpty()) { Text("Leeren") }
                }
            }
            if (ui.playlist.isEmpty()) {
                item { Text("Noch keine Titel geladen.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                itemsIndexed(ui.playlist) { index, title ->
                    PlaylistRow(
                        title = title,
                        isCurrent = index == ui.currentIndex,
                        onPlay = { viewModel.play(index) },
                        onRemove = { viewModel.removeTrack(index) },
                    )
                }
            }
        }
    }

    if (showSettings) {
        EncoderSettingsDialog(
            config = ui.config,
            onDismiss = { showSettings = false },
            onSave = { host, port, tls, mount, user, name, bitrate, password ->
                viewModel.saveConfig(host, port, tls, mount, user, name, bitrate, password)
                showSettings = false
            },
        )
    }

    if (showStopConfirm) {
        AlertDialog(
            onDismissRequest = { showStopConfirm = false },
            title = { Text("Sendung wirklich beenden?") },
            text = { Text("Die Live-Übertragung wird sofort gestoppt.") },
            confirmButton = {
                TextButton(onClick = { showStopConfirm = false; viewModel.stop() }) { Text("Beenden") }
            },
            dismissButton = {
                TextButton(onClick = { showStopConfirm = false }) { Text("Abbrechen") }
            },
        )
    }
}

@Composable
private fun OnAirCard(running: Boolean, state: String, error: String?) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(14.dp).background(
                    color = if (running) BrandGood else MaterialTheme.colorScheme.onSurfaceVariant,
                    shape = CircleShape,
                )
            )
            Spacer(Modifier.width(12.dp))
            Column {
                Text(if (running) "ON AIR" else "Offline", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text(error ?: state, style = MaterialTheme.typography.bodySmall, color = if (error != null) BrandBad else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun MicCard(ui: GoLiveUiState, onToggle: () -> Unit, onRequestPermission: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (ui.micOn) Icons.Filled.Mic else Icons.Filled.MicOff, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Mikrofon")
            }
            if (!ui.hasMicPermission) {
                TextButton(onClick = onRequestPermission) { Text("Zugriff erlauben") }
            } else {
                Switch(checked = ui.micOn, onCheckedChange = { onToggle() }, enabled = ui.running)
            }
        }
    }
}

@Composable
private fun LevelsCard(ui: GoLiveUiState) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text("Pegel", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            LevelRow("Mic", ui.micDb)
            LevelRow("Musik", ui.musicDb)
            LevelRow("Master", ui.masterDb)
            LevelRow("Peak", ui.peakDb)
        }
    }
}

@Composable
private fun LevelRow(label: String, db: Float) {
    val normalized = ((db + 60f) / 60f).coerceIn(0f, 1f)
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.width(64.dp), style = MaterialTheme.typography.bodySmall)
        LinearProgressIndicator(progress = { normalized }, modifier = Modifier.weight(1f).height(8.dp))
        Spacer(Modifier.width(8.dp))
        Text("${db.toInt()} dB", style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(56.dp))
    }
}

@Composable
private fun PlaylistRow(title: String, isCurrent: Boolean, onPlay: () -> Unit, onRemove: () -> Unit) {
    ListItem(
        headlineContent = { Text(title, fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal) },
        leadingContent = { Icon(if (isCurrent) Icons.Filled.GraphicEq else Icons.Filled.MusicNote, contentDescription = null) },
        trailingContent = {
            Row {
                IconButton(onClick = onPlay) { Icon(Icons.Filled.PlayArrow, contentDescription = "Abspielen") }
                IconButton(onClick = onRemove) { Icon(Icons.Filled.Delete, contentDescription = "Entfernen") }
            }
        },
    )
}

@Composable
private fun EncoderSettingsDialog(
    config: app.anmachacast.engine.android.EngineHub.ConfigView?,
    onDismiss: () -> Unit,
    onSave: (String, Int, Boolean, String, String, String, Int, String) -> Unit,
) {
    var host by remember { mutableStateOf(config?.host ?: "") }
    var port by remember { mutableStateOf(config?.port?.toString() ?: "8000") }
    var tls by remember { mutableStateOf(config?.tls ?: false) }
    var mount by remember { mutableStateOf(config?.mount ?: "/live") }
    var user by remember { mutableStateOf(config?.user ?: "source") }
    var name by remember { mutableStateOf(config?.name ?: "") }
    var bitrate by remember { mutableStateOf(config?.bitrate?.toString() ?: "128") }
    var password by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Encoder-Einstellungen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = host, onValueChange = { host = it }, label = { Text("Icecast-Host") }, singleLine = true)
                OutlinedTextField(value = port, onValueChange = { port = it.filter(Char::isDigit) }, label = { Text("Port") }, singleLine = true)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = tls, onCheckedChange = { tls = it })
                    Text("TLS")
                }
                OutlinedTextField(value = mount, onValueChange = { mount = it }, label = { Text("Mountpoint") }, singleLine = true)
                OutlinedTextField(value = user, onValueChange = { user = it }, label = { Text("Benutzer") }, singleLine = true)
                OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Passwort") }, singleLine = true)
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Sendername") }, singleLine = true)
                OutlinedTextField(value = bitrate, onValueChange = { bitrate = it.filter(Char::isDigit) }, label = { Text("Bitrate (kbps)") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onSave(host, port.toIntOrNull() ?: 8000, tls, mount, user, name, bitrate.toIntOrNull() ?: 128, password)
            }) { Text("Speichern") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}
