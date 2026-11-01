"""German reBAP imbalance price analytics.

Reads imbalance_prices_de from PostgreSQL market_data, sourced from the Netztransparenz
NrvSaldo/reBAP endpoint (fetcher: `ingest.py rebap-de`). The earlier SMARD-sourced rows were
the DE/LU day-ahead price mislabelled as reBAP and have been purged; see
`market-data/fetchers/smard_imbalance.py` for the post-mortem.

Sign convention: Germany runs a single-price balancing mechanism, so long_eur_mwh ==
short_eur_mwh on every row (verified: 0 of 439,960 rows differ). Reading long_eur_mwh alone
is therefore lossless. `nrv_mw` (the control block's net balancing volume, positive = long)
was NULL throughout until 2026-08-09, when `ingest.py nrv-saldo-de` backfilled it from the
same API's NrvSaldo/NRVSaldo endpoint (`fetchers/netztransparenz.py:fetch_nrv`) - quality
assured 2014-01-01 on, operational (current to ~yesterday) filling the recent tail. See
`market-data/docs/CHANGELOG.md` 2026-08-09.

Tables produced for energy_hub.duckdb:
  imbalance_recent         - trailing 10 days of 15-min prices
  imbalance_daily          - trailing 2 years of daily aggregates (mean/min/max reBAP,
                              plus nrv_mean_mw where NRV-Saldo coverage exists)
  imbalance_latest         - most recent 15-min snapshot + today's stats
  imbalance_hourly_profile - 90-day avg/p25/p75/neg_pct by hour-of-day (24 rows)

Walk-forward signal (on-demand, from energy_hub.duckdb):
  compute_rebap_signal(db_query) -> dict
    Predicts the *excess* of reBAP above its own 5-day trailing mean, not the level (the
    level is structurally positive 92-99% of every year, so a level-based baseline is not
    informative about anything this model actually forecasts).

    Features (D-1 gate-closure information set):
      wind_fc_d      - D DA wind forecast %-of-load (known D-1)
      rebap_dev_lag1 - D-1 deviation of reBAP from its 5-day mean (mean-reversion anchor)
      nrv_dev_lag1   - D-1 deviation of mean NRV-Saldo from ITS 5-day mean (system-imbalance
                       anchor, added 2026-08-19 - see docs/ROADMAP.md Phase 87)

    Dropped 2026-08-19 (docs/ROADMAP.md Phase 86): wind_err_lag1 and solar_err_lag1, the
    original renewable-forecast-error features this signal was named for. Revalidated on
    real reBAP (2026-07-31), wind_err_lag1 turned out to be noise (coefficient cv > 9 across
    the walk-forward window) and solar_err_lag1's coefficient sign was not stable either.
    Neither survives as a feature; both are still computed and logged in generation_forecast_daily
    for anyone who wants to re-test them.

    Walk-forward OLS (252-day window, 1-day OOS), P&L net of 2 EUR/MWh round-trip cost,
    booked on the EXCESS (not the level) so it is apples-to-apples with accuracy_pct, which
    is also measured on the excess. `structural_long` reports the separate, always-positive
    strategy of holding the level unconditionally long - a real number, but not a competing
    signal to `model`/`naive_excess`, and must not be displayed as though it were one.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pandas as pd
from loaders._base import _query, get_read_conn


def build_imbalance_tables() -> dict[str, pd.DataFrame]:
    """Return imbalance DataFrames ready for energy_hub.duckdb."""
    empty_recent = pd.DataFrame(columns=["ts", "rebap_eur_mwh"])
    empty_daily = pd.DataFrame(
        columns=["price_date", "mean_eur", "min_eur", "max_eur", "count", "nrv_mean_mw"]
    )
    empty_latest = pd.DataFrame(
        columns=["current_ts", "rebap_eur_mwh", "today_mean", "today_min", "today_max"]
    )

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
        nrv_raw = _query(
            conn,
            """
            SELECT ts, nrv_mw
            FROM imbalance_prices_de
            WHERE nrv_mw IS NOT NULL
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

    # NRV-Saldo daily mean (system imbalance, positive = control block long), same window as
    # the reBAP aggregate above. Left-joined: NRV coverage need not match reBAP day-for-day,
    # and a day with no NRV value gets NaN rather than being dropped from imbalance_daily.
    if not nrv_raw.empty:
        nrv_raw["ts"] = pd.to_datetime(nrv_raw["ts"])
        nrv_raw["nrv_mw"] = pd.to_numeric(nrv_raw["nrv_mw"], errors="coerce")
        nrv_hist = nrv_raw[nrv_raw["ts"] >= cutoff_daily].copy()
        nrv_hist["price_date"] = nrv_hist["ts"].dt.normalize()
        nrv_daily = nrv_hist.groupby("price_date")["nrv_mw"].mean().round(2)
        nrv_daily.name = "nrv_mean_mw"
        imbalance_daily = imbalance_daily.merge(nrv_daily, on="price_date", how="left")
    else:
        imbalance_daily["nrv_mean_mw"] = np.nan

    imbalance_daily["price_date"] = imbalance_daily["price_date"].dt.strftime("%Y-%m-%d")

    latest_row = raw.iloc[-1]
    today_str = latest_row["ts"].strftime("%Y-%m-%d")
    today_rows = raw[raw["ts"].dt.strftime("%Y-%m-%d") == today_str]["rebap_eur_mwh"]
    imbalance_latest = pd.DataFrame(
        [
            {
                "current_ts": latest_row["ts"].strftime("%Y-%m-%dT%H:%M:%S"),
                "rebap_eur_mwh": round(float(latest_row["rebap_eur_mwh"]), 2),
                "today_mean": round(float(today_rows.mean()), 2) if not today_rows.empty else None,
                "today_min": round(float(today_rows.min()), 2) if not today_rows.empty else None,
                "today_max": round(float(today_rows.max()), 2) if not today_rows.empty else None,
            }
        ]
    )

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


