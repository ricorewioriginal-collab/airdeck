// Ein Deck (A–D) im nativen Studio-Fenster. Spiegelt DeckState/EngineDeckView vom Server
// (src/core/automation.ts, src/server/playout.ts) – das Studio ist Fernbedienung, die Engine maßgeblich.
using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace AnMaChaCast.ViewModels
{
    public sealed class DeckViewModel : INotifyPropertyChanged
    {
        public string Id { get; }

        string title = "– leer –";
        public string Title { get => title; set => Set(ref title, value); }

        string artist = "";
        public string Artist { get => artist; set => Set(ref artist, value); }

        string status = "empty"; // empty | cued | playing | paused
        public string Status { get => status; set { if (Set(ref status, value)) { OnPropertyChanged(nameof(IsPlaying)); OnPropertyChanged(nameof(StatusLabel)); } } }

        bool auto;
        /// <summary>Von der 24/7-Automation belegt (A/B) – in MANUAL sperrt das den Play-Knopf wie im Web-Studio.</summary>
        public bool Auto { get => auto; set => Set(ref auto, value); }

        long positionMs;
        public long PositionMs { get => positionMs; set { if (Set(ref positionMs, value)) { OnPropertyChanged(nameof(ProgressFraction)); OnPropertyChanged(nameof(RemainingLabel)); } } }

        long? durationMs;
        public long? DurationMs { get => durationMs; set { if (Set(ref durationMs, value)) { OnPropertyChanged(nameof(ProgressFraction)); OnPropertyChanged(nameof(RemainingLabel)); } } }

        double tempo = 1;
        /// <summary>Abspielgeschwindigkeit (1 = normal, 0,8–1,25), Tonhöhe bleibt.</summary>
        public double Tempo { get => tempo; set => Set(ref tempo, value); }

        public bool IsPlaying => Status == "playing";
        public bool HasMedia => !string.IsNullOrEmpty(title) && title != "– leer –";

        public string StatusLabel
        {
            get
            {
                switch (Status)
                {
                    case "playing": return "Spielt";
                    case "paused": return "Pause";
                    case "cued": return "Bereit";
                    default: return "Leer";
                }
            }
        }

        public double ProgressFraction => DurationMs is long d && d > 0 ? Math.Min(1.0, (double)PositionMs / d) : 0.0;

        public string RemainingLabel
        {
            get
            {
                var dur = DurationMs;
                if (!dur.HasValue || dur.Value <= 0) return "--:--";
                var d = dur.Value;
                var remMs = Math.Max(0, d - PositionMs);
                var t = TimeSpan.FromMilliseconds(remMs);
                return $"-{(int)t.TotalMinutes:00}:{t.Seconds:00}";
            }
        }

        public DeckViewModel(string id) { Id = id; }

        /// <summary>Vorrücken zwischen zwei SSE-/Abfrage-Aktualisierungen, damit der Fortschrittsbalken ruhig läuft.</summary>
        public void Tick(int ms)
        {
            if (Status == "playing") PositionMs += ms;
        }

        public event PropertyChangedEventHandler PropertyChanged;
        void OnPropertyChanged([CallerMemberName] string name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        bool Set<T>(ref T field, T value, [CallerMemberName] string name = null)
        {
            if (Equals(field, value)) return false;
            field = value;
            OnPropertyChanged(name);
            return true;
        }
    }
}
