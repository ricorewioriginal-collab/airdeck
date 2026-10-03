// Mediathek: suchen, hochladen, bearbeiten, löschen, vorhören, in die Warteschlange oder auf ein Deck legen.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class LibraryPage : View
    {
        public static readonly (string, string)[] Categories =
        {
            ("music", "Musik"), ("jingle", "Jingle"), ("sweeper", "Sweeper"), ("station_id", "Senderkennung"), ("drop", "Drop"), ("news", "Nachrichten"),
            ("ad", "Werbung"), ("voice_track", "Voice-Track"), ("tts", "KI-Sprache"), ("bed", "Musikbett"), ("stream", "Stream"),
        };

        readonly Table table = new Table(("Titel", 270), ("Interpret", 190), ("Art", 110), ("Dauer", 60), ("Tags", 160));
        readonly TextBox search = Kit.Box("", 260);
        readonly ComboBox category = new ComboBox { Margin = new Thickness(3), MinWidth = 140 };
        readonly TextBlock count = Kit.Text("", 12, false, Kit.Muted);
        List<JsonElement> all = new List<JsonElement>();
        MediaPlayer player;
        string playingId;

        public override string Title => "Mediathek";

        public LibraryPage(Ctx c) : base(c)
        {
            category.Items.Add("Alle Arten");
            foreach (var cat in Categories) category.Items.Add(cat.Item2);
            category.SelectedIndex = 0;
            category.SelectionChanged += (s, e) => Filter();
            search.TextChanged += (s, e) => Filter();
            search.ToolTip = "Suchen in Titel, Interpret und Tags";

            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var bar = Kit.Wrap(
                Kit.Text("Suchen:", 13, false, Kit.Muted), search, category,
                Kit.Btn("Hochladen …", Upload, "Audiodateien (MP3, WAV, FLAC, OGG, M4A …) in die Mediathek laden", true),
                Kit.Btn("Neu laden", Load));
            Children.Add(bar);

            table.MouseDoubleClick += async (s, e) => await Preview();
            SetRow(table, 1);
            Children.Add(table);

            var deckMenu = new ContextMenu();
            foreach (var d in new[] { "A", "B", "C", "D" })
            {
                var id = d;
                var mi = new MenuItem { Header = "Deck " + d };
                mi.Click += async (s, e) => await ToDeck(id);
                deckMenu.Items.Add(mi);
            }
            var deckBtn = Kit.Btn("Auf Deck ▾", () => { }, "Gewählten Titel auf ein Deck laden");
            deckBtn.ContextMenu = deckMenu;
            deckBtn.Click += (s, e) => { deckMenu.PlacementTarget = deckBtn; deckMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom; deckMenu.IsOpen = true; };

            var actions = Kit.Wrap(count,
                Kit.Btn("Vorhören", Preview, "Titel herunterladen und hier abspielen (Doppelklick)"),
                Kit.Btn("In die Warteschlange", Enqueue), deckBtn,
                Kit.Btn("Bearbeiten …", Edit), Kit.Btn("Löschen", Delete));
            SetRow(actions, 2);
            Children.Add(actions);
        }

        public override Task Show() => Load();

        public override void OnEvent(string type) { if (type == "library.changed" && IsVisible) _ = Load(); }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () => { all = J.Arr(await C.Api.GetJ(C.St("/media"))).ToList(); Filter(); }, "Mediathek");
        }

        void Filter()
        {
            var q = search.Text.Trim().ToLowerInvariant();
            var cat = category.SelectedIndex > 0 ? Categories[category.SelectedIndex - 1].Item1 : null;
            var rows = all.Where(m => (cat == null || J.Str(m, "category") == cat)
                    && (q.Length == 0 || (J.Str(m, "title") + " " + J.Str(m, "artist") + " " + string.Join(" ", J.Strings(m, "tags"))).ToLowerInvariant().Contains(q)))
                .OrderBy(m => J.Str(m, "artist").ToLowerInvariant()).ThenBy(m => J.Str(m, "title").ToLowerInvariant()).ToList();
            table.Set(rows.Take(2000).Select(m => new Row(m, J.Str(m, "title"), J.Str(m, "artist"), CategoryLabel(J.Str(m, "category")),
                Fmt.Dur(J.Ok(J.Get(m, "durationMs")) ? J.Long(m, "durationMs") : (long?)null), string.Join(", ", J.Strings(m, "tags")))));
            count.Text = rows.Count + " von " + all.Count + " Titeln   ";
        }

        static string CategoryLabel(string id) => Categories.FirstOrDefault(c => c.Item1 == id).Item2 ?? id;

        // ---------- Aktionen ----------

        async Task Upload()
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Multiselect = true, Title = "Audiodateien hochladen", Filter = "Audio|*.mp3;*.wav;*.flac;*.ogg;*.opus;*.m4a;*.aac;*.webm|Alle Dateien|*.*" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            var v = Dlg.Form(C.Owner, "Hochladen", "Hochladen", Field.Info("Dateien", dlg.FileNames.Length + " Datei(en)"), Field.Choice("cat", "Art der Titel", "music", Categories));
            if (v == null) return;
            var done = 0;
            foreach (var file in dlg.FileNames)
            {
                C.Status("Lade hoch (" + (done + 1) + "/" + dlg.FileNames.Length + "): " + Path.GetFileName(file) + " …", false);
                var ok = await C.Run(() => C.Api.UploadFile(C.St("/media?name=" + Uri.EscapeDataString(Path.GetFileName(file)) + "&category=" + Uri.EscapeDataString(v["cat"])), file), Path.GetFileName(file));
                if (!ok) return;
                done++;
            }
            C.Ok(done + " Datei(en) hochgeladen");
            await Load();
        }

        async Task Enqueue()
        {
            var rows = table.Many.ToList();
            if (rows.Count == 0) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.PostJ(C.St("/queue"), new { mediaId = J.Str(r.El, "id") }); C.Ok(rows.Count + " Titel eingereiht"); }, "Warteschlange");
        }

        async Task ToDeck(string deck)
        {
            var r = table.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.DeckAction(C.StationId, deck, "load", new { mediaId = J.Str(r.El, "id") }); C.Ok("Auf Deck " + deck + " geladen: " + J.Str(r.El, "title")); }, "Deck " + deck);
        }

        async Task Edit()
        {
            var r = table.One;
            if (r == null) return;
            var m = r.El;
            var v = Dlg.Form(C.Owner, "Titel bearbeiten", "Speichern",
                Field.Text("title", "Titel", J.Str(m, "title")), Field.Text("artist", "Interpret", J.Str(m, "artist")),
                Field.Choice("category", "Art", J.Str(m, "category"), Categories),
                Field.Text("tags", "Tags (mit Komma getrennt)", string.Join(", ", J.Strings(m, "tags"))));
            if (v == null) return;
            var tags = v["tags"].Split(',').Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToArray();
            await C.Run(async () => { await C.Api.PatchJ(C.St("/media/" + Uri.EscapeDataString(J.Str(m, "id"))), new { title = v["title"], artist = v["artist"], category = v["category"], tags }); await Load(); C.Ok("Gespeichert"); }, "Titel");
        }

        async Task Delete()
        {
            var rows = table.Many.ToList();
            if (rows.Count == 0 || !Dlg.Confirm(C.Owner, rows.Count == 1 ? "„" + J.Str(rows[0].El, "title") + "“ endgültig löschen?" : rows.Count + " Titel endgültig löschen?")) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St("/media/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); C.Ok(rows.Count + " Titel gelöscht"); }, "Löschen");
        }

        /// <summary>Vorhören: Datei laden und hier abspielen; zweiter Aufruf für denselben Titel stoppt.</summary>
        async Task Preview()
        {
            var r = table.One;
            if (r == null) return;
            var id = J.Str(r.El, "id");
            if (playingId == id) { StopPreview(); return; }
            StopPreview();
            await C.Run(async () =>
            {
                C.Status("Lade Vorschau …", false);
                var data = await C.Api.Download(C.St("/media/" + Uri.EscapeDataString(id) + "/file"));
                var ext = Path.GetExtension(J.Str(r.El, "file"));
                var path = Path.Combine(Path.GetTempPath(), "anmachacast-vorschau" + (string.IsNullOrEmpty(ext) ? ".mp3" : ext));
                File.WriteAllBytes(path, data);
                player = new MediaPlayer();
                player.MediaEnded += (s, e) => StopPreview();
                player.MediaFailed += (s, e) => { StopPreview(); C.Status("Vorschau nicht abspielbar", true); };
                player.Open(new Uri(path));
                player.Play();
                playingId = id;
                C.Ok("Vorschau: " + J.Str(r.El, "title") + " (Doppelklick stoppt)");
            }, "Vorschau");
        }

        public void StopPreview()
        {
            try { player?.Stop(); player?.Close(); } catch { }
            player = null;
            playingId = null;
        }
    }
}
