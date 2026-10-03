package app.anmachacast.studio.radioadmin

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test
    fun titelfilterWerdenZurAbfrage() {
        assertEquals("", trackQuery(RaFilter()))
        val f = RaFilter(artist = " Die Ärzte ", genre = "Rock&Pop", own = true, privateOnly = true, minYear = "1990", maxYear = "20", minMinutes = "2", maxMinutes = "x", type = "jingle", playlist = "Früh")
        assertEquals(
            "artist=Die+%C3%84rzte&genre=Rock%26Pop&type=jingle&playlist=Fr%C3%BCh&own=true&private=true&min_release_year=1990&min_duration=120&page=3",
            trackQuery(f, 3),
        )
        assertTrue(RaFilter(album = "x").active)
        assertFalse(RaFilter().active)
    }

    @Test
    fun seitenwechsel() {
        fun o(s: String) = Json.parseToJsonElement(s).jsonObject
        assertEquals(3, nextPage(o("""{"_paging":{"current_page":2,"next_page":3}}""")))
        assertNull(nextPage(o("""{"_paging":{"current_page":3,"next_page":null}}""")))
        assertEquals(2, nextPage(o("""{"_paging":{"current_page":1,"total_pages":4}}""")))
        assertNull(nextPage(o("""{"_paging":{"current_page":4,"total_pages":4}}""")))
        assertNull(nextPage(o("""{"tracks":[]}""")))
        assertNull(nextPage(null))
    }

    @Test
    fun tagesstatistikUndAlgorithmen() {
        assertTrue(validDay("2026-10-03"))
        for (bad in listOf("24h", "2026-13-01", "2026-10-32", "26-10-03", "2026-1-3", "1999-01-01")) assertFalse(bad, validDay(bad))
        assertNull(algorithmError("umkehren_1", ALGORITHM_TEMPLATES[0].second))
        assertTrue(algorithmError("", "(function(t){return t})") != null)
        assertTrue(algorithmError("a b", "(function(t){return t})") != null)
        assertTrue(algorithmError("ok", "  ") != null)
        assertTrue(algorithmError("ok", "return 1") != null)
        assertTrue(ALGORITHM_TEMPLATES.all { algorithmError("x", it.second) == null })
        assertEquals(listOf("1,2,3", "4"), idChunks(listOf(1L, 2L, 3L, 4L), 3))
    }
}
