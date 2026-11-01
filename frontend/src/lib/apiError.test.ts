import { describe, expect, it } from 'vitest'
import { errorMessageFromBody } from './apiError'

describe('errorMessageFromBody', () => {
  it('uses a string detail', () => {
    expect(errorMessageFromBody(503, '{"detail":"Pricing binary not available."}')).toBe(
      '503: Pricing binary not available.',
    )
  })
  it('names the field of a 422 validation error and drops the body prefix', () => {
    const body = JSON.stringify({
      detail: [{ loc: ['body', 'sigma'], msg: 'Input should be greater than 0', type: 'x' }],
    })
    expect(errorMessageFromBody(422, body)).toBe('422: sigma: Input should be greater than 0')
  })
  it('joins several validation errors', () => {
    const body = JSON.stringify({
      detail: [
        { loc: ['body', 'T'], msg: 'bad T' },
        { loc: ['body', 'rho'], msg: 'bad rho' },
      ],
    })
    expect(errorMessageFromBody(422, body)).toBe('422: T: bad T; rho: bad rho')
  })
  it('falls back to truncated raw text for a non-JSON body and to the status when empty', () => {
    expect(errorMessageFromBody(502, '<html>bad gateway</html>')).toBe('502: <html>bad gateway</html>')
    expect(errorMessageFromBody(502, 'x'.repeat(500))).toHaveLength('502: '.length + 200)
    expect(errorMessageFromBody(500, '')).toBe('500')
  })
})
