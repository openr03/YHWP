"""YHWP 앱 아이콘 생성기 (Windows/Linux/macOS 공통, Pillow 필요).

- 큰 크기(64px 이상): 블루 그라데이션 둥근 사각형 + 접힌 귀퉁이 흰 문서 + 파란 '한' + 주황 밑줄
- 작은 크기(48px 이하): 문서 없이 굵은 흰 '한'만 크게 — 제목 줄·작업 표시줄에서도 선명하게
각 크기를 4배로 그린 뒤 줄여 계단 현상을 없앤다.

사용: python scripts/render-app-icon.py
결과: assets/logo/logo-*.png, favicon.ico, icon.icns, 그리고 studio-host 의 favicon·시작 화면 로고
"""
from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO_DIR = ROOT / "assets" / "logo"
STUDIO_PUBLIC = ROOT / "apps" / "studio-host" / "public"
SS = 4  # supersampling

BLUE_TOP = (76, 125, 255)
BLUE_BOTTOM = (29, 63, 191)
BRAND = (47, 98, 240)
ORANGE = (255, 138, 61)
FOLD = (214, 225, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/malgunbd.ttf"),
        Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
        Path("/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    sys.exit("한글 굵은 글꼴을 찾을 수 없습니다 (맑은 고딕 Bold 등)")


def gradient(size: int) -> Image.Image:
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.35 + y * 0.65) / size
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOTTOM))
    return grad


def squircle_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - inset, size - inset), radius, fill=255)
    return mask


def draw_centered(draw: ImageDraw.ImageDraw, text: str, box, fnt, fill) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    w, h = right - left, bottom - top
    x0, y0, x1, y1 = box
    draw.text((x0 + (x1 - x0 - w) / 2 - left, y0 + (y1 - y0 - h) / 2 - top), text, font=fnt, fill=fill)


def render(px: int) -> Image.Image:
    size = px * SS
    small = px <= 48
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = round(size * (0.04 if small else 0.06))
    radius = round(size * 0.22)

    if not small:
        # 아래로 은은한 그림자
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            (inset, inset + size * 0.02, size - inset, size - inset + size * 0.02), radius, fill=(10, 20, 60, 90))
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(size * 0.02)))

    body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    body.paste(gradient(size), (0, 0), squircle_mask(size, inset, radius))
    # 위쪽 광택
    gloss = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    fade = Image.linear_gradient("L").resize((size, size)).point(lambda v: max(0, 48 - v * 48 // 128))
    gloss.putalpha(fade)
    gloss_mask = squircle_mask(size, inset, radius)
    body.alpha_composite(Image.composite(gloss, Image.new("RGBA", (size, size)), gloss_mask))
    canvas.alpha_composite(body)
    draw = ImageDraw.Draw(canvas)

    if small:
        draw_centered(draw, "한", (0, size * 0.02, size, size), font(round(size * 0.66)), (255, 255, 255, 255))
        return canvas.resize((px, px), Image.LANCZOS)

    # 문서 한 장 (접힌 귀퉁이)
    x0, y0, x1, y1 = size * 0.25, size * 0.17, size * 0.75, size * 0.83
    fold = size * 0.13
    r = size * 0.035
    page = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pd = ImageDraw.Draw(page)
    pd.rounded_rectangle((x0, y0, x1, y1), r, fill=(255, 255, 255, 255))
    pd.polygon([(x1 - fold, y0), (x1 + 1, y0), (x1 + 1, y0 + fold)], fill=(0, 0, 0, 0))
    page_shadow = page.copy().filter(ImageFilter.GaussianBlur(size * 0.015))
    tint = Image.new("RGBA", (size, size), (8, 20, 80, 0))
    tint.putalpha(page_shadow.getchannel("A").point(lambda a: a * 0.35))
    canvas.alpha_composite(tint, (0, round(size * 0.012)))
    canvas.alpha_composite(page)
    draw.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold - r * 0.4), (x1, y0 + fold)], fill=FOLD + (255,))
    draw.line([(x1 - fold, y0), (x1, y0 + fold)], fill=(190, 205, 250, 255), width=max(1, round(size * 0.004)))

    draw_centered(draw, "한", (x0, y0 + size * 0.05, x1, y1 - size * 0.12), font(round(size * 0.36)), BRAND + (255,))
    bar_w, bar_h = size * 0.24, size * 0.04
    cx = (x0 + x1) / 2
    draw.rounded_rectangle((cx - bar_w / 2, y1 - size * 0.14, cx + bar_w / 2, y1 - size * 0.14 + bar_h),
                           bar_h / 2, fill=ORANGE + (255,))
    return canvas.resize((px, px), Image.LANCZOS)


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, images: dict[int, Image.Image]) -> None:
    sizes = sorted(images)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    entries, blobs, offset = b"", b"", 6 + 16 * len(sizes)
    for s in sizes:
        data = png_bytes(images[s])
        entries += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    path.write_bytes(header + entries + blobs)


def write_icns(path: Path, images: dict[int, Image.Image]) -> None:
    types = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024)]
    chunks = b""
    for code, s in types:
        data = png_bytes(images[s])
        chunks += code.encode() + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256, 300, 512, 1024]
    images = {s: render(s) for s in sizes}
    for s in [16, 32, 48, 128, 256, 300, 512, 1024]:
        images[s].save(LOGO_DIR / f"logo-{s}.png", optimize=True)
    write_ico(LOGO_DIR / "favicon.ico", {s: images[s] for s in [16, 24, 32, 48, 64, 128, 256]})
    write_icns(LOGO_DIR / "icon.icns", images)
    write_ico(STUDIO_PUBLIC / "favicon.ico", {s: images[s] for s in [16, 32, 48]})
    images[128].save(STUDIO_PUBLIC / "images" / "yhwp-logo.png", optimize=True)
    print("아이콘 생성 완료:", ", ".join(f"{s}px" for s in sizes))


if __name__ == "__main__":
    main()
