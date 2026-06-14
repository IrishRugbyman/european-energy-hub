"""Spark/dark/fuel-switching spread analytics and prices table.

Uses market-data loaders (editable-installed). Constants match transforms/power.py.
"""

from __future__ import annotations

from datetime import date

import pandas as pd

GAS_EFF = 0.49
GAS_EF = 0.364
COAL_EFF = 0.36
COAL_EF = 0.96
COAL_MWH_PER_TONNE = 6.978


def build_spreads_tables() -> dict[str, pd.DataFrame]:
    """Return two DataFrames ready to write into energy_hub.duckdb."""
    start = date(2019, 1, 1)
    end = date.today()

    spreads_daily = _build_spreads(start, end)
    prices_daily = _build_prices(start, end)

    return {"spreads_daily": spreads_daily, "prices_daily": prices_daily}


def _build_spreads(start: date, end: date) -> pd.DataFrame:
    from loaders.spreads import load_spread_inputs

    empty = pd.DataFrame(columns=[
        "price_date", "power_de", "ttf", "eua", "coal_eur_mwh",
        "css", "cds", "fss", "regime_threshold",
    ])

    try:
        inputs = load_spread_inputs("DE-LU", start, end)
    except Exception:
        return empty

    if inputs.empty:
        return empty

    df = inputs.copy()
    df.index = pd.to_datetime(df.index)
    df["coal_eur_mwh"] = (df["coal_usd_t"] * df["eur_usd"]) / COAL_MWH_PER_TONNE
    df["css"] = df["power_eur_mwh"] - df["ttf_eur_mwh"] / GAS_EFF - df["eua_eur_tco2"] * GAS_EF
    df["cds"] = df["power_eur_mwh"] - df["coal_eur_mwh"] / COAL_EFF - df["eua_eur_tco2"] * COAL_EF
    df["fss"] = df["css"] - df["cds"]
    df["regime_threshold"] = df["fss"].apply(lambda x: "gas" if x > 0 else "coal")

    out = df.reset_index().rename(columns={
        "index": "price_date",
        "power_eur_mwh": "power_de",
        "ttf_eur_mwh": "ttf",
        "eua_eur_tco2": "eua",
    })
    return out[["price_date", "power_de", "ttf", "eua", "coal_eur_mwh",
                "css", "cds", "fss", "regime_threshold"]].copy()


def _build_prices(start: date, end: date) -> pd.DataFrame:
    from loaders._base import _query, get_read_conn
    from loaders.gas import load_ttf_daily
    from loaders.carbon import load_eua_daily, load_coal_daily

    empty = pd.DataFrame(columns=["price_date", "ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu"])

    series: dict[str, pd.Series] = {}
    for name, loader in [
        ("ttf_eur_mwh", lambda: load_ttf_daily(start, end)),
        ("eua_eur_t",   lambda: load_eua_daily(start, end)),
        ("coal_usd_t",  lambda: load_coal_daily(start, end)),
    ]:
        try:
            s = loader()
            if s is not None and not s.empty:
                series[name] = s
        except Exception:
            pass

    # Henry Hub: natgas_futures rank-1, product='NG', in USD/MMBtu
    try:
        conn = get_read_conn()
        hh = _query(
            conn,
            """
            SELECT price_date, settlement AS hh_usd_mmbtu
            FROM natgas_futures
            WHERE product = 'NG' AND contract_rank = 1
              AND price_date >= %s
            ORDER BY price_date
            """,
            [start.isoformat()],
        )
        conn.close()
        if not hh.empty:
            hh = hh.set_index("price_date")["hh_usd_mmbtu"]
            hh.index = pd.to_datetime(hh.index)
            series["hh_usd_mmbtu"] = hh
    except Exception:
        pass

    if not series:
        return empty

    df = pd.DataFrame(series).ffill().dropna(how="all")
    df.index = pd.to_datetime(df.index)
    out = df.reset_index().rename(columns={"index": "price_date"})
    for col in ["ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu"]:
        if col not in out.columns:
            out[col] = None
    return out[["price_date", "ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu"]].copy()
