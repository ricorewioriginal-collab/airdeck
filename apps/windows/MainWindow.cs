// AnMaCha Cast für Windows - Hauptfenster: Navigation links, Seiten rechts, oben Server- und Senderwahl. Die Oberfläche wird im
// Code aufgebaut (kein XAML). Verbindet sich mit der eingebauten Engine dieses PCs oder mit entfernten AnMaCha-Cast-Servern
// (Kopplungscode oder Anmeldung) und bietet Studio, Mediathek, Playlists, Planung, Podcast, Statistik, Hörer, KI, laut.fm,
// Server & Geräte und System nativ an; nur seltene Einstellungen bleiben im eingebetteten Web-Studio (BrowserForm).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Pages;
using AnMaChaCast.Ui;

namespace AnMaChaCast
{
    public sealed class MainWindow : Window
    {
        static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AnMaChaCast");
        static readonly string BoundsFile = Path.Combine(LocalDir, "fenster.txt");

        readonly EventWaitHandle showSignal;
        readonly EventWaitHandle quitSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "AnMaChaCast.Studio.Quit");
        readonly System.Windows.Forms.NotifyIcon tray = new System.Windows.Forms.NotifyIcon();
        readonly DispatcherTimer watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
        readonly DispatcherTimer clock = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };

        readonly Ctx ctx = new Ctx();
        readonly ServerStore servers;
        readonly List<View> pages = new List<View>();
        readonly List<ToggleButton> nav = new List<ToggleButton>();
        readonly ComboBox serverPicker = new ComboBox { Width = 190, Margin = new Thickness(0, 0, 10, 0), DisplayMemberPath = "Name" };
        readonly ComboBox stationPicker = new ComboBox { Width = 200, Margin = new Thickness(0, 0, 10, 0), DisplayMemberPath = "name" };
        readonly TextBlock connText = Kit.Text("getrennt", 12, false, Kit.Muted);
        readonly TextBlock clockText = new TextBlock { Text = "--:--:--", FontFamily = new System.Windows.Media.FontFamily("Consolas"), FontSize = 20, Foreground = Kit.Fg, VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock statusText = Kit.Text("", 12, false, Kit.Muted);
        readonly Grid host = new Grid();

        EngineInfo engine;
        ApiClient api;
        BrowserForm browser;
        CancellationTokenSource sseCts;
        int current;
        int generation;
        bool suppress;
        bool quitting;
        bool hintShown;
        int downChecks;
        bool setupOffered;

        public MainWindow(EventWaitHandle show, bool minimized)
        {
            showSignal = show;
            Title = "AnMaCha Cast";
            Background = Kit.Bg;
            Foreground = Kit.Fg;
            FontFamily = new System.Windows.Media.FontFamily("Segoe UI");
            MinWidth = 1000;
            MinHeight = 640;
            servers = new ServerStore(Path.Combine(LocalDir, "servers.json"), new DpapiProtector());
            ctx.Servers = servers;
            ctx.Owner = this;
            ctx.Status = SetStatus;
            ctx.SwitchTo = SwitchTo;
            ctx.Reconnect = () => SwitchTo(servers.Active);
            ctx.EngineLog = () => engine?.Log;
            LoadBounds();

            BuildLayout();
            BuildTray();

            watch.Tick += (s, e) => Watch();
            clock.Tick += (s, e) => clockText.Text = DateTime.Now.ToString("HH:mm:ss");
            clock.Start();
            Closing += OnClosing;

            // Nicht an Loaded hängen: bei --minimized (Autostart) wird das Fenster nie gezeigt, die Verbindung muss trotzdem stehen.
            _ = SwitchTo(servers.Active);

            // Zweiter Programmstart: vorhandenes Fenster nach vorn holen
            new Thread(() =>
            {
                while (true)
                {
                    showSignal.WaitOne();
                    try { Dispatcher.Invoke(ShowStudio); } catch { return; }
                }
            }) { IsBackground = true, Name = "AnMaChaCast.Show" }.Start();
            // AnMaChaCast.exe --quit (Update): nur das Fenster schließen, die Engine läuft weiter
            new Thread(() =>
            {
                quitSignal.WaitOne();
                try { Dispatcher.Invoke(CloseWindowOnly); } catch { }
            }) { IsBackground = true, Name = "AnMaChaCast.Quit" }.Start();
        }

        // ---------- Aufbau ----------

        void BuildLayout()
        {
            pages.AddRange(new View[]
            {
                new StudioPage(ctx), new LibraryPage(ctx), new PlaylistsPage(ctx), new PlanningPage(ctx), new OutputsPage(ctx), new SettingsPage(ctx), new PodcastPage(ctx), new StatsPage(ctx),
                new ListenersPage(ctx), new AiPage(ctx), new LautFmPage(ctx), new ServersPage(ctx), new SystemPage(ctx),
            });
            var icons = new[] { "🎚️", "🎵", "📃", "📅", "📡", "🔧", "🎙️", "📊", "💬", "✨", "📻", "🖧", "⚙️" };

            var root = new Grid { Margin = new Thickness(12) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var top = new DockPanel { LastChildFill = false, VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(clockText, Dock.Right);
            var web = Kit.Btn("Weitere Funktionen im Studio …", OpenBrowser, "Seltene Einstellungen im eingebetteten Web-Studio (Voice Studio, MusicHub, Einrichtungsassistent …)");
            DockPanel.SetDock(web, Dock.Right);
            top.Children.Add(Kit.Text("Server", 12, false, Kit.Muted));
            top.Children.Add(Spacer(6));
            top.Children.Add(serverPicker);
            top.Children.Add(Kit.Text("Sender", 12, false, Kit.Muted));
            top.Children.Add(Spacer(6));
            top.Children.Add(stationPicker);
            top.Children.Add(connText);
            top.Children.Add(clockText);
            top.Children.Add(web);
            root.Children.Add(new Border { Background = Kit.PanelBg, CornerRadius = new CornerRadius(6), Padding = new Thickness(10), Margin = new Thickness(0, 0, 0, 10), Child = top });

            var body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var navPanel = new StackPanel { Margin = new Thickness(0, 0, 10, 0) };
            for (var i = 0; i < pages.Count; i++)
            {
                var index = i;
                var b = new ToggleButton
                {
                    Content = icons[i] + "  " + pages[i].Title, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 9, 12, 9), Margin = new Thickness(0, 0, 0, 3),
                    Background = Kit.PanelBg, Foreground = Kit.Fg, BorderBrush = Kit.Line, FontSize = 14,
                };
                b.Click += (s, e) => ShowPage(index);
                nav.Add(b);
                navPanel.Children.Add(b);
                pages[i].Visibility = Visibility.Collapsed;
                host.Children.Add(pages[i]);
            }
            body.Children.Add(Kit.Scroll(navPanel));
            Grid.SetColumn(host, 1);
            body.Children.Add(host);
            Grid.SetRow(body, 1);
            root.Children.Add(body);

            var bar = new DockPanel { Margin = new Thickness(0, 10, 0, 0) };
            bar.Children.Add(statusText);
            Grid.SetRow(bar, 2);
            root.Children.Add(bar);
            Content = root;

            serverPicker.ItemsSource = servers.All;
            serverPicker.SelectionChanged += (s, e) =>
            {
                if (suppress || !(serverPicker.SelectedItem is ServerProfile p) || p.Id == servers.ActiveId) return;
                _ = SwitchTo(p);
            };
            stationPicker.SelectionChanged += (s, e) =>
            {
                if (suppress || !(stationPicker.SelectedItem is StationInfo st) || st.id == ctx.StationId) return;
                ctx.StationId = st.id;
                servers.Active.LastStation = st.id;
                servers.Save();
                StartEvents();
                _ = pages[current].Show();
            };
            ShowPageVisual(0);
        }

        static UIElement Spacer(double w) => new Border { Width = w };

        void BuildTray()
        {
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
        }

        void SetStatus(string text, bool bad)
        {
            if (Dispatcher.CheckAccess()) { statusText.Text = text; statusText.Foreground = bad ? Kit.Bad : Kit.Muted; }
            else Dispatcher.BeginInvoke(new Action(() => SetStatus(text, bad)));
        }

        // ---------- Navigation ----------

        void ShowPageVisual(int index)
        {
            current = index;
            for (var i = 0; i < pages.Count; i++)
            {
                pages[i].Visibility = i == index ? Visibility.Visible : Visibility.Collapsed;
                nav[i].IsChecked = i == index;
            }
        }

        void ShowPage(int index)
        {
            ShowPageVisual(index);
            _ = pages[index].Show();
        }

        // ---------- Verbindung ----------

        /// <summary>Zu einem Server wechseln (Motor dieses PCs oder entfernter Server) und alle Seiten neu laden.</summary>
        async Task SwitchTo(ServerProfile p)
        {
            var gen = ++generation;
            sseCts?.Cancel();
            SetStatus("Verbinde mit „" + p.Name + "“ …", false);
            connText.Text = "verbinde …";
            try
            {
                Uri origin;
                string token;
                if (p.IsLocal)
                {
                    if (!await EnsureEngine()) return;
                    var raw = new Uri(engine.Url);
                    origin = new Uri(raw.GetLeftPart(UriPartial.Authority));
                    token = ParseToken(raw.Fragment);
                }
                else
                {
                    if (string.IsNullOrEmpty(p.Token)) throw new ApiException(401, "Für diesen Server fehlt die Kopplung – unter „Server & Geräte“ erneut hinzufügen");
                    origin = new Uri(p.BaseUrl);
                    token = p.Token;
                }
                var client = new ApiClient(origin, token);
                await client.GetJ("/me", 15); // prüft Erreichbarkeit und Anmeldung
                var stations = await client.Stations();
                if (gen != generation) { client.Dispose(); return; }

                api?.Dispose();
                api = client;
                ctx.Api = client;
                ctx.Server = p;
                ctx.Stations = stations;
                servers.ActiveId = p.Id;
                var pick = stations.FirstOrDefault(s => s.id == p.LastStation) ?? stations.FirstOrDefault();
                ctx.StationId = pick?.id ?? "";
                servers.Save();
                suppress = true;
                serverPicker.ItemsSource = servers.All;
                serverPicker.SelectedItem = servers.All.FirstOrDefault(x => x.Id == p.Id);
                stationPicker.ItemsSource = stations;
                stationPicker.SelectedItem = pick;
                suppress = false;
                tray.Text = p.IsLocal ? "AnMaCha Cast läuft" : "AnMaCha Cast · " + p.Name;
                connText.Text = "verbunden";
                connText.Foreground = Kit.Good;
                SetStatus("Verbunden mit „" + p.Name + "“", false);
                downChecks = 0;
                if (!string.IsNullOrEmpty(ctx.StationId)) StartEvents();
                watch.Start();
                await pages[current].Show();
                if (p.IsLocal) _ = OfferSetup(client);
            }
            catch (Exception ex) when (!(ex is OutOfMemoryException))
            {
                if (gen != generation) return;
                api?.Dispose();
                api = null;
                ctx.Api = null;
                ctx.Server = p;
                servers.ActiveId = p.Id;
                servers.Save();
                suppress = true;
                serverPicker.ItemsSource = servers.All;
                serverPicker.SelectedItem = servers.All.FirstOrDefault(x => x.Id == p.Id);
                suppress = false;
                connText.Text = "getrennt";
                connText.Foreground = Kit.Bad;
                SetStatus("Verbindung zu „" + p.Name + "“ fehlgeschlagen: " + ex.Message, true);
                watch.Start();
                if (!p.IsLocal) ShowPage(pages.FindIndex(x => x is ServersPage));
            }
        }

        /// <summary>Erster Start dieser Installation: den Einrichtungsassistenten anbieten (er läuft im Web-Studio-Fenster).</summary>
        async Task OfferSetup(ApiClient client)
        {
            if (setupOffered) return;
            try
            {
                var s = await client.GetJ("/setup", 10);
                if (!J.Bool(s, "required")) return;
                setupOffered = true;
                if (!IsVisible) return; // Autostart im Hintergrund: nicht stören, beim nächsten sichtbaren Start erneut fragen
                if (Dlg.Confirm(this, "AnMaCha Cast ist noch nicht eingerichtet.\n\nDer Einrichtungsassistent führt durch Sender, Musikordner, Stream-Ausgang und KI. Jetzt öffnen?", "Willkommen bei AnMaCha Cast")) OpenBrowser();
            }
            catch (ApiException) { }
        }

        async Task<bool> EnsureEngine()
        {
            SetStatus("Engine startet …", false);
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
                return false;
            }
            return true;
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

        // ---------- Live-Ereignisse (SSE) ----------

        void StartEvents()
        {
            sseCts?.Cancel();
            sseCts = new CancellationTokenSource();
            var ct = sseCts.Token;
            var sid = ctx.StationId;
            var client = api;
            if (client == null || string.IsNullOrEmpty(sid)) return;
            Task.Run(async () =>
            {
                while (!ct.IsCancellationRequested)
                {
                    try { await client.Subscribe(sid, (type, data) => Dispatcher.BeginInvoke(new Action(() => { foreach (var pg in pages) pg.OnEvent(type); })), ct); }
                    catch { /* Verbindung verloren - kurze Pause, dann neu verbinden */ }
                    if (ct.IsCancellationRequested) break;
                    try { await Task.Delay(2000, ct); } catch (TaskCanceledException) { }
                }
            }, ct);
        }

        // ---------- Überwachung ----------

        async void Watch()
        {
            if (quitting) return;
            var p = servers.Active;
            if (p.IsLocal)
            {
                if (engine == null) return;
                var alive = await Task.Run(() => Engine.Alive(engine.Health));
                if (alive) { downChecks = 0; connText.Text = "verbunden"; connText.Foreground = Kit.Good; return; }
                if (++downChecks < 8) { connText.Text = "Engine antwortet nicht …"; connText.Foreground = Kit.Warn; return; }
                watch.Stop();
                ShowStudio();
                var r = System.Windows.MessageBox.Show(this, "Die AnMaCha-Cast-Engine läuft nicht mehr.\n\nJetzt neu starten?", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Warning);
                if (r != MessageBoxResult.Yes) { Quit(false); return; }
                downChecks = 0;
                await Task.Run(() => { Engine.Start(); Engine.WaitAlive(engine.Health, 90000); });
                engine = await Task.Run(() => Engine.Query());
                await SwitchTo(p);
                return;
            }
            try
            {
                await ApiClient.Health(new Uri(p.BaseUrl));
                downChecks = 0;
                if (ctx.Api != null) { connText.Text = "verbunden"; connText.Foreground = Kit.Good; }
            }
            catch
            {
                connText.Text = "Server nicht erreichbar";
                connText.Foreground = Kit.Bad;
            }
        }

        // ---------- Studio im Fenster (WebView2) ----------

        void OpenBrowser()
        {
            if (ctx.Api == null) { SetStatus("Erst mit einem Server verbinden", true); return; }
            var url = ctx.Api.Origin.GetLeftPart(UriPartial.Authority) + "/#token=" + Uri.EscapeDataString(ctx.Api.Token);
            if (browser == null || browser.IsDisposed) { browser = new BrowserForm(url); browser.Show(); }
            else browser.Activate();
        }

        // ---------- Fenster, Tray, Beenden ----------

        void ShowStudio()
        {
            if (!IsVisible) Show();
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();
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
            if (ask && System.Windows.MessageBox.Show(this, "AnMaCha Cast komplett beenden? Automation und alle Streams dieses PCs stoppen.", "AnMaCha Cast", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
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
