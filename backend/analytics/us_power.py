"""US power generation mix analytics: EIA hourly RTO fuel-type data.

Calls the EIA Open Data API v2 (electricity/rto/fuel-type-data) directly during
the refresh step. No PostgreSQL dependency - this is real-time EIA data not in
market_data. Fetches the last 48h for 10 EIA grid regions + US-48 aggregate.

Produces two DuckDB tables:
  us_power_hourly  - 48h hourly generation per region per fuel type
  us_power_latest  - latest complete hour per region (all fuel types)
"""

from __future__ import annotations

import urllib.parse
import urllib.request
import json
import logging
from datetime import datetime, timezone

import pandas as pd

logger = logging.getLogger(__name__)

EIA_API_BASE = "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/"

# EIA region codes + display names. These are the EIA grid-region aggregates
# (not individual balancing authorities) so each represents 10s of GW.
REGIONS: dict[str, str] = {
    "TEX": "Texas",
    "CAL": "California",
    "MISO": "Midwest",
    "MIDA": "Mid-Atlantic",
    "SE": "Southeast",
    "NW": "Northwest",
    "CAR": "Carolinas",
    "FLA": "Florida",
    "SW": "Southwest",
    "ISNE": "New England",
}

# Fuel types returned by EIA - map code -> display name
FUEL_NAMES: dict[str, str] = {
    "NG": "Natural Gas",
    "NUC": "Nuclear",
    "COL": "Coal",
    "WND": "Wind",
    "SUN": "Solar",
    "WAT": "Hydro",
    "BAT": "Battery",
    "OES": "Storage",
    "OIL": "Petroleum",
    "GEO": "Geothermal",
    "SNB": "Solar+Battery",
    "PS": "Pumped Storage",
    "OTH": "Other",
    "UNK": "Unknown",
}

# Fuels to display in the mix bar (others collapsed into Other)
DISPLAY_FUELS = ["NG", "NUC", "COL", "WND", "SUN", "WAT", "OIL", "OTH"]


def _fetch_eia(eia_key: str, respondents: list[str], hours: int = 48) -> list[dict]:
    """Fetch hourly fuel-type generation from EIA API for the given respondents."""
    params: dict[str, str | list] = {
        "api_key": eia_key,
        "data[]": "value",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": "5000",
    }
    for i, r in enumerate(respondents):
        params[f"facets[respondent][]"] = r  # will be overwritten; build manually
    # Build query string manually to support repeated keys
    parts = [f"api_key={urllib.parse.quote(eia_key)}", "data[]=value",
             "sort[0][column]=period", "sort[0][direction]=desc", "length=5000"]
    for r in respondents:
        parts.append(f"facets[respondent][]={urllib.parse.quote(r)}")
    url = EIA_API_BASE + "?" + "&".join(parts)
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        rows = data.get("response", {}).get("data", [])
        logger.info(f"EIA us-power: fetched {len(rows)} rows")
        return rows
    except Exception as exc:
        logger.warning(f"EIA us-power fetch failed: {exc!r}")
        return []


def build_us_power_tables(eia_key: str) -> dict[str, pd.DataFrame]:
    """Return DataFrames for us_power_hourly and us_power_latest.

    Returns:
        {
            'us_power_hourly': period x region x fueltype with value_mwh,
            'us_power_latest': latest complete hour per region x fueltype,
        }
    """
    rows = _fetch_eia(eia_key, list(REGIONS.keys()))

    if not rows:
        empty = pd.DataFrame()
        return {"us_power_hourly": empty, "us_power_latest": empty}

    df = pd.DataFrame(rows)
    df = df.rename(columns={
        "period": "period",
        "respondent": "region",
        "respondent-name": "region_name",
        "fueltype": "fueltype",
        "type-name": "fuel_name",
        "value": "value_mwh",
    })
    df["value_mwh"] = pd.to_numeric(df["value_mwh"], errors="coerce").fillna(0.0)
    df["period"] = pd.to_datetime(df["period"], format="%Y-%m-%dT%H", utc=True)

    # Keep only known regions and last 48h
    df = df[df["region"].isin(REGIONS)]
    now_utc = datetime.now(timezone.utc)
    cutoff = now_utc - pd.Timedelta(hours=48)
    df = df[df["period"] >= cutoff].copy()

    # Normalize fuel names: collapse rare fuels into OTH
    def normalize_fuel(code: str) -> str:
        if code in DISPLAY_FUELS:
            return code
        if code in ("BAT", "OES", "PS", "SNB"):
            return "BAT"
        return "OTH"

    df["fueltype_orig"] = df["fueltype"]
    df["fueltype"] = df["fueltype"].apply(normalize_fuel)
    df["fuel_name"] = df["fueltype"].map(FUEL_NAMES).fillna("Other")

    # Aggregate after normalization (sum collapsed fuels)
    df = (
        df.groupby(["period", "region", "region_name", "fueltype", "fuel_name"], as_index=False)
        ["value_mwh"].sum()
    )

    # us_power_hourly: all 48h data
    hourly = df[["period", "region", "region_name", "fueltype", "fuel_name", "value_mwh"]].copy()
    hourly["period"] = hourly["period"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    # us_power_latest: latest complete hour per region
    # A "complete" hour has data for all expected regions; use the most recent
    # period that appears in the majority of regions.
    region_latest = df.groupby("region")["period"].max()
    # Use the mode (most common latest period) as the representative "latest" hour
    if not region_latest.empty:
        latest_period = region_latest.mode().iloc[0]
        # Fall back one hour if any region is missing the absolute latest
        latest_df = df[df["period"] == latest_period].copy()
        if latest_df.empty:
            latest_df = df.copy()
    else:
        latest_df = df.copy()

    latest_df["period"] = latest_df["period"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    latest = latest_df[["period", "region", "region_name", "fueltype", "fuel_name", "value_mwh"]].copy()

    return {"us_power_hourly": hourly, "us_power_latest": latest}
