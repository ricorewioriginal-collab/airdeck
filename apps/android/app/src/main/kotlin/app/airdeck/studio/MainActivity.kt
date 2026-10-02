package app.airdeck.studio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.airdeck.studio.nav.AppNav
import app.airdeck.studio.ui.theme.AnMaChaCastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as AnMaChaCastApp
        val startConnected = app.connectionRepository.isConnected()
        setContent {
            AnMaChaCastTheme {
                AppNav(startConnected = startConnected)
            }
        }
    }
}
