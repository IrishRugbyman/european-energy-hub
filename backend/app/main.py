"""energy-api: European Energy Hub backend.

Phase 1+2: gas storage + power price endpoints.
Port :8004. Read-only against energy_hub.duckdb (rebuilt by scripts/refresh.py).
"""

from __future__ import annotations

import math
import statistics
from datetime import date, datetime, timezone
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
    BatteryHourlyPoint,
    BatteryResponse,
    BatterySummary,
    BorderFlowRow,
    CongestionBorderResponse,
    CongestionResponse,
    CongestionRow,
    DivergenceBorderHistory,
    DivergenceDailyPoint,
    DivergenceLatestRow,
    DivergenceResponse,
    FlowsResponse,
    GasCountryResponse,
    GasDoyPoint,
    GasYearTrack,
    GasFlowCountryResponse,
    GasFlowItem,
    GasFlowResponse,
    GasMapResponse,
    GenAnnualRow,
    GenTrendsResponse,
    GenDailyPoint,
    GenHourlyPoint,
    GenMapItem,
    GenMapResponse,
    GenZoneResponse,
    GenerationMixRow,
    HealthResponse,
    MetaResponse,
    DowPoint,
    HourlyProfilePoint,
    MonthPoint,
    PowerDailyPoint,
    PowerSeasonalityResponse,
    PowerHourlyPoint,
    PowerLatestRow,
    PowerMapResponse,
    PowerZoneProfileResponse,
    PowerZoneResponse,
    ImbalanceDailyPoint,
    ImbalanceLatest,
    ImbalanceRecentPoint,
    ImbalanceResponse,
    PricesDailyPoint,
    PricesResponse,
    SeasonalBandPoint,
    SeasonalPoint,
    SpreadsDailyPoint,
    SpreadsResponse,
    StorageLatestRow,
    MultiZoneSpreadRow,
    MultiZoneSpreadsResponse,
    PriceRegimePoint,
    PriceRegimeResponse,
    TtfCurvePoint,
    TtfCurveResponse,
    TtfSeasonalMonth,
    TtfSeasonalityResponse,
    CapacityFactorPoint,
    GenCapacityResponse,
    GasPacePoint,
    GasPaceStats,
    GasPaceResponse,
    CountryPaceRow,
    GasPaceCountriesResponse,
    ImbalanceHourlyPoint,
    ImbalanceProfileResponse,
    EuAnnualFuelRow,
    EuAnnualFuelResponse,
    ZoneCorrelationRow,
    PowerCorrelationResponse,
    TtfCurveSnapshotRow,
    TtfCurveSnapshotsResponse,
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
        imbalance_refreshed_at=_meta_val("refreshed_at_imbalance"),
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

    pipeline_offline_bcm: float | None = None
    try:
        dis_df = db.query(
            "SELECT disruption_bcm FROM spreads_daily ORDER BY price_date DESC LIMIT 1"
        )
        if not dis_df.empty:
            pipeline_offline_bcm = _float(dis_df["disruption_bcm"].iloc[0])
    except Exception:
        pass

    return GasMapResponse(as_of=as_of, rows=rows, pipeline_offline_bcm=pipeline_offline_bcm)


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

    # Year-on-year tracks: daily fill% per calendar year, aligned to day-of-year
    tracks_df = db.query(
        """
        SELECT YEAR(gas_day) AS year,
               DAYOFYEAR(gas_day) AS doy,
               full_pct
        FROM storage_history
        WHERE country = ?
          AND YEAR(gas_day) >= 2019
        ORDER BY year, doy
        """,
        [cc],
    )
    yearly_tracks: list[GasYearTrack] = []
    if not tracks_df.empty:
        from itertools import groupby
        rows_iter = (
            (int(r.year), int(r.doy), _float(r.full_pct))
            for r in tracks_df.itertuples()
        )
        for yr, group in groupby(rows_iter, key=lambda x: x[0]):
            pts = [GasDoyPoint(doy=doy, full_pct=fp) for _, doy, fp in group]
            yearly_tracks.append(GasYearTrack(year=yr, data=pts))

    # Pace-to-target stats using the most recent 90d history
    pace_stats: GasPaceStats | None = None
    recent_hist = db.query(
        """
        SELECT gas_day::VARCHAR AS gas_day, full_pct, injection, withdrawal, working_gas_volume
        FROM storage_history
        WHERE country = ?
          AND gas_day >= current_date - INTERVAL '90 days'
        ORDER BY gas_day
        """,
        [cc],
    )
    if recent_hist is not None and not recent_hist.empty:
        lat = recent_hist.iloc[-1]
        c_pct = _float(lat["full_pct"]) or 0.0
        c_date_str = str(lat["gas_day"])
        c_date_obj = date.fromisoformat(c_date_str)
        wgv_twh = _float(lat["working_gas_volume"]) or 1.0
        nov1 = date(c_date_obj.year, 11, 1)
        if c_date_obj >= nov1:
            nov1 = date(c_date_obj.year + 1, 11, 1)
        days_to_t = (nov1 - c_date_obj).days
        tail7 = recent_hist.tail(7)
        inj_vals = tail7["injection"].fillna(0) - tail7["withdrawal"].fillna(0)
        c_rate = float(inj_vals.mean()) if not inj_vals.empty else 0.0
        pct_gap = _GAS_FILL_TARGET_PCT - c_pct
        req_total = (pct_gap / 100) * wgv_twh * 1000
        req_rate = req_total / days_to_t if days_to_t > 0 else None
        days_at = req_total / c_rate if c_rate > 0 else None
        pace_stats = GasPaceStats(
            country=cc,
            current_pct=round(c_pct, 2),
            current_date=c_date_str,
            target_date=nov1.isoformat(),
            target_pct=_GAS_FILL_TARGET_PCT,
            days_to_target=days_to_t,
            pct_gap=round(pct_gap, 2),
            required_gwh_per_day=round(req_rate, 1) if req_rate is not None else None,
            current_rate_gwh_per_day=round(c_rate, 1),
            days_at_current_rate=round(days_at) if days_at is not None else None,
            on_track=(days_at <= days_to_t) if days_at is not None else None,
            history=[],
        )

    return GasCountryResponse(
        country=cc,
        latest=latest,
        current_year=current,
        prior_year=prior,
        seasonal_band=band,
        yearly_tracks=yearly_tracks,
        pace=pace_stats,
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


_GAS_FILL_TARGET_PCT = 90.0


@app.get("/api/gas/pace", response_model=GasPaceResponse)
def gas_pace_to_target():
    """EU gas storage pace-to-target.

    Returns current fill %, required daily injection rate to reach 90% by Nov 1,
    current 7-day avg net injection rate, whether on track, and a 90-day history
    with 5yr seasonal avg band and projected trajectory to Nov 1.
    """
    # Last 90 days of EU history + seasonal band
    hist_df = db.query("""
        SELECT h.gas_day::VARCHAR AS gas_day,
               h.full_pct,
               h.injection,
               h.withdrawal,
               h.working_gas_volume,
               s.avg5
        FROM storage_history h
        LEFT JOIN storage_seasonal s
          ON s.country = 'EU'
         AND s.doy = DAYOFYEAR(h.gas_day)
        WHERE h.country = 'EU'
          AND h.gas_day >= current_date - INTERVAL '90 days'
        ORDER BY h.gas_day
    """)
    if hist_df is None or hist_df.empty:
        raise HTTPException(status_code=503, detail="Gas storage data not available")

    latest = hist_df.iloc[-1]
    current_pct = _float(latest["full_pct"]) or 0.0
    current_date_str = str(latest["gas_day"])
    current_date_obj = date.fromisoformat(current_date_str)
    wgv_twh = _float(latest["working_gas_volume"]) or 1.0

    # Target date: Nov 1 this year (or next if already past)
    nov1 = date(current_date_obj.year, 11, 1)
    if current_date_obj >= nov1:
        nov1 = date(current_date_obj.year + 1, 11, 1)
    days_to_target = (nov1 - current_date_obj).days

    # 7-day avg net injection (GWh/day)
    recent = hist_df.tail(7)
    inj_vals = (recent["injection"].fillna(0) - recent["withdrawal"].fillna(0))
    current_rate = float(inj_vals.mean()) if not inj_vals.empty else 0.0

    # Required total injection (GWh)
    pct_gap = _GAS_FILL_TARGET_PCT - current_pct
    required_total_gwh = (pct_gap / 100) * wgv_twh * 1000  # TWh -> GWh
    required_rate = required_total_gwh / days_to_target if days_to_target > 0 else None
    days_at_current = (
        required_total_gwh / current_rate if current_rate > 0 else None
    )
    on_track = (days_at_current <= days_to_target) if days_at_current is not None else None

    # Build history list (actual fill + seasonal avg5)
    history: list[GasPacePoint] = []
    for r in hist_df.itertuples():
        history.append(GasPacePoint(
            gas_day=str(r.gas_day),
            full_pct=_float(r.full_pct),
            avg5=_float(r.avg5),
            projected=None,
        ))

    # Append projected trajectory from current date to Nov 1 at current rate
    wgv_gwh = wgv_twh * 1000
    for d_offset in range(1, days_to_target + 1):
        proj_day = date.fromordinal(current_date_obj.toordinal() + d_offset)
        projected_gwh_stored = (current_pct / 100 * wgv_gwh) + current_rate * d_offset
        projected_pct = max(0.0, min(projected_gwh_stored / wgv_gwh * 100, 100.0))
        history.append(GasPacePoint(
            gas_day=proj_day.isoformat(),
            full_pct=None,
            avg5=None,
            projected=round(projected_pct, 2),
        ))

    # Seasonal injection rate for today's DOY (5yr band)
    current_doy = current_date_obj.timetuple().tm_yday
    inj_seas = db.query(
        "SELECT avg_gwh_d, p25_gwh_d, p75_gwh_d FROM storage_injection_seasonal "
        "WHERE country = 'EU' AND doy = ?",
        [current_doy],
    )
    seasonal_inj_avg = _float(inj_seas.iloc[0]["avg_gwh_d"]) if not inj_seas.empty else None
    seasonal_inj_p25 = _float(inj_seas.iloc[0]["p25_gwh_d"]) if not inj_seas.empty else None
    seasonal_inj_p75 = _float(inj_seas.iloc[0]["p75_gwh_d"]) if not inj_seas.empty else None

    stats = GasPaceStats(
        country="EU",
        current_pct=round(current_pct, 2) if current_pct else None,
        current_date=current_date_str,
        target_date=nov1.isoformat(),
        target_pct=_GAS_FILL_TARGET_PCT,
        days_to_target=days_to_target,
        pct_gap=round(pct_gap, 2) if pct_gap is not None else None,
        required_gwh_per_day=round(required_rate, 1) if required_rate is not None else None,
        current_rate_gwh_per_day=round(current_rate, 1),
        days_at_current_rate=round(days_at_current, 0) if days_at_current is not None and not math.isinf(days_at_current) else None,
        on_track=on_track,
        seasonal_inj_avg_gwh_d=round(seasonal_inj_avg, 1) if seasonal_inj_avg is not None else None,
        seasonal_inj_p25_gwh_d=round(seasonal_inj_p25, 1) if seasonal_inj_p25 is not None else None,
        seasonal_inj_p75_gwh_d=round(seasonal_inj_p75, 1) if seasonal_inj_p75 is not None else None,
        history=history,
    )

    return GasPaceResponse(eu=stats)


@app.get("/api/gas/pace/countries", response_model=GasPaceCountriesResponse)
def gas_pace_countries():
    """Injection pace vs required rate for all countries (excluding EU aggregate).

    Uses the latest snapshot + 7-day avg injection rate to compute whether
    each country is on track to reach 90% fill by Nov 1.
    """
    latest_df = db.query(
        """
        SELECT country, full_pct, gas_day::VARCHAR AS gas_day, working_gas_volume
        FROM storage_latest
        WHERE country != 'EU' AND working_gas_volume IS NOT NULL AND working_gas_volume > 0
        ORDER BY full_pct
        """
    )
    if latest_df is None or latest_df.empty:
        raise HTTPException(status_code=503, detail="Gas storage data not available")

    rate_df = db.query(
        """
        SELECT country, AVG(injection - withdrawal) AS rate
        FROM storage_history
        WHERE gas_day >= current_date - INTERVAL '7 days' AND country != 'EU'
        GROUP BY country
        """
    )
    rates = {} if rate_df.empty else dict(zip(rate_df["country"], rate_df["rate"].fillna(0)))

    # Determine target date using the most common gas_day
    sample_date_str = str(latest_df.iloc[0]["gas_day"])
    sample_date_obj = date.fromisoformat(sample_date_str)
    nov1 = date(sample_date_obj.year, 11, 1)
    if sample_date_obj >= nov1:
        nov1 = date(sample_date_obj.year + 1, 11, 1)
    days_to_t = max(1, (nov1 - sample_date_obj).days)

    rows: list[CountryPaceRow] = []
    for r in latest_df.itertuples():
        cc = str(r.country)
        c_pct = _float(r.full_pct)
        wgv_twh = _float(r.working_gas_volume) or 1.0
        c_rate = float(rates.get(cc, 0.0))
        pct_gap = (_GAS_FILL_TARGET_PCT - c_pct) if c_pct is not None else None
        req_rate: float | None = None
        on_track: bool | None = None
        if pct_gap is not None and pct_gap > 0:
            req_total = (pct_gap / 100) * wgv_twh * 1000
            req_rate = req_total / days_to_t
            if c_rate > 0:
                days_at = req_total / c_rate
                on_track = days_at <= days_to_t
        elif pct_gap is not None and pct_gap <= 0:
            on_track = True  # already at or above target
        rows.append(CountryPaceRow(
            country=cc,
            current_pct=round(c_pct, 2) if c_pct is not None else None,
            current_rate_gwh_per_day=round(c_rate, 1),
            required_gwh_per_day=round(req_rate, 1) if req_rate is not None else None,
            pct_gap=round(pct_gap, 2) if pct_gap is not None else None,
            on_track=on_track,
        ))

    return GasPaceCountriesResponse(target_date=nov1.isoformat(), rows=rows)


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


@app.get("/api/power/divergence", response_model=DivergenceResponse)
def power_divergence():
    """Latest DA price spread per border pair + 30-day daily history."""
    latest_df = db.query(
        """
        SELECT from_zone, to_zone, price_date::VARCHAR AS price_date,
               from_price, to_price, diff_eur_mwh
        FROM divergence_latest
        ORDER BY ABS(diff_eur_mwh) DESC NULLS LAST
        """
    )
    hist_df = db.query(
        """
        SELECT from_zone, to_zone, price_date::VARCHAR AS price_date,
               from_price, to_price, diff_eur_mwh
        FROM divergence_30d
        ORDER BY from_zone, to_zone, price_date
        """
    )

    rows = [
        DivergenceLatestRow(
            from_zone=str(r.from_zone),
            to_zone=str(r.to_zone),
            price_date=str(r.price_date),
            from_price=_float(r.from_price),
            to_price=_float(r.to_price),
            diff_eur_mwh=_float(r.diff_eur_mwh),
        )
        for r in latest_df.itertuples()
    ]

    history: list[DivergenceBorderHistory] = []
    if not hist_df.empty:
        for (fz, tz), grp in hist_df.groupby(["from_zone", "to_zone"]):
            pts = [
                DivergenceDailyPoint(
                    price_date=str(r.price_date),
                    from_price=_float(r.from_price),
                    to_price=_float(r.to_price),
                    diff_eur_mwh=_float(r.diff_eur_mwh),
                )
                for r in grp.itertuples()
            ]
            history.append(DivergenceBorderHistory(from_zone=str(fz), to_zone=str(tz), history=pts))

    return DivergenceResponse(
        as_of=_meta_val("refreshed_at_power"),
        rows=rows,
        history=history,
    )


@app.get("/api/power/map", response_model=PowerMapResponse)
def power_map():
    df = db.query(
        "SELECT zone, price_date::VARCHAR AS price_date, base_eur, peak_eur, vs_30d_pct, day_range_eur, neg_hours, pct_rank_2yr FROM power_latest ORDER BY zone",
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
            day_range_eur=_float(r.day_range_eur),
            neg_hours=int(r.neg_hours) if r.neg_hours is not None else None,
            pct_rank_2yr=_float(r.pct_rank_2yr),
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
        "SELECT zone, price_date::VARCHAR AS price_date, base_eur, peak_eur, vs_30d_pct, day_range_eur, neg_hours, pct_rank_2yr FROM power_latest WHERE zone = ?",
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
        day_range_eur=_float(r["day_range_eur"]),
        neg_hours=int(r["neg_hours"]) if r["neg_hours"] is not None else None,
        pct_rank_2yr=_float(r["pct_rank_2yr"]),
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
        SELECT price_date::VARCHAR AS price_date, base_eur, peak_eur, offpeak_eur, day_range_eur, neg_hours, min_eur, max_eur
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
            offpeak_eur=_float(row.offpeak_eur),
            day_range_eur=_float(row.day_range_eur),
            neg_hours=int(row.neg_hours) if row.neg_hours is not None else None,
            min_eur=_float(row.min_eur),
            max_eur=_float(row.max_eur),
        )
        for row in (daily_df.itertuples() if not daily_df.empty else [])
    ]

    gen_df = db.query(
        """
        SELECT zone, gen_date::VARCHAR AS gen_date,
               biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind,
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
            nuclear=_float(gr["nuclear"]),
            oil=_float(gr["oil"]),
            other=_float(gr["other"]),
            solar=_float(gr["solar"]),
            wind=_float(gr["wind"]),
            renewable_pct=_float(gr["renewable_pct"]),
            total_mw=_float(gr["total_mw"]),
        )

    gen_hourly_df = db.query(
        """
        SELECT ts::VARCHAR AS ts,
               biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind
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
            nuclear=_float(r.nuclear),
            oil=_float(r.oil),
            other=_float(r.other),
            solar=_float(r.solar),
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


@app.get("/api/power/zone/{zone_id}/seasonality", response_model=PowerSeasonalityResponse)
def power_zone_seasonality(zone_id: str):
    """Day-of-week and month-of-year avg price for a zone (2-year history)."""
    zone_id = zone_id.upper()
    DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    MONTH_LABELS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    dow_df = db.query(
        """
        SELECT DAYOFWEEK(price_date) AS dow, AVG(base_eur) AS avg_eur
        FROM power_daily WHERE zone = ? AND base_eur IS NOT NULL
        GROUP BY dow ORDER BY dow
        """,
        [zone_id],
    )
    month_df = db.query(
        """
        SELECT MONTH(price_date) AS month, AVG(base_eur) AS avg_eur, AVG(neg_hours) AS avg_neg_hrs
        FROM power_daily WHERE zone = ? AND base_eur IS NOT NULL
        GROUP BY month ORDER BY month
        """,
        [zone_id],
    )

    dow_rows = [
        DowPoint(dow=int(r.dow), label=DOW_LABELS[int(r.dow)], avg_eur=_float(r.avg_eur))
        for r in dow_df.itertuples()
    ]
    month_rows = [
        MonthPoint(
            month=int(r.month),
            label=MONTH_LABELS[int(r.month)],
            avg_eur=_float(r.avg_eur),
            avg_neg_hrs=_float(r.avg_neg_hrs),
        )
        for r in month_df.itertuples()
    ]
    return PowerSeasonalityResponse(zone=zone_id, dow=dow_rows, monthly=month_rows)


@app.get("/api/power/zone/{zone_id}/profile", response_model=PowerZoneProfileResponse)
def power_zone_profile(zone_id: str):
    """24-hour average price profile for a zone (90-day window, CET local time)."""
    zone_id = zone_id.upper()
    df = db.query(
        "SELECT hour, avg_eur, p25_eur, p75_eur, neg_pct FROM power_hourly_profiles WHERE zone = ? ORDER BY hour",
        [zone_id],
    )
    rows = [
        HourlyProfilePoint(
            hour=int(r.hour),
            avg_eur=_float(r.avg_eur),
            p25_eur=_float(r.p25_eur),
            p75_eur=_float(r.p75_eur),
            neg_pct=_float(r.neg_pct),
        )
        for r in df.itertuples()
    ]
    return PowerZoneProfileResponse(zone=zone_id, days=90, rows=rows)


@app.get("/api/power/correlations", response_model=PowerCorrelationResponse)
def power_correlations():
    """30-day pairwise Pearson correlation of daily base prices across all zones."""
    df = db.query(
        "SELECT zone_a, zone_b, correlation FROM power_correlation_30d ORDER BY zone_a, zone_b"
    )
    rows = [
        ZoneCorrelationRow(
            zone_a=str(r.zone_a),
            zone_b=str(r.zone_b),
            correlation=_float(r.correlation),
        )
        for r in df.itertuples()
    ]
    return PowerCorrelationResponse(window_days=30, rows=rows)


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


@app.get("/api/spreads/zones", response_model=MultiZoneSpreadsResponse)
def multi_zone_spreads():
    """CSS/CDS/FSS for multiple EU bidding zones (DE-LU, FR, NL, IT-NORD, BE, AT)."""
    df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date, zone,
               power_eur_mwh, css, cds, fss, regime_threshold
        FROM multi_zone_spreads
        WHERE price_date >= current_date - INTERVAL '2 years'
        ORDER BY zone, price_date
        """
    )
    as_of = _meta_val("refreshed_at_spreads")
    if df.empty:
        return MultiZoneSpreadsResponse(as_of=as_of, zones=[], rows=[])
    zones = sorted(df["zone"].unique().tolist())
    rows = [
        MultiZoneSpreadRow(
            price_date=str(r.price_date),
            zone=str(r.zone),
            power_eur_mwh=_float(r.power_eur_mwh),
            css=_float(r.css),
            cds=_float(r.cds),
            fss=_float(r.fss),
            regime_threshold=str(r.regime_threshold) if r.regime_threshold else None,
        )
        for r in df.itertuples()
    ]
    return MultiZoneSpreadsResponse(as_of=as_of, zones=zones, rows=rows)


@app.get("/api/spreads", response_model=SpreadsResponse)
def spreads():
    df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date,
               power_de, ttf, eua, coal_eur_mwh, css, cds, fss, regime_threshold,
               disruption_bcm
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
            disruption_bcm=_float(getattr(r, "disruption_bcm", None)),
        )
        for r in df.itertuples()
    ]
    return SpreadsResponse(as_of=as_of, rows=rows)


@app.get("/api/prices", response_model=PricesResponse)
def prices():
    df = db.query(
        """
        SELECT price_date::VARCHAR AS price_date,
               ttf_eur_mwh, eua_eur_t, coal_usd_t, hh_usd_mmbtu, nbp_eur_mwh, hh_eur_mwh
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
            nbp_eur_mwh=_float(r.nbp_eur_mwh),
            hh_eur_mwh=_float(getattr(r, "hh_eur_mwh", None)),
        )
        for r in df.itertuples()
    ]
    return PricesResponse(as_of=as_of, rows=rows)


