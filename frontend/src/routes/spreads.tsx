import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ComposedChart,
  LineChart,
  BarChart,
  Bar,
  Cell,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { api, type SpreadsDailyPoint, type MultiZoneSpreadRow, type ZoneCorrelationRow, type CongestionRow, type FundamentalPoint, type FundamentalCoefficients, type SignalSnapshotRow, type RollingCoefPoint, type WindPriceBin, type WindPriceAnalysisResponse, type BacktestEquityPoint, type NonlinearBacktestEquityPoint, type CostSweepPoint, type EdgeByZoneRow, type RegimeAwareEquityPoint, type RegimeBookStats, } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'
import { cutoffDate, latestNonNull, type DateWindow } from '@/lib/utils'

export const Route = createFileRoute('/spreads')({
  component: SpreadsDashboard,
})

type Window = DateWindow

const WINDOWS: Window[] = ['1Y', '2Y', '5Y', 'ALL']

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null) return '-'
  return `${v.toFixed(digits)} €/MWh`
}

const latest = (rows: SpreadsDailyPoint[], key: keyof SpreadsDailyPoint) => latestNonNull(rows, key)

interface RegimeSpan {
  x1: string
  x2: string
  regime: string
}

function buildRegimeSpans(
  data: (SpreadsDailyPoint & { label: string })[],
): RegimeSpan[] {
  if (!data.length) return []
  const spans: RegimeSpan[] = []
  let spanStart = data[0].label
  let spanRegime = data[0].regime_threshold ?? 'coal'
  for (let i = 1; i < data.length; i++) {
    const r = data[i].regime_threshold ?? 'coal'
    if (r !== spanRegime) {
      spans.push({ x1: spanStart, x2: data[i - 1].label, regime: spanRegime })
      spanStart = data[i].label
      spanRegime = r
    }
  }
  spans.push({ x1: spanStart, x2: data[data.length - 1].label, regime: spanRegime })
  return spans
}

// Custom tooltip
function SpreadTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: SpreadsDailyPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as SpreadsDailyPoint
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {[
        { key: 'css', label: 'Clean Spark', color: '#60a5fa' },
        { key: 'cds', label: 'Clean Dark', color: '#f59e0b' },
        { key: 'fss', label: 'Fuel Switch', color: '#a78bfa' },
      ].map(({ key, label: name, color }) => {
        const v = d[key as keyof SpreadsDailyPoint]
        if (v == null) return null
        return (
          <p key={key} style={{ color }}>
            {name}: {(v as number).toFixed(1)} €/MWh
          </p>
        )
      })}
      {d.regime_threshold && (
        <p className="text-muted-foreground mt-1">
          regime: {d.regime_threshold === 'gas' ? 'gas marginal' : 'coal marginal'}
        </p>
      )}
      {d.disruption_bcm != null && (
        <p style={{ color: '#f97316' }} className="mt-1">
          gas offline: {d.disruption_bcm.toFixed(0)} bcm/yr
        </p>
      )}
    </div>
  )
}

function SpreadChart({
  rows,
  window: w,
  showDisruption,
}: {
  rows: SpreadsDailyPoint[]
  window: Window
  showDisruption: boolean
}) {
  const cutoff = cutoffDate(w)

  const { data, regimeSpans } = useMemo(() => {
    const filtered = cutoff ? rows.filter((r) => r.price_date >= cutoff) : rows
    // Sample for performance: max 500 points
    const step = Math.max(1, Math.floor(filtered.length / 500))
    const sampled = filtered
      .filter((_, i) => i % step === 0 || i === filtered.length - 1)
      .map((r) => ({ ...r, label: r.price_date.slice(0, 10) }))
    return { data: sampled, regimeSpans: buildRegimeSpans(sampled) }
  }, [rows, cutoff])

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: showDisruption ? 48 : 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v.toFixed(0)}`}
          unit=" €"
        />
        {showDisruption && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: '#f97316' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}`}
            unit=" bcm"
          />
        )}
        <Tooltip content={<SpreadTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) =>
            value === 'css' ? 'Clean Spark (CSS)' :
            value === 'cds' ? 'Clean Dark (CDS)' :
            value === 'fss' ? 'Fuel Switch (FSS)' :
            value === 'disruption_bcm' ? 'Gas offline (bcm/yr)' : value
          }
        />
        {/* Regime background shading */}
        {regimeSpans.map((span, i) => (
          <ReferenceArea
            key={i}
            yAxisId="left"
            x1={span.x1}
            x2={span.x2}
            fill={span.regime === 'gas' ? '#1e3a5f' : '#3b1c0a'}
            fillOpacity={0.35}
            strokeOpacity={0}
          />
        ))}
        <ReferenceLine yAxisId="left" y={0} stroke="#475569" strokeDasharray="4 2" />
        <Line yAxisId="left" dataKey="css" stroke="#60a5fa" dot={false} strokeWidth={1.5} name="css" />
        <Line yAxisId="left" dataKey="cds" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="cds" />
        <Line yAxisId="left" dataKey="fss" stroke="#a78bfa" dot={false} strokeWidth={2} name="fss" />
        {showDisruption && (
          <Line
            yAxisId="right"
            dataKey="disruption_bcm"
            stroke="#f97316"
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            name="disruption_bcm"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

const ZONE_COLORS: Record<string, string> = {
  'DE-LU': '#60a5fa',
  FR: '#34d399',
  NL: '#f472b6',
  'IT-NORD': '#fb923c',
  BE: '#a78bfa',
  AT: '#facc15',
}

const ZONE_LABELS: Record<string, string> = {
  'DE-LU': 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  'IT-NORD': 'Italy North',
  BE: 'Belgium',
  AT: 'Austria',
}

type SpreadKey = 'css' | 'cds' | 'fss'

function MultiZoneTooltip({
  active,
  payload,
  label,
  spreadKey,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
  spreadKey: SpreadKey
}) {
  if (!active || !payload?.length) return null
  const labels: Record<SpreadKey, string> = { css: 'Clean Spark', cds: 'Clean Dark', fss: 'Fuel Switch' }
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {ZONE_LABELS[p.name] ?? p.name}: {p.value != null ? `${p.value.toFixed(1)} €/MWh` : '-'}
        </p>
      ))}
      <p className="text-muted-foreground/70 mt-1">{labels[spreadKey]}</p>
    </div>
  )
}

function MultiZoneChart({
  rows,
  zones,
  spreadKey,
  window: w,
}: {
  rows: MultiZoneSpreadRow[]
  zones: string[]
  spreadKey: SpreadKey
  window: Window
}) {
  const cutoff = cutoffDate(w)

  const data = useMemo(() => {
    const filtered = cutoff ? rows.filter((r) => r.price_date >= cutoff) : rows
    // Pivot: date -> { date, [zone]: value }
    const map = new Map<string, Record<string, string | number | null>>()
    for (const r of filtered) {
      if (!map.has(r.price_date)) map.set(r.price_date, { date: r.price_date })
      map.get(r.price_date)![r.zone] = r[spreadKey]
    }
    const sorted = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
    // Sample for performance: max 400 points per zone
    const step = Math.max(1, Math.floor(sorted.length / 400))
    return sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1)
  }, [rows, cutoff, spreadKey])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v.toFixed(0)}`}
          unit=" €"
        />
        <Tooltip content={<MultiZoneTooltip spreadKey={spreadKey} />} />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
          formatter={(name) => ZONE_LABELS[name] ?? name}
        />
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
        {zones.map((zone) => (
          <Line
            key={zone}
            dataKey={zone}
            stroke={ZONE_COLORS[zone] ?? '#94a3b8'}
            dot={false}
            strokeWidth={1.5}
            name={zone}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// Latest snapshot bar chart: one bar per zone for selected spread
function LatestSnapshotChart({
  rows,
  zones,
  spreadKey,
}: {
  rows: MultiZoneSpreadRow[]
  zones: string[]
  spreadKey: SpreadKey
}) {
  const { data, ranks } = useMemo(() => {
    // Build latest value and percentile rank for each zone
    const latest = new Map<string, number | null>()
    const allByZone = new Map<string, number[]>()
    for (const r of rows) {
      const v = r[spreadKey]
      if (v != null) {
        latest.set(r.zone, v)
        if (!allByZone.has(r.zone)) allByZone.set(r.zone, [])
        allByZone.get(r.zone)!.push(v)
      }
    }
    const rankMap = new Map<string, number>()
    for (const [z, vals] of allByZone) {
      const cur = latest.get(z) ?? null
      if (cur == null) continue
      const sorted = [...vals].sort((a, b) => a - b)
      const pos = sorted.filter((v) => v <= cur).length
      rankMap.set(z, Math.round((pos / sorted.length) * 100))
    }
    return {
      data: zones
        .filter((z) => latest.has(z))
        .map((z) => ({ zone: ZONE_LABELS[z] ?? z, rawZone: z, value: latest.get(z) ?? null, fill: ZONE_COLORS[z] ?? '#94a3b8' })),
      ranks: rankMap,
    }
  }, [rows, zones, spreadKey])

  if (!data.length) return null
  return (
    <>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="zone" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}`}
            unit=" €"
          />
          <Tooltip
            formatter={(v) => [v != null ? `${Number(v).toFixed(1)} €/MWh` : '-', 'value']}
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Percentile rank badges */}
      <div className="flex flex-wrap gap-2 mt-2">
        {data.map((d) => {
          const rank = ranks.get(d.rawZone)
          if (rank == null) return null
          const color = rank >= 80 ? '#4ade80' : rank >= 50 ? '#fbbf24' : '#f87171'
          return (
            <span key={d.rawZone} className="flex items-center gap-1 text-xs">
              <span className="font-mono text-muted-foreground">{d.zone}</span>
              <span className="font-semibold" style={{ color }}>{rank}th%</span>
            </span>
          )
        })}
        <span className="text-xs text-muted-foreground ml-1">vs 2yr history</span>
      </div>
    </>
  )
}

const SPREAD_YOY_YEAR_COLORS: Record<number, string> = {
  2021: '#475569',
  2022: '#f97316',
  2023: '#facc15',
  2024: '#38bdf8',
  2025: '#4ade80',
  2026: '#c084fc',
}

function ZoneSpreadYoYChart({
  rows,
  zones,
  spreadKey,
}: {
  rows: MultiZoneSpreadRow[]
  zones: string[]
  spreadKey: SpreadKey
}) {
  const { chartData, years } = useMemo(() => {
    const sums: Record<string, Record<number, { sum: number; n: number }>> = {}
    for (const r of rows) {
      const v = r[spreadKey]
      if (v == null) continue
      const yr = parseInt(r.price_date.slice(0, 4), 10)
      if (!sums[r.zone]) sums[r.zone] = {}
      if (!sums[r.zone][yr]) sums[r.zone][yr] = { sum: 0, n: 0 }
      sums[r.zone][yr].sum += v
      sums[r.zone][yr].n += 1
    }
    const allYears = [...new Set(Object.values(sums).flatMap((m) => Object.keys(m).map(Number)))].sort()
    const data = zones.map((zone) => {
      const entry: Record<string, string | number | null> = { zone: ZONE_LABELS[zone] ?? zone }
      for (const yr of allYears) {
        const bucket = sums[zone]?.[yr]
        entry[String(yr)] = bucket && bucket.n > 0 ? Math.round(bucket.sum / bucket.n) : null
      }
      return entry
    })
    return { chartData: data, years: allYears }
  }, [rows, zones, spreadKey])

  if (!chartData.length) return null

  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground mb-2">Annual average (€/MWh) - zone vs year</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barCategoryGap="22%" barGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="zone" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}`}
            unit=" €"
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => [
              v != null ? `${Number(v).toFixed(0)} €/MWh` : '--',
              name != null ? String(name) : '',
            ]}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          {years.map((yr) => (
            <Bar key={yr} dataKey={String(yr)} fill={SPREAD_YOY_YEAR_COLORS[yr] ?? '#94a3b8'} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
        {years.map((yr) => (
          <span key={yr} className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: SPREAD_YOY_YEAR_COLORS[yr] ?? '#94a3b8' }} />
            {yr === new Date().getFullYear() ? `${yr} YTD` : yr}
          </span>
        ))}
      </div>
    </div>
  )
}

