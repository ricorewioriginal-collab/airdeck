// Planung & Aufnahme: Aufnahme starten/stoppen, Mitschnitte, automatische Aufnahmen, Sendeplan, Uhr-Ereignisse, Aufgaben.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class PlanningPage : View
    {
        readonly TextBlock recState = Kit.Text("", 14, true);
        readonly Table recordings = new Table(("Start", 120), ("Name", 230), ("Dauer", 70), ("Größe", 80));
        readonly Table recPlans = new Table(("Name", 200), ("Tage", 120), ("Zeit", 110));
        readonly Table plans = new Table(("Sendung", 220), ("Tage", 110), ("Zeit", 110), ("Playlist", 220), ("Gemischt", 70));
        readonly Table clocks = new Table(("Eintrag", 320), ("Minuten", 110), ("Stunden", 110), ("Tage", 110), ("An", 50));
        readonly Table jobs = new Table(("Zeitpunkt", 140), ("Aufgabe", 280), ("Wiederholung", 120));
        Dictionary<string, string> playlistNames = new Dictionary<string, string>();
        bool recording;

        public override string Title => "Planung & Aufnahme";

        public PlanningPage(Ctx c) : base(c)
        {
            var tabs = new TabControl { Background = Kit.PanelBg, BorderBrush = Kit.Line };

            var rec = new Grid { Margin = new Thickness(8) };
            rec.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            rec.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            rec.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            rec.Children.Add(Kit.H(recState, Kit.Btn("● Aufnahme starten", StartRec, "Nimmt das Sendesignal auf", true), Kit.Btn("■ Stopp", StopRec)));
            Grid.SetRow(recordings, 1);
            rec.Children.Add(recordings);
            var rb = Kit.Wrap(Kit.Btn("Speichern unter …", SaveRecording), Kit.Btn("Als Podcast-Episode", ToEpisode), Kit.Btn("Zur Nextcloud", ToNextcloud), Kit.Btn("Löschen", DeleteRecording));
            Grid.SetRow(rb, 2);
            rec.Children.Add(rb);
            tabs.Items.Add(new TabItem { Header = "Aufnahme", Content = rec });

            tabs.Items.Add(new TabItem { Header = "Automatische Aufnahmen", Content = ListTab(recPlans, "Z. B. „Morning Show“ Mo–Fr 06:00–10:00 automatisch mitschneiden.",
                Kit.Btn("Neues Zeitfenster …", AddRecPlan, null, true), Kit.Btn("Löschen", () => DeleteRow(recPlans, "/rec-plans/"))) });
            tabs.Items.Add(new TabItem { Header = "Sendeplan", Content = ListTab(plans, "Sendungen mit fester Zeit, die eine Playlist spielen.",
                Kit.Btn("Neue Sendung …", AddPlan, null, true), Kit.Btn("Löschen", () => DeleteRow(plans, "/plans/"))) });
            tabs.Items.Add(new TabItem { Header = "Uhr-Ereignisse", Content = ListTab(clocks, "Jingles, Nachrichten und Ansagen zu festen Minuten jeder Stunde. Neue Einträge legst du im Studio unter „Weitere Funktionen“ an.",
                Kit.Btn("An/Aus", ToggleClock), Kit.Btn("▶ Jetzt auslösen", FireClock), Kit.Btn("Löschen", () => DeleteRow(clocks, "/clock-events/"))) });
            tabs.Items.Add(new TabItem { Header = "Aufgaben", Content = ListTab(jobs, "Einmalige und wiederkehrende zeitgesteuerte Aufgaben.", Kit.Btn("Löschen", () => DeleteRow(jobs, "/jobs/"))) });
            Children.Add(tabs);
        }

        static UIElement ListTab(Table table, string hint, params UIElement[] buttons)
        {
            var g = new Grid { Margin = new Thickness(8) };
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var h = Kit.Hint(hint);
            h.Margin = new Thickness(0, 0, 0, 6);
            g.Children.Add(h);
            Grid.SetRow(table, 1);
            g.Children.Add(table);
            var b = Kit.Wrap(buttons);
            Grid.SetRow(b, 2);
            g.Children.Add(b);
            return g;
        }

        public override Task Show() => Load();

        public override void OnEvent(string type)
        {
            if ((type == "planning.changed" || type == "recorder.changed") && IsVisible) _ = Load();
        }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var rec = C.Api.GetJ(C.St("/recordings"));
                var plan = C.Api.GetJ(C.St("/planning"));
                var pl = C.Api.GetJ(C.St("/playlists"));
                await Task.WhenAll(rec, plan, pl);
                playlistNames = J.Arr(pl.Result).GroupBy(p => J.Str(p, "id")).ToDictionary(g => g.Key, g => J.Str(g.First(), "name"));

                var cur = J.At(rec.Result, "recording");
                recording = J.Ok(cur);
                recState.Text = recording ? "● REC · " + J.Str(cur, "label") + " · " + Fmt.Size(J.Long(cur, "bytes")) : "Aufnahme bereit   ";
                recordings.Set(J.Arr(rec.Result, "recordings").Select(r => new Row(r, Fmt.Stamp(J.Long(r, "startedAt")), J.Str(r, "label"),
                    J.Long(r, "endedAt") > 0 ? Fmt.Dur(J.Long(r, "endedAt") - J.Long(r, "startedAt")) : "läuft", Fmt.Size(J.Long(r, "bytes")))));

                var p = plan.Result;
                recPlans.Set(J.Arr(p, "recPlans").Select(x => new Row(x, J.Str(x, "label"), Fmt.Days(J.Ints(x, "days")), J.Str(x, "from") + "–" + J.Str(x, "to"))));
                plans.Set(J.Arr(p, "plans").Select(x => new Row(x, J.Str(x, "label"), Fmt.Days(J.Ints(x, "days")), J.Str(x, "from") + "–" + J.Str(x, "to"),
                    playlistNames.TryGetValue(J.Str(x, "playlistId"), out var n) ? n : "–", J.Bool(x, "shuffle") ? "ja" : "nein")));
                clocks.Set(J.Arr(p, "clockEvents").Select(x => new Row(x, J.Str(x, "label", J.Str(x, "kind")), string.Join(",", J.Ints(x, "minutes")),
                    J.Ints(x, "hours").Count == 0 ? "jede" : string.Join(",", J.Ints(x, "hours")), Fmt.Days(J.Ints(x, "days")), J.Bool(x, "enabled", true) ? "✔" : "–")));
                jobs.Set(J.Arr(p, "jobs").Select(x => new Row(x, Fmt.Stamp(J.Long(x, "at")), J.Str(x, "label", J.Str(x, "kind")), J.Str(x, "repeat", "none") == "none" ? "einmalig" : J.Str(x, "repeat"))));
            }, "Planung");
        }

        // ---------- Aufnahme ----------

        async Task StartRec()
        {
            if (recording) { C.Status("Es läuft bereits eine Aufnahme", true); return; }
            var v = Dlg.Form(C.Owner, "Aufnahme starten", "Starten", Field.Text("label", "Name", "Sendung " + DateTime.Now.ToString("dd.MM.yyyy HH:mm")));
            if (v == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/recorder/start"), new { label = v["label"] }); await Load(); }, "Aufnahme");
        }

        Task StopRec() => C.Run(async () => { await C.Api.PostJ(C.St("/recorder/stop")); await Load(); }, "Aufnahme");

        async Task SaveRecording()
        {
            var r = recordings.One;
            if (r == null) return;
            var name = J.Str(r.El, "label");
            foreach (var ch in Path.GetInvalidFileNameChars()) name = name.Replace(ch, '_');
            var ext = Path.GetExtension(J.Str(r.El, "file"));
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = name + (string.IsNullOrEmpty(ext) ? ".mp3" : ext), Title = "Mitschnitt speichern" };
            if (dlg.ShowDialog(C.Owner) != true) return;
            await C.Run(async () => { C.Status("Lade Mitschnitt …", false); File.WriteAllBytes(dlg.FileName, await C.Api.Download(C.St("/recordings/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/file"))); C.Ok("Gespeichert: " + dlg.FileName); }, "Mitschnitt");
        }

        async Task ToEpisode()
        {
            var r = recordings.One;
            if (r == null) return;
            var v = Dlg.Form(C.Owner, "Podcast-Episode anlegen", "Anlegen", Field.Text("title", "Titel", J.Str(r.El, "label")), Field.Multi("description", "Shownotes"));
            if (v == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/podcast/episodes"), new { recordingId = J.Str(r.El, "id"), title = v["title"], description = v["description"] }); C.Ok("Episode als Entwurf angelegt – unter „Podcast“ veröffentlichen"); }, "Podcast");
        }

        async Task ToNextcloud()
        {
            var r = recordings.One;
            if (r == null) return;
            await C.Run(async () => { var u = await C.Api.PostJ(C.St("/recordings/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/nextcloud"), new { dir = "AnMaCha-Cast-Mitschnitte" }, 600); C.Ok("In der Nextcloud: " + J.Str(u, "uploaded")); }, "Nextcloud");
        }

        async Task DeleteRecording()
        {
            var r = recordings.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Mitschnitt „" + J.Str(r.El, "label") + "“ löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/recordings/" + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); }, "Mitschnitt");
        }

        // ---------- Listen ----------

        async Task DeleteRow(Table t, string prefix)
        {
            var rows = t.Many.ToList();
            if (rows.Count == 0 || !Dlg.Confirm(C.Owner, rows.Count + " Eintrag/Einträge löschen?")) return;
            await C.Run(async () => { foreach (var r in rows) await C.Api.DeleteJ(C.St(prefix + Uri.EscapeDataString(J.Str(r.El, "id")))); await Load(); }, "Löschen");
        }

        Field[] WindowFields(string label)
        {
            return new[] { Field.Text("label", "Name", label), Field.Text("days", "Tage (Mo,Di,… – leer = täglich)", ""), Field.Text("from", "Von (HH:MM)", "20:00"), Field.Text("to", "Bis (HH:MM)", "22:00") };
        }

        static string CheckWindow(Dictionary<string, string> v) =>
            !Fmt.ValidTime(v["from"].Trim()) || !Fmt.ValidTime(v["to"].Trim()) ? "Uhrzeiten bitte als HH:MM (z. B. 06:30)" : null;

        async Task AddRecPlan()
        {
            var v = Dlg.Form(C.Owner, "Automatische Aufnahme", "Anlegen", WindowFields("Sendung"));
            if (v == null) return;
            var bad = CheckWindow(v);
            if (bad != null) { C.Status(bad, true); return; }
            await C.Run(async () => { await C.Api.PostJ(C.St("/rec-plans"), new { label = v["label"], days = Fmt.ParseDays(v["days"]), from = v["from"].Trim(), to = v["to"].Trim() }); await Load(); }, "Aufnahme");
        }

        async Task AddPlan()
        {
            if (playlistNames.Count == 0) { C.Status("Lege zuerst eine Playlist an", true); return; }
            var fields = WindowFields("Sendung").Concat(new[]
            {
                Field.Choice("playlist", "Playlist", playlistNames.Keys.First(), playlistNames.Select(p => (p.Key, p.Value)).ToArray()),
                Field.Check("shuffle", "Gemischt abspielen", true),
            }).ToArray();
            var v = Dlg.Form(C.Owner, "Neue Sendung im Sendeplan", "Anlegen", fields);
            if (v == null) return;
            var bad = CheckWindow(v);
            if (bad != null) { C.Status(bad, true); return; }
            await C.Run(async () =>
            {
                await C.Api.PostJ(C.St("/plans"), new { label = v["label"], days = Fmt.ParseDays(v["days"]), from = v["from"].Trim(), to = v["to"].Trim(), playlistId = v["playlist"], shuffle = v["shuffle"] == "true" });
                await Load();
            }, "Sendeplan");
        }

        async Task ToggleClock()
        {
            var r = clocks.One;
            if (r == null) return;
            var enabled = J.Bool(r.El, "enabled", true);
            // der Server erwartet das ganze Ereignis; nur "enabled" wird umgeschaltet
            var doc = JsonDocument.Parse(r.El.GetRawText());
            var dict = new Dictionary<string, object>();
            foreach (var p in doc.RootElement.EnumerateObject()) dict[p.Name] = p.Value.Clone();
            dict["enabled"] = !enabled;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/clock-events/" + Uri.EscapeDataString(J.Str(r.El, "id"))), dict); await Load(); }, "Uhr-Ereignis");
        }

        async Task FireClock()
        {
            var r = clocks.One;
            if (r == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/clock-events/" + Uri.EscapeDataString(J.Str(r.El, "id")) + "/fire")); C.Ok("Ausgelöst"); }, "Uhr-Ereignis");
        }
    }
}
