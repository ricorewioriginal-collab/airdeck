// Server & Geräte: zwischen dem Motor dieses PCs und entfernten AnMaCha-Cast-Servern wechseln, Server koppeln (Kopplungscode oder
// Anmeldung) oder im Netz suchen, Handys und weitere PCs koppeln, gekoppelte Geräte verwalten, Netzwerkzugriff erlauben.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class ServersPage : View
    {
        readonly Table servers = new Table(("Server", 200), ("Adresse", 300), ("Zustand", 110));
        readonly Table devices = new Table(("Gerät", 200), ("Plattform", 90), ("Rolle", 90), ("Angelegt", 120), ("Zuletzt aktiv", 120));
        readonly TextBlock network = Kit.Text("", 13, false, Kit.Muted, true);

        public override string Title => "Server & Geräte";

        public ServersPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            servers.MinHeight = 90;
            servers.MaxHeight = 190;

            var serverCard = Kit.Card("Server", Kit.V(servers, Kit.Wrap(
                Kit.Btn("Verbinden / Wechseln", Switch, "Diesen Server im Studio öffnen", true), Kit.Btn("Server hinzufügen …", () => Add(""), "Kopplungscode oder Anmeldung"),
                Kit.Btn("Im Netzwerk suchen …", Discover), Kit.Btn("Umbenennen …", Rename), Kit.Btn("Entfernen", Remove))),
                "„Dieser PC“ ist die eingebaute Engine. Weitere Server (z. B. im Sender oder in der Cloud) koppelst du mit einem Kopplungscode.");
            Children.Add(serverCard);

            var deviceBody = new Grid();
            deviceBody.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            deviceBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            deviceBody.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            deviceBody.Children.Add(network);
            Grid.SetRow(devices, 1);
            deviceBody.Children.Add(devices);
            var deviceButtons = (Kit.Wrap(
                Kit.Btn("Neues Gerät koppeln …", Pair, "Erzeugt einen 6-stelligen Code, fünf Minuten gültig", true), Kit.Btn("Gerät entfernen", RevokeDevice),
                Kit.Btn("Zugriff im Netzwerk erlauben/sperren", ToggleLan, "Damit Handys im selben WLAN den Server erreichen"), Kit.Btn("Neu laden", () => Show())));
            Grid.SetRow(deviceButtons, 2);
            deviceBody.Children.Add(deviceButtons);
            var deviceCard = Kit.Card("Geräte koppeln (Android-App, weitere PCs)", deviceBody,
                "Am Gerät in der App „Server hinzufügen“ wählen und den Code eingeben.");
            SetRow(deviceCard, 1);
            Children.Add(deviceCard);
        }

        public override async Task Show()
        {
            var active = C.Servers.ActiveId;
            servers.Set(C.Servers.All.Select(p => new Row(default, p.Name, p.IsLocal ? "diese Engine" : p.BaseUrl, p.Id == active ? (C.Connected ? "verbunden" : "getrennt") : (p.IsLocal || p.Token.Length > 0 ? "gespeichert" : "Kopplung nötig"))));
            if (!C.Connected) return;
            await C.Run(async () =>
            {
                try
                {
                    var d = await C.Api.GetJ("/devices");
                    devices.Set(J.Arr(d).Select(t => new Row(t, J.Str(t, "name"), J.Str(t, "device.platform", "–"), J.Strings(t, "roles").FirstOrDefault() ?? "–", Fmt.Stamp(J.Long(t, "createdAt")), Fmt.Stamp(J.Long(t, "lastUsedAt")))));
                }
                catch (ApiException ex) when (ex.Status == 403) { devices.Set(new Row[0]); C.Status("Geräte verwalten darf nur ein Administrator", true); }
                var conn = await C.Api.GetJ("/app/connect");
                network.Text = J.Bool(conn, "lan") ? "Zugriff im Netzwerk: erlaubt" + (J.Bool(conn, "restartNeeded") ? " – Neustart nötig" : "") + " · Adressen: " + string.Join(", ", J.Strings(conn, "addresses"))
                    : "Zugriff im Netzwerk: gesperrt – Handys erreichen diesen Server erst nach „Zugriff im Netzwerk erlauben“.";
            }, "Server");
        }

        ServerProfile Selected() => C.Servers.All.ElementAtOrDefault(servers.SelectedIndex);

        async Task Switch()
        {
            var p = Selected();
            if (p == null) return;
            await C.SwitchTo(p);
            await Show();
        }

        async Task Discover()
        {
            if (!C.Connected) return;
            await C.Run(async () =>
            {
                C.Status("Suche im Netzwerk …", false);
                var r = await C.Api.GetJ("/discover", 30);
                var found = J.Arr(r, "found").Where(f => J.Str(f, "url").Length > 0).ToList();
                if (found.Count == 0) { C.Status("Keine weiteren AnMaCha-Cast-Server im Netz gefunden", true); return; }
                var id = Dlg.Pick(C.Owner, "Gefundene Server", found.Select(f => (J.Str(f, "url"), J.Str(f, "name") + " · " + J.Str(f, "url"))).ToList());
                if (id != null) await Add(id);
            }, "Netzwerksuche");
        }

        /// <summary>Server hinzufügen: Adresse prüfen, dann mit Kopplungscode oder Benutzername und Passwort anmelden.</summary>
        async Task Add(string prefill)
        {
            var v = Dlg.Form(C.Owner, "Server hinzufügen", "Verbinden",
                Field.Text("url", "Adresse des Servers", prefill, "z. B. https://radio.example.de oder 192.168.1.20:4848"),
                Field.Text("name", "Name (optional)"),
                Field.Info("Anmeldung", "Entweder einen Kopplungscode eingeben (am Server unter „Neues Gerät koppeln“ erzeugt) – oder Benutzername und Passwort."),
                Field.Text("code", "Kopplungscode (6 Ziffern)"), Field.Text("user", "Benutzername"), Field.Password("pass", "Passwort"));
            if (v == null) return;
            await C.Run(async () =>
            {
                string baseUrl;
                try { baseUrl = Fmt.NormalizeBase(v["url"]); } catch (ArgumentException ex) { throw new ApiException(0, ex.Message); }
                var origin = new Uri(baseUrl);
                C.Status("Prüfe " + baseUrl + " …", false);
                await ApiClient.Health(origin);
                string token, serverName = "";
                var code = Fmt.PairCode(v["code"]);
                if (code.Length > 0) { var r = await ApiClient.Pair(origin, code, Environment.MachineName); token = r.Token; serverName = r.ServerName; }
                else if (v["user"].Trim().Length > 0 && v["pass"].Length > 0) token = await ApiClient.Login(origin, v["user"].Trim(), v["pass"]);
                else throw new ApiException(0, "Bitte einen Kopplungscode oder Benutzername und Passwort eingeben");
                var name = v["name"].Trim().Length > 0 ? v["name"].Trim() : (serverName.Length > 0 ? serverName : new Uri(baseUrl).Host);
                var profile = C.Servers.Upsert(name, baseUrl, token);
                C.Ok("Server „" + profile.Name + "“ gespeichert");
                await C.SwitchTo(profile);
                await Show();
            }, "Server hinzufügen");
        }

        void Rename()
        {
            var p = Selected();
            if (p == null || p.IsLocal) return;
            var v = Dlg.Form(C.Owner, "Server umbenennen", "Speichern", Field.Text("name", "Name", p.Name));
            if (v == null) return;
            C.Servers.Rename(p.Id, v["name"]);
            _ = Show();
        }

        async Task Remove()
        {
            var p = Selected();
            if (p == null || p.IsLocal) { C.Status("Dieser PC lässt sich nicht entfernen", true); return; }
            if (!Dlg.Confirm(C.Owner, "Server „" + p.Name + "“ aus der Liste entfernen? Das Gerät bleibt dort gekoppelt, bis es am Server entfernt wird.")) return;
            var wasActive = C.Servers.ActiveId == p.Id;
            C.Servers.Remove(p.Id);
            if (wasActive) await C.SwitchTo(C.Servers.Local);
            await Show();
        }

        async Task Pair()
        {
            var v = Dlg.Form(C.Owner, "Neues Gerät koppeln", "Code erzeugen",
                Field.Choice("role", "Rolle des Geräts", "dj", ("operator", "Sendeleitung"), ("dj", "Moderation"), ("editor", "Redaktion"), ("viewer", "Nur ansehen")),
                Field.Check("all", "Alle Sender freigeben (sonst nur der aktuelle)", true));
            if (v == null) return;
            await C.Run(async () =>
            {
                var r = await C.Api.PostJ("/pairing", new { role = v["role"], stationIds = v["all"] == "true" ? new[] { "*" } : new[] { C.StationId } });
                var addresses = J.Strings(r, "addresses");
                var code = J.Str(r, "code");
                // QR nur, wenn der Server wirklich im Netzwerk lauscht (nach dem Freigeben erst nach einem Neustart);
                // der Server sortiert die Adressen (echte WLAN/LAN-Adressen zuerst), bei mehreren Adaptern wählt man hier
                var listening = J.Bool(r, "listening");
                var options = new List<(string Label, string Payload)>();
                if (listening)
                    foreach (var a in PairingLink.Ranked(addresses))
                    {
                        var link = PairingLink.Build(a, code);
                        if (link != null) options.Add((a, link));
                    }
                Dlg.Qr(C.Owner, "Gerät koppeln", options,
                    "Kopplungscode:  " + code + "\n\nGültig 5 Minuten, einmal einlösbar.\n\n" +
                    (options.Count > 0
                        ? "In der Android-App „Per QR-Code koppeln“ wählen und diesen Code mit der Kamera scannen. Alternativ Adresse und Code eintippen:\n" + string.Join("\n", addresses)
                        : J.Bool(r, "lan")
                            ? "Hinweis: Der Netzwerkzugriff ist freigegeben, aber der Server lauscht noch nicht darauf – bitte den Server neu starten (System → Neustart), dann erscheint hier der QR-Code."
                            : "Hinweis: Der Zugriff im Netzwerk ist noch gesperrt – erst „Zugriff im Netzwerk erlauben“ wählen, dann erscheint hier der QR-Code."));
            }, "Kopplung");
        }

        async Task RevokeDevice()
        {
            var r = devices.One;
            if (r == null || !Dlg.Confirm(C.Owner, "Gerät „" + J.Str(r.El, "name") + "“ entfernen? Es muss danach neu gekoppelt werden.")) return;
            await C.Run(async () => { await C.Api.DeleteJ("/devices/" + Uri.EscapeDataString(J.Str(r.El, "id"))); await Show(); }, "Gerät");
        }

        async Task ToggleLan()
        {
            await C.Run(async () =>
            {
                var conn = await C.Api.GetJ("/app/connect");
                var lan = !J.Bool(conn, "lan");
                if (!Dlg.Confirm(C.Owner, lan ? "Zugriff aus dem Netzwerk erlauben? Geräte im selben WLAN/LAN können dann den Server erreichen (Anmeldung bleibt nötig)." : "Zugriff aus dem Netzwerk sperren?")) return;
                var r = await C.Api.PutJ("/app/network", new { lan });
                C.Ok(lan ? "Netzwerkzugriff erlaubt" + (J.Bool(r, "restartNeeded") ? " – der Server muss neu gestartet werden (System → Neustart)" : "") : "Netzwerkzugriff gesperrt");
                await Show();
            }, "Netzwerk");
        }
    }
}
