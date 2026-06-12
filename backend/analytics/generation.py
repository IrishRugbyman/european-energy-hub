"""Generation mix analytics from rebase_generation (Rebase Grid API).

Builds generation_latest: one row per zone with today's average MW per fuel type
and a renewable_pct (wind + solar + hydro) for the latest available day.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pandas as pd

RENEWABLE_COLS = ("solar", "wind", "hydro")
FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "oil", "solar", "unknown", "wind")


def build_generation_tables(commo_db: Path) -> dict[str, pd.DataFrame]:
    """Return generation_latest DataFrame ready for energy_hub.duckdb."""
    gen_latest = _build_generation_latest(str(commo_db))
    return {"generation_latest": gen_latest}


def _build_generation_latest(db: str) -> pd.DataFrame:
    empty = pd.DataFrame(
        columns=["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]
    )
    try:
        import duckdb
        con = duckdb.connect(db, read_only=True)
        # For each zone, take the most recent day with data and average over its hours
        df = con.execute("""
            WITH latest_per_zone AS (
                SELECT zone, MAX(ts::DATE) AS gen_date
                FROM rebase_generation
                GROUP BY zone
            )
            SELECT
                r.zone,
                l.gen_date,
                AVG(r.biomass)    AS biomass,
                AVG(r.coal)       AS coal,
                AVG(r.gas)        AS gas,
                AVG(r.geothermal) AS geothermal,
                AVG(r.hydro)      AS hydro,
                AVG(r.oil)        AS oil,
                AVG(r.solar)      AS solar,
                AVG(r.unknown)    AS unknown,
                AVG(r.wind)       AS wind
            FROM rebase_generation r
            JOIN latest_per_zone l ON r.zone = l.zone AND r.ts::DATE = l.gen_date
            GROUP BY r.zone, l.gen_date
        """).df()
        con.close()
    except Exception:
        return empty

    if df.empty:
        return empty

    df["total_mw"] = df[list(FUEL_COLS)].fillna(0).sum(axis=1)
    renewable_sum = df[list(RENEWABLE_COLS)].fillna(0).sum(axis=1)
    df["renewable_pct"] = (renewable_sum / df["total_mw"].replace(0, float("nan")) * 100).round(1)
    df["gen_date"] = df["gen_date"].astype(str)
    for col in FUEL_COLS:
        df[col] = df[col].round(1)

    return df[["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]].copy()
