// Gemeinsame Bausteine der Go-Live-Oberfläche.
package app.anmachacast.studio.golive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.anmachacast.studio.ui.theme.*

@Composable
fun Panel(modifier: Modifier = Modifier, title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = BrandPanel,
        border = androidx.compose.foundation.BorderStroke(1.dp, BrandLine),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = BrandText)
            content()
        }
    }
}

@Composable
fun LevelBar(label: String, db: Float, color: Color = BrandBlue) {
    val n = ((db + 60f) / 60f).coerceIn(0f, 1f)
    val c = if (db > -3f) BrandBad else if (db > -9f) BrandWarn else color
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.width(58.dp), fontSize = 12.sp, color = BrandMuted)
        LinearProgressIndicator(progress = { n }, modifier = Modifier.weight(1f).height(8.dp), color = c, trackColor = BrandPanelSolid, strokeCap = androidx.compose.ui.graphics.StrokeCap.Round)
        Text(if (db <= -89f) "–∞" else "${db.toInt()} dB", modifier = Modifier.width(52.dp), fontSize = 12.sp, color = BrandMuted, textAlign = androidx.compose.ui.text.style.TextAlign.End)
    }
}

@Composable
fun Note(text: String, bad: Boolean = false) {
    Text(text, fontSize = 13.sp, color = if (bad) BrandBad else BrandMuted)
}

fun fmtDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    val h = s / 3600
    val m = (s % 3600) / 60
    val sec = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%02d:%02d".format(m, sec)
}
