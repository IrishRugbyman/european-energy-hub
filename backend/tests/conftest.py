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

    # Congestion tables
    cong_cols = "from_zone VARCHAR, to_zone VARCHAR, price_date DATE, ntc_mw REAL, scheduled_mw REAL, utilization_pct REAL"
    conn.execute(f"CREATE TABLE congestion_latest ({cong_cols})")
    conn.execute(f"CREATE TABLE congestion_daily ({cong_cols})")
    # FR->DE-LU: congested (~92%); DE-LU->NL: moderate (~55%)
    for fz, tz, ntc, sched, util in [("FR", "DE-LU", 3000.0, 2760.0, 92.0), ("DE-LU", "NL", 1200.0, 660.0, 55.0)]:
        conn.execute(
            "INSERT INTO congestion_latest VALUES (?, ?, ?, ?, ?, ?)",
            [fz, tz, today.isoformat(), ntc, sched, util],
        )
    # 90 days of daily history for FR->DE-LU
    for i in range(90):
        day = (today - timedelta(days=89 - i)).isoformat()
        ntc = 3000.0
        sched = round(2000.0 + i * 5.0, 1)
        util = round(sched / ntc * 100, 1)
        conn.execute(
            "INSERT INTO congestion_daily VALUES (?, ?, ?, ?, ?, ?)",
            ["FR", "DE-LU", day, ntc, sched, util],
        )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_congestion", "2026-06-12T12:00:00+00:00"])

    # Gas physical flows tables (ENTSOG)
    conn.execute("""
        CREATE TABLE gas_flows_latest (
            country VARCHAR, period_date DATE,
            entry_gwh_d REAL, exit_gwh_d REAL, net_gwh_d REAL
        )
    """)
    conn.execute("""
        CREATE TABLE gas_flows_daily (
            country VARCHAR, period_date DATE,
            entry_gwh_d REAL, exit_gwh_d REAL, net_gwh_d REAL
        )
    """)
    # AT: large net importer; DE: slight net exporter
    for cc, entry, exit_, net in [("AT", 120.0, 5.0, 115.0), ("DE", 0.0, 2.5, -2.5)]:
        conn.execute(
            "INSERT INTO gas_flows_latest VALUES (?, ?, ?, ?, ?)",
            [cc, today.isoformat(), entry, exit_, net],
        )
    # Seed 60 days of daily data for AT
    for i in range(60):
        day = (today - timedelta(days=59 - i)).isoformat()
        entry = round(100.0 + i * 0.5, 1)
        exit_ = round(5.0 + (i % 7) * 0.2, 1)
        conn.execute(
            "INSERT INTO gas_flows_daily VALUES (?, ?, ?, ?, ?)",
            ["AT", day, entry, exit_, round(entry - exit_, 3)],
        )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_gas_flows", "2026-06-12T12:00:00+00:00"])

    fuel_cols = "biomass REAL, coal REAL, gas REAL, geothermal REAL, hydro REAL, oil REAL, solar REAL, unknown REAL, wind REAL"

    # generation_latest
    conn.execute(f"""
        CREATE TABLE generation_latest (
            zone VARCHAR, gen_date DATE, {fuel_cols}, renewable_pct REAL, total_mw REAL
        )
    """)
    conn.execute(
        "INSERT INTO generation_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["DE-LU", today.isoformat(), 1200.0, 8000.0, 5000.0, 0.0, 1500.0, 200.0, 6000.0, 500.0, 12000.0, 57.4, 34400.0],
    )
    conn.execute(
        "INSERT INTO generation_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["FR", today.isoformat(), 800.0, 1000.0, 2000.0, 0.0, 8000.0, 100.0, 4000.0, 200.0, 5000.0, 81.0, 21100.0],
    )

    # generation_daily (2 years of daily data for DE-LU, 1 zone for coverage)
    conn.execute(f"""
        CREATE TABLE generation_daily (
            zone VARCHAR, gen_date DATE, {fuel_cols}, renewable_pct REAL, total_mw REAL
        )
    """)
    daily_start = date(today.year - 2, 1, 1)
    gen_rows = []
    for i in range((today - daily_start).days + 1):
        day = (daily_start + timedelta(days=i)).isoformat()
        # Seasonal solar: peaks in summer (DOY ~180)
        solar = round(4000.0 + 2000.0 * ((i % 365 - 180) / 365), 1)
        wind = round(10000.0 + 2000.0 * ((i % 365 - 90) / 365), 1)
        hydro = 1500.0
        gas = 5000.0
        coal = 8000.0
        total = solar + wind + hydro + gas + coal + 1200.0 + 200.0 + 500.0
        renewable_pct = round((solar + wind + hydro) / total * 100, 1)
        gen_rows.append(["DE-LU", day, 1200.0, coal, gas, 0.0, hydro, 200.0, solar, 500.0, wind, renewable_pct, round(total, 1)])
    conn.executemany("INSERT INTO generation_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", gen_rows)

    # generation_hourly_recent (10 days of hourly data for DE-LU)
    conn.execute(f"""
        CREATE TABLE generation_hourly_recent (
            zone VARCHAR, ts TIMESTAMPTZ, {fuel_cols}
        )
    """)
    from datetime import datetime
    hourly_start = datetime(today.year, today.month, today.day) - timedelta(days=10)
    gen_hourly = []
    for i in range(10 * 24):
        ts = (hourly_start + timedelta(hours=i)).strftime("%Y-%m-%d %H:%M:%S+00:00")
        hour = i % 24
        solar_h = round(max(0.0, 6000.0 * ((hour - 6) / 6) if 6 <= hour <= 12 else max(0.0, 6000.0 * (1 - (hour - 12) / 8))), 1)
        wind_h = round(10000.0 + 1000.0 * ((hour - 12) / 12), 1)
        gen_hourly.append(["DE-LU", ts, 1200.0, 8000.0, 5000.0, 0.0, 1500.0, 200.0, solar_h, 500.0, wind_h])
    conn.executemany("INSERT INTO generation_hourly_recent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", gen_hourly)

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
