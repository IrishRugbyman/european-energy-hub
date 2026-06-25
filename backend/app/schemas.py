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


class StorageFacilityItem(BaseModel):
    id: str
    name: str
    operator: str | None = None
    country: str
    lat: float
    lon: float
    capacity_twh: float | None = None
    fill_pct: float | None = None


class StorageFacilitiesResponse(BaseModel):
    facilities: list[StorageFacilityItem]


# Gas pace-to-target

class GasPacePoint(BaseModel):
    gas_day: str
    full_pct: float | None = None
    avg5: float | None = None
    projected: float | None = None
    net_inj_gwh_d: float | None = None
    seas_inj_avg: float | None = None
    seas_inj_p25: float | None = None
    seas_inj_p75: float | None = None


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
    next_interim_date: str | None = None
    next_interim_pct: float | None = None
    next_interim_required_gwh_d: float | None = None
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


class BorderFlowHistPoint(BaseModel):
    price_date: str
    net_flow_mw: float | None


class BorderFlowHistResponse(BaseModel):
    from_zone: str
    to_zone: str
    rows: list[BorderFlowHistPoint]


class ZoneNetFlowRow(BaseModel):
    zone: str
    net_import_mw: float | None


class ZoneNetFlowsResponse(BaseModel):
    price_date: str | None
    rows: list[ZoneNetFlowRow]


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


class ImbalanceMonthlyRow(BaseModel):
    year: int
    month: int
    avg_eur: float | None
    p25_eur: float | None
    p75_eur: float | None
    neg_pct: float | None
    n_days: int


class ImbalanceMonthlyResponse(BaseModel):
    rows: list[ImbalanceMonthlyRow]


class GenMonthlyRow(BaseModel):
    year: int
    month: int
    renewable_pct: float | None
    solar_pct: float | None
    wind_pct: float | None
    nuclear_pct: float | None
    gas_pct: float | None
    coal_pct: float | None
    n_zones: int


class GenMonthlyResponse(BaseModel):
    rows: list[GenMonthlyRow]


class EuCiDailyPoint(BaseModel):
    gen_date: str
    ci_gco2_kwh: float | None
    re_pct: float | None
    fossil_pct: float | None


class EuCiDailyResponse(BaseModel):
    rows: list[EuCiDailyPoint]


class EuCfLatestResponse(BaseModel):
    gen_date: str | None
    wind_cf: float | None
    solar_cf: float | None
    wind_installed_gw: float | None
    solar_installed_gw: float | None
    wind_cf_month_avg: float | None
    solar_cf_month_avg: float | None
    wind_cf_month_pct_rank: float | None
    solar_cf_month_pct_rank: float | None


class ZoneCfRow(BaseModel):
    zone: str
    gen_date: str
    wind_cf: float | None
    solar_cf: float | None
    wind_installed_mw: float | None
    solar_installed_mw: float | None


class ZoneCfResponse(BaseModel):
    gen_date: str | None
    rows: list[ZoneCfRow]


class EuPriceRePoint(BaseModel):
    price_date: str
    eu_avg_eur: float | None
    re_pct: float | None


class EuPriceReResponse(BaseModel):
    rows: list[EuPriceRePoint]


class StorageCountryRow(BaseModel):
    gas_day: str
    EU: float | None = None
    EU_avg5: float | None = None
    DE: float | None = None
    FR: float | None = None
    NL: float | None = None
    AT: float | None = None
    IT: float | None = None
    ES: float | None = None


class StorageCountryResponse(BaseModel):
    rows: list[StorageCountryRow]


class PowerMonthlyCell(BaseModel):
    zone: str
    yr: int
    mo: int
    avg_eur: float | None = None
    neg_day_pct: float | None = None


class PowerMonthlyResponse(BaseModel):
    zones: list[str]
    months: list[str]
    cells: list[PowerMonthlyCell]


class EuGenHourlyPoint(BaseModel):
    ts: str
    wind: float | None = None
    solar: float | None = None
    hydro: float | None = None
    nuclear: float | None = None
    gas: float | None = None
    coal: float | None = None
    biomass: float | None = None
    other_fuel: float | None = None
    n_zones: int | None = None


class EuGenHourlyResponse(BaseModel):
    rows: list[EuGenHourlyPoint]




class EuDuckCurvePoint(BaseModel):
    hour: int
    avg_eur: float | None = None
    p25_eur: float | None = None
    p75_eur: float | None = None
    neg_pct: float | None = None
    n_zones: int | None = None


class EuDuckCurveResponse(BaseModel):
    rows: list[EuDuckCurvePoint]


class CapacityAnnualRow(BaseModel):
    yr: int
    wind_gw: float
    solar_gw: float
    n_zones: int


class CapacityAnnualResponse(BaseModel):
    rows: list[CapacityAnnualRow]


class NegHoursMonthlyRow(BaseModel):
    month: str
    eu_avg: float | None = None
    es: float | None = None
    fr: float | None = None
    de: float | None = None
    nl: float | None = None


