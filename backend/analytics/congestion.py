"""Power congestion analytics: NTC vs scheduled commercial exchanges per directed border."""

from __future__ import annotations

import pandas as pd

from loaders._base import get_read_conn, _query


# Border pairs with centroids in FlowArrowsLayer - restrict to these for map rendering.
# All pairs are stored in the DB tables; non-mappable pairs are still queryable via the API.
MAPPED_ZONES = {"AT", "BE", "CH", "DE-LU", "FR", "IT-NORD", "NL"}

TRAILING_DAYS = 400


def build_congestion_tables() -> dict[str, pd.DataFrame]:
    empty = pd.DataFrame(
        columns=["from_zone", "to_zone", "price_date", "ntc_mw", "scheduled_mw", "utilization_pct"]
    )

    conn = get_read_conn()
    try:
        ntc = _query(
            conn,
            """
            SELECT ts::DATE AS price_date, from_zone, to_zone,
                   AVG(ntc_mw) AS ntc_mw
            FROM ntc_dayahead
            WHERE ts::DATE >= CURRENT_DATE - INTERVAL '%s days'
            GROUP BY ts::DATE, from_zone, to_zone
            """,
            [TRAILING_DAYS + 5],
        )
        sched = _query(
            conn,
            """
            SELECT ts::DATE AS price_date, from_zone, to_zone,
                   AVG(scheduled_mw) AS scheduled_mw
            FROM scheduled_exchanges
            WHERE ts::DATE >= CURRENT_DATE - INTERVAL '%s days'
            GROUP BY ts::DATE, from_zone, to_zone
            """,
            [TRAILING_DAYS + 5],
        )
    finally:
        conn.close()

    if ntc.empty or sched.empty:
        return {"congestion_latest": empty, "congestion_daily": empty}

    # Join on date + directed pair
    merged = ntc.merge(sched, on=["price_date", "from_zone", "to_zone"], how="inner")
    merged["ntc_mw"] = merged["ntc_mw"].round(1)
    merged["scheduled_mw"] = merged["scheduled_mw"].round(1)

    # Utilization: scheduled / NTC * 100. Clip 0-150 (>100 occurs in meshed flows).
    mask = merged["ntc_mw"] > 0
    merged["utilization_pct"] = 0.0
    merged.loc[mask, "utilization_pct"] = (
        merged.loc[mask, "scheduled_mw"] / merged.loc[mask, "ntc_mw"] * 100
    ).clip(0, 150).round(1)

    # Ensure date column is python date for DuckDB
    merged["price_date"] = pd.to_datetime(merged["price_date"]).dt.date

    col_order = ["from_zone", "to_zone", "price_date", "ntc_mw", "scheduled_mw", "utilization_pct"]

    # Latest: most recent day per directed pair (all pairs, not just mappable)
    latest = (
        merged.sort_values("price_date")
        .groupby(["from_zone", "to_zone"])
        .tail(1)
        .reset_index(drop=True)
    )[col_order]

    # Daily: trailing TRAILING_DAYS per pair; restrict to zones with map centroids
    mapped_mask = (
        merged["from_zone"].isin(MAPPED_ZONES) & merged["to_zone"].isin(MAPPED_ZONES)
    )
    daily = (
        merged[mapped_mask]
        .sort_values(["from_zone", "to_zone", "price_date"])
        .groupby(["from_zone", "to_zone"])
        .tail(TRAILING_DAYS)
        .reset_index(drop=True)
    )[col_order]

    return {"congestion_latest": latest, "congestion_daily": daily}
