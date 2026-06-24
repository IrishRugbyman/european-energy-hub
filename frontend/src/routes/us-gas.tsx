import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'
import { api, type UsStorageLatestRow, type UsPaceStats } from '@/lib/api'
import { USGasMap, type UsGasColorMode, vsAvgColor, impliedFillColor } from '@/components/us-gas/USGasMap'

export const Route = createFileRoute('/us-gas')({
  component: UsGasDashboard,
})

const VS_AVG_LEGEND = [
  { label: '<= -20%', color: '#7f1d1d' },
  { label: '-10 to -20%', color: '#b91c1c' },
  { label: '-5 to -10%', color: '#d97706' },
  { label: '-2 to -5%', color: '#ca8a04' },
  { label: '-2 to +2%', color: '#4b5563' },
  { label: '+2 to +5%', color: '#4d7c0f' },
  { label: '+5 to +10%', color: '#16a34a' },
  { label: '> +10%', color: '#15803d' },
  { label: 'no data', color: '#374151' },
]

const IMPLIED_FILL_LEGEND = [
  { label: '< 40%', color: '#7f1d1d' },
  { label: '40-55%', color: '#b91c1c' },
  { label: '55-70%', color: '#d97706' },
  { label: '70-80%', color: '#ca8a04' },
  { label: '80-88%', color: '#65a30d' },
  { label: '88-95%', color: '#16a34a' },
  { label: '> 95%', color: '#15803d' },
  { label: 'no data', color: '#374151' },
]

function fmt(v: number | null | undefined, dec = 0, suffix = ''): string {
  if (v == null) return '--'
  return `${v >= 0 ? '' : ''}${v.toFixed(dec)}${suffix}`
}

