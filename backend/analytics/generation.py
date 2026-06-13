"""Generation mix analytics from rebase_generation (Rebase Grid API).

Tables produced for energy_hub.duckdb:
  generation_daily        - daily avg MW per fuel per zone, 2019-present
  generation_hourly_recent - last 10 days of hourly mix per zone
  generation_latest       - most recent generation_daily row per zone
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

RENEWABLE_COLS = ("solar", "wind", "hydro")
FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "oil", "solar", "unknown", "wind")


def build_generation_tables(commo_db: Path) -> dict[str, pd.DataFrame]:
    """Return all three generation DataFrames ready for energy_hub.duckdb."""
    db = str(commo_db)
    daily = _build_generation_daily(db)
    hourly_recent = _build_generation_hourly_recent(db)
    latest = _build_generation_latest_from_daily(daily)
    return {
        "generation_daily": daily,
        "generation_hourly_recent": hourly_recent,
        "generation_latest": latest,
    }


def _open(db: str):
    import duckdb
    return duckdb.connect(db, read_only=True)


def _empty_fuel_df(extra_cols: list[str]) -> pd.DataFrame:
    return pd.DataFrame(columns=["zone"] + extra_cols + list(FUEL_COLS) + ["renewable_pct", "total_mw"])


def _add_renewable_stats(df: pd.DataFrame) -> pd.DataFrame:
    for col in FUEL_COLS:
        if col in df.columns:
            df[col] = df[col].fillna(0.0).round(1)
    df["total_mw"] = df[list(FUEL_COLS)].sum(axis=1)
    renewable_sum = df[list(RENEWABLE_COLS)].sum(axis=1)
    df["renewable_pct"] = (
        renewable_sum / df["total_mw"].replace(0, float("nan")) * 100
    ).round(1)
    return df


def _build_generation_daily(db: str) -> pd.DataFrame:
    """Daily average MW per fuel per zone for the full available history."""
    empty = _empty_fuel_df(["gen_date"])
    try:
        con = _open(db)
        df = con.execute("""
            SELECT
                zone,
                ts::DATE AS gen_date,
                AVG(biomass)    AS biomass,
                AVG(coal)       AS coal,
                AVG(gas)        AS gas,
                AVG(geothermal) AS geothermal,
                AVG(hydro)      AS hydro,
                AVG(oil)        AS oil,
                AVG(solar)      AS solar,
                AVG(unknown)    AS unknown,
                AVG(wind)       AS wind
            FROM rebase_generation
            GROUP BY zone, gen_date
            ORDER BY zone, gen_date
        """).df()
        con.close()
    except Exception:
        return empty

    if df.empty:
        return empty

    df = _add_renewable_stats(df)
    df["gen_date"] = df["gen_date"].astype(str)
    return df[["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]].copy()


def _build_generation_hourly_recent(db: str) -> pd.DataFrame:
    """Last 10 days of hourly generation mix per zone."""
    empty = pd.DataFrame(columns=["zone", "ts"] + list(FUEL_COLS))
    try:
        con = _open(db)
        df = con.execute("""
            SELECT
                zone,
                ts,
                biomass, coal, gas, geothermal, hydro, oil, solar, unknown, wind
            FROM rebase_generation
            WHERE ts >= now() - interval '10 days'
            ORDER BY zone, ts
        """).df()
        con.close()
    except Exception:
        return empty

    if df.empty:
        return empty

    for col in FUEL_COLS:
        if col in df.columns:
            df[col] = df[col].fillna(0.0).round(1)
    return df[["zone", "ts"] + list(FUEL_COLS)].copy()


def _build_generation_latest_from_daily(daily: pd.DataFrame) -> pd.DataFrame:
    """Most recent generation_daily row per zone."""
    empty = pd.DataFrame(columns=["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"])
    if daily.empty:
        return empty

    idx = daily.groupby("zone")["gen_date"].idxmax()
    latest = daily.loc[idx].reset_index(drop=True)
    return latest[["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]].copy()
