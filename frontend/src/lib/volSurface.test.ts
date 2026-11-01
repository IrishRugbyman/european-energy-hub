import { describe, expect, it } from 'vitest'
import {
  HEAT_HIGH,
  HEAT_LOW,
  MONEYNESS,
  TENORS,
  buildSmileData,
  buildTermData,
  getByKey,
  summarise1Y,
  surfaceZ,
  volColor,
  type VolNode,
} from './volSurface'

// Grid shaped like the pricer's output (9 moneyness x 5 tenors); vol = 0.20 + 0.1*(k-1)^2
// - 0.05*(k-1), a smile with negative skew, flat in tenor, so every expectation is exact.
const f = (k: number) => 0.2 + 0.1 * (k - 1) ** 2 - 0.05 * (k - 1)
const grid: VolNode[] = TENORS.flatMap((t) => MONEYNESS.map((k) => ({ k_rel: k, t, vol: f(k) })))

describe('getByKey', () => {
  it('finds a node and tolerates float noise', () => {
    expect(getByKey(grid, 1.0, 1.0)).toBeCloseTo(0.2, 12)
    expect(getByKey(grid, 0.9 + 1e-5, 0.5)).toBeCloseTo(f(0.9), 12)
  })
  it('returns 0 for a missing node and for an empty grid', () => {
    expect(getByKey(grid, 3.0, 1.0)).toBe(0)
    expect(getByKey([], 1.0, 1.0)).toBe(0)
  })
})

describe('series builders', () => {
  it('smile rows are percent, one column per tenor label', () => {
    const rows = buildSmileData(grid)
    expect(rows).toHaveLength(9)
    const atm = rows[4]
    expect(atm.label).toBe('100%')
    expect(atm['1Y']).toBeCloseTo(20, 2)
    expect(Object.keys(atm)).toEqual(expect.arrayContaining(['3M', '6M', '1Y', '18M', '2Y']))
  })
  it('term rows are percent, one column per moneyness line', () => {
    const rows = buildTermData(grid)
    expect(rows).toHaveLength(5)
    expect(rows[0].label).toBe('3M')
    expect(rows[2].ATM).toBeCloseTo(20, 2)
    expect(rows[2]['90%']).toBeCloseTo(f(0.9) * 100, 2)
  })
  it('surfaceZ is tenors x moneyness', () => {
    const z = surfaceZ(grid)
    expect(z).toHaveLength(5)
    expect(z[0]).toHaveLength(9)
    expect(z[2][4]).toBeCloseTo(20, 3)
  })
})

describe('summarise1Y', () => {
  it('risk reversal is 90% minus 110% vol, butterfly is mean wing minus ATM, in vol points', () => {
    const s = summarise1Y(grid)
    expect(s.atm).toBeCloseTo(0.2, 12)
    expect(s.riskReversal).toBeCloseTo((f(0.9) - f(1.1)) * 100, 9)
    expect(s.riskReversal).toBeCloseTo(1, 9) // skew -0.05 -> +1 vol pt for the downside
    expect(s.butterfly).toBeCloseTo(0.1 * 0.01 * 100, 9) // convexity 0.1 * 0.1^2 = 0.001 -> 0.1pt
  })
  it('is all zeros on an empty grid rather than NaN', () => {
    expect(summarise1Y([])).toEqual({ atm: 0, riskReversal: 0, butterfly: 0 })
  })
})

describe('volColor', () => {
  it('maps min to the low colour and max to the high colour', () => {
    expect(volColor(0.1, 0.1, 0.5)).toBe(`rgb(${HEAT_LOW.join(',')})`)
    expect(volColor(0.5, 0.1, 0.5)).toBe(`rgb(${HEAT_HIGH.join(',')})`)
  })
  it('uses the midpoint for a flat surface', () => {
    expect(volColor(0.2, 0.2, 0.2)).toBe(
      `rgb(${HEAT_LOW.map((x, i) => Math.round((x + HEAT_HIGH[i]) / 2)).join(',')})`,
    )
  })
})
