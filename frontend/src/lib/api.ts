const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export interface StorageLatestRow {
  country: string
  gas_day: string
  full_pct: number | null
  d7_pct: number | null
  vs_avg5_pct: number | null
  yoy_pct: number | null
  injection: number | null
  withdrawal: number | null
  working_gas_volume: number | null
}

export interface GasMapResponse {
  as_of: string
  rows: StorageLatestRow[]
  pipeline_offline_bcm: number | null
}

export interface StorageFacilityItem {
  id: string
  name: string
  operator: string | null
  country: string
  lat: number
  lon: number
  capacity_twh: number | null
  fill_pct: number | null
}

export interface StorageFacilitiesResponse {
  facilities: StorageFacilityItem[]
}

export interface GasPacePoint {
  gas_day: string
  full_pct: number | null
  avg5: number | null
  projected: number | null
  net_inj_gwh_d: number | null
  seas_inj_avg: number | null
  seas_inj_p25: number | null
  seas_inj_p75: number | null
}

export interface GasPaceStats {
  country: string
  current_pct: number | null
  current_date: string
  target_date: string
  target_pct: number
  days_to_target: number
  pct_gap: number | null
  required_gwh_per_day: number | null
  current_rate_gwh_per_day: number | null
  days_at_current_rate: number | null
  on_track: boolean | null
  seasonal_inj_avg_gwh_d: number | null
  seasonal_inj_p25_gwh_d: number | null
  seasonal_inj_p75_gwh_d: number | null
  next_interim_date: string | null
  next_interim_pct: number | null
  next_interim_required_gwh_d: number | null
  history: GasPacePoint[]
}

export interface GasPaceResponse {
  eu: GasPaceStats
}

export interface CountryPaceRow {
  country: string
  current_pct: number | null
  current_rate_gwh_per_day: number | null
  required_gwh_per_day: number | null
  pct_gap: number | null
  on_track: boolean | null
}

export interface GasPaceCountriesResponse {
  target_date: string
  rows: CountryPaceRow[]
}

export interface SeasonalPoint {
  gas_day: string
  full_pct: number | null
  injection: number | null
  withdrawal: number | null
}

export interface SeasonalBandPoint {
  doy: number
  avg5: number | null
  min5: number | null
  max5: number | null
}

export interface GasDoyPoint {
  doy: number
  full_pct: number | null
}

export interface GasYearTrack {
  year: number
  data: GasDoyPoint[]
}

export interface GasCountryResponse {
  country: string
  latest: StorageLatestRow | null
  current_year: SeasonalPoint[]
  prior_year: SeasonalPoint[]
  seasonal_band: SeasonalBandPoint[]
  yearly_tracks: GasYearTrack[]
  pace: GasPaceStats | null
}

export interface MetaResponse {
  gas_countries: string[]
  gas_refreshed_at: string | null
  power_zones: string[]
  power_refreshed_at: string | null
  spreads_refreshed_at: string | null
  imbalance_refreshed_at: string | null
}

export interface LngLatestRow {
  country: string
  gas_day: string
  inventory_gwh: number | null
  sendout_gwh: number | null
  dtmi_gwh: number | null
  dtrs_gwh: number | null
  fill_pct: number | null
  sendout_util_pct: number | null
  d7_sendout_gwh: number | null
  vs_avg5_sendout: number | null
  avg5_sendout: number | null
}

export interface LngMapResponse {
  rows: LngLatestRow[]
}

export interface LngTrendPoint {
  gas_day: string
  sendout_gwh: number | null
  fill_pct: number | null
  avg5_sendout: number | null
}

export interface LngSeasonalPoint {
  doy: number
  avg5_sendout: number | null
  min5_sendout: number | null
  max5_sendout: number | null
  avg5_fill: number | null
  min5_fill: number | null
  max5_fill: number | null
}

export interface LngHistoryPoint {
  gas_day: string
  sendout_gwh: number | null
  fill_pct: number | null
  inventory_gwh: number | null
}

export interface LngCountryResponse {
  country: string
  latest: LngLatestRow | null
  history: LngHistoryPoint[]
  seasonal: LngSeasonalPoint[]
  trend: LngTrendPoint[]
}

