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

export const api = {
  meta: () => get<MetaResponse>('/meta'),
  health: () => get<{ ok: boolean; refreshed_at_gas: string | null }>('/health'),
  gasMap: () => get<GasMapResponse>('/gas/map'),
  gasCountry: (cc: string) => get<GasCountryResponse>(`/gas/country/${cc}`),
  powerMap: () => get<PowerMapResponse>('/power/map'),
  powerZone: (zone: string) => get<PowerZoneResponse>(`/power/zone/${zone}`),
}
