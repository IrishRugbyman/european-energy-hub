"""US natural gas storage analytics: EIA weekly regional storage (Bcf).

Reads natgas_storage from the PostgreSQL market_data database.
Produces three DuckDB tables:
  us_storage_latest  - one row per region + US-48 aggregate with derived stats
  us_storage_history - long-format weekly series per region (current year + trailing 3yr)
  us_storage_seasonal - 5-year DOY band per region (avg5, min5, max5) for the fan chart
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn

# EIA series ID -> display region name
SERIES_REGION: dict[str, str] = {
    "NW2_EPG0_SWO_R31_BCF": "East",
    "NW2_EPG0_SWO_R32_BCF": "Midwest",
    "NW2_EPG0_SWO_R33_BCF": "Mountain",
    "NW2_EPG0_SWO_R34_BCF": "Pacific",
    "NW2_EPG0_SWO_R35_BCF": "South Central",
    "NW2_EPG0_SWO_R48_BCF": "US-48",
}

REGION_SERIES: dict[str, str] = {v: k for k, v in SERIES_REGION.items()}

_5YR_SERIES = list(SERIES_REGION.keys())


def build_us_storage_tables() -> dict[str, pd.DataFrame]:
    """Return DataFrames ready to write into energy_hub.duckdb.

    Returns:
        {
            'us_storage_latest': one row per region with derived market stats,
            'us_storage_history': long-format weekly series per region,
            'us_storage_seasonal': 5-year weekly band (avg5, min5, max5) per region,
        }
    """
    conn = get_read_conn()
    raw = _query(
        conn,
        """
        SELECT week_date, series, value_bcf
        FROM natgas_storage
        WHERE series = ANY(%s)
        ORDER BY week_date, series
        """,
        [_5YR_SERIES],
    )
    conn.close()

    if raw.empty:
        empty = pd.DataFrame()
        return {
            "us_storage_latest": empty,
            "us_storage_history": empty,
            "us_storage_seasonal": empty,
        }

    raw["week_date"] = pd.to_datetime(raw["week_date"])
    raw["region"] = raw["series"].map(SERIES_REGION)
    raw = raw.dropna(subset=["region"])

    latest = _build_latest(raw)
    history = _build_history(raw)
    seasonal = _build_seasonal(raw)

    return {
        "us_storage_latest": latest,
        "us_storage_history": history,
        "us_storage_seasonal": seasonal,
    }


def _build_seasonal(raw: pd.DataFrame) -> pd.DataFrame:
    """5-year avg/min/max by week-of-year per region."""
    raw = raw.copy()
    raw["woy"] = raw["week_date"].dt.isocalendar().week.astype(int)
    raw["year"] = raw["week_date"].dt.year

    max_year = raw["week_date"].dt.year.max()
    # Trailing 5 full calendar years (excludes partial current year)
    history5 = raw[raw["year"].between(max_year - 5, max_year - 1)]

    seasonal = (
        history5.groupby(["region", "woy"])["value_bcf"]
        .agg(avg5="mean", min5="min", max5="max")
        .reset_index()
    )
    seasonal.columns = ["region", "week_of_year", "avg5", "min5", "max5"]
    return seasonal


def _build_latest(raw: pd.DataFrame) -> pd.DataFrame:
    """One row per region with all derived market stats."""
    results = []
    for region, grp in raw.groupby("region"):
        grp = grp.sort_values("week_date")
        if grp.empty:
            continue

        latest_row = grp.iloc[-1]
        week_date = latest_row["week_date"]
        value_bcf = latest_row["value_bcf"]

        # Week-on-week change
        prev_week = grp.iloc[-2]["value_bcf"] if len(grp) >= 2 else None
        week_change_bcf = float(value_bcf - prev_week) if prev_week is not None else None

        # Year-over-year comparison (same week last year, +/- 1 week tolerance)
        yoy_row = _find_yoy(grp, week_date)
        yoy_bcf = float(value_bcf - yoy_row) if yoy_row is not None else None

        # 5-year average at same week of year
        woy = int(week_date.isocalendar()[1])
        max_year = int(week_date.year)
        history5 = grp[grp["week_date"].dt.year.between(max_year - 5, max_year - 1)].copy()
        history5["woy"] = history5["week_date"].dt.isocalendar().week.astype(int)
        same_woy = history5[history5["woy"].between(woy - 1, woy + 1)]

        avg5_bcf = float(same_woy["value_bcf"].mean()) if not same_woy.empty else None
        min5_bcf = float(same_woy["value_bcf"].min()) if not same_woy.empty else None
        max5_bcf = float(same_woy["value_bcf"].max()) if not same_woy.empty else None

        vs_avg5_bcf = float(value_bcf - avg5_bcf) if avg5_bcf is not None else None
        vs_avg5_pct = float((value_bcf - avg5_bcf) / avg5_bcf * 100) if avg5_bcf else None
        # Implied fill: current vs 5yr max at same week (proxy for % full)
        implied_fill_pct = float(value_bcf / max5_bcf * 100) if max5_bcf else None

        results.append({
            "region": str(region),
            "week_date": week_date.date(),
            "value_bcf": float(value_bcf),
            "week_change_bcf": week_change_bcf,
            "yoy_bcf": yoy_bcf,
            "vs_avg5_bcf": vs_avg5_bcf,
            "vs_avg5_pct": vs_avg5_pct,
            "implied_fill_pct": implied_fill_pct,
            "avg5_bcf": avg5_bcf,
            "min5_bcf": min5_bcf,
            "max5_bcf": max5_bcf,
        })

    return pd.DataFrame(results)


def _find_yoy(grp: pd.DataFrame, ref_date: pd.Timestamp) -> float | None:
    """Find the Bcf value ~52 weeks ago (+/- 2 weeks tolerance)."""
    target = ref_date - pd.DateOffset(weeks=52)
    mask = (grp["week_date"] >= target - pd.Timedelta(days=14)) & (
        grp["week_date"] <= target + pd.Timedelta(days=14)
    )
    candidates = grp.loc[mask].copy()
    if candidates.empty:
        return None
    candidates["dist"] = (candidates["week_date"] - target).abs()
    return float(candidates.sort_values("dist").iloc[0]["value_bcf"])


def _build_history(raw: pd.DataFrame) -> pd.DataFrame:
    """Long-format weekly series per region for the drill-down chart (all history)."""
    df = raw[["region", "week_date", "value_bcf"]].copy()
    df["week_date"] = df["week_date"].dt.date
    df = df.sort_values(["region", "week_date"])
    return df
