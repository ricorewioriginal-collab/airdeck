// KI-Assistent: Gespräch mit den eingerichteten KI-Anbietern des Senders (Texte, Ansagen, Ideen).
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;
using AnMaChaCast.Ui;

namespace AnMaChaCast.Pages
{
    sealed class AiPage : View
    {
        readonly TextBox log = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Kit.PanelBg, Foreground = Kit.Fg, BorderBrush = Kit.Line, Padding = new Thickness(8) };
        readonly TextBox input = Kit.Box();
        readonly TextBlock state = Kit.Text("", 12, false, Kit.Muted, true);

        public override string Title => "KI";

        public AiPage(Ctx c) : base(c)
        {
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Children.Add(state);
            SetRow(log, 1);
            Children.Add(log);
            input.AcceptsReturn = true;
            input.TextWrapping = TextWrapping.Wrap;
            input.MinHeight = 60;
            input.MaxHeight = 140;
            input.ToolTip = "Frage oder Auftrag, z. B. „Schreibe eine 20-Sekunden-Ansage für die Morgensendung“";
            var send = Kit.Btn("Senden", Send, null, true);
            var bottom = new DockPanel { Margin = new Thickness(0, 8, 0, 0) };
            var buttons = Kit.V(send, Kit.Btn("Verlauf löschen", Clear));
            DockPanel.SetDock(buttons, Dock.Right);
            bottom.Children.Add(buttons);
            bottom.Children.Add(input);
            SetRow(bottom, 2);
            Children.Add(bottom);
        }

        public override async Task Show()
        {
            if (!C.Connected || string.IsNullOrEmpty(C.StationId)) return;
            await C.Run(async () =>
            {
                var chat = await C.Api.GetJ(C.St("/ai/chat"));
                log.Text = string.Join("\n\n", J.Arr(chat).Select(m => (J.Str(m, "role") == "user" ? "Du: " : "KI: ") + J.Str(m, "text")));
                log.ScrollToEnd();
                try
                {
                    var h = await C.Api.GetJ("/ai/health");
                    state.Text = "KI-Anbieter: " + (J.Ok(h) ? Fmt.Clip(h.GetRawText(), 180) : "nicht eingerichtet") + "   (Einrichtung im Studio unter „Weitere Funktionen“ → KI)";
                }
                catch (ApiException) { state.Text = "KI-Anbieter werden vom Server verwaltet (Einrichtung nur durch Administratoren)."; }
            }, "KI");
        }

        async Task Send()
        {
            var text = input.Text.Trim();
            if (text.Length == 0) return;
            log.Text += (log.Text.Length > 0 ? "\n\n" : "") + "Du: " + text;
            input.Text = "";
            await C.Run(async () =>
            {
                C.Status("Die KI schreibt …", false);
                var r = await C.Api.PostJ(C.St("/ai/chat"), new { prompt = text }, 300);
                log.Text += "\n\nKI: " + J.Str(r, "reply");
                log.ScrollToEnd();
                C.Ok("Fertig" + (J.Str(r, "model").Length > 0 ? " · " + J.Str(r, "model") : ""));
            }, "KI");
        }

        async Task Clear()
        {
            if (!Dlg.Confirm(C.Owner, "Den Gesprächsverlauf löschen?")) return;
            await C.Run(async () => { await C.Api.DeleteJ(C.St("/ai/chat")); log.Text = ""; }, "KI");
        }
    }
}
