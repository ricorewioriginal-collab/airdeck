// Inhalt des Kopplungs-QR-Codes, den Studio, Server und Windows-App anzeigen: "<Server-Adresse>/#pair=<6 Ziffern>".
// Eigene, reine Funktion (ohne Android-Klassen), damit sie als Unit-Test geprüft werden kann.
package app.anmachacast.studio.connect

data class PairingPayload(val serverUrl: String?, val code: String)

private val CODE = Regex("[#&]pair=(\\d{6})(?!\\d)")
private val SERVER = Regex("^(https?://[^#\\s]+?)/?#")

/** Zerlegt den gescannten Text; null, wenn er kein AnMaCha-Cast-Kopplungscode ist. */
fun parsePairingPayload(raw: String): PairingPayload? {
    val text = raw.trim()
    val code = CODE.find(text)?.groupValues?.get(1) ?: return null
    val server = SERVER.find(text)?.groupValues?.get(1)
    return PairingPayload(server, code)
}
