// GO LIVE Sender: laut.fm-Anbindung (Anmelden, Station wählen, Zugangsdaten automatisch) und manueller Encoder.
package app.anmachacast.studio.golive

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import app.anmachacast.engine.android.EngineHub
import app.anmachacast.studio.live.LautFmClient
import app.anmachacast.studio.ui.theme.*

@Composable
fun SetupScreen(vm: GoLiveViewModel) {
    val ui by vm.ui.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        LautFmPanel(ui, vm)
        EncoderPanel(ui, vm)
    }
}

@Composable
private fun LautFmPanel(ui: GoLiveUiState, vm: GoLiveViewModel) {
    val l = ui.lautfm
    var pasteOpen by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    Panel(title = "laut.fm") {
        if (l.account == null) {
            Note("Melde dich bei laut.fm an. Danach werden deine Stationen und die Sende-Zugangsdaten automatisch übernommen.")
            Button(onClick = vm::openLautFmLogin, enabled = !l.busy, modifier = Modifier.fillMaxWidth()) {
                if (l.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else { Icon(Icons.Filled.Login, null); Spacer(Modifier.width(8.dp)); Text("Bei laut.fm anmelden") }
            }
            TextButton(onClick = { pasteOpen = !pasteOpen }) { Text("Stattdessen Token einfügen") }
            if (pasteOpen) {
                val uri = androidx.compose.ui.platform.LocalUriHandler.current
                Note("Token im Browser erzeugen, kopieren und hier einfügen.")
                OutlinedButton(onClick = { uri.openUri("https://radioadmin.laut.fm/login?callback_url=airdeck") }, modifier = Modifier.fillMaxWidth()) { Text("Token-Seite im Browser öffnen") }
                OutlinedTextField(value = pasted, onValueChange = { pasted = it }, label = { Text("Radioadmin-Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = { vm.connectLautFm(pasted); pasted = "" }, enabled = pasted.isNotBlank() && !l.busy, modifier = Modifier.fillMaxWidth()) { Text("Prüfen und verbinden") }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CheckCircle, null, tint = BrandGood)
                Spacer(Modifier.width(8.dp))
                Text("Verbunden", color = BrandText, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (l.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                TextButton(onClick = vm::disconnectLautFm) { Text("Trennen") }
            }
            if (l.stations.isEmpty()) Note("Stationen werden geladen …")
            l.stations.forEach { s ->
                val selected = s.id == l.account.stationId
                Surface(
                    onClick = { vm.selectLautFmStation(s) },
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                    color = if (selected) BrandBlue.copy(alpha = 0.16f) else BrandPanelSolid,
                    border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) BrandBlue else BrandLine),
                    enabled = !ui.running,
                ) {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Radio, null, tint = if (selected) BrandBlue else BrandMuted)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.displayName, color = BrandText, fontWeight = FontWeight.Bold)
                            Text("laut.fm/${s.name}", fontSize = 12.sp, color = BrandMuted)
                        }
                        if (selected) Icon(Icons.Filled.Check, null, tint = BrandBlue)
                    }
                }
            }
            if (ui.running) Note("Während der Sendung kann die Station nicht gewechselt werden.")
            else if (l.account.stationId > 0) Note("Zugangsdaten übernommen. Unter „Live“ auf „Sender starten“ tippen.")
        }
        l.message?.let { Note(it, bad = it.contains("nicht") || it.contains("abgelaufen") || it.contains("Keine")) }
    }
}

@Composable
private fun EncoderPanel(ui: GoLiveUiState, vm: GoLiveViewModel) {
    val cfg = ui.config
    var open by remember { mutableStateOf(false) }
    val viaLaut = ui.lautfm.account?.stationId?.let { it > 0 } == true
    Panel(title = "Encoder / Icecast") {
        if (cfg != null && cfg.host.isNotBlank()) {
            Note("${if (cfg.tls) "https" else "http"}://${cfg.host}:${cfg.port}${cfg.mount} · ${cfg.bitrate} kbit/s MP3 · Benutzer ${cfg.user}")
        } else Note("Noch nicht eingerichtet.")
        if (viaLaut) Note("Bei gewählter laut.fm-Station werden diese Werte vor jedem Start automatisch aktualisiert.")
        OutlinedButton(onClick = { open = true }, enabled = !ui.running, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Tune, null); Spacer(Modifier.width(8.dp)); Text("Encoder konfigurieren")
        }
    }
    if (open) EncoderDialog(cfg, onDismiss = { open = false }) { h, p, t, m, u, n, b, pw ->
        vm.saveConfig(h, p, t, m, u, n, b, pw)
        open = false
    }
}

