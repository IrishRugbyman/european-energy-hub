"""Gas storage analytics: seasonal band, latest snapshot, EU aggregate.

Reads gas_storage from the PostgreSQL market_data database; the rest is
pure-function transforms on DataFrames.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from loaders._base import _query, get_read_conn
from loaders.gas import load_facility_latest
from loaders.worldmonitor import load_storage_facilities

_WM_TO_AGSI_PATH = Path(__file__).resolve().parent / "wm_to_agsi.json"

# Facilities present in AGSI+ but absent from storage_facilities_wm.
# Fields: id, name, operator, country, lat, lon, capacity_twh, agsi_eic
_AGSI_NATIVE_FACILITIES = [
    # Romania - 6 additional Romgaz/Depomures sites beyond Targu Mures
    ("urziceni",        "Urziceni Gas Storage",       "Romgaz",             "RO",  44.71,  26.63,  1.5,  "21Z0000000003103"),
    ("bilciuresti",     "Bilciuresti Gas Storage",    "Depomures",          "RO",  44.83,  25.43,  3.2,  "21Z000000000313Y"),
    ("balaceanca",      "Balaceanca Gas Storage",     "Depomures",          "RO",  44.37,  26.17,  0.8,  "21Z0000000003111"),
    ("sarmashel",       "Sarmashel Gas Storage",      "Romgaz",             "RO",  46.78,  24.12,  2.4,  "21Z000000000314W"),
    ("ghercesti",       "Ghercesti Gas Storage",      "Romgaz",             "RO",  44.13,  23.82,  1.7,  "21Z000000000315U"),
    ("cetatea-de-balta","Cetatea de Balta Gas Storage","Romgaz",            "RO",  46.22,  24.15,  0.8,  "21Z000000000316S"),
    # Hungary - Szorek-1 (MOL) separate from the MFGT VGS pool
    ("szorek-1",        "Szorek-1 Gas Storage",       "MOL",                "HU",  46.20,  20.23,  3.5,  "21W000000000086O"),
    # Poland - Wierzchowice, large depleted-field facility (PGNiG)
    ("wierzchowice",    "Wierzchowice Gas Storage",   "PGNiG",              "PL",  51.56,  17.03,  8.6,  "21Z000000000381H"),
    # Germany - Uniper facilities near Munich not in WM
    ("breitbrunn",      "Breitbrunn Gas Storage",     "Uniper",             "DE",  48.08,  12.25,  7.2,  "21W0000000000605"),
    ("wolfersberg",     "Wolfersberg Gas Storage",    "Uniper",             "DE",  48.12,  12.27,  1.8,  "21W0000000000184"),
    ("inzenham-west",   "Inzenham-West Gas Storage",  "Uniper",             "DE",  48.05,  12.32,  3.0,  "21W0000000000192"),
    ("schmidhausen",    "Schmidhausen Gas Storage",   "Erdgas Sudbayern",   "DE",  48.35,  12.43,  2.0,  "21W000000000089I"),
    # Czech Republic - Dolni Bojanovice (MND), not in WM
    ("dolni-bojanovice","Dolni Bojanovice Gas Storage","MND Energy Storage", "CZ",  48.85,  17.08,  0.8,  "21W000000000074V"),
]


def build_storage_tables() -> dict[str, pd.DataFrame]:
    """Return DataFrames ready to write into energy_hub.duckdb.

    Returns: {
        'storage_history': long-format daily series per country + EU,
        'storage_seasonal': 5-year DOY fill% band per country + EU,
        'storage_latest': one row per country + EU with derived stats,
        'storage_injection_seasonal': 5-year DOY injection-rate band per country + EU,
    }
    """
    conn = get_read_conn()
    raw = _query(
        conn,
        """
        SELECT country, gas_day, "full" AS full_pct, injection, withdrawal, working_gas_volume
        FROM gas_storage
        WHERE "full" IS NOT NULL
        ORDER BY country, gas_day
        """,
    )
    conn.close()

    if raw.empty:
        empty = pd.DataFrame()
        return {
            "storage_history": empty,
            "storage_seasonal": empty,
            "storage_latest": empty,
            "storage_injection_seasonal": empty,
        }

    raw["gas_day"] = pd.to_datetime(raw["gas_day"]).dt.date

    # EU aggregate (working-gas-volume weighted fill)
    eu = _build_eu_aggregate(raw)
    combined = pd.concat([raw, eu], ignore_index=True)

    history = combined[["country", "gas_day", "full_pct", "injection", "withdrawal", "working_gas_volume"]].copy()

    seasonal = _build_seasonal(combined)
    latest = _build_latest(combined, seasonal)
    injection_seasonal = _build_injection_seasonal(combined)

    return {
        "storage_history": history,
        "storage_seasonal": seasonal,
        "storage_latest": latest,
        "storage_injection_seasonal": injection_seasonal,
    }


def _build_eu_aggregate(df: pd.DataFrame) -> pd.DataFrame:
    """Working-gas-volume-weighted EU aggregate."""
    df2 = df.dropna(subset=["working_gas_volume", "full_pct"]).copy()
    df2 = df2[df2["working_gas_volume"] > 0]

    grp = df2.groupby("gas_day")
    eu_rows = []
    for day, g in grp:
        wgv_total = g["working_gas_volume"].sum()
        # full_pct is already a 0-100 percentage of capacity; compute capacity-weighted mean
        weighted_full = (g["full_pct"] * g["working_gas_volume"]).sum() / wgv_total if wgv_total > 0 else None
        eu_rows.append({
            "country": "EU",
            "gas_day": day,
            "full_pct": weighted_full,
            "injection": g["injection"].sum(),
            "withdrawal": g["withdrawal"].sum(),
            "working_gas_volume": wgv_total,
        })
    return pd.DataFrame(eu_rows)


def _build_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year DOY band per country.

    Uses the 5 most recent complete calendar years (Jan 1 - Dec 31 with data).
    """
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["doy"] = df["gas_day"].dt.dayofyear

    current_year = pd.Timestamp.now().year
    # Complete calendar years only
    complete_years = sorted(
        [y for y in df["year"].unique() if y < current_year],
        reverse=True,
    )[:5]

    if not complete_years:
        return pd.DataFrame(columns=["country", "doy", "avg5", "min5", "max5"])

    band_df = df[df["year"].isin(complete_years)].copy()
    seasonal = (
        band_df.groupby(["country", "doy"])["full_pct"]
        .agg(avg5="mean", min5="min", max5="max")
        .reset_index()
    )
    seasonal = seasonal.dropna(subset=["avg5"])
    return seasonal


