// Startbildschirm: Logo und zwei Betriebsarten zur Wahl. Danach bleibt der Umschalter oben in der App.
package app.anmachacast.studio.start

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.SettingsInputAntenna
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.R
import app.anmachacast.studio.nav.Mode
import app.anmachacast.studio.ui.theme.*

@Composable
fun StartScreen(last: Mode?, connectedTo: String?, onPick: (Mode) -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val pulse = rememberInfiniteTransition(label = "pulse")
    val glow by pulse.animateFloat(0.55f, 1f, infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "glow")

    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(BrandBg, Color(0xFF061B33), BrandBg))),
    ) {
        Column(
            Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(150.dp)) {
                Box(Modifier.size(150.dp).scale(0.8f + glow * 0.2f).alpha(0.35f * glow).background(Brush.radialGradient(listOf(BrandBlue, Color.Transparent)), CircleShape))
                Image(painterResource(R.mipmap.ic_launcher_foreground), contentDescription = "AnMaCha Cast", modifier = Modifier.size(120.dp))
            }
            Spacer(Modifier.height(12.dp))
            AnimatedVisibility(shown, enter = fadeIn(tween(600))) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("AnMaCha Cast", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = BrandText)
                    Text("Dein Radio. Überall.", color = BrandBlue, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.height(28.dp))
            AnimatedVisibility(shown, enter = fadeIn(tween(700, 200)) + slideInVertically(tween(700, 200)) { it / 4 }) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    ModeCard(
                        icon = Icons.Filled.Podcasts,
                        title = "Go Live",
                        text = "Mit dem Handy direkt senden: Mikrofon, Push-to-Talk, Musik aus Nextcloud und Sendung zu laut.fm oder Icecast.",
                        last = last == Mode.GOLIVE,
                        accent = BrandBad,
                    ) { onPick(Mode.GOLIVE) }
                    ModeCard(
                        icon = Icons.Filled.SettingsInputAntenna,
                        title = "Server / Studio",
                        text = connectedTo?.let { "Verbunden mit $it – Sender fernsteuern." } ?: "Mit deinem AnMaCha-Cast-Server koppeln und den Sender fernsteuern.",
                        last = last == Mode.STUDIO,
                        accent = BrandBlue,
                    ) { onPick(Mode.STUDIO) }
                    ModeCard(
                        icon = Icons.Filled.Radio,
                        title = "Sender-Admin",
                        text = "Deine laut.fm-Station verwalten: Playlists, Titel, Sendeplan, Statistik und Benutzer – auch wenn nicht dein eigener Icecast sendet.",
                        last = last == Mode.RADIOADMIN,
                        accent = BrandPurple,
                    ) { onPick(Mode.RADIOADMIN) }
                }
            }
            Spacer(Modifier.height(20.dp))
            Text(
                "Du kannst jederzeit oben zwischen den Bereichen wechseln.",
                color = BrandMuted, fontSize = 12.sp, textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ModeCard(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, text: String, last: Boolean, accent: Color, onClick: () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Surface(
        onClick = onClick,
        shape = shape,
        color = BrandPanel,
        modifier = Modifier.fillMaxWidth().border(1.dp, if (last) accent.copy(alpha = 0.8f) else BrandLine, shape),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(accent.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(30.dp))
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = BrandText)
                    if (last) {
                        Spacer(Modifier.width(8.dp))
                        Text("zuletzt", fontSize = 11.sp, color = accent, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(text, fontSize = 13.sp, color = BrandMuted, lineHeight = 18.sp)
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = BrandMuted)
        }
    }
}