function fmtSigned(v: number | null | undefined, dec = 0, suffix = ''): string {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(dec)}${suffix}`
}

function valueColor(v: number | null | undefined): string {
  if (v == null) return ''
  return v >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function UsGasDashboard() {
  const [selected, setSelected] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<UsGasColorMode>('vs-avg')

  const { data, isLoading, error } = useQuery({
    queryKey: ['us-gas-map'],
    queryFn: api.usGasMap,
    staleTime: 3 * 60 * 60 * 1000,
  })

  const { data: regionData } = useQuery({
    queryKey: ['us-gas-region', selected],
    queryFn: () => api.usGasRegion(selected!),
    enabled: selected != null && selected !== 'US-48',
    staleTime: 3 * 60 * 60 * 1000,
  })

  const { data: paceData } = useQuery({
    queryKey: ['us-gas-pace'],
    queryFn: api.usGasPace,
    staleTime: 3 * 60 * 60 * 1000,
  })

  const byRegion = useMemo(() => {
    const m: Record<string, UsStorageLatestRow> = {}
    for (const r of data?.rows ?? []) m[r.region] = r
    return m
  }, [data])

  const us48 = byRegion['US-48']
  const legend = colorMode === 'implied-fill' ? IMPLIED_FILL_LEGEND : VS_AVG_LEGEND
  const legendTitle = colorMode === 'implied-fill' ? 'Implied fill %' : 'vs 5yr avg'

  const panelRow = selected ? byRegion[selected] : null

  return (
    <div className="relative h-full flex">
      {/* Stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm">
        {us48 ? (
          <>
            <button
              className="contents"
              onClick={() => setSelected((s) => s === 'US-48' ? null : 'US-48')}
              title="Show US-48 summary"
            >
              <StatChip
                label="US-48 total"
                value={us48.value_bcf != null ? `${us48.value_bcf.toFixed(0)} Bcf` : '--'}
                className="cursor-pointer hover:text-foreground"
              />
            </button>
            <StatChip
              label="vs 5yr avg"
              value={fmtSigned(us48.vs_avg5_bcf, 0, ' Bcf')}
              positive={us48.vs_avg5_bcf != null && us48.vs_avg5_bcf >= 0}
            />
            <span className="hidden sm:block text-muted-foreground text-border">|</span>
            <StatChip
              className="hidden sm:flex"
              label="% vs avg"
              value={fmtSigned(us48.vs_avg5_pct, 1, '%')}
              positive={us48.vs_avg5_pct != null && us48.vs_avg5_pct >= 0}
            />
            <span className="hidden sm:block text-muted-foreground text-xs">{us48.week_date}</span>
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Color mode toggle */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <button
          onClick={() => setColorMode((m) => m === 'vs-avg' ? 'implied-fill' : 'vs-avg')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
            colorMode === 'implied-fill'
              ? 'bg-emerald-700 border-emerald-600 text-white'
              : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {colorMode === 'implied-fill' ? 'Implied fill' : 'vs 5yr avg'}
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0">
        <USGasMap
          rows={data?.rows ?? []}
          selected={selected}
          onSelect={setSelected}
          colorMode={colorMode}
        />
      </div>

      {/* Pace-to-target widget */}
      {paceData?.us48 && (
        <div className="hidden sm:block absolute top-16 left-3 z-[1000]">
          <UsPaceWidget pace={paceData.us48} />
        </div>
      )}

      {/* Legend */}
      <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="text-muted-foreground mb-1 font-medium">{legendTitle}</p>
        {legend.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Region rankings strip */}
      {!selected && data?.rows && (
        <RegionRankings rows={data.rows} colorMode={colorMode} onSelect={setSelected} />
      )}

      {/* Drill-down side panel */}
      {selected && panelRow && (
        <div className="absolute right-0 top-0 bottom-0 w-80 z-[1000] bg-card/95 backdrop-blur border-l border-border overflow-y-auto">
          <RegionPanel
            row={panelRow}
            history={regionData?.history ?? []}
            seasonal={regionData?.seasonal ?? []}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}

// ---------- US-48 pace-to-target widget ------------------------------------

function UsPaceWidget({ pace }: { pace: UsPaceStats }) {
  const {
    current_bcf,
    target_bcf,
    days_to_target,
    bcf_gap,
    current_rate_bcf_w,
    seasonal_rate_bcf_w,
    weeks_to_target,
    on_track,
    history,
  } = pace

  const statusColor = on_track === true ? '#4ade80' : on_track === false ? '#f87171' : '#94a3b8'
  const statusLabel = on_track === true ? 'On track' : on_track === false ? 'Behind' : 'Unknown'

  // Chart data: actual history + seasonal band + projected tail
  const chartData = history.map((p) => ({
    label: p.week_date.slice(0, 10),
    actual: p.value_bcf,
    avg5: p.avg5,
    min5: p.min5,
    max5: p.max5,
    projected: p.projected,
    // For Area band: stacked [min5, max5 - min5]
    bandBase: p.min5,
    bandSize: p.min5 != null && p.max5 != null ? p.max5 - p.min5 : null,
  }))

  const weeks_left = Math.round(days_to_target / 7)

  return (
    <div className="bg-card/90 backdrop-blur border border-border rounded-lg p-3 text-xs w-64">
      <div className="flex items-center justify-between mb-2">
        <span className="text-muted-foreground font-medium">US-48 injection pace</span>
        <span className="font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
      </div>

      {/* Key stats row */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div>
          <p className="text-muted-foreground text-[10px]">Current</p>
          <p className="font-semibold text-foreground">{current_bcf != null ? `${current_bcf.toFixed(0)} Bcf` : '--'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">Target (Nov 1)</p>
          <p className="font-semibold text-foreground">{target_bcf != null ? `${target_bcf.toFixed(0)} Bcf` : '--'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">Gap</p>
          <p className="font-semibold" style={{ color: bcf_gap != null && bcf_gap > 0 ? '#f87171' : '#4ade80' }}>
            {bcf_gap != null ? `${bcf_gap > 0 ? '+' : ''}${bcf_gap.toFixed(0)} Bcf` : '--'}
          </p>
        </div>
      </div>

      {/* Rate row */}
      <div className="flex items-center gap-3 mb-2 pb-2 border-b border-border">
        <div>
          <p className="text-muted-foreground text-[10px]">Weekly rate</p>
          <p className="font-medium text-foreground">{current_rate_bcf_w != null ? `${current_rate_bcf_w > 0 ? '+' : ''}${current_rate_bcf_w.toFixed(0)} Bcf/wk` : '--'}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px]">5yr avg rate</p>
          <p className="font-medium text-muted-foreground">{seasonal_rate_bcf_w != null ? `${seasonal_rate_bcf_w > 0 ? '+' : ''}${seasonal_rate_bcf_w.toFixed(0)} Bcf/wk` : '--'}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-muted-foreground text-[10px]">Weeks left</p>
          <p className="font-medium text-foreground">{weeks_left}</p>
        </div>
      </div>

      {weeks_to_target != null && (
        <p className="text-[10px] text-muted-foreground mb-2">
          At current pace: reaches target in{' '}
          <span style={{ color: statusColor }} className="font-semibold">{weeks_to_target.toFixed(1)} wks</span>
          {' '}({weeks_left} available)
        </p>
      )}

      {/* Pace chart */}
      <ResponsiveContainer width="100%" height={100}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            interval="preserveStartEnd"
            tickFormatter={(v: string) => v.slice(5, 10)}
          />
          <YAxis
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={30}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v, name) => {
              const n = typeof v === 'number' ? v : null
              return n != null ? [`${n.toFixed(0)} Bcf`, String(name ?? '')] as [string, string] : null
            }}
            labelFormatter={(l) => String(l)}
          />
          {/* 5yr band */}
          <Area dataKey="bandBase" stackId="band" fill="transparent" stroke="none" legendType="none" />
          <Area dataKey="bandSize" stackId="band" fill="#334155" fillOpacity={0.5} stroke="none" name="5yr range" />
          {/* 5yr avg line */}
          <Line dataKey="avg5" stroke="#64748b" strokeWidth={1} dot={false} strokeDasharray="3 2" name="5yr avg" connectNulls />
          {/* Actual Bcf */}
          <Line dataKey="actual" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="Actual" connectNulls />
          {/* Projected */}
          <Line dataKey="projected" stroke={statusColor} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Proj." connectNulls />
          {/* Nov 1 target line */}
          {target_bcf != null && (
            <ReferenceLine y={target_bcf} stroke="#f59e0b" strokeDasharray="3 2" strokeOpacity={0.7}
              label={{ value: 'target', position: 'right', fontSize: 8, fill: '#f59e0b' }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[9px] text-muted-foreground mt-1">Target = 5yr avg week-43 Bcf. Blue = EIA weekly. Projection at current weekly rate.</p>
    </div>
  )
}

// ---------- Region rankings strip ------------------------------------------

function RegionRankings({
  rows,
  colorMode,
  onSelect,
}: {
  rows: UsStorageLatestRow[]
  colorMode: UsGasColorMode
  onSelect: (r: string) => void
}) {
  const sorted = [...rows]
    .filter((r) => r.region !== 'US-48')
    .sort((a, b) => (b.vs_avg5_pct ?? 0) - (a.vs_avg5_pct ?? 0))

  return (
    <div className="hidden sm:flex absolute bottom-6 right-3 z-[1000] flex-col gap-1 bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2">
      <p className="text-[10px] text-muted-foreground font-medium mb-1 uppercase tracking-wide">Regions vs 5yr avg</p>
      {sorted.map((r) => {
        const color = colorMode === 'implied-fill'
          ? impliedFillColor(r.implied_fill_pct)
          : vsAvgColor(r.vs_avg5_pct)
        return (
          <button
            key={r.region}
            onClick={() => onSelect(r.region)}
            className="flex items-center gap-2 text-xs text-left hover:bg-muted/30 rounded px-1 -mx-1 py-0.5"
          >
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-foreground w-24 truncate">{r.region}</span>
            <span className="font-mono text-muted-foreground">{r.value_bcf?.toFixed(0) ?? '--'} Bcf</span>
            <span className={`font-mono text-xs ${valueColor(r.vs_avg5_bcf)}`}>
              {fmtSigned(r.vs_avg5_bcf, 0, '')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- Region drill-down panel ----------------------------------------

function RegionPanel({
  row,
  history,
  seasonal,
  onClose,
}: {
  row: UsStorageLatestRow
  history: Array<{ week_date: string; value_bcf: number | null }>
  seasonal: Array<{ week_of_year: number; avg5: number | null; min5: number | null; max5: number | null }>
  onClose: () => void
}) {
  // Build fan chart data: merge current year, last year, and seasonal band by week-of-year
  const currentYear = row.week_date ? new Date(row.week_date).getFullYear() : new Date().getFullYear()

  const histByYearWoy = useMemo(() => {
    const m: Record<string, { woy: number; value: number }[]> = {}
    for (const h of history) {
      const d = new Date(h.week_date)
      const year = String(d.getFullYear())
      const woy = isoWeek(d)
      if (!m[year]) m[year] = []
      if (h.value_bcf != null) m[year].push({ woy, value: h.value_bcf })
    }
    return m
  }, [history])

  const seasByWoy = useMemo(() => {
    const m: Record<number, typeof seasonal[0]> = {}
    for (const s of seasonal) m[s.week_of_year] = s
    return m
  }, [seasonal])

  const chartData = useMemo(() => {
    const weeks = Array.from({ length: 52 }, (_, i) => i + 1)
    return weeks.map((woy) => {
      const seas = seasByWoy[woy]
      const curYear = histByYearWoy[String(currentYear)]?.find((p) => p.woy === woy)
      const prevYear = histByYearWoy[String(currentYear - 1)]?.find((p) => p.woy === woy)
      return {
        woy,
        avg5: seas?.avg5 ?? null,
        min5: seas?.min5 ?? null,
        max5: seas?.max5 ?? null,
        current: curYear?.value ?? null,
        prev: prevYear?.value ?? null,
      }
    })
  }, [histByYearWoy, seasByWoy, currentYear])

  const isUS48 = row.region === 'US-48'

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{row.region}</h2>
          <p className="text-xs text-muted-foreground">EIA storage region</p>
          {row.week_date && (
            <p className="text-[10px] text-muted-foreground mt-0.5">Week of {row.week_date}</p>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Storage" value={`${fmt(row.value_bcf, 0)} Bcf`} />
        <MetricCard
          label="vs 5yr avg"
          value={fmtSigned(row.vs_avg5_bcf, 0, ' Bcf')}
          sub={row.vs_avg5_pct != null ? `(${fmtSigned(row.vs_avg5_pct, 1)}%)` : undefined}
          positive={row.vs_avg5_bcf != null && row.vs_avg5_bcf >= 0}
        />
        <MetricCard
          label="Week change"
          value={fmtSigned(row.week_change_bcf, 0, ' Bcf')}
          positive={row.week_change_bcf != null && row.week_change_bcf >= 0}
        />
        <MetricCard
          label="vs last year"
          value={fmtSigned(row.yoy_bcf, 0, ' Bcf')}
          positive={row.yoy_bcf != null && row.yoy_bcf >= 0}
        />
        {!isUS48 && (
          <MetricCard
            label="Implied fill"
            value={`${fmt(row.implied_fill_pct, 1)}%`}
            sub="(vs 5yr max)"
          />
        )}
        <MetricCard label="5yr avg" value={`${fmt(row.avg5_bcf, 0)} Bcf`} />
      </div>

      {/* Seasonal fan chart */}
      {chartData.some((d) => d.avg5 != null) && !isUS48 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Seasonal context (Bcf)</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="woy"
                tick={{ fontSize: 9, fill: '#6b7280' }}
                tickFormatter={(v) => `W${v}`}
                interval={7}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#6b7280' }}
                width={42}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
                formatter={(val, name) => [
                  val != null ? `${Number(val).toFixed(0)} Bcf` : '--',
                  name === 'current' ? String(currentYear)
                    : name === 'prev' ? String(currentYear - 1)
                    : name === 'avg5' ? '5yr avg'
                    : name === 'max5' ? '5yr max'
                    : '5yr min',
                ] as [string, string]}
                labelFormatter={(v) => `Week ${v}`}
              />
              {/* 5yr range band */}
              <Area
                dataKey="max5"
                stroke="none"
                fill="#1e3a5f"
                fillOpacity={0.6}
                isAnimationActive={false}
              />
              <Area
                dataKey="min5"
                stroke="none"
                fill="#0f172a"
                fillOpacity={1}
                isAnimationActive={false}
              />
              {/* 5yr average */}
              <Line
                dataKey="avg5"
                stroke="#64748b"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 3"
                isAnimationActive={false}
              />
              {/* Previous year */}
              <Line
                dataKey="prev"
                stroke="#78716c"
                strokeWidth={1}
                dot={false}
                strokeDasharray="2 2"
                isAnimationActive={false}
              />
              {/* Current year */}
              <Line
                dataKey="current"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 mt-1">
            {[
              { color: '#22d3ee', label: String(currentYear) },
              { color: '#78716c', label: String(currentYear - 1), dashed: true },
              { color: '#64748b', label: '5yr avg', dashed: true },
              { color: '#1e3a5f', label: '5yr range', fill: true },
            ].map(({ color, label, dashed, fill }) => (
              <div key={label} className="flex items-center gap-1">
                {fill ? (
                  <div className="w-6 h-2 rounded-sm" style={{ background: color }} />
                ) : (
                  <svg width="20" height="8">
                    <line
                      x1="0" y1="4" x2="20" y2="4"
                      stroke={color}
                      strokeWidth={dashed ? 1 : 2}
                      strokeDasharray={dashed ? '4 3' : undefined}
                    />
                  </svg>
                )}
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* US-48 full history sparkline */}
      {isUS48 && history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">US-48 storage history (Bcf)</p>
          <UsHistoryChart history={history} />
        </div>
      )}
    </div>
  )
}

// ---------- US-48 sparkline ------------------------------------------------

function UsHistoryChart({
  history,
}: {
  history: Array<{ week_date: string; value_bcf: number | null }>
}) {
  const data = history
    .filter((h) => h.value_bcf != null)
    .slice(-104) // ~2 years
    .map((h) => ({ date: h.week_date, value: h.value_bcf }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickFormatter={(v) => v.slice(0, 7)}
          interval={12}
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#6b7280' }}
          width={42}
          tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
          formatter={(val) => [`${Number(val).toFixed(0)} Bcf`, 'Storage'] as [string, string]}
          labelFormatter={(v) => `Week of ${v}`}
        />
        <Line dataKey="value" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------- Stat chip -------------------------------------------------------

function StatChip({
  label,
  value,
  positive,
  className = '',
}: {
  label: string
  value: string
  positive?: boolean
  className?: string
}) {
  const valueClass =
    positive === undefined
      ? 'text-foreground'
      : positive
      ? 'text-emerald-400'
      : 'text-red-400'
  return (
    <div className={`flex flex-col items-start ${className}`}>
      <span className="text-[10px] text-muted-foreground leading-none mb-0.5">{label}</span>
      <span className={`text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

// ---------- Metric card -----------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
}) {
  const valueClass =
    positive === undefined
      ? 'text-foreground'
      : positive
      ? 'text-emerald-400'
      : 'text-red-400'
  return (
    <div className="bg-muted/20 rounded-lg px-3 py-2">
      <p className="text-[10px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className={`text-sm font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ---------- ISO week helper ------------------------------------------------

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
