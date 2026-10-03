// Studio: Betriebsart, On-Air, Mikrofon, die vier Decks (A–D), Cardwall und Warteschlange - die Bedienung im Sendebetrieb.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;
using AnMaChaCast.ViewModels;

namespace AnMaChaCast.Pages
{
    sealed class StudioPage : View
    {
        static readonly string[] DeckIds = { "A", "B", "C", "D" };

        readonly List<DeckViewModel> decks = DeckIds.Select(id => new DeckViewModel(id)).ToList();
        readonly List<DeckCard> cards = new List<DeckCard>();
        readonly WrapPanel cartPanel = new WrapPanel();
        readonly Table queue = new Table(("Zeit", 60), ("Titel", 200), ("Interpret", 130), ("Dauer", 55));
        readonly DispatcherTimer watch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        readonly DispatcherTimer tick = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };

        readonly System.Windows.Shapes.Ellipse dot = new System.Windows.Shapes.Ellipse { Width = 14, Height = 14, Fill = Brushes.Gray, Margin = new Thickness(0, 0, 6, 0) };
        readonly TextBlock onAir = Kit.Text("OFF AIR", 14, true);
        readonly ToggleButton btnAuto;
        readonly ToggleButton btnManual;
        readonly ToggleButton btnMic;
        readonly Button btnStream;

        Dictionary<string, MediaItem> library = new Dictionary<string, MediaItem>();
        bool micOn;
        bool busRunning;
        bool loaded;

        public override string Title => "Studio";

