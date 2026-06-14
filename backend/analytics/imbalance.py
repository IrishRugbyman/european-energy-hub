"""German reBAP imbalance price analytics.

Reads imbalance_prices_de from PostgreSQL market_data.
Sign convention: long_eur_mwh == short_eur_mwh in the SMARD dataset (single settlement price).

Tables produced for energy_hub.duckdb:
  imbalance_recent  - trailing 10 days of 15-min prices
  imbalance_daily   - trailing 2 years of daily aggregates (mean/min/max)
  imbalance_latest  - most recent 15-min snapshot + today's stats
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

    return {
        "imbalance_recent": imbalance_recent,
        "imbalance_daily": imbalance_daily,
        "imbalance_latest": imbalance_latest,
    }
