// Natives Haupt-Studiofenster: Sender/On-Air/Betriebsart/Mikrofon/Sendung, die vier Decks (A-D) und die
// Cardwall – echte WPF-Bedienelemente statt eingebettetem Browser (siehe PR-Beschreibung für den Hintergrund).
// Mediathek, Playlists, Sendeplan, Einstellungen, KI-Werkzeuge, Hörer-Statistik usw. bleiben vorerst im
// Web-Studio, erreichbar über "Weitere Funktionen im Browser öffnen" (BrowserForm, WebView2).
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using AirDeck.Api;
using AirDeck.ViewModels;

namespace AirDeck
{
    public partial class MainWindow : Window
    {
        static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AirDeck");
        static readonly string BoundsFile = Path.Combine(LocalDir, "fenster.txt");
        static readonly string[] DeckIds = { "A", "B", "C", "D" };

        readonly EventWaitHandle showSignal;
        readonly EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "AirDeck.Studio.Quit");
        readonly bool startHidden;
        readonly System.Windows.Forms.NotifyIcon tray = new System.Windows.Forms.NotifyIcon();
        readonly DispatcherTimer watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        readonly DispatcherTimer clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        readonly DispatcherTimer deckTick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };

        readonly ObservableCollection<DeckViewModel> decks = new ObservableCollection<DeckViewModel>();
        readonly ObservableCollection<CartViewModel> carts = new ObservableCollection<CartViewModel>();
        Dictionary<string, MediaItem> library = new Dictionary<string, MediaItem>();
        List<StationInfo> stations = new List<StationInfo>();

        EngineInfo engine;
        Uri origin;
        ApiClient api;
        string stationId;
        bool micOn;
        bool busRunning;
        bool quitting;
        bool hintShown;
        int downChecks;
        CancellationTokenSource sseCts;
        BrowserForm browser;

        public MainWindow(EventWaitHandle show, bool minimized)
        {
            InitializeComponent();
            showSignal = show;
            startHidden = minimized;

            foreach (var id in DeckIds) decks.Add(new DeckViewModel(id));
            DecksList.ItemsSource = decks;
            CartsList.ItemsSource = carts;

            LoadBounds();

            tray.Icon = System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);
            tray.Text = "AnMaCha Cast";
            var menu = new System.Windows.Forms.ContextMenuStrip();
            menu.Items.Add("Studio öffnen", null, (s, e) => ShowStudio());
            menu.Items.Add("Protokoll anzeigen", null, (s, e) => OpenLog());
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            menu.Items.Add("AnMaCha Cast beenden", null, (s, e) => Quit(true));
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) => ShowStudio();
            tray.Visible = true;

            watch.Tick += (s, e) => { CheckEngine(); RefreshQuiet(); };
            clock.Tick += (s, e) => ClockText.Text = DateTime.Now.ToString("HH:mm:ss");
            clock.Start();
            deckTick.Tick += (s, e) => { foreach (var d in decks) d.Tick(500); };
            deckTick.Start();

            Closing += OnClosing;
            // Nicht an Loaded hängen: bei --minimized (Autostart) wird das Fenster nie gezeigt, Loaded
            // würde dann nie feuern - die Engine muss trotzdem sofort verbunden werden (Tray-Betrieb).
            _ = Connect();

            // Zweiter Programmstart: vorhandenes Fenster nach vorn holen
            var t = new Thread(() =>
            {
                while (true)
                {
                    showSignal.WaitOne();
                    try { Dispatcher.Invoke(ShowStudio); } catch { return; }
                }
            }) { IsBackground = true, Name = "AirDeck.Show" };
            t.Start();
            // AirDeck.exe --quit (Update): nur das Fenster schließen, die Engine läuft weiter
            new Thread(() =>
            {
                quitSignal.WaitOne();
                try { Dispatcher.Invoke(CloseWindowOnly); } catch { }
            }) { IsBackground = true, Name = "AirDeck.Quit" }.Start();
        }

        // ---------- Engine verbinden ----------

        Task connecting;
        Task Connect() => connecting ?? (connecting = ConnectCore());

        async Task ConnectCore()
        {
            StatusText.Text = "Engine startet …";
            engine = await Task.Run(() =>
            {
                var info = Engine.Query();
                if (info.Running && Engine.Alive(info.Health)) return info;
                Engine.Start();
                Engine.WaitAlive(info.Health, 90000);
                return Engine.Query();
            });
            if (string.IsNullOrEmpty(engine.Url) || !Engine.Alive(engine.Health))
            {
                var r = System.Windows.MessageBox.Show(this, "Die AnMaCha-Cast-Engine startet nicht.\n\nProtokoll öffnen?", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Error);
                if (r == MessageBoxResult.Yes) OpenLog();
                Quit(false);
                return;
            }
            var raw = new Uri(engine.Url);
            origin = new Uri(raw.GetLeftPart(UriPartial.Authority));
            var token = ParseToken(raw.Fragment);
            api = new ApiClient(origin, token);
            tray.Text = "AnMaCha Cast läuft";

            try
            {
                stations = await api.Stations();
            }
            catch (Exception ex)
            {
                StatusText.Text = "Verbindung zur Engine fehlgeschlagen: " + ex.Message;
                return;
            }
            StationPicker.ItemsSource = stations;
            if (stations.Count > 0)
            {
                StationPicker.SelectedIndex = 0;
                stationId = stations[0].id;
                await RefreshAll();
                StartEvents();
            }
            watch.Start();
            StatusText.Text = "Verbunden";
        }

        /// <summary>Token aus dem Fragment "#token=…" der von der Engine gedruckten URL (siehe src/server/main.ts).</summary>
        static string ParseToken(string fragment)
        {
            var frag = (fragment ?? "").TrimStart('#');
            foreach (var part in frag.Split('&'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv.Length == 2 && kv[0] == "token") return Uri.UnescapeDataString(kv[1]);
            }
            return "";
        }

        // ---------- Stand laden ----------

        async Task RefreshAll()
        {
            if (string.IsNullOrEmpty(stationId)) return;
            try
            {
                var libTask = api.Library(stationId);
                var cartsTask = api.Cardwall(stationId);
                var modeTask = api.Mode(stationId);
                var playoutTask = api.Playout(stationId);
                await Task.WhenAll(libTask, cartsTask, modeTask, playoutTask);

                library = libTask.Result.Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                ApplyCardwall(cartsTask.Result);
                ApplyMode(modeTask.Result);
                await ApplyPlayout(playoutTask.Result);
            }
            catch (Exception ex)
            {
                StatusText.Text = "Aktualisierung fehlgeschlagen: " + ex.Message;
            }
        }

        /// <summary>Leiser Nachzieh-Abgleich (Sicherheitsnetz neben den SSE-Ereignissen), alle paar Sekunden.</summary>
        async void RefreshQuiet()
        {
            if (api == null || quitting) return;
            try
            {
                var modeTask = api.Mode(stationId);
                var playoutTask = api.Playout(stationId);
                await Task.WhenAll(modeTask, playoutTask);
                ApplyMode(modeTask.Result);
                await ApplyPlayout(playoutTask.Result);
            }
            catch { /* nächster Versuch in 3s */ }
        }

        void ApplyMode(ModeView m)
        {
            if (m == null) return;
            // micOn/busRunning (Sendebus) werden aus ApplyPlayout gesetzt - hier nur Betriebsart/On-Air-Anzeige.
            BtnAuto.IsChecked = m.Base == "AUTO";
            BtnManual.IsChecked = m.Base == "MANUAL";
            var live = m.mode == "LIVE";
            OnAirDot.Fill = live ? Brushes.OrangeRed : (m.mode == "EMERGENCY" ? Brushes.Gold : Brushes.LimeGreen);
            OnAirText.Text = live ? $"ON AIR · LIVE · {m.live}" : m.mode == "EMERGENCY" ? "ON AIR · NOTFALL" : $"ON AIR · {m.mode}";
        }

        async Task ApplyPlayout(PlayoutView p)
        {
            busRunning = p?.status?.running == true;
            micOn = p?.status?.micOn == true;
            BtnMic.IsChecked = micOn;
            BtnStream.Content = busRunning ? "Sendung stoppen" : "Sendung starten";

            if (p?.status?.decks != null && p.status.decks.Count > 0)
            {
                foreach (var ed in p.status.decks)
                {
                    var vm = decks.FirstOrDefault(d => d.Id == ed.id);
                    if (vm == null) continue;
                    vm.Title = string.IsNullOrEmpty(ed.title) ? "– leer –" : ed.title;
                    vm.Artist = ed.artist ?? "";
                    vm.Status = ed.state;
                    vm.Auto = ed.auto;
                    vm.PositionMs = ed.positionMs;
                    vm.DurationMs = ed.durationMs;
                }
            }
            else
            {
                // Server-Playout noch nicht gestartet: einfache Deck-Basisdaten + Mediathek-Titel verwenden
                try
                {
                    var basic = await api.Decks(stationId);
                    foreach (var d in basic)
                    {
                        var vm = decks.FirstOrDefault(x => x.Id == d.id);
                        if (vm == null) continue;
                        MediaItem media = d.mediaId != null && library.TryGetValue(d.mediaId, out var mm) ? mm : null;
                        vm.Title = media?.title ?? (d.mediaId == null ? "– leer –" : d.mediaId);
                        vm.Artist = media?.artist ?? "";
                        vm.Status = d.status;
                        vm.Auto = false;
                        vm.PositionMs = 0;
                        vm.DurationMs = media?.durationMs;
                    }
                }
                catch { /* ignorieren, nächster Zyklus */ }
            }
        }

        void ApplyCardwall(List<CartSlot> slots)
        {
            carts.Clear();
            foreach (var c in slots)
            {
                var vm = new CartViewModel(c.id) { Label = c.label, MediaId = c.mediaId };
                try { vm.Color = (Brush)new BrushConverter().ConvertFromString(string.IsNullOrEmpty(c.color) ? "#2A3C56" : c.color); }
                catch { vm.Color = Brushes.DimGray; }
                if (!vm.HasMedia) vm.Color = Brushes.Transparent;
                carts.Add(vm);
            }
        }

        // ---------- Live-Ereignisse (SSE, wie studio/js/api.js) ----------

        void StartEvents()
        {
            sseCts?.Cancel();
            sseCts = new CancellationTokenSource();
            var ct = sseCts.Token;
            var sid = stationId;
            Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        await api.Subscribe(sid, (type, data) => Dispatcher.BeginInvoke(new Action(() => OnEvent(type))), ct);
                    }
                    catch { /* Verbindung verloren - kurze Pause, dann neu verbinden */ }
                    if (ct.IsCancellationRequested) break;
                    try { await Task.Delay(2000, ct); } catch (TaskCanceledException) { }
                }
            }, ct);
        }

        async void OnEvent(string type)
        {
            if (quitting || api == null) return;
            try
            {
                switch (type)
                {
                    case "library.changed":
                        library = (await api.Library(stationId)).Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                        break;
                    case "cardwall.changed":
                    case "cardwall.triggered":
                        ApplyCardwall(await api.Cardwall(stationId));
                        break;
                    case "deck.state_changed":
                    case "playout.state":
                        await ApplyPlayout(await api.Playout(stationId));
                        break;
                    case "automation.state_changed":
                    case "station.changed":
                        ApplyMode(await api.Mode(stationId));
                        await ApplyPlayout(await api.Playout(stationId));
                        break;
                }
            }
            catch { /* das nächste Ereignis oder der 3s-Abgleich korrigiert es */ }
        }

        // ---------- Bedienung: Kopfzeile ----------

        async void StationPicker_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (StationPicker.SelectedItem is StationInfo s && s.id != stationId && api != null)
            {
                stationId = s.id;
                await RefreshAll();
                StartEvents();
            }
        }

        async void BtnAuto_Click(object sender, RoutedEventArgs e) => await SetMode("AUTO");
        async void BtnManual_Click(object sender, RoutedEventArgs e) => await SetMode("MANUAL");

        async Task SetMode(string mode)
        {
            if (api == null) return;
            try { ApplyMode(await api.SetMode(stationId, mode)); }
            catch (Exception ex) { StatusText.Text = "Betriebsart: " + ex.Message; }
        }

        async void BtnMic_Click(object sender, RoutedEventArgs e)
        {
            if (api == null) return;
            try
            {
                await api.SetMic(stationId, !micOn);
                await ApplyPlayout(await api.Playout(stationId));
            }
            catch (Exception ex) { StatusText.Text = "Mikrofon: " + ex.Message; }
        }

        async void BtnStream_Click(object sender, RoutedEventArgs e)
        {
            if (api == null) return;
            try
            {
                if (busRunning)
                {
                    if (System.Windows.MessageBox.Show(this, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
                    await ApplyPlayout(await api.StopPlayout(stationId));
                }
                else
                {
                    await ApplyPlayout(await api.StartPlayout(stationId));
                }
            }
            catch (Exception ex) { StatusText.Text = "Sendung: " + ex.Message; }
        }

        // ---------- Bedienung: Decks ----------

        static DeckViewModel DeckOf(object sender) => (sender as FrameworkElement)?.DataContext as DeckViewModel;

        async void DeckPlay_Click(object sender, RoutedEventArgs e)
        {
            var d = DeckOf(sender);
            if (d == null || api == null) return;
            try { await api.DeckAction(stationId, d.Id, "play"); await ApplyPlayout(await api.Playout(stationId)); }
            catch (Exception ex) { StatusText.Text = $"Deck {d.Id}: {ex.Message}"; }
        }

        async void DeckPause_Click(object sender, RoutedEventArgs e)
        {
            var d = DeckOf(sender);
            if (d == null || api == null) return;
            try { await api.DeckAction(stationId, d.Id, "pause"); await ApplyPlayout(await api.Playout(stationId)); }
            catch (Exception ex) { StatusText.Text = $"Deck {d.Id}: {ex.Message}"; }
        }

        async void DeckStop_Click(object sender, RoutedEventArgs e)
        {
            var d = DeckOf(sender);
            if (d == null || api == null) return;
            try { await api.DeckAction(stationId, d.Id, "stop"); await ApplyPlayout(await api.Playout(stationId)); }
            catch (Exception ex) { StatusText.Text = $"Deck {d.Id}: {ex.Message}"; }
        }

        async void DeckSkipBack_Click(object sender, RoutedEventArgs e) => await Skip(DeckOf(sender), -10000);
        async void DeckSkipFwd_Click(object sender, RoutedEventArgs e) => await Skip(DeckOf(sender), 10000);

        async Task Skip(DeckViewModel d, int deltaMs)
        {
            if (d == null || api == null) return;
            var target = Math.Max(0, d.PositionMs + deltaMs);
            try
            {
                await api.DeckAction(stationId, d.Id, "seek", new { ms = target });
                d.PositionMs = target;
            }
            catch (Exception ex) { StatusText.Text = $"Deck {d.Id}: {ex.Message}"; }
        }

        // ---------- Bedienung: Cardwall ----------

        async void Cart_Click(object sender, RoutedEventArgs e)
        {
            if ((sender as FrameworkElement)?.DataContext is CartViewModel c && c.HasMedia && api != null)
            {
                try { await api.TriggerCart(stationId, c.Id); }
                catch (Exception ex) { StatusText.Text = "Cart: " + ex.Message; }
            }
        }

        // ---------- Weitere Funktionen (WebView2-Fallback) ----------

        void BtnBrowser_Click(object sender, RoutedEventArgs e)
        {
            if (engine == null || string.IsNullOrEmpty(engine.Url)) return;
            if (browser == null || browser.IsDisposed)
            {
                browser = new BrowserForm(engine.Url);
                browser.Show();
            }
            else
            {
                browser.Activate();
            }
        }

        // ---------- Überwachung/Tray/Fenster (unverändert gegenüber der vorherigen WebView2-Hülle) ----------

        async void CheckEngine()
        {
            if (quitting || engine == null) return;
            var alive = await Task.Run(() => Engine.Alive(engine.Health));
            if (alive) { downChecks = 0; return; }
            if (++downChecks < 8) return;
            watch.Stop();
            ShowStudio();
            var r = System.Windows.MessageBox.Show(this, "Die AnMaCha-Cast-Engine läuft nicht mehr.\n\nJetzt neu starten?", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (r != MessageBoxResult.Yes) { Quit(false); return; }
            downChecks = 0;
            await Task.Run(() => { Engine.Start(); Engine.WaitAlive(engine.Health, 90000); });
            engine = await Task.Run(() => Engine.Query());
            await RefreshAll();
            StartEvents();
            watch.Start();
        }

        void ShowStudio()
        {
            if (!IsVisible) Show();
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();
            _ = Connect();
        }

        void OpenLog()
        {
            var log = engine?.Log;
            if (string.IsNullOrEmpty(log) || !File.Exists(log)) log = Engine.Query().Log;
            if (!string.IsNullOrEmpty(log) && File.Exists(log))
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true });
        }

        void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            SaveBounds();
            if (!quitting)
            {
                e.Cancel = true;
                Hide();
                if (!hintShown)
                {
                    hintShown = true;
                    tray.ShowBalloonTip(4000, "AnMaCha Cast läuft weiter", "Automation und Streams laufen im Hintergrund. Beenden über das Symbol im Infobereich.", System.Windows.Forms.ToolTipIcon.Info);
                }
            }
        }

        void Quit(bool ask)
        {
            if (quitting) return;
            if (ask && System.Windows.MessageBox.Show(this, "AnMaCha Cast komplett beenden? Automation und alle Streams stoppen.", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            quitting = true;
            watch.Stop();
            sseCts?.Cancel();
            SaveBounds();
            tray.Text = "AnMaCha Cast wird beendet …";
            Task.Run(() => Engine.Stop()).ContinueWith(_ => Dispatcher.Invoke(() =>
            {
                tray.Visible = false;
                tray.Dispose();
                System.Windows.Application.Current.Shutdown();
            }));
        }

        void CloseWindowOnly()
        {
            quitting = true;
            watch.Stop();
            sseCts?.Cancel();
            SaveBounds();
            tray.Visible = false;
            tray.Dispose();
            System.Windows.Application.Current.Shutdown();
        }

        void LoadBounds()
        {
            Width = 1320; Height = 860;
            try
            {
                var p = File.ReadAllText(BoundsFile).Split(',');
                Left = double.Parse(p[0]); Top = double.Parse(p[1]); Width = double.Parse(p[2]); Height = double.Parse(p[3]);
                if (p.Length > 4 && p[4] == "max") WindowState = WindowState.Maximized;
            }
            catch { WindowStartupLocation = WindowStartupLocation.CenterScreen; }
        }

        void SaveBounds()
        {
            try
            {
                var b = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
                Directory.CreateDirectory(LocalDir);
                File.WriteAllText(BoundsFile, $"{b.X},{b.Y},{b.Width},{b.Height},{(WindowState == WindowState.Maximized ? "max" : "normal")}");
            }
            catch { }
        }
    }
}
