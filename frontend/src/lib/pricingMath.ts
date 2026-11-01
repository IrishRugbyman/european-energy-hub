// Display-side option maths for the /pricing page. Server prices come from the C++ binary;
// everything here feeds the explanatory charts (Greek profiles, Merton Poisson series,
// geometric-Asian benchmark, heat maps) and is pure so it can be unit-tested.

import type { OptionType } from '@/lib/api'
import { HEAT_TEXT_DARK, HEAT_TEXT_LIGHT } from '@/lib/pricingTheme'

// Abramowitz-Stegun 26.2.17, absolute error below 7.5e-8.
export function normCDF(x: number): number {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))))
  return x > 0 ? 1 - p : p
}

export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

// European Black-Scholes price.
export function bsPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
): number {
  if (T <= 0 || sigma <= 0) {
    return Math.max(type === 'call' ? S - K : K - S, 0)
  }
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const disc = Math.exp(-r * T)
  return type === 'call'
    ? S * normCDF(d1) - K * disc * normCDF(d2)
    : K * disc * normCDF(-d2) - S * normCDF(-d1)
}

// Delta and gamma across spot from 60% to 140% of strike.
export function bsProfile(K: number, T: number, r: number, sigma: number, type: OptionType) {
  const steps = 60
  const lo = K * 0.6
  const hi = K * 1.4
  return Array.from({ length: steps + 1 }, (_, i) => {
    const S = lo + (i / steps) * (hi - lo)
    const sqrtT = Math.sqrt(T)
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    const delta = type === 'call' ? normCDF(d1) : normCDF(d1) - 1
    const gamma = normPDF(d1) / (S * sigma * sqrtT)
    return { S: +S.toFixed(2), delta: +delta.toFixed(4), gamma: +gamma.toFixed(5) }
  })
}

// Payoff of a spread call max(S1 - S2 - K, 0) over a window centred on the strike.
export function spreadPayoffData(K: number, rangeHalfWidth = 20, steps = 80) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const spread = K - rangeHalfWidth + (i * (2 * rangeHalfWidth)) / steps
    return { spread: +spread.toFixed(2), payoff: +Math.max(spread - K, 0).toFixed(4) }
  })
}

// Geometric-average Asian option, closed form: the lower-variance cousin of the arithmetic
// average, which has no closed form and needs the Monte Carlo.
// For n fixings at t_i = iT/n:  ln G ~ N(m, s^2) with
//   m = ln S + (r - sigma^2/2) T (n+1)/(2n),  s^2 = sigma^2 T (n+1)(2n+1)/(6 n^2)
export function geometricAsian(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  n: number,
  type: OptionType,
): number {
  const m = Math.log(S) + ((r - 0.5 * sigma * sigma) * T * (n + 1)) / (2 * n)
  const s2 = (sigma * sigma * T * (n + 1) * (2 * n + 1)) / (6 * n * n)
  const s = Math.sqrt(s2)
  const disc = Math.exp(-r * T)
  const fwd = Math.exp(m + 0.5 * s2)
  const d1 = (m - Math.log(K) + s2) / s
  const d2 = d1 - s
  return type === 'call'
    ? disc * (fwd * normCDF(d1) - K * normCDF(d2))
    : disc * (K * normCDF(-d2) - fwd * normCDF(-d1))
}

// Effective vol of the average: sigma * sqrt((n+1)(2n+1)/(6 n^2)), tends to sigma/sqrt(3).
export function averagingVol(sigma: number, n: number): number {
  return sigma * Math.sqrt(((n + 1) * (2 * n + 1)) / (6 * n * n))
}

// Merton (1976) price as a Poisson-weighted sum of Black-Scholes prices:
//   sum_n  e^{-lambda' T} (lambda' T)^n / n!  *  BS(r_n, sigma_n)
// with lambda' = lambda (1 + k), r_n = r - lambda k + n ln(1+k)/T and
// sigma_n^2 = sigma^2 + n sigmaJ^2 / T.
export function mertonSeries(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  lambda: number,
  muJ: number,
  sigmaJ: number,
  type: OptionType,
  terms = 9,
) {
  const m = muJ + 0.5 * sigmaJ * sigmaJ // = ln(1 + k)
  const kHat = Math.exp(m) - 1
  const lambdaPrime = lambda * Math.exp(m)
  const rows: { n: number; weight: number; bs: number; contribution: number; cumulative: number }[] =
    []
  let weight = Math.exp(-lambdaPrime * T)
  let cumulative = 0
  for (let n = 0; n < terms; n++) {
    const rN = r - lambda * kHat + (n * m) / T
    const sigmaN = Math.sqrt(sigma * sigma + (n * sigmaJ * sigmaJ) / T)
    const bs = bsPrice(S, K, T, rN, sigmaN, type)
    const contribution = weight * bs
    cumulative += contribution
    rows.push({
      n,
      weight: +weight.toFixed(6),
      bs: +bs.toFixed(4),
      contribution: +contribution.toFixed(6),
      cumulative: +cumulative.toFixed(6),
    })
    weight *= (lambdaPrime * T) / (n + 1)
  }
  return { rows, kHat }
}

// Blue -> pale -> red ramp for implied-vol heat maps. Returns the RGB triple.
export function volHeatRgb(v: number, lo: number, hi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))
  if (t < 0.5) {
    const u = t * 2
    return [Math.round(59 + u * 180), Math.round(130 + u * 116), Math.round(246 + u * 9)]
  }
  const u = (t - 0.5) * 2
  return [239, Math.round(246 - u * 178), Math.round(255 - u * 187)]
}

export function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`
}

// Legible ink for a heat cell, from perceptual luma.
export function heatTextColor([r, g, b]: [number, number, number]): string {
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? HEAT_TEXT_DARK : HEAT_TEXT_LIGHT
}

export const HEAT_LEGEND_GRADIENT = `linear-gradient(to right,${rgbCss(volHeatRgb(0, 0, 1))},${rgbCss(volHeatRgb(0.5, 0, 1))},${rgbCss(volHeatRgb(1, 0, 1))})`

/**
 * Greek units. The C++ pricer returns vega and rho per unit (1.00 = 100 percentage points
 * of vol or rate) and theta per year (dV/dt). Traders read them per 1pp and per calendar
 * day, which is how the tables label them, so the displayed numbers are converted here.
 */
export function perVolPoint(perUnit: number): number {
  return perUnit / 100
}

export function perRatePoint(perUnit: number): number {
  return perUnit / 100
}

export function perCalendarDay(perYear: number): number {
  return perYear / 365
}