export interface PowerLatestRow {
  zone: string
  price_date: string
  base_eur: number | null
  peak_eur: number | null
  vs_30d_pct: number | null
  day_range_eur: number | null
  neg_hours: number | null
  pct_rank_2yr: number | null
}

export interface PowerMapResponse {
  as_of: string
  price_date: string
  rows: PowerLatestRow[]
}

export interface PowerHourlyPoint {
  ts: string
  price_eur_mwh: number | null
}

export interface PowerDailyPoint {
  price_date: string
  base_eur: number | null
  peak_eur: number | null
  offpeak_eur: number | null
  day_range_eur: number | null
  neg_hours: number | null
  min_eur: number | null
  max_eur: number | null
}

export interface GenerationMixRow {
  zone: string
  gen_date: string | null
  biomass: number | null
  coal: number | null
  gas: number | null
  geothermal: number | null
  hydro: number | null
  nuclear: number | null
  oil: number | null
  other: number | null
  solar: number | null
  wind: number | null
  renewable_pct: number | null
  total_mw: number | null
}

export interface GenHourlyPoint {
  ts: string
  biomass: number | null
  coal: number | null
  gas: number | null
  geothermal: number | null
  hydro: number | null
  nuclear: number | null
  oil: number | null
  other: number | null
  solar: number | null
  wind: number | null
}

export interface PowerZoneResponse {
  zone: string
  latest: PowerLatestRow | null
  hourly_recent: PowerHourlyPoint[]
  daily_history: PowerDailyPoint[]
  generation_mix: GenerationMixRow | null
  generation_hourly: GenHourlyPoint[]
  net_import_mw: number | null
  net_import_date: string | null
}

export interface GenMapItem {
  zone: string
  gen_date: string | null
  renewable_pct: number | null
  solar_mw: number | null
  wind_mw: number | null
  hydro_mw: number | null
  gas_mw: number | null
  coal_mw: number | null
  nuclear_mw: number | null
  biomass_mw: number | null
  geothermal_mw: number | null
  oil_mw: number | null
  other_mw: number | null
  total_mw: number | null
  // Optional capacity factor fields (from /api/power/cf-map)
  wind_cf?: number | null
  solar_cf?: number | null
  wind_installed_mw?: number | null
  solar_installed_mw?: number | null
}

export interface GenMapResponse {
  as_of: string | null
  zones: GenMapItem[]
  min_date: string | null
  max_date: string | null
}

export interface GenDailyPoint {
  gen_date: string
  renewable_pct: number | null
  solar: number | null
  wind: number | null
  hydro: number | null
  gas: number | null
  coal: number | null
  nuclear: number | null
  biomass: number | null
  geothermal: number | null
  oil: number | null
  other: number | null
  total_mw: number | null
}

export interface GenZoneResponse {
  zone: string
  gen_date: string | null
  renewable_pct: number | null
  total_mw: number | null
  dominant_fuel: string | null
  hourly: GenHourlyPoint[]
  daily: GenDailyPoint[]
}

export interface CapacityFactorPoint {
  gen_date: string
  wind_cf: number | null
  solar_cf: number | null
  wind_mw: number | null
  solar_mw: number | null
  wind_installed_mw: number | null
  solar_installed_mw: number | null
}

export interface GenCapacityResponse {
  zone: string
  wind_installed_mw: number | null
  solar_installed_mw: number | null
  daily: CapacityFactorPoint[]
}

export interface ImbalanceHourlyPoint {
  hour: number
  avg_eur: number | null
  p25_eur: number | null
  p75_eur: number | null
  neg_pct: number | null
}

export interface ImbalanceProfileResponse {
  days: number
  rows: ImbalanceHourlyPoint[]
}

export interface ImbalanceRecentPoint {
  ts: string
  rebap_eur_mwh: number | null
}

export interface ImbalanceDailyPoint {
  price_date: string
  mean_eur: number | null
  min_eur: number | null
  max_eur: number | null
}

export interface ImbalanceLatest {
  current_ts: string
  rebap_eur_mwh: number | null
  today_mean: number | null
  today_min: number | null
  today_max: number | null
}

