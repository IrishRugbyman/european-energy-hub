import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export type DateWindow = '1Y' | '2Y' | '5Y' | 'ALL'

export function cutoffDate(w: DateWindow): string | null {
  if (w === 'ALL') return null
  const now = new Date()
  const years = w === '1Y' ? 1 : w === '2Y' ? 2 : 5
  now.setFullYear(now.getFullYear() - years)
  return now.toISOString().slice(0, 10)
}

export function latestNonNull<T>(rows: T[], key: keyof T): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key]
    if (v != null) return v as number
  }
  return null
}

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
