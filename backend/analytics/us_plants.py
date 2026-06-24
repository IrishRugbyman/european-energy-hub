"""US natural gas power plants analytics.

Loads the pre-built plant dataset (from scripts/build_us_ng_plants.py,
sourced from cleanview.co + EIA API) into energy_hub.duckdb.

The JSON file is committed to the repo and updated manually when a fresh
data pull is needed (the EIA-860 updates annually; cleanview reflects it).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "us_ng_plants.json"


def build_us_plants_table() -> pd.DataFrame:
    """Load the plant JSON and return a DataFrame for DuckDB insertion."""
    if not DATA_PATH.exists():
        logger.warning(f"us_ng_plants.json not found at {DATA_PATH} - skipping plant layer")
        return pd.DataFrame()

    raw = json.loads(DATA_PATH.read_text())
    plants = raw.get("plants", [])
    if not plants:
        return pd.DataFrame()

    df = pd.DataFrame(plants)
    # Ensure correct dtypes
    for col in ["lat", "lon", "nameplate_mw", "gen_gwh"]:
        df[col] = pd.to_numeric(df.get(col), errors="coerce")
    for col in ["plant_id", "op_year"]:
        df[col] = pd.to_numeric(df.get(col), errors="coerce").astype("Int64")
    for col in ["name", "state", "county", "entity_name", "ba_code", "category", "cleanview_url"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str)

    logger.info(f"us_plants: {len(df)} plants loaded")
    return df
