import { describe, it, expect } from 'vitest'
import { gasFillColor, powerPriceColor, renewablePctColor, countryName, zoneName, dominantFuelColor, FUEL_PALETTE, carbonIntensityColor, computeCarbonIntensity, EMISSION_FACTORS } from './scales'

describe('gasFillColor', () => {
  it('returns grey for null/undefined', () => {
    expect(gasFillColor(null)).toBe('#374151')
    expect(gasFillColor(undefined)).toBe('#374151')
  })

  it('red-900 for very low fill', () => {
    expect(gasFillColor(0)).toBe('#7f1d1d')
    expect(gasFillColor(10)).toBe('#7f1d1d')
    expect(gasFillColor(19.9)).toBe('#7f1d1d')
  })

  it('amber for mid fill', () => {
    expect(gasFillColor(40)).toBe('#d97706')
    expect(gasFillColor(50)).toBe('#ca8a04')
  })

  it('green for high fill', () => {
    expect(gasFillColor(75)).toBe('#16a34a')
    expect(gasFillColor(90)).toBe('#15803d')
    expect(gasFillColor(100)).toBe('#15803d')
  })

  it('clamps below 0 and above 100', () => {
    expect(gasFillColor(-5)).toBe('#7f1d1d')
    expect(gasFillColor(110)).toBe('#15803d')
  })
})

describe('powerPriceColor', () => {
  it('returns grey for null/undefined', () => {
    expect(powerPriceColor(null)).toBe('#374151')
    expect(powerPriceColor(undefined)).toBe('#374151')
  })

  it('blue for very cheap power', () => {
    expect(powerPriceColor(0)).toBe('#1d4ed8')
    expect(powerPriceColor(15)).toBe('#1d4ed8')
  })

  it('green for moderate price', () => {
    expect(powerPriceColor(80)).toBe('#15803d')
    expect(powerPriceColor(100)).toBe('#15803d')
  })

  it('amber/orange for high price', () => {
    expect(powerPriceColor(160)).toBe('#ca8a04')
    expect(powerPriceColor(200)).toBe('#d97706')
  })

  it('red for extreme price', () => {
    expect(powerPriceColor(280)).toBe('#b91c1c')
    expect(powerPriceColor(350)).toBe('#7f1d1d')
  })
})

describe('countryName', () => {
  it('returns display name for known codes', () => {
    expect(countryName('DE')).toBe('Germany')
    expect(countryName('FR')).toBe('France')
    expect(countryName('EU')).toBe('European Union')
  })

  it('returns code itself for unknown', () => {
    expect(countryName('XX')).toBe('XX')
  })
})

describe('zoneName', () => {
  it('returns display name for known zones', () => {
    expect(zoneName('DE-LU')).toBe('Germany / Luxembourg')
    expect(zoneName('SE-3')).toBe('Sweden SE3 (Stockholm)')
    expect(zoneName('NO-1')).toBe('Norway NO1 (Oslo)')
  })

  it('returns zone key for unknown', () => {
    expect(zoneName('XY-1')).toBe('XY-1')
  })
})

describe('renewablePctColor', () => {
  it('returns grey for null/undefined', () => {
    expect(renewablePctColor(null)).toBe('#374151')
    expect(renewablePctColor(undefined)).toBe('#374151')
  })

  it('brown for low renewables', () => {
    expect(renewablePctColor(0)).toBe('#78350f')
    expect(renewablePctColor(15)).toBe('#78350f')
    expect(renewablePctColor(19)).toBe('#78350f')
  })

  it('amber-brown for 20-40%', () => {
    expect(renewablePctColor(20)).toBe('#92400e')
    expect(renewablePctColor(35)).toBe('#92400e')
    expect(renewablePctColor(39)).toBe('#92400e')
  })

  it('lime for 40-60%', () => {
    expect(renewablePctColor(40)).toBe('#4d7c0f')
    expect(renewablePctColor(55)).toBe('#4d7c0f')
    expect(renewablePctColor(59)).toBe('#4d7c0f')
  })

  it('green for 60-80%', () => {
    expect(renewablePctColor(60)).toBe('#15803d')
    expect(renewablePctColor(75)).toBe('#15803d')
    expect(renewablePctColor(79)).toBe('#15803d')
  })

  it('deep green for 80%+', () => {
    expect(renewablePctColor(80)).toBe('#166534')
    expect(renewablePctColor(95)).toBe('#166534')
    expect(renewablePctColor(100)).toBe('#166534')
  })

  it('clamps out-of-range values', () => {
    expect(renewablePctColor(-10)).toBe('#78350f')
    expect(renewablePctColor(110)).toBe('#166534')
  })
})

describe('dominantFuelColor', () => {
  it('returns grey for null/undefined/empty', () => {
    expect(dominantFuelColor(null)).toBe('#374151')
    expect(dominantFuelColor(undefined)).toBe('#374151')
    expect(dominantFuelColor('')).toBe('#374151')
  })

  it('returns correct color for known fuels', () => {
    expect(dominantFuelColor('nuclear')).toBe(FUEL_PALETTE.nuclear)
    expect(dominantFuelColor('wind')).toBe(FUEL_PALETTE.wind)
    expect(dominantFuelColor('solar')).toBe(FUEL_PALETTE.solar)
    expect(dominantFuelColor('hydro')).toBe(FUEL_PALETTE.hydro)
    expect(dominantFuelColor('gas')).toBe(FUEL_PALETTE.gas)
    expect(dominantFuelColor('coal')).toBe(FUEL_PALETTE.coal)
    expect(dominantFuelColor('biomass')).toBe(FUEL_PALETTE.biomass)
    expect(dominantFuelColor('oil')).toBe(FUEL_PALETTE.oil)
    expect(dominantFuelColor('geothermal')).toBe(FUEL_PALETTE.geothermal)
    expect(dominantFuelColor('other')).toBe(FUEL_PALETTE.other)
  })

  it('returns grey for unknown fuel string', () => {
    expect(dominantFuelColor('unknown-fuel')).toBe('#374151')
  })
})

