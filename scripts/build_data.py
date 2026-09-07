"""
Build Canada-only GHCN-Monthly files for the climate lab globe.

Output (written to public/data/):
  meta.json      grid metadata and legacy lab IDs
  stations.json  search index
  tavg.bin       Int16 grid, station-major, hundredths of a °C, -9999 = missing
"""

from __future__ import annotations

import gzip
import json
import sys
import tarfile
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "_data"
OUT = ROOT / "public" / "data"
GHCN_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcu.tar.gz"
START_YEAR = 1879
MISSING = -9999

# Old globe IDs from the Columbia College / BC Open Textbook lab.
# Primary series is filled from sister stations only where a month is missing.
LEGACY_STATIONS = {
    "403719130000": {
        "primary": "CA005060595",
        "fill": ["CA005060608", "CA005060600", "CA005060602"],
        "label": "Churchill",
    },
    "403718690000": {
        "primary": "CA004056240",
        "fill": ["CA004056230"],
        "label": "Prince Albert",
    },
    "403716000000": {
        "primary": "CA008204700",
        "fill": ["CA008204701"],
        "label": "Sable Island",
    },
    "403718360000": {
        "primary": "CA006075420",
        "fill": ["CA006075428", "CA006075435", "CA006075431"],
        "label": "Moosonee",
    },
}

PROVINCE_BY_PREFIX = {
    10: "BC",
    11: "BC",
    12: "BC",
    13: "BC",
    14: "BC",
    15: "BC",
    16: "BC",
    17: "BC",
    18: "BC",
    19: "BC",
    20: "AB",
    21: "AB",
    22: "YT",
    23: "NT",
    24: "NU",
    25: "AB",
    26: "AB",
    30: "SK",
    31: "SK",
    32: "SK",
    33: "SK",
    34: "SK",
    40: "SK",
    50: "MB",
    51: "MB",
    60: "ON",
    61: "ON",
    70: "QC",
    71: "QC",
    80: "NB",
    81: "NB",
    82: "NS",
    83: "PE",
    84: "NL",
    85: "NL",
    86: "NL",
}

# Printed after the build so we can compare with the old globe table.
CHURCHILL_CHECK = {
    1890: (-30.4, 12.1),
    1900: (-28.4, 13.1),
    1910: (-23.8, 13.9),
    1940: (-21.1, 13.9),
    1950: (-36.2, 11.1),
    1960: (-26.2, 11.6),
    1970: (-26.3, 12.9),
    1980: (-26.7, 10.8),
    1990: (-27.3, 13.2),
    2000: (-25.2, 12.2),
    2010: (-21.6, 14.0),
}


def pretty_name(raw: str) -> str:
    return raw.replace("_", " ").strip().title()


def climate_id(station_id: str) -> str:
    digits = "".join(ch for ch in station_id[2:] if ch.isdigit())
    return digits[-7:] if len(digits) >= 7 else digits


def province_for(station_id: str) -> str:
    cid = climate_id(station_id)
    if len(cid) < 2:
        return ""
    return PROVINCE_BY_PREFIX.get(int(cid[:2]), "")


def find_cached_ghcn() -> tuple[Path, Path] | None:
    if not CACHE.exists():
        return None
    dats = list(CACHE.glob("**/ghcnm.tavg*.qcu.dat"))
    if not dats:
        return None
    dat = dats[0]
    inv = dat.with_suffix(".inv")
    if inv.exists():
        return dat, inv
    return None


def download_ghcn() -> tuple[Path, Path]:
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / "ghcnm.tavg.latest.qcu.tar.gz"
    print(f"Downloading {GHCN_URL}")
    urllib.request.urlretrieve(GHCN_URL, archive)
    print(f"Extracting {archive}")
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(CACHE)
    found = find_cached_ghcn()
    if not found:
        raise FileNotFoundError("Could not find GHCN-M .dat/.inv after download")
    return found


def parse_inventory(inv_path: Path) -> dict[str, dict]:
    stations = {}
    for line in inv_path.read_text(encoding="ascii", errors="replace").splitlines():
        if not line.startswith("CA"):
            continue
        sid = line[0:11].strip()
        stations[sid] = {
            "id": sid,
            "lat": float(line[12:20]),
            "lon": float(line[21:30]),
            "elev": float(line[31:37]),
            "name": pretty_name(line[38:].strip()),
            "province": province_for(sid),
        }
    return stations


def month_index(year: int, month: int, start_year: int = START_YEAR) -> int:
    return (year - start_year) * 12 + (month - 1)


def parse_dat(dat_path: Path, canada_ids: set[str]) -> tuple[dict[str, list[int]], int]:
    """Return {id: [12 ints per year-row...]} collected, plus max year seen."""
    by_year: dict[str, dict[int, list[int]]] = {sid: {} for sid in canada_ids}
    max_year = START_YEAR
    with dat_path.open("r", encoding="ascii", errors="replace") as handle:
        for line in handle:
            sid = line[0:11]
            if sid not in by_year:
                continue
            year = int(line[11:15])
            max_year = max(max_year, year)
            vals = []
            pos = 19
            for _ in range(12):
                raw = int(line[pos : pos + 5])
                vals.append(MISSING if raw == MISSING else raw)
                pos += 8
            by_year[sid][year] = vals

    return by_year, max_year


