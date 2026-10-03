package app.anmachacast.studio.connect

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.SettingsInputAntenna
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.activity.compose.rememberLauncherForActivityResult
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@Composable
fun ConnectScreen(viewModel: ConnectViewModel = viewModel(), onConnected: () -> Unit) {
    val ui by viewModel.ui.collectAsState()

    LaunchedEffect(ui.connected) {
        if (ui.connected) onConnected()
    }

    // QR-Scanner (ZXing, ohne Google-Dienste); die Kameraerlaubnis fragt der Scanner selbst ab
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(viewModel::onScanned)
    }
    val startScan = {
        scanner.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("QR-Code des Servers oder der Windows-App scannen")
                .setBeepEnabled(false)
                .setOrientationLocked(true),
        )
    }

    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Filled.SettingsInputAntenna, contentDescription = null, modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(16.dp))
            Text("Mit AnMaCha Cast koppeln", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "QR-Code scannen (im Studio unter „Gerät koppeln“ oder in der Windows-App unter „Server & Geräte“ erzeugt) oder Adresse und Code eintippen.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { startScan() },
                enabled = !ui.loading,
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) {
                Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Per QR-Code koppeln")
            }
            Spacer(Modifier.height(20.dp))
            Text("oder manuell", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = ui.serverUrl,
                onValueChange = viewModel::setServerUrl,
                label = { Text("Server-Adresse") },
                placeholder = { Text("https://dein-server:8750") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = ui.code,
                onValueChange = viewModel::setCode,
                label = { Text("Kopplungscode (6 Ziffern)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = ui.deviceName,
                onValueChange = viewModel::setDeviceName,
                label = { Text("Gerätename") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            ui.error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = viewModel::pair,
                enabled = !ui.loading,
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (ui.loading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Koppeln")
                }
            }

        }
    }
}
