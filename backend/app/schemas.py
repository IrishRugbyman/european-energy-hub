from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    ok: bool
    refreshed_at_gas: str | None = None
    refreshed_at_power: str | None = None


class MetaResponse(BaseModel):
    gas_countries: list[str]
    gas_refreshed_at: str | None = None
    power_zones: list[str] = []
    power_refreshed_at: str | None = None
    spreads_refreshed_at: str | None = None
    imbalance_refreshed_at: str | None = None


# Gas map

class StorageLatestRow(BaseModel):
    country: str
    gas_day: str
    full_pct: float | None
    d7_pct: float | None = None
    vs_avg5_pct: float | None = None
    yoy_pct: float | None = None
    injection: float | None = None
    withdrawal: float | None = None
    working_gas_volume: float | None = None


class GasMapResponse(BaseModel):
    as_of: str
    rows: list[StorageLatestRow]


# Gas physical flows (ENTSOG)

class GasFlowItem(BaseModel):
    country: str
    period_date: str
    net_gwh_d: float | None
    entry_gwh_d: float | None = None
    exit_gwh_d: float | None = None


class GasFlowResponse(BaseModel):
    as_of: str | None
    rows: list[GasFlowItem]


class GasFlowCountryResponse(BaseModel):
    country: str
    rows: list[GasFlowItem]


# Gas country detail

class SeasonalPoint(BaseModel):
    gas_day: str
    full_pct: float | None
    injection: float | None = None
    withdrawal: float | None = None


class SeasonalBandPoint(BaseModel):
    doy: int
    avg5: float | None
    min5: float | None
    max5: float | None


class GasCountryResponse(BaseModel):
    country: str
    latest: StorageLatestRow | None
    current_year: list[SeasonalPoint]
    prior_year: list[SeasonalPoint]
    seasonal_band: list[SeasonalBandPoint]


# Power map

class PowerLatestRow(BaseModel):
    zone: str
    price_date: str
    base_eur: float | None
    peak_eur: float | None = None
    vs_30d_pct: float | None = None
    day_range_eur: float | None = None
    neg_hours: int | None = None
    pct_rank_2yr: float | None = None


class PowerMapResponse(BaseModel):
    as_of: str
    price_date: str
    rows: list[PowerLatestRow]


# Power zone detail

class PowerHourlyPoint(BaseModel):
    ts: str
    price_eur_mwh: float | None


class PowerDailyPoint(BaseModel):
    price_date: str
    base_eur: float | None
    peak_eur: float | None = None
    day_range_eur: float | None = None
    neg_hours: int | None = None
    min_eur: float | None = None
    max_eur: float | None = None


class PowerZoneResponse(BaseModel):
    zone: str
    latest: PowerLatestRow | None
    hourly_recent: list[PowerHourlyPoint]
    daily_history: list[PowerDailyPoint]
    generation_mix: GenerationMixRow | None = None
    generation_hourly: list["GenHourlyPoint"] = []


# Spreads

class SpreadsDailyPoint(BaseModel):
    price_date: str
    power_de: float | None
    ttf: float | None
    eua: float | None
    coal_eur_mwh: float | None
    css: float | None
    cds: float | None
    fss: float | None
    regime_threshold: str | None = None


class SpreadsResponse(BaseModel):
    as_of: str | None
    rows: list[SpreadsDailyPoint]


# Prices

class PricesDailyPoint(BaseModel):
    price_date: str
    ttf_eur_mwh: float | None
    eua_eur_t: float | None
    coal_usd_t: float | None
    hh_usd_mmbtu: float | None


class PricesResponse(BaseModel):
    as_of: str | None
    rows: list[PricesDailyPoint]


# Flows

class BorderFlowRow(BaseModel):
    from_zone: str
    to_zone: str
    net_flow_mw: float | None


class FlowsResponse(BaseModel):
    price_date: str | None
    rows: list[BorderFlowRow]


# Power congestion (NTC vs scheduled)

class CongestionRow(BaseModel):
    from_zone: str
    to_zone: str
    price_date: str
    ntc_mw: float | None
    scheduled_mw: float | None
    utilization_pct: float | None


class CongestionResponse(BaseModel):
    as_of: str | None
    rows: list[CongestionRow]


class CongestionBorderResponse(BaseModel):
    from_zone: str
    to_zone: str
    rows: list[CongestionRow]


# Generation mix (used in PowerZoneResponse)

class GenerationMixRow(BaseModel):
    zone: str
    gen_date: str | None
    biomass: float | None = None
    coal: float | None = None
    gas: float | None = None
    geothermal: float | None = None
    hydro: float | None = None
    oil: float | None = None
    solar: float | None = None
    unknown: float | None = None
    wind: float | None = None
    renewable_pct: float | None = None
    total_mw: float | None = None


# Generation map + zone endpoints

class GenMapItem(BaseModel):
    zone: str
    gen_date: str | None
    renewable_pct: float | None
    solar_mw: float | None = None
    wind_mw: float | None = None
    hydro_mw: float | None = None
    gas_mw: float | None = None
    coal_mw: float | None = None
    total_mw: float | None = None


class GenMapResponse(BaseModel):
    as_of: str | None
    zones: list[GenMapItem]
    min_date: str | None = None
    max_date: str | None = None


class GenHourlyPoint(BaseModel):
    ts: str
    biomass: float | None = None
    coal: float | None = None
    gas: float | None = None
    geothermal: float | None = None
    hydro: float | None = None
    oil: float | None = None
    solar: float | None = None
    unknown: float | None = None
    wind: float | None = None


class GenDailyPoint(BaseModel):
    gen_date: str
    renewable_pct: float | None
    solar: float | None = None
    wind: float | None = None
    hydro: float | None = None
    gas: float | None = None
    coal: float | None = None
    total_mw: float | None = None


class GenZoneResponse(BaseModel):
    zone: str
    gen_date: str | None
    renewable_pct: float | None = None
    total_mw: float | None = None
    dominant_fuel: str | None = None
    hourly: list[GenHourlyPoint]
    daily: list[GenDailyPoint]


class ImbalanceRecentPoint(BaseModel):
    ts: str
    rebap_eur_mwh: float | None


class ImbalanceDailyPoint(BaseModel):
    price_date: str
    mean_eur: float | None
    min_eur: float | None
    max_eur: float | None


class ImbalanceLatest(BaseModel):
    current_ts: str
    rebap_eur_mwh: float | None
    today_mean: float | None
    today_min: float | None
    today_max: float | None


class ImbalanceResponse(BaseModel):
    as_of: str | None
    latest: ImbalanceLatest | None
    recent: list[ImbalanceRecentPoint]
    daily: list[ImbalanceDailyPoint]
