"""Oracle battery dispatch against German reBAP prices.

Runs a simple LP for a 1 MW / 2 MWh battery day-by-day over the trailing 30 days
using realized hourly reBAP prices (oracle = perfect foresight of that day's prices).

Parameters mirror battery-dispatch/configs/de_lu_v1.json.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pulp

from loaders._base import _query, get_read_conn

# Battery physical parameters (from de_lu_v1 config)
POWER_MW         = 1.0
CAPACITY_MWH     = 2.0
EFF_CHARGE       = 0.92
EFF_DISCHARGE    = 0.92
SOC_INIT_FRAC    = 0.10
SOC_MIN_FRAC     = 0.10
MAX_CYCLES_DAY   = 1.5
DEGR_EUR_PER_MWH = 28.0     # degradation cost charged on each MWh charged
GRID_FEE         = 0.0
HURDLE           = 0.0       # oracle: no hurdle
TRAILING_DAYS    = 30


def build_battery_tables() -> dict[str, pd.DataFrame]:
    """Return battery_dispatch_recent ready for energy_hub.duckdb."""
    prices_df = _load_prices()
    if prices_df.empty:
        empty = pd.DataFrame(columns=[
            "ts", "rebap_price", "charge_mw", "discharge_mw", "soc_mwh", "cumulative_pnl_eur"
        ])
        return {"battery_dispatch_recent": empty, "battery_summary": pd.DataFrame()}

    dispatch_df = _oracle_dispatch(prices_df)
    summary_df  = _summarize(dispatch_df)
    return {"battery_dispatch_recent": dispatch_df, "battery_summary": summary_df}


def _load_prices() -> pd.DataFrame:
    """Load hourly reBAP prices for trailing 30 days from market_data."""
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT
                date_trunc('hour', ts) AS hour_ts,
                AVG(long_eur_mwh) AS price
            FROM imbalance_prices_de
            WHERE ts >= current_date - INTERVAL '31 days'
              AND long_eur_mwh IS NOT NULL
            GROUP BY hour_ts
            ORDER BY hour_ts
            """,
        )
        conn.close()
    except Exception:
        return pd.DataFrame()

    if df.empty:
        return df
    df["hour_ts"] = pd.to_datetime(df["hour_ts"])
    return df


def _dispatch_day(prices: np.ndarray, soc_start: float) -> dict:
    """Solve battery LP for one day (24 hours). Returns schedule dict."""
    H = len(prices)
    soc_min = SOC_MIN_FRAC * CAPACITY_MWH
    marginal = DEGR_EUR_PER_MWH + GRID_FEE + HURDLE
    max_charge_mwh = MAX_CYCLES_DAY * CAPACITY_MWH  # daily throughput cap

    prob = pulp.LpProblem("bat_day", pulp.LpMaximize)

    c = [pulp.LpVariable(f"c{h}", lowBound=0, upBound=POWER_MW) for h in range(H)]
    d = [pulp.LpVariable(f"d{h}", lowBound=0, upBound=POWER_MW) for h in range(H)]
    soc = [pulp.LpVariable(f"s{h}", lowBound=soc_min, upBound=CAPACITY_MWH) for h in range(H + 1)]

    prob += pulp.lpSum(
        (d[h] * EFF_DISCHARGE - c[h]) * float(prices[h]) - marginal * c[h]
        for h in range(H)
    )

    prob += soc[0] == soc_start
    for h in range(H):
        prob += soc[h + 1] == soc[h] + c[h] * EFF_CHARGE - d[h]
    prob += pulp.lpSum(c[h] for h in range(H)) <= max_charge_mwh

    status = prob.solve(pulp.PULP_CBC_CMD(msg=0))
    if status != pulp.LpStatusOptimal:
        return {
            "charge": np.zeros(H),
            "discharge": np.zeros(H),
            "soc": np.full(H + 1, soc_start),
            "profit": 0.0,
        }

    return {
        "charge":    np.array([pulp.value(c[h]) or 0.0 for h in range(H)]),
        "discharge": np.array([pulp.value(d[h]) or 0.0 for h in range(H)]),
        "soc":       np.array([pulp.value(soc[h]) or 0.0 for h in range(H + 1)]),
        "profit":    pulp.value(prob.objective) or 0.0,
    }


def _oracle_dispatch(prices_df: pd.DataFrame) -> pd.DataFrame:
    """Run oracle LP day by day, return hourly DataFrame with dispatch + cumulative P&L."""
    prices_df = prices_df.copy().set_index("hour_ts").sort_index()

    # Keep only complete 24h days
    dates = sorted(set(prices_df.index.date))

    soc = SOC_INIT_FRAC * CAPACITY_MWH
    cum_pnl = 0.0
    rows = []

    for day in dates:
        day_df = prices_df[prices_df.index.date == day]
        if len(day_df) < 24:
            continue  # skip partial days

        p = day_df["price"].to_numpy()
        result = _dispatch_day(p, soc)

        soc = float(result["soc"][-1])
        for h, ts in enumerate(day_df.index):
            ch = float(result["charge"][h])
            dh = float(result["discharge"][h])
            price = float(p[h])
            hour_pnl = (dh * EFF_DISCHARGE - ch) * price - DEGR_EUR_PER_MWH * ch
            cum_pnl += hour_pnl
            rows.append({
                "ts":              ts,
                "rebap_price":     round(price, 2),
                "charge_mw":       round(ch, 4),
                "discharge_mw":    round(dh, 4),
                "soc_mwh":         round(float(result["soc"][h]), 4),
                "cumulative_pnl_eur": round(cum_pnl, 2),
            })

    if not rows:
        return pd.DataFrame(columns=[
            "ts", "rebap_price", "charge_mw", "discharge_mw", "soc_mwh", "cumulative_pnl_eur"
        ])

    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"])
    return df


def _summarize(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["key", "value"])

    total_pnl    = df["cumulative_pnl_eur"].iloc[-1]
    n_charge     = int((df["charge_mw"] > 0.01).sum())
    n_discharge  = int((df["discharge_mw"] > 0.01).sum())
    charge_hrs   = df[df["charge_mw"] > 0.01]
    disch_hrs    = df[df["discharge_mw"] > 0.01]
    avg_buy      = charge_hrs["rebap_price"].mean() if not charge_hrs.empty else 0.0
    avg_sell     = disch_hrs["rebap_price"].mean() if not disch_hrs.empty else 0.0
    avg_spread   = avg_sell - avg_buy

    return pd.DataFrame([
        {"key": "total_pnl_eur",         "value": str(round(total_pnl, 2))},
        {"key": "n_charge_hours",         "value": str(n_charge)},
        {"key": "n_discharge_hours",      "value": str(n_discharge)},
        {"key": "avg_spread_captured_eur","value": str(round(avg_spread, 2))},
        {"key": "avg_buy_price_eur",      "value": str(round(avg_buy, 2))},
        {"key": "avg_sell_price_eur",     "value": str(round(avg_sell, 2))},
        {"key": "trailing_days",          "value": str(TRAILING_DAYS)},
    ])
