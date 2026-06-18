"""Power price analytics: daily base/peak/offpeak, recent hourly, latest snapshot.

Reads power_prices from the PostgreSQL market_data database; the rest is
pure-function transforms on DataFrames.
Peak hours: 08-19 local time (standard European market convention, hour-beginning).
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn


def build_power_tables() -> dict[str, pd.DataFrame]:
    """Return three DataFrames ready to write into energy_hub.duckdb.

    Returns:
        power_daily:         daily base/peak/offpeak/range/neg_hours per zone, trailing 2 years
        power_hourly_recent: hourly prices per zone, trailing 8 days
        power_latest:        one row per zone with current base + stats + percentile rank
    """
    conn = get_read_conn()
    try:
        raw = _query(
            conn,
            """
            SELECT
                ts,
                bidding_zone AS zone,
                price_eur_mwh
            FROM power_prices
            WHERE ts >= current_date - INTERVAL '2 years' - INTERVAL '35 days'
            ORDER BY zone, ts
            """,
        )
    finally:
        conn.close()

    if raw.empty:
        empty_daily = pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "offpeak_eur", "day_range_eur", "neg_hours", "min_eur", "max_eur"])
        empty_hourly = pd.DataFrame(columns=["zone", "ts", "price_eur_mwh"])
        empty_latest = pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "vs_30d_pct", "day_range_eur", "neg_hours", "pct_rank_2yr"])
        return {"power_daily": empty_daily, "power_hourly_recent": empty_hourly, "power_latest": empty_latest}

    raw["ts"] = pd.to_datetime(raw["ts"])

    power_daily = _build_daily(raw)
    power_hourly_recent = _build_hourly_recent(raw)
    power_latest = _build_latest(power_daily)
    power_hourly_profiles = _build_hourly_profiles(raw)

    return {
        "power_daily": power_daily,
        "power_hourly_recent": power_hourly_recent,
        "power_latest": power_latest,
        "power_hourly_profiles": power_hourly_profiles,
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
    prices = g["price_eur_mwh"]
    n = len(g)
    has_data = n >= 20
    # Count distinct clock-hours with a negative price; robust to sub-hourly resolution.
    neg_mask = prices < 0
    neg_hours_val = int(g.loc[neg_mask, "ts"].dt.floor("h").nunique()) if neg_mask.any() else 0
    # Key order must match the power_daily DuckDB schema: base, peak, offpeak, day_range, neg_hours, min, max
    return pd.Series({
        "base_eur":     prices.mean() if has_data else None,
        "peak_eur":     peak.mean() if len(peak) >= 8 else None,
        "offpeak_eur":  offpeak.mean() if len(offpeak) >= 8 else None,
        "day_range_eur": round(float(prices.max() - prices.min()), 2) if has_data else None,
        "neg_hours":    neg_hours_val,
        "min_eur":      round(float(prices.min()), 2) if has_data else None,
        "max_eur":      round(float(prices.max()), 2) if has_data else None,
    })


def _build_hourly_recent(df: pd.DataFrame) -> pd.DataFrame:
    cutoff = pd.Timestamp.now() - pd.Timedelta(days=8)
    recent = df[df["ts"] >= cutoff][["zone", "ts", "price_eur_mwh"]].copy()
    recent["ts"] = recent["ts"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    return recent.reset_index(drop=True)


def _build_latest(daily: pd.DataFrame) -> pd.DataFrame:
    if daily.empty:
        return pd.DataFrame(columns=["zone", "price_date", "base_eur", "peak_eur", "vs_30d_pct", "day_range_eur", "neg_hours", "pct_rank_2yr"])

    daily["price_date"] = pd.to_datetime(daily["price_date"]).dt.date

    rows = []
    for zone, zdf in daily.groupby("zone"):
        zdf = zdf.dropna(subset=["base_eur"]).sort_values("price_date")
        if zdf.empty:
            continue

        latest_row = zdf.iloc[-1]
        latest_date = latest_row["price_date"]
        latest_base = float(latest_row["base_eur"])

        hist = zdf[zdf["price_date"] < latest_date]

        cutoff_30 = pd.Timestamp(latest_date) - pd.Timedelta(days=30)
        hist_30 = hist[pd.to_datetime(hist["price_date"]) >= cutoff_30]
        mean_30 = hist_30["base_eur"].mean() if len(hist_30) >= 10 else None
        vs_30d = ((latest_base - mean_30) / mean_30 * 100) if mean_30 and mean_30 != 0 else None

        # percentile rank: fraction of 2yr history below today's price
        hist_2yr = hist["base_eur"].dropna()
        pct_rank_2yr = (
            round(float((hist_2yr < latest_base).sum() / len(hist_2yr) * 100), 1)
            if len(hist_2yr) >= 30
            else None
        )

        rows.append({
            "zone": zone,
            "price_date": latest_date,
            "base_eur": round(latest_base, 2),
            "peak_eur": round(float(latest_row["peak_eur"]), 2) if latest_row.get("peak_eur") is not None else None,
            "vs_30d_pct": round(float(vs_30d), 1) if vs_30d is not None else None,
            "day_range_eur": round(float(latest_row["day_range_eur"]), 2) if latest_row.get("day_range_eur") is not None else None,
            "neg_hours": int(latest_row["neg_hours"]) if latest_row.get("neg_hours") is not None else 0,
            "pct_rank_2yr": pct_rank_2yr,
        })

    return pd.DataFrame(rows)


def _build_hourly_profiles(df: pd.DataFrame) -> pd.DataFrame:
    """Compute average 24-hour price profile per zone from last 90 days (CET local time)."""
    cutoff = df["ts"].max() - pd.Timedelta(days=90)
    recent = df[df["ts"] >= cutoff].copy()
    if recent.empty:
        return pd.DataFrame(columns=["zone", "hour", "avg_eur", "p25_eur", "p75_eur", "neg_pct"])

    # Convert UTC timestamps to CET (Europe/Paris) and extract hour
    recent["ts_cet"] = recent["ts"].dt.tz_localize("UTC").dt.tz_convert("Europe/Paris")
    recent["hour"] = recent["ts_cet"].dt.hour
    recent["is_neg"] = (recent["price_eur_mwh"] < 0).astype(float)

    rows = []
    for (zone, hour), grp in recent.groupby(["zone", "hour"], sort=True):
        p = grp["price_eur_mwh"].dropna()
        if p.empty:
            continue
        rows.append({
            "zone": zone,
            "hour": int(hour),
            "avg_eur": round(float(p.mean()), 2),
            "p25_eur": round(float(p.quantile(0.25)), 2),
            "p75_eur": round(float(p.quantile(0.75)), 2),
            "neg_pct": round(float(grp["is_neg"].mean() * 100), 1),
        })

    return pd.DataFrame(rows)
