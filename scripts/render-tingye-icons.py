#!/usr/bin/env python3
"""Render the approved Tingye vector mark into iOS, macOS, and in-app assets."""
from pathlib import Path
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/brand/tingye-logo.svg"
ICON_SET = ROOT / "apps/Shared/Assets.xcassets/AppIcon.appiconset"
MARK_SET = ROOT / "apps/Shared/Assets.xcassets/BrandMark.imageset"


def logo_rgba() -> Image.Image:
    with tempfile.TemporaryDirectory(prefix="tingye-logo-") as temp:
        raster = Path(temp) / "logo.png"
        subprocess.run(["sips", "-s", "format", "png", str(SOURCE), "--out", str(raster)], check=True, stdout=subprocess.DEVNULL)
        image = Image.open(raster).convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("The logo SVG rendered fully transparent")
    return image.crop(bbox)


def mark_canvas(logo: Image.Image, size: int, fill: tuple[int, int, int, int] = (0, 0, 0, 0), coverage: float = 0.80) -> Image.Image:
    side = int(size * coverage)
    mark = logo.resize((side, side), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), fill)
    canvas.alpha_composite(mark, ((size - side) // 2, (size - side) // 2))
    return canvas


def ios_background(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (250, 247, 253, 255))
    pixels = image.load()
    for x in range(size):
        t = x / max(1, size - 1)
        color = tuple(round(a * (1 - t) + b * t) for a, b in zip((251, 249, 255), (247, 239, 249))) + (255,)
        for y in range(size): pixels[x, y] = color
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse((size * .08, size * .12, size * .72, size * .78), fill=(131, 103, 244, 28))
    draw.ellipse((size * .42, size * .25, size * .98, size * .88), fill=(237, 131, 181, 22))
    image = Image.alpha_composite(image, glow.filter(ImageFilter.GaussianBlur(size * .12)))
    return image


def save_png(image: Image.Image, path: Path, opaque: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if opaque: image = image.convert("RGB")
    image.save(path, format="PNG", optimize=True)


def main() -> None:
    logo = logo_rgba()
    icon = ios_background(1024)
    icon.alpha_composite(mark_canvas(logo, 1024, coverage=.78))
    save_png(icon, ICON_SET / "AppIcon-iOS.png", opaque=True)
    for size in (16, 32, 64, 128, 256, 512, 1024):
        save_png(mark_canvas(logo, size, coverage=.80), ICON_SET / f"AppIcon-macOS-{size}.png")
    mark = mark_canvas(logo, 192, coverage=.80)
    save_png(mark, MARK_SET / "BrandMark.png")
    # macOS asset compilation ignores a universal image that only has a 3× slot.
    for scale in (1, 2):
        side = 64 * scale
        save_png(mark.resize((side, side), Image.Resampling.LANCZOS), MARK_SET / f"BrandMark@{scale}x.png")


if __name__ == "__main__":
    main()
