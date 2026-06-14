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
    BorderFlowRow,
    CongestionBorderResponse,
    CongestionResponse,
    CongestionRow,
    FlowsResponse,
    GasCountryResponse,
    GasFlowCountryResponse,
    GasFlowItem,
    GasFlowResponse,
    GasMapResponse,
    GenDailyPoint,
    GenHourlyPoint,
    GenMapItem,
    GenMapResponse,
    GenZoneResponse,
    GenerationMixRow,
    HealthResponse,
    MetaResponse,
    PowerDailyPoint,
    PowerHourlyPoint,
    PowerLatestRow,
    PowerMapResponse,
    PowerZoneResponse,
    PricesDailyPoint,
    PricesResponse,
    SeasonalBandPoint,
    SeasonalPoint,
    SpreadsDailyPoint,
    SpreadsResponse,
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
        spreads_refreshed_at=_meta_val("refreshed_at_spreads"),
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


@app.get("/api/gas/flows", response_model=GasFlowResponse)
def gas_flows():
    """Latest ENTSOG physical gas flow (entry/exit/net GWh/d) per country."""
    df = db.query(
        """
        SELECT country, period_date::VARCHAR AS period_date,
               entry_gwh_d, exit_gwh_d, net_gwh_d
        FROM gas_flows_latest
        ORDER BY country
        """
    )
    as_of = _meta_val("refreshed_at_gas_flows")
    if df is None or df.empty:
        return GasFlowResponse(as_of=as_of, rows=[])

    rows = [
        GasFlowItem(
            country=str(r.country),
            period_date=str(r.period_date),
            net_gwh_d=_float(r.net_gwh_d),
            entry_gwh_d=_float(r.entry_gwh_d),
            exit_gwh_d=_float(r.exit_gwh_d),
        )
        for r in df.itertuples()
    ]
    return GasFlowResponse(as_of=as_of, rows=rows)


@app.get("/api/gas/flows/{cc}", response_model=GasFlowCountryResponse)
def gas_flows_country(cc: str):
    """ENTSOG physical gas flow history (trailing 400 days) for one country."""
    cc = cc.upper()
    df = db.query(
        """
        SELECT country, period_date::VARCHAR AS period_date,
               entry_gwh_d, exit_gwh_d, net_gwh_d
        FROM gas_flows_daily
        WHERE country = ?
        ORDER BY period_date
        """,
        [cc],
    )
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No gas flow data for country: {cc}")

    rows = [
        GasFlowItem(
            country=str(r.country),
            period_date=str(r.period_date),
            net_gwh_d=_float(r.net_gwh_d),
            entry_gwh_d=_float(r.entry_gwh_d),
            exit_gwh_d=_float(r.exit_gwh_d),
        )
        for r in df.itertuples()
    ]
    return GasFlowCountryResponse(country=cc, rows=rows)


@app.get("/api/power/congestion", response_model=CongestionResponse)
def power_congestion():
    """Latest NTC utilization per directed border pair (congestion_latest)."""
    df = db.query(
        """
        SELECT from_zone, to_zone, price_date::VARCHAR AS price_date,
               ntc_mw, scheduled_mw, utilization_pct
        FROM congestion_latest
        ORDER BY from_zone, to_zone
        """
    )
    as_of = _meta_val("refreshed_at_congestion")
    if df.empty:
        return CongestionResponse(as_of=as_of, rows=[])
    rows = [
        CongestionRow(
            from_zone=str(r.from_zone),
            to_zone=str(r.to_zone),
            price_date=str(r.price_date),
            ntc_mw=_float(r.ntc_mw),
            scheduled_mw=_float(r.scheduled_mw),
            utilization_pct=_float(r.utilization_pct),
        )
        for r in df.itertuples()
    ]
    return CongestionResponse(as_of=as_of, rows=rows)