describe('FUEL_PALETTE', () => {
  it('has exactly 10 fuel entries', () => {
    expect(Object.keys(FUEL_PALETTE).length).toBe(10)
  })

  it('all colors are valid hex strings', () => {
    for (const color of Object.values(FUEL_PALETTE)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('all fuel types present', () => {
    const expected = ['wind', 'solar', 'hydro', 'nuclear', 'biomass', 'gas', 'oil', 'coal', 'geothermal', 'other']
    for (const fuel of expected) {
      expect(FUEL_PALETTE).toHaveProperty(fuel)
    }
  })
})

describe('EMISSION_FACTORS', () => {
  it('covers all 10 fuel types', () => {
    const fuels = ['wind', 'solar', 'hydro', 'nuclear', 'biomass', 'gas', 'oil', 'coal', 'geothermal', 'other']
    for (const fuel of fuels) {
      expect(EMISSION_FACTORS).toHaveProperty(fuel)
    }
  })

  it('coal is the dirtiest fuel', () => {
    const max = Math.max(...Object.values(EMISSION_FACTORS))
    expect(EMISSION_FACTORS.coal).toBe(max)
  })

  it('wind is the cleanest fuel', () => {
    const min = Math.min(...Object.values(EMISSION_FACTORS))
    expect(EMISSION_FACTORS.wind).toBe(min)
  })

  it('all factors are positive numbers', () => {
    for (const v of Object.values(EMISSION_FACTORS)) {
      expect(v).toBeGreaterThan(0)
    }
  })
})

describe('computeCarbonIntensity', () => {
  it('returns null for null/undefined', () => {
    expect(computeCarbonIntensity(null)).toBeNull()
    expect(computeCarbonIntensity(undefined)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(computeCarbonIntensity({})).toBeNull()
  })

  it('returns null when all MW are zero or null', () => {
    expect(computeCarbonIntensity({ wind_mw: 0, solar_mw: null })).toBeNull()
  })

  it('pure wind gives wind emission factor', () => {
    const ci = computeCarbonIntensity({ wind_mw: 1000 })
    expect(ci).toBe(EMISSION_FACTORS.wind)
  })

  it('pure nuclear gives nuclear emission factor', () => {
    const ci = computeCarbonIntensity({ nuclear_mw: 5000 })
    expect(ci).toBe(EMISSION_FACTORS.nuclear)
  })

  it('pure coal gives coal emission factor', () => {
    const ci = computeCarbonIntensity({ coal_mw: 2000 })
    expect(ci).toBe(EMISSION_FACTORS.coal)
  })

  it('50/50 wind and coal is average of their factors', () => {
    const ci = computeCarbonIntensity({ wind_mw: 1000, coal_mw: 1000 })
    const expected = Math.round((EMISSION_FACTORS.wind + EMISSION_FACTORS.coal) / 2)
    expect(ci).toBe(expected)
  })

  it('France-like mix (nuclear+hydro+some gas) gives low intensity', () => {
    const ci = computeCarbonIntensity({ nuclear_mw: 40000, hydro_mw: 8000, gas_mw: 5000 })
    expect(ci).toBeLessThan(100)
  })

  it('Poland-like mix (heavy coal) gives high intensity', () => {
    const ci = computeCarbonIntensity({ coal_mw: 12000, gas_mw: 1000, wind_mw: 2000 })
    expect(ci).toBeGreaterThan(600)
  })

  it('ignores negative MW values', () => {
    const ci = computeCarbonIntensity({ wind_mw: 1000, solar_mw: -100 })
    expect(ci).toBe(EMISSION_FACTORS.wind)
  })
})

describe('carbonIntensityColor', () => {
  it('returns grey for null/undefined', () => {
    expect(carbonIntensityColor(null)).toBe('#374151')
    expect(carbonIntensityColor(undefined)).toBe('#374151')
  })

  it('deep green for very clean (< 50 gCO2/kWh)', () => {
    expect(carbonIntensityColor(0)).toBe('#166534')
    expect(carbonIntensityColor(30)).toBe('#166534')
    expect(carbonIntensityColor(49)).toBe('#166534')
  })

  it('green for clean (50-100)', () => {
    expect(carbonIntensityColor(50)).toBe('#15803d')
    expect(carbonIntensityColor(80)).toBe('#15803d')
  })

  it('yellow/amber for medium (200-400)', () => {
    expect(carbonIntensityColor(250)).toBe('#ca8a04')
    expect(carbonIntensityColor(350)).toBe('#d97706')
  })

  it('red for dirty (> 500)', () => {
    expect(carbonIntensityColor(600)).toBe('#b91c1c')
    expect(carbonIntensityColor(820)).toBe('#b91c1c')
  })
})
