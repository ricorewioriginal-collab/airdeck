// Sammelstelle für die Bereiche, die laut Reform-Auftrag vorgesehen, aber in diesem Schritt noch
// nicht nativ angebunden sind (MusicHub, Cardwall, Playlists) - ehrlich als "noch nicht verfügbar"
// gekennzeichnet statt mit Fake-Inhalten gefüllt.
package app.airdeck.studio.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

private data class MoreEntry(val title: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val entries = listOf(
    MoreEntry("MusicHub", Icons.Filled.LibraryMusic),
    MoreEntry("Cardwall", Icons.Filled.ViewModule),
    MoreEntry("Playlisten", Icons.Filled.QueueMusic),
    MoreEntry("Podcasts", Icons.Filled.Podcasts),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen(onOpenPlaceholder: (String) -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("Mehr") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            items(entries) { entry ->
                ListItem(
                    headlineContent = { Text(entry.title) },
                    leadingContent = { Icon(entry.icon, contentDescription = null) },
                    modifier = Modifier.clickable { onOpenPlaceholder(entry.title) },
                )
            }
        }
    }
}
