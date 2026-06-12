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
