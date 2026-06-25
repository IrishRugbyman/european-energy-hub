"""Power price fundamental value models and signal analytics for European DA markets.

OLS regression of daily DA base price on gas (TTF), carbon (EUA), wind%, solar%.
Computes the fundamental fair value, residual (price vs fair value), and rolling
z-score of the residual -- the core input to a mean-reversion price signal.

Used by GET /api/spreads/fundamental-model.
Queries energy_hub.duckdb read-only via db.query() -- no refresh dependency.
"""

from __future__ import annotations

import logging
from typing import Callable

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Zones to expose the fundamental model for. DE-LU is the central hub.
FUNDAMENTAL_ZONES = ["DE-LU", "FR", "NL", "IT-NORD", "BE"]

# Rolling window for OLS fit (days)
OLS_WINDOW = 365

# Z-score lookback for the residual signal
ZSCORE_WINDOW = 30


def compute_fundamental_model(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Compute OLS fundamental value model for a zone.

    Joins power_daily + prices_daily + generation_daily, fits:
      base_eur = b0 + b1*TTF + b2*EUA + b3*wind_pct + b4*solar_pct + epsilon

    Args:
        query_fn: db.query callable (sql, params) -> pd.DataFrame
        zone: bidding zone code

    Returns a dict with:
      - coefficients: {b0, b1_ttf, b2_eua, b3_wind, b4_solar, r2}
      - series: list of {price_date, actual, fitted, residual, zscore}
      - current: latest signal statistics
    """
    try:
        rows = query_fn("""
            SELECT
                p.price_date,
                p.base_eur,
                pr.ttf_eur_mwh,
                pr.eua_eur_t,
                (g.wind / NULLIF(g.total_mw, 0)) * 100  AS wind_pct,
                (g.solar / NULLIF(g.total_mw, 0)) * 100 AS solar_pct
            FROM power_daily p
            JOIN prices_daily pr ON p.price_date = pr.price_date
            JOIN generation_daily g ON p.price_date = g.gen_date AND g.zone = p.zone
            WHERE p.zone = ?
              AND p.base_eur IS NOT NULL
              AND pr.ttf_eur_mwh IS NOT NULL
              AND pr.eua_eur_t IS NOT NULL
              AND g.total_mw > 0
              AND g.wind IS NOT NULL
              AND g.solar IS NOT NULL
            ORDER BY p.price_date
        """, [zone])
    except Exception as exc:
        logger.warning(f"fundamental model query failed for {zone}: {exc!r}")
        return {}
    if rows is None or rows.empty:
        logger.warning(f"fundamental model: empty result for {zone}")
        return {}

    if len(rows) < 60:
        logger.warning(f"fundamental model: insufficient data for {zone} ({len(rows)} rows)")
        return {}

    df = rows.copy()
    df["price_date"] = pd.to_datetime(df["price_date"])
    df = df.dropna(subset=["base_eur", "ttf_eur_mwh", "eua_eur_t", "wind_pct", "solar_pct"])
    df = df.reset_index(drop=True)

    # Fit OLS on the most recent OLS_WINDOW rows
    fit_df = df.tail(OLS_WINDOW)
    X = np.column_stack([
        np.ones(len(fit_df)),
        fit_df["ttf_eur_mwh"].values,
        fit_df["eua_eur_t"].values,
        fit_df["wind_pct"].values,
        fit_df["solar_pct"].values,
    ])
    y = fit_df["base_eur"].values
    coefs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    b0, b1_ttf, b2_eua, b3_wind, b4_solar = coefs

    # R-squared on fit window
    y_pred_fit = X @ coefs
    ss_res = np.sum((y - y_pred_fit) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Compute fitted + residual for the full series (out-of-sample before fit window)
    X_all = np.column_stack([
        np.ones(len(df)),
        df["ttf_eur_mwh"].values,
        df["eua_eur_t"].values,
        df["wind_pct"].values,
        df["solar_pct"].values,
    ])
    fitted = X_all @ coefs
    residual = df["base_eur"].values - fitted

    # Rolling 30-day z-score of residual (standardized by rolling mean + std)
    res_series = pd.Series(residual)
    roll_mean = res_series.rolling(ZSCORE_WINDOW, min_periods=10).mean()
    roll_std  = res_series.rolling(ZSCORE_WINDOW, min_periods=10).std()
    zscore = ((res_series - roll_mean) / roll_std.replace(0, np.nan)).fillna(0)

    series = [
        {
            "price_date": row["price_date"].strftime("%Y-%m-%d"),
            "actual": round(float(row["base_eur"]), 2),
            "fitted": round(float(fitted[i]), 2),
            "residual": round(float(residual[i]), 2),
            "zscore": round(float(zscore.iloc[i]), 3),
        }
        for i, row in df.iterrows()
    ]

    # Latest signal
    latest_zscore = float(zscore.iloc[-1]) if len(zscore) else 0.0
    latest_residual = float(residual[-1]) if len(residual) else 0.0
    latest_actual = float(df["base_eur"].iloc[-1]) if len(df) else 0.0
    latest_fitted = float(fitted[-1]) if len(fitted) else 0.0

    # Percentile rank of residual in the trailing 365-day window
    trail = residual[max(0, len(residual) - OLS_WINDOW):]
    if len(trail) > 1:
        pct_rank = int(round(100 * np.mean(trail < latest_residual)))
    else:
        pct_rank = 50

    # AR(1) half-life of residual: fit residual(t) = a + b * residual(t-1)
    # Use the fit-window residuals (last OLS_WINDOW rows)
    fit_res = residual[max(0, len(residual) - OLS_WINDOW):]
    half_life_days: float | None = None
    if len(fit_res) > 20:
        y_ar = fit_res[1:]
        x_ar = fit_res[:-1]
        X_ar = np.column_stack([np.ones(len(x_ar)), x_ar])
        b_ar, _, _, _ = np.linalg.lstsq(X_ar, y_ar, rcond=None)
        ar1 = float(b_ar[1])
        if 0.0 < ar1 < 1.0:
            half_life_days = round(-np.log(2) / np.log(ar1), 2)

    # Rolling 90-day OLS (stepped weekly) to track coefficient stability over time.
    # Only computed on the trailing 2 years to bound response size.
    ROLL_WIN = 90
    STEP = 7
    two_yr_df = df.tail(OLS_WINDOW * 2)
    rolling_coefs = []
    for end in range(ROLL_WIN, len(two_yr_df) + 1, STEP):
        win = two_yr_df.iloc[end - ROLL_WIN:end]
        if win.empty or win["base_eur"].isna().any():
            continue
        Xw = np.column_stack([
            np.ones(len(win)),
            win["ttf_eur_mwh"].values,
            win["eua_eur_t"].values,
            win["wind_pct"].values,
            win["solar_pct"].values,
        ])
        yw = win["base_eur"].values
        cw, _, _, _ = np.linalg.lstsq(Xw, yw, rcond=None)
        yw_pred = Xw @ cw
        ss_r = np.sum((yw - yw_pred) ** 2)
        ss_t = np.sum((yw - yw.mean()) ** 2)
        r2w = float(1 - ss_r / ss_t) if ss_t > 0 else 0.0
        rolling_coefs.append({
            "date": two_yr_df.iloc[end - 1]["price_date"].strftime("%Y-%m-%d"),
            "ttf_eur_mwh": round(float(cw[1]), 4),
            "eua_eur_t": round(float(cw[2]), 4),
            "wind_pct": round(float(cw[3]), 4),
            "solar_pct": round(float(cw[4]), 4),
            "r2": round(r2w, 4),
        })

    return {
        "zone": zone,
        "coefficients": {
            "intercept": round(float(b0), 3),
            "ttf_eur_mwh": round(float(b1_ttf), 4),
            "eua_eur_t": round(float(b2_eua), 4),
            "wind_pct": round(float(b3_wind), 4),
            "solar_pct": round(float(b4_solar), 4),
            "r2": round(r2, 4),
            "n": len(fit_df),
        },
        "series": series,
        "current": {
            "actual": round(latest_actual, 2),
            "fitted": round(latest_fitted, 2),
            "residual": round(latest_residual, 2),
            "zscore": round(latest_zscore, 3),
            "pct_rank_1yr": pct_rank,
            "half_life_days": half_life_days,
        },
        "rolling_coefs": rolling_coefs,
    }


# Wind bin breakpoints and labels (ascending wind_pct)
_WIND_BINS = [
    (0,   5,  "0-5%",   1),
    (5,   10, "5-10%",  2),
    (10,  15, "10-15%", 3),
    (15,  20, "15-20%", 4),
    (20,  25, "20-25%", 5),
    (25,  35, "25-35%", 6),
    (35, 100, "35%+",   7),
]


def compute_wind_price_analysis(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Compute wind-price nonlinearity analysis: per-bin price stats and OLS residuals.

    Bins days by wind penetration, shows median/mean/std price per bin, then computes
    the OLS residual (vs the fundamental value model) by bin to expose where the linear
    model systematically over- or under-prices. High residuals in the low-wind bins
    indicate convexity that OLS misses - the case for nonlinear ML models.

    Args:
        query_fn: db.query callable
        zone: bidding zone code

    Returns a dict with:
      - zone, as_of
      - bins: [{wind_bin, bin_order, n, median_price, mean_price, std_price,
                mean_residual, median_residual}]
      - interpretation: {nonlinear_premium, cv_low_wind, cv_high_wind}
    """
    model = compute_fundamental_model(query_fn, zone)
    if not model or not model.get("series"):
        return {}

    series = model["series"]
    coef = model["coefficients"]
    b0 = coef["intercept"]
    b1 = coef["ttf_eur_mwh"]
    b2 = coef["eua_eur_t"]
    b3 = coef["wind_pct"]
    b4 = coef["solar_pct"]

    # Re-fetch raw data to get wind_pct for each row
    try:
        rows = query_fn("""
            SELECT
                p.price_date,
                p.base_eur,
                pr.ttf_eur_mwh,
                pr.eua_eur_t,
                (g.wind / NULLIF(g.total_mw, 0)) * 100  AS wind_pct,
                (g.solar / NULLIF(g.total_mw, 0)) * 100 AS solar_pct
            FROM power_daily p
            JOIN prices_daily pr ON p.price_date = pr.price_date
            JOIN generation_daily g ON p.price_date = g.gen_date AND g.zone = p.zone
            WHERE p.zone = ?
              AND p.base_eur IS NOT NULL
              AND pr.ttf_eur_mwh IS NOT NULL
              AND g.total_mw > 0
              AND g.wind IS NOT NULL
              AND g.solar IS NOT NULL
            ORDER BY p.price_date
        """, [zone])
    except Exception as exc:
        logger.warning(f"wind-price query failed for {zone}: {exc!r}")
        return {}

    if rows is None or rows.empty:
        return {}

    df = rows.copy().dropna(subset=["base_eur", "ttf_eur_mwh", "eua_eur_t", "wind_pct", "solar_pct"])
    df["fitted"] = b0 + b1 * df["ttf_eur_mwh"] + b2 * df["eua_eur_t"] + b3 * df["wind_pct"] + b4 * df["solar_pct"]
    df["residual"] = df["base_eur"] - df["fitted"]

    result_bins = []
    for lo, hi, label, order in _WIND_BINS:
        mask = (df["wind_pct"] >= lo) & (df["wind_pct"] < hi)
        sub = df[mask]
        if sub.empty:
            continue
        result_bins.append({
            "wind_bin": label,
            "bin_order": order,
            "wind_lo": lo,
            "wind_hi": hi,
            "n": int(len(sub)),
            "median_price": round(float(sub["base_eur"].median()), 1),
            "mean_price": round(float(sub["base_eur"].mean()), 1),
            "std_price": round(float(sub["base_eur"].std()), 1),
            "mean_residual": round(float(sub["residual"].mean()), 1),
            "median_residual": round(float(sub["residual"].median()), 1),
        })

    # Key metrics for interpretation
    low_bin = next((b for b in result_bins if b["wind_lo"] < 5), None)
    high_bin = next((b for b in result_bins if b["wind_lo"] >= 35), None)
    nonlinear_premium = None
    cv_low = None
    cv_high = None
    if low_bin and high_bin and high_bin["mean_price"] > 0:
        nonlinear_premium = round(low_bin["mean_price"] - high_bin["mean_price"], 1)
    if low_bin and low_bin["mean_price"] > 0:
        cv_low = round(low_bin["std_price"] / low_bin["mean_price"] * 100, 1)
    if high_bin and high_bin["mean_price"] > 0:
        cv_high = round(high_bin["std_price"] / high_bin["mean_price"] * 100, 1)

    as_of = series[-1]["price_date"] if series else None
    return {
        "zone": zone,
        "as_of": as_of,
        "bins": result_bins,
        "interpretation": {
            "nonlinear_premium_eur": nonlinear_premium,
            "cv_low_wind_pct": cv_low,
            "cv_high_wind_pct": cv_high,
        },
    }


def compute_fundamental_backtest(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Backtest of the z-score mean-reversion signal.

    Strategy: continuous position = -zscore(t-1) (short when overbought, long when
    undersold), scaled to [-1, +1] by clipping at 3 sigma. Daily P&L is position ×
    price change (direction only, no notional - tracks sign accuracy).

    Reports performance split between in-sample (trailing 365 days used for OLS fit)
    and out-of-sample (all earlier data).

    Args:
        query_fn: db.query callable
        zone: bidding zone code

    Returns a dict with:
      - equity: [{date, daily_pnl, cum_pnl, zscore, position, in_sample}]
      - stats: {sharpe_oos, sharpe_is, sharpe_all, hit_rate_pct, max_dd_eur, n_oos, n_is}
    """
    model = compute_fundamental_model(query_fn, zone)
    if not model or not model.get("series"):
        return {}

    series = model["series"]
    if len(series) < 20:
        return {}

    prices = np.array([s["actual"] for s in series])
    zscores = np.array([s["zscore"] for s in series])
    dates = [s["price_date"] for s in series]

    # Daily price changes (today - yesterday): we profit if we predicted direction
    price_changes = np.diff(prices)  # length n-1

    # Position yesterday determines today's P&L
    # position = clip(-z, -1, 1): short when z>0, long when z<0
    positions = np.clip(-zscores[:-1], -1.0, 1.0)  # length n-1

    # Daily P&L (normalized: position × price_change)
    daily_pnl = positions * price_changes  # length n-1

    # Cumulative P&L
    cum_pnl = np.cumsum(daily_pnl)

    # In-sample = last OLS_WINDOW days; out-of-sample = everything before
    n = len(daily_pnl)
    is_start = max(0, n - OLS_WINDOW)

    def sharpe(pnl: np.ndarray) -> float | None:
        if len(pnl) < 10 or pnl.std() == 0:
            return None
        return float(round(pnl.mean() / pnl.std() * np.sqrt(252), 3))

    def max_drawdown(cum: np.ndarray) -> float:
        if len(cum) == 0:
            return 0.0
        peak = np.maximum.accumulate(cum)
        dd = cum - peak
        return float(round(dd.min(), 2))

    def hit_rate(pnl: np.ndarray) -> float:
        if len(pnl) == 0:
            return 0.0
        return float(round(100 * np.mean(pnl > 0), 1))

    pnl_oos = daily_pnl[:is_start]
    pnl_is = daily_pnl[is_start:]

    equity = [
        {
            "date": dates[i + 1],
            "daily_pnl": round(float(daily_pnl[i]), 2),
            "cum_pnl": round(float(cum_pnl[i]), 2),
            "zscore": round(float(zscores[i]), 3),
            "position": round(float(positions[i]), 3),
            "in_sample": i >= is_start,
        }
        for i in range(n)
    ]

    stats = {
        "sharpe_oos": sharpe(pnl_oos),
        "sharpe_is": sharpe(pnl_is),
        "sharpe_all": sharpe(daily_pnl),
        "hit_rate_pct": hit_rate(daily_pnl),
        "hit_rate_oos_pct": hit_rate(pnl_oos),
        "max_dd_eur": max_drawdown(cum_pnl),
        "n_oos": int(len(pnl_oos)),
        "n_is": int(len(pnl_is)),
        "avg_daily_pnl": round(float(daily_pnl.mean()), 3),
        "pnl_std": round(float(daily_pnl.std()), 3),
    }

    return {
        "zone": zone,
        "equity": equity,
        "stats": stats,
    }
