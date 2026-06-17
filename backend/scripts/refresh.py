#!/usr/bin/env python
"""energy-refresh: rebuild energy_hub.duckdb from the market_data PostgreSQL DB.

Usage:
    python scripts/refresh.py              # run ingest then rebuild
    python scripts/refresh.py --skip-ingest  # rebuild only (for tests / no fresh ingest)

Exit codes: 0 = ok, 1 = rebuild failed (ingest failures are warnings only).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
from loguru import logger

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENERGY_DB = BACKEND_DIR / "data" / "energy_hub.duckdb"
MARKET_DATA_DIR = Path(__file__).resolve().parents[3] / "shared" / "market-data"
MARKET_DATA_VENV = MARKET_DATA_DIR / ".venv" / "bin" / "python"

# Import analytics modules (script lives in scripts/, analytics one level up in backend/)
sys.path.insert(0, str(BACKEND_DIR))
from analytics.battery import build_battery_tables
from analytics.congestion import build_congestion_tables
from analytics.divergence import build_divergence_tables
from analytics.gas import build_storage_tables
from analytics.gas_flows import build_gas_flows_tables
from analytics.generation import build_generation_tables
from analytics.imbalance import build_imbalance_tables
from analytics.power import build_power_tables
from analytics.spreads import build_spreads_tables
from analytics.flows import build_flows_tables


def run_ingest(fetcher: str) -> bool:
    """Run market-data ingest.py for one fetcher. Returns True if OK."""
    try:
        # entso-e-gen-full fetches up to 34 zones incrementally; allow 30 min
        fetch_timeout = 1800 if "gen-full" in fetcher else 600
        result = subprocess.run(
            [str(MARKET_DATA_VENV), "ingest.py", fetcher],
            cwd=str(MARKET_DATA_DIR),
            capture_output=True,
            text=True,
            timeout=fetch_timeout,
        )
        if result.returncode != 0:
            logger.warning(f"ingest {fetcher} exited {result.returncode}: {result.stderr[:500]}")
            return False
        logger.info(f"ingest {fetcher}: OK")
        return True
    except subprocess.TimeoutExpired:
        logger.warning(f"ingest {fetcher}: timed out after {fetch_timeout}s")
        return False
    except Exception as e:
        logger.warning(f"ingest {fetcher}: {e!r}")
        return False


def rebuild(skip_ingest: bool = False) -> None:
    if not skip_ingest:
        for fetcher in ["agsi", "ttf", "eua_carbon", "coal_api2", "entso-e-prices", "entso-e-ntc", "entso-e-scheduled", "entso-e-gen-full", "entsog", "smard-imbalance-de"]:
            run_ingest(fetcher)
    else:
        logger.info("--skip-ingest: skipping market-data fetch")

    logger.info("Building storage tables from market_data (PostgreSQL)...")
    storage_tables = build_storage_tables()

    logger.info("Building power tables from market_data (PostgreSQL)...")
    power_tables = build_power_tables()

    logger.info("Building cross-zone price divergence tables...")
    divergence_tables = build_divergence_tables(power_tables["power_daily"])

    logger.info("Building spreads/prices tables from market_data (PostgreSQL)...")
    spreads_tables = build_spreads_tables()

    logger.info("Building cross-border flows from market_data (PostgreSQL)...")
    flows_tables = build_flows_tables()

    logger.info("Building generation mix from market_data (PostgreSQL)...")
    generation_tables = build_generation_tables()

    logger.info("Building ENTSOG physical gas flows from market_data (PostgreSQL)...")
    gas_flows_tables = build_gas_flows_tables()

    logger.info("Building power congestion (NTC vs scheduled) from market_data (PostgreSQL)...")
    congestion_tables = build_congestion_tables()

    logger.info("Building German reBAP imbalance tables from market_data (PostgreSQL)...")
    imbalance_tables = build_imbalance_tables()

    logger.info("Building battery oracle dispatch tables...")
    battery_tables = build_battery_tables()

    ENERGY_DB.parent.mkdir(exist_ok=True)
    conn = duckdb.connect(str(ENERGY_DB))
    try:
        conn.execute("BEGIN TRANSACTION")

        _write_storage(conn, storage_tables)
        _write_power(conn, power_tables)
        _write_divergence(conn, divergence_tables)
        _write_spreads(conn, spreads_tables)
        _write_flows(conn, flows_tables)
        _write_generation(conn, generation_tables)
        _write_gas_flows(conn, gas_flows_tables)
        _write_congestion(conn, congestion_tables)
        _write_imbalance(conn, imbalance_tables)
        _write_battery(conn, battery_tables)

        now_iso = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR)"
        )
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_gas", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_gas_flows", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_power", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_congestion", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_spreads", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_imbalance", now_iso])
        conn.execute("COMMIT")
        logger.info(f"energy_hub.duckdb rebuilt at {now_iso}")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        raise
    conn.close()


def _write_storage(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    history = tables["storage_history"]
    seasonal = tables["storage_seasonal"]
    latest = tables["storage_latest"]

    conn.execute("""
        CREATE OR REPLACE TABLE storage_history (
            country VARCHAR,
            gas_day DATE,
            full_pct REAL,
            injection REAL,
            withdrawal REAL,
            working_gas_volume REAL
        )
    """)
    if not history.empty:
        conn.register("_h", history)
        conn.execute("INSERT INTO storage_history SELECT * FROM _h")

    conn.execute("""
        CREATE OR REPLACE TABLE storage_seasonal (
            country VARCHAR,
            doy SMALLINT,
            avg5 REAL,
            min5 REAL,
            max5 REAL
        )
    """)
    if not seasonal.empty:
        conn.register("_s", seasonal)
        conn.execute("INSERT INTO storage_seasonal SELECT * FROM _s")

    conn.execute("""
        CREATE OR REPLACE TABLE storage_latest (
            country VARCHAR,
            gas_day DATE,
            full_pct REAL,
            d7_pct REAL,
            vs_avg5_pct REAL,
            yoy_pct REAL,
            injection REAL,
            withdrawal REAL,
            working_gas_volume REAL
        )
    """)
    if not latest.empty:
        conn.register("_l", latest)
        conn.execute("INSERT INTO storage_latest SELECT * FROM _l")

    logger.info(
        f"storage: {len(history)} history rows, {len(seasonal)} seasonal rows, {len(latest)} latest rows"
    )


def _write_power(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    daily = tables["power_daily"]
    hourly = tables["power_hourly_recent"]
    latest = tables["power_latest"]

    conn.execute("""
        CREATE OR REPLACE TABLE power_daily (
            zone VARCHAR,
            price_date DATE,
            base_eur REAL,
            peak_eur REAL,
            offpeak_eur REAL,
            day_range_eur REAL,
            neg_hours SMALLINT,
            min_eur REAL,
            max_eur REAL
        )
    """)
    if not daily.empty:
        conn.register("_pd", daily)
        conn.execute(
            "INSERT INTO power_daily (zone, price_date, base_eur, peak_eur, offpeak_eur, day_range_eur, neg_hours, min_eur, max_eur) "
            "SELECT zone, price_date, base_eur, peak_eur, offpeak_eur, day_range_eur, neg_hours, min_eur, max_eur FROM _pd"
        )

    conn.execute("""
        CREATE OR REPLACE TABLE power_hourly_recent (
            zone VARCHAR,
            ts TIMESTAMP,
            price_eur_mwh REAL
        )
    """)
    if not hourly.empty:
        conn.register("_ph", hourly)
        conn.execute("INSERT INTO power_hourly_recent SELECT * FROM _ph")

    conn.execute("""
        CREATE OR REPLACE TABLE power_latest (
            zone VARCHAR,
            price_date DATE,
            base_eur REAL,
            peak_eur REAL,
            vs_30d_pct REAL,
            day_range_eur REAL,
            neg_hours SMALLINT,
            pct_rank_2yr REAL
        )
    """)
    if not latest.empty:
        conn.register("_pl", latest)
        conn.execute("INSERT INTO power_latest SELECT * FROM _pl")

    logger.info(
        f"power: {len(daily)} daily rows, {len(hourly)} hourly-recent rows, {len(latest)} latest rows"
    )


def _write_spreads(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    spreads = tables["spreads_daily"]
    prices = tables["prices_daily"]
    multi = tables.get("multi_zone_spreads")
    ttf_curve = tables.get("ttf_curve")

    conn.execute("""
        CREATE OR REPLACE TABLE spreads_daily (
            price_date DATE,
            power_de REAL,
            ttf REAL,
            eua REAL,
            coal_eur_mwh REAL,
            css REAL,
            cds REAL,
            fss REAL,
            regime_threshold VARCHAR
        )
    """)
    if not spreads.empty:
        conn.register("_sp", spreads)
        conn.execute("INSERT INTO spreads_daily SELECT * FROM _sp")

    conn.execute("""
        CREATE OR REPLACE TABLE prices_daily (
            price_date DATE,
            ttf_eur_mwh REAL,
            eua_eur_t REAL,
            coal_usd_t REAL,
            hh_usd_mmbtu REAL,
            nbp_eur_mwh REAL
        )
    """)
    if not prices.empty:
        conn.register("_pr", prices)
        conn.execute("INSERT INTO prices_daily SELECT * FROM _pr")

    conn.execute("""
        CREATE OR REPLACE TABLE multi_zone_spreads (
            price_date DATE,
            zone VARCHAR,
            power_eur_mwh REAL,
            css REAL,
            cds REAL,
            fss REAL,
            regime_threshold VARCHAR
        )
    """)
    n_multi = 0
    if multi is not None and not multi.empty:
        conn.register("_mz", multi)
        conn.execute("INSERT INTO multi_zone_spreads SELECT * FROM _mz")
        n_multi = len(multi)

    conn.execute("""
        CREATE OR REPLACE TABLE ttf_curve_latest (
            contract    VARCHAR,
            settlement  REAL,
            tenor_type  VARCHAR,
            sort_key    INTEGER
        )
    """)
    n_curve = 0
    if ttf_curve is not None and not ttf_curve.empty:
        conn.register("_tc", ttf_curve)
        conn.execute("INSERT INTO ttf_curve_latest SELECT * FROM _tc")
        n_curve = len(ttf_curve)

    logger.info(
        f"spreads: {len(spreads)} daily rows, prices: {len(prices)} daily rows, "
        f"multi-zone: {n_multi} rows, ttf-curve: {n_curve} contracts"
    )


def _write_gas_flows(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    latest = tables["gas_flows_latest"]
    daily = tables["gas_flows_daily"]

    conn.execute("""
        CREATE OR REPLACE TABLE gas_flows_latest (
            country VARCHAR,
            period_date DATE,
            entry_gwh_d REAL,
            exit_gwh_d REAL,
            net_gwh_d REAL
        )
    """)
    if not latest.empty:
        conn.register("_gfl", latest)
        conn.execute("INSERT INTO gas_flows_latest SELECT * FROM _gfl")

    conn.execute("""
        CREATE OR REPLACE TABLE gas_flows_daily (
            country VARCHAR,
            period_date DATE,
            entry_gwh_d REAL,
            exit_gwh_d REAL,
            net_gwh_d REAL
        )
    """)
    if not daily.empty:
        conn.register("_gfd", daily)
        conn.execute("INSERT INTO gas_flows_daily SELECT * FROM _gfd")

    logger.info(
        f"gas flows: {len(latest)} latest rows, {len(daily)} daily rows"
    )


def _write_congestion(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    latest = tables["congestion_latest"]
    daily = tables["congestion_daily"]
    cols = "from_zone VARCHAR, to_zone VARCHAR, price_date DATE, ntc_mw REAL, scheduled_mw REAL, utilization_pct REAL"

    conn.execute(f"CREATE OR REPLACE TABLE congestion_latest ({cols})")
    if not latest.empty:
        conn.register("_cl", latest)
        conn.execute("INSERT INTO congestion_latest SELECT * FROM _cl")

    conn.execute(f"CREATE OR REPLACE TABLE congestion_daily ({cols})")
    if not daily.empty:
        conn.register("_cd", daily)
        conn.execute("INSERT INTO congestion_daily SELECT * FROM _cd")

    logger.info(
        f"congestion: {len(latest)} latest border pairs, {len(daily)} daily rows"
    )


def _write_generation(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    fuel_cols = "biomass REAL, coal REAL, gas REAL, geothermal REAL, hydro REAL, nuclear REAL, oil REAL, other REAL, solar REAL, wind REAL"

    # generation_latest
    gen = tables["generation_latest"]
    conn.execute(f"""
        CREATE OR REPLACE TABLE generation_latest (
            zone VARCHAR, gen_date DATE, {fuel_cols}, renewable_pct REAL, total_mw REAL
        )
    """)
    if not gen.empty:
        conn.register("_gen", gen)
        conn.execute("INSERT INTO generation_latest SELECT * FROM _gen")

    # generation_daily
    daily = tables.get("generation_daily", gen.__class__())
    conn.execute(f"""
        CREATE OR REPLACE TABLE generation_daily (
            zone VARCHAR, gen_date DATE, {fuel_cols}, renewable_pct REAL, total_mw REAL
        )
    """)
    if not daily.empty:
        conn.register("_gen_daily", daily)
        conn.execute("INSERT INTO generation_daily SELECT * FROM _gen_daily")

    # generation_hourly_recent
    hourly = tables.get("generation_hourly_recent", gen.__class__())
    conn.execute(f"""
        CREATE OR REPLACE TABLE generation_hourly_recent (
            zone VARCHAR, ts TIMESTAMPTZ, {fuel_cols}
        )
    """)
    if not hourly.empty:
        conn.register("_gen_hourly", hourly)
        conn.execute("INSERT INTO generation_hourly_recent SELECT * FROM _gen_hourly")

    logger.info(
        f"generation: {len(gen)} latest rows, {len(daily)} daily rows, {len(hourly)} hourly rows"
    )


def _write_imbalance(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    recent = tables["imbalance_recent"]
    daily = tables["imbalance_daily"]
    latest = tables["imbalance_latest"]

    conn.execute("""
        CREATE OR REPLACE TABLE imbalance_recent (
            ts TIMESTAMP,
            rebap_eur_mwh REAL
        )
    """)
    if not recent.empty:
        conn.register("_ir", recent)
        conn.execute("INSERT INTO imbalance_recent SELECT * FROM _ir")

    conn.execute("""
        CREATE OR REPLACE TABLE imbalance_daily (
            price_date DATE,
            mean_eur REAL,
            min_eur REAL,
            max_eur REAL,
            count INTEGER
        )
    """)
    if not daily.empty:
        conn.register("_id", daily)
        conn.execute("INSERT INTO imbalance_daily SELECT * FROM _id")

    conn.execute("""
        CREATE OR REPLACE TABLE imbalance_latest (
            current_ts TIMESTAMP,
            rebap_eur_mwh REAL,
            today_mean REAL,
            today_min REAL,
            today_max REAL
        )
    """)
    if not latest.empty:
        conn.register("_il", latest)
        conn.execute("INSERT INTO imbalance_latest SELECT * FROM _il")

    logger.info(
        f"imbalance: {len(recent)} recent rows, {len(daily)} daily rows, {len(latest)} latest rows"
    )


def _write_battery(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    dispatch = tables["battery_dispatch_recent"]
    summary  = tables["battery_summary"]
    conn.execute("""
        CREATE OR REPLACE TABLE battery_dispatch_recent (
            ts TIMESTAMP,
            rebap_price REAL,
            charge_mw REAL,
            discharge_mw REAL,
            soc_mwh REAL,
            cumulative_pnl_eur REAL
        )
    """)
    if not dispatch.empty:
        conn.register("_bdr", dispatch)
        conn.execute("INSERT INTO battery_dispatch_recent SELECT * FROM _bdr")
    conn.execute("""
        CREATE OR REPLACE TABLE battery_summary (
            key VARCHAR PRIMARY KEY,
            value VARCHAR
        )
    """)
    if not summary.empty:
        conn.register("_bs", summary)
        conn.execute("INSERT INTO battery_summary SELECT * FROM _bs")
    logger.info(f"battery: {len(dispatch)} hourly rows, P&L from summary")


def _write_divergence(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    latest = tables["divergence_latest"]
    hist = tables["divergence_30d"]
    _DIVERG_COLS = "(from_zone VARCHAR, to_zone VARCHAR, price_date DATE, from_price REAL, to_price REAL, diff_eur_mwh REAL)"
    conn.execute(f"CREATE OR REPLACE TABLE divergence_latest {_DIVERG_COLS}")
    if not latest.empty:
        conn.register("_dvl", latest)
        conn.execute("INSERT INTO divergence_latest SELECT * FROM _dvl")
    conn.execute(f"CREATE OR REPLACE TABLE divergence_30d {_DIVERG_COLS}")
    if not hist.empty:
        conn.register("_dvh", hist)
        conn.execute("INSERT INTO divergence_30d SELECT * FROM _dvh")
    logger.info(f"divergence: {len(latest)} border pairs, {len(hist)} history rows")


def _write_flows(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    borders = tables["borders_daily"]
    conn.execute("""
        CREATE OR REPLACE TABLE borders_daily (
            price_date DATE,
            from_zone VARCHAR,
            to_zone VARCHAR,
            net_flow_mw REAL
        )
    """)
    if not borders.empty:
        conn.register("_bd", borders)
        conn.execute("INSERT INTO borders_daily SELECT * FROM _bd")
    logger.info(f"flows: {len(borders)} border-day rows")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-ingest", action="store_true")
    args = parser.parse_args()
    try:
        rebuild(skip_ingest=args.skip_ingest)
    except Exception as e:
        logger.error(f"refresh failed: {e!r}")
        sys.exit(1)
