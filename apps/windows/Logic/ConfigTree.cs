// Allgemeiner Einstellungs-Editor: zeigt eine Konfiguration (JSON) als Liste einzelner Werte und ändert genau einen Wert,
// ohne das Schema zu kennen. Der Server erwartet beim Speichern das ganze Objekt der obersten Ebene (z. B. "rotation"),
// deshalb liefert Apply den neuen Inhalt dieses obersten Schlüssels.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AnMaChaCast.Logic
{
    public sealed class ConfigEntry
    {
        public string Path { get; set; }
        public string[] Segments { get; set; }
        public JsonValueKind Kind { get; set; }
        public string Display { get; set; }
    }

    public static class ConfigTree
    {
        const int MaxDepth = 4;

        /// <summary>Alle einzelnen Werte; Listen und sehr tief verschachtelte Objekte erscheinen als ein JSON-Wert.</summary>
        public static List<ConfigEntry> Flatten(JsonElement root)
        {
            var list = new List<ConfigEntry>();
            Walk(root, new List<string>(), list);
            return list;
        }

        static void Walk(JsonElement e, List<string> path, List<ConfigEntry> into)
        {
            if (e.ValueKind != JsonValueKind.Object) return;
            foreach (var p in e.EnumerateObject())
            {
                var segs = new List<string>(path) { p.Name };
                if (p.Value.ValueKind == JsonValueKind.Object && segs.Count < MaxDepth && p.Value.EnumerateObject().GetEnumerator().MoveNext())
                {
                    Walk(p.Value, segs, into);
                    continue;
                }
                into.Add(new ConfigEntry { Path = string.Join(".", segs), Segments = segs.ToArray(), Kind = p.Value.ValueKind, Display = Show(p.Value) });
            }
        }

        public static string Show(JsonElement v)
        {
            switch (v.ValueKind)
            {
                case JsonValueKind.String: return v.GetString();
                case JsonValueKind.True: return "an";
                case JsonValueKind.False: return "aus";
                case JsonValueKind.Null: return "–";
                default: return v.GetRawText();
            }
        }

        /// <summary>Wert ändern. Gibt den neuen Inhalt des obersten Schlüssels (JSON) zurück; wirft FormatException/JsonException bei ungültiger Eingabe.</summary>
        public static string Apply(string rootJson, string[] segments, JsonValueKind kind, string text)
        {
            if (segments == null || segments.Length == 0) throw new ArgumentException("Pfad fehlt");
            var root = JsonNode.Parse(rootJson) as JsonObject ?? throw new FormatException("Die Einstellungen sind kein Objekt");
            JsonObject parent = root;
            for (var i = 0; i < segments.Length - 1; i++)
                parent = parent[segments[i]] as JsonObject ?? throw new FormatException("Pfad nicht gefunden: " + string.Join(".", segments));
            var last = segments[segments.Length - 1];
            parent[last] = NewValue(kind, text);
            return root[segments[0]]?.ToJsonString() ?? "null";
        }

        static JsonNode NewValue(JsonValueKind kind, string text)
        {
            text = text ?? "";
            switch (kind)
            {
                case JsonValueKind.True:
                case JsonValueKind.False:
                    var t = text.Trim().ToLowerInvariant();
                    if (t == "true" || t == "an" || t == "ja" || t == "1") return JsonValue.Create(true);
                    if (t == "false" || t == "aus" || t == "nein" || t == "0") return JsonValue.Create(false);
                    throw new FormatException("Bitte „an“ oder „aus“ angeben");
                case JsonValueKind.Number:
                    var n = text.Trim().Replace(',', '.');
                    if (long.TryParse(n, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l)) return JsonValue.Create(l);
                    if (double.TryParse(n, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && !double.IsNaN(d) && !double.IsInfinity(d)) return JsonValue.Create(d);
                    throw new FormatException("Das ist keine Zahl");
                case JsonValueKind.Array:
                case JsonValueKind.Object:
                    var node = JsonNode.Parse(text);
                    if (node == null || (kind == JsonValueKind.Array && !(node is JsonArray)) || (kind == JsonValueKind.Object && !(node is JsonObject)))
                        throw new FormatException(kind == JsonValueKind.Array ? "Erwartet wird eine Liste in eckigen Klammern [ … ]" : "Erwartet wird ein Objekt in geschweiften Klammern { … }");
                    return node;
                default:
                    return JsonValue.Create(text);
            }
        }
    }
}