@app.get("/api/prices/curve", response_model=TtfCurveResponse)
def prices_curve():
    """TTF forward curve snapshot: latest available settlement for each listed contract."""
    df = db.query(
        """
        SELECT contract, settlement, tenor_type
        FROM ttf_curve_latest
        WHERE tenor_type IN ('Q1','Q2','Q3','Q4','WIN','SUM','CAL')
        ORDER BY sort_key
        """
    )
    as_of = _meta_val("refreshed_at_spreads")
    if df.empty:
        return TtfCurveResponse(as_of=as_of, rows=[])
    rows = [
        TtfCurvePoint(
            contract=str(r.contract),
            settlement=float(r.settlement),
            tenor_type=str(r.tenor_type),
        )
        for r in df.itertuples()
    ]
    return TtfCurveResponse(as_of=as_of, rows=rows)


@app.get("/api/prices/curve/snapshots", response_model=TtfCurveSnapshotsResponse)
def prices_curve_snapshots():
    """TTF forward curve at 4 historical dates (today, -30d, -180d, -365d) for shift comparison."""
    df = db.query(
        """
        SELECT snapshot_label, contract, settlement, tenor_type, sort_key
        FROM ttf_curve_snapshots
        WHERE tenor_type IN ('Q1','Q2','Q3','Q4','WIN','SUM','CAL')
        ORDER BY snapshot_label, sort_key
        """
    )
    if df.empty:
        return TtfCurveSnapshotsResponse(rows=[])
    rows = [
        TtfCurveSnapshotRow(
            snapshot_label=str(r.snapshot_label),
            contract=str(r.contract),
            settlement=float(r.settlement),
            tenor_type=str(r.tenor_type),
            sort_key=int(r.sort_key),
        )
        for r in df.itertuples()
    ]
    return TtfCurveSnapshotsResponse(rows=rows)


