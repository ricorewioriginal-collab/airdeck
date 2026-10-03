// Steuerzentrale der Handy-Engine (eine pro App): Sendung, Mikrofon, Titelliste, Mithören, Zustand.
package app.anmachacast.engine.android;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.net.Uri;
import android.os.Build;

import java.util.ArrayList;
import java.util.List;

import app.anmachacast.engine.IcecastSource;
import app.anmachacast.engine.LiveEngine;
import app.anmachacast.engine.Mixer;

/**
 * Öffentliche API der Handy-Engine (Sendung, Mikrofon, Titelliste, Mithören, Zustand) - direkt von
 * nativer UI aufrufbar (Compose-ViewModel), ohne Capacitor-Bridge dazwischen.
 */
public final class EngineHub {
    public static final class Track {
        public final String uri;
        public final String title;

        public Track(String uri, String title) {
            this.uri = uri;
            this.title = title;
        }
    }

    private static EngineHub instance;

    public static synchronized EngineHub get(Context ctx) {
        if (instance == null) instance = new EngineHub(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private LiveEngine engine;
    private MicInput mic;
    private AudioTrack monitor;
    private final List<Track> playlist = new ArrayList<>();
    private volatile String state = "stopped";
    private volatile String error;
    private boolean autoNext = true;

    private EngineHub(Context ctx) {
        this.ctx = ctx;
        this.prefs = ctx.getSharedPreferences("anmachacast-engine", Context.MODE_PRIVATE);
    }

    // ---------- Einstellungen (Passwort bleibt in der App, geht nie zurück an die Oberfläche) ----------

    SharedPreferences prefs() {
        return prefs;
    }

    IcecastSource.Config config() {
        IcecastSource.Config c = new IcecastSource.Config();
        c.host = prefs.getString("host", "");
        c.port = prefs.getInt("port", 8000);
        c.tls = prefs.getBoolean("tls", false);
        c.mount = prefs.getString("mount", "/live");
        c.user = prefs.getString("user", "source");
        c.password = prefs.getString("password", "");
        c.name = prefs.getString("name", "AnMaCha Cast");
        return c;
    }

    int bitrate() {
        return prefs.getInt("bitrate", 128);
    }

    /** Für die Oberfläche: nie das Passwort selbst, nur ob eins hinterlegt ist. */
    public static final class ConfigView {
        public String host;
        public int port;
        public boolean tls;
        public String mount;
        public String user;
        public String name;
        public int bitrate;
        public boolean hasPassword;
        public float micDb;
        public float musicDb;
        public float duckDb;
        public boolean monitor;
        public int micDevice;
        public boolean micRaw;
    }

    public synchronized ConfigView getConfigView() {
        ConfigView v = new ConfigView();
        v.host = prefs.getString("host", "");
        v.port = prefs.getInt("port", 8000);
        v.tls = prefs.getBoolean("tls", false);
        v.mount = prefs.getString("mount", "/live");
        v.user = prefs.getString("user", "source");
        v.name = prefs.getString("name", "AnMaCha Cast");
        v.bitrate = prefs.getInt("bitrate", 128);
        v.hasPassword = !prefs.getString("password", "").isEmpty();
        v.micDb = prefs.getFloat("micDb", 0);
        v.musicDb = prefs.getFloat("musicDb", 0);
        v.duckDb = prefs.getFloat("duckDb", -10);
        v.monitor = prefs.getBoolean("monitor", false);
        v.micDevice = prefs.getInt("micDevice", 0);
        v.micRaw = prefs.getBoolean("micRaw", false);
        return v;
    }

    /** @param password leer = unverändert lassen */
    public synchronized ConfigView saveConfig(String host, int port, boolean tls, String mount, String user, String name, int bitrate, String password) {
        host = host == null ? "" : host.trim();
        if (host.isEmpty() || host.contains("/") || host.contains(" ")) throw new IllegalArgumentException("Server: nur der Name, z. B. stream.example.org");
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Port 1–65535");
        if (bitrate != 64 && bitrate != 96 && bitrate != 128 && bitrate != 160 && bitrate != 192 && bitrate != 256 && bitrate != 320) {
            throw new IllegalArgumentException("Bitrate: 64, 96, 128, 160, 192, 256 oder 320 kbit/s");
        }
        mount = mount == null ? "/live" : mount.trim();
        SharedPreferences.Editor e = prefs.edit()
            .putString("host", host)
            .putInt("port", port)
            .putBoolean("tls", tls)
            .putString("mount", mount.startsWith("/") ? mount : "/" + mount)
            .putString("user", user == null ? "source" : user.trim())
            .putString("name", name == null ? "AnMaCha Cast" : name.trim())
            .putInt("bitrate", bitrate);
        if (password != null && !password.isEmpty()) e.putString("password", password);
        e.apply();
        return getConfigView();
    }

    // ---------- Sendung ----------

    public synchronized boolean running() {
        return engine != null && engine.isRunning();
    }

    public synchronized void start(boolean withMicPermission) {
        if (running()) return;
        IcecastSource.Config c = config();
        if (c.host.isEmpty() || c.password.isEmpty()) throw new IllegalStateException("Bitte zuerst Server und Passwort eintragen");
        error = null;
        engine = new LiveEngine(c, bitrate(), (st, err) -> {
            state = st;
            if (err != null) error = err;
        });
        engine.mixer.setMicGainDb(prefs.getFloat("micDb", 0));
        engine.mixer.setMusicGainDb(prefs.getFloat("musicDb", 0));
        engine.mixer.setDuckDb(prefs.getFloat("duckDb", -10));
        for (int d = 0; d < decks.length; d++) engine.mixer.setDeckGain(d, decks[d].volume);
        // Vordergrund-Dienst hält die Sendung am Leben (auch bei ausgeschaltetem Bildschirm)
        Intent i = new Intent(ctx, EngineService.class).putExtra(EngineService.EXTRA_MIC, withMicPermission);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
        engine.start();
        if (withMicPermission) {
            startMic();
        }
        if (prefs.getBoolean("monitor", false)) setMonitor(true);
    }

    private void startMic() {
        mic = new MicInput(ctx, engine.mixer.mic);
        try {
            mic.start(prefs.getInt("micDevice", 0), prefs.getBoolean("micRaw", false));
        } catch (RuntimeException e) {
            mic = null;
            error = e.getMessage();
        }
    }

    /** Mikrofon-Berechtigung kam nach dem Sendestart dazu: Aufnahme nachträglich starten. */
    public synchronized void ensureMic() {
        if (engine != null && mic == null) startMic();
    }

    /** Eingangsgerät: id 0 = automatisch. Wirkt sofort, auch während der Sendung. */
    public synchronized void setMicDevice(int id, boolean raw) {
        prefs.edit().putInt("micDevice", id).putBoolean("micRaw", raw).apply();
        if (engine != null && mic != null) {
            mic.stop();
            startMic();
        }
    }

    public static final class MicDevice {
        public final int id;
        public final String label;

        MicDevice(int id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    /** Verfügbare Mikrofon-/Eingangsquellen (Handy-Mikro, Headset, USB, Bluetooth …). */
    public List<MicDevice> micDevices() {
        List<MicDevice> out = new ArrayList<>();
        android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        for (android.media.AudioDeviceInfo d : am.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS)) {
            String type;
            switch (d.getType()) {
                case android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC: type = "Handy-Mikrofon"; break;
                case android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET: type = "Headset (Kabel)"; break;
                case android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES: type = "Kopfhörer (Kabel)"; break;
                case android.media.AudioDeviceInfo.TYPE_USB_DEVICE:
                case android.media.AudioDeviceInfo.TYPE_USB_HEADSET: type = "USB-Audio"; break;
                case android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO: type = "Bluetooth-Headset"; break;
                case android.media.AudioDeviceInfo.TYPE_TELEPHONY: continue;
                default: type = "Eingang"; break;
            }
            String name = d.getProductName() == null ? "" : d.getProductName().toString().trim();
            out.add(new MicDevice(d.getId(), name.isEmpty() || type.startsWith("Handy") ? type : type + " · " + name));
        }
        return out;
    }

    public synchronized void stop() {
        for (Deck k : decks) {
            stopPlayer(k);
            if (k.track != null) { k.state = "cued"; k.posMs = 0; }
        }
        setMonitor(false);
        if (mic != null) {
            mic.stop();
            mic = null;
        }
        if (engine != null) {
            engine.stop();
            engine = null;
        }
        state = "stopped";
        ctx.stopService(new Intent(ctx, EngineService.class));
    }

    public synchronized void setMic(boolean on) {
        if (engine == null) throw new IllegalStateException("Erst die Sendung starten");
        if (on && mic == null) throw new IllegalStateException("Kein Mikrofon (Berechtigung fehlt oder belegt)");
        engine.mixer.setMic(on);
    }

    public synchronized void setLevels(Float micDb, Float musicDb, Float duckDb) {
        SharedPreferences.Editor e = prefs.edit();
        if (micDb != null) e.putFloat("micDb", micDb);
        if (musicDb != null) e.putFloat("musicDb", musicDb);
        if (duckDb != null) e.putFloat("duckDb", duckDb);
        e.apply();
        if (engine == null) return;
        if (micDb != null) engine.mixer.setMicGainDb(micDb);
        if (musicDb != null) engine.mixer.setMusicGainDb(musicDb);
        if (duckDb != null) engine.mixer.setDuckDb(duckDb);
    }

    /** Mithören über Kopfhörer (bei Lautsprecher und offenem Mikrofon droht Rückkopplung). */
    public synchronized void setMonitor(boolean on) {
        prefs.edit().putBoolean("monitor", on).apply();
        if (!on) {
            if (engine != null) engine.tap = null;
            if (monitor != null) {
                monitor.pause();
                monitor.flush();
                monitor.release();
                monitor = null;
            }
            return;
        }
        if (engine == null || monitor != null) return;
        int min = AudioTrack.getMinBufferSize(Mixer.RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack t = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(new AudioFormat.Builder().setSampleRate(Mixer.RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(Math.max(min, Mixer.RATE)) // ca. 0,25 s
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
        t.play();
        monitor = t;
        engine.tap = (block, frames) -> t.write(block, 0, frames * Mixer.CHANNELS, AudioTrack.WRITE_NON_BLOCKING);
    }

    // ---------- Titel (Bibliothek) und Decks ----------

    /** Ein Deck: geladener Titel, Zustand und Position. Hört nur zu, wenn die Sendung läuft. */
    private static final class Deck {
        Track track;
        String state = "empty"; // empty | cued | playing | paused
        long posMs;
        long durationMs = -1;
        float volume = 1f;
        TrackPlayer player;
    }

    private final Deck[] decks = new Deck[Mixer.DECKS];

    {
        for (int i = 0; i < decks.length; i++) decks[i] = new Deck();
    }

    private Deck deck(int d) {
        if (d < 0 || d >= decks.length) throw new IllegalArgumentException("Deck gibt es nicht");
        return decks[d];
    }

    public synchronized void addTracks(List<Track> tracks) {
        playlist.addAll(tracks);
    }

    public synchronized void clearPlaylist() {
        for (int d = 0; d < decks.length; d++) ejectDeck(d);
        playlist.clear();
    }

    public synchronized void removeTrack(int index) {
        if (index < 0 || index >= playlist.size()) return;
        Track t = playlist.remove(index);
        for (int d = 0; d < decks.length; d++) if (decks[d].track == t) ejectDeck(d);
    }

    public synchronized void setAutoNext(boolean on) {
        autoNext = on;
    }

    /** Dauer eines Titels in ms (ohne ihn abzuspielen), -1 wenn unbekannt. */
    private long probeDuration(Track t) {
        android.media.MediaMetadataRetriever r = new android.media.MediaMetadataRetriever();
        try {
            r.setDataSource(ctx, Uri.parse(t.uri));
            String v = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
            return v == null ? -1 : Long.parseLong(v);
        } catch (Exception e) {
            return -1;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
    }

    /**
     * Titel aus der Bibliothek in ein Deck laden (ein laufender Titel dort wird gestoppt). Die Dauer wird außerhalb der
     * Sperre ermittelt: bei langsamen Cloud-Anbietern kann das dauern, und die Statusabfrage der Oberfläche soll nicht warten.
     */
    public void loadDeck(int d, int trackIndex) {
        final Track t;
        synchronized (this) {
            deck(d);
            if (trackIndex < 0 || trackIndex >= playlist.size()) throw new IllegalArgumentException("Titel nicht in der Liste");
            t = playlist.get(trackIndex);
        }
        long dur = probeDuration(t);
        synchronized (this) {
            if (!playlist.contains(t)) return; // inzwischen aus der Liste entfernt
            Deck k = deck(d);
            stopPlayer(k);
            k.track = t;
            k.state = "cued";
            k.posMs = 0;
            k.durationMs = dur;
        }
    }

    public synchronized void playDeck(int d) {
        Deck k = deck(d);
        if (engine == null) throw new IllegalStateException("Erst die Sendung starten");
        if (k.track == null) throw new IllegalStateException("Deck " + (char) ('A' + d) + " ist leer");
        if (k.state.equals("playing")) return;
        startPlayer(d, k.posMs);
    }

    private void startPlayer(int d, long fromMs) {
        Deck k = decks[d];
        stopPlayer(k);
        final TrackPlayer[] self = new TrackPlayer[1];
        self[0] = new TrackPlayer(ctx, Uri.parse(k.track.uri), k.track.title, engine.mixer.decks[d], fromMs, (p, err) -> onTrackEnded(d, p, err));
        k.player = self[0];
        k.state = "playing";
        k.player.start();
        if (engine.source() != null) engine.source().updateMetadata(k.track.title);
    }

    private void stopPlayer(Deck k) {
        if (k.player != null) {
            k.player.stop();
            k.player = null;
        }
    }

    /** Anhalten, die Stelle bleibt erhalten. */
    public synchronized void pauseDeck(int d) {
        Deck k = deck(d);
        if (!k.state.equals("playing") || k.player == null) return;
        k.posMs = k.player.positionMs();
        stopPlayer(k);
        k.state = "paused";
    }

    /** Stoppen und zurück an den Anfang. */
    public synchronized void stopDeck(int d) {
        Deck k = deck(d);
        stopPlayer(k);
        if (k.track != null) k.state = "cued";
        k.posMs = 0;
    }

    public synchronized void ejectDeck(int d) {
        Deck k = deck(d);
        stopPlayer(k);
        k.track = null;
        k.state = "empty";
        k.posMs = 0;
        k.durationMs = -1;
    }

    /** Springen (ms in der Datei). */
    public synchronized void seekDeck(int d, long ms) {
        Deck k = deck(d);
        if (k.track == null) return;
        long max = k.durationMs > 1000 ? k.durationMs - 500 : Long.MAX_VALUE;
        long pos = Math.max(0, Math.min(ms, max));
        if (k.state.equals("playing") && engine != null) startPlayer(d, pos);
        else {
            k.posMs = pos;
            if (pos > 0) k.state = "paused";
        }
    }

    public synchronized void setDeckVolume(int d, float volume) {
        Deck k = deck(d);
        k.volume = Math.max(0f, Math.min(1.5f, volume));
        if (engine != null) engine.mixer.setDeckGain(d, k.volume);
    }

    /** Kompatibel zum Einfachbetrieb: Titel laden und auf Deck A starten. */
    public void play(int index) {
        loadDeck(0, index);
        playDeck(0);
    }

    public synchronized void stopTrack() {
        for (int d = 0; d < decks.length; d++) stopDeck(d);
    }

    private synchronized void onTrackEnded(int d, TrackPlayer p, String err) {
        Deck k = decks[d];
        if (p != k.player) return;
        k.player = null;
        k.state = k.track != null ? "cued" : "empty";
        k.posMs = 0;
        if (err != null) error = err;
        // AutoDJ auf dem Handy: Deck A spielt nach dem Ende den nächsten Titel der Liste
        if (d == 0 && autoNext && err == null && engine != null && k.track != null) {
            int next = playlist.indexOf(k.track) + 1;
            if (next > 0 && next < playlist.size()) {
                // Laden ermittelt die Dauer und darf die Sperre nicht halten: in eigenem Thread
                Thread t = new Thread(() -> {
                    try {
                        loadDeck(0, next);
                        playDeck(0);
                    } catch (RuntimeException e) {
                        error = e.getMessage();
                    }
                }, "anmachacast-autonext");
                t.start();
            }
        }
    }

    // ---------- Zustand für die Oberfläche ----------

    public synchronized Status status() {
        Status s = new Status();
        s.running = running();
        s.state = state;
        s.error = error;
        s.micAvailable = mic != null;
        s.monitor = monitor != null;
        s.autoNext = autoNext;
        if (engine != null) {
            s.micOn = engine.mixer.isMicOn();
            s.micDb = engine.mixer.micDb();
            s.musicDb = engine.mixer.musicDb();
            s.masterDb = engine.mixer.masterDb();
            s.peakDb = engine.mixer.peakDb();
            s.startedAt = engine.startedAt();
            s.bytesSent = engine.source() == null ? 0 : engine.source().bytesSent();
            s.dropped = engine.source() == null ? 0 : engine.source().dropped();
        }
        s.decks = new ArrayList<>();
        for (int d = 0; d < decks.length; d++) {
            Deck k = decks[d];
            DeckView v = new DeckView();
            v.state = k.state;
            v.title = k.track == null ? null : k.track.title;
            v.trackIndex = k.track == null ? -1 : playlist.indexOf(k.track);
            v.positionMs = k.player != null ? k.player.positionMs() : k.posMs;
            long dur = k.player != null && k.player.durationMs() > 0 ? k.player.durationMs() : k.durationMs;
            v.durationMs = dur;
            v.volume = k.volume;
            v.levelDb = engine != null ? engine.mixer.deckDb(d) : -90;
            s.decks.add(v);
        }
        s.playlist = new ArrayList<>(playlist);
        return s;
    }

    public static final class DeckView {
        public String state = "empty";
        public String title;
        public int trackIndex = -1;
        public long positionMs;
        public long durationMs = -1;
        public float volume = 1f;
        public float levelDb = -90;
    }

    public static final class Status {
        public boolean running;
        public String state;
        public String error;
        public boolean micAvailable;
        public boolean micOn;
        public boolean monitor;
        public boolean autoNext;
        public float micDb = -90;
        public float musicDb = -90;
        public float masterDb = -90;
        public float peakDb = -90;
        public long startedAt;
        public long bytesSent;
        public long dropped;
        public List<DeckView> decks;
        public List<Track> playlist;
    }
}
