"""Hydro reservoir analytics: seasonal band, latest snapshot by country.

Source: hydro_reservoir table in PostgreSQL market_data (ENTSO-E A72 weekly data).
Produces three energy_hub.duckdb tables:
  hydro_reservoir_history   - full weekly series per country in TWh
  hydro_reservoir_seasonal  - 5-year same-week band (avg/min/max) per country
  hydro_reservoir_latest    - most recent week per country with vs_avg5_pct / yoy_pct / rank
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from loaders._base import _query, get_read_conn
from loguru import logger

HYDRO_COUNTRIES = [
    "NO",
    "SE",
    "ES",
    "FI",
    "RO",
    "IT",
    "CH",
    "PT",
    "FR",
    "GR",
    "AT",
    "HR",
    "RS",
    "ME",
]


def build_hydro_tables() -> dict[str, pd.DataFrame]:
    """Return all hydro DataFrames ready for energy_hub.duckdb."""
    conn = get_read_conn()
    raw = _query(
        conn,
        """
        SELECT country, week_date, stored_mwh
        FROM hydro_reservoir
        WHERE stored_mwh IS NOT NULL AND stored_mwh > 0
        ORDER BY country, week_date
        """,
    )
    conn.close()

    if raw.empty:
        empty = pd.DataFrame()
        return {
            "hydro_reservoir_history": empty,
            "hydro_reservoir_seasonal": empty,
            "hydro_reservoir_latest": empty,
        }

    raw["week_date"] = pd.to_datetime(raw["week_date"]).dt.date
    raw["stored_twh"] = raw["stored_mwh"] / 1_000_000.0

    history = raw[["country", "week_date", "stored_twh"]].copy()

    seasonal = _build_seasonal(raw)
    latest = _build_latest(raw, seasonal)

    return {
        "hydro_reservoir_history": history,
        "hydro_reservoir_seasonal": seasonal,
        "hydro_reservoir_latest": latest,
    }


def _build_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year trailing same-week band per country.

    Uses calendar years Y-6 through Y-2 (5 full years, excluding the current
    partial year and the most recent full year to avoid recency anchoring).
    ISO week number 1-53.
    """
    import datetime

    current_year = datetime.date.today().year
    band_years = list(range(current_year - 6, current_year - 1))

    df2 = df.copy()
    df2["year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().year.astype(int)
    df2["week_of_year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().week.astype(int)
    band_df = df2[df2["year"].isin(band_years)].copy()

    if band_df.empty:
        return pd.DataFrame(columns=["country", "week_of_year", "avg5_twh", "min5_twh", "max5_twh"])

    return (
        band_df.groupby(["country", "week_of_year"])["stored_twh"]
        .agg(avg5_twh="mean", min5_twh="min", max5_twh="max")
        .reset_index()
    )


def _build_latest(df: pd.DataFrame, seasonal: pd.DataFrame) -> pd.DataFrame:
    """One row per country: most recent week + vs_avg5_pct / yoy_pct / rank5yr_pct."""
    import datetime

    current_year = datetime.date.today().year

    # Most recent week per country
    idx = df.groupby("country")["week_date"].idxmax()
    latest = df.loc[idx].copy()
    latest["week_of_year"] = pd.to_datetime(latest["week_date"]).dt.isocalendar().week.astype(int)

    # Merge seasonal avg
    if not seasonal.empty:
        latest = latest.merge(
            seasonal[["country", "week_of_year", "avg5_twh", "min5_twh", "max5_twh"]],
            on=["country", "week_of_year"],
            how="left",
        )
    else:
        latest["avg5_twh"] = np.nan
        latest["min5_twh"] = np.nan
        latest["max5_twh"] = np.nan

    # vs_avg5_pct
    def _vs_avg(row) -> float | None:
        if pd.isna(row["avg5_twh"]) or row["avg5_twh"] == 0:
            return None
        return round((row["stored_twh"] - row["avg5_twh"]) / row["avg5_twh"] * 100, 1)

    latest["vs_avg5_pct"] = latest.apply(_vs_avg, axis=1)

    # yoy_pct: same week prior year
    prior_year = current_year - 1
    df2 = df.copy()
    df2["year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().year.astype(int)
    df2["week_of_year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().week.astype(int)
    prior = df2[df2["year"] == prior_year][["country", "week_of_year", "stored_twh"]].rename(
        columns={"stored_twh": "prior_twh"}
    )
    latest = latest.merge(prior, on=["country", "week_of_year"], how="left")

    def _yoy(row) -> float | None:
        if pd.isna(row.get("prior_twh")) or row["prior_twh"] == 0:
            return None
        return round((row["stored_twh"] - row["prior_twh"]) / row["prior_twh"] * 100, 1)

    latest["yoy_pct"] = latest.apply(_yoy, axis=1)

    # rank5yr_pct: percentile within 5-year same-week distribution (0-100)
    band_years = list(range(current_year - 6, current_year - 1))
    hist_band = df2[df2["year"].isin(band_years)][["country", "week_of_year", "stored_twh"]]

    def _rank(row) -> float | None:
        woy = row["week_of_year"]
        cc = row["country"]
        vals = hist_band[(hist_band["country"] == cc) & (hist_band["week_of_year"] == woy)][
            "stored_twh"
        ]
        if vals.empty:
            return None
        below = (vals < row["stored_twh"]).sum()
        return round(below / len(vals) * 100, 1)

    latest["rank5yr_pct"] = latest.apply(_rank, axis=1)

    result = latest[
        ["country", "week_date", "stored_twh", "vs_avg5_pct", "yoy_pct", "rank5yr_pct"]
    ].copy()
    result["week_date"] = result["week_date"].astype(str)
    logger.info(f"hydro latest: {len(result)} countries")
    return result