_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@app.get("/api/prices/seasonality", response_model=TtfSeasonalityResponse)
def prices_seasonality():
    """TTF monthly seasonality: historical distribution (min/p25/median/p75/max) per calendar month.

    Excludes years with fewer than 10 trading days in a given month (thin data).
    Current-month value is added from the most recent TTF price.
    """
    df = db.query("""
        WITH latest AS (
            SELECT MONTH(price_date) AS month, ttf_eur_mwh
            FROM prices_daily
            WHERE ttf_eur_mwh IS NOT NULL
            ORDER BY price_date DESC
            LIMIT 1
        )
        SELECT
            MONTH(p.price_date)                                        AS month,
            YEAR(p.price_date)                                         AS year,
            PERCENTILE_CONT(0.0) WITHIN GROUP (ORDER BY p.ttf_eur_mwh)  AS p0,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY p.ttf_eur_mwh) AS p25,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.ttf_eur_mwh)  AS p50,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY p.ttf_eur_mwh) AS p75,
            PERCENTILE_CONT(1.0) WITHIN GROUP (ORDER BY p.ttf_eur_mwh)  AS p100,
            COUNT(*) AS n,
            ANY_VALUE(l.month) AS latest_month,
            ANY_VALUE(l.ttf_eur_mwh) AS latest_price
        FROM prices_daily p
        LEFT JOIN latest l ON TRUE
        WHERE p.ttf_eur_mwh IS NOT NULL
        GROUP BY 1, 2
        HAVING COUNT(*) >= 10
        ORDER BY 1, 2
    """)
    current_month = int(df.iloc[0]["latest_month"]) if not df.empty and df.iloc[0]["latest_month"] is not None else None
    current_price = float(df.iloc[0]["latest_price"]) if not df.empty and df.iloc[0]["latest_price"] is not None else None

    # Aggregate across years: min of p0s, max of p100s, percentile of medians
    agg: dict[int, dict] = {}
    for r in df.itertuples():
        m = int(r.month)
        if m not in agg:
            agg[m] = {"p0_vals": [], "p25_vals": [], "p50_vals": [], "p75_vals": [], "p100_vals": [], "n_years": 0}
        agg[m]["p0_vals"].append(float(r.p0))
        agg[m]["p25_vals"].append(float(r.p25))
        agg[m]["p50_vals"].append(float(r.p50))
        agg[m]["p75_vals"].append(float(r.p75))
        agg[m]["p100_vals"].append(float(r.p100))
        agg[m]["n_years"] += 1

    months: list[TtfSeasonalMonth] = []
    for m in range(1, 13):
        if m not in agg:
            months.append(TtfSeasonalMonth(
                month=m, label=_MONTH_LABELS[m - 1], n_years=0,
                current=current_price if m == current_month else None,
            ))
            continue
        a = agg[m]
        months.append(TtfSeasonalMonth(
            month=m,
            label=_MONTH_LABELS[m - 1],
            min=round(min(a["p0_vals"]), 2),
            p25=round(statistics.median(a["p25_vals"]), 2),
            median=round(statistics.median(a["p50_vals"]), 2),
            p75=round(statistics.median(a["p75_vals"]), 2),
            max=round(max(a["p100_vals"]), 2),
            current=round(current_price, 2) if m == current_month and current_price is not None else None,
            n_years=a["n_years"],
        ))

    return TtfSeasonalityResponse(
        current_month=current_month or 0,
        months=months,
    )


