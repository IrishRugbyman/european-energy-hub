import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ComposedChart,
  BarChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { api, type SpreadsDailyPoint, type MultiZoneSpreadRow } from '@/lib/api'
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
        <h2 className="text-sm font-medium text-muted-foreground">Multi-Zone Comparison (€/MWh)</h2>
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
              <h2 className="text-sm font-medium text-muted-foreground">
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
