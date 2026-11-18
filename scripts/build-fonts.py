"""Build the subset Inter fonts Lineup embeds in exports.

Inter (OFL-1.1, https://rsms.me/inter) from the inter-ui npm package, cut down to the
characters diagrams use so exported SVG/PNG/PDF files stay small.

    pip install fonttools brotli
    npm pack inter-ui@4.1.1 && tar xzf inter-ui-4.1.1.tgz
    python scripts/build-fonts.py package/web
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "package/web")
OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "fonts"

UNICODES = (
    list(range(0x20, 0x7F))        # Basic Latin
    + list(range(0xA0, 0x180))     # Latin-1 + Latin Extended-A (µ ° ± × ÷ é …)
    + list(range(0x370, 0x400))    # Greek (Σ φ Δ λ π ω …)
    + list(range(0x2000, 0x2070))  # General punctuation (– — ′ ″ …)
    + list(range(0x2070, 0x20A0))  # Superscripts and subscripts (⁻¹ ₀ …)
    + [0x20AC, 0x2122, 0x2126]     # € ™ Ω
    + list(range(0x2190, 0x21A0))  # Arrows (↑ ↓ → ←)
    + list(range(0x2200, 0x2270))  # Math operators (− ∑ √ ∞ ≈ ≠ ≤ ≥)
)

for style in ("Regular", "Italic"):
    for flavor, ext in (("woff2", "woff2"), (None, "ttf")):
        opts = subset.Options()
        opts.flavor = flavor
        opts.layout_features = ["kern", "liga", "calt", "tnum", "case"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        font = TTFont(SRC / f"Inter-{style}.woff2")
        font.flavor = None
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=UNICODES)
        sub.subset(font)
        font.flavor = flavor
        out = OUT / f"Inter-{style}.{ext}"
        font.save(out)
        print(out.name, out.stat().st_size, "bytes")
