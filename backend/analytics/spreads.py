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

# Zones to include in the multi-zone spreads table.
# All use TTF as the gas reference (standard EU practice).
SPREAD_ZONES = ["DE-LU", "FR", "NL", "IT-NORD", "BE", "AT"]


def build_spreads_tables() -> dict[str, pd.DataFrame]:
    """Return DataFrames ready to write into energy_hub.duckdb."""
    start = date(2019, 1, 1)
    end = date.today()

    spreads_daily = _build_spreads(start, end)
    prices_daily = _build_prices(start, end)
    multi_zone_spreads = _build_multi_zone_spreads(start, end)
    ttf_curve = _build_ttf_curve()

    return {
        "spreads_daily": spreads_daily,
        "prices_daily": prices_daily,
        "multi_zone_spreads": multi_zone_spreads,
        "ttf_curve": ttf_curve,
    }


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


_NBP_MWH_PER_MMBTU = 0.29307  # 1 MMBtu = 293.07 kWh = 0.29307 MWh


def _build_prices(start: date, end: date) -> pd.DataFrame:
    from loaders._base import _query, get_read_conn
    from loaders.gas import load_ttf_daily, load_nbp_daily
    from loaders.carbon import load_eua_daily, load_coal_daily
    from loaders.fx import load_eur_usd_daily

    empty = pd.DataFrame(columns=[
        "price_date", "ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu", "nbp_eur_mwh", "hh_eur_mwh",
    ])

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

    # NBP + HH: load EUR/USD once, use for both conversions
    try:
        eur_usd = load_eur_usd_daily(start, end)

        nbp_raw = load_nbp_daily(start, end)
        if nbp_raw is not None and not nbp_raw.empty:
            nbp_aligned = nbp_raw.reindex(eur_usd.index).ffill()
            # price_eur_mwh = price_usd_mmbtu * eur_usd / mwh_per_mmbtu
            nbp_eur = (nbp_aligned * eur_usd / _NBP_MWH_PER_MMBTU).rename("nbp_eur_mwh")
            series["nbp_eur_mwh"] = nbp_eur.dropna()

        if "hh_usd_mmbtu" in series:
            hh_aligned = series["hh_usd_mmbtu"].reindex(eur_usd.index).ffill()
            hh_eur = (hh_aligned * eur_usd / _NBP_MWH_PER_MMBTU).rename("hh_eur_mwh")
            series["hh_eur_mwh"] = hh_eur.dropna()
    except Exception:
        pass

    if not series:
        return empty

    df = pd.DataFrame(series).ffill().dropna(how="all")
    df.index = pd.to_datetime(df.index)
    out = df.reset_index().rename(columns={"index": "price_date"})
    for col in ["ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu", "nbp_eur_mwh", "hh_eur_mwh"]:
        if col not in out.columns:
            out[col] = None
    return out[["price_date", "ttf_eur_mwh", "eua_eur_t", "coal_usd_t", "hh_usd_mmbtu", "nbp_eur_mwh", "hh_eur_mwh"]].copy()


def _build_multi_zone_spreads(start: date, end: date) -> pd.DataFrame:
    """CSS/CDS/FSS for each zone in SPREAD_ZONES using TTF as the common gas reference."""
    from loaders.spreads import load_spread_inputs

    empty = pd.DataFrame(columns=["price_date", "zone", "power_eur_mwh",
                                   "css", "cds", "fss", "regime_threshold"])
    frames: list[pd.DataFrame] = []

    for zone in SPREAD_ZONES:
        try:
            inputs = load_spread_inputs(zone, start, end)
        except Exception:
            continue
        if inputs.empty:
            continue

        df = inputs.copy()
        df.index = pd.to_datetime(df.index)
        coal_eur_mwh = (df["coal_usd_t"] * df["eur_usd"]) / COAL_MWH_PER_TONNE
        css = df["power_eur_mwh"] - df["ttf_eur_mwh"] / GAS_EFF - df["eua_eur_tco2"] * GAS_EF
        cds = df["power_eur_mwh"] - coal_eur_mwh / COAL_EFF - df["eua_eur_tco2"] * COAL_EF
        fss = css - cds

        zone_df = pd.DataFrame({
            "price_date": df.index,
            "zone": zone,
            "power_eur_mwh": df["power_eur_mwh"].values,
            "css": css.round(4).values,
            "cds": cds.round(4).values,
            "fss": fss.round(4).values,
            "regime_threshold": fss.apply(lambda x: "gas" if x > 0 else "coal").values,
        })
        frames.append(zone_df)

    if not frames:
        return empty

    out = pd.concat(frames, ignore_index=True)
    out["price_date"] = pd.to_datetime(out["price_date"]).dt.date
    return out


# Month offset within year for sorting contracts by delivery start
_TENOR_MONTH = {
    "Q1": 1, "Q2": 4, "Q3": 7, "Q4": 10,
    "SUM": 4, "WIN": 10, "CAL": 1,
}


def _contract_sort_key(contract: str) -> int:
    """Sort TTF curve contracts by approximate delivery start (year*100 + month)."""
    parts = contract.split("-")
    if len(parts) != 2:
        return 999999
    tenor, yr_str = parts
    try:
        year = 2000 + int(yr_str)
    except ValueError:
        return 999999
    month = _TENOR_MONTH.get(tenor, 6)
    # CAL maps to month 1 (January start), placing it after WIN of the prior year (month 10).
    return year * 100 + month


def _build_ttf_curve() -> pd.DataFrame:
    """Return latest TTF forward curve snapshot, sorted by delivery date."""
    from loaders._base import _query, get_read_conn

    empty = pd.DataFrame(columns=["contract", "settlement", "tenor_type", "sort_key"])
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT contract, settlement
            FROM ttf_curve
            WHERE price_date = (SELECT MAX(price_date) FROM ttf_curve)
            ORDER BY contract
            """,
            [],
        )
        conn.close()
    except Exception:
        return empty

    if df.empty:
        return empty

    df["sort_key"] = df["contract"].apply(_contract_sort_key)
    df["tenor_type"] = df["contract"].apply(
        lambda c: c.split("-")[0] if "-" in c else "OTHER"
    )
    df = df.sort_values("sort_key").reset_index(drop=True)
    return df[["contract", "settlement", "tenor_type", "sort_key"]].copy()
