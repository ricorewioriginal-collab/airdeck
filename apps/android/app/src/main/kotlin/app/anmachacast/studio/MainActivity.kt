package app.anmachacast.studio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.anmachacast.studio.nav.AppNav
import app.anmachacast.studio.ui.theme.AnMaChaCastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AnMaChaCastTheme {
                AppNav()
            }
        }
    }
}