@app.get("/api/power/congestion/border/{from_zone}/{to_zone}", response_model=CongestionBorderResponse)
def power_congestion_border(from_zone: str, to_zone: str):
    """Trailing-400d NTC utilization for one directed border pair."""
    fz = from_zone.upper().replace("_", "-")
    tz = to_zone.upper().replace("_", "-")
    df = db.query(
        """
        SELECT from_zone, to_zone, price_date::VARCHAR AS price_date,
               ntc_mw, scheduled_mw, utilization_pct
        FROM congestion_daily
        WHERE from_zone = ? AND to_zone = ?
        ORDER BY price_date
        """,
        [fz, tz],
    )
    if df.empty:
        raise HTTPException(status_code=404, detail=f"Border not found: {fz}->{tz}")
    rows = [
        CongestionRow(
            from_zone=str(r.from_zone),
            to_zone=str(r.to_zone),
            price_date=str(r.price_date),
            ntc_mw=_float(r.ntc_mw),
            scheduled_mw=_float(r.scheduled_mw),
            utilization_pct=_float(r.utilization_pct),
        )
        for r in df.itertuples()
    ]
    return CongestionBorderResponse(from_zone=fz, to_zone=tz, rows=rows)


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

    gen_df = db.query(
        """
        SELECT zone, gen_date::VARCHAR AS gen_date,
               biomass, coal, gas, geothermal, hydro, oil, solar, unknown, wind,
               renewable_pct, total_mw
        FROM generation_latest WHERE zone = ?
        """,
        [zone_id],
    )
    gen_mix: GenerationMixRow | None = None
    if not gen_df.empty:
        gr = gen_df.iloc[0]
        gen_mix = GenerationMixRow(
            zone=zone_id,
            gen_date=str(gr["gen_date"]),
            biomass=_float(gr["biomass"]),
            coal=_float(gr["coal"]),
            gas=_float(gr["gas"]),
            geothermal=_float(gr["geothermal"]),
            hydro=_float(gr["hydro"]),
            oil=_float(gr["oil"]),
            solar=_float(gr["solar"]),
            unknown=_float(gr["unknown"]),
            wind=_float(gr["wind"]),
            renewable_pct=_float(gr["renewable_pct"]),
            total_mw=_float(gr["total_mw"]),
        )

    gen_hourly_df = db.query(
        """
        SELECT ts::VARCHAR AS ts,
               biomass, coal, gas, geothermal, hydro, oil, solar, unknown, wind
        FROM generation_hourly_recent
        WHERE zone = ?
        ORDER BY ts
        """,
        [zone_id],
    )
    gen_hourly = [
        GenHourlyPoint(
            ts=str(r.ts),
            biomass=_float(r.biomass),
            coal=_float(r.coal),
            gas=_float(r.gas),
            geothermal=_float(r.geothermal),
            hydro=_float(r.hydro),
            oil=_float(r.oil),
            solar=_float(r.solar),
            unknown=_float(r.unknown),
            wind=_float(r.wind),
        )
        for r in (gen_hourly_df.itertuples() if not gen_hourly_df.empty else [])
    ]

    return PowerZoneResponse(
        zone=zone_id,
        latest=latest,
        hourly_recent=hourly,
        daily_history=daily,
        generation_mix=gen_mix,
        generation_hourly=gen_hourly,
    )


@app.get("/api/flows", response_model=FlowsResponse)
def flows(date: str | None = None):
    """Latest day's net cross-border flows, or a specific date (YYYY-MM-DD)."""
    if date:
        df = db.query(
            """
            SELECT price_date::VARCHAR AS price_date, from_zone, to_zone, net_flow_mw
            FROM borders_daily
            WHERE price_date = ?
            ORDER BY from_zone, to_zone
            """,
            [date],
        )
    else:
        df = db.query(
            """
            SELECT price_date::VARCHAR AS price_date, from_zone, to_zone, net_flow_mw
            FROM borders_daily
            WHERE price_date = (SELECT MAX(price_date) FROM borders_daily)
            ORDER BY from_zone, to_zone
            """
        )
    if df.empty:
        return FlowsResponse(price_date=date, rows=[])
    price_date = str(df["price_date"].iloc[0])
    rows = [
        BorderFlowRow(
            from_zone=str(r.from_zone),
            to_zone=str(r.to_zone),
            net_flow_mw=_float(r.net_flow_mw),
        )
        for r in df.itertuples()
    ]
    return FlowsResponse(price_date=price_date, rows=rows)


@app.get("/api/spreads", response_model=SpreadsResponse)
def spreads():
    df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date,
               power_de, ttf, eua, coal_eur_mwh, css, cds, fss, regime_threshold
        FROM spreads_daily
        ORDER BY price_date
        """
    )
    as_of = _meta_val("refreshed_at_spreads")
    if df.empty:
        return SpreadsResponse(as_of=as_of, rows=[])
    rows = [
        SpreadsDailyPoint(
            price_date=str(r.price_date),
            power_de=_float(r.power_de),
            ttf=_float(r.ttf),
            eua=_float(r.eua),
            coal_eur_mwh=_float(r.coal_eur_mwh),
            css=_float(r.css),
            cds=_float(r.cds),
            fss=_float(r.fss),
            regime_threshold=str(r.regime_threshold) if r.regime_threshold else None,
        )
        for r in df.itertuples()
    ]
    return SpreadsResponse(as_of=as_of, rows=rows)


@app.get("/api/prices", response_model=PricesResponse)
def prices():
    df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date,
               ttf_eur_mwh, eua_eur_t, coal_usd_t, hh_usd_mmbtu
        FROM prices_daily
        ORDER BY price_date
        """
    )
    as_of = _meta_val("refreshed_at_spreads")
    if df.empty:
        return PricesResponse(as_of=as_of, rows=[])
    rows = [
        PricesDailyPoint(
            price_date=str(r.price_date),
            ttf_eur_mwh=_float(r.ttf_eur_mwh),
            eua_eur_t=_float(r.eua_eur_t),
            coal_usd_t=_float(r.coal_usd_t),
            hh_usd_mmbtu=_float(r.hh_usd_mmbtu),
        )
        for r in df.itertuples()
    ]
    return PricesResponse(as_of=as_of, rows=rows)


