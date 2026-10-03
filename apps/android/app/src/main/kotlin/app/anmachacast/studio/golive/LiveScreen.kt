// GO LIVE (abgespeckte Sendeversion): Sender starten, Push-to-Talk in Echtzeit, Mikrofonquelle, Pegel.
package app.anmachacast.studio.golive

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.ui.theme.*

@Composable
fun LiveScreen(vm: GoLiveViewModel, onOpenSetup: () -> Unit) {
    val ui by vm.ui.collectAsState()
    var confirmStop by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { vm.refreshPermission() }
    val target = ui.lautfm.account?.takeIf { it.stationId > 0 }?.let { "laut.fm · ${it.stationName}" }
        ?: ui.config?.takeIf { it.host.isNotBlank() }?.let { "${it.host}${it.mount}" }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        OnAirPanel(ui, target)

        if (ui.error != null) {
            Surface(shape = RoundedCornerShape(12.dp), color = BrandBad.copy(alpha = 0.14f)) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(ui.error!!, color = BrandBad, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = vm::clearError) { Text("OK") }
                }
            }
        }

        if (target == null && !ui.running) {
            Panel {
                Text("Noch kein Sendeziel", fontWeight = FontWeight.Bold, color = BrandText)
                Note("Verbinde laut.fm oder trage einen Icecast-Server ein.")
                Button(onClick = onOpenSetup, modifier = Modifier.fillMaxWidth()) { Text("Sender einrichten") }
            }
        } else {
            Button(
                onClick = { if (ui.running) confirmStop = true else vm.start() },
                enabled = !ui.starting,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = if (ui.running) BrandBad else BrandGood, contentColor = Color(0xFF00101C)),
            ) {
                Icon(if (ui.running) Icons.Filled.Stop else Icons.Filled.PlayArrow, null)
                Spacer(Modifier.width(8.dp))
                Text(
                    when {
                        ui.starting -> "Verbinde …"
                        ui.running -> "Sendung beenden"
                        else -> "Sender starten"
                    },
                    fontWeight = FontWeight.Bold, fontSize = 16.sp,
                )
            }
        }

        PttPanel(ui, vm, onAskPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) })
        MicSourcePanel(ui, vm, onAskPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) })
        MixPanel(ui, vm)
        DecksPanel(ui, vm)
        LibraryPanel(ui, vm)
    }

    if (confirmStop) {
        AlertDialog(
            onDismissRequest = { confirmStop = false },
            title = { Text("Sendung beenden?") },
            text = { Text("Die Übertragung wird sofort gestoppt.") },
            confirmButton = { TextButton(onClick = { confirmStop = false; vm.stop() }) { Text("Beenden") } },
            dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun OnAirPanel(ui: GoLiveUiState, target: String?) {
    val now by produceState(System.currentTimeMillis(), ui.running) {
        while (ui.running) {
            value = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }
    val blink = rememberInfiniteTransition(label = "air").animateFloat(0.4f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a").value
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(14.dp).background(if (ui.running) BrandBad.copy(alpha = blink) else BrandMuted, CircleShape))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (ui.running) "ON AIR" else "Offline", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = if (ui.running) BrandBad else BrandText)
                Text(target ?: "Kein Ziel gewählt", fontSize = 13.sp, color = BrandMuted)
            }
            if (ui.running && ui.startedAt > 0) Text(fmtDuration(now - ui.startedAt), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = BrandText)
        }
        if (ui.running) {
            Note("Gesendet: ${"%.1f".format(ui.bytesSent / 1048576f)} MB" + if (ui.dropped > 0) " · Aussetzer: ${ui.dropped}" else "", bad = ui.dropped > 0)
        }
    }
}

