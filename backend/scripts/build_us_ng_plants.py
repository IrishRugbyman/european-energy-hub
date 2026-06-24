#!/usr/bin/env python3
"""Build the US natural gas power plants dataset.

Sources:
  1. cleanview.co state pages - curated plant list with EIA plant IDs, capacity, year
  2. EIA API v2 operating-generator-capacity (monthly) - lat/lon, nameplate MW, operator, BA
  3. EIA API v2 facility-fuel (annual) - 2024 net generation per plant

Output: backend/data/us_ng_plants.json  (committed to repo, served by refresh.py)

Usage:
    cd backend/
    EIA_API_KEY=... .venv/bin/python scripts/build_us_ng_plants.py
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.request
from pathlib import Path

import requests as req_lib

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

EIA_KEY = os.environ.get("EIA_API_KEY", "")
EIA_BASE = "https://api.eia.gov/v2"
CLEANVIEW_BASE = "https://cleanview.co"

OUTPUT_PATH = Path(__file__).parent.parent / "data" / "us_ng_plants.json"

STATES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new-hampshire", "new-jersey", "new-mexico", "new-york",
    "north-carolina", "north-dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode-island", "south-carolina", "south-dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west-virginia", "wisconsin", "wyoming",
]

STATE_SLUG_TO_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new-hampshire": "NH", "new-jersey": "NJ",
    "new-mexico": "NM", "new-york": "NY", "north-carolina": "NC",
    "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west-virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}

PLANT_URL_RE = re.compile(
    r"/power-projects/operating/natural-gas-power-plants/[a-z-]+/(\d+)/([a-z0-9-]+)"
)


def fetch_html(url: str) -> str:
    for attempt in range(3):
        try:
            r = req_lib.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; energy-hub/1.0)"},
                timeout=20,
            )
            if r.status_code == 200:
                return r.text
            logger.warning(f"  {url}: HTTP {r.status_code}")
            return ""
        except Exception as exc:
            if attempt == 2:
                logger.warning(f"  fetch {url}: {exc!r}")
            time.sleep(2 ** attempt)
    return ""


def scrape_cleanview_state(state_slug: str) -> list[dict]:
    url = f"{CLEANVIEW_BASE}/power-projects/operating/natural-gas-power-plants/{state_slug}"
    html = fetch_html(url)
    if not html:
        return []
    matches = PLANT_URL_RE.findall(html)
    seen: set[str] = set()
    results: list[dict] = []
    for plant_id, slug in matches:
        if plant_id in seen:
            continue
        seen.add(plant_id)
        category = "largest" if len(results) < 9 else "recent"
        results.append({
            "plant_id": int(plant_id),
            "slug": slug,
            "state_slug": state_slug,
            "state_abbr": STATE_SLUG_TO_ABBR.get(state_slug, ""),
            "category": category,
        })
    logger.info(f"  {state_slug}: {len(results)} plants")
    return results


def eia_get_all_ng_plants() -> dict[int, dict]:
    """Fetch ALL operating NG generators from EIA (latest month) with lat/lon.

    Returns {plant_id: {lat, lon, nameplate_mw, entity_name, ba_code, county, state, op_year, plant_name}}
    """
    logger.info("Fetching EIA plant locations (all US NG operating generators, latest month)...")
    all_rows: list[dict] = []

    # Fetch state by state to stay under the 5000-row pagination limit
    for state_abbr in STATE_SLUG_TO_ABBR.values():
        r = req_lib.get(
            f"{EIA_BASE}/electricity/operating-generator-capacity/data/",
            params={
                "api_key": EIA_KEY,
                "data[]": ["nameplate-capacity-mw", "latitude", "longitude",
                           "county", "operating-year-month"],
                "frequency": "monthly",
                "facets[energy_source_code][]": "NG",
                "facets[status][]": "OP",
                "facets[stateid][]": state_abbr,
                "sort[0][column]": "period",
                "sort[0][direction]": "desc",
                "length": "5000",
            },
            timeout=30,
        )
        if r.status_code != 200:
            logger.warning(f"  EIA locations {state_abbr}: HTTP {r.status_code}")
            continue
        d = r.json()
        rows = d.get("response", {}).get("data", [])
        # Keep only the most recent period for this state
        if rows:
            latest_period = max(row.get("period", "") for row in rows)
            rows = [row for row in rows if row.get("period", "") == latest_period]
        all_rows.extend(rows)
        time.sleep(0.05)

    logger.info(f"  Got {len(all_rows)} generator rows across all states")

    # Aggregate to plant level
    plant_rows: dict[int, list[dict]] = {}
    for row in all_rows:
        try:
            pid = int(row["plantid"])
        except (KeyError, ValueError, TypeError):
            continue
        if pid not in plant_rows:
            plant_rows[pid] = []
        plant_rows[pid].append(row)

    result: dict[int, dict] = {}
    for pid, prows in plant_rows.items():
        # Sum nameplate capacity, average lat/lon across generators
        total_mw = sum(
            float(r["nameplate-capacity-mw"])
            for r in prows
            if r.get("nameplate-capacity-mw") not in (None, "")
        )
        lats = [float(r["latitude"]) for r in prows if r.get("latitude")]
        lons = [float(r["longitude"]) for r in prows if r.get("longitude")]
        # Earliest operating year across generators = plant commissioning year
        op_years = [
            int(r["operating-year-month"][:4])
            for r in prows
            if r.get("operating-year-month") and len(r["operating-year-month"]) >= 4
        ]
        ref = prows[0]
        result[pid] = {
            "lat": round(sum(lats) / len(lats), 5) if lats else None,
            "lon": round(sum(lons) / len(lons), 5) if lons else None,
            "nameplate_mw": round(total_mw, 1) if total_mw else None,
            "entity_name": ref.get("entityName", ""),
            "ba_code": ref.get("balancing_authority_code", ""),
            "county": ref.get("county", ""),
            "state": ref.get("stateid", ""),
            "op_year": min(op_years) if op_years else None,
            "plant_name": ref.get("plantName", ""),
        }

    logger.info(f"  Aggregated to {len(result)} unique plants")
    return result


def eia_get_generation(plant_ids: list[int]) -> dict[int, float]:
    """Return {plant_id: net_generation_gwh} from EIA facility-fuel most recent annual."""
    logger.info(f"Fetching EIA annual generation for {len(plant_ids)} plants...")
    result: dict[int, dict] = {}  # {pid: {gen, period}}

    chunk_size = 100
    for i in range(0, len(plant_ids), chunk_size):
        chunk = plant_ids[i : i + chunk_size]
        params: dict = {
            "api_key": EIA_KEY,
            "data[]": "generation",
            "facets[fuel2002][]": "NG",
            "facets[primeMover][]": "ALL",
            "frequency": "annual",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": "500",
        }
        params["facets[plantCode][]"] = [str(p) for p in chunk]
        r = req_lib.get(
            f"{EIA_BASE}/electricity/facility-fuel/data/",
            params=params,
            timeout=30,
        )
        if r.status_code != 200:
            logger.warning(f"  EIA generation chunk {i}: HTTP {r.status_code}: {r.text[:200]}")
            continue
        for row in r.json().get("response", {}).get("data", []):
            try:
                pid = int(row["plantCode"])
                gen = float(row["generation"])
                period = row.get("period", "")
            except (KeyError, ValueError, TypeError):
                continue
            if pid not in result or period > result[pid]["period"]:
                result[pid] = {"gen": gen, "period": period}
        time.sleep(0.1)

    return {pid: round(v["gen"] / 1000, 1) for pid, v in result.items()}  # MWh -> GWh


def main() -> None:
    if not EIA_KEY:
        raise SystemExit("EIA_API_KEY not set")

    # Step 1: Scrape cleanview for curated plant IDs
    logger.info("Scraping cleanview state pages...")
    all_cv_plants: list[dict] = []
    cv_plant_ids: set[int] = set()
    for state_slug in STATES:
        entries = scrape_cleanview_state(state_slug)
        for e in entries:
            if e["plant_id"] not in cv_plant_ids:
                all_cv_plants.append(e)
                cv_plant_ids.add(e["plant_id"])
        time.sleep(0.4)

    logger.info(f"cleanview: {len(all_cv_plants)} unique plants from 50 states")
    cv_by_id = {e["plant_id"]: e for e in all_cv_plants}
    plant_ids = list(cv_plant_ids)

    # Step 2: EIA lat/lon + capacity + operator for ALL US NG operating plants
    eia_locations = eia_get_all_ng_plants()

    # Step 3: EIA annual generation for cleanview plants
    generation = eia_get_generation(plant_ids)

    # Step 4: Merge - use EIA locations for enrichment, cleanview for curation
    plants: list[dict] = []
    no_coords = 0
    for pid in plant_ids:
        loc = eia_locations.get(pid)
        if not loc or loc.get("lat") is None or loc.get("lon") is None:
            no_coords += 1
            continue
        cv = cv_by_id[pid]
        gen_gwh = generation.get(pid)
        plants.append({
            "plant_id": pid,
            "name": loc["plant_name"] or cv["slug"].replace("-", " ").title(),
            "state": loc["state"],
            "county": loc["county"],
            "lat": loc["lat"],
            "lon": loc["lon"],
            "nameplate_mw": loc["nameplate_mw"],
            "entity_name": loc["entity_name"],
            "ba_code": loc["ba_code"],
            "op_year": loc["op_year"],
            "gen_gwh": gen_gwh,  # annual net generation (GWh)
            "category": cv["category"],  # 'largest' or 'recent' (cleanview curation)
            "cleanview_url": (
                f"https://cleanview.co/power-projects/operating/"
                f"natural-gas-power-plants/{cv['state_slug']}/{pid}/{cv['slug']}"
            ),
        })

    plants.sort(key=lambda p: p.get("nameplate_mw") or 0, reverse=True)
    logger.info(f"Final: {len(plants)} plants with coordinates ({no_coords} skipped - no EIA coords)")

    OUTPUT_PATH.parent.mkdir(exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps({"plants": plants, "count": len(plants)}, indent=2))
    logger.info(f"Written to {OUTPUT_PATH}")

    print(f"\nTop 10 by nameplate capacity:")
    for p in plants[:10]:
        gen_s = f"{p['gen_gwh']:,} GWh" if p["gen_gwh"] else "n/a"
        print(f"  {p['name']:<40} {p['state']}  {p['nameplate_mw']:6.0f} MW  {gen_s}  [{p['ba_code']}]")


if __name__ == "__main__":
    main()
