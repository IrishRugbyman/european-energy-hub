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

export interface GasCountryResponse {
  country: string
  latest: StorageLatestRow | null
  current_year: SeasonalPoint[]
  prior_year: SeasonalPoint[]
  seasonal_band: SeasonalBandPoint[]
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
}

export interface GenerationMixRow {
  zone: string
  gen_date: string | null
  biomass: number | null
  coal: number | null
  gas: number | null
  geothermal: number | null
  hydro: number | null
  oil: number | null
  solar: number | null
  unknown: number | null
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
  oil: number | null
  solar: number | null
  unknown: number | null
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
}

export interface PricesResponse {
  as_of: string | null
  rows: PricesDailyPoint[]
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
  powerCongestion: () => get<CongestionResponse>('/power/congestion'),
  powerCongestionBorder: (fz: string, tz: string) => get<CongestionBorderResponse>(`/power/congestion/border/${fz}/${tz}`),
  powerMap: () => get<PowerMapResponse>('/power/map'),
  powerZone: (zone: string) => get<PowerZoneResponse>(`/power/zone/${zone}`),
  spreads: () => get<SpreadsResponse>('/spreads'),
  prices: () => get<PricesResponse>('/prices'),
  flows: () => get<FlowsResponse>('/flows'),
  genMap: (date?: string) => get<GenMapResponse>(date ? `/generation/map?date=${date}` : '/generation/map'),
  genZone: (zone: string) => get<GenZoneResponse>(`/generation/zone/${zone}`),
  imbalance: () => get<ImbalanceResponse>('/imbalance'),
}