export interface ImbalanceResponse {
  as_of: string | null
  latest: ImbalanceLatest | null
  recent: ImbalanceRecentPoint[]
  daily: ImbalanceDailyPoint[]
}

export interface SpreadsDailyPoint {
  price_date: string
  power_de: number | null
  ttf: number | null
  eua: number | null
  coal_eur_mwh: number | null
  css: number | null
  cds: number | null
  fss: number | null
  regime_threshold: string | null
  disruption_bcm: number | null
}

export interface SpreadsResponse {
  as_of: string | null
  rows: SpreadsDailyPoint[]
}

export interface PricesDailyPoint {
  price_date: string
  ttf_eur_mwh: number | null
  eua_eur_t: number | null
  coal_usd_t: number | null
  hh_usd_mmbtu: number | null
  nbp_eur_mwh: number | null
  hh_eur_mwh: number | null
}

export interface PricesResponse {
  as_of: string | null
  rows: PricesDailyPoint[]
}

export interface TtfCurvePoint {
  contract: string
  settlement: number
  tenor_type: string
}

export interface TtfCurveResponse {
  as_of: string | null
  rows: TtfCurvePoint[]
}

export interface TtfSeasonalMonth {
  month: number
  label: string
  min: number | null
  p25: number | null
  median: number | null
  p75: number | null
  max: number | null
  current: number | null
  n_years: number
}

export interface TtfSeasonalityResponse {
  current_month: number
  months: TtfSeasonalMonth[]
}

export interface PriceRegimePoint {
  price_date: string
  ttf_vol_30d: number | null
  eua_vol_30d: number | null
  ttf_eua_corr_90d: number | null
}

export interface PriceRegimeResponse {
  rows: PriceRegimePoint[]
}

export interface BorderFlowRow {
  from_zone: string
  to_zone: string
  net_flow_mw: number | null
}

export interface FlowsResponse {
  price_date: string | null
  rows: BorderFlowRow[]
}

export interface CongestionRow {
  from_zone: string
  to_zone: string
  price_date: string
  ntc_mw: number | null
  scheduled_mw: number | null
  utilization_pct: number | null
}

export interface CongestionResponse {
  as_of: string | null
  rows: CongestionRow[]
}

export interface CongestionBorderResponse {
  from_zone: string
  to_zone: string
  rows: CongestionRow[]
}

export interface BorderFlowHistPoint {
  price_date: string
  net_flow_mw: number | null
}

export interface BorderFlowHistResponse {
  from_zone: string
  to_zone: string
  rows: BorderFlowHistPoint[]
}

export interface BatteryHourlyPoint {
  ts: string
  rebap_price: number | null
  charge_mw: number | null
  discharge_mw: number | null
  soc_mwh: number | null
  cumulative_pnl_eur: number | null
}

export interface BatterySummary {
  total_pnl_eur: number | null
  n_charge_hours: number | null
  n_discharge_hours: number | null
  avg_spread_captured_eur: number | null
  avg_buy_price_eur: number | null
  avg_sell_price_eur: number | null
  trailing_days: number | null
}

export interface BatteryResponse {
  as_of: string | null
  summary: BatterySummary | null
  hourly: BatteryHourlyPoint[]
}

export interface GenAnnualRow {
  zone: string
  year: number
  renewable_pct: number | null
}

export interface GenTrendsResponse {
  zones: string[]
  years: number[]
  rows: GenAnnualRow[]
}

export interface EuAnnualFuelRow {
  year: number
  solar_mw: number | null
  wind_mw: number | null
  nuclear_mw: number | null
  hydro_mw: number | null
  gas_mw: number | null
  coal_mw: number | null
  biomass_mw: number | null
  other_mw: number | null
  zones: number
}

export interface EuAnnualFuelResponse {
  rows: EuAnnualFuelRow[]
}

export interface DowPoint {
  dow: number
  label: string
  avg_eur: number | null
}

export interface MonthPoint {
  month: number
  label: string
  avg_eur: number | null
  avg_neg_hrs: number | null
}

export interface PowerSeasonalityResponse {
  zone: string
  dow: DowPoint[]
  monthly: MonthPoint[]
}

export interface HourlyProfilePoint {
  hour: number
  avg_eur: number | null
  p25_eur: number | null
  p75_eur: number | null
  neg_pct: number | null
}

