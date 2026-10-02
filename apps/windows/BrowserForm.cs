// Fallback-Fenster für Studio-Bereiche, die (noch) nicht nativ nachgebaut sind: Mediathek, Playlists,
// Sendeplan, Einstellungen, KI-Werkzeuge, Hörer-Statistik usw. Zeigt das bestehende Web-Studio in einem
// eingebetteten WebView2 - dieselbe Technik wie zuvor das ganze Programm, jetzt nur noch für diesen Rest.
// Übernimmt die bewährte Feinsteuerung der alten MainForm (Berechtigungen, externe Links, laut.fm-Login).
using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AirDeck
{
    sealed class BrowserForm : Form
    {
        static readonly Color Back = Color.FromArgb(11, 18, 32);
        static readonly string LocalDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AirDeck");

        readonly string startUrl;
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Back };
        readonly Label splash = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(160, 180, 210), BackColor = Back, Font = new Font("Segoe UI", 13f), Text = "Lädt …" };
        Uri origin;

        public BrowserForm(string url)
        {
            startUrl = url;
            Text = "AnMaCha Cast – Weitere Funktionen";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = Back;
            Size = new Size(1280, 820);
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(900, 560);
            Controls.Add(web);
            Controls.Add(splash);
            splash.BringToFront();
            Load += async (s, e) => await Init();
        }

        async System.Threading.Tasks.Task Init()
        {
            try
            {
                Uri.TryCreate(startUrl, UriKind.Absolute, out origin);
                System.IO.Directory.CreateDirectory(LocalDir);
                var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
                var env = await CoreWebView2Environment.CreateAsync(null, System.IO.Path.Combine(LocalDir, "WebView2"), options);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                var r = MessageBox.Show(this, "Für dieses Fenster fehlt die Microsoft-WebView2-Laufzeit (bei Windows 11 vorinstalliert).\n\nJetzt herunterladen?", "AnMaCha Cast", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r == DialogResult.Yes) OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                Close();
                return;
            }
            Setup(web.CoreWebView2);
            web.CoreWebView2.Navigate(startUrl);
        }

        void Setup(CoreWebView2 core)
        {
            var s = core.Settings;
            // ANMACHA_CAST_DEVTOOLS hat Vorrang, AIRDECK_DEVTOOLS bleibt als Legacy-Fallback (wie envVar() serverseitig)
            s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ANMACHA_CAST_DEVTOOLS") == "1" || Environment.GetEnvironmentVariable("AIRDECK_DEVTOOLS") == "1";
            s.IsStatusBarEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsPasswordAutosaveEnabled = false;

            core.NavigationCompleted += (o, e) => { if (splash.Visible) splash.Visible = false; };
            core.PermissionRequested += (o, e) => { if (Own(e.Uri)) e.State = CoreWebView2PermissionState.Allow; };
            core.NavigationStarting += (o, e) =>
            {
                if (Own(e.Uri) || LautFm(e.Uri) || e.Uri.StartsWith("about:", StringComparison.Ordinal)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            core.NewWindowRequested += (o, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.ContextMenuRequested += (o, e) => { if (!e.ContextMenuTarget.IsEditable) e.Handled = true; };
            core.ProcessFailed += (o, e) =>
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
                core.Reload();
            };
        }

        bool Own(string uri) => origin != null && Uri.TryCreate(uri, UriKind.Absolute, out var u)
            && u.Scheme == origin.Scheme && u.Host == origin.Host && u.Port == origin.Port;

        static bool LautFm(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme == "https"
            && (u.Host == "laut.fm" || u.Host.EndsWith(".laut.fm", StringComparison.OrdinalIgnoreCase));

        static void OpenExternal(string uri)
        {
            if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "mailto")) return;
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
        }
    }
}
