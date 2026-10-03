// Mischpult der Handy-Engine: Mikrofon + Musik (mit Ducking), weiche Übergänge, Pegel je Kanal.
package app.anmachacast.engine;

public final class Mixer {
    public static final int RATE = 44100;
    public static final int CHANNELS = 2;

    /** Mikrofon: höchstens 0,3 s Vorlauf – lieber verwerfen als verzögern */
    public final PcmRing mic = new PcmRing(RATE * CHANNELS * 3 / 10);
    /** Anzahl Musik-Decks (A–D) */
    public static final int DECKS = 4;
    /** Je Deck ein Puffer: der Decoder füllt bis zu 4 s vor */
    public final PcmRing[] decks = new PcmRing[DECKS];
    /** Deck A (Abkürzung für Einfachbetrieb und Tests) */
    public final PcmRing music;
    private final float[] deckGain = new float[DECKS];
    private final float[] deckDb = new float[DECKS];

    public Mixer() {
        for (int i = 0; i < DECKS; i++) {
            decks[i] = new PcmRing(RATE * CHANNELS * 4);
            deckGain[i] = 1f;
            deckDb[i] = -90;
        }
        music = decks[0];
    }

    private volatile boolean micOn;
    private volatile float micGain = 1f;
    private volatile float musicGain = 1f;
    /** Musik unter dem Mikrofon (Ducking), Standard −10 dB */
    private volatile float duckGain = dbToGain(-10);

    private float curMic;
    private float curDuck = 1f;
    private short[] micBuf = new short[0];
    private short[] deckBuf = new short[0];
    private float[] musicBuf = new float[0];

    // Pegel (werden vom Mischthread geschrieben, von der Oberfläche gelesen)
    private volatile float micDb = -90;
    private volatile float musicDb = -90;
    private volatile float masterDb = -90;
    private volatile float peakDb = -90;

    public static float dbToGain(double db) {
        return (float) Math.pow(10, db / 20);
    }

    public void setMic(boolean on) { micOn = on; }
    public boolean isMicOn() { return micOn; }
    public void setMicGainDb(double db) { micGain = dbToGain(Math.max(-30, Math.min(20, db))); }
    public void setMusicGainDb(double db) { musicGain = dbToGain(Math.max(-60, Math.min(12, db))); }
    public void setDuckDb(double db) { duckGain = dbToGain(Math.max(-40, Math.min(0, db))); }
    /** Lautstärke eines Decks 0–1,5 (linear) */
    public void setDeckGain(int deck, float gain) { deckGain[deck] = Math.max(0f, Math.min(1.5f, gain)); }
    public float deckGain(int deck) { return deckGain[deck]; }
    public float deckDb(int deck) { return deckDb[deck]; }

    public float micDb() { return micDb; }
    public float musicDb() { return musicDb; }
    public float masterDb() { return masterDb; }
    public float peakDb() { return peakDb; }

    /** frames Frames Stereo in out mischen (out wird überschrieben). */
    public void mix(short[] out, int frames) {
        int n = frames * CHANNELS;
        if (micBuf.length < n) {
            micBuf = new short[n];
            deckBuf = new short[n];
            musicBuf = new float[n];
        }
        java.util.Arrays.fill(micBuf, 0, n, (short) 0);
        java.util.Arrays.fill(musicBuf, 0, n, 0f);
        mic.read(micBuf, 0, n);
        // Mikro zu: Reste im Puffer verwerfen, damit beim nächsten Drücken kein altes Audio mitläuft
        if (!micOn && curMic <= 0.0001f) mic.clear();
        // Alle Decks zusammenmischen (jedes mit eigener Lautstärke), Pegel je Deck für die Anzeige
        for (int d = 0; d < DECKS; d++) {
            java.util.Arrays.fill(deckBuf, 0, n, (short) 0);
            int got = decks[d].read(deckBuf, 0, n);
            if (got <= 0) { deckDb[d] = -90; continue; }
            float g = deckGain[d];
            double sq = 0;
            for (int i = 0; i < got; i++) {
                float v = deckBuf[i] * g;
                musicBuf[i] += v;
                sq += (double) v * v;
            }
            deckDb[d] = toDb(Math.sqrt(sq / n));
        }

        // Push-to-Talk-tauglich: Mikro öffnet in ca. 12 ms (kein Knacken, aber sofort hörbar), schließt in 60 ms;
        // Ducking senkt in 50 ms ab und hebt in 150 ms wieder an.
        float micTarget = micOn ? micGain : 0f;
        float duckTarget = micOn ? duckGain : 1f;
        float micStep = 1f / (RATE * (micOn ? 0.012f : 0.06f));
        float duckStep = 1f / (RATE * (micOn ? 0.05f : 0.15f));
        double sMic = 0, sMusic = 0, sOut = 0;
        int peak = 0;
        for (int f = 0; f < frames; f++) {
            curMic += clampStep(micTarget - curMic, micStep);
            curDuck += clampStep(duckTarget - curDuck, duckStep);
            float gMusic = musicGain * curDuck;
            for (int c = 0; c < CHANNELS; c++) {
                int i = f * CHANNELS + c;
                float m = micBuf[i] * curMic;
                float b = musicBuf[i] * gMusic;
                int v = Math.round(m + b);
                if (v > Short.MAX_VALUE) v = Short.MAX_VALUE;
                else if (v < Short.MIN_VALUE) v = Short.MIN_VALUE;
                out[i] = (short) v;
                sMic += m * m;
                sMusic += b * b;
                sOut += (double) v * v;
                int a = Math.abs(v);
                if (a > peak) peak = a;
            }
        }
        micDb = toDb(Math.sqrt(sMic / n));
        musicDb = toDb(Math.sqrt(sMusic / n));
        masterDb = toDb(Math.sqrt(sOut / n));
        peakDb = toDb(peak);
    }

    private static float clampStep(float diff, float step) {
        return diff > step ? step : diff < -step ? -step : diff;
    }

    static float toDb(double amp) {
        if (amp <= 0) return -90;
        return (float) Math.max(-90, 20 * Math.log10(amp / 32768.0));
    }
}