export interface PowerZoneProfileResponse {
  zone: string
  days: number
  rows: HourlyProfilePoint[]
}

export interface DivergenceLatestRow {
  from_zone: string
  to_zone: string
  price_date: string
  from_price: number | null
  to_price: number | null
  diff_eur_mwh: number | null
}

export interface DivergenceDailyPoint {
  price_date: string
  from_price: number | null
  to_price: number | null
  diff_eur_mwh: number | null
}

export interface DivergenceBorderHistory {
  from_zone: string
  to_zone: string
  history: DivergenceDailyPoint[]
}

export interface DivergenceResponse {
  as_of: string | null
  rows: DivergenceLatestRow[]
  history: DivergenceBorderHistory[]
}

export interface MultiZoneSpreadRow {
  price_date: string
  zone: string
  power_eur_mwh: number | null
  css: number | null
  cds: number | null
  fss: number | null
  regime_threshold: string | null
}

export interface MultiZoneSpreadsResponse {
  as_of: string | null
  zones: string[]
  rows: MultiZoneSpreadRow[]
}

export interface GasFlowItem {
  country: string
  period_date: string
  net_gwh_d: number | null
  entry_gwh_d: number | null
  exit_gwh_d: number | null
}

export interface GasFlowResponse {
  as_of: string | null
  rows: GasFlowItem[]
}

export interface GasFlowCountryResponse {
  country: string
  rows: GasFlowItem[]
}

export interface ZoneCorrelationRow {
  zone_a: string
  zone_b: string
  correlation: number | null
}

export interface PowerCorrelationResponse {
  window_days: number
  rows: ZoneCorrelationRow[]
}

export interface TtfCurveSnapshotRow {
  snapshot_label: string
  contract: string
  settlement: number
  tenor_type: string
  sort_key: number
}

export interface TtfCurveSnapshotsResponse {
  rows: TtfCurveSnapshotRow[]
}

export interface GenMonthlyRow {
  year: number
  month: number
  renewable_pct: number | null
  solar_pct: number | null
  wind_pct: number | null
  nuclear_pct: number | null
  gas_pct: number | null
  coal_pct: number | null
  n_zones: number
}

export interface GenMonthlyResponse {
  rows: GenMonthlyRow[]
}

export interface EuCiDailyPoint {
  gen_date: string
  ci_gco2_kwh: number | null
  re_pct: number | null
  fossil_pct: number | null
}

export interface EuCiDailyResponse {
  rows: EuCiDailyPoint[]
}

export interface EuCfLatestResponse {
  gen_date: string | null
  wind_cf: number | null
  solar_cf: number | null
  wind_installed_gw: number | null
  solar_installed_gw: number | null
  wind_cf_month_avg: number | null
  solar_cf_month_avg: number | null
  wind_cf_month_pct_rank: number | null
  solar_cf_month_pct_rank: number | null
}

export interface ZoneCfRow {
  zone: string
  gen_date: string
  wind_cf: number | null
  solar_cf: number | null
  wind_installed_mw: number | null
  solar_installed_mw: number | null
}

export interface ZoneCfResponse {
  gen_date: string | null
  rows: ZoneCfRow[]
}

export interface EuPriceRePoint {
  price_date: string
  eu_avg_eur: number | null
  re_pct: number | null
}

export interface EuPriceReResponse {
  rows: EuPriceRePoint[]
}

export interface StorageCountryRow {
  gas_day: string
  EU: number | null
  EU_avg5: number | null
  DE: number | null
  FR: number | null
  NL: number | null
  AT: number | null
  IT: number | null
  ES: number | null
}

export interface StorageCountryResponse {
  rows: StorageCountryRow[]
}

export interface PowerMonthlyCell {
  zone: string
  yr: number
  mo: number
  avg_eur: number | null
  neg_day_pct: number | null
}

export interface PowerMonthlyResponse {
  zones: string[]
  months: string[]
  cells: PowerMonthlyCell[]
}

export interface EuGenHourlyPoint {
  ts: string
  wind: number | null
  solar: number | null
  hydro: number | null
  nuclear: number | null
  gas: number | null
  coal: number | null
  biomass: number | null
  other_fuel: number | null
  n_zones: number | null
}

