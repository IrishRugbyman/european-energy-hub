"""Physical gas flow analytics from ENTSOG transparency data.

Reads entsog_flows from the PostgreSQL market_data database.
Sign convention: net_gwh_d > 0 means net importer (more gas entering the BZ than leaving).

Tables produced for energy_hub.duckdb:
  gas_flows_latest  - most recent day per country (entry, exit, net GWh/d)
  gas_flows_daily   - trailing 400 days per country
"""

from __future__ import annotations

import pandas as pd

from loaders._base import _query, get_read_conn


def build_gas_flows_tables() -> dict[str, pd.DataFrame]:
    """Return both gas-flows DataFrames ready for energy_hub.duckdb."""
    empty = pd.DataFrame(columns=["country", "period_date", "entry_gwh_d", "exit_gwh_d", "net_gwh_d"])

    conn = get_read_conn()
    try:
        raw = _query(
            conn,
            """
            SELECT
                period_date,
                country,
                direction,
                SUM(value_gwh_d) AS gwh
            FROM entsog_flows
            GROUP BY period_date, country, direction
            ORDER BY country, period_date, direction
            """,
        )
    finally:
        conn.close()

    if raw.empty:
        return {"gas_flows_latest": empty, "gas_flows_daily": empty}

    raw["period_date"] = pd.to_datetime(raw["period_date"])

    # Pivot entry / exit into separate columns
    pivoted = (
        raw.pivot_table(
            index=["country", "period_date"],
            columns="direction",
            values="gwh",
            aggfunc="sum",
        )
        .fillna(0.0)
        .reset_index()
    )
    pivoted.columns.name = None
    if "entry" not in pivoted.columns:
        pivoted["entry"] = 0.0
    if "exit" not in pivoted.columns:
        pivoted["exit"] = 0.0

    pivoted = pivoted.rename(columns={"entry": "entry_gwh_d", "exit": "exit_gwh_d"})
    # Positive net = net importer (more gas entering the BZ than leaving)
    pivoted["net_gwh_d"] = (pivoted["entry_gwh_d"] - pivoted["exit_gwh_d"]).round(3)
    for col in ("entry_gwh_d", "exit_gwh_d"):
        pivoted[col] = pivoted[col].round(3)

    cols = ["country", "period_date", "entry_gwh_d", "exit_gwh_d", "net_gwh_d"]

    # gas_flows_daily: trailing 400 days
    cutoff = pd.Timestamp.now().normalize() - pd.Timedelta(days=400)
    daily = pivoted[pivoted["period_date"] >= cutoff].copy()
    daily["period_date"] = daily["period_date"].dt.date.astype(str)
    daily = daily[cols].reset_index(drop=True)

    # gas_flows_latest: most recent day per country
    latest_idx = pivoted.groupby("country")["period_date"].idxmax()
    latest = pivoted.loc[latest_idx].copy()
    latest["period_date"] = latest["period_date"].dt.date.astype(str)
    latest = latest[cols].reset_index(drop=True)

    return {"gas_flows_latest": latest, "gas_flows_daily": daily}
