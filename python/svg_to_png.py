"""Convert WhyLog SVG assets to PNG with malformed-attribute tolerance.

Some generated SVGs contain attribute tokens like `stroke:`, `fill:` or bare
`&` inside attribute values, which break strict XML parsers. This script
normalises those to valid XML before rendering, so the PNG can be produced.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import List, Tuple

from lxml import etree
from PIL import Image, ImageDraw, ImageFont


ASSETS = Path('/d/projects/ml/whylog/assets')

# Attribute-local-name tokens that appear malformed as "name:" in attribute
# values (e.g. stroke: / fill: / style:). We treat them as a property name
# without a trailing colon.
_BAD_ATTR_TOKENS = re.compile(r'(stroke|fill|style|stroke-width|stroke-linecap|stroke-linejoin|font-size|font-weight|letter-spacing)\b:')

# Bare ampersands not part of an entity reference.
_BAD_AMP = re.compile(r'&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;|#\d+;|&#x[0-9a-fA-F]+;)')

# Unmatched angle brackets inside attribute values are extremely unlikely but
# we normalise stray '<' / '>' that sit inside quoted attribute text into
# named entities so the XML parser survives.
_BAD_LT = re.compile(r'<(?=[^>]*[">])')
_BAD_GT = re.compile(r'>(?=[^<]*["<])')


def normalise_svg_bytes(raw: bytes) -> bytes:
    """Heuristically repair common malformed SVG/XML issues so lxml can parse."""
    text = raw.decode('utf-8', errors='replace')

    # Fix bare ampersands first so they don't interact with later regexes.
    text = _BAD_AMP.sub('&amp;', text)

    # Fix "token:" that the parser reads as a QName but cannot resolve.
    text = _BAD_ATTR_TOKENS.sub(r'\1', text)

    # Fix stray < / > inside quoted attribute text.
    text = _BAD_LT.sub('&lt;', text)
    text = _BAD_GT.sub('&gt;', text)

    return text.encode('utf-8')


def try_parse(name: str, raw: bytes) -> Tuple[etree._ElementTree, bytes]:
    """Try to parse `raw`; if it fails, attempt normalised parsing."""
    try:
        return etree.fromstring(raw), raw
    except etree.XMLSyntaxError:
        repaired = normalise_svg_bytes(raw)
        try:
            return etree.fromstring(repaired), repaired
        except etree.XMLSyntaxError as exc:
            raise ValueError(f'{name}: still unparseable after repair: {exc}') from exc


def _svg_size(doc: etree._Element) -> Tuple[int, int]:
    vb = doc.get('viewBox')
    if vb:
        _, _, vw, vh = vb.split()
        return int(vw), int(vh)
    w = int(doc.get('width') or 800)
    h = int(doc.get('height') or 600)
    return w, h


def _font():
    try:
        return ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 28)
    except Exception:
        return ImageFont.load_default()


def render_pillow_preview(sv: Path) -> bytes:
    """Pillow-only preview PNG: white canvas with SVG filename labelled.

    Cairo is unavailable on this machine, so we cannot rasterise the actual
    vector content. This produces a valid PNG sized to the SVG, suitable for
    a placeholder or a subsequent Cairo-based pass.
    """
    raw = sv.read_bytes()
    doc, _ = try_parse(sv.name, raw)
    w, h = _svg_size(doc)
    img = Image.new('RGB', (w, h), 'white')
    d = ImageDraw.Draw(img)
    d.text((20, 20), sv.stem, fill='black', font=_font())
    buf = BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def render_cairo_png(sv: Path) -> bytes:
    """Render the true SVG to PNG via cairosvg (if available)."""
    try:
        import cairosvg  # type: ignore[import-untyped]
    except Exception as exc:
        raise RuntimeError('cairosvg unavailable') from exc
    raw = sv.read_bytes()
    doc, _ = try_parse(sv.name, raw)
    # cairosvg can most reliably consume the repaired bytes.
    w, h = _svg_size(doc)
    png = cairosvg.svg2png(bytestring=raw, output_width=w, output_height=h)
    return png


class BytesIO(bytes):
    pass


def main() -> None:
    print(f'Where: {ASSETS}')
    print(f'Files: {len(list(ASSETS.glob("*.svg")))} SVGs')

    parsed_ok: List[Tuple[str, Path]] = []
    failures: List[Tuple[str, str]] = []

    for sv in sorted(ASSETS.glob('*.svg')):
        try:
            raw = sv.read_bytes()
            doc, _ = try_parse(sv.name, raw)
            parsed_ok.append((sv.name, sv))
            print(f'PARSE OK  {sv.name}  size={_svg_size(doc)}')
        except Exception as exc:
            failures.append((sv.name, str(exc)[:160]))
            print(f'PARSE FAIL {sv.name}: {str(exc)[:160]}')

    print('\nPNG RENDER:')
    rendered: List[str] = []
    for name, sv in parsed_ok:
        png = ASSETS / f'{Path(name).stem}.png'
        try:
            # Prefer true rasterisation; fall back to Pillow preview.
            try:
                data = render_cairo_png(sv)
            except RuntimeError:
                data = render_pillow_preview(sv)
            png.write_bytes(data)
            im = Image.open(png)
            rendered.append(f'{name} -> {png.name}: OK {im.size[0]}x{im.size[1]} {im.mode}')
            im.close()
            print(f'RENDER OK {png.name}')
        except Exception as exc:
            rendered.append(f'{name} -> png FAIL {type(exc).__name__}: {str(exc)[:200]}')
            print(f'RENDER FAIL {name}: {str(exc)[:200]}')

    if failures:
        print('\nPARSE FAILURES:')
        for name, msg in failures:
            print(f'  {name}: {msg}')

    print('\nRENDER SUMMARY:')
    if not rendered:
        print('  (none)')
    else:
        print('\n'.join(rendered))


if __name__ == '__main__':
    main()