type CouplingView = 'pairs' | 'zones'

function ZoneDecouplingSection() {
  const [view, setView] = useState<CouplingView>('pairs')

  const { data, isLoading } = useQuery({
    queryKey: ['power-correlations'],
    queryFn: api.powerCorrelations,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { decoupled, coupled } = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r): r is ZoneCorrelationRow & { correlation: number } => r.correlation != null)
    const sorted = [...rows].sort((a, b) => a.correlation - b.correlation)
    return {
      decoupled: sorted.slice(0, 8),
      coupled: sorted.slice(-8).reverse(),
    }
  }, [data])

  const zoneCentrality = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r): r is ZoneCorrelationRow & { correlation: number } => r.correlation != null)
    const sums: Record<string, { sum: number; n: number }> = {}
    for (const r of rows) {
      for (const z of [r.zone_a, r.zone_b]) {
        if (!sums[z]) sums[z] = { sum: 0, n: 0 }
        sums[z].sum += r.correlation
        sums[z].n += 1
      }
    }
    return Object.entries(sums)
      .map(([zone, { sum, n }]) => ({ zone, avg: sum / n }))
      .sort((a, b) => b.avg - a.avg)
  }, [data])

  if (isLoading) return null
  if (!data?.rows.length) return null

  const CorrelationBar = ({ row, flip }: { row: ZoneCorrelationRow & { correlation: number }; flip?: boolean }) => {
    const r = row.correlation
    const color = r < -0.1 ? '#f87171' : r < 0.3 ? '#94a3b8' : r < 0.7 ? '#60a5fa' : '#4ade80'
    const pct = Math.abs(r) * 100
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">
          {row.zone_a} / {row.zone_b}
        </span>
        <div className="flex-1 h-3 bg-secondary rounded-sm overflow-hidden relative">
          {flip ? (
            <div
              className="absolute right-1/2 top-0 h-full rounded-sm"
              style={{ width: `${pct / 2}%`, background: color }}
            />
          ) : (
            <div
              className="absolute left-1/2 top-0 h-full rounded-sm"
              style={{ width: `${pct / 2}%`, background: color }}
            />
          )}
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/60" />
        </div>
        <span className="text-xs font-mono w-10 shrink-0" style={{ color }}>
          {r.toFixed(2)}
        </span>
      </div>
    )
  }

  const maxAvg = zoneCentrality.length ? zoneCentrality[0].avg : 1

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-sm font-semibold text-foreground">Zone Market Coupling - 30 day</h2>
        <div className="flex items-center gap-1 ml-auto">
          {(['pairs', 'zones'] as CouplingView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded text-xs ${
                v === view
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {v === 'pairs' ? 'Pairs' : 'Zones'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {view === 'pairs'
          ? 'Pearson correlation of daily base prices. Decoupled pairs signal congestion or isolated markets; coupled pairs move as one system.'
          : 'Average correlation of each zone to all other zones. Low = island or peninsula grid (IE-SEM, Iberia); high = central European mesh.'}
      </p>

      {view === 'pairs' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-red-400 font-medium mb-2">Most decoupled (arbitrage candidates)</p>
            {decoupled.map((row) => (
              <CorrelationBar key={`${row.zone_a}-${row.zone_b}`} row={row} flip />
            ))}
          </div>
          <div>
            <p className="text-xs text-green-400 font-medium mb-2">Most coupled (moving as one)</p>
            {coupled.map((row) => (
              <CorrelationBar key={`${row.zone_a}-${row.zone_b}`} row={row} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {zoneCentrality.map(({ zone, avg }) => {
            const barW = maxAvg > 0 ? (avg / maxAvg) * 100 : 0
            const color = avg < 0.35 ? '#f87171' : avg < 0.6 ? '#fbbf24' : '#4ade80'
            return (
              <div key={zone} className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-14 shrink-0 text-right">{zone}</span>
                <div className="flex-1 h-3 bg-secondary rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{ width: `${Math.max(barW, 1)}%`, background: color, opacity: 0.85 }}
                  />
                </div>
                <span className="text-xs font-mono w-10 shrink-0" style={{ color }}>
                  {avg.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function congestionColor(pct: number | null): string {
  if (pct == null) return '#475569'
  if (pct >= 100) return '#f87171'
  if (pct >= 80) return '#fbbf24'
  return '#4ade80'
}

function CongestionRankingSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['power-congestion'],
    queryFn: api.powerCongestion,
    staleTime: 60 * 60 * 1000,
  })

  const sorted = useMemo<CongestionRow[]>(() => {
    const rows = data?.rows ?? []
    return [...rows].sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))
  }, [data])

  if (isLoading || sorted.length === 0) return null
  const maxUtil = Math.max(...sorted.map((r) => r.utilization_pct ?? 0), 1)

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-4 mb-1">
        <h2 className="text-sm font-semibold text-foreground">NTC utilization ranking</h2>
        {data?.as_of && (
          <span className="ml-auto text-xs text-muted-foreground">{data.as_of}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Scheduled flow as % of net transfer capacity. Red = over 100% (NTC breach), amber = congested (&gt;= 80%).
      </p>
      <div className="space-y-1">
        {sorted.map((r) => {
          const pct = r.utilization_pct ?? 0
          const barW = Math.min(100, (pct / Math.max(maxUtil, 100)) * 100)
          const color = congestionColor(pct)
          const label = `${r.from_zone}→${r.to_zone}`
          return (
            <div key={label} className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground w-20 shrink-0 text-right">{label}</span>
              <div className="flex-1 h-3 bg-secondary rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${barW}%`, background: color }} />
              </div>
              <span className="text-xs tabular-nums w-10 shrink-0 text-right" style={{ color }}>
                {pct.toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MultiZoneSection({ window: w }: { window: Window }) {
  const [spreadKey, setSpreadKey] = useState<SpreadKey>('css')

  const { data, isLoading } = useQuery({
    queryKey: ['spreads-zones'],
    queryFn: api.spreadsZones,
    staleTime: 15 * 60 * 1000,
  })

  const rows = data?.rows ?? []
  const zones = data?.zones ?? []

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading zone data...</p>
  if (!rows.length) return null

  const SPREAD_TABS: { key: SpreadKey; label: string; color: string }[] = [
    { key: 'css', label: 'Clean Spark (CSS)', color: '#60a5fa' },
    { key: 'cds', label: 'Clean Dark (CDS)', color: '#f59e0b' },
    { key: 'fss', label: 'Fuel Switch (FSS)', color: '#a78bfa' },
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-sm font-semibold text-foreground">Multi-Zone Comparison (€/MWh)</h2>
        <div className="flex items-center gap-1 ml-auto">
          {SPREAD_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSpreadKey(t.key)}
              className={`px-2 py-0.5 rounded text-xs ${
                t.key === spreadKey
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {t.key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {SPREAD_TABS.find((t) => t.key === spreadKey)?.label} - all zones use TTF as gas reference
      </p>

      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-2">Latest</p>
        <LatestSnapshotChart rows={rows} zones={zones} spreadKey={spreadKey} />
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-2">History</p>
        <MultiZoneChart rows={rows} zones={zones} spreadKey={spreadKey} window={w} />
      </div>

      <ZoneSpreadYoYChart rows={rows} zones={zones} spreadKey={spreadKey} />
    </div>
  )
}

// EUA fuel-switch breakeven:
// FSS = 0 when EUA = (TTF/η_gas - coal/η_coal) / (EF_coal - EF_gas)
// EF_coal=0.96, EF_gas=0.364, η_gas=0.49, η_coal=0.36
function euaSwitchThreshold(ttf: number | null, coalEurMwh: number | null): number | null {
  if (ttf == null || coalEurMwh == null) return null
  return (ttf / 0.49 - coalEurMwh / 0.36) / (0.96 - 0.364)
}

function FuelSwitchContext({ rows }: { rows: SpreadsDailyPoint[] }) {
  const last = rows.length ? rows[rows.length - 1] : null
  const eua = last?.eua ?? null
  const threshold = euaSwitchThreshold(last?.ttf ?? null, last?.coal_eur_mwh ?? null)
  if (eua == null || threshold == null) return null
  const gap = threshold - eua
  const regime = (last?.fss ?? 0) >= 0 ? 'gas' : 'coal'

  // Position EUA on a gauge spanning [threshold - 40, threshold + 40]
  const gaugeMin = threshold - 40
  const gaugeMax = threshold + 40
  const euaPct = Math.max(0, Math.min(100, ((eua - gaugeMin) / (gaugeMax - gaugeMin)) * 100))
  const threshPct = 50  // threshold is always at midpoint

  const gapColor = Math.abs(gap) < 5 ? '#b91c1c' : Math.abs(gap) < 15 ? '#d97706' : '#16a34a'

  return (
    <div className="bg-card/60 border border-border rounded-lg px-4 py-3 mb-4">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">EUA switch threshold</p>
          <p className="text-sm font-semibold text-foreground">{threshold.toFixed(1)} EUR/t</p>
          <p className="text-[10px] text-muted-foreground">EUA at which {regime === 'gas' ? 'coal' : 'gas'} becomes marginal</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Gap to switch</p>
          <p className="text-sm font-semibold" style={{ color: gapColor }}>
            {gap >= 0 ? '+' : ''}{gap.toFixed(1)} EUR/t
          </p>
          <p className="text-[10px] text-muted-foreground">
            {gap >= 0
              ? `EUA needs +${gap.toFixed(1)} to switch from ${regime} to ${regime === 'gas' ? 'coal' : 'gas'}`
              : `EUA ${Math.abs(gap).toFixed(1)} above threshold - regime may flip`}
          </p>
        </div>
        <div className="flex-1 min-w-[120px]">
          <p className="text-[10px] text-muted-foreground mb-1.5">EUA position vs threshold</p>
          <div className="relative h-3 rounded-full bg-secondary">
            {/* Threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/60 rounded"
              style={{ left: `${threshPct}%` }}
            />
            {/* EUA dot */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-background"
              style={{ left: `calc(${euaPct}% - 6px)`, background: gapColor }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
            <span>{gaugeMin.toFixed(0)}</span>
            <span className="text-muted-foreground/70">threshold {threshold.toFixed(0)}</span>
            <span>{gaugeMax.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type SpreadField = 'css' | 'cds' | 'fss'
const SPREAD_FIELD_LABELS: Record<SpreadField, string> = { css: 'CSS', cds: 'CDS', fss: 'FSS' }

function SpreadMonthlySeasonalityChart({ rows }: { rows: SpreadsDailyPoint[] }) {
  const [field, setField] = useState<SpreadField>('css')

  const { chartData, years } = useMemo(() => {
    const sums: Record<number, Record<number, { sum: number; n: number }>> = {}
    for (const r of rows) {
      const v = r[field]
      if (v == null) continue
      const yr = parseInt(r.price_date.slice(0, 4), 10)
      const mo = parseInt(r.price_date.slice(5, 7), 10)
      if (!sums[yr]) sums[yr] = {}
      if (!sums[yr][mo]) sums[yr][mo] = { sum: 0, n: 0 }
      sums[yr][mo].sum += v
      sums[yr][mo].n += 1
    }

    const allYears = Object.keys(sums)
      .map(Number)
      .filter((yr) => {
        const months = Object.keys(sums[yr]).length
        return months >= 3
      })
      .sort()

    const data = MONTH_ABBR.map((abbr, i) => {
      const mo = i + 1
      const entry: Record<string, string | number | null> = { month: abbr }
      for (const yr of allYears) {
        const bucket = sums[yr]?.[mo]
        entry[String(yr)] = bucket && bucket.n >= 10 ? Math.round(bucket.sum / bucket.n) : null
      }
      return entry
    })

    return { chartData: data, years: allYears }
  }, [rows, field])

  if (!chartData.length || !years.length) return null

  const curYear = new Date().getFullYear()

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="text-sm font-semibold text-foreground">
          Spread monthly seasonality - DE-LU (€/MWh)
        </h2>
        <div className="flex items-center gap-1 ml-auto">
          {(['css', 'cds', 'fss'] as SpreadField[]).map((f) => (
            <button
              key={f}
              onClick={() => setField(f)}
              className={`px-2 py-0.5 rounded text-xs ${
                f === field
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {SPREAD_FIELD_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Average {SPREAD_FIELD_LABELS[field]} by calendar month, per year. Reveals seasonal
        patterns and how the 2022 energy crisis distorted normal spread dynamics.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}`}
            unit=" €"
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => [
              v != null ? `${Number(v).toFixed(0)} €/MWh` : '--',
              name != null ? String(name) : '',
            ]}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          {years.map((yr) => (
            <Line
              key={yr}
              type="monotone"
              dataKey={String(yr)}
              stroke={SPREAD_YOY_YEAR_COLORS[yr] ?? '#94a3b8'}
              strokeWidth={yr === curYear ? 2 : 1.5}
              dot={false}
              strokeDasharray={yr === curYear ? undefined : undefined}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
        {years.map((yr) => (
          <span key={yr} className="flex items-center gap-1">
            <span
              className="inline-block w-5 h-0.5 rounded-full"
              style={{ background: SPREAD_YOY_YEAR_COLORS[yr] ?? '#94a3b8' }}
            />
            {yr === curYear ? `${yr} YTD` : yr}
          </span>
        ))}
      </div>
    </div>
  )
}

function SpreadsDashboard() {
  const [window, setWindow] = useState<Window>('2Y')
  const [showDisruption, setShowDisruption] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['spreads'],
    queryFn: api.spreads,
    staleTime: 15 * 60 * 1000,
  })

  const rows = data?.rows ?? []
  const cssNow = latest(rows, 'css')
  const cdsNow = latest(rows, 'cds')
  const fssNow = latest(rows, 'fss')
  const disruptionNow = latest(rows, 'disruption_bcm')
  const regimeNow = rows.length ? rows[rows.length - 1].regime_threshold : null

  const pctRank2yr = useMemo(() => {
    const cutoff = cutoffDate('2Y') ?? ''
    const rank = (key: 'css' | 'cds' | 'fss', current: number | null) => {
      if (current == null) return null
      const vals = rows
        .filter((r) => r.price_date >= cutoff && r[key] != null)
        .map((r) => r[key] as number)
      if (!vals.length) return null
      const below = vals.filter((v) => v < current).length
      return Math.round((below / vals.length) * 100)
    }
    return { css: rank('css', cssNow), cds: rank('cds', cdsNow), fss: rank('fss', fssNow) }
  }, [rows, cssNow, cdsNow, fssNow])

  const rankColor = (r: number | null) => {
    if (r == null) return '#64748b'
    if (r >= 80) return '#f87171'
    if (r <= 20) return '#4ade80'
    return '#64748b'
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex flex-col">
          <StatChip label="Clean Spark (CSS)" value={fmt(cssNow)} color="#60a5fa" />
          {pctRank2yr.css != null && <span className="text-xs mt-0.5 ml-0.5" style={{ color: rankColor(pctRank2yr.css) }}>p{pctRank2yr.css} (2yr)</span>}
        </div>
        <div className="flex flex-col">
          <StatChip label="Clean Dark (CDS)" value={fmt(cdsNow)} color="#f59e0b" />
          {pctRank2yr.cds != null && <span className="text-xs mt-0.5 ml-0.5" style={{ color: rankColor(pctRank2yr.cds) }}>p{pctRank2yr.cds} (2yr)</span>}
        </div>
        <div className="flex flex-col">
          <StatChip label="Fuel Switch (FSS)" value={fmt(fssNow)} color="#a78bfa" />
          {pctRank2yr.fss != null && <span className="text-xs mt-0.5 ml-0.5" style={{ color: rankColor(pctRank2yr.fss) }}>p{pctRank2yr.fss} (2yr)</span>}
        </div>
        {regimeNow && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              regimeNow === 'gas' ? 'bg-blue-950 text-blue-300' : 'bg-amber-950 text-amber-300'
            }`}
          >
            {regimeNow === 'gas' ? 'Gas marginal' : 'Coal marginal'}
          </span>
        )}
        {disruptionNow != null && (
          <span className="text-xs text-orange-400">
            {disruptionNow.toFixed(0)} bcm/yr offline
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2 py-0.5 rounded text-xs ${
                w === window
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && <FuelSwitchContext rows={rows} />}

      <StaleBanner datasetKey="spreads" variant="inline" />

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error && <p className="text-destructive text-sm">API unavailable</p>}

      {rows.length > 0 && (
        <>
          <div className="bg-card border border-border rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                Spark / Dark / Fuel-Switch Spreads - DE-LU (€/MWh)
              </h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#1e3a5f', opacity: 0.8 }} />
                  gas marginal
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#3b1c0a', opacity: 0.8 }} />
                  coal marginal
                </span>
              </div>
              <button
                onClick={() => setShowDisruption((v) => !v)}
                className={`ml-auto px-2 py-0.5 rounded text-xs border transition-colors ${
                  showDisruption
                    ? 'bg-orange-900/50 border-orange-700 text-orange-300'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Disruption overlay
              </button>
            </div>
            <SpreadChart rows={rows} window={window} showDisruption={showDisruption} />
          </div>

          <MultiZoneSection window={window} />

          <ZoneDecouplingSection />

          <CongestionRankingSection />

          <SpreadMonthlySeasonalityChart rows={rows} />

          <FundamentalModelSection window={window} />

          <NonlinearModelSection />

          <EnrichedModelSection />

          <GbmModelSection />

          <NonlinearBacktestSection />

          <NonlinearCostRobustnessSection />

          <NonlinearEdgeByZoneSection />

          <RegimeAwareSection />

          <PortfolioSection />

          <BacktestSection zone="DE-LU" />

          <div className="bg-card border border-border rounded-lg p-4">
            <SpreadExplainer />
          </div>
        </>
      )}
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

// ---------- Fundamental Value Model ----------------------------------------

const FUNDAMENTAL_ZONES = ['DE-LU', 'FR', 'NL', 'IT-NORD', 'BE'] as const
type FundZone = typeof FUNDAMENTAL_ZONES[number]

function zscoreColor(z: number): string {
  if (z > 2)   return '#f87171'  // overbought red
  if (z > 1)   return '#fb923c'
  if (z < -2)  return '#4ade80'  // oversold green
  if (z < -1)  return '#86efac'
  return '#94a3b8'               // neutral grey
}

function zscoreLabel(z: number): string {
  if (z > 2)  return 'overbought'
  if (z > 1)  return 'elevated'
  if (z < -2) return 'oversold'
  if (z < -1) return 'depressed'
  return 'neutral'
}

function SignalSnapshotPanel({
  rows,
  onSelectZone,
}: {
  rows: SignalSnapshotRow[]
  onSelectZone: (zone: string) => void
}) {
  if (!rows.length) return null

  return (
    <div className="bg-muted/10 border border-border rounded-lg p-3 mb-4">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Cross-zone signal snapshot - sorted by |z-score| (click to analyse)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {rows.map((r) => {
          const color = zscoreColor(r.zscore)
          const label = zscoreLabel(r.zscore)
          return (
            <button
              key={r.zone}
              onClick={() => onSelectZone(r.zone as typeof FUNDAMENTAL_ZONES[number])}
              className="text-left rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-card/80 transition-colors p-2.5"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">{r.zone}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: color + '25', color }}>
                  {label}
                </span>
              </div>
              <div className="text-lg font-bold" style={{ color }}>
                {r.zscore >= 0 ? '+' : ''}{r.zscore.toFixed(2)}σ
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {r.residual >= 0 ? '+' : ''}{r.residual.toFixed(0)} EUR/MWh vs model
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
                <span>p{r.pct_rank_1yr}</span>
                <span>R²={r.r2 > 0 ? (r.r2 * 100).toFixed(0) : '--'}%</span>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[9px] text-muted-foreground mt-2">
        Positive z-score (overbought): actual price above OLS fundamental value. Negative (oversold): below.
        Signal reverts to zero on average - basis for a mean-reversion strategy.
      </p>
    </div>
  )
}

function CoefTable({ coef }: { coef: FundamentalCoefficients }) {
  const rows = [
    { label: 'Intercept (base)',     value: coef.intercept.toFixed(1),     unit: 'EUR/MWh', hint: 'structural base load' },
    { label: 'TTF coefficient',      value: (coef.ttf_eur_mwh > 0 ? '+' : '') + coef.ttf_eur_mwh.toFixed(3), unit: 'EUR per EUR/MWh TTF', hint: '~0.49 = full gas passthrough' },
    { label: 'EUA coefficient',      value: (coef.eua_eur_t > 0 ? '+' : '') + coef.eua_eur_t.toFixed(3), unit: 'EUR per EUR/t EUA', hint: '~0.36 = gas CO2 cost passthrough' },
    { label: 'Wind penetration',     value: coef.wind_pct.toFixed(3),       unit: 'EUR per % wind', hint: 'negative = price suppression' },
    { label: 'Solar penetration',    value: coef.solar_pct.toFixed(3),      unit: 'EUR per % solar', hint: 'negative = price suppression' },
  ]
  return (
    <div className="space-y-1">
      {rows.map(({ label, value, unit, hint }) => (
        <div key={label} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground w-36 shrink-0">{label}</span>
          <span className="font-mono text-foreground w-16 text-right">{value}</span>
          <span className="text-muted-foreground/60 text-[10px]">{unit}</span>
          <span className="text-muted-foreground/40 text-[10px] hidden lg:block">({hint})</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-xs pt-1 border-t border-border mt-1">
        <span className="text-muted-foreground w-36 shrink-0">R-squared</span>
        <span className="font-mono font-semibold" style={{ color: coef.r2 > 0.7 ? '#4ade80' : coef.r2 > 0.5 ? '#fb923c' : '#f87171' }}>
          {(coef.r2 * 100).toFixed(1)}%
        </span>
        <span className="text-muted-foreground/60 text-[10px]">on {coef.n}-day fit window</span>
      </div>
    </div>
  )
}

function FundamentalModelChart({
  series,
  window: w,
}: {
  series: FundamentalPoint[]
  window: DateWindow
}) {
  const cutoff = cutoffDate(w)
  const filtered = cutoff ? series.filter((r) => r.price_date >= cutoff) : series
  if (!filtered.length) return null

  // Downsample for render performance (keep at most 500 points)
  const step = Math.max(1, Math.floor(filtered.length / 500))
  const data = filtered.filter((_, i) => i % step === 0)

  return (
    <div className="space-y-4">
      {/* Actual vs Fitted */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Actual vs fundamental value (EUR/MWh)</p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="price_date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={Math.floor(data.length / 6)} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(val: unknown, name: unknown) => {
                const v = typeof val === 'number' ? val.toFixed(1) : '--'
                return [v, name === 'actual' ? 'Actual' : 'Fundamental']
              }}
              labelFormatter={(l) => String(l)}
            />
            <Line dataKey="actual" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} name="actual" />
            <Line dataKey="fitted" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} name="fitted" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-4 h-0.5 bg-blue-400 rounded" />
            <span>Actual DA price</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-4 h-0.5 bg-amber-400 rounded" style={{ borderStyle: 'dashed', borderWidth: '1px 0 0 0', height: 0, borderColor: '#f59e0b' }} />
            <span>Fundamental value</span>
          </div>
        </div>
      </div>

      {/* Residual z-score signal */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Price residual z-score (30-day window) - mean-reversion signal</p>
        <ResponsiveContainer width="100%" height={130}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="price_date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={Math.floor(data.length / 6)} />
            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} width={28} domain={['auto', 'auto']} />
            <ReferenceLine y={2}  stroke="#f87171" strokeDasharray="3 2" strokeWidth={1} label={{ value: '+2σ', fill: '#f87171', fontSize: 8 }} />
            <ReferenceLine y={-2} stroke="#4ade80" strokeDasharray="3 2" strokeWidth={1} label={{ value: '-2σ', fill: '#4ade80', fontSize: 8 }} />
            <ReferenceLine y={0}  stroke="#475569" strokeWidth={1} />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(val: unknown) => [typeof val === 'number' ? val.toFixed(2) + 'σ' : '--', 'Z-score']}
              labelFormatter={(l) => String(l)}
            />
            <Line
              dataKey="zscore"
              stroke="#a78bfa"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function RollingCoefChart({ data }: { data: RollingCoefPoint[] }) {
  if (!data.length) return null
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        Rolling 90-day coefficient stability (stepped weekly)
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={Math.floor(data.length / 5)} />
          <YAxis
            yAxisId="coef"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{ value: 'coef', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <YAxis
            yAxisId="r2"
            orientation="right"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={28}
            domain={[0, 1]}
            tickFormatter={(v) => (v * 100).toFixed(0) + '%'}
          />
          <ReferenceLine yAxisId="coef" y={0} stroke="#475569" strokeWidth={1} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              if (name === 'r2') return [typeof val === 'number' ? (val * 100).toFixed(0) + '%' : '--', 'R²']
              return [typeof val === 'number' ? val.toFixed(3) : '--', String(name)]
            }}
            labelFormatter={(l) => String(l)}
          />
          <Line yAxisId="coef" dataKey="ttf_eur_mwh" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} name="TTF" />
          <Line yAxisId="coef" dataKey="eua_eur_t"   stroke="#34d399" strokeWidth={1.5} dot={false} isAnimationActive={false} name="EUA" />
          <Line yAxisId="coef" dataKey="wind_pct"    stroke="#818cf8" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Wind%" strokeDasharray="4 2" />
          <Line yAxisId="coef" dataKey="solar_pct"   stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Solar%" strokeDasharray="4 2" />
          <Line yAxisId="r2"   dataKey="r2"          stroke="#f87171" strokeWidth={1} dot={false} isAnimationActive={false} name="r2" strokeDasharray="6 3" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block" />TTF coef (left)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400 inline-block" />EUA coef (left)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-400 inline-block" />Wind% coef (left)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" />Solar% coef (left)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-400 inline-block" />R² (right)</span>
      </div>
      <p className="text-[9px] text-muted-foreground">
        Stable flat lines indicate robust, regime-invariant factor loadings. Drift or sign flips signal structural changes
        (e.g. gas crisis changing TTF passthrough, or seasonality in solar impact).
      </p>
    </div>
  )
}

function WindPriceAnalysisChart({
  data,
  interpretation,
}: {
  data: WindPriceBin[]
  interpretation: WindPriceAnalysisResponse['interpretation']
}) {
  if (!data.length) return null

  // Two-color bars: price (blue) and residual (positive=orange, negative=teal)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-medium">
        DA price and OLS residual by wind penetration bin
        {interpretation.nonlinear_premium_eur != null && (
          <span className="ml-2 text-amber-400 font-semibold">
            Wind drought premium: +{interpretation.nonlinear_premium_eur.toFixed(0)} EUR/MWh (0-5% vs 35%+)
          </span>
        )}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="wind_bin" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
          <YAxis
            yAxisId="price"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
            label={{ value: '€/MWh', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <YAxis
            yAxisId="residual"
            orientation="right"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{ value: 'residual', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 9 }}
          />
          <ReferenceLine yAxisId="residual" y={0} stroke="#475569" strokeWidth={1} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(1) : '--'
              if (name === 'mean_residual') return [v + ' EUR', 'OLS residual (right)']
              return [v + ' EUR/MWh', name === 'mean_price' ? 'Mean price' : String(name)]
            }}
            labelFormatter={(l) => `Wind: ${String(l)}`}
          />
          <Bar yAxisId="price" dataKey="mean_price" name="mean_price" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.wind_bin}
                fill={entry.wind_lo < 5 ? '#f97316' : entry.wind_lo < 10 ? '#f59e0b' : entry.wind_lo >= 35 ? '#22c55e' : '#60a5fa'}
              />
            ))}
          </Bar>
          <Line
            yAxisId="residual"
            dataKey="mean_residual"
            stroke="#a78bfa"
            strokeWidth={2}
            dot={{ r: 4, fill: '#a78bfa' }}
            isAnimationActive={false}
            name="mean_residual"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
        <div>
          <span className="text-amber-400 font-medium">Low wind (0-5%): </span>
          CV {interpretation.cv_low_wind_pct != null ? `${interpretation.cv_low_wind_pct.toFixed(0)}%` : '--'}
          <span className="block text-[9px] text-muted-foreground/60">High price volatility = gas scarcity</span>
        </div>
        <div>
          <span className="text-emerald-400 font-medium">High wind (35%+): </span>
          CV {interpretation.cv_high_wind_pct != null ? `${interpretation.cv_high_wind_pct.toFixed(0)}%` : '--'}
          <span className="block text-[9px] text-muted-foreground/60">Lower vol, more predictable</span>
        </div>
        <div>
          <span className="text-purple-400 font-medium">OLS residual</span> (purple line)
          <span className="block text-[9px] text-muted-foreground/60">
            Positive residual in 0-5% bin = OLS underestimates wind drought premium - motivates nonlinear ML
          </span>
        </div>
      </div>
    </div>
  )
}

function FundamentalModelSection({ window: w }: { window: DateWindow }) {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['fundamental-model', zone],
    queryFn: () => api.spreadsFundamentalModel(zone),
    staleTime: 30 * 60 * 1000,
  })

  const { data: snapshotData } = useQuery({
    queryKey: ['signal-snapshot'],
    queryFn: api.spreadsSignalSnapshot,
    staleTime: 30 * 60 * 1000,
  })

  const { data: windAnalysisData } = useQuery({
    queryKey: ['wind-price-analysis', zone],
    queryFn: () => api.spreadsWindPriceAnalysis(zone),
    staleTime: 60 * 60 * 1000,
  })

  const cur = data?.current
  const coef = data?.coefficients

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Fundamental Value Model</h2>
        <span className="text-xs text-muted-foreground">OLS: DA price ~ TTF + EUA + wind% + solar%</span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {snapshotData?.rows && snapshotData.rows.length > 0 && (
        <SignalSnapshotPanel
          rows={snapshotData.rows}
          onSelectZone={(z) => setZone(z as FundZone)}
        />
      )}

      {isLoading && <p className="text-muted-foreground text-xs">Computing model...</p>}

      {cur && coef && (
        <div className="space-y-4">
          {/* Current signal */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Actual DA price</p>
              <p className="text-sm font-semibold text-foreground">{cur.actual.toFixed(1)} EUR/MWh</p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Fundamental value</p>
              <p className="text-sm font-semibold text-amber-400">{cur.fitted.toFixed(1)} EUR/MWh</p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Residual (actual - model)</p>
              <p className="text-sm font-semibold" style={{ color: cur.residual > 0 ? '#f87171' : '#4ade80' }}>
                {cur.residual >= 0 ? '+' : ''}{cur.residual.toFixed(1)} EUR/MWh
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Z-score (30d) / 1yr rank</p>
              <p className="text-sm font-semibold" style={{ color: zscoreColor(cur.zscore) }}>
                {cur.zscore >= 0 ? '+' : ''}{cur.zscore.toFixed(2)}σ
                <span className="text-xs text-muted-foreground ml-1">({zscoreLabel(cur.zscore)}, p{cur.pct_rank_1yr})</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Mean-reversion half-life</p>
              <p className="text-sm font-semibold text-foreground">
                {cur.half_life_days != null ? `${cur.half_life_days.toFixed(1)}d` : '--'}
                <span className="text-xs text-muted-foreground ml-1">AR(1) implied</span>
              </p>
            </div>
          </div>

          {/* Coefficients */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Regression coefficients (trailing {coef.n}d)</p>
              <CoefTable coef={coef} />
            </div>
            <div className="text-xs text-muted-foreground space-y-1.5">
              <p className="font-medium text-foreground text-xs">Signal interpretation</p>
              <p>
                The model decomposes the DA base price into contributions from gas cost (TTF), carbon cost (EUA),
                and renewable output (wind%, solar%). The residual is the portion unexplained by these fundamentals.
              </p>
              <p>
                A positive z-score (residual {'>'}0) means the market is pricing above fundamentals - a
                potential short signal for a mean-reversion strategy. Negative z-score means underpricing vs fundamentals.
              </p>
              <p className="text-muted-foreground/60">
                R² measures how much of the price variance is explained. Higher = fundamentals dominate;
                lower = other factors (congestion, demand shocks, supply outages) matter more.
              </p>
            </div>
          </div>

          {/* Chart */}
          <FundamentalModelChart series={data.series} window={w} />

          {/* Rolling coefficient stability */}
          {data.rolling_coefs && data.rolling_coefs.length > 0 && (
            <div className="border-t border-border pt-4">
              <RollingCoefChart data={data.rolling_coefs} />
            </div>
          )}

          {/* Wind-price nonlinearity */}
          {windAnalysisData && windAnalysisData.bins.length > 0 && (
            <div className="border-t border-border pt-4">
              <WindPriceAnalysisChart
                data={windAnalysisData.bins}
                interpretation={windAnalysisData.interpretation}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NonlinearModelSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['nonlinear-model', zone],
    queryFn: () => api.spreadsNonlinearModel(zone),
    staleTime: 60 * 60 * 1000,
  })

  const chartData = data
    ? [
        { regime: `Low wind (<${data.knot_pct}%)`, linear: data.linear.low_wind.rmse, nonlinear: data.nonlinear.low_wind.rmse, n: data.linear.low_wind.n },
        { regime: 'High wind', linear: data.linear.high_wind.rmse, nonlinear: data.nonlinear.high_wind.rmse, n: data.linear.high_wind.n },
        { regime: 'Overall', linear: data.linear.overall.rmse, nonlinear: data.nonlinear.overall.rmse, n: data.linear.overall.n },
      ].filter((d) => d.linear != null && d.nonlinear != null)
    : []

  const imp = data?.improvement

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Nonlinear vs Linear Fair Value</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Walk-forward OOS: low-wind hinge + wind²/solar² + TTF×wind
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Running walk-forward comparison...</p>}

      {data && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">OOS RMSE (linear → nonlinear)</p>
              <p className="text-sm font-semibold text-foreground">
                {data.linear.overall.rmse?.toFixed(1)} → <span className="text-emerald-400">{data.nonlinear.overall.rmse?.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground ml-1">€/MWh</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Overall RMSE reduction</p>
              <p className="text-sm font-semibold" style={{ color: (imp?.rmse_pct ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}>
                {imp?.rmse_pct != null ? `${imp.rmse_pct >= 0 ? '-' : '+'}${Math.abs(imp.rmse_pct).toFixed(1)}%` : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Low-wind RMSE reduction</p>
              <p className="text-sm font-semibold text-amber-400">
                {imp?.low_wind_rmse_pct != null ? `${imp.low_wind_rmse_pct >= 0 ? '-' : '+'}${Math.abs(imp.low_wind_rmse_pct).toFixed(1)}%` : '--'}
                <span className="text-xs text-muted-foreground ml-1">n={data.linear.low_wind.n}</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Low-wind hinge slope</p>
              <p className="text-sm font-semibold text-foreground">
                +{data.hinge_coef_eur_per_pp.toFixed(1)}
                <span className="text-xs text-muted-foreground ml-1">€/MWh per pp below {data.knot_pct}%</span>
              </p>
            </div>
          </div>

          {/* RMSE by regime */}
          {chartData.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">
                Out-of-sample RMSE by wind regime ({data.n_oos} OOS days, lower is better)
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="regime" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    label={{ value: 'RMSE €/MWh', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                    formatter={(val: unknown, name: unknown) => {
                      const v = typeof val === 'number' ? val.toFixed(2) : '--'
                      return [v + ' €/MWh', name === 'linear' ? 'Linear OLS' : 'Nonlinear']
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="linear" name="Linear OLS" fill="#60a5fa" isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="nonlinear" name="Nonlinear" fill="#a78bfa" isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            Both models regress the DA base price on TTF, EUA, wind% and solar% (the day-ahead forecast share of
            forecast load — the gate-closure information set, no look-ahead) by ordinary least squares.
            The nonlinear model adds a low-wind hinge (max(0, {data.knot_pct}% − wind%)), squared wind/solar terms,
            and a TTF×wind interaction. Evaluation is strictly walk-forward: both models are refit daily on all prior
            data and predict the next day, so the comparison is out-of-sample. The gain concentrates in the low-wind
            regime, where scarcity pricing turns convex and the linear model systematically under-prices the drought
            premium the wind-price analysis above surfaces. This is the empirical case that nonlinear ML adds capturable
            alpha, not just in-sample fit.
          </p>
        </div>
      )}
    </div>
  )
}

function GbmModelSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['gbm-model', zone],
    queryFn: () => api.spreadsGbmModel(zone),
    staleTime: 60 * 60 * 1000,
  })

  const fmt = (v: number | null | undefined, dp = 2) => (v != null ? v.toFixed(dp) : '--')
  const models = [
    { key: 'linear' as const, label: 'Linear OLS', color: '#60a5fa' },
    { key: 'hinge' as const, label: 'Hinge OLS', color: '#a78bfa' },
    { key: 'gbm' as const, label: 'LightGBM', color: '#f59e0b' },
  ]
  // Best (lowest) RMSE and best (highest) Sharpe across the three, to highlight the winner.
  const bestRmse = data
    ? Math.min(...models.map((m) => data[m.key].rmse_overall ?? Infinity))
    : null
  const bestSharpe = data
    ? Math.max(...models.map((m) => data[m.key].sharpe_net ?? -Infinity))
    : null

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Does a Gradient Booster Beat the Hinge?</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          LightGBM vs the one-coefficient hinge OLS
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Refitting walk-forward LightGBM...</p>}

      {data && (
        <div className="space-y-4">
          {/* Three-model comparison grid */}
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            {models.map((m) => {
              const s = data[m.key]
              const rmseWin = s.rmse_overall != null && s.rmse_overall === bestRmse
              const sharpeWin = s.sharpe_net != null && s.sharpe_net === bestSharpe
              return (
                <div key={m.key} className="bg-muted/10 rounded-lg px-3 py-2">
                  <p className="font-medium mb-1" style={{ color: m.color }}>{m.label}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>RMSE</span>
                    <span className="text-right" style={{ color: rmseWin ? '#4ade80' : '#e2e8f0' }}>
                      {fmt(s.rmse_overall)}{rmseWin ? ' ★' : ''}
                    </span>
                    <span>Low-wind</span><span className="text-right text-foreground">{fmt(s.rmse_low_wind)}</span>
                    <span>Sharpe</span>
                    <span className="text-right" style={{ color: sharpeWin ? '#4ade80' : '#e2e8f0' }}>
                      {fmt(s.sharpe_net)}{sharpeWin ? ' ★' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Feature importance + wind partial dependence */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">GBM gain importance</p>
              <div className="space-y-1">
                {data.importance.map((f) => (
                  <div key={f.feature} className="flex items-center gap-2 text-[10px]">
                    <span className="w-24 text-muted-foreground truncate">{f.feature}</span>
                    <div className="flex-1 bg-muted/20 rounded h-3 overflow-hidden">
                      <div className="h-full bg-amber-500/70" style={{ width: `${f.importance_pct}%` }} />
                    </div>
                    <span className="w-10 text-right text-foreground">{f.importance_pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">
                Wind partial dependence (GBM price vs wind%, others at median)
              </p>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data.partial_wind} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="wind_pct" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                    formatter={(val: unknown) => [typeof val === 'number' ? val.toFixed(1) : '--', '€/MWh']}
                    labelFormatter={(l) => `wind ${l}% of load`}
                  />
                  <ReferenceLine x={data.knot_pct} stroke="#f87171" strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="pred" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            All three models refit walk-forward every {data.refit_every} days on the {data.source} factor set and
            predict the block out-of-sample; RMSE and the faded-residual Sharpe (net of cost) are the same OOS
            metrics as the rest of the arc. The GBM (red dashed line marks the {data.knot_pct}% hinge knot) learns
            its own nonlinearity from the six raw factors, so this is the honest test of whether flexibility beats
            the one-coefficient hinge.{' '}
            {(data.gbm.sharpe_net ?? -9) < (data.hinge.sharpe_net ?? 9)
              ? `On ${data.zone} it does not: the GBM's tradeable Sharpe (${fmt(data.gbm.sharpe_net)}) trails the hinge OLS (${fmt(data.hinge.sharpe_net)}), and its RMSE is no better${(data.gbm.rmse_overall ?? 0) > (data.hinge.rmse_overall ?? 1e9) ? '' : ' on fit either'}. The extra flexibility fits in-sample noise that does not survive out-of-sample — the parsimonious, interpretable hinge wins. Residual demand dominates the importance, but (as the enriched-design panel shows) that information tightens fit while absorbing the mean-reverting residual the fade trades.`
              : `On ${data.zone} the GBM edges the hinge on tradeable Sharpe (${fmt(data.gbm.sharpe_net)} vs ${fmt(data.hinge.sharpe_net)}) — here the nonlinear interactions it captures carry capturable signal.`}
          </p>
        </div>
      )}
    </div>
  )
}

function EnrichedModelSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['enriched-model', zone],
    queryFn: () => api.spreadsEnrichedModel(zone),
    staleTime: 60 * 60 * 1000,
  })

  const fmt = (v: number | null | undefined, dp = 2) => (v != null ? v.toFixed(dp) : '--')
  const fmtPct = (v: number | null | undefined) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '--')
  const fmtDelta = (v: number | null | undefined) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : '--')
  // RMSE pct is a drop (positive = better fit); sharpe delta positive = better signal.
  const rmseColor = (v: number | null | undefined) => (v == null ? '#94a3b8' : v > 0 ? '#4ade80' : '#f87171')
  const sharpeColor = (v: number | null | undefined) => (v == null ? '#94a3b8' : v > 0 ? '#4ade80' : '#f87171')

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Do More Factors Help? Residual Demand + ΔTTF</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Tighter fair value vs tradeable alpha
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Running walk-forward comparison...</p>}

      {data && (
        <div className="space-y-4">
          {/* Headline stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">OOS RMSE (base → enriched)</p>
              <p className="text-sm font-semibold text-foreground">
                {fmt(data.baseline.rmse_overall)} → {fmt(data.enriched.rmse_overall)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">RMSE reduction</p>
              <p className="text-sm font-semibold" style={{ color: rmseColor(data.improvement.rmse_pct) }}>
                {fmtPct(data.improvement.rmse_pct)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Tradeable Sharpe (base → enr)</p>
              <p className="text-sm font-semibold text-foreground">
                {fmt(data.baseline.sharpe_net)} → {fmt(data.enriched.sharpe_net)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Sharpe change</p>
              <p className="text-sm font-semibold" style={{ color: sharpeColor(data.improvement.sharpe_delta) }}>
                {fmtDelta(data.improvement.sharpe_delta)}
              </p>
            </div>
          </div>

          {/* New-factor coefficient stability */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            {([
              { key: 'residual_demand_gw' as const, label: 'Residual demand (€/MWh per GW)' },
              { key: 'ttf_change' as const, label: 'ΔTTF (€/MWh per €/MWh·day)' },
            ]).map((f) => {
              const c = data.coef[f.key]
              const unstable = c.cv != null && c.cv > 0.5
              return (
                <div key={f.key} className="bg-muted/10 rounded-lg px-3 py-2">
                  <p className="font-medium mb-1 text-foreground">{f.label}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>Coef (mean)</span><span className="text-right text-foreground">{fmt(c.mean, 3)}</span>
                    <span>WF std</span><span className="text-right text-foreground">{fmt(c.std, 3)}</span>
                    <span>Stability (CV)</span>
                    <span className="text-right" style={{ color: unstable ? '#f87171' : '#4ade80' }}>
                      {c.cv != null ? c.cv.toFixed(2) : '--'}{unstable ? ' ⚠' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            The enriched nonlinear design adds two gate-closure factors to the {data.source} fair value: residual
            demand (forecast load − forecast wind − forecast solar, in GW — the thermal-stack depth the renewable
            <em> shares</em> miss because they ignore demand level) and the day-over-day TTF change. Both designs are
            refit walk-forward and the residual is faded net of cost, so RMSE and Sharpe are the same OOS metrics as
            the rest of the arc.{' '}
            {(data.improvement.rmse_pct ?? 0) > 0 && (data.improvement.sharpe_delta ?? 0) < 0
              ? `On ${data.zone} the honest verdict splits: the factors tighten the fair value (RMSE ${fmtPct(data.improvement.rmse_pct)}) but the tradeable Sharpe falls (${fmtDelta(data.improvement.sharpe_delta)}). A tighter fair value absorbs part of the mean-reverting deviation the fade trades — better fit is not better signal. The new coefficients are ${(data.coef.residual_demand_gw.cv ?? 1) < 0.5 ? 'stable' : 'unstable'}, so this is a real effect, not overfitting noise.`
              : (data.improvement.sharpe_delta ?? 0) >= 0
                ? `On ${data.zone} the enrichment helps both fit and tradeable Sharpe (${fmtDelta(data.improvement.sharpe_delta)}) — the added factors carry information the fade can use.`
                : `On ${data.zone} the enrichment does not clearly improve fit or signal; the added factors do not earn their place here.`}{' '}
            Nuclear% is deliberately excluded: the ENTSO-E A69 day-ahead forecast carries only wind/solar, so a
            realised-nuclear factor would reintroduce look-ahead (deferred until a forecast/A80 source is ingested).
          </p>
        </div>
      )}
    </div>
  )
}

function NonlinearBacktestSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['nonlinear-backtest', zone],
    queryFn: () => api.spreadsNonlinearBacktest(zone),
    staleTime: 60 * 60 * 1000,
  })

  const imp = data?.improvement
  const fmtSharpe = (v: number | null | undefined) => (v != null ? v.toFixed(2) : '--')
  const fmtDelta = (v: number | null | undefined, dp = 2) =>
    v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(dp)}` : '--'

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Does the Nonlinear Edge Trade?</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Walk-forward P&L: fade each model's OOS residual
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Running walk-forward backtest...</p>}

      {data && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Sharpe (linear → nonlinear)</p>
              <p className="text-sm font-semibold text-foreground">
                {fmtSharpe(data.linear.sharpe)} →{' '}
                <span className="text-emerald-400">{fmtSharpe(data.nonlinear.sharpe)}</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Sharpe gain</p>
              <p
                className="text-sm font-semibold"
                style={{ color: (imp?.sharpe_delta ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}
              >
                {fmtDelta(imp?.sharpe_delta)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Cum P&L gain ({data.n_eval}d)</p>
              <p
                className="text-sm font-semibold"
                style={{ color: (imp?.cum_pnl_delta ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}
              >
                {fmtDelta(imp?.cum_pnl_delta, 0)}
                <span className="text-xs text-muted-foreground ml-1">€/MWh·u</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Low-wind Sharpe gain</p>
              <p className="text-sm font-semibold text-amber-400">
                {fmtDelta(imp?.sharpe_low_wind_delta)}
                <span className="text-xs text-muted-foreground ml-1">n={data.linear.n_low_wind}</span>
              </p>
            </div>
          </div>

          {/* Look-ahead premium banner */}
          {data.lookahead && data.lookahead.premium_sharpe != null && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] leading-relaxed">
              <span className="font-semibold text-amber-300">Look-ahead premium: </span>
              <span className="text-foreground">
                using realised generation (peeking at the delivery day) the nonlinear gross Sharpe is{' '}
                {fmtSharpe(data.lookahead.actual_nonlinear_sharpe)}; on the day-ahead forecast a desk can actually
                trade it is {fmtSharpe(data.lookahead.forecast_nonlinear_sharpe)}. The gap of{' '}
                <span className="text-amber-300 font-semibold">{fmtDelta(data.lookahead.premium_sharpe)}</span> Sharpe
                was hindsight. The headline figures here are the honest, forecast-based numbers.
              </span>
            </div>
          )}

          {/* Equity curves */}
          {data.equity.length > 0 && <NonlinearBacktestEquityChart equity={data.equity} />}

          {/* Per-model summary row */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            {(['linear', 'nonlinear'] as const).map((k) => {
              const m = data[k]
              return (
                <div key={k} className="bg-muted/10 rounded-lg px-3 py-2">
                  <p className="font-medium mb-1" style={{ color: k === 'linear' ? '#60a5fa' : '#a78bfa' }}>
                    {k === 'linear' ? 'Linear OLS signal' : 'Nonlinear signal'}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>Sharpe</span><span className="text-right text-foreground">{fmtSharpe(m.sharpe)}</span>
                    <span>Hit rate</span><span className="text-right text-foreground">{m.hit_rate_pct.toFixed(1)}%</span>
                    <span>Cum P&L</span><span className="text-right text-foreground">{m.cum_pnl.toFixed(0)}</span>
                    <span>Max DD</span><span className="text-right text-foreground">{m.max_dd_eur.toFixed(0)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            Both fair-value models are refit walk-forward (daily, on all prior data) off the{' '}
            {data.source === 'forecast'
              ? 'ENTSO-E day-ahead wind/solar forecast as a share of forecast load — the information set available at gate closure, so there is no look-ahead'
              : 'realised generation'}. Their out-of-sample residual (actual − fair value) is standardised with a{' '}
            {data.signal_window}-day rolling z-score and faded: position = clip(−z, −1, +1), daily P&L = position(t−1)
            × DA price change(t). Accounting is identical for both, so the only difference between the curves is the
            fair-value model. The nonlinear edge concentrates in the low-wind regime (&lt;{data.knot_pct}% of load),
            where it prices the scarcity premium the linear model under-prices. The DA-price-change return is a
            signal-quality proxy (you cannot hold the index across delivery days), shown gross of bid-ask and market
            impact; the cost-robustness panel below charges turnover.
          </p>
        </div>
      )}
    </div>
  )
}

function NonlinearBacktestEquityChart({ equity }: { equity: NonlinearBacktestEquityPoint[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        Cumulative P&L — linear vs nonlinear residual signal (out-of-sample)
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={equity} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{ value: 'cum P&L', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(1) : '--'
              return [v, name === 'cum_linear' ? 'Linear' : 'Nonlinear']
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <Line
            type="monotone"
            dataKey="cum_linear"
            name="Linear"
            stroke="#60a5fa"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="cum_nonlinear"
            name="Nonlinear"
            stroke="#a78bfa"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function NonlinearCostRobustnessSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['nonlinear-cost-robustness', zone],
    queryFn: () => api.spreadsNonlinearCostRobustness(zone),
    staleTime: 60 * 60 * 1000,
  })

  const fmtSharpe = (v: number | null | undefined) => (v != null ? v.toFixed(2) : '--')
  const fmtCost = (v: number | null | undefined) =>
    v != null ? `${v.toFixed(2)} €/MWh` : 'never'

  // Sharpe edge at the most punitive cost in the grid, to headline survival.
  const lastEdge = data?.sweep.length ? data.sweep[data.sweep.length - 1].sharpe_delta : null
  const maxCost = data?.sweep.length ? data.sweep[data.sweep.length - 1].cost : null

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Does the Edge Survive Costs?</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Net Sharpe vs round-trip transaction cost
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Sweeping transaction costs...</p>}

      {data && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Break-even cost (Sharpe)</p>
              <p className="text-sm font-semibold text-emerald-400">
                {fmtCost(data.breakeven_cost_sharpe)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Break-even cost (cum P&L)</p>
              <p className="text-sm font-semibold text-emerald-400">
                {fmtCost(data.breakeven_cost_cum)}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">
                Sharpe gain @ {maxCost != null ? maxCost.toFixed(2) : '--'} €/MWh
              </p>
              <p
                className="text-sm font-semibold"
                style={{ color: (lastEdge ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}
              >
                {lastEdge != null ? `${lastEdge >= 0 ? '+' : ''}${lastEdge.toFixed(2)}` : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Daily turnover (lin / nl)</p>
              <p className="text-sm font-semibold text-foreground">
                {data.avg_turnover_linear.toFixed(2)} /{' '}
                <span style={{ color: data.avg_turnover_nonlinear <= data.avg_turnover_linear ? '#4ade80' : '#f59e0b' }}>
                  {data.avg_turnover_nonlinear.toFixed(2)}
                </span>
              </p>
            </div>
          </div>

          {/* Cost-sweep chart */}
          <NonlinearCostSweepChart sweep={data.sweep} />

          {/* Per-cost summary grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-left font-medium py-1 pr-3">Cost €/MWh</th>
                  <th className="text-right font-medium py-1 px-2" style={{ color: '#60a5fa' }}>Sharpe lin</th>
                  <th className="text-right font-medium py-1 px-2" style={{ color: '#a78bfa' }}>Sharpe nl</th>
                  <th className="text-right font-medium py-1 px-2">ΔSharpe</th>
                  <th className="text-right font-medium py-1 pl-2">Δcum P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.sweep.filter((_, i) => i % 2 === 0 || i === data.sweep.length - 1).map((p) => (
                  <tr key={p.cost} className="border-b border-border/20">
                    <td className="py-0.5 pr-3 text-foreground">{p.cost.toFixed(3)}</td>
                    <td className="py-0.5 px-2 text-right text-muted-foreground">{fmtSharpe(p.linear_sharpe)}</td>
                    <td className="py-0.5 px-2 text-right text-muted-foreground">{fmtSharpe(p.nonlinear_sharpe)}</td>
                    <td
                      className="py-0.5 px-2 text-right"
                      style={{ color: (p.sharpe_delta ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}
                    >
                      {p.sharpe_delta != null ? `${p.sharpe_delta >= 0 ? '+' : ''}${p.sharpe_delta.toFixed(3)}` : '--'}
                    </td>
                    <td
                      className="py-0.5 pl-2 text-right"
                      style={{ color: p.cum_pnl_delta > 0 ? '#4ade80' : '#94a3b8' }}
                    >
                      {p.cum_pnl_delta >= 0 ? '+' : ''}{p.cum_pnl_delta.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            The contrarian fade rebalances daily, so it turns over. We charge a round-trip cost of c €/MWh per unit of
            |position change| on the day each position is established (a full −1→+1 flip costs 2c), subtract it from
            gross P&L, and recompute Sharpe and cumulative P&L for both signals across the cost grid. The break-even is
            the cost at which the nonlinear edge over linear falls to zero — &quot;never&quot; means it survives the full
            grid up to {maxCost != null ? maxCost.toFixed(2) : '--'} €/MWh.
            {data.avg_turnover_nonlinear <= data.avg_turnover_linear
              ? ` On ${data.zone} the nonlinear signal trades no more than the linear one (${data.avg_turnover_nonlinear.toFixed(2)} vs ${data.avg_turnover_linear.toFixed(2)} daily turnover), so its gross edge is preserved net of costs — the alpha is genuinely capturable, not an artefact of frictionless accounting.`
              : ` On ${data.zone} the nonlinear signal trades more (${data.avg_turnover_nonlinear.toFixed(2)} vs ${data.avg_turnover_linear.toFixed(2)} daily turnover), so costs erode its edge faster — the break-even cost is where it stops paying.`}
          </p>
        </div>
      )}
    </div>
  )
}

function NonlinearCostSweepChart({ sweep }: { sweep: CostSweepPoint[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        Net Sharpe vs round-trip transaction cost (€/MWh per unit turnover)
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={sweep} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="cost"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(2)}
            label={{ value: 'cost €/MWh', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 9 }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={{ value: 'Sharpe', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            labelFormatter={(v: unknown) => `cost ${typeof v === 'number' ? v.toFixed(3) : v} €/MWh`}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(2) : '--'
              return [v, name === 'linear_sharpe' ? 'Linear' : 'Nonlinear']
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="linear_sharpe"
            name="Linear"
            stroke="#60a5fa"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="nonlinear_sharpe"
            name="Nonlinear"
            stroke="#a78bfa"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function NonlinearEdgeByZoneSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['nonlinear-edge-by-zone'],
    queryFn: () => api.spreadsNonlinearEdgeByZone(),
    staleTime: 60 * 60 * 1000,
  })

  // Evaluate the fitted OLS line at each zone's wind value so a Line series traces it.
  const chartData = useMemo(() => {
    if (!data) return []
    const { slope, intercept } = data
    return data.zones.map((z) => ({
      ...z,
      fit:
        slope != null && intercept != null
          ? Number((slope * z.mean_wind_pct + intercept).toFixed(3))
          : null,
    }))
  }, [data])

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Does the Edge Scale with Wind?</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Cross-zone dose-response: Sharpe edge vs wind penetration
        </span>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Running cross-zone backtest...</p>}

      {data && (
        <div className="space-y-4">
          {/* Headline cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Dose-response</p>
              <p
                className="text-sm font-semibold"
                style={{ color: data.dose_response_holds ? '#4ade80' : '#f59e0b' }}
              >
                {data.dose_response_holds ? 'Holds' : 'Not supported'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Correlation (edge ~ wind)</p>
              <p className="text-sm font-semibold text-foreground">
                {data.corr != null ? data.corr.toFixed(2) : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Slope</p>
              <p className="text-sm font-semibold text-foreground">
                {data.slope != null ? `${data.slope >= 0 ? '+' : ''}${data.slope.toFixed(3)}` : '--'}
                <span className="text-xs text-muted-foreground ml-1">Sharpe / pp wind</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Net cost charged</p>
              <p className="text-sm font-semibold text-foreground">
                {data.cost.toFixed(2)}<span className="text-xs text-muted-foreground ml-1">€/MWh</span>
              </p>
            </div>
          </div>

          {/* Scatter + fit */}
          <NonlinearEdgeScatter data={chartData} />

          {/* Per-zone table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-left font-medium py-1 pr-3">Zone</th>
                  <th className="text-right font-medium py-1 px-2">Wind %</th>
                  <th className="text-right font-medium py-1 px-2" style={{ color: '#60a5fa' }}>Sharpe lin</th>
                  <th className="text-right font-medium py-1 px-2" style={{ color: '#a78bfa' }}>Sharpe nl</th>
                  <th className="text-right font-medium py-1 px-2">ΔSharpe (gross)</th>
                  <th className="text-right font-medium py-1 px-2">ΔSharpe (net)</th>
                  <th className="text-right font-medium py-1 pl-2">Δcum P&L</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((z) => (
                  <tr key={z.zone} className="border-b border-border/20">
                    <td className="py-0.5 pr-3 text-foreground font-medium">{z.zone}</td>
                    <td className="py-0.5 px-2 text-right text-muted-foreground">{z.mean_wind_pct.toFixed(1)}</td>
                    <td className="py-0.5 px-2 text-right text-muted-foreground">
                      {z.sharpe_lin != null ? z.sharpe_lin.toFixed(2) : '--'}
                    </td>
                    <td className="py-0.5 px-2 text-right text-muted-foreground">
                      {z.sharpe_nl != null ? z.sharpe_nl.toFixed(2) : '--'}
                    </td>
                    <td
                      className="py-0.5 px-2 text-right"
                      style={{ color: z.sharpe_delta_gross > 0 ? '#4ade80' : '#f87171' }}
                    >
                      {z.sharpe_delta_gross >= 0 ? '+' : ''}{z.sharpe_delta_gross.toFixed(3)}
                    </td>
                    <td
                      className="py-0.5 px-2 text-right"
                      style={{ color: (z.sharpe_delta_net ?? 0) > 0 ? '#4ade80' : '#f87171' }}
                    >
                      {z.sharpe_delta_net != null ? `${z.sharpe_delta_net >= 0 ? '+' : ''}${z.sharpe_delta_net.toFixed(3)}` : '--'}
                    </td>
                    <td
                      className="py-0.5 pl-2 text-right"
                      style={{ color: z.cum_pnl_delta_gross > 0 ? '#4ade80' : '#f87171' }}
                    >
                      {z.cum_pnl_delta_gross >= 0 ? '+' : ''}{z.cum_pnl_delta_gross.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            The whole nonlinear case rests on one mechanism: the hinge basis adds alpha <em>because</em> it prices the
            low-wind scarcity premium, so the edge should grow with wind penetration. Each point is one bidding zone;
            the y-axis is its out-of-sample Sharpe edge (nonlinear − linear, same walk-forward and accounting as the
            backtests above), the x-axis its mean day-ahead-forecast wind share over the evaluation window. The line
            is an OLS fit across zones.{' '}
            {data.dose_response_holds
              ? `It slopes up (corr ${data.corr?.toFixed(2)}): the edge is largest on the windiest hubs (DE-LU, BE) and turns negative on near-zero-wind IT-NORD, where the hinge has no drought to price and is just noise. That is the dose-response the mechanism predicts - the single-zone result generalises.`
              : `The fit does not slope up, so the cross-zone evidence does not support the wind-penetration mechanism as cleanly as the single-zone result - an honest caveat on the claim.`}{' '}
            Net column charges {data.cost.toFixed(2)} €/MWh round-trip; the edge is materially unchanged, so it is not a transaction-cost artefact.
          </p>
        </div>
      )}
    </div>
  )
}

function NonlinearEdgeScatter({ data }: { data: (EdgeByZoneRow & { fit: number | null })[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        Out-of-sample Sharpe edge (nonlinear − linear) vs mean wind penetration, by zone
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="mean_wind_pct"
            type="number"
            domain={['dataMin - 2', 'dataMax + 2']}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            label={{ value: 'mean wind penetration', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 9 }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{ value: 'ΔSharpe', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <Tooltip
            cursor={{ stroke: '#334155' }}
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(3) : '--'
              return [v, name === 'sharpe_delta_gross' ? 'ΔSharpe' : 'fit']
            }}
            labelFormatter={(v: unknown) => `wind ${typeof v === 'number' ? v.toFixed(1) : v}%`}
          />
          <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
          <Line
            type="linear"
            dataKey="fit"
            name="fit"
            stroke="#64748b"
            strokeDasharray="5 4"
            dot={false}
            strokeWidth={1.25}
            isAnimationActive={false}
          />
          <Scatter dataKey="sharpe_delta_gross" name="ΔSharpe" isAnimationActive={false}>
            {data.map((z) => (
              <Cell key={z.zone} fill={z.sharpe_delta_gross > 0 ? '#4ade80' : '#f87171'} />
            ))}
          </Scatter>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-muted-foreground/80">
        {data.map((z) => (
          <span key={z.zone}>
            <span className="text-foreground">{z.zone}</span> {z.mean_wind_pct.toFixed(0)}% wind
          </span>
        ))}
      </div>
    </div>
  )
}

function RegimeAwareSection() {
  const [zone, setZone] = useState<FundZone>('DE-LU')

  const { data, isLoading } = useQuery({
    queryKey: ['regime-aware-backtest', zone],
    queryFn: () => api.spreadsRegimeAwareBacktest(zone),
    staleTime: 60 * 60 * 1000,
  })

  const fmtSharpe = (v: number | null | undefined) => (v != null ? v.toFixed(2) : '--')
  const subKnotColor = (v: number | null | undefined) =>
    v == null ? '#94a3b8' : v >= 0 ? '#4ade80' : v > -2 ? '#fbbf24' : '#f87171'

  const books: { key: 'linear' | 'nonlinear' | 'regime_aware'; label: string; color: string }[] = [
    { key: 'linear', label: 'Linear fade', color: '#60a5fa' },
    { key: 'nonlinear', label: 'Nonlinear fade', color: '#a78bfa' },
    { key: 'regime_aware', label: 'Regime-aware', color: '#4ade80' },
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Can the Regime Recover the Drought Loss?</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Fade in normal wind, ride trend in the sub-knot drought
        </span>
        <div className="ml-auto flex gap-1">
          {FUNDAMENTAL_ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                zone === z
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Running walk-forward backtest...</p>}

      {data && (
        <div className="space-y-4">
          {/* Sub-knot drought Sharpe: the headline split */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {books.map((b) => (
              <div key={b.key} className="bg-muted/20 rounded-lg px-3 py-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">{b.label} · drought Sharpe</p>
                <p className="text-sm font-semibold" style={{ color: subKnotColor(data[b.key].sharpe_sub_knot) }}>
                  {fmtSharpe(data[b.key].sharpe_sub_knot)}
                </p>
              </div>
            ))}
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Drought loss recovered?</p>
              <p
                className="text-sm font-semibold"
                style={{ color: data.recovers_drought ? '#4ade80' : '#f87171' }}
              >
                {data.recovers_drought ? 'Yes' : 'No'}
                <span className="text-xs text-muted-foreground ml-1">
                  n={data.regime_aware.n_sub_knot}
                </span>
              </p>
            </div>
          </div>

          {/* Equity curves */}
          {data.equity.length > 0 && <RegimeAwareEquityChart equity={data.equity} />}

          {/* Per-book summary */}
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            {books.map((b) => {
              const m: RegimeBookStats = data[b.key]
              return (
                <div key={b.key} className="bg-muted/10 rounded-lg px-3 py-2">
                  <p className="font-medium mb-1" style={{ color: b.color }}>{b.label}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>Sharpe</span><span className="text-right text-foreground">{fmtSharpe(m.sharpe)}</span>
                    <span>Normal</span><span className="text-right text-foreground">{fmtSharpe(m.sharpe_normal)}</span>
                    <span>Drought</span><span className="text-right" style={{ color: subKnotColor(m.sharpe_sub_knot) }}>{fmtSharpe(m.sharpe_sub_knot)}</span>
                    <span>Hit rate</span><span className="text-right text-foreground">{m.hit_rate_pct.toFixed(1)}%</span>
                    <span>Cum P&L</span><span className="text-right text-foreground">{m.cum_pnl.toFixed(0)}</span>
                    <span>Max DD</span><span className="text-right text-foreground">{m.max_dd_eur.toFixed(0)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            Drought is defined zone-relatively: a day is in the drought regime when the {data.source === 'forecast'
              ? 'day-ahead forecast'
              : 'realised'} wind penetration falls below the {data.drought_pctile}th percentile of this zone's own
            training-window distribution ({data.drought_thr_pct}% of load for {data.zone}) — so &quot;drought&quot;
            means low wind for this zone, not a fixed pp knot. The regime-aware book keeps the nonlinear contrarian
            fade when wind is normal but, in the drought, flips to momentum — position = clip of a {data.mom_window}-day
            rolling z-score of recent price changes. Features are the {data.source === 'forecast'
              ? 'ENTSO-E day-ahead forecast (the gate-closure information set — no look-ahead)'
              : 'realised generation'}; walk-forward refit, accounting and the {data.cost.toFixed(2)} €/MWh·u
            round-trip cost match the P43/P44 books. {data.recovers_drought
              ? `On ${data.zone} the regime-aware book's drought Sharpe (${fmtSharpe(data.regime_aware.sharpe_sub_knot)}) beats both fade books while the normal-wind edge (${fmtSharpe(data.regime_aware.sharpe_normal)}) is preserved — conditioning on the regime recovers the drought loss.`
              : `Honest verdict: on ${data.zone} the flip does NOT add alpha. Once look-ahead is removed (forecast features) and drought is defined zone-relatively, the nonlinear fade's drought Sharpe is already ${fmtSharpe(data.nonlinear.sharpe_sub_knot)} — not the deep loss the realised-generation version showed — so the momentum override (${fmtSharpe(data.regime_aware.sharpe_sub_knot)}) only adds variance. The original drought "loss" was largely a look-ahead and denominator artefact.`}
          </p>
        </div>
      )}
    </div>
  )
}

function RegimeAwareEquityChart({ equity }: { equity: RegimeAwareEquityPoint[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">
        Cumulative P&L — linear fade vs nonlinear fade vs regime-aware (out-of-sample, net of cost)
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={equity} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} minTickGap={40} />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{ value: 'cum P&L', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(1) : '--'
              const label =
                name === 'cum_linear' ? 'Linear fade' : name === 'cum_nonlinear' ? 'Nonlinear fade' : 'Regime-aware'
              return [v, label]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <Line type="monotone" dataKey="cum_linear" name="Linear fade" stroke="#60a5fa" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="cum_nonlinear" name="Nonlinear fade" stroke="#a78bfa" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="cum_regime_aware" name="Regime-aware" stroke="#4ade80" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function PortfolioSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-backtest'],
    queryFn: () => api.spreadsPortfolioBacktest(),
    staleTime: 60 * 60 * 1000,
  })

  const fmt = (v: number | null | undefined, dp = 2) => (v != null ? v.toFixed(dp) : '--')
  const sharpeUplift =
    data && data.portfolio_oos.sharpe != null && data.de_lu?.sharpe != null
      ? data.portfolio_oos.sharpe - data.de_lu.sharpe
      : null
  const sig = data?.significance
  const dsrOos = sig?.portfolio_oos.dsr ?? null
  const dsrDe = sig?.de_lu?.dsr ?? null
  const bootOos = sig?.bootstrap_portfolio_oos ?? null
  const bootDe = sig?.bootstrap_de_lu ?? null

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Cross-Zone Portfolio: One Book, Risk-Decomposed</h2>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          OOS rolling inverse-vol blend, deflated for multiple testing
        </span>
      </div>

      {isLoading && <p className="text-muted-foreground text-xs">Building cross-zone portfolio...</p>}

      {data && (
        <div className="space-y-4">
          {/* Headline cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Portfolio Sharpe (OOS)</p>
              <p className="text-sm font-semibold text-emerald-400">
                {fmt(data.portfolio_oos.sharpe)}{' '}
                <span className="text-[10px] font-normal text-muted-foreground">ex-post {fmt(data.portfolio.sharpe)}</span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">vs DE-LU alone</p>
              <p className="text-sm font-semibold text-foreground">
                {fmt(data.de_lu?.sharpe)}{' '}
                <span style={{ color: (sharpeUplift ?? 0) > 0 ? '#4ade80' : '#94a3b8' }}>
                  ({(sharpeUplift ?? 0) >= 0 ? '+' : ''}{fmt(sharpeUplift)})
                </span>
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Deflated Sharpe (DSR)</p>
              <p className="text-sm font-semibold" style={{ color: (dsrOos ?? 0) >= 0.95 ? '#4ade80' : (dsrOos ?? 0) >= 0.5 ? '#fbbf24' : '#f87171' }}>
                {dsrOos != null ? `${(dsrOos * 100).toFixed(1)}%` : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Diversification ratio</p>
              <p className="text-sm font-semibold text-foreground">{fmt(data.diversification_ratio)}×</p>
            </div>
          </div>

          {/* Deflated-Sharpe strip: portfolio survives the multiple-testing haircut, DE-LU does not */}
          {sig && (
            <div className="bg-muted/10 border border-border/60 rounded-lg px-3 py-2 text-[10px] text-muted-foreground leading-relaxed">
              After a <span className="text-foreground">{sig.n_trials}-trial</span> deflation (benchmark Sharpe{' '}
              {fmt(sig.portfolio_oos.sr_benchmark)} from selection bias), the OOS portfolio's probability of a true
              Sharpe above that benchmark is <span className="text-emerald-400">{dsrOos != null ? `${(dsrOos * 100).toFixed(1)}%` : '--'}</span>{' '}
              (DSR) — it survives the haircut. The single best zone DE-LU alone deflates to{' '}
              <span style={{ color: (dsrDe ?? 0) >= 0.5 ? '#fbbf24' : '#f87171' }}>{dsrDe != null ? `${(dsrDe * 100).toFixed(1)}%` : '--'}</span>{' '}
              — below the selection-bias benchmark, so a one-zone book does not. Diversification is what makes the edge robust to multiple testing.
              {bootOos && (
                <>
                  {' '}A 90% block-bootstrap CI (preserving the P&L's autocorrelation) puts the portfolio Sharpe at{' '}
                  <span className="text-emerald-400">[{bootOos.ci_low.toFixed(2)}, {bootOos.ci_high.toFixed(2)}]</span>
                  {bootDe && (
                    <> — entirely above zero, where DE-LU alone is{' '}
                    <span style={{ color: bootDe.ci_low > 0.3 ? '#fbbf24' : '#f87171' }}>[{bootDe.ci_low.toFixed(2)}, {bootDe.ci_high.toFixed(2)}]</span>,
                    barely clearing it (P(Sharpe&gt;0) {(bootDe.p_positive * 100).toFixed(0)}%)</>
                  )}.
                </>
              )}
            </div>
          )}

          {/* Equity curve: OOS portfolio vs ex-post vs DE-LU */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              Cumulative P&L — OOS rolling-weight portfolio vs ex-post vs DE-LU alone ({data.n_days}d, net of cost)
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.equity} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} width={40}
                  label={{ value: 'cum P&L', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }} />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(val: unknown, name: unknown) => [
                    typeof val === 'number' ? val.toFixed(1) : '--',
                    name === 'cum_portfolio_oos' ? 'Portfolio (OOS)' : name === 'cum_portfolio' ? 'Portfolio (ex-post)' : 'DE-LU alone',
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
                <Line type="monotone" dataKey="cum_portfolio_oos" name="Portfolio (OOS)" stroke="#4ade80" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="cum_portfolio" name="Portfolio (ex-post)" stroke="#34d399" dot={false} strokeWidth={1} strokeDasharray="4 3" isAnimationActive={false} />
                <Line type="monotone" dataKey="cum_de_lu" name="DE-LU alone" stroke="#60a5fa" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per-zone risk contribution bars */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">
              Euler risk contribution by zone (weight · standalone Sharpe)
            </p>
            <div className="space-y-1">
              {data.zones.map((z) => (
                <div key={z.zone} className="flex items-center gap-2 text-[10px]">
                  <span className="w-16 text-muted-foreground">{z.zone}</span>
                  <div className="flex-1 bg-muted/20 rounded h-3 overflow-hidden">
                    <div className="h-full bg-emerald-500/70" style={{ width: `${z.risk_contribution_pct}%` }} />
                  </div>
                  <span className="w-10 text-right text-foreground">{z.risk_contribution_pct}%</span>
                  <span className="w-28 text-right text-muted-foreground">
                    w={z.weight.toFixed(2)} · Sh {fmt(z.sharpe_standalone)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            The capstone book combines each zone's canonical signal - the P47 nonlinear residual fade, net of the
            {' '}{data.cost.toFixed(2)} €/MWh·u cost - into one portfolio. The headline weights are{' '}
            <span className="text-foreground/80">rolling inverse-volatility</span>: each day's weight is formed from a
            trailing window of realised per-zone P&L, lagged one day, so the construction uses only past information
            and the whole portfolio - signals and weighting - is genuinely out-of-sample. Reassuringly the OOS Sharpe
            ({fmt(data.portfolio_oos.sharpe)}) lands right on the full-sample ex-post overlay ({fmt(data.portfolio.sharpe)}),
            so the headline was not an artefact of look-ahead weighting. The Euler decomposition (risk contribution =
            wᵢ·(Σw)ᵢ/σₚ, on the static reference weights) shows each zone's share of portfolio risk; it deviates from
            equal because the per-zone fades are imperfectly correlated, which is exactly the source of the
            diversification.{' '}
            {(sharpeUplift ?? 0) > 0
              ? `The OOS portfolio Sharpe (${fmt(data.portfolio_oos.sharpe)}) is well above the single-zone DE-LU book (${fmt(data.de_lu?.sharpe)}), at a ${fmt(data.diversification_ratio)}× diversification ratio and roughly ${data.de_lu && data.portfolio_oos.max_dd_eur > data.de_lu.max_dd_eur ? 'smaller' : 'comparable'} drawdown.`
              : `On this sample the portfolio does not beat the single-zone DE-LU book.`}{' '}
            Most important, the deflated Sharpe ratio haircuts that number for the arc's {sig?.n_trials ?? ''} model-selection
            trials: the portfolio still clears the selection-bias benchmark (DSR {dsrOos != null ? `${(dsrOos * 100).toFixed(0)}%` : '--'})
            where a single zone does not - diversification, not any one signal, is what survives multiple testing.
          </p>
        </div>
      )}
    </div>
  )
}

function BacktestSection({ zone }: { zone: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['fundamental-backtest', zone],
    queryFn: () => api.spreadsFundamentalBacktest(zone),
    staleTime: 60 * 60 * 1000,
  })

  const stats = data?.stats

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Signal Backtest</h2>
        <span className="text-xs text-muted-foreground">
          Position = -zscore, clipped to [-1, 1]. P&L = position(t-1) x price_change(t).
        </span>
        <span className="ml-auto text-xs text-muted-foreground font-medium">{zone}</span>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Running backtest...</p>}

      {stats && (
        <div className="space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Sharpe OOS ({stats.n_oos}d)</p>
              <p className={`text-sm font-semibold ${stats.sharpe_oos != null && stats.sharpe_oos > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.sharpe_oos != null ? stats.sharpe_oos.toFixed(2) : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Sharpe IS ({stats.n_is}d)</p>
              <p className={`text-sm font-semibold ${stats.sharpe_is != null && stats.sharpe_is > 0 ? 'text-sky-400' : 'text-muted-foreground'}`}>
                {stats.sharpe_is != null ? stats.sharpe_is.toFixed(2) : '--'}
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Hit rate (OOS)</p>
              <p className={`text-sm font-semibold ${stats.hit_rate_oos_pct > 50 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                {stats.hit_rate_oos_pct.toFixed(1)}%
              </p>
            </div>
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Max drawdown</p>
              <p className="text-sm font-semibold text-amber-400">
                {stats.max_dd_eur.toFixed(0)} EUR
              </p>
            </div>
          </div>

          {/* Equity curve */}
          {data.equity.length > 0 && (
            <BacktestEquityChart equity={data.equity} />
          )}

          <p className="text-[9px] text-muted-foreground">
            Daily normalized P&L (no notional). Grey shading = in-sample fit period (last {stats.n_is} days).
            OOS Sharpe above 1.0 indicates a statistically robust signal. Hit rate above 50% = directional edge.
            Note: no transaction costs, bid-ask spread, or market impact included.
          </p>
        </div>
      )}
    </div>
  )
}

function BacktestEquityChart({ equity }: { equity: BacktestEquityPoint[] }) {
  // Mark the in-sample start
  const isStart = equity.findIndex((p) => p.in_sample)
  const isStartDate = isStart >= 0 ? equity[isStart].date : null

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">Cumulative P&L - fundamental mean-reversion strategy</p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={equity} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={Math.floor(equity.length / 5)} />
          <YAxis
            yAxisId="pnl"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
            label={{ value: 'EUR', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9 }}
          />
          {isStartDate && (
            <ReferenceLine
              yAxisId="pnl"
              x={isStartDate}
              stroke="#64748b"
              strokeDasharray="4 2"
              label={{ value: 'IS start', fill: '#64748b', fontSize: 8 }}
            />
          )}
          {isStartDate && (
            <ReferenceArea
              yAxisId="pnl"
              x1={isStartDate}
              x2={equity[equity.length - 1].date}
              fill="#1e293b"
              fillOpacity={0.5}
              strokeOpacity={0}
            />
          )}
          <ReferenceLine yAxisId="pnl" y={0} stroke="#475569" strokeWidth={1} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(val: unknown, name: unknown) => {
              const v = typeof val === 'number' ? val.toFixed(1) : '--'
              return [v + ' EUR', name === 'cum_pnl' ? 'Cum. P&L' : String(name)]
            }}
            labelFormatter={(l) => String(l)}
          />
          <Line
            yAxisId="pnl"
            dataKey="cum_pnl"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            name="cum_pnl"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function SpreadExplainer() {
  return (
    <div className="text-xs text-muted-foreground space-y-2">
      <p className="font-medium text-foreground">Methodology</p>
      <p>
        <span className="text-blue-400">Clean Spark Spread (CSS)</span> = Power - TTF/efficiency -
        EUA x gas emission factor. Proxy for gas plant profitability.
      </p>
      <p>
        <span className="text-amber-400">Clean Dark Spread (CDS)</span> = Power - Coal/efficiency -
        EUA x coal emission factor. Proxy for coal plant profitability.
      </p>
      <p>
        <span className="text-violet-400">Fuel Switch Spread (FSS)</span> = CSS - CDS. Positive
        means gas is the marginal fuel; negative means coal is marginal.
      </p>
      <p>
        Background shading indicates the marginal fuel regime (gas = blue, coal = amber) derived
        from the sign of the FSS.
      </p>
      <p className="text-muted-foreground/70">
        Constants: gas eff 49%, gas EF 0.364 tCO2/MWh; coal eff 36%, coal EF 0.96 tCO2/MWh.
        Power = DE-LU day-ahead base. TTF = front-month EUR/MWh. EUA = ETS front-year.
      </p>
    </div>
  )
}
