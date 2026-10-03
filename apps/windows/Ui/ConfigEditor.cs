// Einstellungs-Editor für beliebige Konfigurationen des Servers: zeigt jeden einzelnen Wert (mit deutschem Namen, wo bekannt),
// ändert ihn mit passender Eingabe (an/aus, Zahl, Text, Liste) und speichert über den Server. Dadurch ist jede Einstellung
// erreichbar, auch wenn es dafür keine eigene Maske gibt.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Logic;

namespace AnMaChaCast.Ui
{
    sealed class ConfigEditor : Grid
    {
        readonly Ctx c;
        readonly Func<Task<JsonElement>> load;
        readonly Func<string, string, Task> save;
        readonly Dictionary<string, string> labels;
        readonly Table table = new Table(("Einstellung", 300), ("Wert", 360));
        readonly TextBlock hint;
        List<ConfigEntry> entries = new List<ConfigEntry>();
        string rootJson = "{}";

        /// <param name="load">liefert das Konfigurationsobjekt</param>
        /// <param name="save">speichert den neuen Inhalt eines obersten Schlüssels: (Schlüssel, JSON)</param>
        public ConfigEditor(Ctx c, string hintText, Dictionary<string, string> labels, Func<Task<JsonElement>> load, Func<string, string, Task> save)
        {
            this.c = c;
            this.load = load;
            this.save = save;
            this.labels = labels ?? new Dictionary<string, string>();
            hint = Kit.Hint(hintText);
            hint.Margin = new Thickness(0, 0, 0, 6);
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Children.Add(hint);
            SetRow(table, 1);
            Children.Add(table);
            table.MouseDoubleClick += async (s, e) => await Edit();
            var buttons = Kit.Wrap(Kit.Btn("Ändern …", Edit, "Doppelklick auf eine Zeile", true), Kit.Btn("Neu laden", Reload));
            SetRow(buttons, 2);
            Children.Add(buttons);
        }

        string LabelOf(string path) => labels.TryGetValue(path, out var l) ? l : path;

        public async Task Reload()
        {
            await c.Run(async () =>
            {
                var root = await load();
                rootJson = root.ValueKind == JsonValueKind.Object ? root.GetRawText() : "{}";
                entries = ConfigTree.Flatten(root);
                table.Set(entries.Select(e => new Row(default, LabelOf(e.Path), Fmt.Clip(e.Display, 140))));
            }, "Einstellungen");
        }

        async Task Edit()
        {
            var i = table.SelectedIndex;
            if (i < 0 || i >= entries.Count) return;
            var e = entries[i];
            Field field;
            switch (e.Kind)
            {
                case JsonValueKind.True:
                case JsonValueKind.False: field = Field.Check("v", LabelOf(e.Path), e.Kind == JsonValueKind.True); break;
                case JsonValueKind.Array:
                case JsonValueKind.Object: field = Field.Multi("v", LabelOf(e.Path) + " (JSON)", PrettyOrRaw(e)); break;
                default: field = Field.Text("v", LabelOf(e.Path), e.Kind == JsonValueKind.Null ? "" : e.Display); break;
            }
            var v = Dlg.Form(c.Owner, "Einstellung ändern", "Speichern", field);
            if (v == null) return;
            string newTop;
            try { newTop = ConfigTree.Apply(rootJson, e.Segments, e.Kind, v["v"]); }
            catch (Exception ex) when (ex is FormatException || ex is JsonException || ex is ArgumentException) { c.Status("Ungültige Eingabe: " + ex.Message, true); return; }
            await c.Run(async () => { await save(e.Segments[0], newTop); c.Ok("Gespeichert"); await Reload(); }, "Einstellungen");
        }

        string PrettyOrRaw(ConfigEntry e) => e.Display;
    }
}
