package app.anmachacast.studio.radioadmin

import org.junit.Assert.assertEquals
import org.junit.Test

class RaLogicTest {
    @Test
    fun stundenWerdenZuEintraegenZusammengefasst() {
        val a = applySlots(emptyList(), 8, 3, 5L)
        assertEquals(listOf(RaEntry(5, 8, 3)), a)
        // direkt anschließend dieselbe Playlist: ein Eintrag
        assertEquals(listOf(RaEntry(5, 8, 5)), applySlots(a, 11, 2, 5L))
        // andere Playlist mitten drin teilt den Eintrag
        assertEquals(listOf(RaEntry(5, 8, 1), RaEntry(7, 9, 1), RaEntry(5, 10, 1)), applySlots(a, 9, 1, 7L))
    }

    @Test
    fun leerenUndGrenzen() {
        val a = applySlots(emptyList(), 8, 3, 5L)
        assertEquals(listOf(RaEntry(5, 8, 1), RaEntry(5, 10, 1)), applySlots(a, 9, 1, null))
        // über das Wochenende hinaus wird abgeschnitten
        assertEquals(listOf(RaEntry(2, 166, 2)), applySlots(emptyList(), 166, 10, 2L))
    }
}
