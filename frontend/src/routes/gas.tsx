import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'
import { api, type StorageLatestRow, type GasPaceStats, type CountryPaceRow, type StorageCountryRow, type GasPriceScatterRow } from '@/lib/api'
import { GasMap, type GasColorMode } from '@/components/gas/GasMap'
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

const DEFICIT_LEGEND = [
  { label: '<= -15 pp', color: '#7f1d1d' },
  { label: '-10 to -15', color: '#b91c1c' },
  { label: '-5 to -10', color: '#d97706' },
  { label: '-2 to -5', color: '#ca8a04' },
  { label: '-2 to +2', color: '#4b5563' },
  { label: '+2 to +5', color: '#4d7c0f' },
  { label: '+5 to +10', color: '#16a34a' },
  { label: '> +10 pp', color: '#15803d' },
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
  const [showFacilities, setShowFacilities] = useState(false)
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null)
  const [showRankings, setShowRankings] = useState(false)
  const [colorMode, setColorMode] = useState<GasColorMode>('fill')

  const { data, isLoading, error } = useQuery({
    queryKey: ['gas-map'],
    queryFn: api.gasMap,
  })

  const { data: flowsData } = useQuery({
    queryKey: ['gas-flows'],
    queryFn: api.gasFlows,
    enabled: showFlows,
  })

  const { data: facilitiesData } = useQuery({
    queryKey: ['gas-facilities'],
    queryFn: api.gasFacilities,
    enabled: showFacilities,
    staleTime: 24 * 60 * 60 * 1000,
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
  const legend = showFlows ? FLOW_LEGEND : colorMode === 'deficit' ? DEFICIT_LEGEND : FILL_LEGEND
  const legendTitle = showFlows ? 'Net flow GWh/d' : colorMode === 'deficit' ? 'vs 5yr avg (pp)' : 'Fill %'

  return (
    <div className="relative h-full flex">
      {/* Stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm">
        {euRow ? (
          <>
            <button
              className="contents"
              title="Open EU storage detail"
              onClick={() => { setShowRankings(false); setSelected('EU') }}
            >
              <StatChip label="EU fill" value={euRow.full_pct != null ? `${euRow.full_pct.toFixed(1)}%` : '--'} className="cursor-pointer hover:text-foreground" />
            </button>
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
            {data?.pipeline_offline_bcm != null && (
              <>
                <span className="hidden sm:block text-muted-foreground text-border">|</span>
                <span className="hidden sm:flex flex-col items-start">
                  <span className="text-[10px] text-muted-foreground leading-none mb-0.5">pipeline offline</span>
                  <span className="text-xs text-orange-400 font-medium">{data.pipeline_offline_bcm.toFixed(0)} bcm/yr</span>
                </span>
              </>
            )}
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Pace-to-target widget (top-left, below stat strip, hidden on mobile) */}
      {paceData?.eu && (
        <div className="hidden sm:block absolute top-14 left-3 z-[1000] w-64 bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg overflow-hidden">
          <PaceWidget eu={paceData.eu} />
        </div>
      )}

      {/* Physical flows + Rankings + color mode toggles (top-right) */}
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
          onClick={() => setColorMode((m) => m === 'fill' ? 'deficit' : 'fill')}
          title="Toggle between fill % and vs 5yr average coloring"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
            colorMode === 'deficit'
              ? 'bg-red-800 border-red-700 text-white'
              : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          vs 5yr avg
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
        <button
          onClick={() => setShowFacilities((v) => !v)}
          title="Show UGS storage facility locations"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
            showFacilities
              ? 'bg-emerald-700 border-emerald-600 text-white'
              : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Facilities
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
          colorMode={colorMode}
          showFlows={showFlows}
          flowRows={flowsData?.rows ?? []}
          selectedFlow={selectedFlow}
          onSelectFlow={setSelectedFlow}
          showFacilities={showFacilities}
          facilityRows={facilitiesData?.facilities ?? []}
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

type PaceChartMode = 'fill' | 'rate'

function PaceWidget({ eu }: { eu: GasPaceStats }) {
  const [chartMode, setChartMode] = useState<PaceChartMode>('fill')
  const onTrack = eu.on_track
  const statusColor = onTrack === true ? '#22c55e' : onTrack === false ? '#f87171' : '#6b7280'
  const statusLabel = onTrack === true ? 'On track' : onTrack === false ? 'Behind' : '--'

  const fillChartData = eu.history
    .filter((h) => h.gas_day >= (eu.current_date.slice(0, 7) + '-01').slice(0, 7) ||
      h.full_pct != null || h.projected != null)
    .map((h) => ({
      gas_day: h.gas_day.slice(5),
      fill: h.full_pct != null ? Number(h.full_pct.toFixed(1)) : null,
      avg5: h.avg5 != null ? Number(h.avg5.toFixed(1)) : null,
      projected: h.projected != null ? Number(h.projected.toFixed(1)) : null,
    }))

  // Injection rate chart: only actual days (no projected), TWh/d scale
  const rateChartData = eu.history
    .filter((h) => h.net_inj_gwh_d != null)
    .map((h) => ({
      gas_day: h.gas_day.slice(5),
      net_twh: h.net_inj_gwh_d != null ? h.net_inj_gwh_d / 1000 : null,
      seas_avg: h.seas_inj_avg != null ? h.seas_inj_avg / 1000 : null,
      band: h.seas_inj_p25 != null && h.seas_inj_p75 != null
        ? [h.seas_inj_p25 / 1000, h.seas_inj_p75 / 1000] as [number, number]
        : null,
    }))
    // Flatten band into recharts Area format
    .map((d) => ({
      gas_day: d.gas_day,
      net_twh: d.net_twh,
      seas_avg: d.seas_avg,
      band_lo: d.band ? d.band[0] : null,
      band_hi: d.band ? d.band[1] : null,
    }))

  const reqRate = eu.required_gwh_per_day
  const curRate = eu.current_rate_gwh_per_day
  const seasAvg = eu.seasonal_inj_avg_gwh_d
  const seasP25 = eu.seasonal_inj_p25_gwh_d
  const seasP75 = eu.seasonal_inj_p75_gwh_d
  const niDate = eu.next_interim_date
  const niPct = eu.next_interim_pct
  const niReq = eu.next_interim_required_gwh_d

  const vsNorm = curRate != null && seasAvg != null ? curRate - seasAvg : null
  const vsNormColor = vsNorm == null ? '#6b7280' : vsNorm >= 0 ? '#22c55e' : '#f87171'
  const niOnTrack = niReq != null && curRate != null ? curRate >= niReq : null
  const niColor = niOnTrack === true ? '#22c55e' : niOnTrack === false ? '#f87171' : '#6b7280'

  return (
    <div className="p-2">
      {/* Title row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">EU storage pace</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
          <div className="flex gap-0.5">
            {(['fill', 'rate'] as PaceChartMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setChartMode(m)}
                className={`px-1 py-0.5 rounded text-[9px] leading-none ${
                  m === chartMode
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground/60 hover:text-muted-foreground'
                }`}
              >
                {m === 'fill' ? '%' : 'Rate'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Nov 1 target */}
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-muted-foreground">90% by Nov 1</span>
        <span>
          <span className="text-muted-foreground">need </span>
          <span className="font-medium text-foreground">{reqRate != null ? `${(reqRate / 1000).toFixed(1)}` : '--'}</span>
          <span className="text-muted-foreground"> / pace </span>
          <span className="font-medium" style={{ color: statusColor }}>{curRate != null ? `${(curRate / 1000).toFixed(1)} TWh/d` : '--'}</span>
        </span>
      </div>
      {/* Next interim target */}
      {niDate && niPct && (
        <div className="flex items-center justify-between text-xs mb-0.5">
          <span style={{ color: niColor }}>{niPct}% by {niDate.slice(5)}</span>
          <span className="text-muted-foreground">{niReq != null ? `need ${(niReq / 1000).toFixed(1)} TWh/d` : ''}</span>
        </div>
      )}
      {/* Seasonal norm */}
      {seasAvg != null && (
        <div className="text-xs text-muted-foreground mb-1">
          vs norm{' '}
          <span style={{ color: vsNormColor }}>
            {vsNorm != null ? `${vsNorm >= 0 ? '+' : ''}${(vsNorm / 1000).toFixed(1)}` : '--'} TWh/d
          </span>
          {' '}(avg {(seasAvg / 1000).toFixed(1)}, p25-p75: {seasP25 != null ? (seasP25 / 1000).toFixed(1) : '--'}-{seasP75 != null ? (seasP75 / 1000).toFixed(1) : '--'})
        </div>
      )}

      {chartMode === 'fill' ? (
        <>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={fillChartData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
              <XAxis dataKey="gas_day" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} interval={Math.floor(fillChartData.length / 4)} />
              <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} width={24} domain={[0, 100]} tickFormatter={(v) => `${v as number}%`} ticks={[0, 25, 50, 75, 90, 100]} />
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
        </>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={rateChartData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
              <XAxis dataKey="gas_day" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} interval={Math.floor(rateChartData.length / 4)} />
              <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} width={26} tickFormatter={(v) => `${(v as number).toFixed(0)}`} unit=" T" />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 9 }}
                formatter={(v, name) => {
                  const n = typeof v === 'number' ? v : null
                  const labels: Record<string, string> = { net_twh: 'Net inj.', seas_avg: '5yr avg', band_lo: 'p25', band_hi: 'p75' }
                  return n != null ? [`${n.toFixed(2)} TWh/d`, labels[String(name)] ?? String(name)] : ['--', String(name)]
                }}
                labelFormatter={(l) => String(l)}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 2" strokeWidth={1} />
              {/* p25-p75 shaded band */}
              <Area dataKey="band_hi" stroke="none" fill="#334155" fillOpacity={0.4} dot={false} connectNulls legendType="none" />
              <Area dataKey="band_lo" stroke="none" fill="#0f172a" fillOpacity={1} dot={false} connectNulls legendType="none" />
              <Line type="monotone" dataKey="seas_avg" stroke="#64748b" strokeWidth={1} dot={false} strokeDasharray="2 2" connectNulls name="seas_avg" />
              <Line type="monotone" dataKey="net_twh" stroke="#38bdf8" strokeWidth={1.5} dot={false} connectNulls name="net_twh" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-sky-400" /><span>Net inj.</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-slate-500" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#64748b 0,#64748b 2px,transparent 2px,transparent 4px)' }} /><span>5yr avg</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-1 rounded-sm bg-slate-700/70" /><span>p25-p75</span></div>
          </div>
        </>
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

const COUNTRY_COLORS: Record<string, string> = {
  EU: '#60a5fa',   // blue
  DE: '#f59e0b',   // amber
  FR: '#ef4444',   // red
  NL: '#a78bfa',   // purple
  AT: '#34d399',   // green
  IT: '#fb923c',   // orange
  ES: '#facc15',   // yellow
}

const COMPARE_COUNTRIES: (keyof StorageCountryRow & string)[] = ['EU', 'DE', 'FR', 'NL', 'AT', 'IT', 'ES']

function buildEuProjection(rows: StorageCountryRow[]): { gas_day: string; EU_proj: number | null }[] {
  // Compute EU injection rate from last 7 days, project to Nov 1
  if (rows.length < 8) return []
  const last = rows[rows.length - 1]
  const week = rows[rows.length - 8]
  const euNow = last.EU
  const euWeekAgo = week.EU
  if (euNow == null || euWeekAgo == null) return []
  const rate7d = (euNow - euWeekAgo) / 7 // pct/day
  // Only project if currently injecting (positive rate)
  if (rate7d <= 0) return []
  const startDate = new Date(last.gas_day + 'T00:00:00Z')
  const targetDate = new Date(`${startDate.getUTCFullYear()}-11-01T00:00:00Z`)
  if (startDate >= targetDate) return []
  const result: { gas_day: string; EU_proj: number | null }[] = []
  let fill = euNow
  const d = new Date(startDate)
  while (d <= targetDate) {
    const dayStr = d.toISOString().slice(0, 10)
    result.push({ gas_day: dayStr, EU_proj: Math.min(fill, 100) })
    fill += rate7d
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return result
}

const SCATTER_YEAR_COLORS: Record<number, string> = {
  2020: '#94a3b8',
  2021: '#60a5fa',
  2022: '#f87171',
  2023: '#fbbf24',
  2024: '#4ade80',
  2025: '#a78bfa',
  2026: '#f97316',
}

function StoragePriceScatter() {
  const { data, isLoading } = useQuery({
    queryKey: ['gas-price-scatter'],
    queryFn: api.gasPriceScatter,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { byYear, years, corr } = useMemo(() => {
    const rows: GasPriceScatterRow[] = data?.rows ?? []
    const groups: Record<number, { fill_pct: number; ttf_eur_mwh: number }[]> = {}
    for (const r of rows) {
      const yr = parseInt(r.gas_day.slice(0, 4))
      if (!groups[yr]) groups[yr] = []
      groups[yr].push({ fill_pct: r.fill_pct, ttf_eur_mwh: r.ttf_eur_mwh })
    }
    const sortedYears = Object.keys(groups).map(Number).sort()
    // Pearson r (fill_pct, ttf)
    const xs = rows.map((r) => r.fill_pct)
    const ys = rows.map((r) => r.ttf_eur_mwh)
    let pearsonR: number | null = null
    if (xs.length > 5) {
      const mx = xs.reduce((a, b) => a + b) / xs.length
      const my = ys.reduce((a, b) => a + b) / ys.length
      const num = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0)
      const den = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0))
      pearsonR = den > 0 ? num / den : null
    }
    return { byYear: groups, years: sortedYears, corr: pearsonR }
  }, [data])

  if (isLoading) return <p className="text-xs text-muted-foreground py-4 text-center">Loading...</p>
  if (!data?.rows.length) return null

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-xs font-medium text-muted-foreground">Storage fill% vs TTF price</h3>
        {corr != null && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded" style={{ color: corr < -0.3 ? '#60a5fa' : '#64748b' }}>
            r = {corr.toFixed(2)}
          </span>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">
        Each dot = one day. Higher storage = lower gas price (merit order / carry cost).
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        {years.map((yr) => (
          <span key={yr} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: SCATTER_YEAR_COLORS[yr] ?? '#94a3b8', display: 'inline-block' }} />
            {yr}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 4, right: 8, bottom: 16, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="fill_pct"
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            label={{ value: 'EU fill %', position: 'insideBottom', offset: -12, fontSize: 9, fill: '#64748b' }}
          />
          <YAxis
            dataKey="ttf_eur_mwh"
            type="number"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{ value: '€/MWh', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#64748b' }}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: string | number | undefined) => {
              if (name === 'fill_pct') return [`${(v as number).toFixed(1)}%`, 'EU fill']
              if (name === 'ttf_eur_mwh') return [`${(v as number).toFixed(2)} €/MWh`, 'TTF']
              return [String(v), String(name)]
            }}
          />
          {years.map((yr) => (
            <Scatter
              key={yr}
              name={String(yr)}
              data={byYear[yr]}
              fill={SCATTER_YEAR_COLORS[yr] ?? '#94a3b8'}
              fillOpacity={0.55}
              r={2.5}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function StorageCountryCompare({ rows }: { rows: StorageCountryRow[] }) {
  // Build tick marks: show first of each month (including future months)
  const { combined, projTicks } = useMemo(() => {
    const proj = buildEuProjection(rows)
    const lastHistDate = rows[rows.length - 1]?.gas_day ?? ''
    const futureProj = proj.filter((p) => p.gas_day > lastHistDate)
    // Build combined dataset: historical rows get EU_proj=null; future rows have only EU_proj set
    const hist = rows.map((r) => ({ ...r, EU_proj: null as number | null }))
    // Patch last historical row to connect the line
    if (hist.length > 0 && proj.length > 0) {
      hist[hist.length - 1] = { ...hist[hist.length - 1], EU_proj: hist[hist.length - 1].EU }
    }
    const future = futureProj.map((p) => ({
      gas_day: p.gas_day,
      EU: null as number | null,
      EU_avg5: null as number | null,
      EU_proj: p.EU_proj,
      DE: null as number | null,
      FR: null as number | null,
      NL: null as number | null,
      AT: null as number | null,
      IT: null as number | null,
      ES: null as number | null,
    }))
    const all = [...hist, ...future]
    const ticks = all.filter((r) => r.gas_day.slice(8) === '01').map((r) => r.gas_day)
    return { combined: all, projTicks: ticks }
  }, [rows])

  const hasProjection = combined.some((r) => r.EU_proj != null && (r as {EU: number | null}).EU == null)

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">Storage fill % - last 365 days + EU projection to Nov 1</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <span className="w-5 h-px inline-block border-t-2 border-dashed border-[#334155]" /> EU 5yr avg
        </span>
        {hasProjection && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <span className="w-5 h-px inline-block border-t border-dashed border-blue-400 opacity-70" /> EU proj.
          </span>
        )}
        {COMPARE_COUNTRIES.map((cc) => (
          <span key={cc} className="text-[10px] text-muted-foreground flex items-center gap-1">
            <span className="w-3 h-0.5 rounded inline-block" style={{ background: COUNTRY_COLORS[cc] }} />
            {cc}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={combined} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="gas_day"
            ticks={projTicks}
            tickFormatter={(v: string) => v.slice(5, 7) + '/' + v.slice(2, 4)}
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
            domain={['auto', 'auto']}
            width={32}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            labelFormatter={(l) => String(l)}
            formatter={(v, name) => {
              const n = typeof v === 'number' ? v : null
              const label = String(name) === 'EU_avg5' ? 'EU avg5'
                : String(name) === 'EU_proj' ? 'EU (proj)' : String(name)
              return [n != null ? `${n.toFixed(1)}%` : '--', label]
            }}
          />
          {/* Winter target reference lines */}
          <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1}
            label={{ value: '90% (Nov)', position: 'insideTopRight', fontSize: 8, fill: '#22c55e' }}
          />
          <ReferenceLine y={75} stroke="#fbbf24" strokeDasharray="3 2" strokeWidth={1} opacity={0.6}
            label={{ value: '75%', position: 'insideTopRight', fontSize: 8, fill: '#fbbf24' }}
          />
          {/* EU 5yr avg as dashed reference */}
          <Line
            dataKey="EU_avg5"
            stroke="#334155"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
            name="EU_avg5"
          />
          {/* EU projected trajectory at current injection rate */}
          {hasProjection && (
            <Line
              dataKey="EU_proj"
              stroke="#60a5fa"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              strokeOpacity={0.7}
              dot={false}
              isAnimationActive={false}
              name="EU_proj"
              connectNulls
            />
          )}
          {COMPARE_COUNTRIES.map((cc) => (
            <Line
              key={cc}
              dataKey={cc}
              stroke={COUNTRY_COLORS[cc]}
              strokeWidth={cc === 'EU' ? 2 : 1.2}
              dot={false}
              isAnimationActive={false}
              name={cc}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">
        DE, FR, NL, AT, IT, ES + EU aggregate. EU dashed = 5yr avg. Blue dotted = EU projection at 7d injection rate.
      </p>
    </div>
  )
}

type RankingsView = 'table' | 'chart' | 'pace' | 'compare'

function StorageRankings({
  rows,
  onSelect,
  onClose,
}: {
  rows: StorageLatestRow[]
  onSelect: (cc: string) => void
  onClose: () => void
}) {
  const [sortKey, setSortKey] = useState<'full_pct' | 'yoy_pct' | 'vs_avg5_pct' | 'd7_pct' | 'injection'>('full_pct')
  const [view, setView] = useState<RankingsView>('table')

  const { data: paceData } = useQuery({
    queryKey: ['gas-pace-countries'],
    queryFn: api.gasPaceCountries,
    staleTime: 60 * 60 * 1000,
    enabled: view === 'pace',
  })

  const { data: compareData } = useQuery({
    queryKey: ['gas-country-compare'],
    queryFn: api.gasCountryCompare,
    staleTime: 60 * 60 * 1000,
    enabled: view === 'compare',
  })

  const sorted = useMemo(() => {
    return [...rows]
      .filter((r) => r.country !== 'EU')
      .sort((a, b) => {
        const av = a[sortKey] ?? -999
        const bv = b[sortKey] ?? -999
        return bv - av
      })
  }, [rows, sortKey])

  // For the comparison chart: sort by vs_avg5_pct ascending (most deficit first)
  const chartRows = useMemo(() => {
    return [...rows]
      .filter((r) => r.country !== 'EU' && r.vs_avg5_pct != null)
      .sort((a, b) => (a.vs_avg5_pct ?? 0) - (b.vs_avg5_pct ?? 0))
  }, [rows])

  const fmtPct = (v: number | null | undefined, d = 1) =>
    v != null ? `${v.toFixed(d)}%` : '--'

  const fmtDelta = (v: number | null | undefined) => {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-medium text-sm">Storage rankings</span>
        <div className="flex items-center gap-2">
          {/* Table/Chart toggle */}
          <div className="flex rounded border border-border overflow-hidden text-xs">
            {([['table', 'Table'], ['chart', 'vs avg'], ['pace', 'Pace'], ['compare', 'Trend']] as [RankingsView, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 transition-colors ${
                  view === v
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {view === 'chart' ? (
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-xs text-muted-foreground mb-2">vs 5yr average (pp) - deficit countries at top</p>
          <ResponsiveContainer width="100%" height={Math.max(chartRows.length * 18, 200)}>
            <BarChart data={chartRows} layout="vertical" margin={{ top: 2, right: 32, bottom: 2, left: 28 }}>
              <XAxis
                type="number"
                tick={{ fontSize: 9, fill: '#64748b' }}
                tickLine={false}
                tickFormatter={(v) => `${v > 0 ? '+' : ''}${(v as number).toFixed(0)}pp`}
              />
              <YAxis
                type="category"
                dataKey="country"
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                tickLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                formatter={(v: unknown) => {
                  const n = typeof v === 'number' ? v : null
                  return [n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}pp` : '--', 'vs 5yr avg']
                }}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <ReferenceLine x={0} stroke="#475569" strokeWidth={1} />
              <Bar dataKey="vs_avg5_pct" radius={[0, 2, 2, 0]} onClick={(d: unknown) => { const r = d as StorageLatestRow; if (r?.country) onSelect(r.country) }}>
                {chartRows.map((r) => (
                  <Cell
                    key={r.country}
                    fill={(r.vs_avg5_pct ?? 0) >= 0 ? '#4ade80' : '#f87171'}
                    opacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-1">Click a bar to open country detail</p>
        </div>
      ) : view === 'pace' ? (
        <div className="flex-1 overflow-y-auto">
          {!paceData ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-4 pt-3 pb-1">
                Current vs required injection rate (GWh/d) to reach 90% by {paceData.target_date}
              </p>
              <PaceComparisonChart rows={paceData.rows} onSelect={onSelect} />
              <p className="text-xs text-muted-foreground px-4 pb-2">Click a row to open country detail</p>
            </>
          )}
        </div>
      ) : view === 'compare' ? (
        <div className="flex-1 overflow-y-auto p-3">
          {!compareData ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
          ) : (
            <StorageCountryCompare rows={compareData.rows} />
          )}
          <StoragePriceScatter />
        </div>
      ) : (
        <>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="text-left px-4 py-1.5 font-normal text-muted-foreground">Country</th>
              <th className="text-right px-2 py-1.5 font-normal">
                <button onClick={() => setSortKey('full_pct')} className={sortKey === 'full_pct' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>Fill</button>
              </th>
              <th className="text-right px-2 py-1.5 font-normal">
                <button onClick={() => setSortKey('d7_pct')} className={sortKey === 'd7_pct' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>7d</button>
              </th>
              <th className="text-right px-2 py-1.5 font-normal">
                <button onClick={() => setSortKey('yoy_pct')} className={sortKey === 'yoy_pct' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>YoY</button>
              </th>
              <th className="text-right px-2 py-1.5 font-normal">
                <button onClick={() => setSortKey('vs_avg5_pct')} className={sortKey === 'vs_avg5_pct' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>vs avg</button>
              </th>
              <th className="text-right px-4 py-1.5 font-normal">
                <button onClick={() => setSortKey('injection')} className={sortKey === 'injection' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>GWh/d</button>
              </th>
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
                  style={{ color: r.d7_pct == null ? '#64748b' : r.d7_pct >= 0 ? '#4ade80' : '#f87171' }}
                >
                  {r.d7_pct != null ? `${r.d7_pct >= 0 ? '+' : ''}${r.d7_pct.toFixed(1)}pp` : '--'}
                </td>
                <td
                  className="px-2 py-1.5 text-right"
                  style={{ color: r.yoy_pct == null ? '#64748b' : r.yoy_pct >= 0 ? '#4ade80' : '#f87171' }}
                >
                  {fmtDelta(r.yoy_pct)}
                </td>
                <td
                  className="px-2 py-1.5 text-right"
                  style={{ color: r.vs_avg5_pct == null ? '#64748b' : r.vs_avg5_pct >= 0 ? '#4ade80' : '#f87171' }}
                >
                  {fmtDelta(r.vs_avg5_pct)}
                </td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">
                  {r.injection != null && r.injection > 0
                    ? `+${Math.round(r.injection)}`
                    : r.withdrawal != null && r.withdrawal > 0
                    ? `-${Math.round(r.withdrawal)}`
                    : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
        Click a row to open country detail
      </div>

      </> /* end table view */
      )}
    </div>
  )
}

function PaceComparisonChart({
  rows,
  onSelect,
}: {
  rows: CountryPaceRow[]
  onSelect: (cc: string) => void
}) {
  // Only countries with a positive pct_gap (still need to fill), sorted by most deficit first
  const chartData = useMemo(() => {
    return [...rows]
      .filter((r) => r.pct_gap != null && r.pct_gap > 0 && r.required_gwh_per_day != null)
      .sort((a, b) => (b.pct_gap ?? 0) - (a.pct_gap ?? 0))
      .map((r) => ({
        country: r.country,
        current: Math.max(0, r.current_rate_gwh_per_day ?? 0),
        required: r.required_gwh_per_day ?? 0,
        on_track: r.on_track,
        _raw: r,
      }))
  }, [rows])

  if (!chartData.length) return <div className="text-xs text-muted-foreground p-4">No pace data</div>

  return (
    <div className="px-3 py-1">
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 22, 200)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 48, bottom: 2, left: 28 }}>
          <XAxis
            type="number"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v) => `${(v as number).toFixed(0)}`}
            unit=" G"
          />
          <YAxis
            type="category"
            dataKey="country"
            tick={{ fontSize: 9, fill: '#94a3b8' }}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null
              const label = name === 'current' ? 'Current rate' : 'Required rate'
              return [n != null ? `${n.toFixed(0)} GWh/d` : '--', label]
            }}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar
            dataKey="required"
            fill="#334155"
            radius={[0, 2, 2, 0]}
            name="required"
            onClick={(d: unknown) => { const r = d as { country: string }; if (r?.country) onSelect(r.country) }}
          />
          <Bar
            dataKey="current"
            radius={[0, 2, 2, 0]}
            name="current"
            onClick={(d: unknown) => { const r = d as { country: string }; if (r?.country) onSelect(r.country) }}
          >
            {chartData.map((r) => (
              <Cell
                key={r.country}
                fill={r.on_track ? '#16a34a' : r.on_track === false ? '#dc2626' : '#64748b'}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 px-1">
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-[#334155]" /><span className="text-xs text-muted-foreground">Required</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-green-700" /><span className="text-xs text-muted-foreground">On track</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-red-700" /><span className="text-xs text-muted-foreground">Behind</span></div>
      </div>
    </div>
  )
}
