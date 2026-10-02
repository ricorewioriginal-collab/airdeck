"""Build small app icons from the current platform logo PNGs (requires Pillow)."""

from pathlib import Path
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "icons"


def symbol(name: str) -> Image.Image:
    # The platform source files are already a square, self-contained mark
    # (no wordmark stacked below) - just load and trim transparent edges.
    source = Image.open(ASSETS / name).convert("RGBA")
    return source.crop(source.getbbox())


def square(source: Image.Image, size: int, fill: float = 0.90) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    inset = ImageOps.contain(source, (round(size * fill), round(size * fill)), Image.Resampling.LANCZOS)
    image.alpha_composite(inset, ((size - inset.width) // 2, (size - inset.height) // 2))
    return image


for platform in ("windows", "server"):
    artwork = symbol(f"anmachacast-{platform}.png")
    square(artwork, 256).save(
        ASSETS / f"anmachacast-{platform}.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

general = symbol("anmachacast-gesamt.png")
for size in (32, 180, 192):
    square(general, size).save(ROOT / "studio" / "icons" / f"icon-{size}.png")
square(general, 512, fill=0.96).save(ROOT / "studio" / "icons" / "icon-512.png")

android = symbol("anmachacast-android.png")
for folder in (ROOT / "apps" / "android" / "app" / "src" / "main" / "res").glob("mipmap-*dpi"):
    for filename in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
        target = folder / filename
        if not target.exists():
            continue
        size = Image.open(target).width
        foreground = filename.endswith("foreground.png")
        icon = square(android, size, 0.66 if foreground else 0.88)
        if not foreground:
            background = Image.new("RGBA", (size, size), "#000000")
            background.alpha_composite(icon)
            icon = background
        icon.save(target)
