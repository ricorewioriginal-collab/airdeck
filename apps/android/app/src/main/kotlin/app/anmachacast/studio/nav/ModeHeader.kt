// Dauerhafter Kopf mit Umschalter Go Live <-> Server / Studio. Läuft eine Sendung, zeigt er "ON AIR" auch im Studio-Modus.
package app.anmachacast.studio.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.SettingsInputAntenna
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.ui.theme.BrandBad
import app.anmachacast.studio.ui.theme.BrandBlue
import app.anmachacast.studio.ui.theme.BrandLine
import app.anmachacast.studio.ui.theme.BrandPanelSolid

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModeHeader(mode: Mode, onAir: Boolean, onSwitch: (Mode) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("AnMaCha Cast", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                if (onAir && mode != Mode.GOLIVE) {
                    Row(
                        Modifier.clip(RoundedCornerShape(50)).background(BrandBad.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(8.dp).background(BrandBad, CircleShape))
                        Spacer(Modifier.width(6.dp))
                        Text("ON AIR", color = BrandBad, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            // Zwei gleich große Schalter; der aktive leuchtet cyan
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(BrandPanelSolid).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                ModeButton("Go Live", Icons.Filled.Podcasts, mode == Mode.GOLIVE, Modifier.weight(1f)) { onSwitch(Mode.GOLIVE) }
                ModeButton("Server / Studio", Icons.Filled.SettingsInputAntenna, mode == Mode.STUDIO, Modifier.weight(1f)) { onSwitch(Mode.STUDIO) }
            }
        }
    }
}

@Composable
private fun ModeButton(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(11.dp)
    Surface(
        onClick = onClick,
        shape = shape,
        color = if (active) BrandBlue else Color.Transparent,
        contentColor = if (active) Color(0xFF00101C) else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.height(42.dp),
    ) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}
