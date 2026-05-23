"""Regenera los iconos PNG de Klinip con la K opticamente centrada y un fondo
a sangre (sin paddings transparentes ni sombra inferior), para que iOS y
Android no los desencuadren al instalar la PWA en la pantalla de inicio.

Uso:
    python frontend/scripts/build_app_icon.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ICONS_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"

# Paleta principal extraida del icono actual: degradado azul cielo -> azul rey.
GRADIENT_TOP = (95, 204, 254)    # #5fccfe
GRADIENT_MID = (12, 142, 253)    # #0c8efd
GRADIENT_BOTTOM = (4, 81, 252)   # #0451fc

FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/seguibl.ttf"),    # Segoe UI Black
    Path("C:/Windows/Fonts/segoeuib.ttf"),   # Segoe UI Bold
    Path("C:/Windows/Fonts/arialbd.ttf"),    # Arial Bold
]


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    raise RuntimeError("No se encontro una fuente bold en C:/Windows/Fonts")


def _make_gradient(size: int) -> Image.Image:
    """Degradado vertical suave con sutil empuje horizontal hacia la izquierda."""
    img = Image.new("RGB", (size, size), GRADIENT_BOTTOM)
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        if t < 0.5:
            tt = t / 0.5
            r = int(GRADIENT_TOP[0] + (GRADIENT_MID[0] - GRADIENT_TOP[0]) * tt)
            g = int(GRADIENT_TOP[1] + (GRADIENT_MID[1] - GRADIENT_TOP[1]) * tt)
            b = int(GRADIENT_TOP[2] + (GRADIENT_MID[2] - GRADIENT_TOP[2]) * tt)
        else:
            tt = (t - 0.5) / 0.5
            r = int(GRADIENT_MID[0] + (GRADIENT_BOTTOM[0] - GRADIENT_MID[0]) * tt)
            g = int(GRADIENT_MID[1] + (GRADIENT_BOTTOM[1] - GRADIENT_MID[1]) * tt)
            b = int(GRADIENT_MID[2] + (GRADIENT_BOTTOM[2] - GRADIENT_MID[2]) * tt)
        for x in range(size):
            shift = int(8 * (1 - x / max(size - 1, 1)))
            px[x, y] = (
                min(255, r + shift),
                min(255, g + shift),
                min(255, b + shift),
            )
    return img


def _measure_glyph(font: ImageFont.FreeTypeFont, size: int) -> tuple[int, int, int, int]:
    """Mide el bounding box REAL del glifo renderizado (no la metrica tipografica)."""
    probe = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(probe).text((size, size), "K", font=font, fill=255, anchor="lt")
    arr = np.array(probe)
    ys, xs = np.where(arr > 128)
    if len(xs) == 0:
        return 0, 0, 0, 0
    # Desplazamientos desde el punto de origen (size, size) y dimensiones reales.
    off_x = int(xs.min()) - size
    off_y = int(ys.min()) - size
    width = int(xs.max() - xs.min())
    height = int(ys.max() - ys.min())
    return off_x, off_y, width, height


def _draw_centered_k(img: Image.Image, *, height_ratio: float = 0.55) -> None:
    """Dibuja la K blanca con su bounding box real centrado en el canvas."""
    size = img.width
    target_h = int(size * height_ratio)

    font = _load_font(target_h)
    # Ajusta el tamano de fuente hasta que la altura RENDERIZADA case con el objetivo.
    for _ in range(6):
        off_x, off_y, _w, h = _measure_glyph(font, size)
        if h == 0 or abs(h - target_h) < 4:
            break
        font = _load_font(max(8, int(font.size * target_h / h)))

    off_x, off_y, width, height = _measure_glyph(font, size)
    cx, cy = size // 2, size // 2
    draw_x = cx - width / 2 - off_x
    draw_y = cy - height / 2 - off_y
    ImageDraw.Draw(img).text(
        (draw_x, draw_y), "K", font=font, fill=(255, 255, 255, 255), anchor="lt"
    )


def _rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    radius = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def build_master(size: int = 1024) -> Image.Image:
    """Icono base sin esquinas redondeadas (full-bleed) — apto para iOS/Android."""
    canvas = _make_gradient(size).convert("RGBA")
    _draw_centered_k(canvas)
    return canvas


def build_rounded(size: int = 1024, radius_ratio: float = 0.225) -> Image.Image:
    """Variante con esquinas redondeadas (para favicons y usos web in-app)."""
    base = build_master(size)
    rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rounded.paste(base, (0, 0), _rounded_mask(size, radius_ratio))
    return rounded


def _save(img: Image.Image, name: str) -> None:
    out = ICONS_DIR / name
    img.save(out, format="PNG", optimize=True)
    print(f"OK {out.name} ({img.size[0]}x{img.size[1]})")


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # 1024 master full-bleed — base para iOS y Android.
    master = build_master(1024)

    # Apple touch icon: 180x180 sin esquinas (iOS aplica su propia mascara).
    _save(master.resize((180, 180), Image.LANCZOS), "apple-touch-icon.png")

    # Android Chrome 192/512: full-bleed para "maskable" + "any".
    _save(master.resize((512, 512), Image.LANCZOS), "android-chrome-512x512.png")
    _save(master.resize((192, 192), Image.LANCZOS), "android-chrome-192x192.png")

    # Variante redondeada para favicons y usos generales en la web.
    rounded = build_rounded(1024)
    _save(rounded, "app-icon-1024.png")
    _save(rounded, "new_logo_k.png")
    _save(rounded, "new_logo_k_sf.png")

    for px in (16, 32, 48):
        _save(rounded.resize((px, px), Image.LANCZOS), f"favicon-{px}x{px}.png")

    # favicon.ico multi-tamano.
    rounded.resize((48, 48), Image.LANCZOS).save(
        ICONS_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48)],
    )
    print("OK favicon.ico")


if __name__ == "__main__":
    main()
