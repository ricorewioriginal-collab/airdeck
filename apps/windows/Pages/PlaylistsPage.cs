// Playlists: anlegen, umbenennen, Titel hinzufügen/entfernen/verschieben, sofort abspielen, mischen.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class PlaylistsPage : View
    {
        readonly Table lists = new Table(("Playlist", 200), ("Titel", 60));
        readonly Table items = new Table(("#", 40), ("Titel", 260), ("Interpret", 170), ("Dauer", 60));
        readonly TextBlock heading = Kit.Text("Titel der Playlist", 14, true);
        Dictionary<string, JsonElement> library = new Dictionary<string, JsonElement>();
        List<string> current = new List<string>();
        string currentId;

        public override string Title => "Playlists";

        public PlaylistsPage(Ctx c) : base(c)
        {
            ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
            ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var left = new Grid { Margin = new Thickness(0, 0, 10, 0) };
            left.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            left.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            left.Children.Add(lists);
            var lbtn = Kit.Wrap(Kit.Btn("Neu …", NewList, null, true), Kit.Btn("Umbenennen …", Rename), Kit.Btn("Löschen", DeleteList),
                Kit.Btn("▶ Abspielen", () => ListAction("play"), "Playlist sofort spielen"), Kit.Btn("Mischen", () => ListAction("shuffle")));
            Grid.SetRow(lbtn, 1);
            left.Children.Add(lbtn);
            Children.Add(left);

            var right = new Grid();
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.Children.Add(heading);
            Grid.SetRow(items, 1);
            right.Children.Add(items);
            var ibtn = Kit.Wrap(Kit.Btn("Titel hinzufügen …", AddItem, null, true), Kit.Btn("Entfernen", RemoveItems),
                Kit.Btn("▲", () => MoveItem(-1)), Kit.Btn("▼", () => MoveItem(1)));
            Grid.SetRow(ibtn, 2);
            right.Children.Add(ibtn);
            SetColumn(right, 1);
            Children.Add(right);

            lists.SelectionChanged += (s, e) => ShowItems();
        }

        public override Task Show() => Load();

        public override void OnEvent(string type) { if ((type == "playlists.changed" || type == "library.changed") && IsVisible) _ = Load(); }

        async Task Load()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            var keep = currentId;
            await C.Run(async () =>
            {
                var lib = C.Api.GetJ(C.St("/media"));
                var pl = C.Api.GetJ(C.St("/playlists"));
                await Task.WhenAll(lib, pl);
                library = J.Arr(lib.Result).Where(m => J.Str(m, "id").Length > 0).GroupBy(m => J.Str(m, "id")).ToDictionary(g => g.Key, g => g.First());
                lists.Set(J.Arr(pl.Result).Select(p => new Row(p, J.Str(p, "name"), J.Arr(p, "items").Count().ToString())));
                var idx = lists.Items.Cast<Row>().ToList().FindIndex(r => J.Str(r.El, "id") == keep);
                if (idx >= 0) lists.SelectedIndex = idx; else ShowItems();
            }, "Playlists");
        }

        void ShowItems()
        {
            var r = lists.One;
            currentId = r == null ? null : J.Str(r.El, "id");
            current = r == null ? new List<string>() : J.Strings(r.El, "items");
            heading.Text = r == null ? "Titel der Playlist" : "Titel: " + J.Str(r.El, "name");
            var n = 0;
            items.Set(current.Select(id =>
            {
                n++;
                var has = library.TryGetValue(id, out var m);
                return new Row(has ? m : default, n.ToString(), has ? J.Str(m, "title") : "(Titel fehlt) " + id, has ? J.Str(m, "artist") : "",
                    has && J.Ok(J.Get(m, "durationMs")) ? Fmt.Dur(J.Long(m, "durationMs")) : "–");
            }));
        }

        async Task NewList()
        {
            var v = Dlg.Form(C.Owner, "Neue Playlist", "Anlegen", Field.Text("name", "Name"));
            if (v == null || v["name"].Trim().Length == 0) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/playlists"), new { name = v["name"].Trim() }); await Load(); }, "Playlist");
        }

        async Task Rename()
        {
            var r = lists.One;
            if (r == null) return;
            var v = Dlg.Form(C.Owner, "Playlist umbenennen", "Speichern", Field.Text("name", "Name", J.Str(r.El, "name")));
            if (v == null || v["name"].Trim().Length == 0) return;
            await C.Run(async () => { await C.Api.PatchJ(C.St("/playlists/" + Uri.EscapeDataString(currentId)), new { name = v["name"].Trim() }); await Load(); }, "Playlist");
        }

        async Task DeleteList()
        {
            var r = lists.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Playlist „" + J.Str(r.El, "name") + "“ löschen? Die Titel bleiben in der Mediathek.")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/playlists/" + Uri.EscapeDataString(currentId))); currentId = null; await Load(); }, "Playlist");
        }

        async Task ListAction(string action)
        {
            if (currentId == null) return;
            await C.Run(async () => { await C.Api.PostJ(C.St("/playlists/" + Uri.EscapeDataString(currentId) + "/" + action)); C.Ok(action == "play" ? "Playlist wird gespielt" : "Playlist gemischt"); await Load(); }, "Playlist");
        }

        Task SaveItems(List<string> ids) => C.Run(async () => { await C.Api.PatchJ(C.St("/playlists/" + Uri.EscapeDataString(currentId)), new { items = ids }); await Load(); }, "Playlist");

        async Task AddItem()
        {
            if (currentId == null) { C.Status("Erst links eine Playlist wählen", true); return; }
            var all = library.Values.OrderBy(m => J.Str(m, "artist")).ThenBy(m => J.Str(m, "title")).Select(m => (J.Str(m, "id"), (J.Str(m, "artist") + " – " + J.Str(m, "title")).Trim(' ', '–'))).ToList();
            var id = Dlg.Pick(C.Owner, "Titel hinzufügen", all);
            if (id == null) return;
            await SaveItems(current.Concat(new[] { id }).ToList());
        }

        async Task RemoveItems()
        {
            var picked = items.Many.Select(r => int.Parse(r.Cells[0]) - 1).ToHashSet();
            if (currentId == null || picked.Count == 0) return;
            await SaveItems(current.Where((id, i) => !picked.Contains(i)).ToList());
        }

        async Task MoveItem(int delta)
        {
            var r = items.One;
            if (currentId == null || r == null) return;
            var i = int.Parse(r.Cells[0]) - 1;
            var j = i + delta;
            if (j < 0 || j >= current.Count) return;
            var list = current.ToList();
            var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
            await SaveItems(list);
            items.SelectedIndex = j;
        }
    }
}