@app.get("/api/prices/regime", response_model=PriceRegimeResponse)
def prices_regime():
    """Rolling 30d TTF/EUA realized volatility and 90d TTF-EUA Pearson correlation.

    Volatility = rolling std of absolute daily price changes * sqrt(252), in native units
    (EUR/MWh for TTF, EUR/tCO2 for EUA). Correlation uses a 90-day rolling window.
    """
    df = db.query("""
        WITH diffs AS (
            SELECT price_date,
                   ttf_eur_mwh,
                   eua_eur_t,
                   ttf_eur_mwh - LAG(ttf_eur_mwh) OVER (ORDER BY price_date) AS dtf,
                   eua_eur_t   - LAG(eua_eur_t)   OVER (ORDER BY price_date) AS deua
            FROM prices_daily
            WHERE ttf_eur_mwh IS NOT NULL
              AND eua_eur_t IS NOT NULL
        )
        SELECT
            price_date::VARCHAR AS price_date,
            STDDEV(dtf)  OVER (ORDER BY price_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)
                * SQRT(252.0)    AS ttf_vol_30d,
            STDDEV(deua) OVER (ORDER BY price_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)
                * SQRT(252.0)    AS eua_vol_30d,
            CORR(ttf_eur_mwh, eua_eur_t) OVER (ORDER BY price_date ROWS BETWEEN 89 PRECEDING AND CURRENT ROW)
                                 AS ttf_eua_corr_90d
        FROM diffs
        WHERE dtf IS NOT NULL
        ORDER BY price_date
    """)
    if df is None or df.empty:
        return PriceRegimeResponse(rows=[])

    rows = [
        PriceRegimePoint(
            price_date=str(r.price_date),
            ttf_vol_30d=_float(r.ttf_vol_30d),
            eua_vol_30d=_float(r.eua_vol_30d),
            ttf_eua_corr_90d=_float(r.ttf_eua_corr_90d),
        )
        for r in df.itertuples()
    ]
    return PriceRegimeResponse(rows=rows)


