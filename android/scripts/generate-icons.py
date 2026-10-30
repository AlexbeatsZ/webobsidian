"""Derive Android launcher assets from the supplied macOS design.

Run from the repository root:
    uv run --no-project --with pillow python android/scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image


repo = Path(__file__).resolve().parents[2]
source = Image.open(repo / "desktop/buildResources/icon-macos.png").convert("RGBA")
res = repo / "android/app/src/main/res"

for density, size in [
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
]:
    output = res / f"mipmap-{density}/app_icon.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    source.resize((size, size), Image.Resampling.LANCZOS).save(output)

# 108dp at xxxhdpi. The tile supplies its original gradient; the launcher owns
# the final outer mask. Its crystal fits within the central 66dp safe circle.
canvas_size = 432
art_size = 336
foreground = Image.new("RGBA", (canvas_size, canvas_size))
foreground.alpha_composite(
    source.resize((art_size, art_size), Image.Resampling.LANCZOS),
    ((canvas_size - art_size) // 2, (canvas_size - art_size) // 2),
)
output = res / "drawable-xxxhdpi/app_icon_foreground.png"
output.parent.mkdir(parents=True, exist_ok=True)
foreground.save(output)
