"""Hydro balance vs power price analytics.

The Nordic "hydrological balance" - how far reservoir storage sits above or
below its seasonal norm - is one of the most-watched fundamental drivers of
hydro-dominated power prices. When reservoirs are low for the time of year,
hydro producers withhold water (option value of waiting), the marginal unit
shifts toward thermal/imports, and prices rise; when reservoirs are brimming,
producers spill cheaply and prices fall.

This module quantifies that relationship per country: it joins the weekly
reservoir balance (stored vs 5-year same-week average, in %) against the
country's weekly mean day-ahead price, then fits price ~ balance and reports
the correlation, slope, and current standing. The correlation *magnitude*
itself is informative: strongly negative for hydro-set markets (NO, SE),
near zero for thermally-set markets where reservoir levels do not move price.

Source: hydro_reservoir + power_prices (PostgreSQL market_data).
Produces two energy_hub.duckdb tables:
  hydro_price_balance_summary - one row per country (corr, slope, current standing)
  hydro_price_balance_series  - trailing weekly balance% + price per country
"""

from __future__ import annotations

import datetime

import numpy as np
import pandas as pd
from loaders._base import _query, get_read_conn
from loguru import logger

# Hydro reporting country -> its day-ahead bidding zones. Country price is the
# simple cross-zone mean (no public demand weights), aligned to the weekly
# reservoir snapshot. Only countries with both reservoir and price coverage.
COUNTRY_ZONES: dict[str, list[str]] = {
    "NO": ["NO-1", "NO-2", "NO-3", "NO-4", "NO-5"],
    "SE": ["SE-1", "SE-2", "SE-3", "SE-4"],
    "FI": ["FI"],
    "ES": ["ES"],
    "PT": ["PT"],
    "FR": ["FR"],
    "IT": ["IT-NORD", "IT-CNOR", "IT-CSUD", "IT-SUD", "IT-CALA", "IT-SARD", "IT-SICI"],
    "AT": ["AT"],
    "CH": ["CH"],
    "RO": ["RO"],
    "GR": ["GR"],
}

# Weeks of trailing series to keep for the frontend chart (~3 years).
SERIES_WEEKS = 156


def build_hydro_price_balance() -> dict[str, pd.DataFrame]:
    """Return summary + series DataFrames ready for energy_hub.duckdb."""
    empty = {
        "hydro_price_balance_summary": pd.DataFrame(),
        "hydro_price_balance_series": pd.DataFrame(),
    }

    conn = get_read_conn()
    try:
        res = _query(
            conn,
            """
            SELECT country, week_date, stored_mwh
            FROM hydro_reservoir
            WHERE stored_mwh IS NOT NULL AND stored_mwh > 0
            ORDER BY country, week_date
            """,
        )
        all_zones = sorted({z for zs in COUNTRY_ZONES.values() for z in zs})
        prices = _query(
            conn,
            """
            SELECT bidding_zone AS zone,
                   CAST(ts AS DATE) AS price_date,
                   AVG(price_eur_mwh) AS base_eur
            FROM power_prices
            WHERE bidding_zone = ANY(%s)
              AND ts >= '2016-01-01'
            GROUP BY bidding_zone, CAST(ts AS DATE)
            """,
            (all_zones,),
        )
    finally:
        conn.close()

    if res.empty or prices.empty:
        return empty

    balance = _weekly_balance(res)
    weekly_price = _weekly_country_price(prices)
    if balance.empty or weekly_price.empty:
        return empty

    joined = balance.merge(weekly_price, on=["country", "iso_year", "iso_week"], how="inner")
    joined = joined.dropna(subset=["balance_pct", "price_eur"])
    if joined.empty:
        return empty

    summary = _build_summary(joined)
    series = _build_series(joined)
    return {
        "hydro_price_balance_summary": summary,
        "hydro_price_balance_series": series,
    }


def _weekly_balance(res: pd.DataFrame) -> pd.DataFrame:
    """Weekly reservoir balance per country: stored vs 5yr same-week mean (%)."""
    df = res.copy()
    df["week_date"] = pd.to_datetime(df["week_date"])
    df["stored_twh"] = df["stored_mwh"] / 1_000_000.0
    iso = df["week_date"].dt.isocalendar()
    df["iso_year"] = iso.year.astype(int)
    df["iso_week"] = iso.week.astype(int)

    current_year = datetime.date.today().year
    band_years = list(range(current_year - 6, current_year - 1))
    band = df[df["iso_year"].isin(band_years)]
    if band.empty:
        return pd.DataFrame()
    seasonal = (
        band.groupby(["country", "iso_week"])["stored_twh"].mean().rename("avg5_twh").reset_index()
    )

    out = df.merge(seasonal, on=["country", "iso_week"], how="inner")
    out = out[out["avg5_twh"] > 0].copy()
    out["balance_pct"] = (out["stored_twh"] - out["avg5_twh"]) / out["avg5_twh"] * 100.0
    return out[["country", "week_date", "iso_year", "iso_week", "stored_twh", "balance_pct"]]


