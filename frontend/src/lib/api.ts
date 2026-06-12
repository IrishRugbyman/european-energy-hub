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

export interface PowerZoneResponse {
  zone: string
  latest: PowerLatestRow | null
  hourly_recent: PowerHourlyPoint[]
  daily_history: PowerDailyPoint[]
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

export const api = {
  meta: () => get<MetaResponse>('/meta'),
  health: () => get<{ ok: boolean; refreshed_at_gas: string | null }>('/health'),
  gasMap: () => get<GasMapResponse>('/gas/map'),
  gasCountry: (cc: string) => get<GasCountryResponse>(`/gas/country/${cc}`),
  powerMap: () => get<PowerMapResponse>('/power/map'),
  powerZone: (zone: string) => get<PowerZoneResponse>(`/power/zone/${zone}`),
  spreads: () => get<SpreadsResponse>('/spreads'),
  prices: () => get<PricesResponse>('/prices'),
  flows: () => get<FlowsResponse>('/flows'),
}
