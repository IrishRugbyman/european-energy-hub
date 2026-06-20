/**
 * Color scales for choropleth maps.
 *
 * Gas storage fill %: red (low) -> amber -> green (full).
 * Colorblind-safe: uses luminance differences, not red/green alone.
 */

// Gas fill % -> hex color. Null/undefined returns grey.
export function gasFillColor(fullPct: number | null | undefined): string {
  if (fullPct == null) return '#374151' // grey-700

  const pct = Math.max(0, Math.min(100, fullPct))

  if (pct < 20) return '#7f1d1d'   // red-900
  if (pct < 35) return '#b91c1c'   // red-700
  if (pct < 50) return '#d97706'   // amber-600
  if (pct < 65) return '#ca8a04'   // yellow-600
  if (pct < 75) return '#65a30d'   // lime-600
  if (pct < 85) return '#16a34a'   // green-600
  return '#15803d'                   // green-700
}

// Fill is fully opaque - labels tile layer sits on top, no need for transparency.
// Stroke is a thin dark line; sole source of borders (no tile outlines underneath).
export const CHOROPLETH_FILL_OPACITY = 0.85
export const CHOROPLETH_STROKE = '#0f172a'
export const CHOROPLETH_STROKE_WIDTH = 0.5

// Country display names for known codes
const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  CZ: 'Czech Republic',
  DE: 'Germany',
  ES: 'Spain',
  EU: 'European Union',
  FR: 'France',
  HR: 'Croatia',
  HU: 'Hungary',
  IT: 'Italy',
  LV: 'Latvia',
  NL: 'Netherlands',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  UA: 'Ukraine',
}

export function countryName(cc: string): string {
  return COUNTRY_NAMES[cc] ?? cc
}

// Gas storage vs-5yr-avg (deficit/surplus pp) -> hex color. Diverging scale:
// deep red (large deficit) -> grey (normal) -> deep green (large surplus).
export function gasDeficitColor(vsAvg5pct: number | null | undefined): string {
  if (vsAvg5pct == null) return '#374151'  // grey - no data
  if (vsAvg5pct <= -15) return '#7f1d1d'  // red-900 - severe deficit
  if (vsAvg5pct <= -10) return '#b91c1c'  // red-700
  if (vsAvg5pct <= -5)  return '#d97706'  // amber-600
  if (vsAvg5pct <= -2)  return '#ca8a04'  // yellow-600 - mild deficit
  if (vsAvg5pct <   2)  return '#4b5563'  // grey-600   - normal range
  if (vsAvg5pct <   5)  return '#4d7c0f'  // lime-700   - mild surplus
  if (vsAvg5pct <  10)  return '#16a34a'  // green-600
  return '#15803d'                         // green-700  - large surplus
}

// Power price -> color. Sequential warm scale; null/undefined = grey.
// Domain: 0-300 EUR/MWh (covers typical European range including spike scenarios)
export function powerPriceColor(eur: number | null | undefined): string {
  if (eur == null) return '#374151' // grey-700

  const p = Math.max(0, Math.min(350, eur))

  if (p < 0)   return '#1e3a5f'    // very negative (rare, dark blue)
  if (p < 20)  return '#1d4ed8'    // blue-700  (very cheap)
  if (p < 50)  return '#0369a1'    // sky-700
  if (p < 80)  return '#0e7490'    // cyan-700
  if (p < 120) return '#15803d'    // green-700  (moderate)
  if (p < 160) return '#65a30d'    // lime-600
  if (p < 200) return '#ca8a04'    // yellow-600
  if (p < 250) return '#d97706'    // amber-600
  if (p < 300) return '#b91c1c'    // red-700
  return '#7f1d1d'                  // red-900   (extreme)
}

const ZONE_NAMES: Record<string, string> = {
  'AT':     'Austria',
  'BE':     'Belgium',
  'BG':     'Bulgaria',
  'CH':     'Switzerland',
  'CZ':     'Czech Republic',
  'DE-LU':  'Germany / Luxembourg',
  'DK-1':   'Denmark West',
  'DK-2':   'Denmark East',
  'EE':     'Estonia',
  'ES':     'Spain',
  'FI':     'Finland',
  'FR':     'France',
  'FR-COR': 'Corsica (France)',
  'GR':     'Greece',
  'HR':     'Croatia',
  'HU':     'Hungary',
  'IE-SEM': 'Ireland (SEM)',
  'IT-NORD': 'Italy North',
  'IT-CNOR': 'Italy Central North',
  'IT-CSUD': 'Italy Central South',
  'IT-SUD':  'Italy South',
  'IT-SICI': 'Italy Sicily',
  'IT-SARD': 'Italy Sardinia',
  'IT-CALA': 'Italy Calabria',
  'LT':     'Lithuania',
  'LV':     'Latvia',
  'NL':     'Netherlands',
  'NO-1':   'Norway NO1 (Oslo)',
  'NO-2':   'Norway NO2 (Kristiansand)',
  'NO-3':   'Norway NO3 (Midt-Norge)',
  'NO-4':   'Norway NO4 (Nord-Norge)',
  'NO-5':   'Norway NO5 (Bergen)',
  'PL':     'Poland',
  'PT':     'Portugal',
  'RO':     'Romania',
  'SE-1':   'Sweden SE1 (Luleå)',
  'SE-2':   'Sweden SE2 (Sundsvall)',
  'SE-3':   'Sweden SE3 (Stockholm)',
  'SE-4':   'Sweden SE4 (Malmö)',
  'SI':     'Slovenia',
  'SK':     'Slovakia',
  'AL':     'Albania',
  'ME':     'Montenegro',
  'MK':     'North Macedonia',
  'RS':     'Serbia',
  'XK':     'Kosovo',
}

