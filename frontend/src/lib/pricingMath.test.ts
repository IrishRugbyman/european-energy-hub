import { describe, expect, it } from 'vitest'
import {
  averagingVol,
  bsPrice,
  bsProfile,
  geometricAsian,
  heatTextColor,
  mertonSeries,
  normCDF,
  normPDF,
  spreadPayoffData,
  perCalendarDay,
  perRatePoint,
  perVolPoint,
  volHeatRgb,
} from './pricingMath'
import { HEAT_TEXT_DARK, HEAT_TEXT_LIGHT } from './pricingTheme'

// Reference values come from the C++ pricer_api binary and standard tables, not from this module:
//   pricer_api bs 95 100 0.5 0.02 0.2 call -> 3.696764 ; put -> 7.701747

describe('normCDF / normPDF', () => {
  it('matches tabulated normal values within the 7.5e-8 bound of the approximation', () => {
    expect(normCDF(0)).toBeCloseTo(0.5, 6)
    expect(normCDF(1)).toBeCloseTo(0.8413447461, 6)
    expect(normCDF(-1.96)).toBeCloseTo(0.0249978951, 6)
    expect(normCDF(3)).toBeCloseTo(0.9986501020, 6)
  })
  it('is symmetric: N(x) + N(-x) = 1', () => {
    for (const x of [0.1, 0.7, 2.3, 4.5]) expect(normCDF(x) + normCDF(-x)).toBeCloseTo(1, 9)
  })
  it('pdf peaks at 1/sqrt(2 pi)', () => {
    expect(normPDF(0)).toBeCloseTo(0.3989422804, 9)
    expect(normPDF(1)).toBeCloseTo(0.2419707245, 9)
  })
})

describe('bsPrice', () => {
  it('reproduces the C++ binary (call and put, S=95 K=100 T=0.5 r=2% vol=20%)', () => {
    expect(bsPrice(95, 100, 0.5, 0.02, 0.2, 'call')).toBeCloseTo(3.696764, 4)
    expect(bsPrice(95, 100, 0.5, 0.02, 0.2, 'put')).toBeCloseTo(7.701747, 4)
  })
  it('satisfies put-call parity away from the money', () => {
    const [S, K, T, r, v] = [120, 100, 0.75, 0.03, 0.35]
    const c = bsPrice(S, K, T, r, v, 'call')
    const p = bsPrice(S, K, T, r, v, 'put')
    expect(c - p).toBeCloseTo(S - K * Math.exp(-r * T), 6)
  })
  it('falls back to intrinsic value at zero maturity or zero vol', () => {
    expect(bsPrice(110, 100, 0, 0.02, 0.2, 'call')).toBe(10)
    expect(bsPrice(110, 100, 1, 0.02, 0, 'put')).toBe(0)
    expect(bsPrice(90, 100, 0, 0.02, 0.2, 'put')).toBe(10)
  })
})

describe('bsProfile', () => {
  it('spans 60%-140% of strike in 61 points', () => {
    const p = bsProfile(100, 0.5, 0.02, 0.2, 'call')
    expect(p).toHaveLength(61)
    expect(p[0].S).toBe(60)
    expect(p[60].S).toBe(140)
  })
  it('call delta rises monotonically from ~0 to ~1; put delta is call delta minus 1', () => {
    const c = bsProfile(100, 0.5, 0.02, 0.2, 'call')
    const q = bsProfile(100, 0.5, 0.02, 0.2, 'put')
    for (let i = 1; i < c.length; i++) expect(c[i].delta).toBeGreaterThanOrEqual(c[i - 1].delta)
    expect(c[0].delta).toBeLessThan(0.01)
    expect(c[60].delta).toBeGreaterThan(0.99)
    c.forEach((row, i) => expect(row.delta - q[i].delta).toBeCloseTo(1, 3))
  })
  it('gamma is identical for call and put and peaks near the money', () => {
    const c = bsProfile(100, 0.5, 0.02, 0.2, 'call')
    const q = bsProfile(100, 0.5, 0.02, 0.2, 'put')
    c.forEach((row, i) => expect(row.gamma).toBe(q[i].gamma))
    const peak = c.reduce((a, b) => (b.gamma > a.gamma ? b : a))
    expect(Math.abs(peak.S - 100)).toBeLessThan(10)
  })
})

describe('spreadPayoffData', () => {
  it('is zero below the strike and linear above it', () => {
    const d = spreadPayoffData(5, 20, 80)
    expect(d).toHaveLength(81)
    for (const row of d) expect(row.payoff).toBeCloseTo(Math.max(row.spread - 5, 0), 3)
    expect(d[0].spread).toBe(-15)
    expect(d[80].spread).toBe(25)
  })
})

