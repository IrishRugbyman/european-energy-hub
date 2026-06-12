"""energy-api: European Energy Hub backend.

Phase 1+2: gas storage + power price endpoints.
Port :8004. Read-only against energy_hub.duckdb (rebuilt by scripts/refresh.py).
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import db
from .schemas import (
    GasCountryResponse,
    GasMapResponse,
    HealthResponse,
    MetaResponse,
    PowerDailyPoint,
    PowerHourlyPoint,
    PowerLatestRow,
    PowerMapResponse,
    PowerZoneResponse,
    SeasonalBandPoint,
    SeasonalPoint,
    StorageLatestRow,
)


def _rate_limited():
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=429, content={"detail": "rate limit exceeded"})


limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app = FastAPI(title="energy-api", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, lambda r, e: _rate_limited())
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://energy.lbzgiu.xyz", "http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _iso(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, str):
        return v
    return str(v)


def _meta_val(key: str) -> str | None:
    return db.scalar(f"SELECT value FROM meta WHERE key = ?", [key])


@app.get("/api/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        ok=True,
        refreshed_at_gas=_meta_val("refreshed_at_gas"),
        refreshed_at_power=_meta_val("refreshed_at_power"),
    )


@app.get("/api/meta", response_model=MetaResponse)
def meta():
    cc_df = db.query("SELECT DISTINCT country FROM storage_latest ORDER BY country")
    countries = cc_df["country"].tolist() if not cc_df.empty else []
    zone_df = db.query("SELECT DISTINCT zone FROM power_latest ORDER BY zone")
    zones = zone_df["zone"].tolist() if not zone_df.empty else []
    return MetaResponse(
        gas_countries=countries,
        gas_refreshed_at=_meta_val("refreshed_at_gas"),
        power_zones=zones,
        power_refreshed_at=_meta_val("refreshed_at_power"),
    )


@app.get("/api/gas/map", response_model=GasMapResponse)
def gas_map():
    df = db.query(
        """
        SELECT country, gas_day::VARCHAR AS gas_day, full_pct, d7_pct, vs_avg5_pct,
               yoy_pct, injection, withdrawal, working_gas_volume
        FROM storage_latest
        ORDER BY country
        """
    )
    if df.empty:
        return GasMapResponse(as_of=datetime.now(timezone.utc).isoformat(), rows=[])

    rows = [
        StorageLatestRow(
            country=str(r.country),
            gas_day=str(r.gas_day),
            full_pct=_float(r.full_pct),
            d7_pct=_float(r.d7_pct),
            vs_avg5_pct=_float(r.vs_avg5_pct),
            yoy_pct=_float(r.yoy_pct),
            injection=_float(r.injection),
            withdrawal=_float(r.withdrawal),
            working_gas_volume=_float(r.working_gas_volume),
        )
        for r in df.itertuples()
    ]
    as_of = _meta_val("refreshed_at_gas") or datetime.now(timezone.utc).isoformat()
    return GasMapResponse(as_of=as_of, rows=rows)


@app.get("/api/gas/country/{cc}", response_model=GasCountryResponse)
def gas_country(cc: str):
    cc = cc.upper()
    latest_df = db.query(
        """
        SELECT country, gas_day::VARCHAR AS gas_day, full_pct, d7_pct, vs_avg5_pct,
               yoy_pct, injection, withdrawal, working_gas_volume
        FROM storage_latest WHERE country = ?
        """,
        [cc],
    )
    if latest_df.empty:
        raise HTTPException(status_code=404, detail=f"Country not found: {cc}")

    r = latest_df.iloc[0]
    latest = StorageLatestRow(
        country=cc,
        gas_day=str(r["gas_day"]),
        full_pct=_float(r["full_pct"]),
        d7_pct=_float(r["d7_pct"]),
        vs_avg5_pct=_float(r["vs_avg5_pct"]),
        yoy_pct=_float(r["yoy_pct"]),
        injection=_float(r["injection"]),
        withdrawal=_float(r["withdrawal"]),
        working_gas_volume=_float(r["working_gas_volume"]),
    )

    # Current year and prior year daily series
    hist_df = db.query(
        """
        SELECT gas_day::VARCHAR AS gas_day, full_pct, injection, withdrawal
        FROM storage_history
        WHERE country = ?
          AND gas_day >= make_date(year(current_date) - 1, 1, 1)
        ORDER BY gas_day
        """,
        [cc],
    )

    current_year = datetime.now(timezone.utc).year
    current: list[SeasonalPoint] = []
    prior: list[SeasonalPoint] = []

    if not hist_df.empty:
        for row in hist_df.itertuples():
            yr = int(str(row.gas_day)[:4])
            pt = SeasonalPoint(
                gas_day=str(row.gas_day),
                full_pct=_float(row.full_pct),
                injection=_float(row.injection),
                withdrawal=_float(row.withdrawal),
            )
            if yr == current_year:
                current.append(pt)
            else:
                prior.append(pt)

    # 5-year seasonal band
    band_df = db.query(
        "SELECT doy, avg5, min5, max5 FROM storage_seasonal WHERE country = ? ORDER BY doy",
        [cc],
    )
    band = [
        SeasonalBandPoint(doy=int(row.doy), avg5=_float(row.avg5), min5=_float(row.min5), max5=_float(row.max5))
        for row in band_df.itertuples()
    ] if not band_df.empty else []

    return GasCountryResponse(
        country=cc,
        latest=latest,
        current_year=current,
        prior_year=prior,
        seasonal_band=band,
    )


@app.get("/api/power/map", response_model=PowerMapResponse)
def power_map():
    df = db.query(
        "SELECT zone, price_date::VARCHAR AS price_date, base_eur, peak_eur, vs_30d_pct FROM power_latest ORDER BY zone",
            )
    if df.empty:
        return PowerMapResponse(
            as_of=datetime.now(timezone.utc).isoformat(),
            price_date="",
            rows=[],
        )
    rows = [
        PowerLatestRow(
            zone=str(r.zone),
            price_date=str(r.price_date),
            base_eur=_float(r.base_eur),
            peak_eur=_float(r.peak_eur),
            vs_30d_pct=_float(r.vs_30d_pct),
        )
        for r in df.itertuples()
    ]
    # Use the most recent price_date across all zones as the map date
    price_date = max((r.price_date for r in rows if r.price_date), default="")
    as_of = _meta_val("refreshed_at_power") or datetime.now(timezone.utc).isoformat()
    return PowerMapResponse(as_of=as_of, price_date=price_date, rows=rows)


@app.get("/api/power/zone/{zone_id}", response_model=PowerZoneResponse)
def power_zone(zone_id: str):
    zone_id = zone_id.upper()
    # Normalise: replace underscore with hyphen for lookup (API uses DE-LU, not DE_LU)
    # The DB stores zone names as they appear in config (e.g. "DE-LU", "SE-1")
    latest_df = db.query(
        "SELECT zone, price_date::VARCHAR AS price_date, base_eur, peak_eur, vs_30d_pct FROM power_latest WHERE zone = ?",
        [zone_id],
            )
    if latest_df is None or latest_df.empty:
        raise HTTPException(status_code=404, detail=f"Zone not found: {zone_id}")

    r = latest_df.iloc[0]
    latest = PowerLatestRow(
        zone=zone_id,
        price_date=str(r["price_date"]),
        base_eur=_float(r["base_eur"]),
        peak_eur=_float(r["peak_eur"]),
        vs_30d_pct=_float(r["vs_30d_pct"]),
    )

    hourly_df = db.query(
        """
        SELECT ts::VARCHAR AS ts, price_eur_mwh
        FROM power_hourly_recent
        WHERE zone = ?
        ORDER BY ts
        """,
        [zone_id],
            )
    hourly = [
        PowerHourlyPoint(ts=str(row.ts), price_eur_mwh=_float(row.price_eur_mwh))
        for row in (hourly_df.itertuples() if not hourly_df.empty else [])
    ]

    daily_df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date, base_eur, peak_eur
        FROM power_daily
        WHERE zone = ?
          AND price_date >= current_date - INTERVAL '2 years'
        ORDER BY price_date
        """,
        [zone_id],
            )
    daily = [
        PowerDailyPoint(
            price_date=str(row.price_date),
            base_eur=_float(row.base_eur),
            peak_eur=_float(row.peak_eur),
        )
        for row in (daily_df.itertuples() if not daily_df.empty else [])
    ]

    return PowerZoneResponse(zone=zone_id, latest=latest, hourly_recent=hourly, daily_history=daily)


def _float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if pd.isna(f) else round(f, 4)
    except (TypeError, ValueError):
        return None
