// Schutz der gespeicherten Server-Zugangsdaten mit der Windows-Anmeldung (DPAPI, nur für diesen Benutzer lesbar).
using System;
using System.Security.Cryptography;
using System.Text;
using AnMaChaCast.Logic;

namespace AnMaChaCast.Ui
{
    sealed class DpapiProtector : ISecretProtector
    {
        static readonly byte[] Extra = Encoding.UTF8.GetBytes("AnMaChaCast.Servers.v1");

        public string Protect(string plain) =>
            Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Extra, DataProtectionScope.CurrentUser));

        public string Unprotect(string stored) =>
            Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored), Extra, DataProtectionScope.CurrentUser));
    }
}
