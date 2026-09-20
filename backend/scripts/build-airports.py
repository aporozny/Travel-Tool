import json, sys, urllib.request

# Builds backend/src/data/airports.json from mwgg/Airports (MIT): only what
# Drift needs, keyed by IATA code, so the file stays small.
SRC = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json"
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "data", "airports.json")

raw = json.load(urllib.request.urlopen(SRC, timeout=60))
out = {}
for rec in raw.values():
    iata = (rec.get("iata") or "").strip()
    tz = (rec.get("tz") or "").strip()
    if len(iata) != 3 or not tz:
        continue
    row = {"tz": tz, "cc": rec.get("country") or "", "city": rec.get("city") or "", "name": rec.get("name") or ""}
    # A few IATA codes are shared; keep the entry that has a city name.
    if iata not in out or (row["city"] and not out[iata]["city"]):
        out[iata] = row

if len(out) < 3000:
    sys.exit(f"suspiciously few airports: {len(out)}")
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(dict(sorted(out.items())), f, ensure_ascii=False, separators=(",", ":"))
print("airports with IATA + timezone:", len(out))
for code in ["SYD", "MEL", "BNE", "DPS", "CGK", "SIN", "KUL", "LHR", "PER"]:
    print(" ", code, out.get(code))
