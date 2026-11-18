"""W2 acceptance check: every icon name used by the app must exist in the
subset TTF that is actually deployed. Prints a pass/fail table.

Run with the system Python (needs fonttools):
  C:\\Users\\PRITHIVIRAJ\\AppData\\Local\\Programs\\Python\\Python311\\python.exe
"""

import json
import re
import glob
import os
from fontTools.ttLib import TTFont

ROOT = r"C:\Users\PRITHIVIRAJ\Desktop\SKILLfarm - Copy"
GLYPHMAP = os.path.join(
    ROOT, "node_modules", "@expo", "vector-icons", "build", "vendor",
    "react-native-vector-icons", "glyphmaps", "Ionicons.json",
)

# 1. Every glyph name referenced in source (quoted literals).
names = set()
for sub in ("app", "components", "lib", "constants"):
    for path in glob.glob(os.path.join(ROOT, sub, "**", "*.ts*"), recursive=True):
        try:
            txt = open(path, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        names.update(re.findall(r'["\']([a-z0-9][a-z0-9-]{2,40})["\']', txt))

glyphmap = json.load(open(GLYPHMAP, encoding="utf-8"))
used = {n: glyphmap[n] for n in names if n in glyphmap}

# 2. The deployed subset font.
fonts = glob.glob(os.path.join(ROOT, "dist", "vendor", "**", "Ionicons*.ttf"), recursive=True)
if not fonts:
    raise SystemExit("no deployed Ionicons TTF found in dist/vendor")

font = TTFont(fonts[0])
cmap = font.getBestCmap()

missing = sorted(n for n, cp in used.items() if cp not in cmap)
print(f"deployed font: {os.path.basename(fonts[0])}")
print(f"glyphs in font: {len(cmap)}")
print(f"icon names referenced in source: {len(used)}")
print(f"missing from font: {len(missing)}")
if missing:
    print("MISSING:", missing)
    raise SystemExit(1)
print("PASS — every referenced Ionicons glyph exists in the deployed subset")