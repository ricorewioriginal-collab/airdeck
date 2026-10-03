package app.anmachacast.studio

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.anmachacast.studio.live.LautFmClient
import app.anmachacast.studio.nav.AppNav
import app.anmachacast.studio.ui.theme.AnMaChaCastTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleLink(intent)
        setContent {
            AnMaChaCastTheme {
                AppNav()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    /** Rückkehr von der laut.fm-Anmeldung im Browser: Token aus der Adresse übernehmen. */
    private fun handleLink(intent: Intent?) {
        val token = LautFmClient.tokenFromRedirect(intent?.dataString ?: return) ?: return
        (application as AnMaChaCastApp).lautSession.connect(token)
        intent.data = null // nur einmal auswerten (z. B. nach Drehen des Geräts)
    }
}