class NegHoursMonthlyResponse(BaseModel):
    rows: list[NegHoursMonthlyRow]


class GasPriceScatterRow(BaseModel):
    gas_day: str
    fill_pct: float
    ttf_eur_mwh: float


class GasPriceScatterResponse(BaseModel):
    rows: list[GasPriceScatterRow]


class NegHoursZoneRow(BaseModel):
    zone: str
    neg_pct_30d: float
    n_days: int


class NegHoursZoneResponse(BaseModel):
    window_days: int
    rows: list[NegHoursZoneRow]


class ZonePriceReCorrRow(BaseModel):
    zone: str
    corr: float
    avg_price_eur: float
    avg_re_pct: float
    n_days: int


class ZonePriceReCorrResponse(BaseModel):
    window_days: int
    rows: list[ZonePriceReCorrRow]


class MonthlyFuelMixRow(BaseModel):
    month: int
    solar_pct: float
    wind_pct: float
    nuclear_pct: float
    hydro_pct: float
    gas_pct: float
    coal_pct: float
    biomass_pct: float
    other_pct: float


class MonthlyFuelMixResponse(BaseModel):
    rows: list[MonthlyFuelMixRow]


class ZoneHourlyProfileRow(BaseModel):
    zone: str
    hour: int
    avg_eur: float | None
    neg_pct: float | None


class ZoneHourlyProfilesResponse(BaseModel):
    rows: list[ZoneHourlyProfileRow]


class ZoneTtfCorrRow(BaseModel):
    zone: str
    corr: float
    n_days: int


class ZoneTtfCorrResponse(BaseModel):
    window_days: int
    rows: list[ZoneTtfCorrRow]


class ZoneCarbonIntensityRow(BaseModel):
    zone: str
    ci_g_kwh: float
    avg_re_pct: float
    n_days: int


class ZoneCarbonIntensityResponse(BaseModel):
    window_days: int
    rows: list[ZoneCarbonIntensityRow]


class ForecastAccuracyRow(BaseModel):
    zone: str
    wind_mae_mw: float | None
    wind_avg_mw: float | None
    solar_mae_mw: float | None
    solar_avg_mw: float | None
    wind_installed_mw: float | None
    solar_installed_mw: float | None
    wind_mae_pct: float | None
    solar_mae_pct: float | None
    n_hours: int


class ForecastAccuracyResponse(BaseModel):
    window_days: int
    rows: list[ForecastAccuracyRow]


class CrossZoneSpreadPoint(BaseModel):
    price_date: str
    zone: str
    spread_eur: float


class CrossZoneSpreadResponse(BaseModel):
    ref_zone: str
    country: str
    window_days: int
    zones: list[str]
    rows: list[CrossZoneSpreadPoint]


# US natural gas storage (EIA weekly regional)

class UsStorageLatestRow(BaseModel):
    region: str
    week_date: str
    value_bcf: float | None
    week_change_bcf: float | None = None
    yoy_bcf: float | None = None
    vs_avg5_bcf: float | None = None
    vs_avg5_pct: float | None = None
    implied_fill_pct: float | None = None
    avg5_bcf: float | None = None
    min5_bcf: float | None = None
    max5_bcf: float | None = None


class UsStorageMapResponse(BaseModel):
    as_of: str
    rows: list[UsStorageLatestRow]


class UsStorageWeekPoint(BaseModel):
    week_date: str
    value_bcf: float | None


class UsStorageSeasonalPoint(BaseModel):
    week_of_year: int
    avg5: float | None
    min5: float | None
    max5: float | None


class UsStorageRegionResponse(BaseModel):
    region: str
    latest: UsStorageLatestRow
    history: list[UsStorageWeekPoint]
    seasonal: list[UsStorageSeasonalPoint]


class UsPaceWeekPoint(BaseModel):
    week_date: str
    value_bcf: float | None
    avg5: float | None = None
    min5: float | None = None
    max5: float | None = None
    projected: float | None = None


class UsPaceStats(BaseModel):
    current_bcf: float | None
    current_date: str
    target_date: str          # Nov 1
    target_bcf: float | None  # 5yr avg end-of-season Bcf (week 43)
    days_to_target: int
    bcf_gap: float | None     # target_bcf - current_bcf
    current_rate_bcf_w: float | None   # current weekly injection rate
    seasonal_rate_bcf_w: float | None  # 5yr avg weekly injection rate at same woy
    weeks_to_target: float | None      # bcf_gap / current_rate
    on_track: bool | None
    history: list[UsPaceWeekPoint]


class UsPaceResponse(BaseModel):
    us48: UsPaceStats


# US power generation

class UsPowerFuelPoint(BaseModel):
    fueltype: str
    fuel_name: str
    value_mwh: float


class UsPowerRegionLatest(BaseModel):
    region: str
    region_name: str
    period: str
    fuels: list[UsPowerFuelPoint]
    ng_mwh: float
    ng_pct: float
    total_mwh: float


