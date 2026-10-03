package app.anmachacast.studio.connect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingPayloadTest {
    @Test
    fun `Adresse und Code aus dem QR-Link`() {
        val p = parsePairingPayload("http://192.168.1.20:8750/#pair=123456")
        assertEquals("http://192.168.1.20:8750", p?.serverUrl)
        assertEquals("123456", p?.code)
    }

    @Test
    fun `Schraegstrich vor dem Hash und Leerraum werden toleriert`() {
        val p = parsePairingPayload("  https://radio.example/studio/#pair=000042 \n")
        assertEquals("https://radio.example/studio", p?.serverUrl)
        assertEquals("000042", p?.code)
    }

    @Test
    fun `nur Code ohne Adresse`() {
        val p = parsePairingPayload("#pair=654321")
        assertNull(p?.serverUrl)
        assertEquals("654321", p?.code)
    }

    @Test
    fun `fremde QR-Codes werden abgelehnt`() {
        assertNull(parsePairingPayload("https://example.org/"))
        assertNull(parsePairingPayload("WIFI:S:x;T:WPA;P:y;;"))
        assertNull(parsePairingPayload("http://h/#pair=1234567"))
        assertNull(parsePairingPayload("http://h/#pair=12345"))
    }
}