# ---------------------------------------------------------------------------
# Walk-forward reBAP signal
# ---------------------------------------------------------------------------

_SIGNAL_TRAIN = 252  # in-sample window (trading days)
_SIGNAL_MIN = 60  # minimum obs before first OOS prediction
_SIGNAL_COST = 2.0  # EUR/MWh round-trip transaction cost
# Features for the magnitude OLS (predict excess rebap above rolling mean). wind_err_lag1 and
# solar_err_lag1 were dropped 2026-08-19 (see module docstring) after revalidation on real
# reBAP showed neither survives; nrv_dev_lag1 replaced them.
_FEAT_NAMES = ["wind_fc_d", "rebap_dev_lag1", "nrv_dev_lag1"]


def _coef_stability(arr: np.ndarray) -> dict:
    m = float(np.mean(arr))
    s = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    cv = round(abs(s / m), 4) if m != 0 else None
    return {"mean": round(m, 4), "std": round(s, 4), "cv": cv}


def weekday_baseline_signs(
    dow: np.ndarray, y: np.ndarray, start: int, train: int = _SIGNAL_TRAIN
) -> np.ndarray:
    """Causal day-of-week baseline: predict each OOS day's excess sign from its weekday alone.

    For every ``t >= start`` the share of positive excesses per weekday is taken over the same
    trailing window the model trains on (``[max(0, t - train), t)``, so day ``t`` never sees
    itself), and the prediction is +1 when that share is at least one half, else -1. A
    weekday absent from the window falls back to +1, the naive baseline's call.

    It exists because ``imbalance-compare`` (2026-11-01) found this signal's excess accuracy
    is what the weekday alone delivers (0.612 vs 0.646 on 2024-01..2025-03), and a page that
    shows only the always-above-trend baseline overstates the model.

    Args:
        dow: Weekday per row, 0 = Monday.
        y: The target excess per row.
        start: First out-of-sample row.
        train: Trailing window length in rows.

    Returns:
        Array of +1/-1 predictions, one per row from ``start`` to the end.
    """
    if not 0 <= start <= len(y):
        raise ValueError(f"start must be within [0, {len(y)}], got {start}")
    pos = (np.asarray(y, dtype=float) > 0).astype(float)
    dow = np.asarray(dow)
    out = np.empty(len(y) - start)
    for i, t in enumerate(range(start, len(y))):
        t0 = max(0, t - train)
        same = dow[t0:t] == dow[t]
        out[i] = 1.0 if not same.any() or pos[t0:t][same].mean() >= 0.5 else -1.0
    return out