@app.get("/api/generation/map", response_model=GenMapResponse)
def generation_map():
    """Current renewable % and fuel summary per bidding zone."""
    df = db.query("""
        SELECT zone, gen_date::VARCHAR AS gen_date,
               renewable_pct, solar AS solar_mw, wind AS wind_mw,
               hydro AS hydro_mw, gas AS gas_mw, coal AS coal_mw, total_mw
        FROM generation_latest
        ORDER BY zone
    """)
    if df.empty:
        raise HTTPException(status_code=503, detail="generation data not yet available")
    as_of = _meta_val("refreshed_at_power")
    zones = [
        GenMapItem(
            zone=str(r.zone),
            gen_date=_iso(r.gen_date),
            renewable_pct=_float(r.renewable_pct),
            solar_mw=_float(r.solar_mw),
            wind_mw=_float(r.wind_mw),
            hydro_mw=_float(r.hydro_mw),
            gas_mw=_float(r.gas_mw),
            coal_mw=_float(r.coal_mw),
            total_mw=_float(r.total_mw),
        )
        for r in df.itertuples()
    ]
    return GenMapResponse(as_of=as_of, zones=zones)


_FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "oil", "solar", "unknown", "wind")


@app.get("/api/generation/zone/{zone_id}", response_model=GenZoneResponse)
def generation_zone(zone_id: str):
    """Hourly fuel mix (last 10 days) and daily renewable trend (2Y) for a zone."""
    zone_id = zone_id.upper()

    latest_df = db.query(
        """
        SELECT gen_date::VARCHAR AS gen_date, renewable_pct, total_mw,
               biomass, coal, gas, geothermal, hydro, oil, solar, unknown, wind
        FROM generation_latest WHERE zone = ?
        """,
        [zone_id],
    )
    if latest_df.empty:
        raise HTTPException(status_code=404, detail=f"Zone {zone_id!r} not found")

    lr = latest_df.iloc[0]
    fuel_vals = {k: (_float(lr[k]) or 0.0) for k in _FUEL_COLS}
    dominant_fuel = max(fuel_vals, key=lambda k: fuel_vals[k]) if fuel_vals else None

    hourly_df = db.query(
        """
        SELECT ts::VARCHAR AS ts, biomass, coal, gas, geothermal, hydro, oil, solar, unknown, wind
        FROM generation_hourly_recent
        WHERE zone = ?
        ORDER BY ts
        """,
        [zone_id],
    )
    hourly = [
        GenHourlyPoint(
            ts=str(r.ts),
            biomass=_float(r.biomass),
            coal=_float(r.coal),
            gas=_float(r.gas),
            geothermal=_float(r.geothermal),
            hydro=_float(r.hydro),
            oil=_float(r.oil),
            solar=_float(r.solar),
            unknown=_float(r.unknown),
            wind=_float(r.wind),
        )
        for r in (hourly_df.itertuples() if not hourly_df.empty else [])
    ]

    daily_df = db.query(
        """
        SELECT gen_date::VARCHAR AS gen_date, renewable_pct,
               solar, wind, hydro, gas, coal, total_mw
        FROM generation_daily
        WHERE zone = ? AND gen_date >= current_date - interval '2 years'
        ORDER BY gen_date
        """,
        [zone_id],
    )
    daily = [
        GenDailyPoint(
            gen_date=str(r.gen_date),
            renewable_pct=_float(r.renewable_pct),
            solar=_float(r.solar),
            wind=_float(r.wind),
            hydro=_float(r.hydro),
            gas=_float(r.gas),
            coal=_float(r.coal),
            total_mw=_float(r.total_mw),
        )
        for r in (daily_df.itertuples() if not daily_df.empty else [])
    ]

    return GenZoneResponse(
        zone=zone_id,
        gen_date=_iso(lr["gen_date"]),
        renewable_pct=_float(lr["renewable_pct"]),
        total_mw=_float(lr["total_mw"]),
        dominant_fuel=dominant_fuel,
        hourly=hourly,
        daily=daily,
    )


def _float(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if pd.isna(f) else round(f, 4)
    except (TypeError, ValueError):
        return None