class UsPowerMixResponse(BaseModel):
    as_of: str
    regions: list[UsPowerRegionLatest]


class UsPowerHourlyPoint(BaseModel):
    period: str
    ng_mwh: float
    total_mwh: float
    ng_pct: float


class UsPowerHistoryResponse(BaseModel):
    region: str
    region_name: str
    hourly: list[UsPowerHourlyPoint]


# US NG power plants (cleanview + EIA-860)

class UsNgPlant(BaseModel):
    plant_id: int
    name: str
    state: str
    county: str
    lat: float
    lon: float
    nameplate_mw: float | None
    entity_name: str
    ba_code: str
    op_year: int | None
    gen_gwh: float | None
    category: str
    cleanview_url: str


class UsNgPlantsResponse(BaseModel):
    count: int
    plants: list[UsNgPlant]


# Fundamental value model

class FundamentalCoefficients(BaseModel):
    intercept: float
    ttf_eur_mwh: float
    eua_eur_t: float
    wind_pct: float
    solar_pct: float
    r2: float
    n: int


class FundamentalPoint(BaseModel):
    price_date: str
    actual: float
    fitted: float
    residual: float
    zscore: float


class FundamentalCurrent(BaseModel):
    actual: float
    fitted: float
    residual: float
    zscore: float
    pct_rank_1yr: int
    half_life_days: float | None = None


class RollingCoefPoint(BaseModel):
    date: str
    ttf_eur_mwh: float
    eua_eur_t: float
    wind_pct: float
    solar_pct: float
    r2: float


class FundamentalModelResponse(BaseModel):
    zone: str
    coefficients: FundamentalCoefficients
    series: list[FundamentalPoint]
    current: FundamentalCurrent
    rolling_coefs: list[RollingCoefPoint] = []


class SignalSnapshotRow(BaseModel):
    zone: str
    actual: float
    fitted: float
    residual: float
    zscore: float
    pct_rank_1yr: int
    r2: float


class SignalSnapshotResponse(BaseModel):
    as_of: str | None
    rows: list[SignalSnapshotRow]


class CfMapRow(BaseModel):
    zone: str
    gen_date: str
    wind_cf: float | None
    solar_cf: float | None
    wind_mw: float | None
    solar_mw: float | None
    wind_installed_mw: float | None
    solar_installed_mw: float | None


class CfMapResponse(BaseModel):
    gen_date: str | None
    rows: list[CfMapRow]


class WindPriceBin(BaseModel):
    wind_bin: str
    bin_order: int
    wind_lo: int
    wind_hi: int
    n: int
    median_price: float
    mean_price: float
    std_price: float
    mean_residual: float
    median_residual: float


class WindPriceInterpretation(BaseModel):
    nonlinear_premium_eur: float | None
    cv_low_wind_pct: float | None
    cv_high_wind_pct: float | None


class WindPriceAnalysisResponse(BaseModel):
    zone: str
    as_of: str | None
    bins: list[WindPriceBin]
    interpretation: WindPriceInterpretation


class BacktestEquityPoint(BaseModel):
    date: str
    daily_pnl: float
    cum_pnl: float
    zscore: float
    position: float
    in_sample: bool


class BacktestStats(BaseModel):
    sharpe_oos: float | None
    sharpe_is: float | None
    sharpe_all: float | None
    hit_rate_pct: float
    hit_rate_oos_pct: float
    max_dd_eur: float
    n_oos: int
    n_is: int
    avg_daily_pnl: float
    pnl_std: float


class FundamentalBacktestResponse(BaseModel):
    zone: str
    equity: list[BacktestEquityPoint]
    stats: BacktestStats


class LngLatestRow(BaseModel):
    country: str
    gas_day: str
    inventory_gwh: float | None
    sendout_gwh: float | None
    dtmi_gwh: float | None
    dtrs_gwh: float | None
    fill_pct: float | None
    sendout_util_pct: float | None
    d7_sendout_gwh: float | None
    vs_avg5_sendout: float | None
    avg5_sendout: float | None


class LngMapResponse(BaseModel):
    rows: list[LngLatestRow]


class LngTrendPoint(BaseModel):
    gas_day: str
    sendout_gwh: float | None
    fill_pct: float | None
    avg5_sendout: float | None


class LngSeasonalPoint(BaseModel):
    doy: int
    avg5_sendout: float | None
    min5_sendout: float | None
    max5_sendout: float | None
    avg5_fill: float | None
    min5_fill: float | None
    max5_fill: float | None


class LngHistoryPoint(BaseModel):
    gas_day: str
    sendout_gwh: float | None
    fill_pct: float | None
    inventory_gwh: float | None


class LngCountryResponse(BaseModel):
    country: str
    latest: LngLatestRow | None
    history: list[LngHistoryPoint]
    seasonal: list[LngSeasonalPoint]
    trend: list[LngTrendPoint]
