import { describe, it, expect } from 'vitest'
import { buildIslandHistory } from '@/lib/island'
import { hasNoPrice, isPriceMetric, noPriceFillFor, NO_PRICE_FILL, type MapMetric } from '@/lib/scales'

/**
 * The point of the no-price treatment is that "this zone has no market" must never be
 * shown the same way as "this price is missing". These tests pin that distinction, and the
 * gap-preserving history rollup that stops a 19-month data hole rendering as a line.
 */

const PRICE_METRICS: MapMetric[] = ['price', 'range', 'neg_hours', 'pct_rank']
const GEN_METRICS: MapMetric[] = [
  'renewable', 'dominant_fuel', 'carbon_intensity', 'wind_cf', 'solar_cf', 'hydro_fill',
]

describe('hasNoPrice', () => {
  it('flags Corsica', () => {
    expect(hasNoPrice('FR-COR')).toBe(true)
  })

  it('does not flag mainland France', () => {
    expect(hasNoPrice('FR')).toBe(false)
  })

  it('does not flag island bidding zones that do clear a price', () => {
    // Sardinia and Sicily are real IPEX bidding zones - islands, but they publish prices.
    expect(hasNoPrice('IT-SARD')).toBe(false)
    expect(hasNoPrice('IT-SICI')).toBe(false)
  })
})

describe('isPriceMetric', () => {
  it.each(PRICE_METRICS)('%s is a price metric', (m) => expect(isPriceMetric(m)).toBe(true))
  it.each(GEN_METRICS)('%s is not a price metric', (m) => expect(isPriceMetric(m)).toBe(false))
})

describe('noPriceFillFor', () => {
  it.each(PRICE_METRICS)('overrides the fill for a no-price zone on %s', (metric) => {
    expect(noPriceFillFor(metric, 'FR-COR')).toBe(NO_PRICE_FILL)
  })

  it('never returns the missing-data grey', () => {
    for (const metric of PRICE_METRICS) {
      expect(noPriceFillFor(metric, 'FR-COR')).not.toBe('#374151')
    }
  })

  it.each(GEN_METRICS)('does not override %s, where the zone has real data', (metric) => {
    expect(noPriceFillFor(metric, 'FR-COR')).toBeNull()
  })

  it.each(PRICE_METRICS)('does not override a priced zone on %s', (metric) => {
    expect(noPriceFillFor(metric, 'FR')).toBeNull()
  })

  it('does not override when no zone is supplied', () => {
    expect(noPriceFillFor('price', undefined)).toBeNull()
  })
})

describe('buildIslandHistory', () => {
  it('averages daily shares within a month', () => {
    const out = buildIslandHistory([
      { gen_date: '2024-03-01', import_share_pct: 20 },
      { gen_date: '2024-03-02', import_share_pct: 30 },
    ])
    expect(out).toEqual([{ month: '2024-03', share: 25 }])
  })

  it('emits a null month for a gap instead of skipping it', () => {
    const out = buildIslandHistory([
      { gen_date: '2024-01-15', import_share_pct: 40 },
      { gen_date: '2024-02-15', import_share_pct: null },
      { gen_date: '2024-03-15', import_share_pct: 20 },
    ])
    expect(out.map((r) => r.month)).toEqual(['2024-01', '2024-02', '2024-03'])
    expect(out[1].share).toBeNull()
  })

  it('fills months with no rows at all, spanning a year boundary', () => {
    const out = buildIslandHistory([
      { gen_date: '2024-11-15', import_share_pct: 40 },
      { gen_date: '2025-02-15', import_share_pct: 20 },
    ])
    expect(out.map((r) => r.month)).toEqual(['2024-11', '2024-12', '2025-01', '2025-02'])
    expect(out[1].share).toBeNull()
    expect(out[2].share).toBeNull()
  })

  it('reproduces the real Corsica gap without connecting across it', () => {
    const out = buildIslandHistory([
      { gen_date: '2024-12-31', import_share_pct: 35 },
      { gen_date: '2026-07-20', import_share_pct: 25 },
    ])
    // Dec-2024 and Jul-2026 have data; every one of the 18 months between must be null.
    expect(out.filter((r) => r.share === null)).toHaveLength(18)
    expect(out[0]).toEqual({ month: '2024-12', share: 35 })
    expect(out[out.length - 1]).toEqual({ month: '2026-07', share: 25 })
  })

  it('treats a month whose every row is null as null, not zero', () => {
    const out = buildIslandHistory([
      { gen_date: '2025-05-01', import_share_pct: null },
      { gen_date: '2025-05-02', import_share_pct: null },
    ])
    expect(out).toEqual([{ month: '2025-05', share: null }])
  })

  it('keeps negative shares, which mean the island was exporting', () => {
    const out = buildIslandHistory([{ gen_date: '2024-06-01', import_share_pct: -5 }])
    expect(out[0].share).toBe(-5)
  })

  it('returns an empty array for no input rather than throwing', () => {
    expect(buildIslandHistory([])).toEqual([])
  })

  it('handles a single day', () => {
    expect(buildIslandHistory([{ gen_date: '2024-06-01', import_share_pct: 12.34 }])).toEqual([
      { month: '2024-06', share: 12.3 },
    ])
  })
})
