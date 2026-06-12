"""Seeded temp DuckDB fixture for energy-api tests.

Inserts 2 countries (DE, FR) + EU aggregate, 3 years of daily data,
so every endpoint test has real-looking numbers to assert against.
"""

from __future__ import annotations

import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient


def _seed_db(path: str) -> None:
    conn = duckdb.connect(path)

    conn.execute("""
        CREATE TABLE storage_history (
            country VARCHAR, gas_day DATE, full_pct REAL,
            injection REAL, withdrawal REAL, working_gas_volume REAL
        )
    """)
    conn.execute("""
        CREATE TABLE storage_seasonal (
            country VARCHAR, doy SMALLINT, avg5 REAL, min5 REAL, max5 REAL
        )
    """)
    conn.execute("""
        CREATE TABLE storage_latest (
            country VARCHAR, gas_day DATE, full_pct REAL,
            d7_pct REAL, vs_avg5_pct REAL, yoy_pct REAL,
            injection REAL, withdrawal REAL, working_gas_volume REAL
        )
    """)
    conn.execute("CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR)")

    today = date.today()
    start = date(today.year - 2, 1, 1)
    rows_hist = []
    for i in range((today - start).days + 1):
        day = start + timedelta(days=i)
        for cc, base_full, wgv in [("DE", 60.0, 24000.0), ("FR", 70.0, 12000.0), ("EU", 63.0, 36000.0)]:
            full_pct = min(99.0, max(10.0, base_full + (i % 365 - 182) * 0.15))
            rows_hist.append((cc, day.isoformat(), round(full_pct, 2), 50.0, 0.0, wgv))
    conn.executemany("INSERT INTO storage_history VALUES (?, ?, ?, ?, ?, ?)", rows_hist)

    for doy in range(1, 367):
        for cc in ("DE", "FR", "EU"):
            base = 60.0 if cc == "DE" else (70.0 if cc == "FR" else 63.0)
            conn.execute(
                "INSERT INTO storage_seasonal VALUES (?, ?, ?, ?, ?)",
                [cc, doy, base + (doy - 182) * 0.15, base - 10, base + 10],
            )

    today = date.today()
    for cc, fp, wgv in [("DE", 72.5, 24000.0), ("FR", 78.3, 12000.0), ("EU", 74.1, 36000.0)]:
        conn.execute(
            "INSERT INTO storage_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [cc, today.isoformat(), fp, 1.2, -3.5, 5.0, 50.0, 0.0, wgv],
        )

    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_gas", "2026-06-12T12:00:00+00:00"])

    # Power tables
    conn.execute("""
        CREATE TABLE power_daily (
            zone VARCHAR, price_date DATE, base_eur REAL, peak_eur REAL, offpeak_eur REAL
        )
    """)
    conn.execute("""
        CREATE TABLE power_hourly_recent (
            zone VARCHAR, ts TIMESTAMP, price_eur_mwh REAL
        )
    """)
    conn.execute("""
        CREATE TABLE power_latest (
            zone VARCHAR, price_date DATE, base_eur REAL, peak_eur REAL, vs_30d_pct REAL
        )
    """)

    # Seed 2 years of daily power data for DE-LU and FR
    for i in range((today - start).days + 1):
        day = start + timedelta(days=i)
        for zone, base in [("DE-LU", 80.0), ("FR", 65.0)]:
            price = base + (i % 365 - 182) * 0.2
            conn.execute(
                "INSERT INTO power_daily VALUES (?, ?, ?, ?, ?)",
                [zone, day.isoformat(), round(price, 2), round(price * 1.15, 2), round(price * 0.85, 2)],
            )

    # Seed 8 days of hourly data
    hourly_start = today - timedelta(days=8)
    for i in range(8 * 24):
        ts = f"{(hourly_start + timedelta(hours=i)).isoformat()}"
        for zone, base in [("DE-LU", 80.0), ("FR", 65.0)]:
            conn.execute(
                "INSERT INTO power_hourly_recent VALUES (?, ?, ?)",
                [zone, ts, round(base + (i % 24 - 12) * 3.0, 2)],
            )

    for zone, base in [("DE-LU", 80.0), ("FR", 65.0)]:
        conn.execute(
            "INSERT INTO power_latest VALUES (?, ?, ?, ?, ?)",
            [zone, today.isoformat(), base, round(base * 1.15, 2), 5.0],
        )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_power", "2026-06-12T12:00:00+00:00"])

    # Spreads tables
    conn.execute("""
        CREATE TABLE spreads_daily (
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
    conn.execute("""
        CREATE TABLE prices_daily (
            price_date DATE,
            ttf_eur_mwh REAL,
            eua_eur_t REAL,
            coal_usd_t REAL,
            hh_usd_mmbtu REAL
        )
    """)

    # Seed 1 year of spreads/prices data
    spreads_start = date(today.year - 1, 1, 1)
    for i in range((today - spreads_start).days + 1):
        day = (spreads_start + timedelta(days=i)).isoformat()
        power = 80.0 + (i % 365 - 182) * 0.2
        ttf = 35.0 + (i % 365 - 182) * 0.05
        eua = 65.0
        coal_eur_mwh = 12.0
        css = round(power - ttf / 0.49 - eua * 0.364, 4)
        cds = round(power - coal_eur_mwh / 0.36 - eua * 0.96, 4)
        fss = round(css - cds, 4)
        regime = "gas" if fss > 0 else "coal"
        conn.execute(
            "INSERT INTO spreads_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [day, round(power, 2), round(ttf, 2), eua, coal_eur_mwh, css, cds, fss, regime],
        )
        conn.execute(
            "INSERT INTO prices_daily VALUES (?, ?, ?, ?, ?)",
            [day, round(ttf, 2), eua, 120.0, 2.5],
        )

    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_spreads", "2026-06-12T12:00:00+00:00"])

    # Flows table
    conn.execute("""
        CREATE TABLE borders_daily (
            price_date DATE,
            from_zone VARCHAR,
            to_zone VARCHAR,
            net_flow_mw REAL
        )
    """)
    for fz, tz, net in [("DE-LU", "FR", 1200.0), ("AT", "DE-LU", -500.0), ("BE", "FR", 300.0)]:
        conn.execute(
            "INSERT INTO borders_daily VALUES (?, ?, ?, ?)",
            [today.isoformat(), fz, tz, net],
        )

    # Generation mix table
    conn.execute("""
        CREATE TABLE generation_latest (
            zone VARCHAR,
            gen_date DATE,
            biomass REAL, coal REAL, gas REAL, geothermal REAL,
            hydro REAL, oil REAL, solar REAL, unknown REAL, wind REAL,
            renewable_pct REAL, total_mw REAL
        )
    """)
    conn.execute(
        "INSERT INTO generation_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["DE-LU", today.isoformat(), 1200.0, 8000.0, 5000.0, 0.0, 1500.0, 200.0, 6000.0, 500.0, 12000.0, 57.4, 34400.0],
    )

    conn.close()


@pytest.fixture(scope="session")
def seeded_db():
    """Temp DuckDB with seeded gas storage data. Session-scoped for speed."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = str(Path(tmpdir) / "energy_hub.duckdb")
        _seed_db(path)
        yield path


@pytest.fixture()
def client(seeded_db):
    os.environ["ENERGY_DB"] = seeded_db
    from app.main import app
    with TestClient(app) as c:
        yield c
    del os.environ["ENERGY_DB"]