@Composable
private fun EncoderDialog(
    config: EngineHub.ConfigView?,
    onDismiss: () -> Unit,
    onSave: (String, Int, Boolean, String, String, String, Int, String) -> Unit,
) {
    var host by remember { mutableStateOf(config?.host ?: "") }
    var port by remember { mutableStateOf((config?.port ?: 8000).toString()) }
    var tls by remember { mutableStateOf(config?.tls ?: false) }
    var mount by remember { mutableStateOf(config?.mount ?: "/live") }
    var user by remember { mutableStateOf(config?.user ?: "source") }
    var name by remember { mutableStateOf(config?.name ?: "") }
    var bitrate by remember { mutableIntStateOf(config?.bitrate ?: 128) }
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Encoder") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(host, { host = it.trim() }, label = { Text("Server") }, placeholder = { Text("stream.beispiel.de") }, singleLine = true)
                OutlinedTextField(port, { port = it.filter(Char::isDigit) }, label = { Text("Port") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
                Row(Modifier.clickable { tls = !tls }, verticalAlignment = Alignment.CenterVertically) { Checkbox(tls, { tls = it }); Text("Verschlüsselt (TLS)") }
                OutlinedTextField(mount, { mount = it }, label = { Text("Mountpoint") }, singleLine = true)
                OutlinedTextField(user, { user = it }, label = { Text("Benutzer") }, singleLine = true)
                OutlinedTextField(
                    password, { password = it }, label = { Text("Passwort") }, singleLine = true,
                    placeholder = { Text(if (config?.hasPassword == true) "gespeichert – leer lassen" else "") },
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                )
                OutlinedTextField(name, { name = it }, label = { Text("Sendername") }, singleLine = true)
                Text("Qualität", fontSize = 12.sp, color = BrandMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(64, 96, 128, 192, 320).forEach { b ->
                        FilterChip(selected = bitrate == b, onClick = { bitrate = b }, label = { Text("$b") })
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(host, port.toIntOrNull() ?: 8000, tls, mount, user, name, bitrate, password) }) { Text("Speichern") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/**
 * laut.fm-Anmeldung als eigener Bildschirm (kein Dialog: dort funktioniert die Tastatur in der WebView nicht
 * zuverlässig). Das Token wird entweder aus der Rückleit-Adresse oder aus dem angezeigten Seitentext gelesen.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LautFmLoginScreen(onToken: (String) -> Unit, onClose: () -> Unit) {
    var hint by remember { mutableStateOf("Melde dich bei laut.fm an …") }
    var web by remember { mutableStateOf<WebView?>(null) }
    var done by remember { mutableStateOf(false) }
    var loadFailed by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler {
        val w = web
        if (w != null && w.canGoBack()) w.goBack() else onClose()
    }
    Column(Modifier.fillMaxSize().background(BrandBg).systemBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Schließen") }
            Column {
                Text("Bei laut.fm anmelden", fontWeight = FontWeight.Bold, color = BrandText)
                Text(hint, fontSize = 12.sp, color = BrandMuted)
            }
        }
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { c ->
                WebView(c).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    val take = { token: String? ->
                        if (token != null && !done) {
                            done = true
                            hint = "Angemeldet – prüfe Zugang …"
                            onToken(token)
                        }
                        token != null
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                            take(LautFmClient.tokenFromRedirect(request.url.toString()))

                        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                            loadFailed = false
                            if (take(LautFmClient.tokenFromRedirect(url))) view.stopLoading()
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            if (!loadFailed) hint = "Melde dich bei laut.fm an …"
                            // Zeigt laut.fm das Token nach dem Login nur als Text an, lesen wir es von der Seite
                            val path = runCatching { android.net.Uri.parse(url).path }.getOrNull() ?: ""
                            if (url.contains("radioadmin.laut.fm") && path != "/login" && path != "/") {
                                view.evaluateJavascript("(function(){return document.body?document.body.innerText:''})()") { js ->
                                    val text = runCatching { org.json.JSONTokener(js).nextValue() as? String }.getOrNull() ?: ""
                                    take(LautFmClient.tokenFromPageText(text))
                                }
                            }
                        }

                        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                            if (request.isForMainFrame && LautFmClient.tokenFromRedirect(request.url.toString()) == null) {
                                loadFailed = true
                                hint = "Seite nicht erreichbar – Internetverbindung prüfen"
                            }
                        }
                    }
                    web = this
                    // erst nach dem Löschen alter Cookies laden, sonst kann das Löschen die neue Anmeldung treffen
                    android.webkit.CookieManager.getInstance().removeAllCookies { loadUrl(LautFmClient.loginUrl()) }
                }
            },
            onRelease = { it.destroy(); web = null },
        )
    }
}
