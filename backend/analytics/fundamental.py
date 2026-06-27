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


# Knot for the low-wind hinge basis (wind penetration, percentage points). Below this,
# scarcity pricing turns convex; the hinge max(0, KNOT - wind%) lets the regression bend.
LOW_WIND_KNOT_PCT = 8.0

# Walk-forward settings for the nonlinear vs linear comparison.
WF_MIN_TRAIN = 250   # minimum training rows before the first OOS prediction
WF_MAX_OOS = 730     # cap OOS evaluation window (days) to bound response + compute


def _design_linear(ttf, eua, wind, solar):
    """Linear design matrix: [1, TTF, EUA, wind%, solar%]."""
    return np.column_stack([np.ones(len(ttf)), ttf, eua, wind, solar])


def _design_nonlinear(ttf, eua, wind, solar):
    """Nonlinear design matrix: linear terms plus a low-wind hinge, wind^2, solar^2,
    and a TTF x wind interaction. Captures the convexity OLS misses at low wind."""
    hinge = np.maximum(0.0, LOW_WIND_KNOT_PCT - wind)
    return np.column_stack([
        np.ones(len(ttf)), ttf, eua, wind, solar,
        hinge, wind ** 2, solar ** 2, (ttf * wind) / 100.0,
    ])


def compute_nonlinear_model(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Walk-forward comparison of a linear vs a nonlinear (basis-expansion) fair-value model.

    Both models regress the daily DA base price on TTF, EUA, wind%, solar%. The nonlinear
    model adds a low-wind hinge max(0, KNOT - wind%), squared wind/solar, and a TTF x wind
    interaction - all fit by ordinary least squares (numpy lstsq), no extra dependency.

    Evaluation is strictly out-of-sample: at each day t (after WF_MIN_TRAIN history) both
    models are refit on rows [0..t-1] and predict day t. We compare OOS RMSE/MAE/R2
    overall and split by wind regime (low <KNOT pp vs the rest), where the linear model's
    convexity error concentrates. This answers the question the wind-price analysis raises:
    is the low-wind premium actually capturable, or just visible in hindsight?

    Returns dict with: zone, as_of, n_oos, knot_pct, linear{}, nonlinear{}, improvement{},
    scatter[] (per-OOS-day actual + both predictions + wind%).
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
        logger.warning(f"nonlinear model query failed for {zone}: {exc!r}")
        return {}
    if rows is None or rows.empty or len(rows) < WF_MIN_TRAIN + 30:
        logger.warning(f"nonlinear model: insufficient data for {zone}")
        return {}

    df = rows.copy()
    df["price_date"] = pd.to_datetime(df["price_date"])
    df = df.dropna(subset=["base_eur", "ttf_eur_mwh", "eua_eur_t", "wind_pct", "solar_pct"])
    df = df.reset_index(drop=True)

    ttf = df["ttf_eur_mwh"].to_numpy(float)
    eua = df["eua_eur_t"].to_numpy(float)
    wind = df["wind_pct"].to_numpy(float)
    solar = df["solar_pct"].to_numpy(float)
    y = df["base_eur"].to_numpy(float)
    dates = df["price_date"]
    n = len(y)

    Xlin = _design_linear(ttf, eua, wind, solar)
    Xnl = _design_nonlinear(ttf, eua, wind, solar)

    start = max(WF_MIN_TRAIN, n - WF_MAX_OOS)
    idx, pred_lin, pred_nl = [], [], []
    for t in range(start, n):
        clin, _, _, _ = np.linalg.lstsq(Xlin[:t], y[:t], rcond=None)
        cnl, _, _, _ = np.linalg.lstsq(Xnl[:t], y[:t], rcond=None)
        idx.append(t)
        pred_lin.append(float(Xlin[t] @ clin))
        pred_nl.append(float(Xnl[t] @ cnl))

    if not idx:
        return {}

    idx = np.array(idx)
    y_oos = y[idx]
    w_oos = wind[idx]
    pred_lin = np.array(pred_lin)
    pred_nl = np.array(pred_nl)

    def metrics(actual, pred, mask=None):
        a, p = (actual, pred) if mask is None else (actual[mask], pred[mask])
        if len(a) == 0:
            return {"rmse": None, "mae": None, "r2": None, "n": 0}
        err = a - p
        rmse = float(np.sqrt(np.mean(err ** 2)))
        mae = float(np.mean(np.abs(err)))
        ss_tot = float(np.sum((a - a.mean()) ** 2))
        r2 = float(1 - np.sum(err ** 2) / ss_tot) if ss_tot > 0 else None
        return {"rmse": round(rmse, 2), "mae": round(mae, 2),
                "r2": round(r2, 4) if r2 is not None else None, "n": int(len(a))}

    low = w_oos < LOW_WIND_KNOT_PCT
    high = ~low

    lin = {
        "overall": metrics(y_oos, pred_lin),
        "low_wind": metrics(y_oos, pred_lin, low),
        "high_wind": metrics(y_oos, pred_lin, high),
    }
    nl = {
        "overall": metrics(y_oos, pred_nl),
        "low_wind": metrics(y_oos, pred_nl, low),
        "high_wind": metrics(y_oos, pred_nl, high),
    }

    def pct_drop(a, b):
        if a is None or b is None or a == 0:
            return None
        return round(100.0 * (a - b) / a, 1)

    improvement = {
        "rmse_pct": pct_drop(lin["overall"]["rmse"], nl["overall"]["rmse"]),
        "low_wind_rmse_pct": pct_drop(lin["low_wind"]["rmse"], nl["low_wind"]["rmse"]),
        "r2_delta": (round(nl["overall"]["r2"] - lin["overall"]["r2"], 4)
                     if lin["overall"]["r2"] is not None and nl["overall"]["r2"] is not None
                     else None),
    }

    # Full-sample fit of the nonlinear hinge coefficient: the EUR/MWh of extra price per
    # point of wind below the knot, beyond the linear wind slope.
    cnl_full, _, _, _ = np.linalg.lstsq(Xnl, y, rcond=None)
    hinge_coef = round(float(cnl_full[5]), 2)  # index 5 is the hinge column

    # Downsample scatter to <= 365 points to bound payload.
    step = max(1, len(idx) // 365)
    scatter = [
        {
            "price_date": dates.iloc[int(idx[i])].strftime("%Y-%m-%d"),
            "wind_pct": round(float(w_oos[i]), 1),
            "actual": round(float(y_oos[i]), 2),
            "pred_linear": round(float(pred_lin[i]), 2),
            "pred_nonlinear": round(float(pred_nl[i]), 2),
        }
        for i in range(0, len(idx), step)
    ]

    return {
        "zone": zone,
        "as_of": dates.iloc[-1].strftime("%Y-%m-%d"),
        "n_oos": int(len(idx)),
        "knot_pct": LOW_WIND_KNOT_PCT,
        "hinge_coef_eur_per_pp": hinge_coef,
        "linear": lin,
        "nonlinear": nl,
        "improvement": improvement,
        "scatter": scatter,
    }


# Z-score lookback for the walk-forward residual trading signal (days).
WF_SIGNAL_WINDOW = 30


def compute_nonlinear_backtest(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Trade the linear vs nonlinear residual signals out-of-sample and compare P&L.

    Phase 42 showed the nonlinear (hinge/polynomial) fair-value model recovers the
    low-wind premium that linear OLS misses, in RMSE terms. This closes the loop with
    the question a trading desk actually asks: does that extra accuracy translate into
    *tradeable* alpha?

    Mechanism. We reuse the strict walk-forward of compute_nonlinear_model: at each day
    t (after WF_MIN_TRAIN history) both models are refit on rows [0..t-1] and predict
    day t, so every prediction is genuinely OOS. The OOS residual (actual - fair value)
    is the deviation from fair value; a high residual means the market is rich vs the
    model, so we fade it. We standardise each model's OOS residual with a rolling
    WF_SIGNAL_WINDOW z-score and take position = clip(-z, -1, +1). Daily P&L is
    position(t-1) x price_change(t) - identical accounting to the fundamental backtest,
    so the only difference between the two equity curves is the fair-value model that
    produced the signal. We report Sharpe / hit-rate / cumulative P&L / max drawdown for
    each, plus the same split by wind regime where the nonlinear edge should concentrate.

    Returns dict with: zone, as_of, n_eval, signal_window, knot_pct, linear{}, nonlinear{},
    improvement{}, equity[] (per-day cum P&L for both + wind%).
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
        logger.warning(f"nonlinear backtest query failed for {zone}: {exc!r}")
        return {}
    if rows is None or rows.empty or len(rows) < WF_MIN_TRAIN + 40:
        logger.warning(f"nonlinear backtest: insufficient data for {zone}")
        return {}

    df = rows.copy()
    df["price_date"] = pd.to_datetime(df["price_date"])
    df = df.dropna(subset=["base_eur", "ttf_eur_mwh", "eua_eur_t", "wind_pct", "solar_pct"])
    df = df.reset_index(drop=True)

    ttf = df["ttf_eur_mwh"].to_numpy(float)
    eua = df["eua_eur_t"].to_numpy(float)
    wind = df["wind_pct"].to_numpy(float)
    solar = df["solar_pct"].to_numpy(float)
    y = df["base_eur"].to_numpy(float)
    dates = df["price_date"]
    n = len(y)

    Xlin = _design_linear(ttf, eua, wind, solar)
    Xnl = _design_nonlinear(ttf, eua, wind, solar)

    # Walk-forward OOS residuals for both models over the same evaluation window.
    start = max(WF_MIN_TRAIN, n - WF_MAX_OOS)
    idx, res_lin, res_nl = [], [], []
    for t in range(start, n):
        clin, _, _, _ = np.linalg.lstsq(Xlin[:t], y[:t], rcond=None)
        cnl, _, _, _ = np.linalg.lstsq(Xnl[:t], y[:t], rcond=None)
        idx.append(t)
        res_lin.append(y[t] - float(Xlin[t] @ clin))
        res_nl.append(y[t] - float(Xnl[t] @ cnl))

    if len(idx) < WF_SIGNAL_WINDOW + 5:
        return {}

    idx = np.array(idx)
    prices = y[idx]
    w_eval = wind[idx]
    eval_dates = [dates.iloc[int(i)].strftime("%Y-%m-%d") for i in idx]

    # Daily price changes over the (consecutive) evaluation window.
    price_changes = np.diff(prices)  # length m-1

    def signal_positions(residuals: list[float]) -> np.ndarray:
        """Rolling z-score of the OOS residual -> clipped contrarian position."""
        s = pd.Series(residuals)
        rm = s.rolling(WF_SIGNAL_WINDOW, min_periods=10).mean()
        rs = s.rolling(WF_SIGNAL_WINDOW, min_periods=10).std()
        z = ((s - rm) / rs.replace(0, np.nan)).fillna(0.0).to_numpy()
        return np.clip(-z, -1.0, 1.0)

    pos_lin = signal_positions(res_lin)
    pos_nl = signal_positions(res_nl)

    # Position held yesterday earns today's price change.
    pnl_lin = pos_lin[:-1] * price_changes
    pnl_nl = pos_nl[:-1] * price_changes
    w_pnl = w_eval[1:]  # wind regime aligned to each P&L day

    def sharpe(pnl: np.ndarray) -> float | None:
        if len(pnl) < 10 or pnl.std() == 0:
            return None
        return float(round(pnl.mean() / pnl.std() * np.sqrt(252), 3))

    def hit_rate(pnl: np.ndarray) -> float:
        if len(pnl) == 0:
            return 0.0
        return float(round(100 * np.mean(pnl > 0), 1))

    def max_drawdown(cum: np.ndarray) -> float:
        if len(cum) == 0:
            return 0.0
        peak = np.maximum.accumulate(cum)
        return float(round((cum - peak).min(), 2))

    low = w_pnl < LOW_WIND_KNOT_PCT

    def stats(pnl: np.ndarray) -> dict:
        cum = np.cumsum(pnl)
        return {
            "sharpe": sharpe(pnl),
            "sharpe_low_wind": sharpe(pnl[low]),
            "hit_rate_pct": hit_rate(pnl),
            "cum_pnl": round(float(cum[-1]), 2) if len(cum) else 0.0,
            "max_dd_eur": max_drawdown(cum),
            "avg_daily_pnl": round(float(pnl.mean()), 3) if len(pnl) else 0.0,
            "n": int(len(pnl)),
            "n_low_wind": int(low.sum()),
        }

    lin_stats = stats(pnl_lin)
    nl_stats = stats(pnl_nl)

    def _delta(a, b):
        return round(b - a, 3) if a is not None and b is not None else None

    improvement = {
        "sharpe_delta": _delta(lin_stats["sharpe"], nl_stats["sharpe"]),
        "sharpe_low_wind_delta": _delta(lin_stats["sharpe_low_wind"], nl_stats["sharpe_low_wind"]),
        "cum_pnl_delta": round(nl_stats["cum_pnl"] - lin_stats["cum_pnl"], 2),
        "hit_rate_delta": round(nl_stats["hit_rate_pct"] - lin_stats["hit_rate_pct"], 1),
    }

    # Equity curves (cumulative P&L per day), downsampled to <= 365 points.
    cum_lin = np.cumsum(pnl_lin)
    cum_nl = np.cumsum(pnl_nl)
    step = max(1, len(pnl_lin) // 365)
    equity = [
        {
            "date": eval_dates[i + 1],
            "cum_linear": round(float(cum_lin[i]), 2),
            "cum_nonlinear": round(float(cum_nl[i]), 2),
            "wind_pct": round(float(w_pnl[i]), 1),
        }
        for i in range(0, len(pnl_lin), step)
    ]
    # Always include the final point so the curve ends on the reported cum P&L.
    if equity and equity[-1]["date"] != eval_dates[-1]:
        last = len(pnl_lin) - 1
        equity.append({
            "date": eval_dates[last + 1],
            "cum_linear": round(float(cum_lin[last]), 2),
            "cum_nonlinear": round(float(cum_nl[last]), 2),
            "wind_pct": round(float(w_pnl[last]), 1),
        })

    return {
        "zone": zone,
        "as_of": eval_dates[-1],
        "n_eval": int(len(pnl_lin)),
        "signal_window": WF_SIGNAL_WINDOW,
        "knot_pct": LOW_WIND_KNOT_PCT,
        "linear": lin_stats,
        "nonlinear": nl_stats,
        "improvement": improvement,
        "equity": equity,
    }


# Round-trip transaction-cost grid (EUR/MWh per unit of |position change|). A full
# position flip (-1 -> +1) has turnover 2, so costs the grid value x 2. The grid spans
# from frictionless to a punitive 1.0 EUR/MWh, comfortably bracketing a realistic
# day-ahead-vs-realised execution slippage of a few tenths of a EUR/MWh.
COST_GRID = [0.0, 0.02, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.75, 1.0]


def compute_nonlinear_cost_robustness(query_fn: Callable, zone: str = "DE-LU") -> dict:
    """Charge transaction costs against the linear vs nonlinear residual signals.

    Phase 43 showed the nonlinear signal earns a higher *gross* Sharpe than the linear
    one on the wind-heavy DE-LU hub. The signal is a continuous, daily-rebalanced
    contrarian fade, so it turns over a lot - the honest follow-up a desk asks is whether
    the edge survives execution costs. This sweeps a round-trip cost (EUR/MWh per unit of
    |position change|) and reports each model's net Sharpe and net cumulative P&L across
    the grid, plus the break-even cost at which the nonlinear edge over linear vanishes.

    Mechanism. We reuse the exact walk-forward of compute_nonlinear_backtest to produce
    the two OOS position paths, then for each cost c charge c x |pos(t) - pos(t-1)| on the
    day each position is established (the initial entry costs c x |pos(0)|). Net daily P&L
    is gross P&L minus that turnover charge; the two equity curves differ only by the
    fair-value model and the (identical) cost schedule, so any surviving Sharpe gap is the
    capturable, net-of-cost value of the nonlinear basis.

    Returns dict with: zone, as_of, n_eval, avg_turnover_{linear,nonlinear} (mean daily
    |dpos|), gross{} (c=0 Sharpe + cum P&L for both), breakeven_cost_sharpe / _cum (cost
    where the nonlinear edge crosses to <= the linear one, or None if it never does within
    the grid), and sweep[] (per-cost net Sharpe / cum P&L / deltas for the chart).
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
        logger.warning(f"cost robustness query failed for {zone}: {exc!r}")
        return {}
    if rows is None or rows.empty or len(rows) < WF_MIN_TRAIN + 40:
        logger.warning(f"cost robustness: insufficient data for {zone}")
        return {}

    df = rows.copy()
    df["price_date"] = pd.to_datetime(df["price_date"])
    df = df.dropna(subset=["base_eur", "ttf_eur_mwh", "eua_eur_t", "wind_pct", "solar_pct"])
    df = df.reset_index(drop=True)

    ttf = df["ttf_eur_mwh"].to_numpy(float)
    eua = df["eua_eur_t"].to_numpy(float)
    wind = df["wind_pct"].to_numpy(float)
    solar = df["solar_pct"].to_numpy(float)
    y = df["base_eur"].to_numpy(float)
    dates = df["price_date"]
    n = len(y)

    Xlin = _design_linear(ttf, eua, wind, solar)
    Xnl = _design_nonlinear(ttf, eua, wind, solar)

    start = max(WF_MIN_TRAIN, n - WF_MAX_OOS)
    idx, res_lin, res_nl = [], [], []
    for t in range(start, n):
        clin, _, _, _ = np.linalg.lstsq(Xlin[:t], y[:t], rcond=None)
        cnl, _, _, _ = np.linalg.lstsq(Xnl[:t], y[:t], rcond=None)
        idx.append(t)
        res_lin.append(y[t] - float(Xlin[t] @ clin))
        res_nl.append(y[t] - float(Xnl[t] @ cnl))

    if len(idx) < WF_SIGNAL_WINDOW + 5:
        return {}

    idx = np.array(idx)
    prices = y[idx]
    eval_dates = [dates.iloc[int(i)].strftime("%Y-%m-%d") for i in idx]
    price_changes = np.diff(prices)  # length m-1

    def signal_positions(residuals: list[float]) -> np.ndarray:
        s = pd.Series(residuals)
        rm = s.rolling(WF_SIGNAL_WINDOW, min_periods=10).mean()
        rs = s.rolling(WF_SIGNAL_WINDOW, min_periods=10).std()
        z = ((s - rm) / rs.replace(0, np.nan)).fillna(0.0).to_numpy()
        return np.clip(-z, -1.0, 1.0)

    pos_lin = signal_positions(res_lin)
    pos_nl = signal_positions(res_nl)

    # Turnover to establish each held position: |pos(t) - pos(t-1)|, with pos(-1)=0 so the
    # initial entry is charged. Aligned to the P&L days (positions pos[:-1] earn the next
    # price change), so we take the turnover of pos over the same [0 .. m-2] slice.
    def turnover(pos: np.ndarray) -> np.ndarray:
        d = np.abs(np.diff(pos, prepend=0.0))  # length m
        return d[:-1]                          # align to pnl days (pos[:-1])

    to_lin = turnover(pos_lin)
    to_nl = turnover(pos_nl)
    gross_lin = pos_lin[:-1] * price_changes
    gross_nl = pos_nl[:-1] * price_changes

    def sharpe(pnl: np.ndarray) -> float | None:
        if len(pnl) < 10 or pnl.std() == 0:
            return None
        return float(round(pnl.mean() / pnl.std() * np.sqrt(252), 3))

    sweep = []
    for c in COST_GRID:
        net_lin = gross_lin - c * to_lin
        net_nl = gross_nl - c * to_nl
        s_lin = sharpe(net_lin)
        s_nl = sharpe(net_nl)
        cum_lin = round(float(net_lin.sum()), 2)
        cum_nl = round(float(net_nl.sum()), 2)
        sweep.append({
            "cost": round(c, 3),
            "linear_sharpe": s_lin,
            "nonlinear_sharpe": s_nl,
            "linear_cum_pnl": cum_lin,
            "nonlinear_cum_pnl": cum_nl,
            "sharpe_delta": round(s_nl - s_lin, 3) if s_lin is not None and s_nl is not None else None,
            "cum_pnl_delta": round(cum_nl - cum_lin, 2),
        })

    # Cumulative-P&L break-even is closed-form: net edge(c) = (G_nl - G_lin) - c(T_nl - T_lin).
    # It crosses zero at c* = (G_nl - G_lin) / (T_nl - T_lin) when the nonlinear signal both
    # starts ahead and trades more; otherwise the edge never erodes (None).
    g_edge = float(gross_nl.sum() - gross_lin.sum())
    t_edge = float(to_nl.sum() - to_lin.sum())
    if g_edge > 0 and t_edge > 0:
        be_cum = round(g_edge / t_edge, 3)
    else:
        be_cum = None

    # Sharpe break-even: finest cost on the grid at which the nonlinear net Sharpe first
    # drops to or below the linear net Sharpe (scan a dense grid for the crossing).
    be_sharpe = None
    fine = [round(0.0 + 0.01 * k, 3) for k in range(0, 101)]  # 0.00 .. 1.00 step 0.01
    for c in fine:
        s_lin = sharpe(gross_lin - c * to_lin)
        s_nl = sharpe(gross_nl - c * to_nl)
        if s_lin is None or s_nl is None:
            continue
        if s_nl <= s_lin:
            be_sharpe = c
            break

    return {
        "zone": zone,
        "as_of": eval_dates[-1],
        "n_eval": int(len(gross_lin)),
        "avg_turnover_linear": round(float(to_lin.mean()), 3),
        "avg_turnover_nonlinear": round(float(to_nl.mean()), 3),
        "gross": {
            "linear_sharpe": sweep[0]["linear_sharpe"],
            "nonlinear_sharpe": sweep[0]["nonlinear_sharpe"],
            "linear_cum_pnl": sweep[0]["linear_cum_pnl"],
            "nonlinear_cum_pnl": sweep[0]["nonlinear_cum_pnl"],
        },
        "breakeven_cost_sharpe": be_sharpe,
        "breakeven_cost_cum": be_cum,
        "sweep": sweep,
    }