def _build_injection_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year DOY injection-rate band per country.

    Uses the 5 most recent complete calendar years (same as _build_seasonal).
    Only includes days where injection > 0 (i.e., injection season; winter withdrawal is excluded).
    Returns (country, doy, avg_gwh_d, p25_gwh_d, p75_gwh_d).
    """
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])
    df["year"] = df["gas_day"].dt.year
    df["doy"] = df["gas_day"].dt.dayofyear

    current_year = pd.Timestamp.now().year
    complete_years = sorted(
        [y for y in df["year"].unique() if y < current_year],
        reverse=True,
    )[:5]

    if not complete_years:
        return pd.DataFrame(columns=["country", "doy", "avg_gwh_d", "p25_gwh_d", "p75_gwh_d"])

    band_df = df[df["year"].isin(complete_years)].copy()
    # Include all days (injection=0 during withdrawal season is valid data)
    band_df = band_df.dropna(subset=["injection"])

    if band_df.empty:
        return pd.DataFrame(columns=["country", "doy", "avg_gwh_d", "p25_gwh_d", "p75_gwh_d"])

    seasonal = (
        band_df.groupby(["country", "doy"])["injection"]
        .agg(
            avg_gwh_d="mean",
            p25_gwh_d=lambda x: x.quantile(0.25),
            p75_gwh_d=lambda x: x.quantile(0.75),
        )
        .reset_index()
    )
    seasonal = seasonal.dropna(subset=["avg_gwh_d"])
    return seasonal


def _build_latest(df: pd.DataFrame, seasonal: pd.DataFrame) -> pd.DataFrame:
    """One row per country/EU with current fill + deltas."""
    df = df.copy()
    df["gas_day"] = pd.to_datetime(df["gas_day"])

    rows = []
    for country, grp in df.groupby("country"):
        grp = grp.sort_values("gas_day")
        if grp.empty:
            continue
        latest_row = grp.iloc[-1]
        latest_day = latest_row["gas_day"]
        latest_full = latest_row["full_pct"]

        # 7-day change
        past7 = grp[grp["gas_day"] <= latest_day - pd.Timedelta(days=7)]
        d7_pct = (latest_full - past7.iloc[-1]["full_pct"]) if not past7.empty else None

        # YoY
        past_yoy = grp[grp["gas_day"] <= latest_day - pd.Timedelta(days=365)]
        yoy_pct = (latest_full - past_yoy.iloc[-1]["full_pct"]) if not past_yoy.empty else None

        # vs 5yr average
        doy = latest_day.dayofyear
        sea = seasonal[(seasonal["country"] == country) & (seasonal["doy"] == doy)]
        vs_avg5_pct = (latest_full - float(sea["avg5"].iloc[0])) if not sea.empty else None

        rows.append({
            "country": country,
            "gas_day": latest_day.date(),
            "full_pct": latest_full,
            "d7_pct": d7_pct,
            "vs_avg5_pct": vs_avg5_pct,
            "yoy_pct": yoy_pct,
            "injection": latest_row["injection"],
            "withdrawal": latest_row["withdrawal"],
            "working_gas_volume": latest_row["working_gas_volume"],
        })

    return pd.DataFrame(rows)


def build_facilities_table() -> pd.DataFrame:
    """Return UGS facility reference data for the /gas map layer.

    Reads storage_facilities_wm (facility_type='ugs') from market_data PostgreSQL,
    joins per-facility fill % from gas_storage_facility where an AGSI EIC mapping exists,
    and returns a DataFrame with id, name, operator, country, lat, lon, capacity_twh, fill_pct.
    """
    df = load_storage_facilities(facility_type="ugs")
    if df.empty:
        return pd.DataFrame(
            columns=["id", "name", "operator", "country", "lat", "lon", "capacity_twh", "fill_pct"]
        )
    cols = ["id", "name", "operator", "country", "lat", "lon", "capacity_twh"]
    df = df[cols].dropna(subset=["lat", "lon"]).reset_index(drop=True)

    # Load WM-id -> AGSI EIC mapping
    with open(_WM_TO_AGSI_PATH) as fh:
        wm_to_agsi: dict[str, str] = json.load(fh)

    df["agsi_eic"] = df["id"].map(wm_to_agsi)

    # Append AGSI-native facilities absent from WM (hardcoded with coordinates)
    native_rows = [
        {
            "id": r[0], "name": r[1], "operator": r[2], "country": r[3],
            "lat": r[4], "lon": r[5], "capacity_twh": r[6], "agsi_eic": r[7],
        }
        for r in _AGSI_NATIVE_FACILITIES
        if r[0] not in df["id"].values
    ]
    if native_rows:
        df = pd.concat([df, pd.DataFrame(native_rows)], ignore_index=True)

    eics = df["agsi_eic"].dropna().tolist()

    fill_pct_by_eic: dict[str, float] = {}
    if eics:
        try:
            latest_df = load_facility_latest(eics)
            for row in latest_df.itertuples():
                if row.full_pct is not None:
                    fill_pct_by_eic[row.eic] = float(row.full_pct)
        except Exception:
            pass  # fall back to null; frontend uses country fill

    df["fill_pct"] = df["agsi_eic"].map(fill_pct_by_eic)
    return df.drop(columns=["agsi_eic"])
