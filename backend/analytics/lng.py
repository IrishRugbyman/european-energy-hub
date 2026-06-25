"""EU LNG terminal analytics.

Reads from market_data.lng_storage (PostgreSQL) and produces:
- lng_history: full daily series per country + EU aggregate
- lng_latest:  latest-day snapshot with d7 and vs-5yr-avg stats
- lng_seasonal: 5-year min/avg/max band keyed on day-of-year
- lng_trend:   EU aggregate trailing 365-day send-out trend
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from loaders._base import _query, get_read_conn  # type: ignore[import]


_COUNTRIES = ["BE", "DE", "ES", "FI", "FR", "GR", "HR", "IT", "LT", "NL", "PL", "PT"]

_COUNTRY_NAMES = {
    "BE": "Belgium",
    "DE": "Germany",
    "ES": "Spain",
    "FI": "Finland",
    "FR": "France",
    "GR": "Greece",
    "HR": "Croatia",
    "IT": "Italy",
    "LT": "Lithuania",
    "NL": "Netherlands",
    "PL": "Poland",
    "PT": "Portugal",
}


def build_lng_tables() -> dict:
    """Return all LNG analytics tables as DataFrames."""
    conn = get_read_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT gas_day, country, inventory_gwh, sendout_gwh, dtmi_gwh, dtrs_gwh
        FROM lng_storage
        ORDER BY gas_day, country
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        empty = pd.DataFrame()
        return {
            "lng_history": empty,
            "lng_latest": empty,
            "lng_seasonal": empty,
            "lng_trend": empty,
        }

    df = pd.DataFrame(rows, columns=["gas_day", "country", "inventory_gwh", "sendout_gwh", "dtmi_gwh", "dtrs_gwh"])
    df["gas_day"] = pd.to_datetime(df["gas_day"]).dt.date

    # Drop rows where all metrics are null (some countries have gaps)
    df = df.dropna(subset=["inventory_gwh", "sendout_gwh"], how="all").copy()

    # EU aggregate: sum inventory and capacity; dtmi is max storage capacity
    eu = (
        df.groupby("gas_day", as_index=False)
        .agg(
            inventory_gwh=("inventory_gwh", "sum"),
            sendout_gwh=("sendout_gwh", "sum"),
            dtmi_gwh=("dtmi_gwh", "sum"),
            dtrs_gwh=("dtrs_gwh", "sum"),
        )
    )
    eu["country"] = "EU"
    df = pd.concat([df, eu], ignore_index=True)

    df["fill_pct"] = (df["inventory_gwh"] / df["dtmi_gwh"].replace(0, float("nan")) * 100).round(2)
    df["sendout_util_pct"] = (df["sendout_gwh"] / df["dtrs_gwh"].replace(0, float("nan")) * 100).round(2)

    # Seasonal bands: 5 full prior calendar years
    today = date.today()
    band_years = list(range(today.year - 5, today.year))
    seasonal_df = df[df["gas_day"].apply(lambda d: d.year in band_years)].copy()
    seasonal_df["doy"] = [d.timetuple().tm_yday for d in seasonal_df["gas_day"]]

    lng_seasonal = (
        seasonal_df.groupby(["country", "doy"], as_index=False)
        .agg(
            avg5_sendout=("sendout_gwh", "mean"),
            min5_sendout=("sendout_gwh", "min"),
            max5_sendout=("sendout_gwh", "max"),
            avg5_fill=("fill_pct", "mean"),
            min5_fill=("fill_pct", "min"),
            max5_fill=("fill_pct", "max"),
        )
        .round(2)
    )

    # lng_latest: latest gas_day per country + d7 change + vs 5yr avg
    latest_dates = df.groupby("country")["gas_day"].max()
    latest_rows = []
    for country, gas_day in latest_dates.items():
        row = df[(df["country"] == country) & (df["gas_day"] == gas_day)].iloc[0].to_dict()
        doy = gas_day.timetuple().tm_yday

        # 7-day change in send-out
        d7_date = df[(df["country"] == country) & (df["gas_day"] <= _offset_date(gas_day, -7))]
        d7_sendout = d7_date.iloc[-1]["sendout_gwh"] if not d7_date.empty else None
        row["d7_sendout_gwh"] = (row["sendout_gwh"] - d7_sendout) if (d7_sendout is not None and row["sendout_gwh"] is not None) else None

        # vs 5yr avg send-out at same day-of-year
        seas = lng_seasonal[(lng_seasonal["country"] == country) & (lng_seasonal["doy"] == doy)]
        avg5 = seas.iloc[0]["avg5_sendout"] if not seas.empty else None
        row["vs_avg5_sendout"] = (row["sendout_gwh"] - avg5) if (avg5 is not None and row["sendout_gwh"] is not None) else None
        row["avg5_sendout"] = avg5

        latest_rows.append(row)

    lng_latest = pd.DataFrame(latest_rows).round(2)

    # lng_trend: EU aggregate trailing 365 days
    eu_df = df[df["country"] == "EU"].sort_values("gas_day")
    eu_seas = lng_seasonal[lng_seasonal["country"] == "EU"].set_index("doy")
    eu_recent = eu_df[eu_df["gas_day"] >= _offset_date(today, -365)].copy()
    eu_recent["doy"] = [d.timetuple().tm_yday for d in eu_recent["gas_day"]]
    eu_recent["avg5_sendout"] = eu_recent["doy"].map(lambda d: eu_seas.loc[d, "avg5_sendout"] if d in eu_seas.index else None)
    eu_recent = eu_recent.drop(columns=["country", "doy"]).round(2)
    lng_trend = eu_recent

    # lng_history: last 2 years per country for country drill-down charts
    lng_history = df[df["gas_day"] >= _offset_date(today, -730)].copy()

    return {
        "lng_history": lng_history,
        "lng_latest": lng_latest,
        "lng_seasonal": lng_seasonal,
        "lng_trend": lng_trend,
    }


def _offset_date(d: date, days: int) -> date:
    from datetime import timedelta
    return d + timedelta(days=days)
