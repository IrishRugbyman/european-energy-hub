import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt(v: number | null | undefined, decimals = 1, suffix = ''): string {
  if (v == null) return '--'
  return `${v.toFixed(decimals)}${suffix}`
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  return fmt(v, decimals, '%')
}

export function fmtDelta(v: number | null | undefined, decimals = 1, suffix = ''): string {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(decimals)}${suffix}`
}
