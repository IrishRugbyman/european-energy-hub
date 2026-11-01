import { useEffect, useState } from 'react'

// Trailing-edge debounce: only the last call within `ms` runs. cancel() drops a pending call.
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, ms)
  }
  wrapped.cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}

// The value, delayed until it has been stable for `ms`. Drives slider-fed query keys so a
// drag issues one request when it settles instead of one per tick (the API allows 120/min).
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}
