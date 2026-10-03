// Gemeinsamer Rahmen des Sender-Admins: Anmeldung, Stationswahl, Meldungen.
package app.anmachacast.studio.radioadmin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.golive.Note
import app.anmachacast.studio.golive.Panel
import app.anmachacast.studio.ui.theme.*

fun parseColor(hex: String, fallback: Color = BrandMuted): Color =
    if (Regex("^#[0-9a-fA-F]{6}$").matches(hex)) Color(android.graphics.Color.parseColor(hex)) else fallback

fun fmtSec(sec: Long): String {
    val s = sec.coerceAtLeast(0)
    val h = s / 3600
    val m = (s % 3600) / 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s % 60) else "%d:%02d".format(m, s % 60)
}

/**
 * Rahmen für alle Sender-Admin-Seiten. Ohne Anmeldung erscheint die laut.fm-Anmeldung, ohne gewählte Station die Auswahl;
 * sonst Stationsleiste, Meldungen und der Inhalt (wird bei Stationswechsel neu geladen).
 */
@Composable
fun RaFrame(vm: RadioadminViewModel, scroll: Boolean = true, onReload: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val lf by vm.session.state.collectAsState()
    val ui by vm.ui.collectAsState()
    val acc = lf.account
    when {
        acc == null || lf.expired -> RaLogin(vm)
        acc.stationId <= 0 -> RaStationPicker(vm)
        else -> {
            // Stationswechsel: Zustand der alten Station verwerfen, bevor neu geladen wird
            LaunchedEffect(acc.stationId) { vm.enterStation(acc.stationId); onReload() }
            val body = Modifier.fillMaxSize().let { if (scroll) it.verticalScroll(rememberScrollState()) else it }
            Column(body.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StationBar(vm, onReload)
                ui.error?.let { Banner(it, true, vm::clearMessage) }
                ui.message?.let { Banner(it, false, vm::clearMessage) }
                if (ui.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                content()
            }
        }
    }
}

@Composable
private fun Banner(text: String, bad: Boolean, onClose: () -> Unit) {
    val c = if (bad) BrandBad else BrandGood
    Surface(shape = RoundedCornerShape(12.dp), color = c.copy(alpha = 0.14f)) {
        Row(Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, color = c, fontSize = 13.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = onClose) { Text("OK") }
        }
    }
}

@Composable
private fun StationBar(vm: RadioadminViewModel, onReload: () -> Unit) {
    val lf by vm.session.state.collectAsState()
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            Surface(onClick = { if (lf.stations.size > 1) open = true }, shape = RoundedCornerShape(12.dp), color = BrandPanelSolid) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Radio, null, tint = BrandBlue, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(lf.account?.stationName.orEmpty(), color = BrandText, fontWeight = FontWeight.Bold, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    if (lf.stations.size > 1) Icon(Icons.Filled.ArrowDropDown, null, tint = BrandMuted)
                }
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                lf.stations.forEach { s -> DropdownMenuItem(text = { Text(s.displayName) }, onClick = { open = false; vm.selectStation(s) }) }
            }
        }
        IconButton(onClick = onReload) { Icon(Icons.Filled.Refresh, "Aktualisieren") }
    }
}

@Composable
fun RaLogin(vm: RadioadminViewModel) {
    val lf by vm.session.state.collectAsState()
    var pasteOpen by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Panel(title = "Sender-Admin") {
            Text(
                if (lf.expired) "Die Anmeldung bei laut.fm ist abgelaufen." else "Verwalte deine laut.fm-Station vom Handy: Playlists, Titel, Sendeplan, Statistik, Benutzer und mehr.",
                color = BrandText, fontSize = 14.sp,
            )
            Note("Melde dich mit deinem laut.fm-Konto an. Der Zugang bleibt verschlüsselt auf diesem Handy und wird auch von Go Live genutzt.")
            app.anmachacast.studio.golive.LautFmSignIn(lf.busy, vm.session::openLogin)
            TextButton(onClick = { pasteOpen = !pasteOpen }) { Text("Stattdessen Token einfügen") }
            if (pasteOpen) {
                val uri = androidx.compose.ui.platform.LocalUriHandler.current
                OutlinedButton(onClick = { uri.openUri("https://radioadmin.laut.fm/login?callback_url=airdeck") }, modifier = Modifier.fillMaxWidth()) { Text("Token-Seite im Browser öffnen") }
                OutlinedTextField(value = pasted, onValueChange = { pasted = it }, label = { Text("Radioadmin-Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { vm.session.connect(pasted); pasted = "" }, enabled = pasted.isNotBlank() && !lf.busy, modifier = Modifier.fillMaxWidth()) { Text("Prüfen und verbinden") }
            }
            lf.message?.let { Note(it, bad = true) }
        }
    }
}

@Composable
private fun RaStationPicker(vm: RadioadminViewModel) {
    val lf by vm.session.state.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Panel(title = "Station wählen") {
            if (lf.stations.isEmpty()) {
                Note(lf.message ?: "Stationen werden geladen …", bad = lf.message != null)
                OutlinedButton(onClick = vm.session::loadStations, modifier = Modifier.fillMaxWidth()) { Text("Erneut laden") }
            }
            lf.stations.forEach { s ->
                Surface(
                    onClick = { vm.selectStation(s) }, shape = RoundedCornerShape(14.dp), color = BrandPanelSolid,
                    border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine),
                ) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Radio, null, tint = BrandBlue)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(s.displayName, color = BrandText, fontWeight = FontWeight.Bold)
                            Text("laut.fm/${s.name} · ${s.role}", fontSize = 12.sp, color = BrandMuted)
                        }
                    }
                }
            }
            TextButton(onClick = vm.session::disconnect) { Text("Abmelden") }
        }
    }
}

@Composable
fun KV(k: String, v: String?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(k, color = BrandMuted, fontSize = 13.sp, modifier = Modifier.width(112.dp))
        Text(v?.ifBlank { null } ?: "–", color = BrandText, fontSize = 14.sp, modifier = Modifier.weight(1f))
    }
}

/** Einfacher Dialog mit mehreren Textfeldern. */
@Composable
fun FormDialog(title: String, fields: List<Triple<String, String, String>>, confirm: String = "Speichern", onDismiss: () -> Unit, onOk: (Map<String, String>) -> Unit, extra: @Composable ColumnScope.() -> Unit = {}) {
    val state = remember { fields.associate { it.first to mutableStateOf(it.third) } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                fields.forEach { (key, label, _) ->
                    OutlinedTextField(value = state[key]!!.value, onValueChange = { state[key]!!.value = it }, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
                }
                extra()
            }
        },
        confirmButton = { TextButton(onClick = { onOk(state.mapValues { it.value.value }) }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onDismiss: () -> Unit, onOk: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(onClick = { onDismiss(); onOk() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}