export function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? zone
}

// Zones that share a country and whose prices should be compared side-by-side.
// Only groups with >= 2 zones where congestion creates meaningful divergence.
export const ZONE_SIBLINGS: Record<string, string[]> = {
  'IT-NORD': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-CNOR': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-CSUD': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-SUD':  ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-SICI': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-SARD': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'IT-CALA': ['IT-NORD', 'IT-CNOR', 'IT-CSUD', 'IT-SUD', 'IT-SICI', 'IT-SARD'],
  'NO-1': ['NO-1', 'NO-2', 'NO-3', 'NO-4', 'NO-5'],
  'NO-2': ['NO-1', 'NO-2', 'NO-3', 'NO-4', 'NO-5'],
  'NO-3': ['NO-1', 'NO-2', 'NO-3', 'NO-4', 'NO-5'],
  'NO-4': ['NO-1', 'NO-2', 'NO-3', 'NO-4', 'NO-5'],
  'NO-5': ['NO-1', 'NO-2', 'NO-3', 'NO-4', 'NO-5'],
  'SE-1': ['SE-1', 'SE-2', 'SE-3', 'SE-4'],
  'SE-2': ['SE-1', 'SE-2', 'SE-3', 'SE-4'],
  'SE-3': ['SE-1', 'SE-2', 'SE-3', 'SE-4'],
  'SE-4': ['SE-1', 'SE-2', 'SE-3', 'SE-4'],
  'DK-1': ['DK-1', 'DK-2'],
  'DK-2': ['DK-1', 'DK-2'],
}

// NTC utilization pct -> color. Sequential scale: green (free) -> yellow -> red (saturated).
// Clipped at 150% (meshed flow models can exceed 100%). Null = grey.
export function utilizationColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'  // grey - no data
  if (pct > 100) return '#7f1d1d'   // red-900  - flow exceeds NTC (meshed)
  if (pct > 90)  return '#b91c1c'   // red-700  - very congested
  if (pct > 80)  return '#d97706'   // amber-600
  if (pct > 60)  return '#ca8a04'   // yellow-600
  if (pct > 40)  return '#65a30d'   // lime-600
  if (pct > 20)  return '#16a34a'   // green-600
  return '#15803d'                   // green-700 - free flowing
}

// Physical gas net flow GWh/d -> color. Diverging scale:
// large import (blue) -> balanced (grey) -> large export (amber/red).
// Positive = net importer, negative = net exporter.
// Thresholds based on ENTSOG data range: AT/BE see ~100+ GWh/d in winter.
export function gasFlowColor(net: number | null | undefined): string {
  if (net == null) return '#374151'   // grey-700 - no data
  if (net > 80)   return '#1d4ed8'   // blue-700  - large importer
  if (net > 30)   return '#3b82f6'   // blue-500
  if (net > 5)    return '#7dd3fc'   // sky-300   - modest importer
  if (net > -5)   return '#4b5563'   // grey-600  - roughly balanced
  if (net > -30)  return '#f59e0b'   // amber-500 - modest exporter
  if (net > -80)  return '#d97706'   // amber-600
  return '#b45309'                    // amber-700 - large exporter
}

// Cross-zone DA price divergence EUR/MWh -> color. Absolute spread:
// grey (converged) -> yellow -> amber -> red (extreme arbitrage).
export function priceDivergenceColor(diffEur: number | null | undefined): string {
  if (diffEur == null) return '#374151'
  const abs = Math.abs(diffEur)
  if (abs >= 40) return '#7f1d1d'   // red-900  - extreme divergence
  if (abs >= 20) return '#b91c1c'   // red-700
  if (abs >= 10) return '#d97706'   // amber-600
  if (abs >= 5)  return '#ca8a04'   // yellow-600
  return '#374151'                   // grey - effectively converged
}

// Intraday price range EUR/MWh -> color. Higher range = more battery opportunity.
// Null = grey. Sequential purple scale: light (low range) to deep purple (high range).
export function dayRangeColor(range: number | null | undefined): string {
  if (range == null) return '#374151'
  if (range < 20)  return '#1e293b'   // slate-900 (tiny spread)
  if (range < 40)  return '#4c1d95'   // violet-900
  if (range < 60)  return '#6d28d9'   // violet-700
  if (range < 80)  return '#7c3aed'   // violet-600
  if (range < 100) return '#8b5cf6'   // violet-500
  if (range < 150) return '#a78bfa'   // violet-400
  return '#c4b5fd'                    // violet-300 (very wide spread)
}

