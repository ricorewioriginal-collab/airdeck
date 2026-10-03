// Bausteine der Oberfläche im Code (Farben, Knöpfe, Karten). Die ganze Oberfläche wird ohne XAML aufgebaut, damit sie auch
// ohne Windows-Rechner übersetzt und geprüft werden kann (apps/windows/check).
using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace AnMaChaCast.Ui
{
    static class Kit
    {
        static SolidColorBrush B(string hex) { var b = (SolidColorBrush)new BrushConverter().ConvertFromString(hex); b.Freeze(); return b; }

        public static readonly Brush Bg = B("#0B1220");
        public static readonly Brush PanelBg = B("#101A2C");
        public static readonly Brush Field = B("#162236");
        public static readonly Brush Line = B("#2A3C56");
        public static readonly Brush Fg = B("#E6ECF5");
        public static readonly Brush Muted = B("#9FB4D6");
        public static readonly Brush Accent = B("#18B7FF");
        public static readonly Brush AccentDark = B("#0D82BD");
        public static readonly Brush Good = B("#2FBF71");
        public static readonly Brush Warn = B("#E8A33D");
        public static readonly Brush Bad = B("#FF6B6B");

        public static TextBlock Text(string text, double size = 13, bool bold = false, Brush fg = null, bool wrap = false)
        {
            return new TextBlock
            {
                Text = text, FontSize = size, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal, Foreground = fg ?? Fg,
                TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap, TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        public static TextBlock Hint(string text) => Text(text, 12, false, Muted, true);

        static Button Make(string text, string tip, bool primary)
        {
            return new Button
            {
                Content = text, ToolTip = tip, Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(3),
                Background = primary ? AccentDark : Field, Foreground = primary ? Brushes.White : Fg, BorderBrush = primary ? Accent : Line,
                Cursor = System.Windows.Input.Cursors.Hand,
            };
        }

        public static Button Btn(string text, Action click, string tip = null, bool primary = false)
        {
            var b = Make(text, tip, primary);
            b.Click += (s, e) => click();
            return b;
        }

        /// <summary>Knopf mit asynchroner Aktion: während sie läuft, ist er gesperrt (kein doppeltes Auslösen).</summary>
        public static Button Btn(string text, Func<Task> click, string tip = null, bool primary = false)
        {
            var b = Make(text, tip, primary);
            b.Click += async (s, e) =>
            {
                b.IsEnabled = false;
                try { await click(); } finally { b.IsEnabled = true; }
            };
            return b;
        }

        public static ToggleButton Toggle(string text, Action click, string tip = null)
        {
            var b = new ToggleButton { Content = text, ToolTip = tip, Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(3), Background = Field, Foreground = Fg, BorderBrush = Line };
            b.Click += (s, e) => click();
            return b;
        }

        public static TextBox Box(string text = "", double width = 0)
        {
            var t = new TextBox { Text = text, Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(3), Background = Field, Foreground = Fg, BorderBrush = Line, CaretBrush = Fg, VerticalContentAlignment = VerticalAlignment.Center };
            if (width > 0) t.Width = width;
            return t;
        }

        public static StackPanel H(params UIElement[] kids)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        public static StackPanel V(params UIElement[] kids)
        {
            var p = new StackPanel { Orientation = Orientation.Vertical };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        public static WrapPanel Wrap(params UIElement[] kids)
        {
            var p = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var k in kids) p.Children.Add(k);
            return p;
        }

        /// <summary>Karte mit Überschrift. Der Inhalt füllt den Rest der Höhe (Tabellen im Inhalt bekommen eine begrenzte Höhe und scrollen selbst).</summary>
        public static Border Card(string title, UIElement body, string hint = null)
        {
            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            if (!string.IsNullOrEmpty(title)) grid.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.Bold, FontSize = 14, Foreground = Fg, Margin = new Thickness(2, 0, 0, 6) });
            if (!string.IsNullOrEmpty(hint)) { var h = Hint(hint); h.Margin = new Thickness(2, 0, 0, 6); Grid.SetRow(h, 1); grid.Children.Add(h); }
            Grid.SetRow(body, 2);
            grid.Children.Add(body);
            return new Border { Background = PanelBg, CornerRadius = new CornerRadius(8), Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 10), Child = grid };
        }

        public static ComboBox Combo(params string[] items)
        {
            var c = new ComboBox { Margin = new Thickness(3), MinWidth = 140, Padding = new Thickness(6, 4, 6, 4) };
            foreach (var i in items) c.Items.Add(i);
            if (items.Length > 0) c.SelectedIndex = 0;
            return c;
        }

        /// <summary>Zeile "Name: Wert" für Kennzahlen.</summary>
        public static UIElement Pair(string name, string value)
        {
            var g = new Grid { Margin = new Thickness(0, 2, 0, 2) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(180) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var n = Text(name, 13, false, Muted);
            var v = Text(value, 13, false, Fg, true);
            Grid.SetColumn(v, 1);
            g.Children.Add(n);
            g.Children.Add(v);
            return g;
        }

        public static ScrollViewer Scroll(UIElement content) =>
            new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = content, Padding = new Thickness(0, 0, 8, 0) };
    }
}
