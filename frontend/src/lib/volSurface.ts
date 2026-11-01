// Pure helpers behind /vol-surface: grid lookups, smile and term-structure series, the
// 1Y risk-reversal and butterfly, and the cell colour ramp.

export interface VolNode {
  k_rel: number
  t: number
  vol: number
}

export const TENORS = [0.25, 0.5, 1.0, 1.5, 2.0]
export const TENOR_LABELS: Record<number, string> = {
  0.25: '3M',
  0.5: '6M',
  1: '1Y',
  1.5: '18M',
  2: '2Y',
}
export const MONEYNESS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2]
export const MONEYNESS_LINES = [
  { k: 0.9, label: '90%' },
  { k: 1.0, label: 'ATM' },
  { k: 1.1, label: '110%' },
]

export function getByKey(grid: VolNode[], k: number, t: number): number {
  return grid.find((p) => Math.abs(p.k_rel - k) < 0.001 && Math.abs(p.t - t) < 0.001)?.vol ?? 0
}

// One row per moneyness, one column per tenor label, in vol percent.
export function buildSmileData(grid: VolNode[]) {
  return MONEYNESS.map((k) => {
    const row: Record<string, number | string> = { k_rel: k, label: `${(k * 100).toFixed(0)}%` }
    for (const t of TENORS) row[TENOR_LABELS[t]] = parseFloat((getByKey(grid, k, t) * 100).toFixed(2))
    return row
  })
}

// One row per tenor, one column per moneyness line, in vol percent.
export function buildTermData(grid: VolNode[]) {
  return TENORS.map((t) => {
    const row: Record<string, number | string> = { t, label: TENOR_LABELS[t] }
    for (const ml of MONEYNESS_LINES) row[ml.label] = parseFloat((getByKey(grid, ml.k, t) * 100).toFixed(2))
    return row
  })
}

// 1Y summary: ATM vol (fraction), risk reversal (90% minus 110%) and butterfly (mean wing
// minus ATM), both in vol points.
export function summarise1Y(grid: VolNode[]) {
  const atm = getByKey(grid, 1.0, 1.0)
  const v90 = getByKey(grid, 0.9, 1.0)
  const v110 = getByKey(grid, 1.1, 1.0)
  return {
    atm,
    riskReversal: (v90 - v110) * 100,
    butterfly: ((v90 + v110) / 2 - atm) * 100,
  }
}

// z[tenor][moneyness] in vol percent, the orientation Plotly's surface trace expects.
export function surfaceZ(grid: VolNode[]): number[][] {
  return TENORS.map((t) => MONEYNESS.map((k) => parseFloat((getByKey(grid, k, t) * 100).toFixed(3))))
}

// Linear blend of two RGB triples.
export function lerpRgb(
  t: number,
  a: [number, number, number],
  b: [number, number, number],
): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export const HEAT_LOW: [number, number, number] = [30, 58, 95]
export const HEAT_HIGH: [number, number, number] = [249, 115, 22]

export function volColor(vol: number, minVol: number, maxVol: number): string {
  const t = maxVol > minVol ? (vol - minVol) / (maxVol - minVol) : 0.5
  return lerpRgb(t, HEAT_LOW, HEAT_HIGH)
}