        public StudioPage(Ctx c) : base(c)
        {
            btnAuto = Kit.Toggle("24/7 · AUTO", () => _ = SetMode("AUTO"));
            btnManual = Kit.Toggle("MANUAL", () => _ = SetMode("MANUAL"));
            btnMic = Kit.Toggle("🎙 Mikrofon", () => _ = ToggleMic());
            btnStream = Kit.Btn("Sendung starten", ToggleStream);

            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            var header = new Border { Background = Kit.PanelBg, CornerRadius = new CornerRadius(6), Padding = new Thickness(10), Margin = new Thickness(0, 0, 0, 10) };
            header.Child = Kit.H(dot, onAir, new Border { Width = 24 }, btnAuto, btnManual, new Border { Width = 12 }, btnMic, btnStream);
            Children.Add(header);

            var deckGrid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 0, 0, 6) };
            foreach (var d in decks) { var card = new DeckCard(d, this); cards.Add(card); deckGrid.Children.Add(card); }
            SetRow(deckGrid, 1);
            Children.Add(deckGrid);

            var lower = new Grid();
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(470) });
            var cartCard = Kit.Card("Cardwall", Kit.Scroll(cartPanel), "Taste klicken = abspielen · Rechtsklick = belegen oder leeren");
            cartCard.Margin = new Thickness(0, 0, 10, 0);
            lower.Children.Add(cartCard);
            var qBody = new Grid();
            qBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            qBody.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            qBody.Children.Add(queue);
            var qButtons = Kit.Wrap(
                Kit.Btn("Titel einreihen …", AddToQueue),
                Kit.Btn("Entfernen", RemoveFromQueue),
                Kit.Btn("▲", () => MoveInQueue(-1), "Nach oben"),
                Kit.Btn("▼", () => MoveInQueue(1), "Nach unten"),
                Kit.Btn("Mischen", () => QueueAction("shuffle")),
                Kit.Btn("Auffüllen", () => QueueAction("fill"), "Aus der Rotation auffüllen"),
                Kit.Btn("Leeren", ClearQueue));
            Grid.SetRow(qButtons, 1);
            qBody.Children.Add(qButtons);
            var qCard = Kit.Card("Warteschlange", qBody);
            SetColumn(qCard, 1);
            lower.Children.Add(qCard);
            SetRow(lower, 2);
            Children.Add(lower);

            watch.Tick += (s, e) => { if (IsVisible && C.Connected) _ = RefreshQuiet(); };
            tick.Tick += (s, e) => { foreach (var d in decks) d.Tick(500); };
            tick.Start();
            watch.Start();
        }

        // ---------- Laden ----------

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var lib = C.Api.Library(C.StationId);
                var carts = C.Api.Cardwall(C.StationId);
                var mode = C.Api.Mode(C.StationId);
                var playout = C.Api.Playout(C.StationId);
                await Task.WhenAll(lib, carts, mode, playout);
                library = lib.Result.Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                ApplyCarts(carts.Result);
                ApplyMode(mode.Result);
                await ApplyPlayout(playout.Result);
                await LoadQueue();
                loaded = true;
            }, "Studio laden");
        }

        async Task RefreshQuiet()
        {
            try
            {
                var mode = C.Api.Mode(C.StationId);
                var playout = C.Api.Playout(C.StationId);
                await Task.WhenAll(mode, playout);
                ApplyMode(mode.Result);
                await ApplyPlayout(playout.Result);
            }
            catch { /* nächster Versuch in 3 s */ }
        }

        public override async void OnEvent(string type)
        {
            if (!C.Connected || !loaded) return;
            try
            {
                switch (type)
                {
                    case "library.changed":
                        library = (await C.Api.Library(C.StationId)).Where(m => m.id != null).ToDictionary(m => m.id, m => m);
                        break;
                    case "cardwall.changed":
                    case "cardwall.triggered":
                        ApplyCarts(await C.Api.Cardwall(C.StationId));
                        break;
                    case "deck.state_changed":
                    case "playout.state":
                        await ApplyPlayout(await C.Api.Playout(C.StationId));
                        break;
                    case "automation.state_changed":
                    case "station.changed":
                        ApplyMode(await C.Api.Mode(C.StationId));
                        await ApplyPlayout(await C.Api.Playout(C.StationId));
                        break;
                    case "queue.changed":
                        await LoadQueue();
                        break;
                }
            }
            catch { /* das nächste Ereignis oder der 3-s-Abgleich korrigiert es */ }
        }

        void ApplyMode(ModeView m)
        {
            if (m == null) return;
            btnAuto.IsChecked = m.Base == "AUTO";
            btnManual.IsChecked = m.Base == "MANUAL";
            var live = m.mode == "LIVE";
            dot.Fill = live ? Brushes.OrangeRed : (m.mode == "EMERGENCY" ? Brushes.Gold : Brushes.LimeGreen);
            onAir.Text = live ? "ON AIR · LIVE · " + m.live : m.mode == "EMERGENCY" ? "ON AIR · NOTFALL" : "ON AIR · " + m.mode;
        }

        async Task ApplyPlayout(PlayoutView p)
        {
            busRunning = p?.status?.running == true;
            micOn = p?.status?.micOn == true;
            btnMic.IsChecked = micOn;
            ((Button)btnStream).Content = busRunning ? "Sendung stoppen" : "Sendung starten";

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
                    vm.Tempo = ed.tempo ?? 1;
                }
                return;
            }
            // Server-Playout noch nicht gestartet: einfache Deck-Grunddaten mit Titeln aus der Mediathek
            try
            {
                foreach (var d in await C.Api.Decks(C.StationId))
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
            catch { }
        }

        // ---------- Kopfzeile ----------

        async Task SetMode(string mode)
        {
            await C.Run(async () => ApplyMode(await C.Api.SetMode(C.StationId, mode)), "Betriebsart");
        }

        async Task ToggleMic()
        {
            await C.Run(async () => { await C.Api.SetMic(C.StationId, !micOn); await ApplyPlayout(await C.Api.Playout(C.StationId)); }, "Mikrofon");
        }

        async Task ToggleStream()
        {
            await C.Run(async () =>
            {
                if (busRunning)
                {
                    if (!Dlg.Confirm(C.Owner, "Server-Playout stoppen? Der Sender fällt auf die nächste Quelle zurück.")) return;
                    await ApplyPlayout(await C.Api.StopPlayout(C.StationId));
                }
                else await ApplyPlayout(await C.Api.StartPlayout(C.StationId));
            }, "Sendung");
        }

        // ---------- Decks ----------

        public Task DeckAction(DeckViewModel d, string action, object body = null) =>
            C.Run(async () => { await C.Api.DeckAction(C.StationId, d.Id, action, body); await ApplyPlayout(await C.Api.Playout(C.StationId)); }, "Deck " + d.Id);

        public Task Skip(DeckViewModel d, int deltaMs)
        {
            var target = Math.Max(0, d.PositionMs + deltaMs);
            return C.Run(async () => { await C.Api.DeckAction(C.StationId, d.Id, "seek", new { ms = target }); d.PositionMs = target; }, "Deck " + d.Id);
        }

        public async Task LoadIntoDeck(DeckViewModel d)
        {
            var id = Dlg.Pick(C.Owner, "Titel auf Deck " + d.Id + " laden", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            await DeckAction(d, "load", new { mediaId = id });
        }

        public Task SetTempo(DeckViewModel d, double tempo) => DeckAction(d, "tempo", new { tempo = Math.Round(tempo, 2) });

        static string Label(MediaItem m) => string.IsNullOrEmpty(m.artist) ? m.title : m.artist + " – " + m.title;

        // ---------- Cardwall ----------

        void ApplyCarts(List<CartSlot> slots)
        {
            cartPanel.Children.Clear();
            foreach (var slot in slots)
            {
                var s = slot;
                Brush color;
                try { color = (Brush)new BrushConverter().ConvertFromString(string.IsNullOrEmpty(s.color) ? "#2A3C56" : s.color); } catch { color = Brushes.DimGray; }
                var has = !string.IsNullOrEmpty(s.mediaId);
                var b = new Button
                {
                    Width = 140, Height = 56, Margin = new Thickness(3), Background = has ? color : Brushes.Transparent, BorderBrush = Kit.Line, Foreground = Brushes.White,
                    Content = new TextBlock { Text = string.IsNullOrEmpty(s.label) ? (has ? "Cart" : "– frei –") : s.label, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontWeight = FontWeights.SemiBold },
                };
                b.Click += async (o, e) => { if (has) await C.Run(() => C.Api.TriggerCart(C.StationId, s.id), "Cart"); };
                var menu = new ContextMenu();
                var assign = new MenuItem { Header = "Titel zuweisen …" };
                assign.Click += async (o, e) => await AssignCart(s);
                var clear = new MenuItem { Header = "Leeren" };
                clear.Click += async (o, e) => await C.Run(async () => { await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = (string)null, label = "" }); ApplyCarts(await C.Api.Cardwall(C.StationId)); }, "Cart");
                menu.Items.Add(assign);
                menu.Items.Add(clear);
                b.ContextMenu = menu;
                cartPanel.Children.Add(b);
            }
        }

        async Task AssignCart(CartSlot s)
        {
            var id = Dlg.Pick(C.Owner, "Titel für diese Taste", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            var m = library[id];
            var v = Dlg.Form(C.Owner, "Cart beschriften", "Speichern", Field.Text("label", "Beschriftung", string.IsNullOrEmpty(s.label) ? m.title : s.label));
            if (v == null) return;
            await C.Run(async () =>
            {
                await C.Api.PatchJ(C.St("/cardwall/" + Uri.EscapeDataString(s.id)), new { mediaId = id, label = v["label"] });
                ApplyCarts(await C.Api.Cardwall(C.StationId));
            }, "Cart");
        }

        // ---------- Warteschlange ----------

        async Task LoadQueue()
        {
            var q = await C.Api.GetJ(C.St("/queue"));
            queue.Set(J.Arr(q, "items").Select(it => new Row(it,
                it.TryGetProperty("startsAt", out var sa) && sa.ValueKind == JsonValueKind.Number ? DateTimeOffset.FromUnixTimeMilliseconds(sa.GetInt64()).ToLocalTime().ToString("HH:mm") : "",
                J.Str(it, "media.title", J.Str(it, "mediaId")), J.Str(it, "media.artist"), Fmt.Dur(J.Ok(J.At(it, "media.durationMs")) ? J.Long(it, "media.durationMs") : (long?)null))));
        }

        async Task AddToQueue()
        {
            var id = Dlg.Pick(C.Owner, "Titel einreihen", library.Values.OrderBy(m => m.artist).ThenBy(m => m.title).Select(m => (m.id, Label(m))).ToList());
            if (id == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue"), new { mediaId = id }); await LoadQueue(); }, "Warteschlange");
        }

        async Task RemoveFromQueue()
        {
            var rows = queue.Many.ToList();
            if (rows.Count == 0) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St("/queue/" + Uri.EscapeDataString(J.Str(r.El, "uid")))); await LoadQueue(); }, "Warteschlange");
        }

        async Task MoveInQueue(int delta)
        {
            var r = queue.One;
            if (r == null) return;
            var index = queue.Items.IndexOf(r) + delta;
            if (index < 0 || index >= queue.Items.Count) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + Uri.EscapeDataString(J.Str(r.El, "uid")) + "/move"), new { to = index }); await LoadQueue(); queue.SelectedIndex = index; }, "Warteschlange");
        }

        Task QueueAction(string action) => C.Run(async () => { await C.Api.PostJ(C.St("/queue/" + action)); await LoadQueue(); }, "Warteschlange");

        async Task ClearQueue()
        {
            if (queue.Items.Count == 0 || !Dlg.Confirm(C.Owner, "Die ganze Warteschlange leeren?")) return;
            await QueueAction("clear");
        }
    }

    /// <summary>Ein Deck als Karte: Titel, Fortschritt, Bedienung. Aktualisiert sich selbst aus dem DeckViewModel.</summary>
    sealed class DeckCard : Border
    {
        readonly DeckViewModel vm;
        readonly TextBlock title = Kit.Text("", 14, true);
        readonly TextBlock artist = Kit.Text("", 12, false, Kit.Muted);
        readonly TextBlock status = Kit.Text("", 12, false, Kit.Muted);
        readonly TextBlock remain = new TextBlock { Foreground = Kit.Muted, FontFamily = new FontFamily("Consolas"), HorizontalAlignment = HorizontalAlignment.Right };
        readonly ProgressBar bar = new ProgressBar { Height = 6, Minimum = 0, Maximum = 1, Background = Kit.Bg, Foreground = Kit.Accent, BorderThickness = new Thickness(0), Margin = new Thickness(0, 4, 0, 2) };
        readonly Slider tempo = new Slider { Minimum = 0.8, Maximum = 1.25, Value = 1, TickFrequency = 0.05, SmallChange = 0.01, LargeChange = 0.05, IsSnapToTickEnabled = false };
        readonly TextBlock tempoText = Kit.Text("1,00×", 11, false, Kit.Muted);
        bool settingTempo;
        bool dragging;

        public DeckCard(DeckViewModel vm, StudioPage page)
        {
            this.vm = vm;
            Background = Kit.PanelBg;
            CornerRadius = new CornerRadius(6);
            Margin = new Thickness(4);
            Padding = new Thickness(10);

            var head = new DockPanel();
            var id = Kit.Text(vm.Id, 16, true, Kit.Accent);
            id.Width = 24;
            DockPanel.SetDock(id, Dock.Left);
            DockPanel.SetDock(status, Dock.Right);
            head.Children.Add(id);
            head.Children.Add(status);
            head.Children.Add(title);

            var buttons = new UniformGrid { Rows = 1, Columns = 6 };
            buttons.Children.Add(Kit.Btn("⏮10s", () => page.Skip(vm, -10000), "10 Sekunden zurück"));
            buttons.Children.Add(Kit.Btn("▶", () => page.DeckAction(vm, "play"), "Abspielen"));
            buttons.Children.Add(Kit.Btn("⏸", () => page.DeckAction(vm, "pause"), "Pause"));
            buttons.Children.Add(Kit.Btn("⏹", () => page.DeckAction(vm, "stop"), "Stopp (bereit)"));
            buttons.Children.Add(Kit.Btn("10s⏭", () => page.Skip(vm, 10000), "10 Sekunden vor"));
            buttons.Children.Add(Kit.Btn("⏏", () => page.DeckAction(vm, "eject"), "Deck leeren"));

            tempo.ValueChanged += (s, e) => tempoText.Text = tempo.Value.ToString("0.00", System.Globalization.CultureInfo.GetCultureInfo("de-DE")) + "×";
            tempo.PreviewMouseLeftButtonDown += (s, e) => dragging = true;
            tempo.PreviewMouseLeftButtonUp += async (s, e) => { dragging = false; if (!settingTempo) await page.SetTempo(vm, tempo.Value); };
            tempo.ToolTip = "Tempo 0,8–1,25 (Tonhöhe bleibt) – loslassen zum Übernehmen; Doppelklick = normal";
            tempo.MouseDoubleClick += async (s, e) => { tempo.Value = 1; await page.SetTempo(vm, 1); };
            var tempoRow = new DockPanel { Margin = new Thickness(0, 6, 0, 0) };
            DockPanel.SetDock(tempoText, Dock.Right);
            tempoRow.Children.Add(tempoText);
            tempoRow.Children.Add(tempo);

            var load = Kit.Btn("Titel laden …", () => page.LoadIntoDeck(vm));
            load.HorizontalAlignment = HorizontalAlignment.Stretch;

            Child = Kit.V(head, artist, bar, remain, buttons, tempoRow, load);
            vm.PropertyChanged += (s, e) => Update();
            Update();
        }

        void Update()
        {
            title.Text = vm.Title;
            artist.Text = vm.Artist;
            status.Text = vm.StatusLabel;
            bar.Value = vm.ProgressFraction;
            remain.Text = vm.RemainingLabel;
            if (!dragging && Math.Abs(tempo.Value - vm.Tempo) > 0.004)
            {
                settingTempo = true;
                tempo.Value = vm.Tempo;
                settingTempo = false;
            }
        }
    }
}
