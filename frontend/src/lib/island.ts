/**
 * Pure helpers for the island (non-interconnected) system view.
 *
 * Kept out of the panel component so they can be unit-tested without pulling recharts
 * and a DOM into the test run - vitest is configured with `environment: 'node'`.
 */

export interface IslandHistoryPoint {
  month: string
  /** null means no data was published that month, which is not the same as zero flow. */
  share: number | null
}

/**
 * Daily cable share -> monthly means, with every calendar month between the first and the
 * last present in the output.
 *
 * A month with no observations yields `share: null`, which recharts renders as a break in
 * the line. Omitting it instead would place 2024-12 next to 2026-07 on the axis and draw a
 * clean segment between them, presenting 19 months EDF never published as though they were
 * measured. That is the single most misleading thing this chart could do, so the padding
 * is the point of the function, not an implementation detail.
 */
export function buildIslandHistory(
  daily: { gen_date: string; import_share_pct: number | null }[],
): IslandHistoryPoint[] {
  if (daily.length === 0) return []

  const sums = new Map<string, { total: number; n: number }>()
  for (const row of daily) {
    const month = row.gen_date.slice(0, 7)
    if (!sums.has(month)) sums.set(month, { total: 0, n: 0 })
    if (row.import_share_pct != null) {
      const acc = sums.get(month)!
      acc.total += row.import_share_pct
      acc.n += 1
    }
  }

  const months = [...sums.keys()].sort()
  const [startY, startM] = months[0].split('-').map(Number)
  const [endY, endM] = months[months.length - 1].split('-').map(Number)

  const out: IslandHistoryPoint[] = []
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    const acc = sums.get(key)
    out.push({ month: key, share: acc && acc.n > 0 ? Number((acc.total / acc.n).toFixed(1)) : null })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}
