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
            zone VARCHAR, price_date DATE, base_eur REAL, peak_eur REAL, offpeak_eur REAL,
            day_range_eur REAL, neg_hours SMALLINT, min_eur REAL, max_eur REAL
        )
    """)
    conn.execute("""
        CREATE TABLE power_hourly_recent (
            zone VARCHAR, ts TIMESTAMP, price_eur_mwh REAL
        )
    """)
    conn.execute("""
        CREATE TABLE power_latest (
            zone VARCHAR, price_date DATE, base_eur REAL, peak_eur REAL, vs_30d_pct REAL,
            day_range_eur REAL, neg_hours SMALLINT, pct_rank_2yr REAL
        )
    """)

    # Seed 2 years of daily power data; Italian zones added for cross-zone-spreads test
    for i in range((today - start).days + 1):
        day = start + timedelta(days=i)
        for zone, base in [("DE-LU", 80.0), ("FR", 65.0), ("IT-NORD", 90.0), ("IT-SARD", 82.0)]:
            price = base + (i % 365 - 182) * 0.2
            range_eur = round(abs((i % 24) * 2.5 + 10), 2)
            neg_h = 2 if price < 50 else 0
            conn.execute(
                "INSERT INTO power_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [zone, day.isoformat(), round(price, 2), round(price * 1.15, 2),
                 round(price * 0.85, 2), range_eur, neg_h,
                 round(price - range_eur / 2, 2), round(price + range_eur / 2, 2)],
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
            "INSERT INTO power_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [zone, today.isoformat(), base, round(base * 1.15, 2), 5.0, 45.0, 1, 62.5],
        )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_power", "2026-06-12T12:00:00+00:00"])

    # Hourly price profiles (avg price by hour-of-day, last 90 days)
    conn.execute("""
        CREATE TABLE power_hourly_profiles (
            zone VARCHAR, hour TINYINT,
            avg_eur REAL, p25_eur REAL, p75_eur REAL, neg_pct REAL
        )
    """)
    for zone, base in [("DE-LU", 80.0), ("FR", 65.0)]:
        for h in range(24):
            # U-shape: low midday, high evening (simplified solar cannibalization pattern)
            avg = round(base + (abs(h - 18) - 8) * 2.5, 2)
            p25 = round(avg - 15.0, 2)
            p75 = round(avg + 20.0, 2)
            neg_pct = round(max(0.0, (10 - h) * 2.0) if 6 <= h <= 12 else 0.0, 1)
            conn.execute(
                "INSERT INTO power_hourly_profiles VALUES (?, ?, ?, ?, ?, ?)",
                [zone, h, avg, p25, p75, neg_pct],
            )

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
            regime_threshold VARCHAR,
            disruption_bcm REAL
        )
    """)
    conn.execute("""
        CREATE TABLE prices_daily (
            price_date DATE,
            ttf_eur_mwh REAL,
            eua_eur_t REAL,
            coal_usd_t REAL,
            hh_usd_mmbtu REAL,
            nbp_eur_mwh REAL,
            hh_eur_mwh REAL
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
        disruption = 288.0  # constant representative value
        conn.execute(
            "INSERT INTO spreads_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [day, round(power, 2), round(ttf, 2), eua, coal_eur_mwh, css, cds, fss, regime, disruption],
        )
        nbp = round(ttf * 0.88, 2)  # ~12% discount to TTF
        hh_eur_mwh = round(2.5 * 0.86 / 0.293071, 2)  # HH USD/MMBtu -> EUR/MWh
        conn.execute(
            "INSERT INTO prices_daily VALUES (?, ?, ?, ?, ?, ?, ?)",
            [day, round(ttf, 2), eua, 120.0, 2.5, nbp, hh_eur_mwh],
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

    fuel_cols = "biomass REAL, coal REAL, gas REAL, geothermal REAL, hydro REAL, nuclear REAL, oil REAL, other REAL, solar REAL, wind REAL"

    # generation_latest  (14 cols: zone, gen_date, 10 fuels, renewable_pct, total_mw)
    conn.execute(f"""
        CREATE TABLE generation_latest (
            zone VARCHAR, gen_date DATE, {fuel_cols}, renewable_pct REAL, total_mw REAL
        )
    """)
    # zone, gen_date, biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind, renewable_pct, total_mw
    conn.execute(
        "INSERT INTO generation_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["DE-LU", today.isoformat(), 1200.0, 8000.0, 5000.0, 0.0, 1500.0, 0.0, 200.0, 500.0, 6000.0, 12000.0, 57.4, 34400.0],
    )
    conn.execute(
        "INSERT INTO generation_latest VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["FR", today.isoformat(), 800.0, 1000.0, 2000.0, 0.0, 8000.0, 38000.0, 100.0, 200.0, 4000.0, 5000.0, 22.3, 59100.0],
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
        solar = round(4000.0 + 2000.0 * ((i % 365 - 180) / 365), 1)
        wind = round(10000.0 + 2000.0 * ((i % 365 - 90) / 365), 1)
        hydro = 1500.0
        gas = 5000.0
        coal = 8000.0
        nuclear = 0.0
        total = solar + wind + hydro + gas + coal + nuclear + 1200.0 + 200.0 + 500.0
        renewable_pct = round((solar + wind + hydro) / total * 100, 1)
        # zone, gen_date, biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind, renewable_pct, total_mw
        gen_rows.append(["DE-LU", day, 1200.0, coal, gas, 0.0, hydro, nuclear, 200.0, 500.0, solar, wind, renewable_pct, round(total, 1)])
        # FR: realistic nuclear + gas + wind/solar mix
        fr_nuclear = round(36000.0 + 2000.0 * ((i % 365 - 180) / 365), 1)
        fr_solar = round(6000.0 + 4000.0 * ((i % 365 - 180) / 365), 1)
        fr_wind = 5000.0
        fr_total = fr_nuclear + fr_solar + fr_wind + 3000.0 + 5000.0
        fr_re_pct = round((fr_solar + fr_wind) / fr_total * 100, 1)
        gen_rows.append(["FR", day, 300.0, 0.0, 3000.0, 0.0, 5000.0, fr_nuclear, 0.0, 200.0, fr_solar, fr_wind, fr_re_pct, round(fr_total, 1)])
    conn.executemany("INSERT INTO generation_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", gen_rows)

    # generation_hourly_recent (10 days of hourly data for DE-LU)
    # (12 cols: zone, ts, 10 fuels - no renewable_pct/total_mw)
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
        # zone, ts, biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind
        gen_hourly.append(["DE-LU", ts, 1200.0, 8000.0, 5000.0, 0.0, 1500.0, 0.0, 200.0, 500.0, solar_h, wind_h])
    conn.executemany("INSERT INTO generation_hourly_recent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", gen_hourly)

    # capacity_factors_daily (2 years of daily CF data for DE-LU)
    conn.execute("""
        CREATE TABLE capacity_factors_daily (
            zone VARCHAR, gen_date DATE,
            wind_cf REAL, solar_cf REAL,
            wind_mw REAL, solar_mw REAL,
            wind_installed_mw REAL, solar_installed_mw REAL
        )
    """)
    cf_rows = []
    for i in range((today - daily_start).days + 1):
        day = (daily_start + timedelta(days=i)).isoformat()
        solar = round(4000.0 + 2000.0 * ((i % 365 - 180) / 365), 1)
        wind = round(10000.0 + 2000.0 * ((i % 365 - 90) / 365), 1)
        cf_rows.append(["DE-LU", day, round(wind / 68000, 4), round(solar / 60000, 4), wind, solar, 68000.0, 60000.0])
    conn.executemany("INSERT INTO capacity_factors_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?)", cf_rows)

    # imbalance tables (trailing 10 days 15-min + 2Y daily + latest)
    from datetime import datetime as dt
    conn.execute("""
        CREATE TABLE imbalance_recent (ts TIMESTAMP, rebap_eur_mwh REAL)
    """)
    imb_start = dt(today.year, today.month, today.day) - timedelta(days=10)
    imb_recent_rows = []
    for i in range(10 * 24 * 4):
        ts = (imb_start + timedelta(minutes=15 * i)).strftime("%Y-%m-%d %H:%M:%S")
        price = round(80.0 + 50.0 * ((i % 96) / 96), 2)
        imb_recent_rows.append([ts, price])
    conn.executemany("INSERT INTO imbalance_recent VALUES (?, ?)", imb_recent_rows)

    conn.execute("""
        CREATE TABLE imbalance_daily (
            price_date DATE, mean_eur REAL, min_eur REAL, max_eur REAL, count INTEGER
        )
    """)
    imb_daily_start = date(today.year - 2, 1, 1)
    imb_daily_rows = []
    for i in range((today - imb_daily_start).days + 1):
        day = (imb_daily_start + timedelta(days=i)).isoformat()
        mean_e = round(85.0 + 30.0 * (i % 100) / 100, 2)
        imb_daily_rows.append([day, mean_e, round(mean_e - 20.0, 2), round(mean_e + 40.0, 2), 96])
    conn.executemany("INSERT INTO imbalance_daily VALUES (?, ?, ?, ?, ?)", imb_daily_rows)

    latest_ts = (dt(today.year, today.month, today.day) - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""
        CREATE TABLE imbalance_latest (
            current_ts TIMESTAMP, rebap_eur_mwh REAL,
            today_mean REAL, today_min REAL, today_max REAL
        )
    """)
    conn.execute(
        "INSERT INTO imbalance_latest VALUES (?, ?, ?, ?, ?)",
        [latest_ts, 95.0, 88.0, 60.0, 140.0],
    )

    conn.execute("""
        CREATE TABLE imbalance_hourly_profile (
            hour TINYINT, avg_eur REAL, p25_eur REAL, p75_eur REAL, neg_pct REAL
        )
    """)
    for h in range(24):
        # U-shaped profile: high at night/evening, low midday
        avg = 150.0 - 130.0 * (1 - abs(h - 12) / 12.0) ** 2
        neg = 40.0 if 10 <= h <= 14 else 2.0
        conn.execute(
            "INSERT INTO imbalance_hourly_profile VALUES (?, ?, ?, ?, ?)",
            [h, round(avg, 2), round(avg - 20, 2), round(avg + 20, 2), neg],
        )

    # divergence tables (Phase 14)
    conn.execute("""
        CREATE TABLE divergence_latest (
            from_zone VARCHAR, to_zone VARCHAR, price_date DATE,
            from_price REAL, to_price REAL, diff_eur_mwh REAL
        )
    """)
    conn.execute("""
        CREATE TABLE divergence_30d (
            from_zone VARCHAR, to_zone VARCHAR, price_date DATE,
            from_price REAL, to_price REAL, diff_eur_mwh REAL
        )
    """)
    for fz, tz, fp, tp in [("FR", "DE-LU", 65.0, 80.0), ("DE-LU", "NL", 80.0, 72.0)]:
        diff = round(fp - tp, 2)
        conn.execute(
            "INSERT INTO divergence_latest VALUES (?, ?, ?, ?, ?, ?)",
            [fz, tz, today.isoformat(), fp, tp, diff],
        )
    for i in range(30):
        day = (today - timedelta(days=29 - i)).isoformat()
        conn.execute(
            "INSERT INTO divergence_30d VALUES (?, ?, ?, ?, ?, ?)",
            ["FR", "DE-LU", day, 65.0 + i * 0.1, 80.0, round(65.0 + i * 0.1 - 80.0, 2)],
        )

    # battery dispatch tables (Phase 16)
    conn.execute("""
        CREATE TABLE battery_dispatch_recent (
            ts TIMESTAMP, rebap_price REAL, charge_mw REAL, discharge_mw REAL,
            soc_mwh REAL, cumulative_pnl_eur REAL
        )
    """)
    conn.execute("CREATE TABLE battery_summary (key VARCHAR PRIMARY KEY, value VARCHAR)")
    from datetime import datetime as dt2
    bat_start = dt2(today.year, today.month, today.day) - timedelta(days=30)
    pnl = 0.0
    for i in range(30 * 24):
        ts = (bat_start + timedelta(hours=i)).strftime("%Y-%m-%d %H:%M:%S")
        hour = i % 24
        price = round(80.0 + 60.0 * (hour / 23), 2)
        charge = 1.0 if hour in (2, 3) else 0.0
        discharge = 1.0 if hour in (18, 19) else 0.0
        pnl_delta = discharge * price * 0.92 - charge * price / 0.92
        pnl = round(pnl + pnl_delta, 2)
        conn.execute(
            "INSERT INTO battery_dispatch_recent VALUES (?, ?, ?, ?, ?, ?)",
            [ts, price, charge, discharge, 0.5, pnl],
        )
    for key, val in [
        ("total_pnl_eur", str(round(pnl, 2))),
        ("n_charge_hours", "60"),
        ("n_discharge_hours", "60"),
        ("avg_spread_captured_eur", "45.0"),
        ("avg_buy_price_eur", "82.0"),
        ("avg_sell_price_eur", "127.0"),
        ("trailing_days", "30"),
    ]:
        conn.execute("INSERT INTO battery_summary VALUES (?, ?)", [key, val])

    # multi-zone spreads (Phase multi-zone extension)
    conn.execute("""
        CREATE TABLE multi_zone_spreads (
            price_date DATE, zone VARCHAR,
            power_eur_mwh REAL, css REAL, cds REAL, fss REAL,
            regime_threshold VARCHAR
        )
    """)
    mz_start = date(today.year - 1, 1, 1)
    mz_zones = ["DE-LU", "FR", "NL", "IT-NORD", "BE", "AT"]
    mz_rows = []
    for zone_idx, zone in enumerate(mz_zones):
        base_power = 75.0 + zone_idx * 5.0
        for i in range((today - mz_start).days + 1):
            day = (mz_start + timedelta(days=i)).isoformat()
            power = round(base_power + (i % 365 - 182) * 0.2, 2)
            ttf = round(35.0 + (i % 365 - 182) * 0.05, 2)
            eua = 65.0
            coal_eur_mwh = 12.0
            css = round(power - ttf / 0.49 - eua * 0.364, 4)
            cds = round(power - coal_eur_mwh / 0.36 - eua * 0.96, 4)
            fss = round(css - cds, 4)
            regime = "gas" if fss > 0 else "coal"
            mz_rows.append([day, zone, power, css, cds, fss, regime])
    conn.executemany(
        "INSERT INTO multi_zone_spreads VALUES (?, ?, ?, ?, ?, ?, ?)",
        mz_rows,
    )

    # 30-day zone price correlation matrix
    conn.execute("""
        CREATE TABLE power_correlation_30d (
            zone_a VARCHAR, zone_b VARCHAR, correlation REAL
        )
    """)
    corr_zones = ["AT", "BE", "CH", "DE-LU", "FR", "IT-NORD", "NL", "ES", "PL", "SE-1"]
    import itertools
    for za, zb in itertools.combinations(corr_zones, 2):
        # Vary correlation: geographically close zones are more correlated
        if {za, zb} == {"FR", "SE-1"}:
            r = -0.24
        elif za in {"SE-1"} or zb in {"SE-1"}:
            r = round(0.1 + hash(za + zb) % 50 / 100, 3)
        else:
            r = round(0.7 + hash(za + zb) % 25 / 100, 3)
        conn.execute(
            "INSERT INTO power_correlation_30d VALUES (?, ?, ?)", [za, zb, r]
        )

    # TTF forward curve
    conn.execute("""
        CREATE TABLE ttf_curve_latest (
            contract VARCHAR, settlement REAL, tenor_type VARCHAR, sort_key INTEGER
        )
    """)
    curve_contracts = [
        ("Q3-26", 42.6, "Q3", 202607),
        ("Q4-26", 42.4, "Q4", 202610),
        ("WIN-26", 41.7, "WIN", 202610),
        ("CAL-27", 34.8, "CAL", 202701),
        ("SUM-27", 33.0, "SUM", 202704),
        ("WIN-27", 32.0, "WIN", 202710),
        ("CAL-28", 27.2, "CAL", 202801),
        ("SUM-28", 25.7, "SUM", 202804),
    ]
    conn.executemany("INSERT INTO ttf_curve_latest VALUES (?, ?, ?, ?)", curve_contracts)

    # TTF curve snapshots (Phase post-6: curve shift)
    conn.execute("""
        CREATE TABLE ttf_curve_snapshots (
            snapshot_label VARCHAR, contract VARCHAR,
            settlement REAL, tenor_type VARCHAR, sort_key INTEGER
        )
    """)
    for label in ["today", "-30d", "-180d", "-365d"]:
        offset_eur = {"today": 0.0, "-30d": 2.0, "-180d": 5.0, "-365d": -3.0}[label]
        for contract, base_price, tenor_type, sort_key in curve_contracts:
            conn.execute(
                "INSERT INTO ttf_curve_snapshots VALUES (?, ?, ?, ?, ?)",
                [label, contract, round(base_price + offset_eur, 2), tenor_type, sort_key],
            )

    # Storage injection seasonal (for pace endpoint seasonal norm)
    conn.execute("""
        CREATE TABLE storage_injection_seasonal (
            country VARCHAR, doy SMALLINT, avg_gwh_d REAL, p25_gwh_d REAL, p75_gwh_d REAL
        )
    """)
    for doy in range(1, 367):
        for cc in ("DE", "FR", "EU"):
            avg = round(80.0 + 20.0 * ((doy - 182) / 182) if doy < 270 else 0.0, 1)
            conn.execute(
                "INSERT INTO storage_injection_seasonal VALUES (?, ?, ?, ?, ?)",
                [cc, doy, avg, round(avg * 0.7, 1), round(avg * 1.3, 1)],
            )

    conn.execute("""
        CREATE TABLE forecast_accuracy (
            zone               VARCHAR,
            wind_mae_mw        REAL,
            wind_avg_mw        REAL,
            solar_mae_mw       REAL,
            solar_avg_mw       REAL,
            wind_installed_mw  REAL,
            solar_installed_mw REAL,
            wind_mae_pct       REAL,
            solar_mae_pct      REAL,
            n_hours            INTEGER
        )
    """)
    conn.execute(
        "INSERT INTO forecast_accuracy VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["DE-LU", 1216.7, 10508.0, 770.2, 13671.0, 63150.0, 81150.0, 1.9, 0.9, 6500],
    )

    # LNG tables
    conn.execute("""
        CREATE TABLE lng_latest (
            country VARCHAR, gas_day DATE, inventory_gwh REAL, sendout_gwh REAL,
            dtmi_gwh REAL, dtrs_gwh REAL, fill_pct REAL, sendout_util_pct REAL,
            d7_sendout_gwh REAL, vs_avg5_sendout REAL, avg5_sendout REAL
        )
    """)
    conn.execute("""
        INSERT INTO lng_latest VALUES
        ('EU', '2026-06-24', 31913.0, 3599.0, 62329.0, 7970.0, 51.2, 45.2, -362.0, 481.0, 3118.0),
        ('ES', '2026-06-24', 13575.0, 560.0, 23240.0, 2132.0, 58.4, 26.3, 65.0, 14.6, 545.6),
        ('IT', '2026-06-24', 2518.0, 663.0, 5205.0, 890.0, 48.4, 74.6, 87.0, 197.0, 466.0)
    """)
    conn.execute("""
        CREATE TABLE lng_trend (
            gas_day DATE, inventory_gwh REAL, sendout_gwh REAL, dtmi_gwh REAL,
            dtrs_gwh REAL, fill_pct REAL, sendout_util_pct REAL, avg5_sendout REAL
        )
    """)
    conn.execute(
        "INSERT INTO lng_trend VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [date.today() - timedelta(days=1), 31913.0, 3599.0, 62329.0, 7970.0, 51.2, 45.2, 3118.0],
    )
    conn.execute("""
        CREATE TABLE lng_seasonal (
            country VARCHAR, doy SMALLINT, avg5_sendout REAL, min5_sendout REAL,
            max5_sendout REAL, avg5_fill REAL, min5_fill REAL, max5_fill REAL
        )
    """)
    conn.execute(
        "INSERT INTO lng_seasonal VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["EU", 175, 3118.0, 2800.0, 3600.0, 50.0, 40.0, 65.0],
    )
    conn.execute("""
        CREATE TABLE lng_history (
            country VARCHAR, gas_day DATE, inventory_gwh REAL, sendout_gwh REAL,
            dtmi_gwh REAL, dtrs_gwh REAL, fill_pct REAL, sendout_util_pct REAL
        )
    """)
    conn.execute(
        "INSERT INTO lng_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ["ES", date.today() - timedelta(days=1), 13575.0, 560.0, 23240.0, 2132.0, 58.4, 26.3],
    )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_lng", "2026-06-24T12:00:00+00:00"])

    # --- Nuclear heat risk tables ---
    conn.execute("""
        CREATE TABLE nuclear_heat_risk_latest (
            plant_code VARCHAR, plant_name VARCHAR, river VARCHAR,
            capacity_mw INTEGER, lat REAL, lon REAL,
            obs_date DATE, temp_max_c REAL, avg5_temp_c REAL, anomaly_c REAL,
            alert_level VARCHAR, days_above_35_last5 INTEGER,
            peak_fc_temp_c REAL, peak_fc_date DATE, fc_alert_level VARCHAR,
            implied_river_c REAL, river_limit_c REAL, summer_limit_c REAL
        )
    """)
    conn.executemany(
        "INSERT INTO nuclear_heat_risk_latest VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            ["TRICASTIN",  "Tricastin",   "Rhone",   3600, 44.332, 4.732,
             (date.today() - timedelta(days=1)).isoformat(),
             38.5, 28.1, 10.4, "critical", 4, 39.4, date.today().isoformat(), "critical",
             30.5, 24.0, 27.0],
            ["GOLFECH",    "Golfech",     "Garonne", 1400, 44.107, 0.851,
             (date.today() - timedelta(days=1)).isoformat(),
             34.0, 27.5, 6.5,  "warning",  2, 32.0, date.today().isoformat(), "warning",
             27.3, 24.0, 28.0],
            ["CATTENOM",   "Cattenom",    "Moselle", 5400, 49.400, 6.218,
             (date.today() - timedelta(days=1)).isoformat(),
             27.0, 25.0, 2.0,  "normal",   0, 28.0, date.today().isoformat(), "normal",
             21.0, 24.0, 28.0],
        ],
    )
    conn.execute("""
        CREATE TABLE nuclear_heat_risk_trend (
            plant_code VARCHAR, plant_name VARCHAR, river VARCHAR,
            obs_date DATE, temp_max_c REAL, is_forecast BOOLEAN
        )
    """)
    for i in range(10):
        d = (date.today() - timedelta(days=9 - i)).isoformat()
        conn.execute(
            "INSERT INTO nuclear_heat_risk_trend VALUES (?,?,?,?,?,?)",
            ["TRICASTIN", "Tricastin", "Rhone", d, 30.0 + i * 1.2, False],
        )
    conn.execute(
        "INSERT INTO nuclear_heat_risk_trend VALUES (?,?,?,?,?,?)",
        ["TRICASTIN", "Tricastin", "Rhone", (date.today() + timedelta(days=1)).isoformat(), 40.0, True],
    )
    conn.execute("""
        CREATE TABLE nuclear_heat_risk_seasonal (
            plant_code VARCHAR, doy SMALLINT, avg5 REAL, min5 REAL, max5 REAL
        )
    """)
    conn.execute(
        "INSERT INTO nuclear_heat_risk_seasonal VALUES (?,?,?,?,?)",
        ["TRICASTIN", 176, 28.1, 22.0, 38.0],
    )
    conn.execute("INSERT INTO meta VALUES (?, ?)", ["refreshed_at_heat_risk", "2026-06-25T08:00:00+00:00"])

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
