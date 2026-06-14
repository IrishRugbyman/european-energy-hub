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
  'GR':     'Greece',
  'HR':     'Croatia',
  'HU':     'Hungary',
  'IE-SEM': 'Ireland (SEM)',
  'IT-NORD':'Italy North',
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
}

export function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? zone
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
