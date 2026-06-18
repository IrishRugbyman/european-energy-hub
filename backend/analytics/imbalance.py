"""German reBAP imbalance price analytics.

Reads imbalance_prices_de from PostgreSQL market_data.
Sign convention: long_eur_mwh == short_eur_mwh in the SMARD dataset (single settlement price).

Tables produced for energy_hub.duckdb:
  imbalance_recent         - trailing 10 days of 15-min prices
  imbalance_daily          - trailing 2 years of daily aggregates (mean/min/max)
  imbalance_latest         - most recent 15-min snapshot + today's stats
  imbalance_hourly_profile - 90-day avg/p25/p75/neg_pct by hour-of-day (24 rows)
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn


def build_imbalance_tables() -> dict[str, pd.DataFrame]:
    """Return imbalance DataFrames ready for energy_hub.duckdb."""
    empty_recent = pd.DataFrame(columns=["ts", "rebap_eur_mwh"])
    empty_daily = pd.DataFrame(columns=["price_date", "mean_eur", "min_eur", "max_eur", "count"])
    empty_latest = pd.DataFrame(columns=["current_ts", "rebap_eur_mwh", "today_mean", "today_min", "today_max"])

    conn = get_read_conn()
    try:
        raw = _query(
            conn,
            """
            SELECT ts, long_eur_mwh AS rebap_eur_mwh
            FROM imbalance_prices_de
            WHERE long_eur_mwh IS NOT NULL
            ORDER BY ts
            """,
        )
    finally:
        conn.close()

    if raw.empty:
        return {
            "imbalance_recent": empty_recent,
            "imbalance_daily": empty_daily,
            "imbalance_latest": empty_latest,
        }

    raw["ts"] = pd.to_datetime(raw["ts"])
    raw["rebap_eur_mwh"] = pd.to_numeric(raw["rebap_eur_mwh"], errors="coerce")

    max_ts = raw["ts"].max()
    cutoff_recent = max_ts - pd.Timedelta(days=10)

    imbalance_recent = raw[raw["ts"] >= cutoff_recent].copy()
    imbalance_recent["ts"] = imbalance_recent["ts"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    cutoff_daily = max_ts - pd.Timedelta(days=730)
    hist = raw[raw["ts"] >= cutoff_daily].copy()
    hist["price_date"] = hist["ts"].dt.normalize()
    imbalance_daily = (
        hist.groupby("price_date")["rebap_eur_mwh"]
        .agg(mean_eur="mean", min_eur="min", max_eur="max", count="count")
        .reset_index()
    )
    imbalance_daily["mean_eur"] = imbalance_daily["mean_eur"].round(2)
    imbalance_daily["min_eur"] = imbalance_daily["min_eur"].round(2)
    imbalance_daily["max_eur"] = imbalance_daily["max_eur"].round(2)
    imbalance_daily["price_date"] = imbalance_daily["price_date"].dt.strftime("%Y-%m-%d")

    latest_row = raw.iloc[-1]
    today_str = latest_row["ts"].strftime("%Y-%m-%d")
    today_rows = raw[raw["ts"].dt.strftime("%Y-%m-%d") == today_str]["rebap_eur_mwh"]
    imbalance_latest = pd.DataFrame([{
        "current_ts": latest_row["ts"].strftime("%Y-%m-%dT%H:%M:%S"),
        "rebap_eur_mwh": round(float(latest_row["rebap_eur_mwh"]), 2),
        "today_mean": round(float(today_rows.mean()), 2) if not today_rows.empty else None,
        "today_min": round(float(today_rows.min()), 2) if not today_rows.empty else None,
        "today_max": round(float(today_rows.max()), 2) if not today_rows.empty else None,
    }])

    # 90-day hourly reBAP profile (CET hour 0-23)
    cutoff_profile = max_ts - pd.Timedelta(days=90)
    profile_raw = raw[raw["ts"] >= cutoff_profile].copy()
    # Convert to CET (Europe/Berlin)
    profile_raw["ts_cet"] = profile_raw["ts"].dt.tz_localize("UTC").dt.tz_convert("Europe/Berlin")
    profile_raw["hour"] = profile_raw["ts_cet"].dt.hour

    if not profile_raw.empty:
        agg = (
            profile_raw.groupby("hour")["rebap_eur_mwh"]
            .agg(
                avg_eur="mean",
                p25_eur=lambda x: float(x.quantile(0.25)),
                p75_eur=lambda x: float(x.quantile(0.75)),
            )
            .reset_index()
        )
        neg_pct = (
            profile_raw.assign(is_neg=profile_raw["rebap_eur_mwh"] < 0)
            .groupby("hour")["is_neg"]
            .mean()
            .mul(100)
            .reset_index()
            .rename(columns={"is_neg": "neg_pct"})
        )
        imbalance_hourly_profile = agg.merge(neg_pct, on="hour")
        for col in ["avg_eur", "p25_eur", "p75_eur", "neg_pct"]:
            imbalance_hourly_profile[col] = imbalance_hourly_profile[col].round(2)
    else:
        imbalance_hourly_profile = pd.DataFrame(
            columns=["hour", "avg_eur", "p25_eur", "p75_eur", "neg_pct"]
        )

    return {
        "imbalance_recent": imbalance_recent,
        "imbalance_daily": imbalance_daily,
        "imbalance_latest": imbalance_latest,
        "imbalance_hourly_profile": imbalance_hourly_profile,
    }