describe('geometricAsian / averagingVol', () => {
  it('collapses to Black-Scholes for a single fixing at maturity (n = 1)', () => {
    const [S, K, T, r, v] = [100, 105, 1, 0.05, 0.2]
    expect(geometricAsian(S, K, T, r, v, 1, 'call')).toBeCloseTo(bsPrice(S, K, T, r, v, 'call'), 6)
    expect(geometricAsian(S, K, T, r, v, 1, 'put')).toBeCloseTo(bsPrice(S, K, T, r, v, 'put'), 6)
  })
  it('is cheaper than the European call and satisfies parity against the forward average', () => {
    const [S, K, T, r, v, n] = [100, 100, 1, 0.05, 0.2, 12]
    const c = geometricAsian(S, K, T, r, v, n, 'call')
    const p = geometricAsian(S, K, T, r, v, n, 'put')
    expect(c).toBeLessThan(bsPrice(S, K, T, r, v, 'call'))
    const m = Math.log(S) + ((r - 0.5 * v * v) * T * (n + 1)) / (2 * n)
    const s2 = (v * v * T * (n + 1) * (2 * n + 1)) / (6 * n * n)
    expect(c - p).toBeCloseTo(Math.exp(-r * T) * (Math.exp(m + 0.5 * s2) - K), 8)
  })
  it('averaging vol is sigma at n = 1 and tends to sigma / sqrt(3)', () => {
    expect(averagingVol(0.2, 1)).toBeCloseTo(0.2, 12)
    expect(averagingVol(0.2, 1e6)).toBeCloseTo(0.2 / Math.sqrt(3), 5)
  })
})

describe('mertonSeries', () => {
  it('with lambda = 0 reduces to Black-Scholes in the first term', () => {
    const { rows, kHat } = mertonSeries(100, 100, 1, 0.05, 0.15, 0, -0.1, 0.15, 'call')
    expect(rows[0].weight).toBeCloseTo(1, 9)
    expect(rows[0].bs).toBeCloseTo(bsPrice(100, 100, 1, 0.05, 0.15, 'call'), 3)
    expect(rows[8].cumulative).toBeCloseTo(rows[0].cumulative, 9)
    expect(kHat).toBeCloseTo(Math.exp(-0.1 + 0.5 * 0.15 * 0.15) - 1, 12)
  })
  it('Poisson weights sum to 1 over enough terms', () => {
    const { rows } = mertonSeries(100, 100, 1, 0.05, 0.15, 0.5, -0.1, 0.15, 'call', 30)
    expect(rows.reduce((a, r) => a + r.weight, 0)).toBeCloseTo(1, 4)
  })
  it('matches the C++ analytic Merton price (8.591658 at lambda = 0)', () => {
    const { rows } = mertonSeries(100, 100, 1, 0.05, 0.15, 0, -0.1, 0.15, 'call')
    expect(rows[8].cumulative).toBeCloseTo(8.591658, 3)
  })
  it('put-call parity holds for the jump-diffusion price', () => {
    const args = [100, 100, 1, 0.05, 0.15, 0.5, -0.1, 0.15] as const
    const c = mertonSeries(...args, 'call', 30).rows.at(-1)!.cumulative
    const p = mertonSeries(...args, 'put', 30).rows.at(-1)!.cumulative
    expect(c - p).toBeCloseTo(100 - 100 * Math.exp(-0.05), 3)
  })
})

describe('volHeatRgb / heatTextColor', () => {
  it('runs blue at the low end, pale mid, red at the high end', () => {
    expect(volHeatRgb(0, 0, 1)).toEqual([59, 130, 246])
    expect(volHeatRgb(0.5, 0, 1)).toEqual([239, 246, 255])
    expect(volHeatRgb(1, 0, 1)).toEqual([239, 68, 68])
  })
  it('clamps outside the range and survives a degenerate range', () => {
    expect(volHeatRgb(-5, 0, 1)).toEqual(volHeatRgb(0, 0, 1))
    expect(volHeatRgb(9, 0, 1)).toEqual(volHeatRgb(1, 0, 1))
    expect(volHeatRgb(0.2, 0.2, 0.2)).toEqual(volHeatRgb(0, 0, 1))
  })
  it('chooses dark ink on the pale cell and light ink on the saturated ends', () => {
    expect(heatTextColor(volHeatRgb(0.5, 0, 1))).toBe(HEAT_TEXT_DARK)
    expect(heatTextColor(volHeatRgb(1, 0, 1))).toBe(HEAT_TEXT_LIGHT)
    expect(heatTextColor(volHeatRgb(0, 0, 1))).toBe(HEAT_TEXT_LIGHT)
  })
})

describe('Greek unit conversions', () => {
  // Black-Scholes call, S=K=100, T=1, r=5%, sigma=20%: the pricer returns
  // vega 37.524035 per unit vol, rho 53.232482 per unit rate, theta -6.414028 per year.
  it('vega per 1pp of vol is the per-unit vega over 100', () => {
    expect(perVolPoint(37.524035)).toBeCloseTo(0.37524, 5)
  })
  it('rho per 1pp of rate is the per-unit rho over 100', () => {
    expect(perRatePoint(53.232482)).toBeCloseTo(0.532325, 6)
  })
  it('theta per calendar day is the annual theta over 365', () => {
    expect(perCalendarDay(-6.414028)).toBeCloseTo(-0.017573, 6)
  })
  it('a 1pp vol move matches the per-1pp vega to first order', () => {
    const up = bsPrice(100, 100, 1, 0.05, 0.21, 'call')
    const dn = bsPrice(100, 100, 1, 0.05, 0.19, 'call')
    expect((up - dn) / 2).toBeCloseTo(perVolPoint(37.524035), 3)
  })
})
