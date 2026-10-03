// laut.fm: Anbindung des Senders (Token), Prüfung, und die Radioadmin-Daten der Station (Playlists, Hörer, Live-Zugang),
// gelesen über den Server mit dem gespeicherten Token. Die volle Verwaltung (Titel, Sendeplan) bietet die Android-App
// und das Studio unter „Weitere Funktionen“.
using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class LautFmPage : View
    {
        readonly TextBlock status = Kit.Text("", 13, false, Kit.Fg, true);
        readonly Table playlists = new Table(("Playlist", 260), ("Titel", 70), ("Dauer", 90), ("Gemischt", 80));
        readonly StackPanel facts = new StackPanel();
        JsonElement cfg;

        public override string Title => "laut.fm";

        public LautFmPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Children.Add(Kit.Card("Anbindung", Kit.V(status, Kit.Wrap(
                Kit.Btn("Token eintragen / verbinden …", Connect, "Radioadmin-Token von laut.fm", true), Kit.Btn("Prüfen", Check), Kit.Btn("laut.fm-Anmeldeseite öffnen", OpenLogin), Kit.Btn("Neu laden", () => Show()))),
                "Der Server speichert das Token verschlüsselt und nutzt es für Playlists, Sendeplan und Live-Zugang."));
            var lower = new Grid();
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(380) });
            lower.Children.Add(Kit.Card("Playlists bei laut.fm", playlists));
            var f = Kit.Card("Station", facts);
            f.Margin = new Thickness(10, 0, 0, 10);
            SetColumn(f, 1);
            lower.Children.Add(f);
            SetRow(lower, 1);
            Children.Add(lower);
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                cfg = await C.Api.GetJ(C.St("/lautfm"));
                var has = J.Bool(cfg, "hasToken");
                var sid = J.Str(cfg, "stationId");
                status.Text = has ? "Verbunden" + (sid.Length > 0 ? " · laut.fm-Station " + sid : " – noch keine laut.fm-Station gewählt (im Studio unter laut.fm)") : "Nicht verbunden – Token eintragen.";
                playlists.Set(new Row[0]);
                facts.Children.Clear();
                if (!has || sid.Length == 0) return;
                var basePath = C.St("/lautfm/ra/stations/" + Uri.EscapeDataString(sid));
                var pl = C.Api.GetJ(basePath + "/playlists", 40);
                var info = C.Api.GetJ(basePath, 40);
                var stats = C.Api.GetJ(basePath + "/stats", 40);
                try { await Task.WhenAll(pl, info, stats); } catch (ApiException) { }
                if (pl.Status == TaskStatus.RanToCompletion)
                    playlists.Set(J.Arr(pl.Result, "playlists").Select(p => new Row(p, J.Str(p, "title"), J.Str(p, "size", "0"), Fmt.Dur(J.Long(p, "duration") * 1000), J.Bool(p, "shuffled") ? "ja" : "nein")));
                if (info.Status == TaskStatus.RanToCompletion)
                {
                    facts.Children.Add(Kit.Pair("Name", J.Str(info.Result, "name")));
                    facts.Children.Add(Kit.Pair("Format", J.Str(info.Result, "format")));
                    facts.Children.Add(Kit.Pair("Genres", string.Join(", ", J.Strings(info.Result, "genres"))));
                    facts.Children.Add(Kit.Pair("Aktiv", J.Bool(info.Result, "active") ? "ja" : "nein"));
                }
                if (stats.Status == TaskStatus.RanToCompletion) facts.Children.Add(Kit.Pair("Hörer jetzt", J.Str(stats.Result, "listeners_now", "–")));
                if (pl.Status != TaskStatus.RanToCompletion) C.Status("laut.fm-Daten nicht lesbar: " + (pl.Exception?.GetBaseException().Message ?? "unbekannt"), true);
            }, "laut.fm");
        }

        async Task Connect()
        {
            var v = Dlg.Form(C.Owner, "Mit laut.fm verbinden", "Verbinden",
                Field.Info("So geht's", "Auf laut.fm im Radioadmin anmelden; das Token wird bei der Anmeldung an die Adresse zurückgegeben (…#lautfm_radioadmin_token=…). Hier einfügen."),
                Field.Password("token", "Radioadmin-Token"));
            if (v == null || v["token"].Trim().Length == 0) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/lautfm/connect"), new { token = v["token"].Trim() }, 60); C.Ok("Mit laut.fm verbunden"); await Show(); }, "laut.fm");
        }

        Task Check() => C.Run(async () => { var r = await C.Api.PostJ(C.St("/lautfm/check"), null, 40); C.Ok("laut.fm: " + Fmt.Clip(J.Ok(r) ? r.GetRawText() : "in Ordnung", 160)); }, "laut.fm");

        void OpenLogin()
        {
            var url = J.Str(cfg, "loginUrl");
            if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
}