def _weekly_country_price(prices: pd.DataFrame) -> pd.DataFrame:
    """Daily zone prices -> country daily mean -> ISO-week mean."""
    df = prices.copy()
    zone_to_country = {z: c for c, zs in COUNTRY_ZONES.items() for z in zs}
    df["country"] = df["zone"].map(zone_to_country)
    df = df.dropna(subset=["country"])

    # Country daily price = mean across that country's zones present that day.
    daily = df.groupby(["country", "price_date"])["base_eur"].mean().reset_index()
    daily["price_date"] = pd.to_datetime(daily["price_date"])
    iso = daily["price_date"].dt.isocalendar()
    daily["iso_year"] = iso.year.astype(int)
    daily["iso_week"] = iso.week.astype(int)

    weekly = (
        daily.groupby(["country", "iso_year", "iso_week"])
        .agg(price_eur=("base_eur", "mean"), days=("base_eur", "size"))
        .reset_index()
    )
    # Require a near-complete week so partial weeks do not distort the mean.
    weekly = weekly[weekly["days"] >= 5]
    return weekly[["country", "iso_year", "iso_week", "price_eur"]]


def _build_summary(joined: pd.DataFrame) -> pd.DataFrame:
    """One row per country: corr, OLS slope, R2, current standing, fitted price."""
    rows = []
    for country, g in joined.sort_values("week_date").groupby("country"):
        g = g.dropna(subset=["balance_pct", "price_eur"])
        if len(g) < 30:
            continue
        x = g["balance_pct"].to_numpy(dtype=float)
        y = g["price_eur"].to_numpy(dtype=float)
        if np.std(x) == 0 or np.std(y) == 0:
            continue
        corr = float(np.corrcoef(x, y)[0, 1])
        slope, intercept = np.polyfit(x, y, 1)
        r2 = corr * corr

        # Week-over-week differenced correlation: removes the shared slow trend
        # (post-crisis reservoir refill alongside falling prices) so this
        # isolates the genuine contemporaneous hydro -> price response. Only on
        # consecutive weeks (gap == 1) so non-adjacent weeks do not leak in.
        gd = g.copy()
        gd["wk"] = pd.to_datetime(gd["week_date"]).dt.to_period("W")
        dx = gd["balance_pct"].diff()
        dy = gd["price_eur"].diff()
        adj = (gd["wk"] - gd["wk"].shift(1)).apply(lambda p: getattr(p, "n", None) == 1)
        mask = adj & dx.notna() & dy.notna()
        if mask.sum() >= 30 and dx[mask].std() > 0 and dy[mask].std() > 0:
            corr_diff = round(float(np.corrcoef(dx[mask], dy[mask])[0, 1]), 3)
        else:
            corr_diff = None

        latest = g.iloc[-1]
        cur_bal = float(latest["balance_pct"])
        cur_price = float(latest["price_eur"])
        fitted = float(slope * cur_bal + intercept)
        residual = cur_price - fitted

        rows.append(
            {
                "country": country,
                "n_weeks": int(len(g)),
                "corr": round(corr, 3),
                "corr_diff": corr_diff,
                "r2": round(r2, 3),
                "slope_eur_per_pct": round(float(slope), 3),
                "latest_week": latest["week_date"].date().isoformat(),
                "current_balance_pct": round(cur_bal, 1),
                "current_price_eur": round(cur_price, 1),
                "fitted_price_eur": round(fitted, 1),
                "residual_eur": round(float(residual), 1),
            }
        )

    out = pd.DataFrame(rows)
    if not out.empty:
        # Most hydro-driven (most negative corr) first.
        out = out.sort_values("corr").reset_index(drop=True)
    logger.info(f"hydro price-balance summary: {len(out)} countries")
    return out


def _build_series(joined: pd.DataFrame) -> pd.DataFrame:
    """Trailing weekly balance% + price per country for charting."""
    out = []
    for country, g in joined.sort_values("week_date").groupby("country"):
        if len(g) < 30:
            continue
        tail = g.tail(SERIES_WEEKS)
        for _, r in tail.iterrows():
            out.append(
                {
                    "country": country,
                    "week_date": r["week_date"].date().isoformat(),
                    "balance_pct": round(float(r["balance_pct"]), 1),
                    "price_eur": round(float(r["price_eur"]), 1),
                }
            )
    return pd.DataFrame(out)
