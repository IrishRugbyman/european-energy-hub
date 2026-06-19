"""Gas storage analytics: seasonal band, latest snapshot, EU aggregate.

Reads gas_storage from the PostgreSQL market_data database; the rest is
pure-function transforms on DataFrames.
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn


def build_storage_tables() -> dict[str, pd.DataFrame]:
    """Return DataFrames ready to write into energy_hub.duckdb.

    Returns: {
        'storage_history': long-format daily series per country + EU,
        'storage_seasonal': 5-year DOY fill% band per country + EU,
        'storage_latest': one row per country + EU with derived stats,
        'storage_injection_seasonal': 5-year DOY injection-rate band per country + EU,
    }
    """
    conn = get_read_conn()
    raw = _query(
        conn,
        """
        SELECT country, gas_day, "full" AS full_pct, injection, withdrawal, working_gas_volume
        FROM gas_storage
        WHERE "full" IS NOT NULL
        ORDER BY country, gas_day
        """,
    )
    conn.close()

    if raw.empty:
        empty = pd.DataFrame()
        return {
            "storage_history": empty,
            "storage_seasonal": empty,
            "storage_latest": empty,
            "storage_injection_seasonal": empty,
        }

    raw["gas_day"] = pd.to_datetime(raw["gas_day"]).dt.date

    # EU aggregate (working-gas-volume weighted fill)
    eu = _build_eu_aggregate(raw)
    combined = pd.concat([raw, eu], ignore_index=True)

    history = combined[["country", "gas_day", "full_pct", "injection", "withdrawal", "working_gas_volume"]].copy()

    seasonal = _build_seasonal(combined)
    latest = _build_latest(combined, seasonal)
    injection_seasonal = _build_injection_seasonal(combined)

    return {
        "storage_history": history,
        "storage_seasonal": seasonal,
        "storage_latest": latest,
        "storage_injection_seasonal": injection_seasonal,
    }


def _build_eu_aggregate(df: pd.DataFrame) -> pd.DataFrame:
    """Working-gas-volume-weighted EU aggregate."""
    df2 = df.dropna(subset=["working_gas_volume", "full_pct"]).copy()
    df2 = df2[df2["working_gas_volume"] > 0]

    grp = df2.groupby("gas_day")
    eu_rows = []
    for day, g in grp:
        wgv_total = g["working_gas_volume"].sum()
        # full_pct is already a 0-100 percentage of capacity; compute capacity-weighted mean
        weighted_full = (g["full_pct"] * g["working_gas_volume"]).sum() / wgv_total if wgv_total > 0 else None
        eu_rows.append({
            "country": "EU",
            "gas_day": day,
            "full_pct": weighted_full,
            "injection": g["injection"].sum(),
            "withdrawal": g["withdrawal"].sum(),
            "working_gas_volume": wgv_total,
        })
    return pd.DataFrame(eu_rows)


def _build_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year DOY band per country.

    Uses the 5 most recent complete calendar years (Jan 1 - Dec 31 with data).
    """
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["doy"] = df["gas_day"].dt.dayofyear

    current_year = pd.Timestamp.now().year
    # Complete calendar years only
    complete_years = sorted(
        [y for y in df["year"].unique() if y < current_year],
        reverse=True,
    )[:5]

    if not complete_years:
        return pd.DataFrame(columns=["country", "doy", "avg5", "min5", "max5"])

    band_df = df[df["year"].isin(complete_years)].copy()
    seasonal = (
        band_df.groupby(["country", "doy"])["full_pct"]
        .agg(avg5="mean", min5="min", max5="max")
        .reset_index()
    )
    seasonal = seasonal.dropna(subset=["avg5"])
    return seasonal


def _build_injection_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year DOY injection-rate band per country.

    Uses the 5 most recent complete calendar years (same as _build_seasonal).
    Only includes days where injection > 0 (i.e., injection season; winter withdrawal is excluded).
    Returns (country, doy, avg_gwh_d, p25_gwh_d, p75_gwh_d).
    """
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["doy"] = df["gas_day"].dt.dayofyear

    current_year = pd.Timestamp.now().year
    complete_years = sorted(
        [y for y in df["year"].unique() if y < current_year],
        reverse=True,
    )[:5]

    if not complete_years:
        return pd.DataFrame(columns=["country", "doy", "avg_gwh_d", "p25_gwh_d", "p75_gwh_d"])

    band_df = df[df["year"].isin(complete_years)].copy()
    # Include all days (injection=0 during withdrawal season is valid data)
    band_df = band_df.dropna(subset=["injection"])

    if band_df.empty:
        return pd.DataFrame(columns=["country", "doy", "avg_gwh_d", "p25_gwh_d", "p75_gwh_d"])

    seasonal = (
        band_df.groupby(["country", "doy"])["injection"]
        .agg(
            avg_gwh_d="mean",
            p25_gwh_d=lambda x: x.quantile(0.25),
            p75_gwh_d=lambda x: x.quantile(0.75),
        )
        .reset_index()
    )
    seasonal = seasonal.dropna(subset=["avg_gwh_d"])
    return seasonal


def _build_latest(df: pd.DataFrame, seasonal: pd.DataFrame) -> pd.DataFrame:
    """One row per country/EU with current fill + deltas."""
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])

    rows = []
    for country, grp in df.groupby("country"):
        grp = grp.sort_values("gas_day")
        if grp.empty:
            continue
        latest_row = grp.iloc[-1]
        latest_day = latest_row["gas_day"]
        latest_full = latest_row["full_pct"]

        # 7-day change
        past7 = grp[grp["gas_day"] <= latest_day - pd.Timedelta(days=7)]
        d7_pct = (latest_full - past7.iloc[-1]["full_pct"]) if not past7.empty else None

        # YoY
        past_yoy = grp[grp["gas_day"] <= latest_day - pd.Timedelta(days=365)]
        yoy_pct = (latest_full - past_yoy.iloc[-1]["full_pct"]) if not past_yoy.empty else None

        # vs 5yr average
        doy = latest_day.dayofyear
        sea = seasonal[(seasonal["country"] == country) & (seasonal["doy"] == doy)]
        vs_avg5_pct = (latest_full - float(sea["avg5"].iloc[0])) if not sea.empty else None

        rows.append({
            "country": country,
            "gas_day": latest_day.date(),
            "full_pct": latest_full,
            "d7_pct": d7_pct,
            "vs_avg5_pct": vs_avg5_pct,
            "yoy_pct": yoy_pct,
            "injection": latest_row["injection"],
            "withdrawal": latest_row["withdrawal"],
            "working_gas_volume": latest_row["working_gas_volume"],
        })

    return pd.DataFrame(rows)
