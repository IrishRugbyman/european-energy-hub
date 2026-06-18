import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '@/lib/api'

export const Route = createFileRoute('/generation')({
  component: GenerationTrends,
})

// RE% -> HSL color: 0% = muted red, 50% = yellow-amber, 100% = bright green
function reColor(pct: number | null): string {
  if (pct == null) return '#1e293b'
  const t = Math.max(0, Math.min(100, pct)) / 100
  // Two-segment gradient: 0->0.5 red-amber, 0.5->1.0 amber-green
  if (t < 0.5) {
    const s = t * 2
    const r = Math.round(220 - s * 60)
    const g = Math.round(30 + s * 110)
    return `rgb(${r},${g},20)`
  }
  const s = (t - 0.5) * 2
  const r = Math.round(160 - s * 130)
  const g = Math.round(140 + s * 80)
  return `rgb(${r},${g},30)`
}

function textColor(pct: number | null): string {
  if (pct == null) return '#64748b'
  return pct > 45 ? '#000000' : '#ffffff'
}

function GenerationTrends() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gen-trends'],
    queryFn: api.genTrends,
    staleTime: 6 * 60 * 60 * 1000,
  })

  // Build lookup: zone -> year -> renewable_pct
  const lookup = useMemo(() => {
    const m: Record<string, Record<number, number | null>> = {}
    for (const r of data?.rows ?? []) {
      if (!m[r.zone]) m[r.zone] = {}
      m[r.zone][r.year] = r.renewable_pct
    }
    return m
  }, [data])

  // Change from 2021 to latest year (for badge)
  const change = (zone: string): number | null => {
    const yrMap = lookup[zone]
    if (!yrMap) return null
    const years = Object.keys(yrMap).map(Number).sort()
    if (years.length < 2) return null
    const first = yrMap[years[0]]
    const last = yrMap[years[years.length - 1]]
    if (first == null || last == null) return null
    return last - first
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading generation trends...
      </div>
    )
  }

  if (error || !data || data.zones.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Generation data unavailable.
      </div>
    )
  }

  const { zones, years } = data

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="mb-4">
        <h1 className="text-base font-semibold">Renewable Generation Trends</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Annual average renewable % per bidding zone - wind + solar + hydro + biomass. Sorted by latest year.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5 min-w-max">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-normal pr-3 pb-1 whitespace-nowrap">Zone</th>
              {years.map((y) => (
                <th key={y} className="text-center text-muted-foreground font-normal px-1 pb-1 min-w-[52px]">
                  {y === new Date().getFullYear() ? `${y}*` : y}
                </th>
              ))}
              <th className="text-center text-muted-foreground font-normal px-1 pb-1 whitespace-nowrap">
                5yr change
              </th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => {
              const delta = change(zone)
              return (
                <tr key={zone}>
                  <td className="text-muted-foreground pr-3 py-0.5 font-mono whitespace-nowrap">{zone}</td>
                  {years.map((yr) => {
                    const pct = lookup[zone]?.[yr] ?? null
                    return (
                      <td key={yr} className="text-center py-0.5 rounded" style={{ minWidth: 52 }}>
                        <div
                          className="rounded px-1 py-1 text-center font-medium"
                          style={{
                            backgroundColor: reColor(pct),
                            color: textColor(pct),
                          }}
                          title={`${zone} ${yr}: ${pct != null ? pct.toFixed(1) + '%' : 'n/a'}`}
                        >
                          {pct != null ? `${pct.toFixed(0)}%` : '--'}
                        </div>
                      </td>
                    )
                  })}
                  <td className="text-center py-0.5 px-1">
                    {delta != null && (
                      <span
                        className="font-semibold"
                        style={{ color: delta >= 0 ? '#4ade80' : '#f87171' }}
                      >
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(0)}pp
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden">
            {[0, 20, 40, 60, 80, 100].map((v) => (
              <div
                key={v}
                className="w-6 h-3"
                style={{ backgroundColor: reColor(v) }}
                title={`${v}%`}
              />
            ))}
          </div>
          <span>0% &rarr; 100% renewable</span>
        </div>
        <span>* Partial year (YTD average)</span>
      </div>
    </div>
  )
}
