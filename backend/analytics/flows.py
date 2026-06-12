"""Cross-border net flows analytics.

Aggregates hourly cross_border_flows from commo.duckdb into daily net flows
per canonical border pair (alphabetical from_zone). Positive net_flow_mw means
net electricity transfer in the direction from_zone -> to_zone.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd


def build_flows_tables(commo_db: Path) -> dict[str, pd.DataFrame]:
    """Return borders_daily DataFrame ready for energy_hub.duckdb."""
    borders_daily = _build_borders_daily(str(commo_db))
    return {"borders_daily": borders_daily}


def _build_borders_daily(db: str) -> pd.DataFrame:
    empty = pd.DataFrame(columns=["price_date", "from_zone", "to_zone", "net_flow_mw"])
    try:
        import duckdb
        con = duckdb.connect(db, read_only=True)
        df = con.execute("""
            SELECT
                CAST(ts AS DATE) AS price_date,
                from_zone,
                to_zone,
                AVG(flow_mw) AS avg_flow_mw
            FROM cross_border_flows
            WHERE ts >= CURRENT_DATE - INTERVAL '400 days'
            GROUP BY price_date, from_zone, to_zone
        """).df()
        con.close()
    except Exception:
        return empty

    if df.empty:
        return empty

    # Pivot to get both directions, then compute net flow with canonical ordering
    df["price_date"] = pd.to_datetime(df["price_date"]).dt.date

    # For each (date, zone_a, zone_b) where zone_a < zone_b alphabetically:
    # net_flow = avg(a->b) - avg(b->a)
    rows = []
    grouped = df.groupby("price_date")
    for date_val, day_df in grouped:
        flows: dict[tuple[str, str], float] = {}
        for _, row in day_df.iterrows():
            flows[(row["from_zone"], row["to_zone"])] = row["avg_flow_mw"]

        # Identify all pairs (canonical order: a < b)
        all_zones = set()
        for fz, tz in flows:
            all_zones.add(fz)
            all_zones.add(tz)

        seen: set[tuple[str, str]] = set()
        for fz, tz in flows:
            a, b = (fz, tz) if fz < tz else (tz, fz)
            if (a, b) in seen:
                continue
            seen.add((a, b))
            ab = flows.get((a, b), 0.0)
            ba = flows.get((b, a), 0.0)
            net = round(ab - ba, 1)
            rows.append({
                "price_date": date_val,
                "from_zone": a,
                "to_zone": b,
                "net_flow_mw": net,
            })

    if not rows:
        return empty

    return pd.DataFrame(rows)
