// Schlanker REST + SSE-Client gegen die AnMaCha-Cast-Engine, Gegenstück zu studio/js/api.js.
// Trägt nur die Aufrufe, die das native Studio-Fenster braucht (Stationen, Decks, Cardwall, Modus, Playout).
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AirDeck.Api
{
    public sealed class ApiClient : IDisposable
    {
        static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        readonly HttpClient http;
        readonly string token;

        /// <param name="origin">z. B. http://127.0.0.1:4848</param>
        public ApiClient(Uri origin, string token)
        {
            this.token = token;
            http = new HttpClient { BaseAddress = origin, Timeout = TimeSpan.FromSeconds(15) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        async Task<T> Get<T>(string path)
        {
            using (var res = await http.GetAsync("/api/v1" + path).ConfigureAwait(false))
            {
                res.EnsureSuccessStatusCode();
                var s = await res.Content.ReadAsStreamAsync().ConfigureAwait(false);
                return await JsonSerializer.DeserializeAsync<T>(s, JsonOpts).ConfigureAwait(false);
            }
        }

        async Task<T> Send<T>(HttpMethod method, string path, object body)
        {
            var req = new HttpRequestMessage(method, "/api/v1" + path);
            if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            using (var res = await http.SendAsync(req).ConfigureAwait(false))
            {
                if (res.StatusCode == System.Net.HttpStatusCode.NoContent) return default;
                var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                res.EnsureSuccessStatusCode();
                if (string.IsNullOrWhiteSpace(text)) return default;
                return JsonSerializer.Deserialize<T>(text, JsonOpts);
            }
        }

        public Task<List<StationInfo>> Stations() => Get<List<StationInfo>>("/stations");
        public Task<List<MediaItem>> Library(string stationId) => Get<List<MediaItem>>($"/stations/{Enc(stationId)}/media");
        public Task<List<DeckState>> Decks(string stationId) => Get<List<DeckState>>($"/stations/{Enc(stationId)}/decks");
        public Task<List<CartSlot>> Cardwall(string stationId) => Get<List<CartSlot>>($"/stations/{Enc(stationId)}/cardwall");
        public Task<ModeView> Mode(string stationId) => Get<ModeView>($"/stations/{Enc(stationId)}/mode");
        public Task<PlayoutView> Playout(string stationId) => Get<PlayoutView>($"/stations/{Enc(stationId)}/playout");

        public Task<ModeView> SetMode(string stationId, string mode) =>
            Send<ModeView>(HttpMethod.Put, $"/stations/{Enc(stationId)}/mode", new { mode });

        public Task SetMic(string stationId, bool on) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/mic", new { on });

        public Task<PlayoutView> StartPlayout(string stationId) =>
            Send<PlayoutView>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/start", new { });

        public Task<PlayoutView> StopPlayout(string stationId) =>
            Send<PlayoutView>(HttpMethod.Post, $"/stations/{Enc(stationId)}/playout/stop", null);

        public Task DeckAction(string stationId, string deckId, string action, object body = null) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/decks/{Enc(deckId)}/{Enc(action)}", body ?? new { });

        public Task TriggerCart(string stationId, string slotId) =>
            Send<object>(HttpMethod.Post, $"/stations/{Enc(stationId)}/cardwall/{Enc(slotId)}/trigger", null);

        static string Enc(string s) => Uri.EscapeDataString(s ?? "");

        /// <summary>
        /// Server-Sent-Events abonnieren (dieselben Ereignistypen wie studio/js/api.js). Läuft bis zum
        /// übergebenen Abbruch-Token oder bis die Verbindung abbricht; der Aufrufer kümmert sich ums
        /// Neuverbinden (siehe MainWindow.WatchEvents).
        /// </summary>
        public async Task Subscribe(string stationId, Action<string, string> onEvent, CancellationToken ct)
        {
            var url = $"/api/v1/events?station={Enc(stationId)}&token={Enc(token)}";
            using (var req = new HttpRequestMessage(HttpMethod.Get, url))
            using (var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false))
            {
                res.EnsureSuccessStatusCode();
                using (var stream = await res.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var reader = new StreamReader(stream))
                {
                    string type = null;
                    var data = new StringBuilder();
                    while (!ct.IsCancellationRequested)
                    {
                        var line = await reader.ReadLineAsync().ConfigureAwait(false);
                        if (line == null) break; // Verbindung vom Server beendet
                        if (line.Length == 0)
                        {
                            if (type != null && data.Length > 0) onEvent(type, data.ToString());
                            type = null;
                            data.Clear();
                            continue;
                        }
                        if (line.StartsWith("event:", StringComparison.Ordinal)) type = line.Substring(6).Trim();
                        else if (line.StartsWith("data:", StringComparison.Ordinal)) data.Append(line.Substring(5).Trim());
                    }
                }
            }
        }

        public void Dispose() => http.Dispose();
    }
}
