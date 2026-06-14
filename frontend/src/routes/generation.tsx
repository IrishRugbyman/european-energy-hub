import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type GenMapItem } from '@/lib/api'
import { GenMap } from '@/components/generation/GenMap'
import { ZoneGenPanel } from '@/components/generation/ZoneGenPanel'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/generation')({
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === 'string' && search.date ? search.date : undefined,
  }),
  component: GenerationDashboard,
})

function GenerationDashboard() {
  const { date: urlDate } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['gen-map', urlDate ?? 'latest'],
    queryFn: () => api.genMap(urlDate),
    staleTime: 15 * 60 * 1000,
  })

  const byZone: Record<string, GenMapItem> = {}
  for (const z of data?.zones ?? []) byZone[z.zone] = z

  // EU-weighted renewable average
  const withData = (data?.zones ?? []).filter((z) => z.renewable_pct != null && z.total_mw != null && z.total_mw > 0)
  const totalMW = withData.reduce((s, z) => s + (z.total_mw ?? 0), 0)
  const weightedRE = totalMW > 0
    ? withData.reduce((s, z) => s + (z.renewable_pct ?? 0) * (z.total_mw ?? 0), 0) / totalMW
    : null
  const topZone = withData.length > 0 ? withData.reduce((a, b) => (a.renewable_pct ?? 0) > (b.renewable_pct ?? 0) ? a : b) : null
  const genDate = data?.zones[0]?.gen_date ?? null

  const minDate = data?.min_date ?? undefined
  const maxDate = data?.max_date ?? undefined
  const isHistorical = !!urlDate && urlDate !== maxDate

  function setDate(d: string) {
    void navigate({ search: { date: !d || d === maxDate ? undefined : d } })
  }

  return (
    <div className="relative h-full flex">
      {/* Stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 px-4 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {weightedRE != null ? (
          <>
            <StatChip label="EU avg renewable" value={`${weightedRE.toFixed(0)}%`} />
            {topZone && <StatChip label="highest" value={`${topZone.zone} ${topZone.renewable_pct?.toFixed(0)}%`} />}
            {genDate && (
              <span className={`text-xs ${isHistorical ? 'text-amber-400' : 'text-muted-foreground'}`}>
                {genDate}{isHistorical ? ' (historical)' : ''}
              </span>
            )}
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Date picker (top-right) */}
      {(minDate || maxDate) && (
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5">
          <input
            type="date"
            value={urlDate ?? maxDate ?? ''}
            min={minDate}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            className="text-xs px-2 py-1.5 rounded border border-border bg-card/90 text-foreground backdrop-blur shadow focus:outline-none focus:border-sky-500"
          />
          {isHistorical && (
            <button
              onClick={() => setDate(maxDate ?? '')}
              className="px-2 py-1.5 rounded border border-border bg-card/90 text-muted-foreground hover:text-foreground text-xs backdrop-blur shadow transition-colors"
            >
              Latest
            </button>
          )}
        </div>
      )}

      {/* Legend (hidden on mobile) */}
      <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="text-muted-foreground mb-1 font-medium">Renewable %</p>
        {[
          { label: '80-100%', color: '#166534' },
          { label: '60-80%',  color: '#15803d' },
          { label: '40-60%',  color: '#4d7c0f' },
          { label: '20-40%',  color: '#92400e' },
          { label: '0-20%',   color: '#78350f' },
          { label: 'no data', color: '#374151' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="flex-1">
        <GenMap zones={data?.zones ?? []} selected={selected} onSelect={setSelected} />
      </div>

      <StaleBanner datasetKey="power" />

      {/* Side panel / bottom sheet */}
      {selected && (
        <div className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-card border-t border-border z-[1000] overflow-y-auto rounded-t-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none">
          <div className="flex justify-center pt-2 pb-1 sm:hidden">
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          <ZoneGenPanel
            zone={selected}
            item={byZone[selected] ?? null}
            onClose={() => setSelected(null)}
            selectedDate={urlDate}
          />
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}