export interface EuGenHourlyResponse {
  rows: EuGenHourlyPoint[]
}

export interface EuDuckCurvePoint {
  hour: number
  avg_eur: number | null
  p25_eur: number | null
  p75_eur: number | null
  neg_pct: number | null
  n_zones: number | null
}

export interface EuDuckCurveResponse {
  rows: EuDuckCurvePoint[]
}

export interface CapacityAnnualRow {
  yr: number
  wind_gw: number
  solar_gw: number
  n_zones: number
}

export interface CapacityAnnualResponse {
  rows: CapacityAnnualRow[]
}

export interface NegHoursMonthlyRow {
  month: string
  eu_avg: number | null
  es: number | null
  fr: number | null
  de: number | null
  nl: number | null
}

export interface NegHoursMonthlyResponse {
  rows: NegHoursMonthlyRow[]
}

export interface NegHoursZoneRow {
  zone: string
  neg_pct_30d: number
  n_days: number
}

export interface NegHoursZoneResponse {
  window_days: number
  rows: NegHoursZoneRow[]
}

export interface MonthlyFuelMixRow {
  month: number
  solar_pct: number
  wind_pct: number
  nuclear_pct: number
  hydro_pct: number
  gas_pct: number
  coal_pct: number
  biomass_pct: number
  other_pct: number
}

export interface MonthlyFuelMixResponse {
  rows: MonthlyFuelMixRow[]
}

export interface ZoneCarbonIntensityRow {
  zone: string
  ci_g_kwh: number
  avg_re_pct: number
  n_days: number
}

export interface ZoneCarbonIntensityResponse {
  window_days: number
  rows: ZoneCarbonIntensityRow[]
}

export interface ZoneTtfCorrRow {
  zone: string
  corr: number
  n_days: number
}

export interface ZoneTtfCorrResponse {
  window_days: number
  rows: ZoneTtfCorrRow[]
}

export interface ForecastAccuracyRow {
  zone: string
  wind_mae_mw: number | null
  wind_avg_mw: number | null
  solar_mae_mw: number | null
  solar_avg_mw: number | null
  wind_installed_mw: number | null
  solar_installed_mw: number | null
  wind_mae_pct: number | null
  solar_mae_pct: number | null
  n_hours: number
}

export interface ForecastAccuracyResponse {
  window_days: number
  rows: ForecastAccuracyRow[]
}

export interface CrossZoneSpreadPoint {
  price_date: string
  zone: string
  spread_eur: number
}

export interface CrossZoneSpreadResponse {
  ref_zone: string
  country: string
  window_days: number
  zones: string[]
  rows: CrossZoneSpreadPoint[]
}

export interface ZoneHourlyProfileRow {
  zone: string
  hour: number
  avg_eur: number | null
  neg_pct: number | null
}

export interface ZoneHourlyProfilesResponse {
  rows: ZoneHourlyProfileRow[]
}

export interface ZonePriceReCorrRow {
  zone: string
  corr: number
  avg_price_eur: number
  avg_re_pct: number
  n_days: number
}

export interface ZonePriceReCorrResponse {
  window_days: number
  rows: ZonePriceReCorrRow[]
}

export interface GasPriceScatterRow {
  gas_day: string
  fill_pct: number
  ttf_eur_mwh: number
}

export interface GasPriceScatterResponse {
  rows: GasPriceScatterRow[]
}

export interface ImbalanceMonthlyRow {
  year: number
  month: number
  avg_eur: number | null
  p25_eur: number | null
  p75_eur: number | null
  neg_pct: number | null
  n_days: number
}

export interface ImbalanceMonthlyResponse {
  rows: ImbalanceMonthlyRow[]
}

export interface ZoneNetFlowRow {
  zone: string
  net_import_mw: number | null
}

export interface ZoneNetFlowsResponse {
  price_date: string | null
  rows: ZoneNetFlowRow[]
}

// US natural gas storage (EIA weekly regional)

