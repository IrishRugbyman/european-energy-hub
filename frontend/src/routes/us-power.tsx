import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'
import { api, type UsPowerRegionLatest, type UsPowerHourlyPoint } from '@/lib/api'

export const Route = createFileRoute('/us-power')({
  component: UsPowerDashboard,
})

// Fuel color palette
const FUEL_COLORS: Record<string, string> = {
  NG:  '#f97316', // orange
  NUC: '#a855f7', // purple
  COL: '#78716c', // stone
  WND: '#22d3ee', // cyan
  SUN: '#fbbf24', // amber
  WAT: '#3b82f6', // blue
  BAT: '#4ade80', // green
  OIL: '#dc2626', // red
  OTH: '#6b7280', // muted
}

// Display order for stacked bars (largest-capacity fuels first)
const FUEL_ORDER = ['NG', 'NUC', 'COL', 'WND', 'SUN', 'WAT', 'BAT', 'OIL', 'OTH']

function fuelColor(code: string): string {
  return FUEL_COLORS[code] ?? '#6b7280'
}

function fmt(v: number, dec = 0): string {
  if (v >= 1000) return `${(v / 1000).toFixed(dec === 0 ? 1 : dec)}k`
  return v.toFixed(dec)
}

function UsPowerDashboard() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['us-power-mix'],
    queryFn: api.usPowerMix,
    staleTime: 60 * 60 * 1000, // refresh hourly
  })

  const { data: histData } = useQuery({
    queryKey: ['us-power-history', selected],
    queryFn: () => api.usPowerHistory(selected!),
    enabled: selected != null,
    staleTime: 60 * 60 * 1000,
  })

  // US-wide totals from all regions
  const usTotals = useMemo(() => {
    if (!data?.regions.length) return null
    let totalMwh = 0
    let ngMwh = 0
    const fuelMap: Record<string, number> = {}
    for (const r of data.regions) {
      totalMwh += r.total_mwh
      ngMwh += r.ng_mwh
      for (const f of r.fuels) {
        fuelMap[f.fueltype] = (fuelMap[f.fueltype] ?? 0) + f.value_mwh
      }
    }
    return { totalMwh, ngMwh, ngPct: totalMwh > 0 ? (100 * ngMwh / totalMwh) : 0, fuelMap }
  }, [data])

  const selectedRegion = data?.regions.find((r) => r.region === selected) ?? null

  // Parse period string to a label
  const periodLabel = data?.as_of
    ? new Date(data.as_of + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : ''

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stat strip */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-2.5 border-b border-border bg-card/60 backdrop-blur text-sm">
        {usTotals ? (
          <>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground leading-none mb-0.5">US total generation</span>
              <span className="text-xs font-semibold text-foreground">{fmt(usTotals.totalMwh)} MWh/h</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground leading-none mb-0.5">Natural gas</span>
              <span className="text-xs font-semibold text-orange-400">{fmt(usTotals.ngMwh)} MWh/h ({usTotals.ngPct.toFixed(1)}%)</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 ml-auto">
              {/* US-wide fuel mix mini bar */}
              <span className="text-[10px] text-muted-foreground">US mix:</span>
              <MixBar fuels={Object.entries(usTotals.fuelMap).map(([fueltype, value_mwh]) => ({ fueltype, fuel_name: fueltype, value_mwh })).sort((a, b) => b.value_mwh - a.value_mwh)} totalMwh={usTotals.totalMwh} height={16} width={180} />
            </div>
            <span className="hidden lg:block text-[10px] text-muted-foreground ml-2">{periodLabel} (EIA Form 930)</span>
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Region grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
          )}
          {data?.regions && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {data.regions.map((region) => (
                <RegionCard
                  key={region.region}
                  region={region}
                  selected={selected === region.region}
                  onClick={() => setSelected((s) => s === region.region ? null : region.region)}
                />
              ))}
            </div>
          )}
          {/* Legend */}
          {data?.regions && (
            <div className="mt-4 flex flex-wrap gap-3">
              {FUEL_ORDER.filter((f) => data.regions.some((r) => r.fuels.some((fu) => fu.fueltype === f))).map((f) => (
                <div key={f} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: fuelColor(f) }} />
                  <span>{f === 'NG' ? 'Natural Gas' : f === 'NUC' ? 'Nuclear' : f === 'COL' ? 'Coal' : f === 'WND' ? 'Wind' : f === 'SUN' ? 'Solar' : f === 'WAT' ? 'Hydro' : f === 'BAT' ? 'Battery/Storage' : f === 'OIL' ? 'Petroleum' : 'Other'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Drill-down panel */}
        {selected && selectedRegion && (
          <div className="w-80 shrink-0 border-l border-border bg-card/95 backdrop-blur overflow-y-auto">
            <RegionPanel
              region={selectedRegion}
              history={histData?.hourly ?? []}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Region card -------------------------------------------------------

function RegionCard({
  region,
  selected,
  onClick,
}: {
  region: UsPowerRegionLatest
  selected: boolean
  onClick: () => void
}) {
  const dominantFuel = region.fuels[0]

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
        selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-border bg-card hover:border-border/80 hover:bg-card/80'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-foreground leading-tight">{region.region_name}</p>
          <p className="text-[10px] text-muted-foreground">{region.region}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold" style={{ color: fuelColor('NG') }}>
            {region.ng_pct.toFixed(1)}% NG
          </p>
          <p className="text-[10px] text-muted-foreground">{fmt(region.total_mwh)} MWh/h total</p>
        </div>
      </div>

      {/* Fuel mix stacked bar */}
      <MixBar fuels={region.fuels} totalMwh={region.total_mwh} height={12} />

      {/* Key fuel stats */}
      <div className="mt-2 grid grid-cols-2 gap-1">
        <div>
          <p className="text-[10px] text-muted-foreground">Gas</p>
          <p className="text-xs font-medium text-orange-400">{fmt(region.ng_mwh)} MWh</p>
        </div>
        {dominantFuel && dominantFuel.fueltype !== 'NG' && (
          <div>
            <p className="text-[10px] text-muted-foreground">
              {dominantFuel.fuel_name}
            </p>
            <p className="text-xs font-medium" style={{ color: fuelColor(dominantFuel.fueltype) }}>
              {fmt(dominantFuel.value_mwh)} MWh
            </p>
          </div>
        )}
        {dominantFuel && dominantFuel.fueltype === 'NG' && region.fuels[1] && (
          <div>
            <p className="text-[10px] text-muted-foreground">
              {region.fuels[1].fuel_name}
            </p>
            <p className="text-xs font-medium" style={{ color: fuelColor(region.fuels[1].fueltype) }}>
              {fmt(region.fuels[1].value_mwh)} MWh
            </p>
          </div>
        )}
      </div>
    </button>
  )
}

// ---------- Mix bar -----------------------------------------------------------

function MixBar({
  fuels,
  totalMwh,
  height = 12,
  width,
}: {
  fuels: { fueltype: string; fuel_name: string; value_mwh: number }[]
  totalMwh: number
  height?: number
  width?: number
}) {
  const sorted = [...fuels].sort(
    (a, b) => (FUEL_ORDER.indexOf(a.fueltype) ?? 99) - (FUEL_ORDER.indexOf(b.fueltype) ?? 99)
  )
  const style: React.CSSProperties = { height, display: 'flex', borderRadius: 4, overflow: 'hidden', gap: 1 }
  if (width) style.width = width
  else style.width = '100%'

  return (
    <div style={style}>
      {sorted.map(({ fueltype, fuel_name, value_mwh }) => {
        if (value_mwh <= 0) return null
        const pct = totalMwh > 0 ? (100 * value_mwh / totalMwh) : 0
        return (
          <div
            key={fueltype}
            title={`${fuel_name}: ${fmt(value_mwh)} MWh (${pct.toFixed(1)}%)`}
            style={{ flex: value_mwh, backgroundColor: fuelColor(fueltype) }}
          />
        )
      })}
    </div>
  )
}

// ---------- Region drill-down panel -------------------------------------------

function RegionPanel({
  region,
  history,
  onClose,
}: {
  region: UsPowerRegionLatest
  history: UsPowerHourlyPoint[]
  onClose: () => void
}) {
  const chartData = history.map((h) => ({
    label: h.period.slice(11, 16),
    ng_mwh: h.ng_mwh,
    total_mwh: h.total_mwh,
    ng_pct: h.ng_pct,
  }))

  // Find NG daily min/max over the 48h window
  const ngValues = history.map((h) => h.ng_mwh).filter((v) => v > 0)
  const ngMin = ngValues.length ? Math.min(...ngValues) : null
  const ngMax = ngValues.length ? Math.max(...ngValues) : null

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{region.region_name}</h2>
          <p className="text-[10px] text-muted-foreground">{region.region} - EIA grid region</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Current stats */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Total generation" value={`${fmt(region.total_mwh)} MWh/h`} />
        <MetricCard label="Natural gas" value={`${fmt(region.ng_mwh)} MWh`} sub={`${region.ng_pct.toFixed(1)}% of mix`} accent="#f97316" />
        {ngMin != null && <MetricCard label="NG 48h low" value={`${fmt(ngMin)} MWh`} />}
        {ngMax != null && <MetricCard label="NG 48h high" value={`${fmt(ngMax)} MWh`} />}
      </div>

      {/* Current fuel mix */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Current mix</p>
        <MixBar fuels={region.fuels} totalMwh={region.total_mwh} height={14} />
        <div className="mt-2 space-y-1">
          {region.fuels.filter((f) => f.value_mwh > 0).map((f) => (
            <div key={f.fueltype} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: fuelColor(f.fueltype) }} />
              <span className="text-muted-foreground flex-1">{f.fuel_name}</span>
              <span className="font-mono text-foreground">{fmt(f.value_mwh)} MWh</span>
              <span className="font-mono text-muted-foreground w-12 text-right">
                {region.total_mwh > 0 ? `${(100 * f.value_mwh / region.total_mwh).toFixed(1)}%` : '--'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 48h NG generation trend */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">48h natural gas trend (MWh/h)</p>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 8, fill: '#64748b' }}
                tickLine={false}
                interval={5}
              />
              <YAxis
                tick={{ fontSize: 8, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={(v: number) => fmt(v)}
              />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                formatter={(val: unknown, name: unknown) => {
                  const v = typeof val === 'number' ? val : null
                  const n = String(name ?? '')
                  if (n === 'ng_mwh') return [v != null ? `${fmt(v)} MWh` : '--', 'Natural Gas']
                  if (n === 'ng_pct') return [v != null ? `${v.toFixed(1)}%` : '--', 'NG share']
                  return [v != null ? `${fmt(v)} MWh` : '--', n]
                }}
                labelFormatter={(l) => `Hour ${String(l)}`}
              />
              <Area
                dataKey="ng_mwh"
                fill="#f97316"
                fillOpacity={0.15}
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 48h NG % share trend */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">NG share of total generation (%)</p>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fontSize: 7, fill: '#64748b' }} tickLine={false} interval={5} />
              <YAxis tick={{ fontSize: 7, fill: '#64748b' }} tickLine={false} axisLine={false} width={28} tickFormatter={(v: number) => `${v}%`} domain={[0, 'auto']} />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                formatter={(val: unknown) => [typeof val === 'number' ? `${val.toFixed(1)}%` : '--', 'NG share']}
                labelFormatter={(l) => `Hour ${String(l)}`}
              />
              <Line dataKey="ng_pct" stroke="#f97316" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[9px] text-muted-foreground">Source: EIA Form 930, Hourly Electric Grid Monitor. ~1h lag.</p>
    </div>
  )
}

// ---------- Metric card -------------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="bg-muted/20 rounded-lg px-3 py-2">
      <p className="text-[10px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className="text-sm font-semibold" style={{ color: accent ?? 'inherit' }}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
