import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type StorageLatestRow } from '@/lib/api'
import { GasMap } from '@/components/gas/GasMap'
import { CountryPanel } from '@/components/gas/CountryPanel'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/gas')({
  component: GasDashboard,
})

function GasDashboard() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['gas-map'],
    queryFn: api.gasMap,
  })

  const latestByCountry: Record<string, StorageLatestRow> = {}
  for (const row of data?.rows ?? []) {
    latestByCountry[row.country] = row
  }

  const euRow = latestByCountry['EU']

  return (
    <div className="relative h-full flex">
      {/* Stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {euRow ? (
          <>
            <StatChip label="EU fill" value={euRow.full_pct != null ? `${euRow.full_pct.toFixed(1)}%` : '--'} />
            <StatChip
              label="7d"
              value={euRow.d7_pct != null ? `${euRow.d7_pct >= 0 ? '+' : ''}${euRow.d7_pct.toFixed(1)}pp` : '--'}
              positive={euRow.d7_pct != null && euRow.d7_pct >= 0}
            />
            <span className="hidden sm:block text-muted-foreground text-border">|</span>
            <StatChip
              className="hidden sm:flex"
              label="vs 5yr avg"
              value={euRow.vs_avg5_pct != null ? `${euRow.vs_avg5_pct >= 0 ? '+' : ''}${euRow.vs_avg5_pct.toFixed(1)}pp` : '--'}
              positive={euRow.vs_avg5_pct != null && euRow.vs_avg5_pct >= 0}
            />
            <span className="hidden sm:block text-muted-foreground text-xs">{euRow.gas_day}</span>
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Map fills the whole space */}
      <div className="flex-1">
        <GasMap
          rows={data?.rows ?? []}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <StaleBanner datasetKey="gas" />

      {/* Side panel: bottom sheet on mobile, right-side on sm+ */}
      {selected && (
        <div className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-card border-t border-border z-[1000] overflow-y-auto rounded-t-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none">
          <div className="flex justify-center pt-2 pb-1 sm:hidden">
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          <CountryPanel
            country={selected}
            latest={latestByCountry[selected] ?? null}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}

function StatChip({
  label,
  value,
  positive,
  className,
}: {
  label: string
  value: string
  positive?: boolean
  className?: string
}) {
  return (
    <div className={`flex items-baseline gap-1 ${className ?? ''}`}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={
          positive === undefined
            ? 'text-foreground font-medium'
            : positive
              ? 'text-green-400 font-medium'
              : 'text-red-400 font-medium'
        }
      >
        {value}
      </span>
    </div>
  )
}
