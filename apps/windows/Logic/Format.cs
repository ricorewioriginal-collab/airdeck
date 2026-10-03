// Anzeigeformate und kleine Prüfungen ohne Oberfläche (testbar).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AnMaChaCast.Logic
{
    public static class Fmt
    {
        static readonly string[] DayNames = { "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So" };

        /// <summary>Dauer als m:ss bzw. h:mm:ss; "–" ohne Angabe.</summary>
        public static string Dur(long? ms)
        {
            if (!ms.HasValue || ms.Value < 0) return "–";
            var t = TimeSpan.FromMilliseconds(ms.Value);
            return t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes}:{t.Seconds:00}";
        }

        public static string Size(long bytes)
        {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024.0).ToString("0.#", CultureInfo.GetCultureInfo("de-DE")) + " KB";
            if (bytes < 1024L * 1024 * 1024) return (bytes / 1048576.0).ToString("0.#", CultureInfo.GetCultureInfo("de-DE")) + " MB";
            return (bytes / 1073741824.0).ToString("0.##", CultureInfo.GetCultureInfo("de-DE")) + " GB";
        }

        /// <summary>Zeitpunkt (Unix-Millisekunden) als lokales Datum mit Uhrzeit.</summary>
        public static string Stamp(long epochMs, TimeZoneInfo zone = null)
        {
            if (epochMs <= 0) return "–";
            var utc = DateTimeOffset.FromUnixTimeMilliseconds(epochMs);
            var local = TimeZoneInfo.ConvertTime(utc, zone ?? TimeZoneInfo.Local);
            return local.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);
        }

        public static string Days(IEnumerable<int> days)
        {
            var list = days.Where(d => d >= 0 && d <= 6).Distinct().OrderBy(d => d).ToList();
            if (list.Count == 0 || list.Count == 7) return "täglich";
            return string.Join(",", list.Select(d => DayNames[d]));
        }

        /// <summary>Wochentage aus "Mo,Di" oder "1-5"-losen Eingaben; leer = täglich. Ungültiges wird ignoriert.</summary>
        public static List<int> ParseDays(string text)
        {
            var result = new List<int>();
            foreach (var part in (text ?? "").Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var i = Array.FindIndex(DayNames, d => d.Equals(part.Trim(), StringComparison.OrdinalIgnoreCase));
                if (i >= 0 && !result.Contains(i)) result.Add(i);
            }
            return result;
        }

        public static bool ValidTime(string hhmm) =>
            hhmm != null && System.Text.RegularExpressions.Regex.IsMatch(hhmm, "^([01]\\d|2[0-3]):[0-5]\\d$");

        /// <summary>Server-Adresse vereinheitlichen: ohne Pfad, Anfrage und Schlussschrägstrich; fehlendes Schema wird https://.</summary>
        public static string NormalizeBase(string input)
        {
            var raw = (input ?? "").Trim();
            if (raw.Length == 0) throw new ArgumentException("Bitte die Adresse des Servers eingeben");
            if (!raw.Contains("://")) raw = (LooksLocal(raw) ? "http://" : "https://") + raw;
            if (!Uri.TryCreate(raw, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https") || string.IsNullOrEmpty(u.Host))
                throw new ArgumentException("Das ist keine gültige Server-Adresse (z. B. https://radio.example.de oder 192.168.1.20:4848)");
            if (!string.IsNullOrEmpty(u.UserInfo)) throw new ArgumentException("Die Adresse darf keine Zugangsdaten enthalten");
            return u.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        }

        static bool LooksLocal(string host)
        {
            var h = host.Split('/')[0].Split(':')[0];
            if (h == "localhost" || !h.Contains(".")) return true;
            if (System.Net.IPAddress.TryParse(h, out var ip))
            {
                var b = ip.GetAddressBytes();
                return b.Length == 4 && (b[0] == 10 || b[0] == 127 || (b[0] == 192 && b[1] == 168) || (b[0] == 172 && b[1] >= 16 && b[1] <= 31));
            }
            return h.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || h.EndsWith(".lan", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Kopplungscode: nur die Ziffern (Eingaben wie "123 456" oder "123-456").</summary>
        public static string PairCode(string input) => new string((input ?? "").Where(char.IsDigit).ToArray());

        public static string Clip(string text, int max) =>
            string.IsNullOrEmpty(text) || text.Length <= max ? text ?? "" : text.Substring(0, max - 1) + "…";
    }
}
