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
    pipeline_offline_bcm: float | None = None


# Gas pace-to-target

class GasPacePoint(BaseModel):
    gas_day: str
    full_pct: float | None = None
    avg5: float | None = None
    projected: float | None = None


class GasPaceStats(BaseModel):
    country: str
    current_pct: float | None
    current_date: str
    target_date: str
    target_pct: float
    days_to_target: int
    pct_gap: float | None
    required_gwh_per_day: float | None
    current_rate_gwh_per_day: float | None
    days_at_current_rate: float | None
    on_track: bool | None
    seasonal_inj_avg_gwh_d: float | None = None
    seasonal_inj_p25_gwh_d: float | None = None
    seasonal_inj_p75_gwh_d: float | None = None
    history: list[GasPacePoint]


class GasPaceResponse(BaseModel):
    eu: GasPaceStats


class CountryPaceRow(BaseModel):
    country: str
    current_pct: float | None
    current_rate_gwh_per_day: float | None
    required_gwh_per_day: float | None
    pct_gap: float | None
    on_track: bool | None


class GasPaceCountriesResponse(BaseModel):
    target_date: str
    rows: list[CountryPaceRow]


class ImbalanceHourlyPoint(BaseModel):
    hour: int
    avg_eur: float | None
    p25_eur: float | None
    p75_eur: float | None
    neg_pct: float | None


class ImbalanceProfileResponse(BaseModel):
    days: int
    rows: list[ImbalanceHourlyPoint]


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


class GasDoyPoint(BaseModel):
    doy: int
    full_pct: float | None


class GasYearTrack(BaseModel):
    year: int
    data: list[GasDoyPoint]


class GasCountryResponse(BaseModel):
    country: str
    latest: StorageLatestRow | None
    current_year: list[SeasonalPoint]
    prior_year: list[SeasonalPoint]
    seasonal_band: list[SeasonalBandPoint]
    yearly_tracks: list[GasYearTrack] = []
    pace: "GasPaceStats | None" = None


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
    offpeak_eur: float | None = None
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
    net_import_mw: float | None = None
    net_import_date: str | None = None


class HourlyProfilePoint(BaseModel):
    hour: int
    avg_eur: float | None
    p25_eur: float | None
    p75_eur: float | None
    neg_pct: float | None


class PowerZoneProfileResponse(BaseModel):
    zone: str
    days: int
    rows: list[HourlyProfilePoint]


class DowPoint(BaseModel):
    dow: int
    label: str
    avg_eur: float | None


class MonthPoint(BaseModel):
    month: int
    label: str
    avg_eur: float | None
    avg_neg_hrs: float | None


class PowerSeasonalityResponse(BaseModel):
    zone: str
    dow: list[DowPoint]
    monthly: list[MonthPoint]


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
    disruption_bcm: float | None = None


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
    nbp_eur_mwh: float | None
    hh_eur_mwh: float | None = None


class PricesResponse(BaseModel):
    as_of: str | None
    rows: list[PricesDailyPoint]


class TtfCurvePoint(BaseModel):
    contract: str
    settlement: float
    tenor_type: str


class TtfCurveResponse(BaseModel):
    as_of: str | None
    rows: list[TtfCurvePoint]


class PriceRegimePoint(BaseModel):
    price_date: str
    ttf_vol_30d: float | None
    eua_vol_30d: float | None
    ttf_eua_corr_90d: float | None


class PriceRegimeResponse(BaseModel):
    rows: list[PriceRegimePoint]


class TtfSeasonalMonth(BaseModel):
    month: int
    label: str
    min: float | None = None
    p25: float | None = None
    median: float | None = None
    p75: float | None = None
    max: float | None = None
    current: float | None = None
    n_years: int


class TtfSeasonalityResponse(BaseModel):
    current_month: int
    months: list[TtfSeasonalMonth]


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
    nuclear: float | None = None
    oil: float | None = None
    other: float | None = None
    solar: float | None = None
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
    nuclear_mw: float | None = None
    biomass_mw: float | None = None
    geothermal_mw: float | None = None
    oil_mw: float | None = None
    other_mw: float | None = None
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
    nuclear: float | None = None
    oil: float | None = None
    other: float | None = None
    solar: float | None = None
    wind: float | None = None


