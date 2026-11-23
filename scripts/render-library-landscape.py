#!/usr/bin/env python3
"""Export the original ink layers for the app. Requires macOS sips, NumPy and Pillow."""

import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/brand/landscape"
CATALOG = ROOT / "packages/TinytuneKit/Sources/DesignSystem/Resources/Artwork.xcassets"


def smooth(start, end, values):
    t = np.clip((values - start) / (end - start), 0, 1)
    return t * t * (3 - 2 * t)


def export(raw, dest, logical_size, portrait):
    # Sample the approved mask on its point grid, then upsample for Retina export.
    w, h = logical_size
    y, x = np.meshgrid(np.linspace(0, 1, h), np.linspace(0, 1, w), indexing="ij")
    mask = smooth(0, .33 if portrait else .48, x) * smooth(0, .25 if portrait else .21, y)
    if portrait:
        mask *= 1 - smooth(.65, .99, y)
    else:
        mask *= .55 + .45 * smooth(.48, .84, x)
        # Keep the original open area behind the empty-state copy and button.
        mask *= 1 - .87 * (1 - smooth(100, 182, abs(x * w - 477))) * (1 - smooth(123, 164, abs(y * h - 78)))

    rng = np.random.default_rng(218)
    fine = rng.normal(0, .039, (h, w))
    coarse = Image.fromarray((rng.random((h // 7 + 1, w // 7 + 1)) * 255).astype("uint8"))
    coarse = np.asarray(coarse.resize((w, h), Image.Resampling.BICUBIC)) / 255 - .5
    mask *= 1 + fine + coarse * .10

    scale = 3 if portrait else 2
    size = (w * scale, h * scale)
    with Image.open(raw) as src:
        rgba = src.convert("RGBA").resize(size, Image.Resampling.LANCZOS)
        factor = Image.fromarray(mask.astype("float32")).resize(size, Image.Resampling.BILINEAR)
        alpha = np.clip(np.asarray(rgba.getchannel("A")) * np.asarray(factor), 0, 255)
        rgba.putalpha(Image.fromarray(np.rint(alpha).astype("uint8")))
        rgba.save(dest, optimize=True, icc_profile=src.info.get("icc_profile"))


def main():
    with tempfile.TemporaryDirectory(prefix="tinytune-artwork-") as temp:
        rendered = Path(temp) / "raw.png"
        for composition, size in (("Horizontal", (927, 412)), ("Portrait", (402, 196))):
            portrait = composition == "Portrait"
            target = CATALOG / f"LibraryLandscape-{composition}.imageset"
            target.mkdir(exist_ok=True)
            images = []
            for appearance in ("Light", "Dark"):
                name = f"{composition}-{appearance}"
                subprocess.run(["sips", "-s", "format", "png", str(SOURCE / f"{name}.svg"),
                                "--out", str(rendered)], check=True, stdout=subprocess.DEVNULL)
                file = f"{name}.png"
                export(rendered, target / file, size, portrait)
                entry = {"filename": file, "idiom": "universal", "scale": "3x" if portrait else "2x"}
                if appearance == "Dark":
                    entry["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
                images.append(entry)
            (target / "Contents.json").write_text(json.dumps({"images": images,
                "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")


if __name__ == "__main__":
    main()
