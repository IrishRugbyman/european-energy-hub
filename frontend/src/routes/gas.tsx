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

const FILL_LEGEND = [
  { label: '< 20',    color: '#7f1d1d' },
  { label: '20-35',   color: '#b91c1c' },
  { label: '35-50',   color: '#d97706' },
  { label: '50-65',   color: '#ca8a04' },
  { label: '65-75',   color: '#65a30d' },
  { label: '75-85',   color: '#16a34a' },
  { label: '> 85',    color: '#15803d' },
  { label: 'no data', color: '#374151' },
]

const FLOW_LEGEND = [
  { label: '> 80 import',   color: '#1d4ed8' },
  { label: '30-80 import',  color: '#3b82f6' },
  { label: '5-30 import',   color: '#7dd3fc' },
  { label: 'balanced',      color: '#4b5563' },
  { label: '5-30 export',   color: '#f59e0b' },
  { label: '30-80 export',  color: '#d97706' },
  { label: '> 80 export',   color: '#b45309' },
  { label: 'no data',       color: '#374151' },
]

function GasDashboard() {
  const [selected, setSelected] = useState<string | null>(null)
  const [showFlows, setShowFlows] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['gas-map'],
    queryFn: api.gasMap,
  })

  const { data: flowsData } = useQuery({
    queryKey: ['gas-flows'],
    queryFn: api.gasFlows,
    enabled: showFlows,
  })

  const latestByCountry: Record<string, StorageLatestRow> = {}
  for (const row of data?.rows ?? []) {
    latestByCountry[row.country] = row
  }

  const euRow = latestByCountry['EU']
  const legend = showFlows ? FLOW_LEGEND : FILL_LEGEND
  const legendTitle = showFlows ? 'Net flow GWh/d' : 'Fill %'

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

      {/* Physical flows toggle (top-right) */}
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => setShowFlows((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
            showFlows
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Physical flows
        </button>
      </div>

      {/* Legend (hidden on mobile, swaps between fill and flow) */}
      <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="text-muted-foreground mb-1 font-medium">{legendTitle}</p>
        {legend.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Map fills the whole space */}
      <div className="flex-1">
        <GasMap
          rows={data?.rows ?? []}
          selected={selected}
          onSelect={setSelected}
          showFlows={showFlows}
          flowRows={flowsData?.rows ?? []}
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
