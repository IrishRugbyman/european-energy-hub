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
import {
  USPowerMap,
  type UsPowerColorMode,
  computeRePct,
  ngPctColor,
  rePctColor,
  totalMwhColor,
} from '@/components/us-power/USPowerMap'

export const Route = createFileRoute('/us-power')({
  component: UsPowerDashboard,
})

// Fuel color palette (must match DrillDownPanel)
const FUEL_COLORS: Record<string, string> = {
  NG:  '#f97316',
  NUC: '#a855f7',
  COL: '#78716c',
  WND: '#22d3ee',
  SUN: '#fbbf24',
  WAT: '#3b82f6',
  BAT: '#4ade80',
  OIL: '#dc2626',
  OTH: '#6b7280',
}
const FUEL_ORDER = ['NG', 'NUC', 'COL', 'WND', 'SUN', 'WAT', 'BAT', 'OIL', 'OTH']

function fuelColor(code: string): string {
  return FUEL_COLORS[code] ?? '#6b7280'
}

function fmt(v: number, dec = 0): string {
  if (v >= 1000) return `${(v / 1000).toFixed(dec === 0 ? 1 : dec)}k`
  return v.toFixed(dec)
}

// Legend definitions per color mode
const NG_LEGEND = [
  { label: '< 20% NG',   color: '#15803d' },
  { label: '20-35%',     color: '#16a34a' },
  { label: '35-45%',     color: '#65a30d' },
  { label: '45-55%',     color: '#ca8a04' },
  { label: '55-65%',     color: '#d97706' },
  { label: '65-75%',     color: '#b91c1c' },
  { label: '> 75% NG',   color: '#7f1d1d' },
  { label: 'no data',    color: '#374151' },
]

const RE_LEGEND = [
  { label: '< 10% RE',  color: '#374151' },
  { label: '10-20%',    color: '#1e3a5f' },
  { label: '20-30%',    color: '#1d4ed8' },
  { label: '30-40%',    color: '#65a30d' },
  { label: '40-55%',    color: '#16a34a' },
  { label: '55-70%',    color: '#15803d' },
  { label: '> 70% RE',  color: '#064e3b' },
  { label: 'no data',   color: '#374151' },
]

const MWH_LEGEND = [
  { label: '< 10k MWh/h',  color: '#1e3a5f' },
  { label: '10-20k',        color: '#1d4ed8' },
  { label: '20-35k',        color: '#2563eb' },
  { label: '35-55k',        color: '#3b82f6' },
  { label: '55-80k',        color: '#60a5fa' },
  { label: '80-110k',       color: '#93c5fd' },
  { label: '> 110k MWh/h',  color: '#bfdbfe' },
  { label: 'no data',       color: '#374151' },
]

const COLOR_MODE_LABELS: Record<UsPowerColorMode, string> = {
  'ng-pct':    'NG share %',
  're-pct':    'RE share %',
  'total-mwh': 'Total MWh/h',
}

