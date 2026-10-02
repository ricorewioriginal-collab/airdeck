// Einstiegsbildschirm nach der Kopplung: Moduswahl STUDIO/REMOTE vs. GO LIVE ohne erneute Anmeldung
// (Punkt 2 des Reform-Auftrags) - beide Modi teilen sich dieselbe ConnectionRepository/Session.
package app.airdeck.studio.home

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.SettingsInputAntenna
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.airdeck.studio.connect.ConnectionStatusViewModel

@Composable
fun HomeScreen(
    onOpenStudio: () -> Unit,
    onOpenGoLive: () -> Unit,
    onDisconnect: () -> Unit,
    viewModel: ConnectionStatusViewModel = viewModel(),
) {
    val connection by viewModel.connection.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AnMaCha Cast") },
                actions = {
                    TextButton(onClick = onDisconnect) { Text("Trennen") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "Verbunden mit ${connection?.serverUrl ?: "-"}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            ModeCard(
                icon = Icons.Filled.SettingsInputAntenna,
                title = "Studio / Fernsteuerung",
                description = "Laufenden Sender fernsteuern: Programm, Warteschlange, Quellen übernehmen.",
                onClick = onOpenStudio,
            )
            ModeCard(
                icon = Icons.Filled.Podcasts,
                title = "Go Live",
                description = "Das Handy selbst als Sendestudio: Mikrofon, Playlist, direkter Stream.",
                onClick = onOpenGoLive,
            )
        }
    }
}

@Composable
private fun ModeCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    onClick: () -> Unit,
) {
    ElevatedCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(16.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
