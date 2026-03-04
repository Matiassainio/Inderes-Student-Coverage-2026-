"""
Analyst Photo Standardizer
===========================
Reads raw analyst photos from assets/analysts_raw/,
center-crops them to 1:1 (biased slightly upward so faces stay centered),
resizes to 600x600, and exports as:
  - WebP (quality 80)  → assets/analysts/<name>.webp
  - JPEG (quality 85)  → assets/analysts/<name>.jpg
"""

import os
from pathlib import Path
from PIL import Image

# ── Configuration ────────────────────────────────────────────
INPUT_DIR  = Path(__file__).parent / "assets" / "analysts_raw"
OUTPUT_DIR = Path(__file__).parent / "assets" / "analysts"
SIZE       = 600                 # output px (square)
WEBP_Q     = 80                  # WebP quality (75-85 range)
JPEG_Q     = 85                  # JPEG fallback quality
# Vertical crop bias: 0.0 = crop from top, 0.5 = center, lower = face bias
FACE_BIAS  = 0.38               # slightly above center to keep faces framed

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def center_crop_square(img: Image.Image, bias: float = 0.5) -> Image.Image:
    """Crop the largest centered square from img.
    `bias` controls vertical offset: <0.5 shifts crop upward (toward face)."""
    w, h = img.size
    side = min(w, h)

    # Horizontal: always centered
    left = (w - side) // 2
    # Vertical: apply bias (lower value = higher crop = keeps head)
    top = int((h - side) * bias)
    top = max(0, min(top, h - side))   # clamp

    return img.crop((left, top, left + side, top + side))


def process_image(src: Path, stem: str):
    """Open, crop, resize, save as WebP + JPEG."""
    img = Image.open(src).convert("RGB")
    print(f"  Source: {src.name}  ({img.size[0]}x{img.size[1]})")

    # 1. Center-crop to square (face-biased)
    sq = center_crop_square(img, bias=FACE_BIAS)

    # 2. Resize to target
    sq = sq.resize((SIZE, SIZE), Image.LANCZOS)

    # 3. Save WebP
    webp_path = OUTPUT_DIR / f"{stem}.webp"
    sq.save(webp_path, "WEBP", quality=WEBP_Q, method=6)
    webp_kb = webp_path.stat().st_size / 1024
    print(f"  → {webp_path.name}  ({webp_kb:.0f} KB)")

    # 4. Save JPEG fallback
    jpg_path = OUTPUT_DIR / f"{stem}.jpg"
    sq.save(jpg_path, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    jpg_kb = jpg_path.stat().st_size / 1024
    print(f"  → {jpg_path.name}  ({jpg_kb:.0f} KB)")

    return webp_kb, jpg_kb


# ── Main ─────────────────────────────────────────────────────
if __name__ == "__main__":
    sources = sorted(INPUT_DIR.glob("*.jpg")) + sorted(INPUT_DIR.glob("*.png"))
    if not sources:
        print(f"No images found in {INPUT_DIR}")
        exit(1)

    print(f"Processing {len(sources)} analyst photo(s)…\n")

    total_webp = 0
    total_jpg  = 0
    for src in sources:
        stem = src.stem                      # e.g. "matias-sainio"
        print(f"[{stem}]")
        wk, jk = process_image(src, stem)
        total_webp += wk
        total_jpg  += jk
        print()

    print("─" * 40)
    print(f"Done!  WebP total: {total_webp:.0f} KB  |  JPEG total: {total_jpg:.0f} KB")
    print(f"Output directory: {OUTPUT_DIR.resolve()}")