class GenDailyPoint(BaseModel):
    gen_date: str
    renewable_pct: float | None
    solar: float | None = None
    wind: float | None = None
    hydro: float | None = None
    gas: float | None = None
    coal: float | None = None
    nuclear: float | None = None
    biomass: float | None = None
    geothermal: float | None = None
    oil: float | None = None
    other: float | None = None
    total_mw: float | None = None


class GenZoneResponse(BaseModel):
    zone: str
    gen_date: str | None
    renewable_pct: float | None = None
    total_mw: float | None = None
    dominant_fuel: str | None = None
    hourly: list[GenHourlyPoint]
    daily: list[GenDailyPoint]


class GenAnnualRow(BaseModel):
    zone: str
    year: int
    renewable_pct: float | None


class GenTrendsResponse(BaseModel):
    zones: list[str]
    years: list[int]
    rows: list[GenAnnualRow]


class CapacityFactorPoint(BaseModel):
    gen_date: str
    wind_cf: float | None = None
    solar_cf: float | None = None
    wind_mw: float | None = None
    solar_mw: float | None = None
    wind_installed_mw: float | None = None
    solar_installed_mw: float | None = None


class GenCapacityResponse(BaseModel):
    zone: str
    wind_installed_mw: float | None = None
    solar_installed_mw: float | None = None
    daily: list[CapacityFactorPoint]


class BatteryHourlyPoint(BaseModel):
    ts: str
    rebap_price: float | None
    charge_mw: float | None
    discharge_mw: float | None
    soc_mwh: float | None
    cumulative_pnl_eur: float | None


class BatterySummary(BaseModel):
    total_pnl_eur: float | None
    n_charge_hours: int | None
    n_discharge_hours: int | None
    avg_spread_captured_eur: float | None
    avg_buy_price_eur: float | None
    avg_sell_price_eur: float | None
    trailing_days: int | None


class BatteryResponse(BaseModel):
    as_of: str | None
    summary: BatterySummary | None
    hourly: list[BatteryHourlyPoint]


class DivergenceLatestRow(BaseModel):
    from_zone: str
    to_zone: str
    price_date: str
    from_price: float | None
    to_price: float | None
    diff_eur_mwh: float | None


class DivergenceDailyPoint(BaseModel):
    price_date: str
    from_price: float | None
    to_price: float | None
    diff_eur_mwh: float | None


class DivergenceBorderHistory(BaseModel):
    from_zone: str
    to_zone: str
    history: list[DivergenceDailyPoint]


class DivergenceResponse(BaseModel):
    as_of: str | None
    rows: list[DivergenceLatestRow]
    history: list[DivergenceBorderHistory]


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


class EuAnnualFuelRow(BaseModel):
    year: int
    solar_mw: float | None
    wind_mw: float | None
    nuclear_mw: float | None
    hydro_mw: float | None
    gas_mw: float | None
    coal_mw: float | None
    biomass_mw: float | None
    other_mw: float | None
    zones: int


class EuAnnualFuelResponse(BaseModel):
    rows: list[EuAnnualFuelRow]


class MultiZoneSpreadRow(BaseModel):
    price_date: str
    zone: str
    power_eur_mwh: float | None
    css: float | None
    cds: float | None
    fss: float | None
    regime_threshold: str | None


class MultiZoneSpreadsResponse(BaseModel):
    as_of: str | None
    zones: list[str]
    rows: list[MultiZoneSpreadRow]


class ZoneCorrelationRow(BaseModel):
    zone_a: str
    zone_b: str
    correlation: float | None


class PowerCorrelationResponse(BaseModel):
    window_days: int
    rows: list[ZoneCorrelationRow]


class TtfCurveSnapshotRow(BaseModel):
    snapshot_label: str
    contract: str
    settlement: float
    tenor_type: str
    sort_key: int


class TtfCurveSnapshotsResponse(BaseModel):
    rows: list[TtfCurveSnapshotRow]
