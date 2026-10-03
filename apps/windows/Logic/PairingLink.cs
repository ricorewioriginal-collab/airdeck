// Inhalt des Kopplungs-QR-Codes: "<Server-Adresse>/#pair=<6 Ziffern>" - dasselbe Format wie im Studio (studio/js/qr.js),
// das die Android-App und die Web-Oberfläche beim Scannen lesen.
using System.Collections.Generic;
using System.Linq;

namespace AnMaChaCast.Logic
{
    public static class PairingLink
    {
        /// <summary>Link für den QR-Code; null ohne erreichbare Adresse oder bei ungültigem Code.</summary>
        public static string Build(string address, string code)
        {
            if (string.IsNullOrWhiteSpace(address) || code == null || code.Length != 6 || !code.All(char.IsDigit)) return null;
            return address.Trim().TrimEnd('/') + "/#pair=" + code;
        }

        /// <summary>
        /// Adressen für die Anzeige: Reihenfolge des Servers bleibt erhalten (er ordnet echte WLAN-/LAN-Adressen vor virtuellen Adaptern),
        /// localhost-Adressen kommen ans Ende, weil ein Handy sie nie erreicht.
        /// </summary>
        public static IList<string> Ranked(IEnumerable<string> addresses)
        {
            var list = (addresses ?? new string[0]).Where(a => !string.IsNullOrWhiteSpace(a)).ToList();
            var local = list.Where(a => a.Contains("://localhost") || a.Contains("://127.")).ToList();
            return list.Except(local).Concat(local).ToList();
        }
    }
}
