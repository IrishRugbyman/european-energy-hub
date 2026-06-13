#!/usr/bin/env python
"""energy-refresh: rebuild energy_hub.duckdb from commo.duckdb.

Usage:
    python scripts/refresh.py              # run ingest then rebuild
    python scripts/refresh.py --skip-ingest  # rebuild only (for tests / commo locked)

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
COMMO_DB = MARKET_DATA_DIR / "data" / "commo.duckdb"

# Import analytics modules (script lives in scripts/, analytics one level up in backend/)
sys.path.insert(0, str(BACKEND_DIR))
from analytics.gas import build_storage_tables
from analytics.generation import build_generation_tables
from analytics.power import build_power_tables
from analytics.spreads import build_spreads_tables
from analytics.flows import build_flows_tables


def run_ingest(fetcher: str) -> bool:
    """Run market-data ingest.py for one fetcher. Returns True if OK."""
    try:
        result = subprocess.run(
            [str(MARKET_DATA_VENV), "ingest.py", fetcher],
            cwd=str(MARKET_DATA_DIR),
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            logger.warning(f"ingest {fetcher} exited {result.returncode}: {result.stderr[:500]}")
            return False
        logger.info(f"ingest {fetcher}: OK")
        return True
    except subprocess.TimeoutExpired:
        logger.warning(f"ingest {fetcher}: timed out after 600s")
        return False
    except Exception as e:
        logger.warning(f"ingest {fetcher}: {e!r}")
        return False


def rebuild(skip_ingest: bool = False) -> None:
    if not skip_ingest:
        for fetcher in ["agsi", "ttf", "eua_carbon", "coal_api2", "entso-e-prices", "rebase-generation"]:
            run_ingest(fetcher)
    else:
        logger.info("--skip-ingest: skipping market-data fetch")

    if not COMMO_DB.exists():
        raise RuntimeError(f"commo.duckdb not found at {COMMO_DB}")

    logger.info("Building storage tables from commo.duckdb...")
    storage_tables = build_storage_tables(COMMO_DB)

    logger.info("Building power tables from commo.duckdb...")
    power_tables = build_power_tables(COMMO_DB)

    logger.info("Building spreads/prices tables from commo.duckdb...")
    spreads_tables = build_spreads_tables(COMMO_DB)

    logger.info("Building cross-border flows from commo.duckdb...")
    flows_tables = build_flows_tables(COMMO_DB)

    logger.info("Building generation mix from commo.duckdb...")
    generation_tables = build_generation_tables(COMMO_DB)

    ENERGY_DB.parent.mkdir(exist_ok=True)
    conn = duckdb.connect(str(ENERGY_DB))
    try:
        conn.execute("BEGIN TRANSACTION")

        _write_storage(conn, storage_tables)
        _write_power(conn, power_tables)
        _write_spreads(conn, spreads_tables)
        _write_flows(conn, flows_tables)
        _write_generation(conn, generation_tables)

        now_iso = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR)"
        )
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_gas", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_power", now_iso])
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_spreads", now_iso])
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
            offpeak_eur REAL
        )
    """)
    if not daily.empty:
        conn.register("_pd", daily)
        conn.execute("INSERT INTO power_daily SELECT * FROM _pd")

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
            vs_30d_pct REAL
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
            hh_usd_mmbtu REAL
        )
    """)
    if not prices.empty:
        conn.register("_pr", prices)
        conn.execute("INSERT INTO prices_daily SELECT * FROM _pr")

    logger.info(
        f"spreads: {len(spreads)} daily rows, prices: {len(prices)} daily rows"
    )


def _write_generation(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    gen = tables["generation_latest"]
    conn.execute("""
        CREATE OR REPLACE TABLE generation_latest (
            zone VARCHAR,
            gen_date DATE,
            biomass REAL,
            coal REAL,
            gas REAL,
            geothermal REAL,
            hydro REAL,
            oil REAL,
            solar REAL,
            unknown REAL,
            wind REAL,
            renewable_pct REAL,
            total_mw REAL
        )
    """)
    if not gen.empty:
        conn.register("_gen", gen)
        conn.execute("INSERT INTO generation_latest SELECT * FROM _gen")
    logger.info(f"generation: {len(gen)} zone rows")


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