@app.get("/api/generation/map", response_model=GenMapResponse)
def generation_map(date: str | None = None):
    """Renewable % and fuel summary per bidding zone. ?date=YYYY-MM-DD for historical days."""
    _fuel_select = (
        "solar AS solar_mw, wind AS wind_mw, hydro AS hydro_mw, "
        "gas AS gas_mw, coal AS coal_mw, nuclear AS nuclear_mw, "
        "biomass AS biomass_mw, geothermal AS geothermal_mw, "
        "oil AS oil_mw, other AS other_mw, total_mw"
    )
    if date:
        df = db.query(
            f"""
            SELECT zone, gen_date::VARCHAR AS gen_date, renewable_pct, {_fuel_select}
            FROM generation_daily
            WHERE gen_date = ?
            ORDER BY zone
            """,
            [date],
        )
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No generation data for {date}")
    else:
        df = db.query(f"""
            SELECT zone, gen_date::VARCHAR AS gen_date, renewable_pct, {_fuel_select}
            FROM generation_latest
            ORDER BY zone
        """)
        if df.empty:
            raise HTTPException(status_code=503, detail="generation data not yet available")

    date_range = db.query(
        "SELECT MIN(gen_date)::VARCHAR AS min_date, MAX(gen_date)::VARCHAR AS max_date FROM generation_daily"
    )
    min_date = str(date_range.iloc[0]["min_date"]) if not date_range.empty and date_range.iloc[0]["min_date"] is not None else None
    max_date = str(date_range.iloc[0]["max_date"]) if not date_range.empty and date_range.iloc[0]["max_date"] is not None else None

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
            nuclear_mw=_float(r.nuclear_mw),
            biomass_mw=_float(r.biomass_mw),
            geothermal_mw=_float(r.geothermal_mw),
            oil_mw=_float(r.oil_mw),
            other_mw=_float(r.other_mw),
            total_mw=_float(r.total_mw),
        )
        for r in df.itertuples()
    ]
    return GenMapResponse(as_of=as_of, zones=zones, min_date=min_date, max_date=max_date)


_FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "nuclear", "oil", "other", "solar", "wind")


@app.get("/api/generation/zone/{zone_id}", response_model=GenZoneResponse)
def generation_zone(zone_id: str):
    """Hourly fuel mix (last 10 days) and daily renewable trend (2Y) for a zone."""
    zone_id = zone_id.upper()

    latest_df = db.query(
        """
        SELECT gen_date::VARCHAR AS gen_date, renewable_pct, total_mw,
               biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind
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
        SELECT ts::VARCHAR AS ts, biomass, coal, gas, geothermal, hydro, nuclear, oil, other, solar, wind
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
            nuclear=_float(r.nuclear),
            oil=_float(r.oil),
            other=_float(r.other),
            solar=_float(r.solar),
            wind=_float(r.wind),
        )
        for r in (hourly_df.itertuples() if not hourly_df.empty else [])
    ]

    daily_df = db.query(
        """
        SELECT gen_date::VARCHAR AS gen_date, renewable_pct,
               solar, wind, hydro, gas, coal, nuclear, biomass, geothermal, oil, other, total_mw
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
            nuclear=_float(r.nuclear),
            biomass=_float(r.biomass),
            geothermal=_float(r.geothermal),
            oil=_float(r.oil),
            other=_float(r.other),
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


@app.get("/api/generation/zone/{zone_id}/capacity", response_model=GenCapacityResponse)
def generation_zone_capacity(zone_id: str):
    """Daily wind/solar capacity factors for a zone (2Y, rolling on full history).

    CF = daily_avg_mw / installed_mw (ENTSO-E annual snapshot, forward-filled).
    Returns the most recent installed_mw as top-level context stats.
    """
    zone_id = zone_id.upper()
    df = db.query(
        """
        SELECT gen_date::VARCHAR AS gen_date,
               wind_cf, solar_cf,
               wind_mw, solar_mw,
               wind_installed_mw, solar_installed_mw
        FROM capacity_factors_daily
        WHERE zone = ?
          AND gen_date >= current_date - interval '2 years'
        ORDER BY gen_date
        """,
        [zone_id],
    )
    if df.empty:
        raise HTTPException(status_code=404, detail=f"No capacity factor data for zone {zone_id!r}")

    # Most recent installed MW for header stats
    latest = df.iloc[-1]

    daily = [
        CapacityFactorPoint(
            gen_date=str(r.gen_date),
            wind_cf=_float(r.wind_cf),
            solar_cf=_float(r.solar_cf),
            wind_mw=_float(r.wind_mw),
            solar_mw=_float(r.solar_mw),
            wind_installed_mw=_float(r.wind_installed_mw),
            solar_installed_mw=_float(r.solar_installed_mw),
        )
        for r in df.itertuples()
    ]

    return GenCapacityResponse(
        zone=zone_id,
        wind_installed_mw=_float(latest["wind_installed_mw"]),
        solar_installed_mw=_float(latest["solar_installed_mw"]),
        daily=daily,
    )


@app.get("/api/generation/trends", response_model=GenTrendsResponse)
def generation_trends():
    """Annual average renewable % per zone from 2021 onwards.

    Excludes 2020 (only 1 day per zone) and partial years are included as-is.
    Zones sorted descending by their most recent full-year RE%.
    """
    df = db.query("""
        WITH agg AS (
            SELECT zone,
                   YEAR(gen_date) AS year,
                   AVG(renewable_pct) AS renewable_pct,
                   COUNT(*) AS n
            FROM generation_daily
            WHERE renewable_pct IS NOT NULL
              AND YEAR(gen_date) >= 2021
            GROUP BY zone, YEAR(gen_date)
        )
        SELECT zone, year, renewable_pct
        FROM agg
        WHERE n >= 30
        ORDER BY zone, year
    """)

    if df is None or df.empty:
        return GenTrendsResponse(zones=[], years=[], rows=[])

    years_set = sorted(df["year"].unique().tolist())

    # Sort zones by their latest available year's RE%
    latest_re: dict[str, float] = {}
    for r in df.itertuples():
        latest_re[r.zone] = _float(r.renewable_pct) or 0.0
    zones_sorted = sorted(latest_re.keys(), key=lambda z: latest_re[z], reverse=True)

    rows = [
        GenAnnualRow(zone=r.zone, year=int(r.year), renewable_pct=round(_float(r.renewable_pct) or 0.0, 1))
        for r in df.itertuples()
    ]

    return GenTrendsResponse(zones=zones_sorted, years=years_set, rows=rows)


@app.get("/api/generation/eu/annual", response_model=EuAnnualFuelResponse)
def generation_eu_annual():
    """EU-aggregate annual average generation mix by fuel type (2021-present).

    Uses AVG(daily_mw) per zone per year then sums across all zones, so mixed
    15-min and hourly resolution in the source data does not inflate totals.
    Excludes 2020 (only 1 day of data for most zones).
    """
    df = db.query("""
        WITH zone_year AS (
            SELECT zone,
                   YEAR(gen_date) AS year,
                   AVG(solar)    AS solar_mw,
                   AVG(wind)     AS wind_mw,
                   AVG(nuclear)  AS nuclear_mw,
                   AVG(hydro)    AS hydro_mw,
                   AVG(gas)      AS gas_mw,
                   AVG(coal)     AS coal_mw,
                   AVG(biomass)  AS biomass_mw,
                   AVG(other)    AS other_mw,
                   COUNT(*)      AS n
            FROM generation_daily
            WHERE YEAR(gen_date) >= 2021
            GROUP BY zone, YEAR(gen_date)
            HAVING COUNT(*) >= 30
        )
        SELECT year,
               SUM(solar_mw)    AS solar_mw,
               SUM(wind_mw)     AS wind_mw,
               SUM(nuclear_mw)  AS nuclear_mw,
               SUM(hydro_mw)    AS hydro_mw,
               SUM(gas_mw)      AS gas_mw,
               SUM(coal_mw)     AS coal_mw,
               SUM(biomass_mw)  AS biomass_mw,
               SUM(other_mw)    AS other_mw,
               COUNT(DISTINCT zone) AS zones
        FROM zone_year
        GROUP BY year
        ORDER BY year
    """)

    if df is None or df.empty:
        return EuAnnualFuelResponse(rows=[])

    rows = [
        EuAnnualFuelRow(
            year=int(r.year),
            solar_mw=round(_float(r.solar_mw) or 0.0, 0),
            wind_mw=round(_float(r.wind_mw) or 0.0, 0),
            nuclear_mw=round(_float(r.nuclear_mw) or 0.0, 0),
            hydro_mw=round(_float(r.hydro_mw) or 0.0, 0),
            gas_mw=round(_float(r.gas_mw) or 0.0, 0),
            coal_mw=round(_float(r.coal_mw) or 0.0, 0),
            biomass_mw=round(_float(r.biomass_mw) or 0.0, 0),
            other_mw=round(_float(r.other_mw) or 0.0, 0),
            zones=int(r.zones),
        )
        for r in df.itertuples()
    ]
    return EuAnnualFuelResponse(rows=rows)


@app.get("/api/imbalance", response_model=ImbalanceResponse)
def imbalance():
    """German reBAP imbalance settlement price: latest snapshot, 10-day 15-min series, 2Y daily aggs."""
    as_of = _meta_val("refreshed_at_imbalance")

    latest_df = db.query("SELECT * FROM imbalance_latest LIMIT 1")
    latest = None
    if not latest_df.empty:
        r = latest_df.iloc[0]
        latest = ImbalanceLatest(
            current_ts=str(r["current_ts"]),
            rebap_eur_mwh=_float(r["rebap_eur_mwh"]),
            today_mean=_float(r["today_mean"]),
            today_min=_float(r["today_min"]),
            today_max=_float(r["today_max"]),
        )

    recent_df = db.query("SELECT ts::VARCHAR AS ts, rebap_eur_mwh FROM imbalance_recent ORDER BY ts")
    recent = [
        ImbalanceRecentPoint(ts=str(r.ts), rebap_eur_mwh=_float(r.rebap_eur_mwh))
        for r in recent_df.itertuples()
    ]

    daily_df = db.query(
        "SELECT price_date::VARCHAR AS price_date, mean_eur, min_eur, max_eur FROM imbalance_daily ORDER BY price_date"
    )
    daily = [
        ImbalanceDailyPoint(
            price_date=str(r.price_date),
            mean_eur=_float(r.mean_eur),
            min_eur=_float(r.min_eur),
            max_eur=_float(r.max_eur),
        )
        for r in daily_df.itertuples()
    ]

    return ImbalanceResponse(as_of=as_of, latest=latest, recent=recent, daily=daily)


@app.get("/api/imbalance/profile", response_model=ImbalanceProfileResponse)
def imbalance_profile():
    """90-day average reBAP profile by CET hour (0-23): avg/p25/p75/neg_pct."""
    df = db.query(
        "SELECT hour, avg_eur, p25_eur, p75_eur, neg_pct FROM imbalance_hourly_profile ORDER BY hour"
    )
    if df is None or df.empty:
        return ImbalanceProfileResponse(days=90, rows=[])
    rows = [
        ImbalanceHourlyPoint(
            hour=int(r.hour),
            avg_eur=_float(r.avg_eur),
            p25_eur=_float(r.p25_eur),
            p75_eur=_float(r.p75_eur),
            neg_pct=_float(r.neg_pct),
        )
        for r in df.itertuples()
    ]
    return ImbalanceProfileResponse(days=90, rows=rows)


@app.get("/api/imbalance/dispatch", response_model=BatteryResponse)
def imbalance_dispatch():
    """Oracle battery dispatch for trailing 30 days of reBAP prices (1 MW / 2 MWh)."""
    hourly_df = db.query(
        "SELECT ts::VARCHAR AS ts, rebap_price, charge_mw, discharge_mw, soc_mwh, cumulative_pnl_eur "
        "FROM battery_dispatch_recent ORDER BY ts"
    )
    summary_df = db.query("SELECT key, value FROM battery_summary")

    hourly = [
        BatteryHourlyPoint(
            ts=str(r.ts),
            rebap_price=_float(r.rebap_price),
            charge_mw=_float(r.charge_mw),
            discharge_mw=_float(r.discharge_mw),
            soc_mwh=_float(r.soc_mwh),
            cumulative_pnl_eur=_float(r.cumulative_pnl_eur),
        )
        for r in hourly_df.itertuples()
    ]

    summary = None
    if not summary_df.empty:
        kv = dict(zip(summary_df["key"], summary_df["value"]))
        summary = BatterySummary(
            total_pnl_eur=float(kv["total_pnl_eur"]) if "total_pnl_eur" in kv else None,
            n_charge_hours=int(kv["n_charge_hours"]) if "n_charge_hours" in kv else None,
            n_discharge_hours=int(kv["n_discharge_hours"]) if "n_discharge_hours" in kv else None,
            avg_spread_captured_eur=float(kv["avg_spread_captured_eur"]) if "avg_spread_captured_eur" in kv else None,
            avg_buy_price_eur=float(kv["avg_buy_price_eur"]) if "avg_buy_price_eur" in kv else None,
            avg_sell_price_eur=float(kv["avg_sell_price_eur"]) if "avg_sell_price_eur" in kv else None,
            trailing_days=int(kv["trailing_days"]) if "trailing_days" in kv else None,
        )

    return BatteryResponse(
        as_of=_meta_val("refreshed_at_imbalance"),
        summary=summary,
        hourly=hourly,
    )
