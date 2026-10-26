#!/usr/bin/env python3
"""Rasterise every SVG in public/assets/svg to PNG in public/assets/png.

Uses headless Chrome (SVG -> <img> wrapper -> screenshot) so text and vector
strokes are rendered crisply at the target scale.

Scale rules:
  * default: 2x the SVG's viewBox size
  * og-image: 1200x630 exact (Open Graph spec)
  * app-icon: 512x512 exact (icon spec)
"""

import os
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG_DIR = ROOT / "public" / "assets" / "svg"
PNG_DIR = ROOT / "public" / "assets" / "png"
WRAP_DIR = ROOT / ".render"

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

EXACT = {
    "og-image": (1200, 630),
    "app-icon": (512, 512),
}


def viewbox(path: Path):
    head = path.read_text(encoding="utf-8")[:1200]
    m = re.search(r'viewBox="([\d.\s\-]+)"', head)
    if not m:
        return None
    parts = [float(p) for p in m.group(1).split()]
    return parts[2], parts[3]


def png_size(path: Path):
    data = path.read_bytes()[:33]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def main():
    svgs = sorted(SVG_DIR.glob("*.svg"))
    if not svgs:
        print("no SVGs found")
        return 1
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    WRAP_DIR.mkdir(parents=True, exist_ok=True)

    failures = []
    for svg in svgs:
        vb = viewbox(svg)
        if not vb:
            failures.append((svg.name, "no viewBox"))
            continue
        name = svg.stem
        w, h = EXACT.get(name, (int(vb[0]) * 2, int(vb[1]) * 2))

        wrap = WRAP_DIR / f"{name}.html"
        wrap.write_text(
            "<!doctype html><html><head><meta charset='utf-8'>"
            "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}"
            f"img{{display:block;width:{w}px;height:{h}px}}</style></head>"
            f"<body><img src='file:///{svg.as_posix()}'></body></html>",
            encoding="utf-8",
        )
        out = PNG_DIR / f"{name}.png"
        cmd = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--window-size={w},{h}",
            f"--screenshot={out.as_posix()}",
            wrap.as_uri(),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if not out.exists():
            failures.append((svg.name, (proc.stderr or proc.stdout)[-200:]))
            continue
        got = png_size(out)
        if got != (w, h):
            failures.append((svg.name, f"expected {(w, h)} got {got}"))
            continue
        kb = out.stat().st_size // 1024
        print(f"OK  {name:<28} {w}x{h}  {kb} KB")

    if failures:
        print("\nFAILURES:")
        for name, why in failures:
            print(f"  {name}: {why}")
        return 1
    print(f"\n{len(svgs)} assets rendered -> {PNG_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
