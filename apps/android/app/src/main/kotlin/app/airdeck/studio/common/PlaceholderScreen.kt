// Ehrlicher Platzhalter statt Fake-UI: Diese Bereiche sind in der nativen App noch nicht angebunden
// (siehe Reform-Auftrag Punkt 49 - nichts vortäuschen, was nicht implementiert ist).
package app.airdeck.studio.common

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Construction
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaceholderScreen(title: String) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }) }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).padding(24.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.Construction, contentDescription = null, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(16.dp))
                Text("$title ist in der nativen App noch nicht verfügbar.", textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Nutze bis dahin das Web-Studio im Browser.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
}
