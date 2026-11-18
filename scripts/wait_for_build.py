"""Polls EAS until the Android build finishes, then writes the APK link.

Uses `eas-cli build:list --json` (the only interface that works headlessly with
the stored CLI session) and writes a JSON result file the parent can read.
"""

import json
import subprocess
import time
import sys
from datetime import datetime
from pathlib import Path

PROJECT = Path(r"C:\Users\PRITHIVIRAJ\Desktop\SKILLfarm - Copy")
# Optional argv[1]: build id. Without it, tracks the newest Android build.
BUILD_ID = sys.argv[1] if len(sys.argv) > 1 else None
RESULT = PROJECT / "build-result.json"


def state():
    out = subprocess.run(
        ["npx", "eas-cli", "build:list", "--platform", "android", "--limit", "5",
         "--json", "--non-interactive"],
        cwd=PROJECT, capture_output=True, text=True, shell=True, timeout=180,
    ).stdout
    start = out.find("[")
    if start == -1:
        return None
    try:
        builds = json.loads(out[start:])
    except json.JSONDecodeError:
        return None
    if BUILD_ID:
        for b in builds:
            if b.get("id") == BUILD_ID:
                return b
        return None
    return builds[0] if builds else None


last = None
for _ in range(160):                      # ~80 minutes at 30s
    b = state()
    status = (b or {}).get("status", "UNKNOWN")
    if status != last:
        print(f"[{datetime.now():%H:%M:%S}] {status}", flush=True)
        last = status
    if status == "FINISHED":
        art = (b.get("artifacts") or {}).get("buildUrl")
        payload = {
            "status": "FINISHED",
            "apk_url": art,
            "version_code": b.get("appBuildVersion"),
            "completed_at": b.get("completedAt"),
            "expires": b.get("expirationDate"),
        }
        RESULT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print("DONE " + json.dumps(payload), flush=True)
        sys.exit(0)
    if status in ("ERRORED", "CANCELED"):
        RESULT.write_text(json.dumps({"status": status}), encoding="utf-8")
        print("FAILED " + status, flush=True)
        sys.exit(2)
    time.sleep(30)

print("TIMEOUT last=" + str(last), flush=True)
sys.exit(3)