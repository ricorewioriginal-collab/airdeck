// Server / Studio - Übersicht: Verbindung zum AnMaCha-Cast-Server und Abkoppeln.
package app.anmachacast.studio.home

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.anmachacast.studio.connect.ConnectionStatusViewModel
import app.anmachacast.studio.ui.theme.BrandGood

@Composable
fun HomeScreen(
    onOpenStudio: () -> Unit,
    onDisconnect: () -> Unit,
    viewModel: ConnectionStatusViewModel = viewModel(),
) {
    val connection by viewModel.connection.collectAsState()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ElevatedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CheckCircle, null, tint = BrandGood)
                    Spacer(Modifier.width(8.dp))
                    Text("Verbunden", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                }
                Text(connection?.serverUrl ?: "-", color = MaterialTheme.colorScheme.onSurfaceVariant)
                connection?.deviceName?.takeIf { it.isNotBlank() }?.let { Text("Gerät: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        Button(onClick = onOpenStudio, modifier = Modifier.fillMaxWidth()) { Text("Zum Studio") }
        OutlinedButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) { Text("Vom Server trennen") }
    }
}