export interface UsStorageLatestRow {
  region: string
  week_date: string
  value_bcf: number | null
  week_change_bcf: number | null
  yoy_bcf: number | null
  vs_avg5_bcf: number | null
  vs_avg5_pct: number | null
  implied_fill_pct: number | null
  avg5_bcf: number | null
  min5_bcf: number | null
  max5_bcf: number | null
}

export interface UsStorageMapResponse {
  as_of: string
  rows: UsStorageLatestRow[]
}

export interface UsStorageWeekPoint {
  week_date: string
  value_bcf: number | null
}

export interface UsStorageSeasonalPoint {
  week_of_year: number
  avg5: number | null
  min5: number | null
  max5: number | null
}

export interface UsStorageRegionResponse {
  region: string
  latest: UsStorageLatestRow
  history: UsStorageWeekPoint[]
  seasonal: UsStorageSeasonalPoint[]
}

export interface UsPaceWeekPoint {
  week_date: string
  value_bcf: number | null
  avg5: number | null
  min5: number | null
  max5: number | null
  projected: number | null
}

export interface UsPaceStats {
  current_bcf: number | null
  current_date: string
  target_date: string
  target_bcf: number | null
  days_to_target: number
  bcf_gap: number | null
  current_rate_bcf_w: number | null
  seasonal_rate_bcf_w: number | null
  weeks_to_target: number | null
  on_track: boolean | null
  history: UsPaceWeekPoint[]
}

export interface UsPaceResponse {
  us48: UsPaceStats
}

