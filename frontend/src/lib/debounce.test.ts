import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once with the last arguments after the quiet period', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d(1)
    vi.advanceTimersByTime(100)
    d(2)
    vi.advanceTimersByTime(100)
    d(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })
  it('fires again for a call after the first has run', () => {
    const fn = vi.fn()
    const d = debounce(fn, 50)
    d('a')
    vi.advanceTimersByTime(50)
    d('b')
    vi.advanceTimersByTime(50)
    expect(fn.mock.calls).toEqual([['a'], ['b']])
  })
  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 50)
    d()
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
