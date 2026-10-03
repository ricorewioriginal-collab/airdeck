// Tolerantes Lesen der JSON-Antworten (die API liefert je nach Version leicht abweichende Felder), ohne starre Modelle.
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace AnMaChaCast.Logic
{
    public static class J
    {
        public static bool Ok(JsonElement e) => e.ValueKind != JsonValueKind.Undefined && e.ValueKind != JsonValueKind.Null;

        public static JsonElement Get(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : default;

        /// <summary>Pfad mit Punkten, z. B. "config.auto.enabled".</summary>
        public static JsonElement At(JsonElement e, string path)
        {
            foreach (var part in path.Split('.')) { e = Get(e, part); if (!Ok(e)) return default; }
            return e;
        }

        public static IEnumerable<JsonElement> Arr(JsonElement e)
        {
            if (e.ValueKind == JsonValueKind.Array) foreach (var x in e.EnumerateArray()) yield return x;
        }

        public static IEnumerable<JsonElement> Arr(JsonElement e, string name) => Arr(At(e, name));

        public static string Str(JsonElement e, string name, string fallback = "")
        {
            var v = At(e, name);
            switch (v.ValueKind)
            {
                case JsonValueKind.String: return v.GetString() ?? fallback;
                case JsonValueKind.Number: return v.ToString();
                case JsonValueKind.True: return "true";
                case JsonValueKind.False: return "false";
                default: return fallback;
            }
        }

        public static long Long(JsonElement e, string name, long fallback = 0)
        {
            var v = At(e, name);
            if (v.ValueKind == JsonValueKind.Number) return v.TryGetInt64(out var l) ? l : (long)v.GetDouble();
            if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), out var p)) return p;
            return fallback;
        }

        public static double Num(JsonElement e, string name, double fallback = 0)
        {
            var v = At(e, name);
            return v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;
        }

        public static bool Bool(JsonElement e, string name, bool fallback = false)
        {
            var v = At(e, name);
            return v.ValueKind == JsonValueKind.True ? true : v.ValueKind == JsonValueKind.False ? false : fallback;
        }

        public static List<string> Strings(JsonElement e, string name)
        {
            var list = new List<string>();
            foreach (var x in Arr(e, name)) list.Add(x.ValueKind == JsonValueKind.String ? x.GetString() : x.ToString());
            return list;
        }

        public static List<int> Ints(JsonElement e, string name)
        {
            var list = new List<int>();
            foreach (var x in Arr(e, name)) if (x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var i)) list.Add(i);
            return list;
        }

        /// <summary>Fehlertext aus einer Fehlerantwort {"error":"…","message":"…"}; sonst der Anfang des Textes.</summary>
        public static string ErrorText(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return "";
            try
            {
                using (var doc = JsonDocument.Parse(body))
                {
                    var m = Str(doc.RootElement, "message");
                    if (m.Length > 0) return m;
                    var er = Str(doc.RootElement, "error");
                    if (er.Length > 0) return er;
                }
            }
            catch (JsonException) { }
            return body.Length > 200 ? body.Substring(0, 200) : body;
        }
    }
}
