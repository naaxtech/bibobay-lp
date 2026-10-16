# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "reportlab==5.0.1",
#   "pillow==12.3.0",
#   "fonttools==4.67.0",
#   "pymupdf==1.28.2",
#   "svglib==2.3.0",
# ]
# ///
"""Builds the free Bibo Bay Activity Pack (rulings R66-R69 in the project ledger).

Run from the repository root:

    uv run scripts/freebie/build_activity_pack.py

It writes content/freebies/bibo-bay-activity-pack.pdf (not public: served only by the signed route,
ruling R140), the page previews in public/freebies and
lib/content/activity-pack.manifest.json, which the site and the tests read.

- Copy comes from the site's own fallback content (scripts/freebie/export-content.ts), so the pack
  and the page never disagree; art comes from the channel stills in public/brand/art.
- Every QR code and link goes to the Bibo Bay channel, its subscribe prompt or one of its videos.
- Ink-friendly: only the cover is full colour; activity pages are line art on white.
- Fonts: Fredoka and Plus Jakarta Sans (SIL Open Font License, the site's own typefaces), fetched
  from the Google Fonts repository into the temp folder and embedded as subsets.
- The output is reproducible: same inputs, same bytes (reportlab's invariant mode).
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

import pymupdf as fitz
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools.varLib import instancer
from PIL import Image
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from svglib.svglib import svg2rlg

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "public" / "brand" / "art"
PREVIEW_DIR = ROOT / "public" / "freebies"
PDF_DIR = ROOT / "content" / "freebies"
PDF_NAME = "bibo-bay-activity-pack.pdf"
MANIFEST = ROOT / "lib" / "content" / "activity-pack.manifest.json"
PREVIEW_WIDTHS = (480, 960)

W, H = A4
MARGIN = 16 * mm
TOP = H - 18 * mm
FOOT = 15 * mm

# Brand tokens (lib/brand/tokens.ts).
NAVY = HexColor("#283b63")
NAVY_SOFT = HexColor("#4a5878")
CREAM = HexColor("#fffbf8")
SAND = HexColor("#fbe9d4")
TEAL = HexColor("#349da1")
TEAL_INK = HexColor("#0c6b68")
YELLOW = HexColor("#fdbb1f")
ORANGE = HexColor("#f06b32")
PURPLE = HexColor("#9467aa")
OCEAN_DEEP = HexColor("#0b5cb8")
KELP = HexColor("#6fbf4a")
RED = HexColor("#e5483f")
LINE = 2.6

# Pinned to the google/fonts commit that last changed each file, and checked by sha256, so the pack
# rebuilds byte for byte (review M7). Both fonts are OFL.
FONTS = {
    "Fredoka": ("https://raw.githubusercontent.com/google/fonts/eda3fe521878f70de0e2d91fd6d800f93f8c4758/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf", "2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8", {"wght": 600, "wdth": 100}),
    "Jakarta": ("https://raw.githubusercontent.com/google/fonts/8cd7d0de182c88592d6852c245fe48f66eef55ee/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf", "89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8", {"wght": 500}),
    "JakartaBold": ("https://raw.githubusercontent.com/google/fonts/8cd7d0de182c88592d6852c245fe48f66eef55ee/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf", "89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8", {"wght": 750}),
}


# ---------------------------------------------------------------------------------------------
# Inputs


def load_fonts() -> None:
    cache = Path(tempfile.gettempdir()) / "bibobay-freebie-fonts"
    cache.mkdir(exist_ok=True)
    for name, (url, sha256, axes) in FONTS.items():
        variable = cache / (f"{sha256[:12]}-" + url.rsplit("/", 1)[1].replace("%5B", "[").replace("%5D", "]").replace(",", "_"))
        if not variable.exists() or hashlib.sha256(variable.read_bytes()).hexdigest() != sha256:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != sha256:
                raise SystemExit(f"{url} does not match its pinned sha256")
            variable.write_bytes(data)
        # Instanced on every run, keeping the source font's own timestamp: fontTools otherwise
        # stamps the save time into the font, and the embedded subset (so the PDF's bytes) would
        # depend on when the cache was filled.
        static = cache / f"{name}-{sha256[:12]}.ttf"
        font = instancer.instantiateVariableFont(FontToolsFont(variable, recalcTimestamp=False), axes)
        font.recalcTimestamp = False
        font.save(static)
        pdfmetrics.registerFont(TTFont(name, str(static)))


def load_content() -> dict:
    result = subprocess.run("npx tsx scripts/freebie/export-content.ts", cwd=ROOT, shell=True, check=True, capture_output=True)
    return json.loads(result.stdout.decode("utf-8"))


# ---------------------------------------------------------------------------------------------
# Drawing helpers


class Pack:
    def __init__(self, path: Path, content: dict):
        self.c = canvas.Canvas(str(path), pagesize=A4, invariant=1, pageCompression=1)
        self.c.setTitle("Bibo Bay Activity Pack")
        self.c.setAuthor("Bibo Bay")
        self.c.setSubject("Printable activities for little learners ages 2-6, with Tula, Bob and Lumi")
        self.c.setCreator("Bibo Bay")
        self.content = content
        self.links: list[str] = []
        self.pages: list[str] = []
        # Every QR code's payload with its page number, for the manifest and tests/freebie (review M8).
        self.qr_codes: list[dict] = []
        self.videos = {episode["id"]: episode for episode in content["episodes"]}

    # -- primitives
    def link(self, url: str, x: float, y: float, w: float, h: float) -> None:
        self.links.append(url)
        self.c.linkURL(url, (x, y, x + w, y + h), relative=0, thickness=0)

    def style(self, width: float = LINE, stroke=NAVY, fill=white) -> None:
        c = self.c
        c.setLineWidth(width)
        c.setStrokeColor(stroke)
        c.setFillColor(fill)
        c.setLineJoin(1)
        c.setLineCap(1)
        c.setDash()

    def text(self, value: str, x: float, y: float, font: str = "Jakarta", size: float = 11, color=NAVY, align: str = "left") -> float:
        c = self.c
        c.setFont(font, size)
        c.setFillColor(color)
        width = pdfmetrics.stringWidth(value, font, size)
        if align == "center":
            x -= width / 2
        elif align == "right":
            x -= width
        c.drawString(x, y, value)
        return width

    def para(self, value: str, x: float, top: float, width: float, size: float = 11, font: str = "Jakarta", color=NAVY, leading: float | None = None, align: int = 0) -> float:
        style = ParagraphStyle("p", fontName=font, fontSize=size, leading=leading or size * 1.42, textColor=color, alignment=align)
        paragraph = Paragraph(escape(value), style)
        _, height = paragraph.wrap(width, 2000)
        paragraph.drawOn(self.c, x, top - height)
        return height

    def image(self, name: str, x: float, y: float, w: float, h: float, radius: float = 0, focus: tuple[float, float] = (0.5, 0.5), dpi: int = 170) -> None:
        im = Image.open(ART / f"{name}.webp").convert("RGB")
        iw, ih = im.size
        target = w / h
        cw, ch = (ih * target, ih) if iw / ih > target else (iw, iw / target)
        left = min(max(focus[0] * iw - cw / 2, 0), iw - cw)
        top = min(max(focus[1] * ih - ch / 2, 0), ih - ch)
        im = im.crop((round(left), round(top), round(left + cw), round(top + ch)))
        px = round(w / 72 * dpi)
        if px < im.width:
            im = im.resize((px, round(px * h / w)), Image.LANCZOS)
        buffer = io.BytesIO()
        im.save(buffer, "JPEG", quality=82, optimize=True)
        buffer.seek(0)
        c = self.c
        c.saveState()
        if radius:
            path = c.beginPath()
            path.roundRect(x, y, w, h, radius)
            c.clipPath(path, stroke=0, fill=0)
        c.drawImage(ImageReader(buffer), x, y, w, h)
        c.restoreState()

    def qr(self, url: str, x: float, y: float, size: float) -> None:
        self.qr_codes.append({"page": len(self.pages), "url": url})
        widget = QrCodeWidget(url)
        widget.barLevel = "M"
        widget.barBorder = 2
        widget.barFillColor = NAVY
        widget.barStrokeColor = NAVY
        x0, y0, x1, y1 = widget.getBounds()
        drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
        drawing.add(widget)
        self.c.setFillColor(white)
        self.c.rect(x, y, size, size, stroke=0, fill=1)
        renderPDF.draw(drawing, self.c, x, y)
        self.link(url, x, y, size, size)

    def qr_card(self, url: str, title: str, x: float, y: float, w: float = 168, accent=TEAL) -> None:
        """A watch card: QR code, 'Scan to watch' and the video's title. (x, y) is the lower-left corner."""
        c = self.c
        h = 78
        self.style(1.4, accent)
        c.roundRect(x, y, w, h, 12, stroke=1, fill=1)
        self.qr(url, x + 7, y + 7, h - 14)
        tx = x + h + 2
        self.text("SCAN TO WATCH", tx, y + h - 20, "Fredoka", 8.5, accent)
        self.para(title, tx, y + h - 26, w - h - 8, 8.6, "JakartaBold", NAVY, 10.6)
        self.link(url, x, y, w, h)

    def header(self, eyebrow: str, title: str, accent, intro: str | None = None, intro_width: float = 300) -> float:
        c = self.c
        self.pages.append(title)
        pill_w = pdfmetrics.stringWidth(eyebrow, "Fredoka", 9.5) + 20
        c.setFillColor(accent)
        c.roundRect(MARGIN, TOP - 18, pill_w, 18, 9, stroke=0, fill=1)
        self.text(eyebrow, MARGIN + 10, TOP - 12.5, "Fredoka", 9.5, white)
        self.text(title, MARGIN, TOP - 52, "Fredoka", 29)
        width = min(pdfmetrics.stringWidth(title, "Fredoka", 29), 330)
        self.wave(MARGIN, TOP - 64, width, accent)
        if intro:
            return TOP - 78 - self.para(intro, MARGIN, TOP - 76, intro_width, 10.5, color=NAVY_SOFT)
        return TOP - 76

    def wave(self, x: float, y: float, width: float, color, amplitude: float = 2.6, period: float = 18) -> None:
        c = self.c
        self.style(2.4, color)
        path = c.beginPath()
        path.moveTo(x, y)
        steps = max(int(width / 3), 2)
        for i in range(1, steps + 1):
            px = x + width * i / steps
            path.lineTo(px, y + amplitude * math.sin((px - x) / period * 2 * math.pi))
        c.drawPath(path, stroke=1, fill=0)

    def footer(self, number: int, total: int) -> None:
        label = "Bibo Bay  ·  Watch free on YouTube: "
        handle = "youtube.com/@bibobay-tv"
        x = MARGIN
        x += self.text(label, x, FOOT, "Jakarta", 8, NAVY_SOFT)
        width = self.text(handle, x, FOOT, "JakartaBold", 8, TEAL_INK)
        self.link(self.content["channelUrl"], x, FOOT - 2, width, 10)
        self.text(f"{number} / {total}", W - MARGIN, FOOT, "Jakarta", 8, NAVY_SOFT, "right")

    # -- line art (centred on cx, cy; s is the figure's main radius)
    def bubble(self, cx: float, cy: float, r: float, width: float = 2.0) -> None:
        c = self.c
        self.style(width)
        c.circle(cx, cy, r, stroke=1, fill=1)
        if r > 6:
            c.arc(cx - r * 0.74, cy - r * 0.74, cx + r * 0.74, cy + r * 0.74, 112, 42)

    def tube(self, build, outer: float, line: float = LINE) -> None:
        """Strokes a path twice (dark, then white) so it reads as an outlined, colourable tube."""
        c = self.c
        for colour, width in ((NAVY, outer), (white, outer - 2 * line)):
            self.style(width, colour)
            path = c.beginPath()
            build(path)
            c.drawPath(path, stroke=1, fill=0)

    def turtle(self, cx: float, cy: float, s: float, lw: float = LINE) -> None:
        c = self.c
        c.saveState()
        c.translate(cx, cy)
        self.style(lw)
        for side in (-1, 1):
            for (px, py, a, b, angle) in ((0.86, 0.42, 0.5, 0.22, 32), (0.7, -0.62, 0.34, 0.17, -38)):
                c.saveState()
                c.translate(side * px * s, py * s)
                c.rotate(angle if side > 0 else 180 - angle)
                c.ellipse(-a * s, -b * s, a * s, b * s, stroke=1, fill=1)
                c.restoreState()
        tail = c.beginPath()
        tail.moveTo(-0.13 * s, -0.84 * s)
        tail.lineTo(0, -1.1 * s)
        tail.lineTo(0.13 * s, -0.84 * s)
        tail.close()
        c.drawPath(tail, stroke=1, fill=1)
        c.circle(0, 1.08 * s, 0.34 * s, stroke=1, fill=1)
        c.ellipse(-s, -0.9 * s, s, 0.9 * s, stroke=1, fill=1)
        c.ellipse(-0.84 * s, -0.75 * s, 0.84 * s, 0.75 * s, stroke=1, fill=0)
        hexagon = [(0.34 * s * math.cos(math.radians(90 + 60 * k)), 0.31 * s * math.sin(math.radians(90 + 60 * k))) for k in range(6)]
        path = c.beginPath()
        path.moveTo(*hexagon[0])
        for point in hexagon[1:]:
            path.lineTo(*point)
        path.close()
        c.drawPath(path, stroke=1, fill=0)
        for k, (hx, hy) in enumerate(hexagon):
            angle = math.radians(90 + 60 * k)
            c.line(hx, hy, 0.84 * s * math.cos(angle), 0.75 * s * math.sin(angle))
        c.setFillColor(NAVY)
        for side in (-1, 1):
            c.circle(side * 0.12 * s, 1.14 * s, 0.045 * s, stroke=0, fill=1)
        c.arc(-0.13 * s, 0.9 * s, 0.13 * s, 1.1 * s, 205, 130)
        c.restoreState()

    def fish(self, cx: float, cy: float, s: float, lw: float = LINE, stripes: bool = True) -> None:
        c = self.c
        c.saveState()
        c.translate(cx, cy)
        self.style(lw)
        tail = c.beginPath()
        tail.moveTo(-0.8 * s, 0)
        tail.curveTo(-1.05 * s, 0.25 * s, -1.3 * s, 0.5 * s, -1.4 * s, 0.42 * s)
        tail.curveTo(-1.28 * s, 0.2 * s, -1.28 * s, -0.2 * s, -1.4 * s, -0.42 * s)
        tail.curveTo(-1.3 * s, -0.5 * s, -1.05 * s, -0.25 * s, -0.8 * s, 0)
        tail.close()
        c.drawPath(tail, stroke=1, fill=1)
        fin = c.beginPath()
        fin.moveTo(-0.55 * s, 0.4 * s)
        fin.curveTo(-0.35 * s, 0.86 * s, 0.15 * s, 0.86 * s, 0.45 * s, 0.4 * s)
        fin.close()
        c.drawPath(fin, stroke=1, fill=1)
        low = c.beginPath()
        low.moveTo(-0.45 * s, -0.4 * s)
        low.curveTo(-0.3 * s, -0.72 * s, 0.0, -0.72 * s, 0.1 * s, -0.5 * s)
        low.close()
        c.drawPath(low, stroke=1, fill=1)
        c.ellipse(-s, -0.58 * s, s, 0.58 * s, stroke=1, fill=1)
        if stripes:
            c.saveState()
            clip = c.beginPath()
            clip.ellipse(-s, -0.58 * s, 2 * s, 1.16 * s)
            c.clipPath(clip, stroke=0, fill=0)
            for x0 in (0.4, -0.1, -0.6):
                for edge in (-0.09, 0.09):
                    xe = (x0 + edge) * s
                    path = c.beginPath()
                    path.moveTo(xe, 0.7 * s)
                    path.curveTo(xe + 0.1 * s, 0.25 * s, xe + 0.1 * s, -0.25 * s, xe, -0.7 * s)
                    c.drawPath(path, stroke=1, fill=0)
            c.restoreState()
            self.style(lw)
            c.ellipse(-s, -0.58 * s, s, 0.58 * s, stroke=1, fill=0)
        c.saveState()
        c.translate(0.1 * s, -0.14 * s)
        c.rotate(-25)
        c.ellipse(-0.2 * s, -0.08 * s, 0.2 * s, 0.08 * s, stroke=1, fill=1)
        c.restoreState()
        c.circle(0.6 * s, 0.14 * s, 0.13 * s, stroke=1, fill=1)
        c.setFillColor(NAVY)
        c.circle(0.63 * s, 0.13 * s, 0.065 * s, stroke=0, fill=1)
        c.arc(0.68 * s, -0.24 * s, 0.92 * s, -0.04 * s, 215, 100)
        c.restoreState()

    def octopus(self, cx: float, cy: float, s: float, lw: float = LINE) -> None:
        c = self.c
        c.saveState()
        c.translate(cx, cy)
        base = -0.3 * s
        for i in range(8):
            bx = (-0.7 + i * 0.2) * s
            d = (i - 3.5) / 3.5
            sign = 1 if d >= 0 else -1
            ex, ey = bx + d * 1.05 * s, base - 1.45 * s

            def build(path, bx=bx, d=d, ex=ex, ey=ey, sign=sign):
                path.moveTo(bx, base)
                path.curveTo(bx + d * 0.2 * s + 0.16 * s * sign, base - 0.55 * s, bx + d * 0.7 * s - 0.2 * s * sign, base - 1.05 * s, ex, ey)
                path.curveTo(ex + sign * 0.2 * s, ey - 0.2 * s, ex + sign * 0.42 * s, ey + 0.02 * s, ex + sign * 0.28 * s, ey + 0.14 * s)

            self.tube(build, 0.27 * s, lw)
        self.style(lw)
        c.ellipse(-0.95 * s, -0.75 * s, 0.95 * s, 1.25 * s, stroke=1, fill=1)
        for side in (-1, 1):
            c.ellipse(side * 0.33 * s - 0.17 * s, 0.1 * s, side * 0.33 * s + 0.17 * s, 0.52 * s, stroke=1, fill=1)
            c.setFillColor(NAVY)
            c.circle(side * 0.3 * s, 0.26 * s, 0.09 * s, stroke=0, fill=1)
            c.setFillColor(white)
            c.circle(side * 0.27 * s, 0.31 * s, 0.03 * s, stroke=0, fill=1)
            self.style(lw * 0.8)
            c.circle(side * 0.62 * s, -0.05 * s, 0.09 * s, stroke=1, fill=0)
        self.style(lw)
        c.arc(-0.2 * s, -0.24 * s, 0.2 * s, 0.08 * s, 205, 130)
        for (sx, sy, r) in ((-0.42, 0.88, 0.08), (0.08, 1.05, 0.06), (0.48, 0.82, 0.07)):
            c.circle(sx * s, sy * s, r * s, stroke=1, fill=0)
        c.restoreState()

    def starfish(self, cx: float, cy: float, r: float, lw: float = LINE, inner: float = 0.45) -> None:
        c = self.c
        self.style(lw)
        path = c.beginPath()
        for k in range(10):
            radius = r if k % 2 == 0 else r * inner
            angle = math.radians(90 + 36 * k)
            point = (cx + radius * math.cos(angle), cy + radius * math.sin(angle))
            path.moveTo(*point) if k == 0 else path.lineTo(*point)
        path.close()
        c.drawPath(path, stroke=1, fill=1)

    def starfish_dots(self, cx: float, cy: float, r: float) -> None:
        c = self.c
        self.style(1.4)
        for k in range(5):
            angle = math.radians(90 + 72 * k)
            for f in (0.35, 0.6):
                c.circle(cx + r * f * math.cos(angle), cy + r * f * math.sin(angle), r * 0.06, stroke=1, fill=0)

    def shell(self, cx: float, cy: float, s: float, lw: float = LINE) -> None:
        c = self.c
        c.saveState()
        c.translate(cx, cy)
        self.style(lw)
        hinge = c.beginPath()
        hinge.moveTo(-0.24 * s, -0.55 * s)
        hinge.lineTo(-0.34 * s, -0.8 * s)
        hinge.lineTo(0.34 * s, -0.8 * s)
        hinge.lineTo(0.24 * s, -0.55 * s)
        hinge.close()
        c.drawPath(hinge, stroke=1, fill=1)
        tops = [(-0.82 + 0.328 * k) * s for k in range(6)]
        fan = c.beginPath()
        fan.moveTo(0, -0.62 * s)
        fan.curveTo(-0.7 * s, -0.4 * s, -0.95 * s, 0.1 * s, tops[0], 0.42 * s)
        for a, b in zip(tops, tops[1:]):
            fan.curveTo(a + 0.02 * s, 0.72 * s, b - 0.02 * s, 0.72 * s, b, 0.42 * s)
        fan.curveTo(0.95 * s, 0.1 * s, 0.7 * s, -0.4 * s, 0, -0.62 * s)
        fan.close()
        c.drawPath(fan, stroke=1, fill=1)
        for x in tops[1:-1]:
            c.line(0, -0.58 * s, x, 0.42 * s)
        c.restoreState()

    def seaweed(self, x: float, base: float, height: float, sway: float = 1.0, width: float = 15) -> None:
        def build(path):
            path.moveTo(x, base)
            path.curveTo(x + 18 * sway, base + height * 0.3, x - 18 * sway, base + height * 0.6, x + 6 * sway, base + height)

        self.tube(build, width)

    def star(self, cx: float, cy: float, r: float, lw: float = 2.0) -> None:
        self.starfish(cx, cy, r, lw, inner=0.48)

    def seabed(self, y: float) -> None:
        c = self.c
        self.style(LINE)
        path = c.beginPath()
        path.moveTo(MARGIN - 4, y)
        path.curveTo(W * 0.3, y + 26, W * 0.55, y - 18, W - MARGIN + 4, y + 12)
        c.drawPath(path, stroke=1, fill=0)
        self.style(1.2)
        for k in range(26):
            px = MARGIN + 10 + (k * 37) % int(W - 2 * MARGIN - 20)
            py = y - 18 - (k * 13) % 40
            c.circle(px, py, 1.4, stroke=1, fill=0)

    # -- fruit and bedtime icons
    def strawberry(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style()
        body = c.beginPath()
        body.moveTo(0 + cx, -0.95 * s + cy)
        body.curveTo(-0.95 * s + cx, -0.2 * s + cy, -0.85 * s + cx, 0.55 * s + cy, cx - 0.3 * s, 0.6 * s + cy)
        body.curveTo(cx - 0.1 * s, 0.66 * s + cy, cx + 0.1 * s, 0.66 * s + cy, cx + 0.3 * s, 0.6 * s + cy)
        body.curveTo(0.85 * s + cx, 0.55 * s + cy, 0.95 * s + cx, -0.2 * s + cy, cx, -0.95 * s + cy)
        body.close()
        c.drawPath(body, stroke=1, fill=1)
        for (sx, sy) in ((-0.35, 0.25), (0.05, 0.3), (0.4, 0.2), (-0.2, -0.15), (0.2, -0.1), (0, -0.5), (-0.5, -0.05), (0.5, -0.12)):
            c.ellipse(cx + sx * s - 0.035 * s, cy + sy * s - 0.06 * s, cx + sx * s + 0.035 * s, cy + sy * s + 0.06 * s, stroke=1, fill=0)
        for angle in (-50, -15, 15, 50):
            c.saveState()
            c.translate(cx, cy + 0.66 * s)
            c.rotate(90 + angle)
            c.ellipse(0, -0.09 * s, 0.4 * s, 0.09 * s, stroke=1, fill=1)
            c.restoreState()
        c.line(cx, cy + 0.66 * s, cx + 0.05 * s, cy + 0.95 * s)

    def banana(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style()
        path = c.beginPath()
        path.moveTo(cx - 0.9 * s, cy + 0.55 * s)
        path.curveTo(cx - 1.0 * s, cy - 0.55 * s, cx + 0.35 * s, cy - 0.95 * s, cx + 0.92 * s, cy - 0.05 * s)
        path.lineTo(cx + 0.98 * s, cy + 0.2 * s)
        path.curveTo(cx + 0.45 * s, cy - 0.38 * s, cx - 0.45 * s, cy - 0.3 * s, cx - 0.62 * s, cy + 0.62 * s)
        path.close()
        c.drawPath(path, stroke=1, fill=1)
        stem = c.beginPath()
        stem.moveTo(cx + 0.92 * s, cy + 0.12 * s)
        stem.lineTo(cx + 1.08 * s, cy + 0.42 * s)
        stem.lineTo(cx + 1.18 * s, cy + 0.36 * s)
        stem.lineTo(cx + 0.99 * s, cy + 0.06 * s)
        c.drawPath(stem, stroke=1, fill=1)
        c.setFillColor(NAVY)
        c.circle(cx - 0.78 * s, cy + 0.6 * s, 0.07 * s, stroke=0, fill=1)
        c.arc(cx - 0.85 * s, cy - 0.55 * s, cx + 0.6 * s, cy + 0.45 * s, 200, 95)

    def grapes(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style()
        c.line(cx, cy + 0.55 * s, cx + 0.1 * s, cy + 0.95 * s)
        c.saveState()
        c.translate(cx + 0.1 * s, cy + 0.8 * s)
        c.rotate(20)
        c.ellipse(0, -0.12 * s, 0.5 * s, 0.12 * s, stroke=1, fill=1)
        c.restoreState()
        r = 0.2 * s
        for row, count in enumerate((4, 3, 2, 1)):
            for k in range(count):
                x = cx + (k - (count - 1) / 2) * 2 * r * 0.95
                y = cy + 0.4 * s - row * 2 * r * 0.85
                c.circle(x, y, r, stroke=1, fill=1)

    def orange(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style()
        c.circle(cx, cy, 0.75 * s, stroke=1, fill=1)
        c.line(cx, cy + 0.75 * s, cx + 0.05 * s, cy + 0.95 * s)
        c.saveState()
        c.translate(cx + 0.05 * s, cy + 0.88 * s)
        c.rotate(25)
        c.ellipse(0, -0.1 * s, 0.45 * s, 0.1 * s, stroke=1, fill=1)
        c.restoreState()
        self.style(1.3)
        for (dx, dy) in ((-0.3, 0.2), (0.25, 0.3), (0.35, -0.25), (-0.2, -0.35), (0.0, 0.0)):
            c.circle(cx + dx * s, cy + dy * s, 0.03 * s, stroke=1, fill=0)

    def pear(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style()
        path = c.beginPath()
        path.moveTo(cx, cy + 0.72 * s)
        path.curveTo(cx - 0.32 * s, cy + 0.72 * s, cx - 0.3 * s, cy + 0.25 * s, cx - 0.5 * s, cy - 0.1 * s)
        path.curveTo(cx - 0.85 * s, cy - 0.7 * s, cx - 0.35 * s, cy - 0.98 * s, cx, cy - 0.95 * s)
        path.curveTo(cx + 0.35 * s, cy - 0.98 * s, cx + 0.85 * s, cy - 0.7 * s, cx + 0.5 * s, cy - 0.1 * s)
        path.curveTo(cx + 0.3 * s, cy + 0.25 * s, cx + 0.32 * s, cy + 0.72 * s, cx, cy + 0.72 * s)
        path.close()
        c.drawPath(path, stroke=1, fill=1)
        c.line(cx, cy + 0.72 * s, cx + 0.08 * s, cy + 0.98 * s)
        c.saveState()
        c.translate(cx + 0.06 * s, cy + 0.88 * s)
        c.rotate(-20)
        c.ellipse(0, -0.1 * s, 0.42 * s, 0.1 * s, stroke=1, fill=1)
        c.restoreState()

    def icon_bath(self, cx: float, cy: float, s: float) -> None:
        for (dx, dy, r) in ((-0.4, -0.1, 0.38), (0.25, 0.15, 0.48), (0.2, -0.55, 0.22), (-0.55, 0.55, 0.18)):
            self.bubble(cx + dx * s, cy + dy * s, r * s, 2.0)

    def icon_pyjamas(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style(2.2)
        p = c.beginPath()
        points = [(-0.3, 0.75), (-0.85, 0.45), (-0.65, 0.05), (-0.45, 0.15), (-0.45, -0.8), (0.45, -0.8), (0.45, 0.15), (0.65, 0.05), (0.85, 0.45), (0.3, 0.75)]
        p.moveTo(cx + points[0][0] * s, cy + points[0][1] * s)
        for (px, py) in points[1:]:
            p.lineTo(cx + px * s, cy + py * s)
        p.curveTo(cx + 0.2 * s, cy + 0.5 * s, cx - 0.2 * s, cy + 0.5 * s, cx - 0.3 * s, cy + 0.75 * s)
        c.drawPath(p, stroke=1, fill=1)
        self.star(cx, cy - 0.2 * s, 0.22 * s, 1.6)

    def icon_toothbrush(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        c.saveState()
        c.translate(cx, cy)
        c.rotate(35)
        self.style(2.2)
        c.roundRect(-0.9 * s, -0.12 * s, 1.3 * s, 0.24 * s, 0.12 * s, stroke=1, fill=1)
        c.roundRect(0.4 * s, -0.12 * s, 0.5 * s, 0.24 * s, 0.06 * s, stroke=1, fill=1)
        for k in range(5):
            x = 0.45 * s + k * 0.1 * s
            c.line(x, 0.12 * s, x, 0.38 * s)
        c.restoreState()

    def icon_book(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style(2.2)
        for side in (-1, 1):
            p = c.beginPath()
            p.moveTo(cx, cy - 0.5 * s)
            p.curveTo(cx + side * 0.3 * s, cy - 0.38 * s, cx + side * 0.6 * s, cy - 0.42 * s, cx + side * 0.9 * s, cy - 0.5 * s)
            p.lineTo(cx + side * 0.9 * s, cy + 0.55 * s)
            p.curveTo(cx + side * 0.6 * s, cy + 0.62 * s, cx + side * 0.3 * s, cy + 0.6 * s, cx, cy + 0.5 * s)
            p.close()
            c.drawPath(p, stroke=1, fill=1)
            for k in range(3):
                y = cy + 0.25 * s - k * 0.22 * s
                c.line(cx + side * 0.18 * s, y, cx + side * 0.7 * s, y)

    def icon_moon(self, cx: float, cy: float, s: float) -> None:
        c = self.c
        self.style(2.2)
        p = c.beginPath()
        p.moveTo(cx + 0.2 * s, cy + 0.8 * s)
        p.curveTo(cx - 0.75 * s, cy + 0.7 * s, cx - 0.75 * s, cy - 0.7 * s, cx + 0.2 * s, cy - 0.8 * s)
        p.curveTo(cx - 0.25 * s, cy - 0.45 * s, cx - 0.25 * s, cy + 0.45 * s, cx + 0.2 * s, cy + 0.8 * s)
        p.close()
        c.drawPath(p, stroke=1, fill=1)
        self.star(cx + 0.55 * s, cy + 0.45 * s, 0.24 * s, 1.6)
        self.star(cx + 0.6 * s, cy - 0.3 * s, 0.15 * s, 1.4)

    def youtube_mark(self, x: float, y: float, w: float, fill=RED) -> None:
        c = self.c
        h = w * 0.7
        c.setFillColor(fill)
        c.roundRect(x, y, w, h, h * 0.28, stroke=0, fill=1)
        c.setFillColor(white)
        p = c.beginPath()
        p.moveTo(x + w * 0.4, y + h * 0.28)
        p.lineTo(x + w * 0.4, y + h * 0.72)
        p.lineTo(x + w * 0.68, y + h * 0.5)
        p.close()
        c.drawPath(p, stroke=0, fill=1)


# ---------------------------------------------------------------------------------------------
# Pages


def page_cover(pack: Pack) -> None:
    c = pack.c
    pack.pages.append("Cover")
    c.setFillColor(CREAM)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    art_bottom = H * 0.55
    pack.image("hero-trio", 0, art_bottom - 30, W, H - art_bottom + 30, focus=(0.5, 0.36), dpi=190)
    c.setFillColor(CREAM)
    wave = c.beginPath()
    wave.moveTo(0, art_bottom + 22)
    wave.curveTo(W * 0.28, art_bottom + 46, W * 0.6, art_bottom - 4, W, art_bottom + 26)
    wave.lineTo(W, 0)
    wave.lineTo(0, 0)
    wave.close()
    c.drawPath(wave, stroke=0, fill=1)
    logo = svg2rlg(str(ROOT / "public" / "bibo-logo.svg"))
    scale = 200 / logo.width
    logo.width, logo.height = logo.width * scale, logo.height * scale
    logo.scale(scale, scale)
    renderPDF.draw(logo, c, (W - logo.width) / 2, art_bottom - logo.height + 26)
    title_y = art_bottom - logo.height - 40
    pack.text("Activity Pack", W / 2, title_y, "Fredoka", 54, NAVY, "center")
    pack.para("Colour, count, match and breathe with Tula, Bob and Lumi. For little learners ages 2–6 and the grown-ups who play along.", (W - 400) / 2, title_y - 24, 400, 13.5, color=NAVY_SOFT, align=1)
    chips = ["8 printable pages", "Ages 2–6", "Print at home"]
    widths = [pdfmetrics.stringWidth(chip, "JakartaBold", 10) + 26 for chip in chips]
    x = (W - sum(widths) - 10 * (len(chips) - 1)) / 2
    chip_y = title_y - 110
    for chip, width in zip(chips, widths):
        pack.style(1.4, NAVY, white)
        c.roundRect(x, chip_y, width, 22, 11, stroke=1, fill=1)
        pack.text(chip, x + width / 2, chip_y + 7, "JakartaBold", 10, NAVY, "center")
        x += width + 10
    band_h = 96
    band_y = 20 * mm
    c.setFillColor(NAVY)
    c.roundRect(MARGIN, band_y, W - 2 * MARGIN, band_h, 22, stroke=0, fill=1)
    pack.youtube_mark(MARGIN + 24, band_y + band_h - 42, 30)
    pack.text("Watch Bibo Bay free on YouTube", MARGIN + 64, band_y + band_h - 36, "Fredoka", 18, YELLOW)
    pack.para("Songs, stories and calm moments under the sea. Scan the code to subscribe and never miss a new adventure.", MARGIN + 24, band_y + band_h - 50, W - 2 * MARGIN - 150, 10.5, color=white)
    qr_size = 76
    pack.qr(pack.content["subscribeUrl"], W - MARGIN - qr_size - 12, band_y + (band_h - qr_size) / 2, qr_size)
    c.showPage()


def page_friends(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    top = pack.header("HELLO", "Meet the friends of Bibo Bay", TEAL)
    portraits = {"tula": ("friend-tula", (0.5, 0.45)), "bob": ("friend-bob", (0.5, 0.5)), "lumi": ("friend-lumi", (0.5, 0.45))}
    accents = {"tula": KELP, "bob": ORANGE, "lumi": PURPLE}
    y = top - 14
    for friend in pack.content["characters"]:
        art, focus = portraits[friend["id"]]
        h = 100
        pack.image(art, MARGIN, y - h, 150, h, radius=16, focus=focus)
        pack.style(1.4, accents[friend["id"]], white)
        c.setFillColor(white)
        c.roundRect(MARGIN, y - h, 150, h, 16, stroke=1, fill=0)
        tx = MARGIN + 166
        pack.text(friend["name"], tx, y - 20, "Fredoka", 20)
        pack.text(f"{friend['species']}  ·  {friend['role']}", tx, y - 38, "JakartaBold", 10, accents[friend["id"]] if friend["id"] != "tula" else TEAL_INK)
        pack.para(friend["description"], tx, y - 46, W - MARGIN - tx, 10.5, color=NAVY_SOFT)
        y -= h + 16
    box_h = y - 6 - 24 * mm
    c.setFillColor(SAND)
    c.roundRect(MARGIN, 24 * mm, W - 2 * MARGIN, box_h, 18, stroke=0, fill=1)
    bx, by = MARGIN + 22, 24 * mm + box_h - 30
    pack.text("For grown-ups", bx, by, "Fredoka", 16)
    by -= 10
    by -= pack.para("“Screen time is part of childhood. Let’s make it count.” That is how the Bibo Bay channel puts it, and this pack is one way to carry a song from the screen into play.", bx, by, W - 2 * MARGIN - 44, 10.5, color=NAVY_SOFT)
    steps = [
        ("Watch together.", "Each activity page has a code that opens its video on YouTube."),
        ("Play the page.", "Print it, sit side by side and help where little hands need it."),
        ("Talk about it.", "What did Tula, Bob or Lumi discover? What would your little one try?"),
    ]
    by -= 8
    for k, (lead, rest) in enumerate(steps, start=1):
        c.setFillColor(TEAL)
        c.circle(bx + 9, by - 9, 9, stroke=0, fill=1)
        pack.text(str(k), bx + 9, by - 12.5, "Fredoka", 10.5, white, "center")
        height = pack.para(f"{lead} {rest}", bx + 26, by - 2, W - 2 * MARGIN - 70, 10.5)
        by -= max(height, 18) + 6
    by -= 12
    pack.text("Inside this pack", bx, by - 12, "Fredoka", 13)
    inside = ["Colour the sea friends", "Count with Bob", "Bubble breathing", "Fruit match with Tula", "Bedtime in the Bay", "Watch together on YouTube"]
    col_w = (W - 2 * MARGIN - 44) / 2
    for k, title in enumerate(inside):
        ix = bx + (k // 3) * col_w
        iy = by - 34 - (k % 3) * 17
        pack.text(f"{k + 3}", ix, iy, "Fredoka", 10.5, TEAL_INK)
        pack.text(title, ix + 18, iy, "Jakarta", 10.5)
    pack.footer(number, total)
    c.showPage()


def page_colour(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    video = pack.videos["friends-in-the-bay"]
    pack.header("COLOUR", "Colour the sea friends", TEAL, "A turtle like Tula, a clownfish like Bob and an octopus like Lumi. Which colours will you choose?", 290)
    pack.qr_card(video["mediaUrl"], video["title"], W - MARGIN - 170, TOP - 82, 170, TEAL)
    pack.seabed(36 * mm + 40)
    for (x, height, sway) in ((MARGIN + 20, 180, 1), (MARGIN + 48, 130, -1), (W - MARGIN - 22, 190, -1)):
        pack.seaweed(x, 36 * mm + 40, height, sway)
    pack.turtle(200, 455, 100)
    pack.fish(410, 590, 80)
    pack.octopus(390, 330, 58)
    pack.starfish(120, 150, 30)
    pack.starfish_dots(120, 150, 30)
    pack.shell(270, 140, 32)
    for (x, y, r) in ((300, 640, 10), (318, 664, 6), (290, 610, 7), (95, 640, 9), (112, 664, 5), (520, 470, 8), (505, 494, 5), (500, 420, 11), (262, 300, 7), (252, 326, 11)):
        pack.bubble(x, y, r)
    pack.footer(number, total)
    c.showPage()


def page_count(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    video = pack.videos["count-to-ten"]
    top = pack.header("COUNT", "Count with Bob", ORANGE, "Count the friends in each box, then circle the right number.", 290)
    pack.qr_card(video["mediaUrl"], video["title"], W - MARGIN - 170, TOP - 82, 170, ORANGE)
    boxes = [
        ("fish", 3, (2, 3, 4)), ("bubble", 5, (5, 3, 6)),
        ("starfish", 2, (1, 2, 3)), ("shell", 4, (4, 6, 5)),
        ("turtle", 1, (3, 1, 2)), ("star", 6, (6, 4, 5)),
    ]
    gap = 14
    bw = (W - 2 * MARGIN - gap) / 2
    bh = 146
    y0 = top - 22
    for k, (kind, count, choices) in enumerate(boxes):
        col, row = k % 2, k // 2
        x = MARGIN + col * (bw + gap)
        y = y0 - (row + 1) * bh - row * gap
        pack.style(1.6, ORANGE, white)
        c.roundRect(x, y, bw, bh, 16, stroke=1, fill=1)
        per_row = 3
        spacing = bw / (min(count, per_row) + 1)
        rows = math.ceil(count / per_row)
        for i in range(count):
            r_i, c_i = divmod(i, per_row)
            in_row = min(per_row, count - r_i * per_row)
            cx = x + bw / 2 + (c_i - (in_row - 1) / 2) * min(spacing, 66)
            cy = y + bh - 46 - r_i * 44 if rows > 1 else y + bh - 62
            {"fish": lambda: pack.fish(cx + 6, cy, 22, 2.0, stripes=True),
             "bubble": lambda: pack.bubble(cx, cy, 15, 2.0),
             "starfish": lambda: (pack.starfish(cx, cy, 24, 2.0, inner=0.5), pack.starfish_dots(cx, cy, 24)),
             "shell": lambda: pack.shell(cx, cy, 19, 2.0),
             "turtle": lambda: pack.turtle(cx, cy - 6, 24, 2.0),
             "star": lambda: pack.star(cx, cy, 15, 2.0)}[kind]()
        for j, choice in enumerate(choices):
            nx = x + bw / 2 + (j - 1) * 46
            pack.style(1.6, NAVY, white)
            c.circle(nx, y + 22, 15, stroke=1, fill=1)
            pack.text(str(choice), nx, y + 16, "Fredoka", 16, NAVY, "center")
    trace_y = 30 * mm + 12
    pack.text("Trace the numbers", MARGIN, trace_y + 52, "Fredoka", 15)
    step = (W - 2 * MARGIN) / 10
    c.saveState()  # the outline text mode and dash must not leak into the footer
    c.setStrokeColor(NAVY_SOFT)
    c.setLineWidth(1.1)
    c.setDash(1.4, 2.2)
    for n in range(1, 11):
        value = str(n)
        width = pdfmetrics.stringWidth(value, "Fredoka", 38)
        t = c.beginText()
        t.setTextRenderMode(1)
        t.setFont("Fredoka", 38)
        t.setTextOrigin(MARGIN + step * (n - 0.5) - width / 2, trace_y)
        t.textOut(value)
        c.drawText(t)
    c.restoreState()
    pack.footer(number, total)
    c.showPage()


def page_breathe(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    video = pack.videos["bubble-breathing"]
    top = pack.header("BREATHE", "Bubble breathing", OCEAN_DEEP, "When feelings feel big, breathe like Tula and Bob in the Bubble Breathing Song.", 290)
    pack.qr_card(video["mediaUrl"], video["title"], W - MARGIN - 170, TOP - 82, 170, OCEAN_DEEP)
    cx, cy, r = MARGIN + 118, top - 168, 104
    pack.bubble(cx, cy, r, 3.0)
    for (dx, dy, rr) in ((104, 92, 18), (126, 126, 11), (112, 150, 7), (-104, -96, 10), (-84, -122, 6), (96, -108, 13)):
        pack.bubble(cx + dx, cy + dy, rr)
    pack.text("Breathe out", cx, cy + 8, "Fredoka", 18, NAVY, "center")
    pack.text("a slow bubble", cx, cy - 14, "Fredoka", 18, NAVY, "center")
    steps = [
        "Sit still and comfy, like a calm turtle.",
        "Breathe in slowly through your nose: 1, 2, 3.",
        "Breathe out slowly, like blowing a big bubble.",
        "Do it three times. How do you feel now?",
    ]
    sx, sy = MARGIN + 262, top - 54
    for k, step in enumerate(steps, start=1):
        c.setFillColor(OCEAN_DEEP)
        c.circle(sx + 13, sy - 10, 13, stroke=0, fill=1)
        pack.text(str(k), sx + 13, sy - 15.5, "Fredoka", 14, white, "center")
        height = pack.para(step, sx + 36, sy - 2, W - MARGIN - sx - 36, 12, "JakartaBold", NAVY, 15)
        sy -= max(height, 26) + 16
    card_w, card_h = (W - 2 * MARGIN - 20) / 2, 176
    card_y = 34 * mm
    pack.text("Grown-ups: cut out a card to keep on the fridge or in a pocket. Please help with the scissors.", MARGIN, card_y + card_h + 16, "Jakarta", 9.5, NAVY_SOFT)
    for k, (line_one, line_two) in enumerate((("Breathe in", "1, 2, 3"), ("Breathe out", "a slow bubble"))):
        x = MARGIN + k * (card_w + 20)
        pack.style(1.4, NAVY_SOFT, white)
        c.setDash(5, 4)
        c.roundRect(x, card_y, card_w, card_h, 14, stroke=1, fill=0)
        c.setDash()
        pack.text(line_one, x + card_w / 2, card_y + card_h - 44, "Fredoka", 22, NAVY, "center")
        pack.text(line_two, x + card_w / 2, card_y + card_h - 70, "Fredoka", 18, OCEAN_DEEP, "center")
        for (dx, dy, rr) in ((-40, 36, 14), (-12, 30, 9), (16, 40, 17), (46, 30, 8)):
            pack.bubble(x + card_w / 2 + dx, card_y + dy, rr, 1.8)
        pack.text("Bibo Bay", x + card_w - 14, card_y + 10, "Fredoka", 8.5, NAVY_SOFT, "right")
    pack.footer(number, total)
    c.showPage()


def page_fruit(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    video = pack.videos["tula-fruit-adventure"]
    top = pack.header("MATCH", "Fruit match with Tula", KELP, "Draw a line from each fruit to its colour. Then colour the fruit in!", 290)
    pack.qr_card(video["mediaUrl"], video["title"], W - MARGIN - 170, TOP - 82, 170, TEAL_INK)
    fruits = [("strawberry", pack.strawberry), ("banana", pack.banana), ("grapes", pack.grapes), ("orange", pack.orange), ("pear", pack.pear)]
    colours = [("yellow", YELLOW), ("green", KELP), ("red", RED), ("orange", ORANGE), ("purple", PURPLE)]
    row_h = (top - 36 * mm - 30) / len(fruits)
    for k, (_, draw) in enumerate(fruits):
        y = top - 30 - row_h * (k + 0.5)
        draw(MARGIN + 90, y, 46)
        c.setFillColor(NAVY)
        c.circle(MARGIN + 170, y, 5, stroke=0, fill=1)
        name, colour = colours[k]
        bx = W - MARGIN - 150
        c.setFillColor(NAVY)
        c.circle(bx - 40, y, 5, stroke=0, fill=1)
        pack.style(2.0, NAVY, colour)
        c.circle(bx, y, 24, stroke=1, fill=1)
        pack.text(name, bx + 36, y - 6, "Fredoka", 18)
    pack.footer(number, total)
    c.showPage()


def page_bedtime(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    lullaby, twinkle = pack.videos["bedtime-lullaby"], pack.videos["twinkle-under-the-sea"]
    top = pack.header("BEDTIME", "Bedtime in the Bay", PURPLE, "Colour a star each night you finish a step. Sweet dreams, little one!", 290)
    pack.icon_moon(W - MARGIN - 60, TOP - 40, 34)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    rows = [("Bath time", pack.icon_bath), ("Pyjamas on", pack.icon_pyjamas), ("Brush teeth", pack.icon_toothbrush), ("Story time", pack.icon_book), ("Sleep song", pack.icon_moon)]
    label_w = 132
    col_w = (W - 2 * MARGIN - label_w) / 7
    head_h, row_h = 30, 72
    y_top = top - 18
    pack.style(1.4, PURPLE, white)
    c.roundRect(MARGIN, y_top - head_h - row_h * len(rows), W - 2 * MARGIN, head_h + row_h * len(rows), 14, stroke=1, fill=0)
    for k, day in enumerate(days):
        pack.text(day, MARGIN + label_w + col_w * (k + 0.5), y_top - 20, "Fredoka", 12, PURPLE, "center")
    for i, (label, icon) in enumerate(rows):
        y = y_top - head_h - row_h * (i + 1)
        pack.style(1.0, PURPLE)
        c.line(MARGIN, y + row_h, W - MARGIN, y + row_h)
        icon(MARGIN + 30, y + row_h / 2, 20)
        pack.text(label, MARGIN + 60, y + row_h / 2 - 5, "Fredoka", 13)
        for k in range(7):
            pack.star(MARGIN + label_w + col_w * (k + 0.5), y + row_h / 2, 15, 1.8)
    pack.style(1.0, PURPLE)
    for k in range(7):
        x = MARGIN + label_w + col_w * k
        c.line(x, y_top, x, y_top - head_h - row_h * len(rows))
    card_y = 30 * mm
    pack.text("Songs for winding down", MARGIN, card_y + 96, "Fredoka", 15)
    pack.qr_card(lullaby["mediaUrl"], lullaby["title"], MARGIN, card_y, 240, PURPLE)
    pack.qr_card(twinkle["mediaUrl"], twinkle["title"], W - MARGIN - 240, card_y, 240, PURPLE)
    pack.footer(number, total)
    c.showPage()


def page_watch(pack: Pack, number: int, total: int) -> None:
    c = pack.c
    top = pack.header("WATCH TOGETHER", "Watch together on YouTube", RED, "Scan a code with your phone’s camera to open the video on YouTube. Every Bibo Bay video is free to watch.", 420)
    gap = 12
    cw = (W - 2 * MARGIN - gap) / 2
    ch = (top - 24 * mm - 16 - 3 * gap) / 4
    cells = [("video", episode) for episode in pack.content["episodes"]] + [("subscribe", None)]
    for k, (kind, episode) in enumerate(cells):
        col, row = k % 2, k // 2
        x = MARGIN + col * (cw + gap)
        y = top - 16 - (row + 1) * ch - row * gap
        if kind == "video":
            pack.style(1.3, NAVY_SOFT, white)
            c.roundRect(x, y, cw, ch, 14, stroke=1, fill=1)
            video_id = episode["mediaUrl"].rsplit("=", 1)[1]
            qs = min(ch - 26, 78)
            tw = cw - qs - 34
            th = min(tw * 9 / 16, ch - 44)
            tw = th * 16 / 9
            pack.image(f"video-{video_id}", x + 10, y + ch - 10 - th, tw, th, radius=9, dpi=150)
            pack.para(episode["title"], x + 10, y + ch - 16 - th, tw, 9.2, "JakartaBold", NAVY, 11)
            pack.link(episode["mediaUrl"], x + 10, y + ch - 10 - th, tw, th)
            pack.qr(episode["mediaUrl"], x + cw - qs - 10, y + (ch - qs) / 2 + 4, qs)
            pack.text("Scan to watch", x + cw - qs / 2 - 10, y + (ch - qs) / 2 - 6, "Jakarta", 7.5, NAVY_SOFT, "center")
        else:
            c.setFillColor(YELLOW)
            c.roundRect(x, y, cw, ch, 14, stroke=0, fill=1)
            qs = min(ch - 26, 78)
            pack.youtube_mark(x + 14, y + ch - 38, 30)
            pack.para("Subscribe on YouTube", x + 52, y + ch - 14, cw - qs - 72, 14.5, "Fredoka", NAVY, 16)
            pack.para("New adventures are coming soon. Subscribe to join us from the very beginning.", x + 14, y + ch - 56, cw - qs - 34, 9.2, color=NAVY)
            pack.qr(pack.content["subscribeUrl"], x + cw - qs - 10, y + (ch - qs) / 2 + 4, qs)
            pack.text("Scan to subscribe", x + cw - qs / 2 - 10, y + (ch - qs) / 2 - 6, "Jakarta", 7.5, NAVY, "center")
            pack.link(pack.content["subscribeUrl"], x, y, cw - qs - 20, ch)
    pack.footer(number, total)
    c.showPage()


# ---------------------------------------------------------------------------------------------
# Build


def write_previews(pdf_path: Path) -> list[dict]:
    document = fitz.open(pdf_path)
    chosen = [
        ("cover", 0, "Cover of the Bibo Bay activity pack: Tula, Bob and Lumi under the sea"),
        ("colour", 2, "Activity pack page: colour a turtle, a clownfish and an octopus"),
        ("count", 3, "Activity pack page: count with Bob and trace the numbers 1 to 10"),
    ]
    previews = []
    for name, index, alt in chosen:
        pixmap = document[index].get_pixmap(dpi=200)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        variants = []
        for width in PREVIEW_WIDTHS:
            height = round(width * H / W)
            resized = image.resize((width, height), Image.LANCZOS)
            target = PREVIEW_DIR / f"activity-pack-{name}-{width}.webp"
            resized.save(target, "WEBP", quality=80, method=6)
            variants.append({"src": f"/freebies/{target.name}", "width": width, "height": height})
        previews.append({"page": name, "alt": alt, "variants": variants})
    document.close()
    return previews


def main() -> None:
    load_fonts()
    content = load_content()
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = PDF_DIR / PDF_NAME
    pack = Pack(pdf_path, content)
    builders = [page_friends, page_colour, page_count, page_breathe, page_fruit, page_bedtime, page_watch]
    total = len(builders) + 1
    page_cover(pack)
    for number, build in enumerate(builders, start=2):
        build(pack, number, total)
    pack.c.save()
    data = pdf_path.read_bytes()
    manifest = {
        "file": f"/freebies/{PDF_NAME}",
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "pages": pack.pages,
        "links": sorted(set(pack.links)),
        "qr": pack.qr_codes,
        "videos": [{"id": e["id"], "title": e["title"], "url": e["mediaUrl"]} for e in content["episodes"]],
        "characters": [character["name"] for character in content["characters"]],
        "previews": write_previews(pdf_path),
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {pdf_path.relative_to(ROOT)}: {len(pack.pages)} pages, {len(data) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
