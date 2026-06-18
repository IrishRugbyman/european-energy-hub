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
}

export interface GasPacePoint {
  gas_day: string
  full_pct: number | null
  avg5: number | null
  projected: number | null
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
  history: GasPacePoint[]
}

export interface GasPaceResponse {
  eu: GasPaceStats
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
}

export interface MetaResponse {
  gas_countries: string[]
  gas_refreshed_at: string | null
  power_zones: string[]
  power_refreshed_at: string | null
  spreads_refreshed_at: string | null
  imbalance_refreshed_at: string | null
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

export const api = {
  meta: () => get<MetaResponse>('/meta'),
  health: () => get<{ ok: boolean; refreshed_at_gas: string | null }>('/health'),
  gasMap: () => get<GasMapResponse>('/gas/map'),
  gasCountry: (cc: string) => get<GasCountryResponse>(`/gas/country/${cc}`),
  gasFlows: () => get<GasFlowResponse>('/gas/flows'),
  gasFlowsCountry: (cc: string) => get<GasFlowCountryResponse>(`/gas/flows/${cc}`),
  gasPace: () => get<GasPaceResponse>('/gas/pace'),
  powerCongestion: () => get<CongestionResponse>('/power/congestion'),
  powerCongestionBorder: (fz: string, tz: string) => get<CongestionBorderResponse>(`/power/congestion/border/${fz}/${tz}`),
  powerDivergence: () => get<DivergenceResponse>('/power/divergence'),
  powerMap: () => get<PowerMapResponse>('/power/map'),
  powerZone: (zone: string) => get<PowerZoneResponse>(`/power/zone/${zone}`),
  spreads: () => get<SpreadsResponse>('/spreads'),
  spreadsZones: () => get<MultiZoneSpreadsResponse>('/spreads/zones'),
  prices: () => get<PricesResponse>('/prices'),
  pricesCurve: () => get<TtfCurveResponse>('/prices/curve'),
  pricesSeasonality: () => get<TtfSeasonalityResponse>('/prices/seasonality'),
  pricesRegime: () => get<PriceRegimeResponse>('/prices/regime'),
  flows: () => get<FlowsResponse>('/flows'),
  genMap: (date?: string) => get<GenMapResponse>(date ? `/generation/map?date=${date}` : '/generation/map'),
  genTrends: () => get<GenTrendsResponse>('/generation/trends'),
  genZone: (zone: string) => get<GenZoneResponse>(`/generation/zone/${zone}`),
  genCapacity: (zone: string) => get<GenCapacityResponse>(`/generation/zone/${zone}/capacity`),
  imbalance: () => get<ImbalanceResponse>('/imbalance'),
  imbalanceDispatch: () => get<BatteryResponse>('/imbalance/dispatch'),
}
