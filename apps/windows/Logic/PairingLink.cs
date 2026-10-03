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

        /// <summary>Beste Adresse für Handys: bevorzugt eine echte Netzwerkadresse statt localhost.</summary>
        public static string BestAddress(IEnumerable<string> addresses)
        {
            var list = (addresses ?? new string[0]).Where(a => !string.IsNullOrWhiteSpace(a)).ToList();
            return list.FirstOrDefault(a => !a.Contains("://localhost") && !a.Contains("://127.")) ?? list.FirstOrDefault();
        }
    }
}
