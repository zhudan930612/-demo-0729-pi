# Assemble motion_strip.png from captured frames + Final Frame Contract check (static vs t=end, same pipeline => exact 0 expected).
# Usage: python brand/p2m/tools/make_strip.py
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
frames_dir = root / "outputs" / "motion_frames"
times = [0, 200, 500, 750, 1000, 1232, 1400]

frames = []
for t in times:
    im = Image.open(frames_dir / f"t_{t:04d}.png").convert("RGB")
    frames.append((t, im))

w, h = frames[0][1].size
label_h = 40
pad = 12
strip = Image.new("RGB", (len(frames) * (w + pad) + pad, h + label_h + 2 * pad), "#0a0f2a")
d = ImageDraw.Draw(strip)
for i, (t, im) in enumerate(frames):
    x = pad + i * (w + pad)
    strip.paste(im, (x, pad + label_h))
    d.text((x + 8, pad + 12), f"t={t}ms", fill="#9fb0d8")
strip.save(root / "outputs" / "motion_strip.png")
print(f"strip: {strip.size}")

# Final Frame Contract: ?static=1 vs ?t=1400, same tool/viewport/DPR -> must be exactly identical
a = Image.open(frames_dir / "static.png").convert("RGB")
b = Image.open(frames_dir / "t_1400.png").convert("RGB")
assert a.size == b.size, f"size mismatch {a.size} vs {b.size}"
diff_px = sum(1 for pa, pb in zip(a.tobytes(), b.tobytes()) if pa != pb)
total = a.size[0] * a.size[1] * 3
print(f"final-frame diff: {diff_px}/{total} bytes differ")
print("FINAL FRAME CONTRACT:", "PASS (exact)" if diff_px == 0 else "FAIL")