function UsPowerDashboard() {
  const [selected, setSelected] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<UsPowerColorMode>('ng-pct')

  const { data, isLoading, error } = useQuery({
    queryKey: ['us-power-mix'],
    queryFn: api.usPowerMix,
    staleTime: 60 * 60 * 1000,
  })

  const { data: histData } = useQuery({
    queryKey: ['us-power-history', selected],
    queryFn: () => api.usPowerHistory(selected!),
    enabled: selected != null,
    staleTime: 60 * 60 * 1000,
  })

  const usTotals = useMemo(() => {
    if (!data?.regions.length) return null
    let totalMwh = 0
    let ngMwh = 0
    let reMwh = 0
    for (const r of data.regions) {
      totalMwh += r.total_mwh
      ngMwh += r.ng_mwh
      const re = r.fuels
        .filter((f) => ['WND', 'SUN', 'WAT'].includes(f.fueltype))
        .reduce((s, f) => s + f.value_mwh, 0)
      reMwh += re
    }
    return {
      totalMwh,
      ngMwh,
      reMwh,
      ngPct: totalMwh > 0 ? (100 * ngMwh / totalMwh) : 0,
      rePct: totalMwh > 0 ? (100 * reMwh / totalMwh) : 0,
    }
  }, [data])

  const selectedRegion = data?.regions.find((r) => r.region === selected) ?? null

  const legend = colorMode === 'ng-pct' ? NG_LEGEND : colorMode === 're-pct' ? RE_LEGEND : MWH_LEGEND
  const legendTitle = COLOR_MODE_LABELS[colorMode]

  const periodLabel = data?.as_of
    ? new Date(data.as_of + 'Z').toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      })
    : ''

  return (
    <div className="relative h-full flex">
      {/* Stat strip - floating overlay */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm">
        {usTotals ? (
          <>
            <StatChip label="US total" value={`${fmt(usTotals.totalMwh)} MWh/h`} />
            <div className="w-px h-4 bg-border" />
            <StatChip label="Natural gas" value={`${usTotals.ngPct.toFixed(1)}%`} accent="#f97316" />
            <StatChip label="Renewables" value={`${usTotals.rePct.toFixed(1)}%`} accent="#22d3ee" />
            <span className="hidden lg:block text-[10px] text-muted-foreground ml-2">{periodLabel}</span>
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Color mode toggle */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5">
        {(['ng-pct', 're-pct', 'total-mwh'] as UsPowerColorMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setColorMode(mode)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-lg ${
              colorMode === mode
                ? 'bg-primary/20 border-primary/60 text-primary'
                : 'bg-card/90 backdrop-blur border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {COLOR_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      {/* Map (fills entire background) */}
      <div className="flex-1 min-h-0">
        <USPowerMap
          regions={data?.regions ?? []}
          selected={selected}
          onSelect={setSelected}
          colorMode={colorMode}
        />
      </div>

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

      {/* Region rankings strip - bottom right, hidden when panel open */}
      {!selected && data?.regions && (
        <RegionRankings regions={data.regions} colorMode={colorMode} onSelect={setSelected} />
      )}

      {/* Drill-down panel */}
      {selected && selectedRegion && (
        <div className="absolute top-0 right-0 bottom-0 w-80 z-[1000] border-l border-border bg-card/95 backdrop-blur overflow-y-auto">
          <RegionPanel
            region={selectedRegion}
            history={histData?.hourly ?? []}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}

// ---------- Stat chip -----------------------------------------------------

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground leading-none mb-0.5">{label}</span>
      <span className="text-xs font-semibold" style={{ color: accent ?? 'inherit' }}>{value}</span>
    </div>
  )
}

// ---------- Mix bar -------------------------------------------------------

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

// ---------- Region drill-down panel ---------------------------------------

function RegionPanel({
  region,
  history,
  onClose,
}: {
  region: UsPowerRegionLatest
  history: UsPowerHourlyPoint[]
  onClose: () => void
}) {
  const rePct = computeRePct(region)

  const chartData = history.map((h) => ({
    label: h.period.slice(11, 16),
    ng_mwh: h.ng_mwh,
    total_mwh: h.total_mwh,
    ng_pct: h.ng_pct,
  }))

  const ngValues = history.map((h) => h.ng_mwh).filter((v) => v > 0)
  const ngMin = ngValues.length ? Math.min(...ngValues) : null
  const ngMax = ngValues.length ? Math.max(...ngValues) : null

  const domFuel = region.fuels[0]

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{region.region_name}</h2>
          <p className="text-[10px] text-muted-foreground">{region.region} - EIA Form 930 grid region</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Total generation" value={`${fmt(region.total_mwh)} MWh/h`} />
        <MetricCard label="Natural gas" value={`${fmt(region.ng_mwh)} MWh`} sub={`${region.ng_pct.toFixed(1)}% of mix`} accent="#f97316" />
        <MetricCard label="Renewables (W+S+H)" value={`${rePct.toFixed(1)}%`} accent="#22d3ee" />
        {domFuel && domFuel.fueltype !== 'NG' && (
          <MetricCard label={domFuel.fuel_name} value={`${fmt(domFuel.value_mwh)} MWh`} sub={`${region.total_mwh > 0 ? (100 * domFuel.value_mwh / region.total_mwh).toFixed(1) : '--'}%`} accent={fuelColor(domFuel.fueltype)} />
        )}
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

      {/* 48h NG trend */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">48h natural gas (MWh/h)</p>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} interval={5} />
              <YAxis tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                formatter={(val: unknown, name: unknown) => {
                  const v = typeof val === 'number' ? val : null
                  const n = String(name ?? '')
                  if (n === 'ng_mwh') return [v != null ? `${fmt(v)} MWh` : '--', 'Natural Gas']
                  return [v != null ? `${fmt(v)} MWh` : '--', n]
                }}
                labelFormatter={(l) => `Hour ${String(l)}`}
              />
              <Area dataKey="ng_mwh" fill="#f97316" fillOpacity={0.15} stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 48h NG% share */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">NG share (%)</p>
          <ResponsiveContainer width="100%" height={90}>
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

// ---------- Region rankings strip -----------------------------------------

const REGION_DISPLAY_ORDER = ['TEX', 'MISO', 'MIDA', 'SE', 'CAL', 'NW', 'CAR', 'FLA', 'SW', 'ISNE']

function RegionRankings({
  regions,
  colorMode,
  onSelect,
}: {
  regions: UsPowerRegionLatest[]
  colorMode: UsPowerColorMode
  onSelect: (region: string) => void
}) {
  const byRegion: Record<string, UsPowerRegionLatest> = {}
  for (const r of regions) byRegion[r.region] = r

  const sorted = REGION_DISPLAY_ORDER
    .map((code) => byRegion[code])
    .filter(Boolean)

  if (!sorted.length) return null

  return (
    <div className="hidden sm:block absolute bottom-6 right-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 max-w-xs">
      <p className="text-[10px] text-muted-foreground font-medium mb-2">Regions (click to drill down)</p>
      <div className="space-y-1">
        {sorted.map((r) => {
          const rePct = computeRePct(r)
          const value = colorMode === 'ng-pct'
            ? r.ng_pct
            : colorMode === 're-pct'
            ? rePct
            : r.total_mwh / 1000
          const color = colorMode === 'ng-pct'
            ? ngPctColor(r.ng_pct)
            : colorMode === 're-pct'
            ? rePctColor(rePct)
            : totalMwhColor(r.total_mwh)
          const valueStr = colorMode === 'total-mwh'
            ? `${value.toFixed(1)}k MWh/h`
            : `${value.toFixed(1)}%`

          return (
            <button
              key={r.region}
              onClick={() => onSelect(r.region)}
              className="w-full flex items-center gap-2 text-xs hover:bg-muted/20 rounded px-1 py-0.5 transition-colors"
            >
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground w-10 text-left font-mono">{r.region}</span>
              <span className="text-muted-foreground flex-1 text-left truncate">{r.region_name}</span>
              <span className="font-mono text-foreground w-16 text-right">{valueStr}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Metric card ---------------------------------------------------

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