/** Großer Push-to-Talk-Knopf. Drücken öffnet das Mikrofon sofort (direkt an die Engine), Loslassen schließt es. */
@Composable
private fun PttPanel(ui: GoLiveUiState, vm: GoLiveViewModel, onAskPermission: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val enabled = ui.running && ui.hasMicPermission && ui.micAvailable
    val active = ui.micOn
    val level = ((ui.micDb + 60f) / 60f).coerceIn(0f, 1f)
    val ring by animateFloatAsState(if (active) 1f + level * 0.35f else 1f, spring(stiffness = Spring.StiffnessMedium), label = "ring")
    val latch = ui.latch
    Panel(title = "Mikrofon") {
        Box(Modifier.fillMaxWidth().height(230.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier.size(190.dp).scale(ring).background(
                    Brush.radialGradient(listOf((if (active) BrandBad else BrandBlue).copy(alpha = if (active) 0.45f else 0.12f), Color.Transparent)), CircleShape,
                ),
            )
            Box(
                Modifier.size(164.dp)
                    .background(
                        Brush.verticalGradient(
                            if (!enabled) listOf(BrandPanelSolid, BrandPanelSolid)
                            else if (active) listOf(Color(0xFFFF8A8A), BrandBad) else listOf(Color(0xFF52CBFF), BrandBlueDark),
                        ),
                        CircleShape,
                    )
                    .pointerInput(enabled, latch) {
                        if (!enabled) return@pointerInput
                        detectTapGestures(
                            onPress = {
                                if (latch) {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    vm.toggleMicLatched()
                                } else {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    vm.pttPress()
                                    try {
                                        tryAwaitRelease()
                                    } finally {
                                        vm.pttRelease()
                                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    }
                                }
                            },
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (active) Icons.Filled.Mic else Icons.Filled.MicOff, null, tint = if (enabled) Color.White else BrandMuted, modifier = Modifier.size(52.dp))
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (!enabled) "Gesperrt" else if (active) "Du bist live" else if (latch) "Antippen" else "Halten zum Sprechen",
                        color = if (enabled) Color.White else BrandMuted, fontWeight = FontWeight.Bold, fontSize = 14.sp, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 12.dp),
                    )
                }
            }
        }
        LevelBar("Mikro", ui.micDb)
        when {
            !ui.hasMicPermission -> Button(onClick = onAskPermission, modifier = Modifier.fillMaxWidth()) { Text("Mikrofon erlauben") }
            !ui.running -> Note("Starte zuerst den Sender, dann ist das Mikrofon freigeschaltet.")
            !ui.micAvailable -> Note("Mikrofon ist nicht verfügbar (von einer anderen App belegt?).", bad = true)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Dauer-Mikrofon", color = BrandText, fontSize = 14.sp)
                Note("Antippen schaltet ein/aus statt Halten")
            }
            Switch(checked = ui.latch, onCheckedChange = vm::setLatch)
        }
    }
}

@Composable
private fun MicSourcePanel(ui: GoLiveUiState, vm: GoLiveViewModel, onAskPermission: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val cfg = ui.config
    val current = ui.micSources.firstOrNull { it.id == cfg?.micDevice }?.label ?: "Automatisch"
    Panel(title = "Mikrofonquelle") {
        Box {
            OutlinedButton(onClick = { if (ui.hasMicPermission) { vm.refreshMicSources(); open = true } else onAskPermission() }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Mic, null)
                Spacer(Modifier.width(8.dp))
                Text(current, modifier = Modifier.weight(1f), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Icon(Icons.Filled.ArrowDropDown, null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                DropdownMenuItem(text = { Text("Automatisch") }, onClick = { open = false; vm.setMicSource(0, cfg?.micRaw ?: false) })
                ui.micSources.forEach { s ->
                    DropdownMenuItem(text = { Text(s.label) }, onClick = { open = false; vm.setMicSource(s.id, cfg?.micRaw ?: false) })
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Rohsignal (ohne Sprachfilter)", color = BrandText, fontSize = 14.sp)
                Note("Für Headset oder externes Mikrofon; schaltet Rauschfilter des Handys ab")
            }
            Switch(checked = cfg?.micRaw ?: false, onCheckedChange = { vm.setMicSource(cfg?.micDevice ?: 0, it) })
        }
    }
}

@Composable
private fun MixPanel(ui: GoLiveUiState, vm: GoLiveViewModel) {
    val cfg = ui.config ?: return
    var mic by remember(cfg.micDb) { mutableFloatStateOf(cfg.micDb) }
    var music by remember(cfg.musicDb) { mutableFloatStateOf(cfg.musicDb) }
    var duck by remember(cfg.duckDb) { mutableFloatStateOf(cfg.duckDb) }
    Panel(title = "Pegel") {
        LevelBar("Musik", ui.musicDb)
        LevelBar("Master", ui.masterDb, BrandGood)
        SliderRow("Mikro", mic, -30f..20f, "%+.0f dB") { mic = it; vm.setLevels(micDb = it) }
        SliderRow("Musik", music, -30f..10f, "%+.0f dB") { music = it; vm.setLevels(musicDb = it) }
        SliderRow("Absenken", duck, -30f..0f, "%.0f dB") { duck = it; vm.setLevels(duckDb = it) }
        Note("„Absenken“ senkt die Musik, solange das Mikrofon offen ist.")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Mithören", color = BrandText, fontSize = 14.sp)
                Note("Nur mit Kopfhörer, sonst Rückkopplung")
            }
            Switch(checked = ui.monitor, onCheckedChange = { vm.toggleMonitor() }, enabled = ui.running)
        }
    }
}

@Composable
private fun SliderRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, fmt: String, onChange: (Float) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.width(76.dp), fontSize = 13.sp, color = BrandMuted)
        Slider(value = value, onValueChange = onChange, valueRange = range, modifier = Modifier.weight(1f))
        Text(fmt.format(value), modifier = Modifier.width(56.dp), fontSize = 12.sp, color = BrandMuted, textAlign = TextAlign.End)
    }
}
