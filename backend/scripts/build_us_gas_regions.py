#!/usr/bin/env python
"""Build us_gas_regions.geojson: US states grouped by EIA natural gas storage region.

The 5 EIA Weekly Natural Gas Storage Report regions (R31-R35) don't have official
published GeoJSON boundaries. This script assigns each US state to its EIA region,
downloads Natural Earth 50m state boundaries, and dissolves into 5 region polygons.

Output: frontend/public/geo/us_gas_regions.geojson
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

try:
    import shapely
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

# EIA gas storage region -> list of USPS 2-letter state codes.
# Source: EIA Form 912 / WNGSR region definitions (consuming + producing regions).
EIA_REGIONS: dict[str, list[str]] = {
    "East": [
        "CT", "DC", "DE", "FL", "GA", "IL", "IN", "KY", "ME", "MD", "MA",
        "MI", "MN", "MO", "NH", "NJ", "NY", "NC", "OH", "PA", "RI", "SC",
        "TN", "VA", "VT", "WI", "WV", "AL", "MS",
    ],
    "South Central": ["AR", "LA", "OK", "TX"],
    "Midwest": ["IA", "KS", "ND", "NE", "SD"],
    "Mountain": ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY"],
    "Pacific": ["AK", "CA", "HI", "OR", "WA"],
}

# Reverse lookup: state code -> region
STATE_REGION: dict[str, str] = {
    state: region for region, states in EIA_REGIONS.items() for state in states
}

# EIA series ID for each region
REGION_SERIES: dict[str, str] = {
    "East": "NW2_EPG0_SWO_R31_BCF",
    "Midwest": "NW2_EPG0_SWO_R32_BCF",
    "Mountain": "NW2_EPG0_SWO_R33_BCF",
    "Pacific": "NW2_EPG0_SWO_R34_BCF",
    "South Central": "NW2_EPG0_SWO_R35_BCF",
}

# Natural Earth 50m admin-1 states provinces GeoJSON (from their GitHub release)
NE_STATES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_1_states_provinces.geojson"
)

OUT_PATH = Path(__file__).resolve().parents[2] / "frontend" / "public" / "geo" / "us_gas_regions.geojson"


def iso_to_usps(props: dict) -> str | None:
    """Extract 2-letter USPS state code from Natural Earth feature properties."""
    # Natural Earth uses iso_3166_2 like "US-CA"
    code = props.get("iso_3166_2") or props.get("postal") or ""
    if code.startswith("US-"):
        return code[3:]
    if len(code) == 2 and props.get("admin") == "United States of America":
        return code
    return None


def build_with_shapely(features_us: list[dict]) -> dict:
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union

    by_region: dict[str, list] = {r: [] for r in EIA_REGIONS}
    for f in features_us:
        state = iso_to_usps(f["properties"])
        region = STATE_REGION.get(state or "")
        if region:
            by_region[region].append(shape(f["geometry"]))

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
                "series_id": REGION_SERIES[region],
                "state_count": len(geoms),
            },
            "geometry": mapping(dissolved),
        })

    return {"type": "FeatureCollection", "features": out_features}


def build_without_shapely(features_us: list[dict]) -> dict:
    """Fall back: keep individual state polygons with region tag.
    The choropleth colors all states in the same region identically,
    which visually reads as dissolved regions.
    """
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
                "state_abbr": state,
                "state_name": f["properties"].get("name", ""),
                "series_id": REGION_SERIES[region],
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
        print("  Dissolving into 5 EIA regions with shapely...")
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
        print("  uv run --with shapely python scripts/build_us_gas_regions.py")


if __name__ == "__main__":
    main()