export const api = {
  meta: () => get<MetaResponse>('/meta'),
  health: () => get<{ ok: boolean; refreshed_at_gas: string | null }>('/health'),
  gasMap: () => get<GasMapResponse>('/gas/map'),
  gasLngMap: () => get<LngMapResponse>('/gas/lng/map'),
  gasLngTrend: () => get<LngTrendPoint[]>('/gas/lng/trend'),
  gasLngCountry: (cc: string) => get<LngCountryResponse>(`/gas/lng/country/${cc}`),
  gasCountry: (cc: string) => get<GasCountryResponse>(`/gas/country/${cc}`),
  gasFacilities: () => get<StorageFacilitiesResponse>('/gas/facilities'),
  gasFlows: () => get<GasFlowResponse>('/gas/flows'),
  gasFlowsCountry: (cc: string) => get<GasFlowCountryResponse>(`/gas/flows/${cc}`),
  gasPace: () => get<GasPaceResponse>('/gas/pace'),
  gasPaceCountries: () => get<GasPaceCountriesResponse>('/gas/pace/countries'),
  powerCongestion: () => get<CongestionResponse>('/power/congestion'),
  powerCongestionBorder: (fz: string, tz: string) => get<CongestionBorderResponse>(`/power/congestion/border/${fz}/${tz}`),
  powerBorderFlows: (fz: string, tz: string) => get<BorderFlowHistResponse>(`/power/border-flows/${fz}/${tz}`),
  powerZoneNetFlows: () => get<ZoneNetFlowsResponse>('/power/zone-net-flows'),
  powerDivergence: () => get<DivergenceResponse>('/power/divergence'),
  powerMap: () => get<PowerMapResponse>('/power/map'),
  powerCfMap: () => get<CfMapResponse>('/power/cf-map'),
  spreadsWindPriceAnalysis: (zone?: string) => get<WindPriceAnalysisResponse>(`/spreads/wind-price-analysis${zone ? `?zone=${zone}` : ''}`),
  spreadsFundamentalBacktest: (zone?: string) => get<FundamentalBacktestResponse>(`/spreads/fundamental-backtest${zone ? `?zone=${zone}` : ''}`),
  powerZone: (zone: string) => get<PowerZoneResponse>(`/power/zone/${zone}`),
  powerZoneProfile: (zone: string) => get<PowerZoneProfileResponse>(`/power/zone/${zone}/profile`),
  powerZoneSeasonality: (zone: string) => get<PowerSeasonalityResponse>(`/power/zone/${zone}/seasonality`),
  spreads: () => get<SpreadsResponse>('/spreads'),
  spreadsZones: () => get<MultiZoneSpreadsResponse>('/spreads/zones'),
  prices: () => get<PricesResponse>('/prices'),
  pricesCurve: () => get<TtfCurveResponse>('/prices/curve'),
  pricesSeasonality: () => get<TtfSeasonalityResponse>('/prices/seasonality'),
  pricesRegime: () => get<PriceRegimeResponse>('/prices/regime'),
  flows: () => get<FlowsResponse>('/flows'),
  genMap: (date?: string) => get<GenMapResponse>(date ? `/generation/map?date=${date}` : '/generation/map'),
  genTrends: () => get<GenTrendsResponse>('/generation/trends'),
  genEuAnnual: () => get<EuAnnualFuelResponse>('/generation/eu/annual'),
  genEuMonthly: () => get<GenMonthlyResponse>('/generation/eu/monthly'),
  genEuCfLatest: () => get<EuCfLatestResponse>('/generation/eu/cf-latest'),
  genEuCarbonIntensity: () => get<EuCiDailyResponse>('/generation/eu/carbon-intensity'),
  genZonesCf: () => get<ZoneCfResponse>('/generation/zones/cf'),
  genEuPriceRe: () => get<EuPriceReResponse>('/generation/eu/price-re'),
  gasCountryCompare: () => get<StorageCountryResponse>('/gas/country-compare'),
  powerMonthly: () => get<PowerMonthlyResponse>('/power/monthly'),
  genEuHourly: () => get<EuGenHourlyResponse>('/generation/eu/hourly'),
  powerHourlyProfileEu: () => get<EuDuckCurveResponse>('/power/hourly-profile-eu'),
  genZone: (zone: string) => get<GenZoneResponse>(`/generation/zone/${zone}`),
  genCapacity: (zone: string) => get<GenCapacityResponse>(`/generation/zone/${zone}/capacity`),
  imbalance: () => get<ImbalanceResponse>('/imbalance'),
  imbalanceProfile: () => get<ImbalanceProfileResponse>('/imbalance/profile'),
  imbalanceDispatch: () => get<BatteryResponse>('/imbalance/dispatch'),
  powerCorrelations: () => get<PowerCorrelationResponse>('/power/correlations'),
  pricesCurveSnapshots: () => get<TtfCurveSnapshotsResponse>('/prices/curve/snapshots'),
  imbalanceMonthly: () => get<ImbalanceMonthlyResponse>('/imbalance/monthly'),
  genCapacityAnnual: () => get<CapacityAnnualResponse>('/generation/capacity-annual'),
  powerNegHoursMonthly: () => get<NegHoursMonthlyResponse>('/power/neg-hours-monthly'),
  powerNegHoursZones: () => get<NegHoursZoneResponse>('/power/neg-hours-zones'),
  genZonePriceReCorr: () => get<ZonePriceReCorrResponse>('/generation/zone-price-re-corr'),
  genEuMonthlyFuelMix: () => get<MonthlyFuelMixResponse>('/generation/eu/monthly-fuel-mix'),
  gasPriceScatter: () => get<GasPriceScatterResponse>('/gas/price-scatter'),
  powerHourlyProfilesAll: () => get<ZoneHourlyProfilesResponse>('/power/hourly-profiles-all'),
  genZoneTtfCorr: () => get<ZoneTtfCorrResponse>('/generation/zone-ttf-corr'),
  genZoneCarbonIntensity: () => get<ZoneCarbonIntensityResponse>('/generation/zone-carbon-intensity'),
  genForecastAccuracy: () => get<ForecastAccuracyResponse>('/generation/forecast-accuracy'),
  powerCrossZoneSpreads: (country: string, windowDays?: number) => get<CrossZoneSpreadResponse>(`/power/cross-zone-spreads?country=${country}${windowDays ? `&window_days=${windowDays}` : ''}`),
  usGasMap: () => get<UsStorageMapResponse>('/us-gas/map'),
  usGasRegion: (region: string) => get<UsStorageRegionResponse>(`/us-gas/region/${encodeURIComponent(region)}`),
  usGasPace: () => get<UsPaceResponse>('/us-gas/pace'),
  usPowerMix: () => get<UsPowerMixResponse>('/us-power/mix'),
  usPowerHistory: (region: string) => get<UsPowerHistoryResponse>(`/us-power/history/${encodeURIComponent(region)}`),
  usNgPlants: () => get<UsNgPlantsResponse>('/us-power/plants'),
  spreadsFundamentalModel: (zone?: string) => get<FundamentalModelResponse>(`/spreads/fundamental-model${zone ? `?zone=${zone}` : ''}`),
  spreadsSignalSnapshot: () => get<SignalSnapshotResponse>('/spreads/signal-snapshot'),
}

