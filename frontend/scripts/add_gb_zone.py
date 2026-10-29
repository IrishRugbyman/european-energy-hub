"""Add (or replace) the Great Britain bidding-zone polygon in public/geo/bidding_zones.geojson.

GB is not an ENTSO-E zone since Brexit, so the original ENTSO-E zone build left it out.
Source and simplification match the other zones (see geo-README.md): electricitymaps
`world.geojson` feature `GB` (Great Britain, without Northern Ireland, which is part of
the IE-SEM zone), Ramer-Douglas-Peucker at 0.03 degrees, 3 decimals.

    curl -s https://raw.githubusercontent.com/electricitymaps/electricitymaps-contrib/master/geo/world.geojson \
      -o /tmp/em_world.geojson
    python3 scripts/add_gb_zone.py /tmp/em_world.geojson
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

EPSILON = 0.03
DECIMALS = 3
MIN_RING_POINTS = 4  # a closed ring needs at least 3 distinct points + the closing one
TARGET = Path(__file__).resolve().parent.parent / "public" / "geo" / "bidding_zones.geojson"


def _perp_distance(p, a, b) -> float:
    if a == b:
        return math.dist(p, a)
    (x, y), (x1, y1), (x2, y2) = p, a, b
    return abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / math.dist(a, b)


def rdp(points: list, epsilon: float) -> list:
    """Ramer-Douglas-Peucker polyline simplification (iterative, keeps endpoints)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        best, idx = 0.0, None
        for i in range(lo + 1, hi):
            d = _perp_distance(points[i], points[lo], points[hi])
            if d > best:
                best, idx = d, i
        if idx is not None and best > epsilon:
            keep[idx] = True
            stack.extend([(lo, idx), (idx, hi)])
    return [p for p, k in zip(points, keep, strict=True) if k]


def simplify_multipolygon(coords: list) -> list:
    """Simplify every ring of a MultiPolygon, dropping rings and polygons that collapse."""
    out = []
    for polygon in coords:
        rings = []
        for ring in polygon:
            simple = [[round(x, DECIMALS), round(y, DECIMALS)] for x, y in rdp(ring, EPSILON)]
            if len(simple) >= MIN_RING_POINTS:
                rings.append(simple)
        if rings:  # an islet that simplifies away is dropped, like the other zones'
            out.append(rings)
    return out


def main(source: str) -> None:
    """Replace the GB feature in bidding_zones.geojson from an electricitymaps world file."""
    world = json.loads(Path(source).read_text())
    (gb,) = [f for f in world["features"] if f["properties"].get("zoneName") == "GB"]
    geom = gb["geometry"]
    coords = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    feature = {
        "type": "Feature",
        "properties": {"zone": "GB"},
        "geometry": {"type": "MultiPolygon", "coordinates": simplify_multipolygon(coords)},
    }
    zones = json.loads(TARGET.read_text())
    zones["features"] = [f for f in zones["features"] if f["properties"].get("zone") != "GB"]
    zones["features"].append(feature)
    TARGET.write_text(json.dumps(zones, separators=(",", ":")))
    n_polys = len(feature["geometry"]["coordinates"])
    print(f"GB written: {n_polys} polygons, {len(zones['features'])} zones total")


if __name__ == "__main__":
    main(sys.argv[1])
