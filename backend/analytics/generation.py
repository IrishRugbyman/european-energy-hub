"""Generation mix analytics from power_generation_actual (ENTSO-E A75 full fuel mix).

Tables produced for energy_hub.duckdb:
  generation_daily         - daily avg MW per fuel per zone, 2021-present
  generation_hourly_recent - last 10 days of hourly mix per zone
  generation_latest        - most recent generation_daily row per zone

Wind is stored as wind_onshore + wind_offshore in the source table; we merge
them here into a single 'wind' column. Nuclear and fossil fuels (coal, gas, oil)
are included. renewable_pct = (solar + wind + hydro + biomass) / total_mw.
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn

# Fuel types stored in power_generation_actual after fetch_generation_full
_SOURCE_TECHS = (
    "biomass",
    "coal",
    "gas",
    "geothermal",
    "hydro",
    "nuclear",
    "oil",
    "other",
    "solar",
    "wind_onshore",
    "wind_offshore",
)

# Output fuel columns (wind_onshore + wind_offshore merged into wind)
FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "nuclear", "oil", "other", "solar", "wind")

RENEWABLE_COLS = ("solar", "wind", "hydro")


def build_generation_tables() -> dict[str, pd.DataFrame]:
    """Return all three generation DataFrames ready for energy_hub.duckdb."""
    daily = _build_generation_daily()
    hourly_recent = _build_generation_hourly_recent()
    latest = _build_generation_latest_from_daily(daily)
    return {
        "generation_daily": daily,
        "generation_hourly_recent": hourly_recent,
        "generation_latest": latest,
    }


def _pivot_and_merge_wind(df: pd.DataFrame, ts_col: str) -> pd.DataFrame:
    """Pivot long (zone, ts_col, tech, mw) -> wide per-fuel columns, merge wind."""
    if df.empty:
        return df

    wide = df.pivot_table(index=["zone", ts_col], columns="tech", values="mw", aggfunc="sum")
    wide.columns.name = None
    wide = wide.reset_index()

    # Merge wind variants
    wind_cols = [c for c in ("wind_onshore", "wind_offshore") if c in wide.columns]
    wide["wind"] = wide[wind_cols].sum(axis=1) if wind_cols else 0.0
    wide = wide.drop(columns=wind_cols, errors="ignore")

    # Ensure all FUEL_COLS exist (zero-fill missing fuels)
    for col in FUEL_COLS:
        if col not in wide.columns:
            wide[col] = 0.0

    for col in FUEL_COLS:
        wide[col] = wide[col].fillna(0.0).round(1)

    wide["total_mw"] = wide[list(FUEL_COLS)].sum(axis=1)
    renewable_sum = wide[list(RENEWABLE_COLS)].sum(axis=1)
    wide["renewable_pct"] = (
        renewable_sum / wide["total_mw"].replace(0, float("nan")) * 100
    ).round(1)
    return wide


def _empty_daily() -> pd.DataFrame:
    return pd.DataFrame(columns=["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"])


def _empty_hourly() -> pd.DataFrame:
    return pd.DataFrame(columns=["zone", "ts"] + list(FUEL_COLS))


def _build_generation_daily() -> pd.DataFrame:
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT
                zone,
                DATE_TRUNC('day', ts)::DATE AS gen_date,
                tech,
                AVG(mw) AS mw
            FROM power_generation_actual
            GROUP BY zone, gen_date, tech
            ORDER BY zone, gen_date, tech
            """,
        )
        conn.close()
    except Exception:
        return _empty_daily()

    if df.empty:
        return _empty_daily()

    wide = _pivot_and_merge_wind(df, "gen_date")
    wide["gen_date"] = wide["gen_date"].astype(str)
    cols = ["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]
    return wide[[c for c in cols if c in wide.columns]].copy()


def _build_generation_hourly_recent() -> pd.DataFrame:
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT zone, ts, tech, mw
            FROM power_generation_actual
            WHERE ts >= NOW() - INTERVAL '10 days'
            ORDER BY zone, ts, tech
            """,
        )
        conn.close()
    except Exception:
        return _empty_hourly()

    if df.empty:
        return _empty_hourly()

    wide = _pivot_and_merge_wind(df, "ts")
    fuel_present = [c for c in FUEL_COLS if c in wide.columns]
    return wide[["zone", "ts"] + fuel_present].copy()


def _build_generation_latest_from_daily(daily: pd.DataFrame) -> pd.DataFrame:
    if daily.empty:
        return _empty_daily()
    idx = daily.groupby("zone")["gen_date"].idxmax()
    return daily.loc[idx].reset_index(drop=True)
