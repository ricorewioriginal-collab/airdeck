"""Build small app icons from the current platform logo PNGs (requires Pillow)."""

from pathlib import Path
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "icons"


def symbol(name: str, bottom_fraction: float) -> Image.Image:
    source = Image.open(ASSETS / name).convert("RGBA")
    # The uploaded artwork includes a wordmark below the symbol. At launcher
    # sizes only the symbol is legible; preserve its pixels and transparency.
    cropped = source.crop((0, 0, source.width, round(source.height * bottom_fraction)))
    return cropped.crop(cropped.getbbox())


def square(source: Image.Image, size: int, fill: float = 0.90) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    inset = ImageOps.contain(source, (round(size * fill), round(size * fill)), Image.Resampling.LANCZOS)
    image.alpha_composite(inset, ((size - inset.width) // 2, (size - inset.height) // 2))
    return image


for platform, fraction in (("windows", 0.73), ("server", 0.73)):
    artwork = symbol(f"airdeck-{platform}.png", fraction)
    square(artwork, 256).save(
        ASSETS / f"airdeck-{platform}.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

general = symbol("airdeck-gesamt.png", 0.72)
for size in (32, 180, 192, 512):
    square(general, size).save(ROOT / "studio" / "icons" / f"icon-{size}.png")

android = symbol("airdeck-android.png", 0.71)
for folder in (ROOT / "apps" / "android" / "res").glob("mipmap-*dpi"):
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
