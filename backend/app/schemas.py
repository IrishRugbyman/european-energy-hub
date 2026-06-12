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


class PowerZoneResponse(BaseModel):
    zone: str
    latest: PowerLatestRow | None
    hourly_recent: list[PowerHourlyPoint]
    daily_history: list[PowerDailyPoint]


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
