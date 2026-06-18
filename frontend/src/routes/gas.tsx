import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'
import { api, type StorageLatestRow, type GasPaceStats } from '@/lib/api'
import { GasMap } from '@/components/gas/GasMap'
import { CountryPanel } from '@/components/gas/CountryPanel'
import { GasFlowPanel } from '@/components/gas/GasFlowPanel'
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
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null)
  const [showRankings, setShowRankings] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['gas-map'],
    queryFn: api.gasMap,
  })

  const { data: flowsData } = useQuery({
    queryKey: ['gas-flows'],
    queryFn: api.gasFlows,
    enabled: showFlows,
  })

  const { data: paceData } = useQuery({
    queryKey: ['gas-pace'],
    queryFn: api.gasPace,
    staleTime: 60 * 60 * 1000,
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

      {/* Pace-to-target widget (below stat strip, hidden on mobile) */}
      {paceData?.eu && (
        <div className="hidden sm:block absolute top-14 left-1/2 -translate-x-1/2 z-[1000] w-72 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg overflow-hidden">
          <PaceWidget eu={paceData.eu} />
        </div>
      )}

      {/* Physical flows + Rankings toggles (top-right) */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <button
          onClick={() => { setShowRankings((v) => !v); setSelected(null) }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
            showRankings
              ? 'bg-amber-700 border-amber-600 text-white'
              : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Rankings
        </button>
        <button
          onClick={() => { setShowFlows((v) => !v); setSelectedFlow(null) }}
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
          selectedFlow={selectedFlow}
          onSelectFlow={setSelectedFlow}
        />
      </div>

      <StaleBanner datasetKey="gas" />

      {/* Side panel: bottom sheet on mobile, right-side on sm+ */}
      {(selected || (showFlows && selectedFlow) || showRankings) && (() => {
        const isFlowPanel = showFlows && selectedFlow != null
        const flowRow = isFlowPanel
          ? (flowsData?.rows ?? []).find((r) => r.country === selectedFlow) ?? null
          : null
        return (
          <div className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-card border-t border-border z-[1000] overflow-y-auto rounded-t-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none">
            <div className="flex justify-center pt-2 pb-1 sm:hidden">
              <div className="w-8 h-1 rounded-full bg-border" />
            </div>
            {isFlowPanel ? (
              <GasFlowPanel
                country={selectedFlow!}
                latestNet={flowRow?.net_gwh_d ?? null}
                latestEntry={flowRow?.entry_gwh_d ?? null}
                latestExit={flowRow?.exit_gwh_d ?? null}
                latestDate={flowRow?.period_date ?? null}
                onClose={() => setSelectedFlow(null)}
              />
            ) : showRankings ? (
              <StorageRankings
                rows={data?.rows ?? []}
                onSelect={(cc) => { setShowRankings(false); setSelected(cc) }}
                onClose={() => setShowRankings(false)}
              />
            ) : selected ? (
              <CountryPanel
                country={selected}
                latest={latestByCountry[selected] ?? null}
                onClose={() => setSelected(null)}
              />
            ) : null}
          </div>
        )
      })()}
    </div>
  )
}

function PaceWidget({ eu }: { eu: GasPaceStats }) {
  const onTrack = eu.on_track
  const statusColor = onTrack === true ? '#22c55e' : onTrack === false ? '#f87171' : '#6b7280'
  const statusLabel = onTrack === true ? 'On track' : onTrack === false ? 'Behind' : '--'

  const chartData = eu.history.map((h) => ({
    gas_day: h.gas_day.slice(5),
    fill: h.full_pct != null ? Number(h.full_pct.toFixed(1)) : null,
    avg5: h.avg5 != null ? Number(h.avg5.toFixed(1)) : null,
    projected: h.projected != null ? Number(h.projected.toFixed(1)) : null,
  }))

  const reqRate = eu.required_gwh_per_day
  const curRate = eu.current_rate_gwh_per_day
  const daysLeft = eu.days_to_target

  return (
    <div className="p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">90% target - Nov 1</span>
        <span className="text-xs font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="flex gap-3 mb-2 text-xs">
        <div>
          <span className="text-muted-foreground">Need </span>
          <span className="font-medium text-foreground">{reqRate != null ? `${(reqRate / 1000).toFixed(1)} TWh/d` : '--'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Pace </span>
          <span className="font-medium" style={{ color: statusColor }}>{curRate != null ? `${(curRate / 1000).toFixed(1)} TWh/d` : '--'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{daysLeft}d left</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <ComposedChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="gas_day"
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            interval={Math.floor(chartData.length / 4)}
          />
          <YAxis
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            width={24}
            domain={[0, 100]}
            tickFormatter={(v) => `${v as number}%`}
            ticks={[0, 25, 50, 75, 90, 100]}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 9 }}
            formatter={(v, name) => {
              const n = typeof v === 'number' ? v : null
              const label = name === 'fill' ? 'Actual' : name === 'avg5' ? '5yr avg' : 'Projected'
              return n != null ? [`${n.toFixed(1)}%`, label] : ['--', label]
            }}
            labelFormatter={(l) => String(l)}
          />
          <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} />
          <Line type="monotone" dataKey="avg5" stroke="#64748b" strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls name="avg5" />
          <Line type="monotone" dataKey="fill" stroke="#38bdf8" strokeWidth={1.5} dot={false} connectNulls name="fill" />
          <Line type="monotone" dataKey="projected" stroke={statusColor} strokeWidth={1.5} dot={false} strokeDasharray="3 2" connectNulls name="projected" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-sky-400" /><span>Actual</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-slate-500" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#64748b 0,#64748b 2px,transparent 2px,transparent 4px)' }} /><span>5yr avg</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-0.5" style={{ backgroundColor: statusColor }} /><span>Pace</span></div>
      </div>
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

function StorageRankings({
  rows,
  onSelect,
  onClose,
}: {
  rows: StorageLatestRow[]
  onSelect: (cc: string) => void
  onClose: () => void
}) {
  const [sortKey, setSortKey] = useState<'full_pct' | 'yoy_pct' | 'vs_avg5_pct'>('full_pct')

  const sorted = useMemo(() => {
    return [...rows]
      .filter((r) => r.country !== 'EU')
      .sort((a, b) => {
        const av = a[sortKey] ?? -999
        const bv = b[sortKey] ?? -999
        return bv - av
      })
  }, [rows, sortKey])

  const fmtPct = (v: number | null | undefined, d = 1) =>
    v != null ? `${v.toFixed(d)}%` : '--'

  const fmtDelta = (v: number | null | undefined) => {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`
  }

  const colBtn = (key: typeof sortKey, label: string) => (
    <button
      onClick={() => setSortKey(key)}
      className={`px-1.5 py-0.5 rounded text-xs ${
        sortKey === key
          ? 'bg-primary/20 text-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-medium text-sm">Storage rankings</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground mr-1">Sort:</span>
        {colBtn('full_pct', 'Fill %')}
        {colBtn('yoy_pct', 'YoY')}
        {colBtn('vs_avg5_pct', 'vs 5yr')}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="text-left px-4 py-1.5 font-normal text-muted-foreground">Country</th>
              <th className="text-right px-2 py-1.5 font-normal text-muted-foreground">Fill</th>
              <th className="text-right px-2 py-1.5 font-normal text-muted-foreground">YoY</th>
              <th className="text-right px-4 py-1.5 font-normal text-muted-foreground">vs avg</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.country}
                className="border-b border-border/40 hover:bg-secondary/50 cursor-pointer"
                onClick={() => onSelect(r.country)}
              >
                <td className="px-4 py-1.5 font-mono">{r.country}</td>
                <td className="px-2 py-1.5 text-right font-medium text-foreground">
                  {fmtPct(r.full_pct)}
                </td>
                <td
                  className="px-2 py-1.5 text-right"
                  style={{ color: r.yoy_pct == null ? '#64748b' : r.yoy_pct >= 0 ? '#4ade80' : '#f87171' }}
                >
                  {fmtDelta(r.yoy_pct)}
                </td>
                <td
                  className="px-4 py-1.5 text-right"
                  style={{ color: r.vs_avg5_pct == null ? '#64748b' : r.vs_avg5_pct >= 0 ? '#4ade80' : '#f87171' }}
                >
                  {fmtDelta(r.vs_avg5_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
        Click a row to open country detail
      </div>
    </div>
  )
}
