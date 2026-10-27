from PIL import Image, ImageDraw
import numpy as np

src = Image.open(r"C:/Users/29107/.dsh/attachments/v1/objects/b8/b8ce9774e5d4770779cebd8cfc31b738890c7e1fa4db2065c2b3ce53265224e6").convert("RGBA")
# Ensure an opaque white base (source is a JPEG inside a PNG wrapper).
bg = Image.new("RGBA", src.size, (255, 255, 255, 255))
bg.alpha_composite(src)
img = bg.convert("RGB")

# Flood-fill the connected white background from many edge points.
magic = (255, 0, 255)
for x in range(0, img.width, 40):
    for y in (0, img.height - 1):
        try:
            ImageDraw.floodfill(img, (x, y), magic, thresh=22)
        except Exception:
            pass
for y in range(0, img.height, 40):
    for x in (0, img.width - 1):
        try:
            ImageDraw.floodfill(img, (x, y), magic, thresh=22)
        except Exception:
            pass

arr = np.array(img)
alpha = np.where((arr[:, :, 0] > 245) & (arr[:, :, 1] < 15) & (arr[:, :, 2] > 245), 0, 255).astype(np.uint8)
# Remove the two AI watermarks, which sit outside the character.
alpha[:130, :340] = 0
alpha[1330:, 1180:] = 0

rgba = np.dstack([np.array(bg)[:, :, :3], alpha])
out = Image.fromarray(rgba, "RGBA")
bbox = out.getbbox()
print("bbox", bbox, "size", out.size)
out = out.crop(bbox)

# Fit into the same 1000x1000 canvas as pet.png, bottom-centered.
canvas = Image.new("RGBA", (1000, 1000), (0, 0, 0, 0))
scale = min(980 / out.width, 980 / out.height)
w = max(1, int(out.width * scale))
h = max(1, int(out.height * scale))
resized = out.resize((w, h), Image.LANCZOS)
canvas.alpha_composite(resized, ((1000 - w) // 2, 1000 - h - 10))
canvas.save(r"D:/made in harness/web/assets/pet-sleep.png")
canvas.save(r"D:/made in harness/desktop-native/Assets/pet-sleep.png")
print("saved", canvas.size, "character", w, h)
