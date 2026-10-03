// QR-Code als WPF-Bild (ohne System.Drawing): die Modulmatrix von QRCoder wird in ein Pixelbild übertragen.
using System;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using QRCoder;

namespace AnMaChaCast.Ui
{
    static class QrImage
    {
        /// <param name="scale">Pixel je Modul</param>
        public static BitmapSource Render(string text, int scale = 8)
        {
            using (var gen = new QRCodeGenerator())
            using (var data = gen.CreateQrCode(text, QRCodeGenerator.ECCLevel.M))
            {
                var m = data.ModuleMatrix;
                const int quiet = 4; // vorgeschriebener weißer Rand
                var modules = m.Count + 2 * quiet;
                var size = modules * scale;
                var pixels = new byte[size * size];
                for (var i = 0; i < pixels.Length; i++) pixels[i] = 255;
                for (var y = 0; y < m.Count; y++)
                    for (var x = 0; x < m.Count; x++)
                    {
                        if (!m[y][x]) continue;
                        for (var dy = 0; dy < scale; dy++)
                            for (var dx = 0; dx < scale; dx++)
                                pixels[((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx] = 0;
                    }
                var bmp = BitmapSource.Create(size, size, 96, 96, PixelFormats.Gray8, null, pixels, size);
                bmp.Freeze();
                return bmp;
            }
        }
    }
}
