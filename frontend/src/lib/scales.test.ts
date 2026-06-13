import { describe, it, expect } from 'vitest'
import { gasFillColor, powerPriceColor, countryName, zoneName } from './scales'

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