def flatten_series(year_map: dict[int, list[int]], n_months: int) -> list[int]:
    grid = [MISSING] * n_months
    for year, months in year_map.items():
        if year < START_YEAR:
            continue
        base = month_index(year, 1)
        if base >= n_months:
            continue
        for month_i, value in enumerate(months):
            idx = base + month_i
            if 0 <= idx < n_months:
                grid[idx] = value
    return grid


def fill_missing(target: list[int], donor: list[int]) -> int:
    filled = 0
    for i, value in enumerate(target):
        if value == MISSING and donor[i] != MISSING:
            target[i] = donor[i]
            filled += 1
    return filled


def first_last(grid: list[int], n_months: int) -> tuple[str | None, str | None]:
    first = next((i for i, v in enumerate(grid) if v != MISSING), None)
    last = next((i for i in range(n_months - 1, -1, -1) if grid[i] != MISSING), None)
    if first is None or last is None:
        return None, None

    def label(idx: int) -> str:
        year = START_YEAR + idx // 12
        month = idx % 12 + 1
        return f"{year:04d}-{month:02d}"

    return label(first), label(last)


def fmt_temp(hundredths: int) -> str:
    if hundredths == MISSING:
        return "No Data"
    return f"{hundredths / 100:.1f}"


def main() -> int:
    found = find_cached_ghcn()
    if found:
        dat_path, inv_path = found
        print(f"Using cached GHCN-M files:\n  {dat_path}\n  {inv_path}")
    else:
        dat_path, inv_path = download_ghcn()

    inventory = parse_inventory(inv_path)
    print(f"Canadian stations in inventory: {len(inventory)}")

    year_maps, max_year = parse_dat(dat_path, set(inventory))
    end_year = max_year
    end_month = 12
    n_months = month_index(end_year, end_month) + 1
    print(f"Time range {START_YEAR}-01 to {end_year}-{end_month:02d} ({n_months} months)")

    series: dict[str, list[int]] = {}
    for sid, year_map in year_maps.items():
        grid = flatten_series(year_map, n_months)
        if any(v != MISSING for v in grid):
            series[sid] = grid

    for legacy_id, spec in LEGACY_STATIONS.items():
        primary = spec["primary"]
        if primary not in series:
            print(f"WARNING: primary {primary} for {legacy_id} has no data")
            continue
        for donor_id in spec["fill"]:
            if donor_id in series:
                n = fill_missing(series[primary], series[donor_id])
                if n:
                    print(f"Filled {n} missing months in {primary} from {donor_id}")

    ordered_ids = sorted(series, key=lambda sid: (inventory[sid]["name"], sid))
    stations = []
    blobs = []
    primary_to_legacy = {spec["primary"]: legacy for legacy, spec in LEGACY_STATIONS.items()}

    for index, sid in enumerate(ordered_ids):
        grid = series[sid]
        start, end = first_last(grid, n_months)
        info = inventory[sid]
        display_name = info["name"]
        legacy_id = primary_to_legacy.get(sid)
        if legacy_id:
            display_name = LEGACY_STATIONS[legacy_id]["label"]
        stations.append(
            {
                "i": index,
                "id": sid,
                "legacyId": legacy_id,
                "name": display_name,
                "province": info["province"],
                "lat": round(info["lat"], 4),
                "lon": round(info["lon"], 4),
                "elev": info["elev"],
                "start": start,
                "end": end,
            }
        )
        blobs.append(grid)

    raw = bytearray()
    for grid in blobs:
        for value in grid:
            raw.extend(int(value).to_bytes(2, "little", signed=True))

    OUT.mkdir(parents=True, exist_ok=True)
    bin_path = OUT / "tavg.bin"
    gz_path = OUT / "tavg.dat"
    bin_path.write_bytes(raw)
    gz_path.write_bytes(gzip.compress(raw, compresslevel=6))

    meta = {
        "source": "NOAA GHCN-Monthly v4 QCU (unadjusted mean temperature)",
        "attribution": "NOAA National Centers for Environmental Information",
        "built": date.today().isoformat(),
        "variable": "tavg",
        "units": "0.01 C",
        "missing": MISSING,
        "startYear": START_YEAR,
        "startMonth": 1,
        "endYear": end_year,
        "endMonth": end_month,
        "nStations": len(stations),
        "nMonths": n_months,
        "legacyIds": {legacy: spec["primary"] for legacy, spec in LEGACY_STATIONS.items()},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (OUT / "stations.json").write_text(json.dumps(stations, separators=(",", ":")), encoding="utf-8")

    print(f"Wrote {len(stations)} stations")
    print(f"  {OUT / 'stations.json'}  ({(OUT / 'stations.json').stat().st_size / 1024:.0f} KB)")
    print(f"  {bin_path}  ({bin_path.stat().st_size / 1024 / 1024:.2f} MB)")
    print(f"  {gz_path}  ({gz_path.stat().st_size / 1024 / 1024:.2f} MB gzip)")

    churchill = next(s for s in stations if s["legacyId"] == "403719130000")
    grid = blobs[churchill["i"]]
    print("\nChurchill (403719130000 / CA005060595) vs old globe table:")
    print(f"{'Year':<6} {'Jan ours':>10} {'Jan old':>10} {'Jul ours':>10} {'Jul old':>10}")
    for year, (jan_old, jul_old) in CHURCHILL_CHECK.items():
        jan = grid[month_index(year, 1)]
        jul = grid[month_index(year, 7)]
        print(
            f"{year:<6} {fmt_temp(jan):>10} {jan_old:>10.1f} {fmt_temp(jul):>10} {jul_old:>10.1f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
