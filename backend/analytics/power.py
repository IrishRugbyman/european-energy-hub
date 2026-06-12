"""Power price analytics: daily base/peak/offpeak, recent hourly, latest snapshot.

All pure-function transforms on DataFrames from commo.duckdb. No IO here.
Peak hours: 08-19 local time (standard European market convention, hour-beginning).
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd


def build_power_tables(commo_db: Path) -> dict[str, pd.DataFrame]:
    """Return three DataFrames ready to write into energy_hub.duckdb.

    Returns:
        power_daily:         daily base/peak/offpeak per zone, trailing 2 years
        power_hourly_recent: hourly prices per zone, trailing 8 days
        power_latest:        one row per zone with current base + vs-30d stats
    """
    con = duckdb.connect(str(commo_db), read_only=True)
    try:
        raw = con.execute("""
            SELECT
                ts,
                bidding_zone AS zone,
                price_eur_mwh
            FROM power_prices
            WHERE ts >= current_date - INTERVAL '2 years' - INTERVAL '35 days'
            ORDER BY zone, ts
        """).df()
    finally:
        con.close()

    if raw.empty:
        empty_daily = pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "offpeak_eur"])
        empty_hourly = pd.DataFrame(columns=["zone", "ts", "price_eur_mwh"])
        empty_latest = pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "vs_30d_pct"])
        return {"power_daily": empty_daily, "power_hourly_recent": empty_hourly, "power_latest": empty_latest}

    raw["ts"] = pd.to_datetime(raw["ts"])

    power_daily = _build_daily(raw)
    power_hourly_recent = _build_hourly_recent(raw)
    power_latest = _build_latest(power_daily)

    return {
        "power_daily": power_daily,
        "power_hourly_recent": power_hourly_recent,
        "power_latest": power_latest,
    }


def _build_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate hourly prices to daily base/peak/offpeak per zone.

    Peak = hours 08-19 inclusive (hour-beginning convention: 08:00-19:00,
    i.e. the 12 hours from start-of-hour-8 through end-of-hour-18).
    Offpeak = remaining 12 hours.
    """
    df = df.copy()
    df["price_date"] = df["ts"].dt.date
    df["hour"] = df["ts"].dt.hour
    # Peak: hours 8 through 19 (08:00 to 19:00 start-of-hour, 12 hours)
    df["is_peak"] = df["hour"].between(8, 19)

    cutoff = pd.Timestamp.now().normalize() - pd.Timedelta(days=2 * 365 + 35)

    agg = (
        df[df["ts"] >= cutoff]
        .groupby(["zone", "price_date"])
        .apply(_daily_agg, include_groups=False)
        .reset_index()
    )

    return agg.rename(columns={"price_date": "price_date"})


def _daily_agg(g: pd.DataFrame) -> pd.Series:
    peak = g.loc[g["is_peak"], "price_eur_mwh"]
    offpeak = g.loc[~g["is_peak"], "price_eur_mwh"]
    return pd.Series({
        "base_eur": g["price_eur_mwh"].mean() if len(g) >= 20 else None,
        "peak_eur": peak.mean() if len(peak) >= 8 else None,
        "offpeak_eur": offpeak.mean() if len(offpeak) >= 8 else None,
    })


def _build_hourly_recent(df: pd.DataFrame) -> pd.DataFrame:
    cutoff = pd.Timestamp.now() - pd.Timedelta(days=8)
    recent = df[df["ts"] >= cutoff][["zone", "ts", "price_eur_mwh"]].copy()
    recent["ts"] = recent["ts"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    return recent.reset_index(drop=True)


def _build_latest(daily: pd.DataFrame) -> pd.DataFrame:
    if daily.empty:
        return pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "vs_30d_pct"])

    today = pd.Timestamp.now().normalize().date()
    # Latest date with a full day of data (allow up to 2 days lag)
    daily["price_date"] = pd.to_datetime(daily["price_date"]).dt.date

    rows = []
    for zone, zdf in daily.groupby("zone"):
        zdf = zdf.dropna(subset=["base_eur"]).sort_values("price_date")
        if zdf.empty:
            continue

        latest_row = zdf.iloc[-1]
        latest_date = latest_row["price_date"]

        # vs 30-day trailing mean (excluding latest day to avoid look-ahead)
        cutoff_30 = pd.Timestamp(latest_date) - pd.Timedelta(days=30)
        hist = zdf[zdf["price_date"] < latest_date]
        hist_30 = hist[pd.to_datetime(hist["price_date"]) >= cutoff_30]

        mean_30 = hist_30["base_eur"].mean() if len(hist_30) >= 10 else None
        vs_30d = (
            ((latest_row["base_eur"] - mean_30) / mean_30 * 100)
            if mean_30 and mean_30 != 0
            else None
        )

        rows.append({
            "zone": zone,
            "price_date": latest_date,
            "base_eur": round(float(latest_row["base_eur"]), 2) if latest_row["base_eur"] is not None else None,
            "peak_eur": round(float(latest_row["peak_eur"]), 2) if latest_row["peak_eur"] is not None else None,
            "vs_30d_pct": round(float(vs_30d), 1) if vs_30d is not None else None,
        })

    return pd.DataFrame(rows)