def compute_rebap_signal(db_query: Callable) -> dict:
    """Walk-forward OLS reBAP excess-above-trend signal.

    The reBAP LEVEL is structurally positive 92-99% of every year, so a level-based
    baseline is not informative about anything this model actually forecasts. This model
    instead forecasts the *excess* of reBAP above its 5-day trailing mean
    (rebap_excess = mean_eur - rebap_roll5). Position is +1 when the model predicts
    above-trend and -1 when below.

    Features (all available at D-1 gate close):
      wind_fc_d      D DA wind forecast %-of-load (published D-1)
      rebap_dev_lag1 D-1 deviation of reBAP from its 5-day mean (mean-reversion anchor)
      nrv_dev_lag1   D-1 deviation of mean NRV-Saldo from ITS 5-day mean (system-imbalance
                     anchor - added 2026-08-19, see docs/ROADMAP.md Phase 87)

    P&L is booked on the EXCESS, not the level (2026-08-19 fix - see module docstring):
    `model` and `naive_excess` are both scored against the excess, so they are directly
    comparable to accuracy_pct/naive_accuracy_pct, which are also measured on the excess.
    `structural_long` is reported separately: the always-positive strategy of holding the
    level unconditionally long. It is a real number (and a large Sharpe, because the level
    rarely goes negative) but it is not a competing signal - it answers a different question
    ("is reBAP usually positive") than this model does ("is today's reBAP above its own
    recent trend"), and must not be displayed as though the two were alternatives.
    """
    reb = db_query(
        "SELECT price_date::VARCHAR AS price_date, mean_eur, nrv_mean_mw "
        "FROM imbalance_daily ORDER BY price_date"
    )
    gen = db_query(
        "SELECT gen_date::VARCHAR AS gen_date, wind_pct "
        "FROM generation_forecast_daily WHERE zone='DE-LU' ORDER BY gen_date"
    )
    if reb is None or reb.empty or gen is None or gen.empty:
        return {}

    reb["price_date"] = pd.to_datetime(reb["price_date"])
    gen["gen_date"] = pd.to_datetime(gen["gen_date"])

    df = reb.merge(gen, left_on="price_date", right_on="gen_date", how="inner")
    df = df.sort_values("price_date").reset_index(drop=True)

    # Feature engineering - all D-1 gate-closure information
    df["wind_fc_d"] = df["wind_pct"]  # D's own DA forecast (known D-1)
    roll5 = df["mean_eur"].shift(1).rolling(5, min_periods=3).mean()
    df["rebap_roll5"] = roll5
    # D-1 deviation: yesterday's reBAP relative to its 5-day trailing mean
    df["rebap_dev_lag1"] = df["mean_eur"].shift(1) - roll5.shift(1)
    # D-1 deviation of NRV-Saldo from ITS OWN 5-day trailing mean, the same transform
    # applied to the system-imbalance series rather than the price - see docstring.
    nrv_roll5 = df["nrv_mean_mw"].shift(1).rolling(5, min_periods=3).mean()
    df["nrv_dev_lag1"] = df["nrv_mean_mw"].shift(1) - nrv_roll5.shift(1)
    # Target: how much TODAY's reBAP deviates from its 5-day trailing mean
    df["rebap_excess"] = df["mean_eur"] - roll5
    # Baseline unconditional positive rate (for display)
    df["pct_pos"] = (df["mean_eur"] > 0).astype(float)

    df = df.dropna(subset=_FEAT_NAMES + ["rebap_excess", "mean_eur"]).reset_index(drop=True)
    n = len(df)
    if n < _SIGNAL_MIN + 2:
        return {}

    y_excess = df["rebap_excess"].to_numpy(float)
    y_level = df["mean_eur"].to_numpy(float)
    X_raw = df[_FEAT_NAMES].to_numpy(float)
    X = np.column_stack([np.ones(n), X_raw])  # intercept + len(_FEAT_NAMES) features
    dates = df["price_date"]
    naive_pos_rate = round(float((y_level > 0).mean() * 100), 1)

    start = max(_SIGNAL_MIN, n - (_SIGNAL_TRAIN + 500))
    preds_excess, actuals_excess, actuals_level, date_list, coef_rows = [], [], [], [], []

    for t in range(start, n):
        t0 = max(0, t - _SIGNAL_TRAIN)
        c, _, _, _ = np.linalg.lstsq(X[t0:t], y_excess[t0:t], rcond=None)
        preds_excess.append(float(X[t] @ c))
        actuals_excess.append(float(y_excess[t]))
        actuals_level.append(float(y_level[t]))
        date_list.append(dates.iloc[t].strftime("%Y-%m-%d"))
        coef_rows.append(c[1:])  # drop intercept

    if not preds_excess:
        return {}

    preds_excess = np.array(preds_excess)
    actuals_excess = np.array(actuals_excess)
    actuals_level = np.array(actuals_level)
    coef_arr = np.array(coef_rows)  # (n_oos, len(_FEAT_NAMES))

    # Position: +1 when the model predicts above-trend, -1 when below.
    position = np.sign(preds_excess)

    # model / naive_excess: both booked on the EXCESS, so both are apples-to-apples with
    # accuracy_pct/naive_accuracy_pct (also excess-based). naive_excess always predicts a
    # positive excess - the honest baseline for a model whose whole job is calling the sign
    # of the excess, unlike "always long the level" which answers a different question.
    net_pnl = position * actuals_excess - _SIGNAL_COST * np.abs(position)
    naive_excess_pos = np.ones(len(position))
    naive_excess_pnl = naive_excess_pos * actuals_excess - _SIGNAL_COST

    # structural_long: always long the LEVEL, unconditionally. Reported separately (see
    # docstring) - large and mostly a restatement of "reBAP is usually positive", not a
    # comparator to the excess-timing strategies above.
    structural_pos = np.ones(len(position))
    structural_pnl = structural_pos * actuals_level - _SIGNAL_COST

    def sharpe(pnl):
        if pnl.std() == 0:
            return None
        return round(float(pnl.mean() / pnl.std() * np.sqrt(252)), 3)

    def max_dd(cum):
        roll_max = np.maximum.accumulate(cum)
        return round(float(np.min(cum - roll_max)), 2)

    cum_net = np.cumsum(net_pnl)
    cum_naive_excess = np.cumsum(naive_excess_pnl)
    cum_structural = np.cumsum(structural_pnl)

    # Direction accuracy on the EXCESS (above vs below trend) - apples-to-apples
    excess_accuracy = round(
        float(np.mean(np.sign(preds_excess) == np.sign(actuals_excess)) * 100), 1
    )
    # Naive excess accuracy: always predict positive excess (unconditionally optimistic)
    naive_excess_accuracy = round(float(np.mean(actuals_excess > 0) * 100), 1)
    # Weekday-only baseline on the same OOS days and window: the comparator the model has to
    # beat for its features to be adding anything beyond the calendar.
    weekday_signs = weekday_baseline_signs(
        df["price_date"].dt.dayofweek.to_numpy(), y_excess, start
    )
    weekday_accuracy = round(float(np.mean(weekday_signs == np.sign(actuals_excess)) * 100), 1)

    # Equity curve: model vs naive_excess only, both on the excess basis. structural_long is
    # a different question (see docstring) and is not plotted alongside them - a shared chart
    # would visually imply it is a comparator, which is exactly the confusion being fixed.
    step = max(1, len(date_list) // 200)
    equity = [
        {
            "date": date_list[i],
            "cum_net_pnl": round(float(cum_net[i]), 2),
            "cum_naive_pnl": round(float(cum_naive_excess[i]), 2),
        }
        for i in range(0, len(date_list), step)
    ]
    if date_list[-1] != equity[-1]["date"]:
        equity.append(
            {
                "date": date_list[-1],
                "cum_net_pnl": round(float(cum_net[-1]), 2),
                "cum_naive_pnl": round(float(cum_naive_excess[-1]), 2),
            }
        )

    def _signal_today_dict(t: int, c: np.ndarray) -> dict:
        pred = float(X[t] @ c)
        row = df.iloc[t]
        return {
            "gen_date": dates.iloc[t].strftime("%Y-%m-%d"),
            "pred_excess": round(pred, 2),
            "direction": "above-trend" if pred > 0 else "below-trend",
            "rebap_roll5": round(float(df.iloc[t]["rebap_roll5"]), 2),
            "wind_fc_d": round(float(row["wind_fc_d"]), 3),
            "rebap_dev_lag1": round(float(row["rebap_dev_lag1"]), 2),
            "nrv_dev_lag1": round(float(row["nrv_dev_lag1"]), 2),
        }

    # Fit on all available data and predict the final row as today's signal
    last_idx = start + len(preds_excess) - 1
    t_sig = min(last_idx + 1, n - 1)
    t0_sig = max(0, t_sig - _SIGNAL_TRAIN)
    c_sig, _, _, _ = np.linalg.lstsq(X[t0_sig:t_sig], y_excess[t0_sig:t_sig], rcond=None)
    signal_today = _signal_today_dict(t_sig, c_sig)

    return {
        "n_oos": int(len(preds_excess)),
        "accuracy_pct": excess_accuracy,
        "naive_accuracy_pct": naive_excess_accuracy,
        "weekday_accuracy_pct": weekday_accuracy,
        "naive_pos_rate_pct": naive_pos_rate,
        "cost_per_mwh": _SIGNAL_COST,
        "model": {
            "sharpe": sharpe(net_pnl),
            "cum_pnl": round(float(cum_net[-1]), 2),
            "max_dd_eur": max_dd(cum_net),
        },
        "naive_excess": {
            "sharpe": sharpe(naive_excess_pnl),
            "cum_pnl": round(float(cum_naive_excess[-1]), 2),
            "max_dd_eur": max_dd(cum_naive_excess),
        },
        "structural_long": {
            "sharpe": sharpe(structural_pnl),
            "cum_pnl": round(float(cum_structural[-1]), 2),
            "max_dd_eur": max_dd(cum_structural),
        },
        "coef": {name: _coef_stability(coef_arr[:, i]) for i, name in enumerate(_FEAT_NAMES)},
        "equity_curve": equity,
        "signal_today": signal_today,
    }
