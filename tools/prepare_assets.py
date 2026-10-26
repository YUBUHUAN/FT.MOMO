"""Prepare MomoPet art assets from the reference portrait.

- Remove the white paper background using a border-seeded flood fill
  (interior whites such as the shirt/tie are preserved).
- Export transparent pet, avatar, app icons, tray icon and .ico.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src" / "portrait.jpg"
OUT = ROOT / "web" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

CREAM = (251, 246, 238, 255)
INK = (27, 26, 31, 255)
BLUSH = (243, 184, 190, 255)


def cutout(src: Image.Image) -> Image.Image:
    """Knock out the paper. Skin is (255, 241, 238) - very close to white -
    so only true paper (all channels >= 250, almost zero saturation) seeded
    from the border is removed. Interior whites (shirt, tie) survive.
    """
    rgb = src.convert("RGB")
    arr = np.asarray(rgb).astype(np.int16)
    lo = arr.min(axis=2)
    hi = arr.max(axis=2)
    paper = (lo >= 250) & ((hi - lo) <= 5)

    mask = Image.fromarray(np.where(paper, 255, 0).astype(np.uint8), "L").copy()
    # 4-connected flood fill from every corner over the paper mask.
    for seed in [(0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1)]:
        ImageDraw.floodfill(mask, seed, 128, thresh=0)

    outside = np.asarray(mask) == 128
    paper_inside = paper & (~outside)
    # The white shirt, collar and tie are drawn with the same paper white as
    # the background. Keep that patch; every other enclosed white pocket is
    # negative space between hair strands and becomes transparent.
    keep = np.zeros_like(paper)
    keep[1280:1525, 935:1125] = True
    remove = paper_inside & (~keep)
    if remove.any():
        outside = outside | remove
    alpha_arr = np.where(outside, 0, 255).astype(np.uint8)

    # The source JPEG carries a light fringe around the ink. Turn that fringe
    # into partial alpha instead of an opaque white outline: only a ~5px band
    # around the silhouette is affected, so the face and shirt stay solid.
    outside_img = Image.fromarray(np.where(outside, 255, 0).astype(np.uint8), "L").copy()
    band = (np.asarray(outside_img.filter(ImageFilter.MaxFilter(11))) > 0) & (~outside)
    lum = arr.min(axis=2)
    soft = np.clip((255 - lum) * 1.35, 0, 255).astype(np.uint8)
    alpha_arr = alpha_arr.copy()
    alpha_arr[band] = np.minimum(alpha_arr[band], soft[band])

    alpha = Image.fromarray(alpha_arr, "L").filter(ImageFilter.GaussianBlur(0.9))

    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def trim(im: Image.Image, pad_ratio: float = 0.035) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        return im
    pad = int(max(im.size) * pad_ratio)
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(im.width, bbox[2] + pad)
    bottom = min(im.height, bbox[3] + pad)
    return im.crop((left, top, right, bottom))


def fit_square(im: Image.Image, size: int) -> Image.Image:
    ratio = min(size / im.width, size / im.height)
    resized = im.resize((max(1, round(im.width * ratio)), max(1, round(im.height * ratio))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def rounded_bg(size: int, radius_ratio: float = 0.22) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=CREAM)
    return bg


def main() -> None:
    src = Image.open(SRC)
    pet = trim(cutout(src), 0.03)
    print("cutout bbox", pet.getbbox(), "size", pet.size)

    pet_1000 = fit_square(pet, 1000)
    pet_1000.save(OUT / "pet.png", optimize=True)
    pet_560 = fit_square(pet, 560)
    pet_560.save(OUT / "pet-560.png", optimize=True)

    # Head crop for avatars / tray icon. Coordinates are relative to the full art.
    head = pet.crop(
        (
            int(pet.width * 0.08),
            int(pet.height * 0.06),
            int(pet.width * 0.92),
            int(pet.height * 0.82),
        )
    )
    head_sq = fit_square(head, 512)

    avatar = Image.new("RGBA", (512, 512), CREAM)
    avatar.alpha_composite(head_sq)
    avatar.save(OUT / "avatar.png", optimize=True)

    # Circular avatar for the profile card.
    circle = Image.new("L", (512, 512), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, 511, 511), fill=255)
    circle_avatar = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    circle_avatar.paste(avatar, (0, 0), circle)
    circle_avatar.save(OUT / "avatar-round.png", optimize=True)

    # App / PWA icons: character on a cream rounded tile.
    for size in (192, 512):
        tile = rounded_bg(size)
        art = fit_square(pet, int(size * 0.86))
        tile.alpha_composite(art, ((size - art.width) // 2, int(size * 0.10)))
        tile.save(OUT / f"icon-{size}.png", optimize=True)
    # maskable variant: bigger safe area padding
    for size in (192, 512):
        tile = Image.new("RGBA", (size, size), CREAM)
        art = fit_square(pet, int(size * 0.70))
        tile.alpha_composite(art, ((size - art.width) // 2, int(size * 0.16)))
        tile.save(OUT / f"maskable-{size}.png", optimize=True)

    # Tray icon (dark hair reads better on light trays with a small cream disc).
    tray = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    disc = Image.new("L", (64, 64), 0)
    ImageDraw.Draw(disc).ellipse((1, 1, 62, 62), fill=255)
    bg = Image.new("RGBA", (64, 64), CREAM)
    head64 = fit_square(head, 60)
    bg.alpha_composite(head64, (2, 2))
    tray.paste(bg, (0, 0), disc)
    tray.save(OUT / "tray.png", optimize=True)

    # Windows .ico for the app window / exe shortcut.
    pet_256 = fit_square(pet, 256)
    ico_tile = rounded_bg(256)
    ico_tile.alpha_composite(pet_256)
    ico_tile.save(OUT / "app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # A quiet preview sheet to eyeball the cutout on light and dark paper.
    sheet = Image.new("RGB", (1200, 640), (251, 246, 238))
    d = ImageDraw.Draw(sheet)
    d.rectangle((600, 0, 1199, 639), fill=(32, 33, 38))
    preview = fit_square(pet, 560)
    sheet.paste(preview, (20, 40), preview)
    sheet.paste(preview, (620, 40), preview)
    sheet.save(ROOT / "test" / "cutout-preview.png")

    native_assets = ROOT / "desktop-native" / "Assets"
    native_assets.mkdir(parents=True, exist_ok=True)
    for name in ("pet.png", "avatar-round.png", "app.ico", "tray.png"):
        shutil.copyfile(OUT / name, native_assets / name)

    print("wrote assets to", OUT)


if __name__ == "__main__":
    main()
