package app.anmachacast.studio.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// AnMaCha Cast ist durchgehend dunkel gehalten (siehe studio/styles.css); ein Lichtmodus würde die
// Broadcast-Konsolen-Optik verwässern, daher nur ein Farbschema statt hell/dunkel umzuschalten.
private val AnMaChaCastColorScheme = darkColorScheme(
    primary = BrandBlue,
    onPrimary = Color(0xFF00101C),
    secondary = BrandPurple,
    background = BrandBg,
    onBackground = BrandText,
    surface = BrandPanel,
    onSurface = BrandText,
    surfaceVariant = BrandPanelSolid,
    onSurfaceVariant = BrandMuted,
    outline = BrandLine,
    error = BrandBad,
)

@Composable
fun AnMaChaCastTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AnMaChaCastColorScheme,
        typography = AnMaChaCastTypography,
        content = content,
    )
}
