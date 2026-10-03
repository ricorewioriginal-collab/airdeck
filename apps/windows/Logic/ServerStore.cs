// Gespeicherte Server (Profile) für den Wechsel zwischen dem Motor dieses PCs und entfernten AnMaCha-Cast-Servern.
// Zugangs-Tokens liegen nie im Klartext auf der Platte: der Aufrufer liefert einen Schutz (unter Windows DPAPI).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace AnMaChaCast.Logic
{
    public sealed class ServerProfile
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string BaseUrl { get; set; } = "";
        public string Token { get; set; } = "";
        public string LastStation { get; set; } = "";
        public bool IsLocal => Id == ServerStore.LocalId;
    }

    public interface ISecretProtector
    {
        string Protect(string plain);
        string Unprotect(string stored);
    }

    public sealed class ServerStore
    {
        public const string LocalId = "local";

        sealed class FileModel
        {
            public string Active { get; set; } = LocalId;
            public List<Entry> Servers { get; set; } = new List<Entry>();
        }

        sealed class Entry
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public string BaseUrl { get; set; } = "";
            public string Token { get; set; } = "";
            public string LastStation { get; set; } = "";
        }

        readonly string path;
        readonly ISecretProtector protector;
        readonly List<ServerProfile> remote = new List<ServerProfile>();

        public string ActiveId { get; set; } = LocalId;
        public ServerProfile Local { get; } = new ServerProfile { Id = LocalId, Name = "Dieser PC" };

        public ServerStore(string path, ISecretProtector protector)
        {
            this.path = path;
            this.protector = protector;
            Load();
        }

        /// <summary>Dieser PC zuerst, danach die gespeicherten Server in Eingabereihenfolge.</summary>
        public IReadOnlyList<ServerProfile> All => new[] { Local }.Concat(remote).ToList();

        public ServerProfile Find(string id) => All.FirstOrDefault(p => p.Id == id);

        public ServerProfile Active => Find(ActiveId) ?? Local;

        /// <summary>Server hinzufügen oder (gleiche Adresse) aktualisieren, z. B. mit neuem Token nach erneuter Kopplung.</summary>
        public ServerProfile Upsert(string name, string baseUrl, string token)
        {
            var existing = remote.FirstOrDefault(p => string.Equals(p.BaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                if (!string.IsNullOrWhiteSpace(name)) existing.Name = name;
                if (token != null) existing.Token = token;
                Save();
                return existing;
            }
            var p = new ServerProfile { Id = "srv_" + Guid.NewGuid().ToString("N").Substring(0, 8), Name = string.IsNullOrWhiteSpace(name) ? baseUrl : name, BaseUrl = baseUrl, Token = token ?? "" };
            remote.Add(p);
            Save();
            return p;
        }

        public void Remove(string id)
        {
            if (remote.RemoveAll(p => p.Id == id) > 0)
            {
                if (ActiveId == id) ActiveId = LocalId;
                Save();
            }
        }

        public void Rename(string id, string name)
        {
            var p = remote.FirstOrDefault(x => x.Id == id);
            if (p != null && !string.IsNullOrWhiteSpace(name)) { p.Name = name.Trim(); Save(); }
        }

        void Load()
        {
            try
            {
                if (!File.Exists(path)) return;
                var m = JsonSerializer.Deserialize<FileModel>(File.ReadAllText(path));
                if (m == null) return;
                foreach (var e in m.Servers ?? new List<Entry>())
                {
                    string token;
                    try { token = string.IsNullOrEmpty(e.Token) ? "" : protector.Unprotect(e.Token); } catch { token = ""; } // andere Windows-Anmeldung: neu koppeln
                    remote.Add(new ServerProfile { Id = e.Id, Name = e.Name, BaseUrl = e.BaseUrl, Token = token, LastStation = e.LastStation });
                }
                ActiveId = remote.Any(p => p.Id == m.Active) || m.Active == LocalId ? m.Active : LocalId;
            }
            catch (Exception ex) when (ex is IOException || ex is JsonException || ex is UnauthorizedAccessException) { /* defekte Datei: wie neu starten */ }
        }

        public void Save()
        {
            var m = new FileModel
            {
                Active = ActiveId,
                Servers = remote.Select(p => new Entry { Id = p.Id, Name = p.Name, BaseUrl = p.BaseUrl, Token = string.IsNullOrEmpty(p.Token) ? "" : protector.Protect(p.Token), LastStation = p.LastStation }).ToList(),
            };
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(m, new JsonSerializerOptions { WriteIndented = true }));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
