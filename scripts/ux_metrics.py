"""Generates ux-metrics.json — the measurements behind UX_REVIEW.md.

For every route in app/ it records: lines, size, hardcoded hex literals, the
font sizes and paddings actually used, whether loading/empty/error states
exist, and how many pressable controls carry accessibility labels.

Run:  python scripts/ux_metrics.py
"""

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"


def collect():
    rows = []
    for path in sorted(APP.rglob("*.tsx")):
        name = path.name
        if name.startswith("+") or name.startswith("_"):
            continue
        src = path.read_text(encoding="utf-8", errors="ignore")
        rel = path.relative_to(ROOT).as_posix()
        rows.append(
            {
                "screen": rel,
                "lines": src.count("\n") + 1,
                "kb": round(path.stat().st_size / 1024, 1),
                "hex": len(re.findall(r"#[0-9A-Fa-f]{6}\b", src)),
                "font_sizes": sorted({int(x) for x in re.findall(r"fontSize:\s*(\d+)", src)}),
                "paddings": sorted(
                    {int(x) for x in re.findall(r"padding(?:Horizontal|Vertical|Top|Bottom|Left|Right)?:\s*(\d+)", src)}
                ),
                "loading": bool(re.search(r"loading|isLoading|ActivityIndicator|Skeleton", src)),
                "empty": bool(re.search(r"EmptyState|emptyText|No .{0,20}(yet|found)", src, re.I)),
                "error": bool(re.search(r"error|Alert\.alert|catch", src)),
                "pressable": len(re.findall(r"<Pressable", src)),
                "labelled": len(re.findall(r"accessibilityLabel", src)),
                "icons": len(re.findall(r"<Ionicons", src)),
            }
        )
    return sorted(rows, key=lambda r: -r["lines"])


def main():
    rows = collect()
    out = ROOT / "ux-metrics.json"
    out.write_text(json.dumps(rows, indent=1), encoding="utf-8")

    grid = {4, 8, 12, 16, 24, 32, 48}
    fonts, pads = set(), set()
    for r in rows:
        fonts.update(r["font_sizes"])
        pads.update(r["paddings"])

    print(f"screens analysed: {len(rows)}")
    print(f"font sizes in use: {len(fonts)}  (off-scale: {sorted(f for f in fonts if f not in {11,12,13,15,16,19,24,26,30})})")
    print(f"paddings in use : {len(pads)}  (off-grid: {sorted(p for p in pads if p % 4 != 0)})")
    print(f"hardcoded hex across screens: {sum(r['hex'] for r in rows)}")
    print(f"screens without an empty state: {sum(1 for r in rows if not r['empty'])}")
    print(f"screens without loading state : {sum(1 for r in rows if not r['loading'])}")
    print(f"\nwrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()