// US power generation

export interface UsPowerFuelPoint {
  fueltype: string
  fuel_name: string
  value_mwh: number
}

export interface UsPowerRegionLatest {
  region: string
  region_name: string
  period: string
  fuels: UsPowerFuelPoint[]
  ng_mwh: number
  ng_pct: number
  total_mwh: number
}

export interface UsPowerMixResponse {
  as_of: string
  regions: UsPowerRegionLatest[]
}

export interface UsPowerHourlyPoint {
  period: string
  ng_mwh: number
  total_mwh: number
  ng_pct: number
}

export interface UsPowerHistoryResponse {
  region: string
  region_name: string
  hourly: UsPowerHourlyPoint[]
}

// US NG power plants (cleanview + EIA-860)

export interface UsNgPlant {
  plant_id: number
  name: string
  state: string
  county: string
  lat: number
  lon: number
  nameplate_mw: number | null
  entity_name: string
  ba_code: string
  op_year: number | null
  gen_gwh: number | null
  category: string
  cleanview_url: string
}

export interface UsNgPlantsResponse {
  count: number
  plants: UsNgPlant[]
}

// Fundamental value model

export interface FundamentalCoefficients {
  intercept: number
  ttf_eur_mwh: number
  eua_eur_t: number
  wind_pct: number
  solar_pct: number
  r2: number
  n: number
}

export interface FundamentalPoint {
  price_date: string
  actual: number
  fitted: number
  residual: number
  zscore: number
}

export interface FundamentalCurrent {
  actual: number
  fitted: number
  residual: number
  zscore: number
  pct_rank_1yr: number
  half_life_days: number | null
}

export interface RollingCoefPoint {
  date: string
  ttf_eur_mwh: number
  eua_eur_t: number
  wind_pct: number
  solar_pct: number
  r2: number
}

export interface FundamentalModelResponse {
  zone: string
  coefficients: FundamentalCoefficients
  series: FundamentalPoint[]
  current: FundamentalCurrent
  rolling_coefs: RollingCoefPoint[]
}

export interface SignalSnapshotRow {
  zone: string
  actual: number
  fitted: number
  residual: number
  zscore: number
  pct_rank_1yr: number
  r2: number
}

export interface SignalSnapshotResponse {
  as_of: string | null
  rows: SignalSnapshotRow[]
}

export interface CfMapRow {
  zone: string
  gen_date: string
  wind_cf: number | null
  solar_cf: number | null
  wind_mw: number | null
  solar_mw: number | null
  wind_installed_mw: number | null
  solar_installed_mw: number | null
}

export interface CfMapResponse {
  gen_date: string | null
  rows: CfMapRow[]
}

export interface WindPriceBin {
  wind_bin: string
  bin_order: number
  wind_lo: number
  wind_hi: number
  n: number
  median_price: number
  mean_price: number
  std_price: number
  mean_residual: number
  median_residual: number
}

export interface WindPriceInterpretation {
  nonlinear_premium_eur: number | null
  cv_low_wind_pct: number | null
  cv_high_wind_pct: number | null
}

export interface WindPriceAnalysisResponse {
  zone: string
  as_of: string | null
  bins: WindPriceBin[]
  interpretation: WindPriceInterpretation
}

export interface BacktestEquityPoint {
  date: string
  daily_pnl: number
  cum_pnl: number
  zscore: number
  position: number
  in_sample: boolean
}

export interface BacktestStats {
  sharpe_oos: number | null
  sharpe_is: number | null
  sharpe_all: number | null
  hit_rate_pct: number
  hit_rate_oos_pct: number
  max_dd_eur: number
  n_oos: number
  n_is: number
  avg_daily_pnl: number
  pnl_std: number
}

export interface FundamentalBacktestResponse {
  zone: string
  equity: BacktestEquityPoint[]
  stats: BacktestStats
}