// Negative price hours count -> color. 0 = neutral grey, 1-3 = yellow caution,
// 4-8 = amber warning, 9+ = red (severe oversupply event).
export function negHoursColor(hours: number | null | undefined): string {
  if (hours == null || hours === 0) return '#374151'  // grey - no negative hours
  if (hours < 2)  return '#ca8a04'   // yellow-600 - occasional
  if (hours < 4)  return '#d97706'   // amber-600
  if (hours < 8)  return '#ea580c'   // orange-600
  if (hours < 12) return '#b91c1c'   // red-700
  return '#7f1d1d'                   // red-900 - extreme oversupply
}

// Percentile rank -> color. Shows where today sits in 2yr history.
// Low pct (cheap) = blue, median = green, high pct (expensive) = red.
export function pctRankColor(rank: number | null | undefined): string {
  if (rank == null) return '#374151'
  if (rank < 10) return '#1d4ed8'    // blue-700 - historically cheap
  if (rank < 25) return '#0369a1'    // sky-700
  if (rank < 40) return '#0e7490'    // cyan-700
  if (rank < 60) return '#15803d'    // green-700 - around median
  if (rank < 75) return '#65a30d'    // lime-600
  if (rank < 90) return '#d97706'    // amber-600
  return '#b91c1c'                   // red-700 - historically expensive
}

// Renewable % -> color. Fixed thresholds: 0-20 brown, 20-40 amber, 40-60 olive,
// 60-80 mid-green, 80-100 deep green. Null = grey (no data).
export function renewablePctColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'  // grey-700

  const p = Math.max(0, Math.min(100, pct))
  if (p < 20) return '#78350f'   // amber-900
  if (p < 40) return '#92400e'   // amber-800 (warm brown-amber)
  if (p < 60) return '#4d7c0f'   // lime-700
  if (p < 80) return '#15803d'   // green-600
  return '#166534'               // green-800
}

// Dominant fuel -> choropleth color. Matches FUEL_COLORS palette in ZoneGenPanel.
export const FUEL_PALETTE: Record<string, string> = {
  wind:       '#60a5fa',  // blue-400
  solar:      '#fbbf24',  // amber-400
  hydro:      '#34d399',  // emerald-400
  nuclear:    '#a3e635',  // lime-400
  biomass:    '#86efac',  // green-300
  gas:        '#f97316',  // orange-500
  oil:        '#ef4444',  // red-500
  coal:       '#78716c',  // stone-500
  geothermal: '#a78bfa',  // violet-400
  other:      '#4b5563',  // grey-600
}

export function dominantFuelColor(fuel: string | null | undefined): string {
  if (!fuel) return '#374151'
  return FUEL_PALETTE[fuel] ?? '#374151'
}

// IPCC AR6 lifecycle median emission factors, gCO2eq/kWh
export const EMISSION_FACTORS: Record<string, number> = {
  coal:        820,
  oil:         650,
  gas:         490,
  biomass:     230,
  other:       400,
  geothermal:   38,
  hydro:        24,
  nuclear:      12,
  solar:        45,
  wind:         11,
}

type FuelMix = {
  solar_mw?: number | null
  wind_mw?: number | null
  hydro_mw?: number | null
  nuclear_mw?: number | null
  gas_mw?: number | null
  coal_mw?: number | null
  biomass_mw?: number | null
  geothermal_mw?: number | null
  oil_mw?: number | null
  other_mw?: number | null
}

// Weighted-average lifecycle carbon intensity in gCO2eq/kWh from a fuel mix.
export function computeCarbonIntensity(item: FuelMix | null | undefined): number | null {
  if (!item) return null
  const fuels: [string, number | null | undefined][] = [
    ['solar', item.solar_mw], ['wind', item.wind_mw], ['hydro', item.hydro_mw],
    ['nuclear', item.nuclear_mw], ['gas', item.gas_mw], ['coal', item.coal_mw],
    ['biomass', item.biomass_mw], ['geothermal', item.geothermal_mw],
    ['oil', item.oil_mw], ['other', item.other_mw],
  ]
  let weighted = 0
  let totalMW = 0
  for (const [fuel, mw] of fuels) {
    if (mw != null && mw > 0) {
      weighted += mw * (EMISSION_FACTORS[fuel] ?? 400)
      totalMW += mw
    }
  }
  return totalMW > 0 ? Math.round(weighted / totalMW) : null
}

// Carbon intensity gCO2eq/kWh -> color. Low = clean green, high = red.
export function carbonIntensityColor(gco2: number | null | undefined): string {
  if (gco2 == null) return '#374151'
  if (gco2 < 50)  return '#166534'   // green-800 (nuclear/hydro/wind dominated)
  if (gco2 < 100) return '#15803d'   // green-700
  if (gco2 < 150) return '#4d7c0f'   // lime-700
  if (gco2 < 200) return '#65a30d'   // lime-600
  if (gco2 < 300) return '#ca8a04'   // yellow-600
  if (gco2 < 400) return '#d97706'   // amber-600
  if (gco2 < 500) return '#ea580c'   // orange-600
  return '#b91c1c'                    // red-700 (coal-heavy)
}
