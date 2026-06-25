#!/usr/bin/env python
"""Build us_power_regions.geojson: US states grouped by EIA Form 930 grid region.

The 10 EIA Hourly Electric Grid Monitor regions (TEX/CAL/MISO/MIDA/SE/NW/CAR/FLA/SW/ISNE)
don't have official published GeoJSON boundaries. This script assigns each US state to its
approximate EIA region, downloads Natural Earth 50m state boundaries, and dissolves into
10 region polygons.

Assignments follow the EIA Form 930 respondent (balancing authority) geographic footprints.
States that don't fall cleanly into any of the 10 regions (NY/NYISO, KS/NE/OK/SPP,
AK, HI) are omitted - these territories are not represented in the Form 930 dataset.

Output: frontend/public/geo/us_power_regions.geojson
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

try:
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

# EIA Form 930 region code -> US state USPS codes (approximate geographic assignment).
# Sources: EIA documentation, BA coverage maps, Form EIA-930 respondent list.
EIA_POWER_REGIONS: dict[str, dict] = {
    "TEX": {
        "name": "Texas",
        "states": ["TX"],
    },
    "CAL": {
        "name": "California",
        "states": ["CA"],
    },
    "MISO": {
        "name": "Midwest",
        "states": ["MN", "WI", "IA", "IL", "IN", "MI", "ND", "SD", "MO", "AR", "LA"],
    },
    "MIDA": {
        "name": "Mid-Atlantic",
        # PJM footprint: roughly PA/NJ/DE/MD/VA/WV/OH/KY + DC
        "states": ["PA", "NJ", "DE", "MD", "VA", "WV", "OH", "KY"],
    },
    "SE": {
        "name": "Southeast",
        "states": ["AL", "MS", "GA", "TN"],
    },
    "NW": {
        "name": "Northwest",
        "states": ["WA", "OR", "ID", "MT", "WY"],
    },
    "CAR": {
        "name": "Carolinas",
        "states": ["NC", "SC"],
    },
    "FLA": {
        "name": "Florida",
        "states": ["FL"],
    },
    "SW": {
        "name": "Southwest",
        "states": ["AZ", "NM", "UT", "CO", "NV"],
    },
    "ISNE": {
        "name": "New England",
        "states": ["ME", "NH", "VT", "MA", "RI", "CT"],
    },
}

# Reverse lookup: state -> region code
STATE_REGION: dict[str, str] = {
    state: region
    for region, meta in EIA_POWER_REGIONS.items()
    for state in meta["states"]
}

NE_STATES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_1_states_provinces.geojson"
)

OUT_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "public" / "geo" / "us_power_regions.geojson"
)


def iso_to_usps(props: dict) -> str | None:
    code = props.get("iso_3166_2") or props.get("postal") or ""
    if code.startswith("US-"):
        return code[3:]
    if len(code) == 2 and props.get("admin") == "United States of America":
        return code
    return None


def build_with_shapely(features_us: list[dict]) -> dict:
    by_region: dict[str, list] = {r: [] for r in EIA_POWER_REGIONS}
    assigned = set()
    for f in features_us:
        state = iso_to_usps(f["properties"])
        region = STATE_REGION.get(state or "")
        if region:
            by_region[region].append(shape(f["geometry"]))
            assigned.add(state)

    unassigned = [
        iso_to_usps(f["properties"]) for f in features_us
        if iso_to_usps(f["properties"]) not in assigned
        and iso_to_usps(f["properties"]) is not None
    ]
    if unassigned:
        print(f"  Unassigned states (not in Form 930 coverage): {sorted(set(unassigned))}", file=sys.stderr)

    out_features = []
    for region, geoms in by_region.items():
        if not geoms:
            print(f"WARNING: no geometries for region {region}", file=sys.stderr)
            continue
        dissolved = unary_union(geoms)
        out_features.append({
            "type": "Feature",
            "properties": {
                "region": region,
                "region_name": EIA_POWER_REGIONS[region]["name"],
                "state_count": len(geoms),
            },
            "geometry": mapping(dissolved),
        })
        print(f"  {region} ({EIA_POWER_REGIONS[region]['name']}): {len(geoms)} states")

    return {"type": "FeatureCollection", "features": out_features}


def build_without_shapely(features_us: list[dict]) -> dict:
    out_features = []
    for f in features_us:
        state = iso_to_usps(f["properties"])
        region = STATE_REGION.get(state or "")
        if not region:
            continue
        out_features.append({
            "type": "Feature",
            "properties": {
                "region": region,
                "region_name": EIA_POWER_REGIONS[region]["name"],
                "state_abbr": state,
            },
            "geometry": f["geometry"],
        })
    return {"type": "FeatureCollection", "features": out_features}


def main() -> None:
    print("Downloading Natural Earth 50m state boundaries...")
    req = urllib.request.Request(NE_STATES_URL, headers={"User-Agent": "energy-hub-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = json.load(r)

    features_us = [
        f for f in raw["features"]
        if f["properties"].get("admin") == "United States of America"
    ]
    print(f"  Found {len(features_us)} US state features")

    if HAS_SHAPELY:
        print("  Dissolving into 10 EIA Form 930 regions with shapely...")
        out = build_with_shapely(features_us)
        print(f"  Output: {len(out['features'])} region polygons")
    else:
        print("  shapely not available; keeping state polygons with region tags")
        out = build_without_shapely(features_us)
        print(f"  Output: {len(out['features'])} state polygon features")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    kb = OUT_PATH.stat().st_size // 1024
    print(f"Written {OUT_PATH}  ({kb} KB)")

    if not HAS_SHAPELY:
        print("\nNote: install shapely for dissolved region polygons:")
        print("  uv run --with shapely python scripts/build_us_power_regions.py")


if __name__ == "__main__":
    main()
