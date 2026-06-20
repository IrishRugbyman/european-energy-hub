import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api, type EuAnnualFuelRow, type GenMonthlyRow, type EuCiDailyPoint, type ZoneCfRow, type EuPriceRePoint, type EuGenHourlyPoint, type EuDuckCurvePoint, type CapacityAnnualRow, type NegHoursMonthlyRow, type NegHoursZoneRow, type ZonePriceReCorrRow, type MonthlyFuelMixRow, type ZoneHourlyProfileRow } from '@/lib/api'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area, AreaChart,
  ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'

export const Route = createFileRoute('/generation')({
  component: GenerationTrends,
})

// RE% -> HSL color: 0% = muted red, 50% = yellow-amber, 100% = bright green
function reColor(pct: number | null): string {
  if (pct == null) return '#1e293b'
  const t = Math.max(0, Math.min(100, pct)) / 100
  // Two-segment gradient: 0->0.5 red-amber, 0.5->1.0 amber-green
  if (t < 0.5) {
    const s = t * 2
    const r = Math.round(220 - s * 60)
    const g = Math.round(30 + s * 110)
    return `rgb(${r},${g},20)`
  }
  const s = (t - 0.5) * 2
  const r = Math.round(160 - s * 130)
  const g = Math.round(140 + s * 80)
  return `rgb(${r},${g},30)`
}

function textColor(pct: number | null): string {
  if (pct == null) return '#64748b'
  return pct > 45 ? '#000000' : '#ffffff'
}

const FUEL_COLORS: Record<string, string> = {
  solar: '#fbbf24',
  wind: '#06b6d4',
  hydro: '#3b82f6',
  nuclear: '#7c3aed',
  gas: '#f97316',
  coal: '#78716c',
  biomass: '#4ade80',
  other: '#475569',
  other_fuel: '#475569',
}

const EU_HOURLY_FUEL_ORDER: (keyof EuGenHourlyPoint & string)[] = [
  'nuclear', 'hydro', 'wind', 'solar', 'biomass', 'gas', 'coal', 'other_fuel',
]

function EuGenHourlyChart({ rows }: { rows: EuGenHourlyPoint[] }) {
  // Build tick marks: show every 6h
  const ticks = useMemo(() => {
    return rows.filter((r) => {
      const h = parseInt(r.ts.slice(11, 13))
      return h % 6 === 0
    }).map((r) => r.ts)
  }, [rows])

  // Compute latest total for stat
  const last = rows[rows.length - 1]
  const lastTotal = last
    ? EU_HOURLY_FUEL_ORDER.reduce((s, f) => s + (last[f] as number | null ?? 0), 0)
    : null
  const lastRePct = last && lastTotal
    ? (((last.wind ?? 0) + (last.solar ?? 0) + (last.hydro ?? 0)) / lastTotal) * 100
    : null

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-4 mb-2">
        <h2 className="text-sm font-medium text-muted-foreground">EU-34 Real-time Generation Stack (MW) - last 48h</h2>
        {lastRePct != null && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">
            RE% now: {lastRePct.toFixed(0)}%
          </span>
        )}
        {lastTotal != null && (
          <span className="text-xs text-muted-foreground">
            Total: {Math.round(lastTotal / 1000)}k MW
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        15-min actuals averaged per hour, summed across all reporting zones. Requires 28+ zones.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="ts"
            ticks={ticks}
            tickFormatter={(v: string) => v.slice(8, 13).replace('T', ' ')}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            width={30}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            labelFormatter={(l) => String(l).slice(0, 16).replace('T', ' ')}
            formatter={(v, name) => [
              typeof v === 'number' ? `${Math.round(v as number).toLocaleString()} MW` : '--',
              String(name) === 'other_fuel' ? 'other' : String(name),
            ]}
          />
          {EU_HOURLY_FUEL_ORDER.map((fuel) => (
            <Area
              key={fuel}
              type="monotone"
              dataKey={fuel}
              stackId="gen"
              stroke={FUEL_COLORS[fuel as keyof typeof FUEL_COLORS] ?? '#64748b'}
              fill={FUEL_COLORS[fuel as keyof typeof FUEL_COLORS] ?? '#64748b'}
              fillOpacity={0.85}
              strokeWidth={0}
              dot={false}
              isAnimationActive={false}
              name={fuel}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-2">
        {EU_HOURLY_FUEL_ORDER.map((f) => (
          <span key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: FUEL_COLORS[f as keyof typeof FUEL_COLORS] ?? '#64748b' }} />
            {f === 'other_fuel' ? 'other' : f}
          </span>
        ))}
      </div>
    </div>
  )
}

function EuFuelMixChart({ rows }: { rows: EuAnnualFuelRow[] }) {
  const currentYear = new Date().getFullYear()
  const chartData = rows
    .filter((r) => r.year < currentYear)
    .map((r) => ({
      year: String(r.year),
      solar: Math.round(r.solar_mw ?? 0),
      wind: Math.round(r.wind_mw ?? 0),
      hydro: Math.round(r.hydro_mw ?? 0),
      nuclear: Math.round(r.nuclear_mw ?? 0),
      gas: Math.round(r.gas_mw ?? 0),
      coal: Math.round(r.coal_mw ?? 0),
      biomass: Math.round(r.biomass_mw ?? 0),
      other: Math.round(r.other_mw ?? 0),
    }))

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">EU-34 Energy Mix - Annual Average Generation (MW)</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Average of daily average MW per zone, summed across 34 bidding zones.
        Solar +{Math.round(((rows.find(r => r.year === currentYear - 1)?.solar_mw ?? 0) / (rows.find(r => r.year === 2021)?.solar_mw ?? 1) - 1) * 100)}% from 2021.
        Coal {Math.round(((rows.find(r => r.year === currentYear - 1)?.coal_mw ?? 0) / (rows.find(r => r.year === 2021)?.coal_mw ?? 1) - 1) * 100)}% from 2021.
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={52} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => [`${(v as number).toLocaleString()} MW`, String(name)]}
          />
          {(['nuclear', 'hydro', 'wind', 'solar', 'gas', 'coal', 'biomass', 'other'] as const).map((f) => (
            <Bar key={f} dataKey={f} stackId="a" fill={FUEL_COLORS[f]} isAnimationActive={false} name={f} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-2">
        {(['solar', 'wind', 'hydro', 'nuclear', 'gas', 'coal', 'biomass'] as const).map((f) => (
          <span key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: FUEL_COLORS[f] }} />
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

function EuCapacityChart({ rows }: { rows: CapacityAnnualRow[] }) {
  if (rows.length === 0) return null
  const data = rows.map((r) => ({
    year: String(r.yr),
    wind: r.wind_gw,
    solar: r.solar_gw,
    total: parseFloat((r.wind_gw + r.solar_gw).toFixed(1)),
  }))
  const first = rows[0]
  const last = rows[rows.length - 1]
  const solarGrowthPct = Math.round(((last.solar_gw - first.solar_gw) / first.solar_gw) * 100)
  const windGrowthPct = Math.round(((last.wind_gw - first.wind_gw) / first.wind_gw) * 100)
  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="text-sm font-medium text-muted-foreground">EU-27 Installed Renewable Capacity - Annual (GW)</h2>
        <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">
          Solar +{solarGrowthPct}% since {first.yr}
        </span>
        <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">
          Wind +{windGrowthPct}% since {first.yr}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        ENTSO-E installed capacity across {last.n_zones} zones. {last.yr}: {last.wind_gw} GW wind + {last.solar_gw} GW solar = {(last.wind_gw + last.solar_gw).toFixed(1)} GW total.
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            width={36}
            unit=" GW"
            tickFormatter={(v) => String(v)}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => [`${v as number} GW`, String(name)]}
          />
          <Bar dataKey="wind" stackId="a" fill="#06b6d4" isAnimationActive={false} name="wind" />
          <Bar dataKey="solar" stackId="a" fill="#fbbf24" isAnimationActive={false} name="solar" />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm inline-block bg-cyan-400" /> wind
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-sm inline-block bg-amber-400" /> solar
        </span>
      </div>
    </div>
  )
}

const NEG_ZONE_COLORS: Record<string, string> = {
  es: '#f59e0b',
  fr: '#60a5fa',
  de: '#4ade80',
  nl: '#a78bfa',
  eu_avg: '#94a3b8',
}

function NegHoursMonthlyChart({ rows }: { rows: NegHoursMonthlyRow[] }) {
  if (rows.length === 0) return null
  const data = rows.map((r) => ({
    month: r.month.slice(2),  // "2025-04" -> "25-04"
    eu_avg: r.eu_avg,
    es: r.es,
    fr: r.fr,
    de: r.de,
    nl: r.nl,
  }))
  // Find peak month for ES
  const peakEs = rows.reduce((a, b) => (b.es ?? 0) > (a.es ?? 0) ? b : a, rows[0])
  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="text-sm font-medium text-muted-foreground">Negative Price Hour Frequency - Monthly (%)</h2>
        {(peakEs.es ?? 0) > 0 && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">
            ES peak: {peakEs.es}% ({peakEs.month})
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        % of hours per month where day-ahead price &lt; 0. Rising as solar capacity saturates the midday merit order.
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 16, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 8, fill: '#64748b' }}
            tickLine={false}
            interval={2}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            width={28}
            unit="%"
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${v.toFixed(1)}%` : '--',
              String(name).replace('eu_avg', 'EU avg').toUpperCase(),
            ]}
            labelFormatter={(l) => String(l)}
          />
          {(['es', 'fr', 'de', 'nl', 'eu_avg'] as const).map((k) => (
            <Line
              key={k}
              dataKey={k}
              stroke={NEG_ZONE_COLORS[k]}
              strokeWidth={k === 'eu_avg' ? 1 : 1.5}
              strokeDasharray={k === 'eu_avg' ? '4 2' : undefined}
              dot={false}
              isAnimationActive={false}
              name={k}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-2">
        {([['es', 'ES'], ['fr', 'FR'], ['de', 'DE-LU'], ['nl', 'NL'], ['eu_avg', 'EU avg']] as const).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-3 h-0.5 rounded inline-block" style={{ background: NEG_ZONE_COLORS[k], opacity: k === 'eu_avg' ? 0.6 : 1 }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function NegHoursZoneRanking({ rows }: { rows: NegHoursZoneRow[] }) {
  if (!rows.length) return null
  const maxPct = rows[0].neg_pct_30d

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">
        Negative price hours by zone - 30-day ranking
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        % of hours with DA price below zero, trailing 30 days. Solar oversupply drives the leaders.
      </p>
      <div className="space-y-1">
        {rows.map((r) => {
          const barW = maxPct > 0 ? (r.neg_pct_30d / maxPct) * 100 : 0
          const color = r.neg_pct_30d >= 15 ? '#f87171' : r.neg_pct_30d >= 8 ? '#fbbf24' : '#4ade80'
          return (
            <div key={r.zone} className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground w-12 shrink-0 text-right">{r.zone}</span>
              <div className="flex-1 h-3 bg-secondary rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{ width: `${barW}%`, background: color }}
                />
              </div>
              <span className="text-xs tabular-nums w-10 shrink-0 text-right" style={{ color }}>
                {r.neg_pct_30d.toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthlyFuelMixSeasonality({ rows }: { rows: MonthlyFuelMixRow[] }) {
  if (!rows.length) return null

  const chartData = rows.map((r) => ({
    month: MONTH_ABBR[r.month - 1] ?? String(r.month),
    solar: r.solar_pct,
    wind: r.wind_pct,
    hydro: r.hydro_pct,
    nuclear: r.nuclear_pct,
    gas: r.gas_pct,
    coal: r.coal_pct,
    biomass: r.biomass_pct,
    other: r.other_pct,
  }))

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">
        EU-34 fuel mix seasonality - monthly average share (2022+)
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Stacked % of total generation. Solar peaks Jun-Aug (~18%), wind peaks Jan-Feb (~21%). Nuclear is flat year-round (~24%).
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => [
              v != null ? `${(Number(v) * 100).toFixed(1)}%` : '--',
              String(name),
            ]}
          />
          {(['coal', 'gas', 'other', 'biomass', 'hydro', 'nuclear', 'wind', 'solar'] as const).map((f) => (
            <Area
              key={f}
              type="monotone"
              dataKey={f}
              stackId="1"
              stroke={FUEL_COLORS[f] ?? '#94a3b8'}
              fill={FUEL_COLORS[f] ?? '#94a3b8'}
              fillOpacity={0.85}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-2">
        {(['solar', 'wind', 'nuclear', 'hydro', 'gas', 'coal', 'biomass'] as const).map((f) => (
          <span key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: FUEL_COLORS[f] }} />
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

function ZonePriceReCorrChart({ rows }: { rows: ZonePriceReCorrRow[] }) {
  if (!rows.length) return null
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.corr)), 0.01)

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">Merit-order strength by zone (1yr)</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Pearson r: daily base price vs renewable %. Negative = renewables suppress prices (merit order).
        Positive (NO hydro) = demand seasonality dominates.
      </p>
      <div className="space-y-1">
        {rows.map((r) => {
          const isNeg = r.corr < 0
          const barW = (Math.abs(r.corr) / maxAbs) * 50
          const color = isNeg
            ? r.corr < -0.6 ? '#f87171' : r.corr < -0.3 ? '#fbbf24' : '#94a3b8'
            : '#4ade80'
          return (
            <div key={r.zone} className="flex items-center gap-1">
              <span className="text-xs font-mono text-muted-foreground w-12 shrink-0 text-right">{r.zone}</span>
              <div className="flex-1 flex items-center h-3">
                {/* Center divider at 50% */}
                <div className="flex-1 flex justify-end">
                  {isNeg && (
                    <div className="h-3 rounded-l-sm" style={{ width: `${barW}%`, background: color }} />
                  )}
                </div>
                <div className="w-px h-3 bg-border mx-0.5 shrink-0" />
                <div className="flex-1">
                  {!isNeg && (
                    <div className="h-3 rounded-r-sm" style={{ width: `${barW}%`, background: color }} />
                  )}
                </div>
              </div>
              <span className="text-xs tabular-nums w-12 shrink-0 text-left pl-1" style={{ color }}>
                {r.corr >= 0 ? '+' : ''}{r.corr.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />r &lt; -0.6 (strong suppression)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />-0.6 to -0.3</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400 inline-block" />positive (NO/SE hydro)</span>
      </div>
    </div>
  )
}

const YEAR_COLORS: Record<number, string> = {
  2021: '#475569',
  2022: '#64748b',
  2023: '#f59e0b',
  2024: '#38bdf8',
  2025: '#4ade80',
  2026: '#f87171',
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function GenMonthlyChart({ rows }: { rows: GenMonthlyRow[] }) {
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort(), [rows])

  const byMonth = useMemo(() => {
    const m: Record<number, Record<number, number | null>> = {}
    for (const r of rows) {
      if (!m[r.month]) m[r.month] = {}
      m[r.month][r.year] = r.renewable_pct
    }
    return m
  }, [rows])

  const chartData = Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1
    const entry: Record<string, string | number | null> = { month: MONTH_SHORT[i] }
    for (const yr of years) {
      entry[String(yr)] = byMonth[mo]?.[yr] ?? null
    }
    return entry
  })

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">EU-34 Monthly Renewable % - year on year</h2>
        <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
          {years.map((yr) => (
            <span key={yr} className="flex items-center gap-1">
              <span
                className="inline-block w-5 rounded"
                style={{ background: YEAR_COLORS[yr] ?? '#94a3b8', height: 2, display: 'inline-block', width: 18, verticalAlign: 'middle' }}
              />
              {yr}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => `${v as number}%`}
            domain={[20, 80]}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => [
              v != null ? `${(v as number).toFixed(1)}%` : '--',
              name != null ? String(name) : '',
            ]}
          />
          {years.map((yr) => (
            <Line
              key={yr}
              type="monotone"
              dataKey={String(yr)}
              stroke={YEAR_COLORS[yr] ?? '#94a3b8'}
              strokeWidth={yr === new Date().getFullYear() ? 2 : 1.5}
              strokeOpacity={yr === new Date().getFullYear() ? 1 : 0.8}
              dot={{ r: 2, fill: YEAR_COLORS[yr] ?? '#94a3b8' }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">
        Capacity-weighted EU average. Clear seasonal pattern: high in summer (solar) and spring (hydro/wind). Current year is partial.
      </p>
    </div>
  )
}

function EuCarbonIntensityChart({ rows }: { rows: EuCiDailyPoint[] }) {
  const recent = rows.slice(-180)

  const ciAvg = recent.reduce((s, r) => s + (r.ci_gco2_kwh ?? 0), 0) / (recent.filter((r) => r.ci_gco2_kwh != null).length || 1)

  const chartData = recent.map((r) => ({
    date: r.gen_date.slice(5),
    ci: r.ci_gco2_kwh != null ? Math.round(r.ci_gco2_kwh) : null,
    re: r.re_pct,
    fossil: r.fossil_pct,
  }))

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-muted-foreground">EU-34 Carbon Intensity (last 180 days)</h2>
        <span className="text-xs text-muted-foreground">IPCC factors: coal 820, gas 490, oil 650 gCO2/kWh</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        180-day avg: {Math.round(ciAvg)} gCO2/kWh. Low wind = more fossil dispatch = higher CI and higher prices.
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} interval={29} />
          <YAxis
            yAxisId="ci"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => `${v as number}`}
          />
          <YAxis
            yAxisId="re"
            orientation="right"
            tick={{ fontSize: 10, fill: '#4ade80' }}
            tickLine={false}
            axisLine={false}
            width={32}
            tickFormatter={(v) => `${v as number}%`}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => {
              const n = name != null ? String(name) : ''
              if (n === 'ci') return [`${v as number} gCO2/kWh`, 'Carbon intensity']
              if (n === 're') return [`${v as number}%`, 'Renewable %']
              if (n === 'fossil') return [`${v as number}%`, 'Fossil %']
              return [String(v), n]
            }}
          />
          <ReferenceLine yAxisId="ci" y={Math.round(ciAvg)} stroke="#475569" strokeDasharray="4 4" label={{ value: 'avg', fill: '#475569', fontSize: 9, position: 'left' }} />
          <Area yAxisId="ci" type="monotone" dataKey="ci" fill="#f87171" fillOpacity={0.15} stroke="#f87171" strokeWidth={1.5} dot={false} />
          <Line yAxisId="re" type="monotone" dataKey="re" stroke="#4ade80" strokeWidth={1.5} dot={false} strokeOpacity={0.7} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span><span className="inline-block w-3 h-0.5 bg-red-400 mr-1.5" style={{ display: 'inline-block', verticalAlign: 'middle' }} />Carbon intensity (gCO2/kWh, left)</span>
        <span><span className="inline-block w-3 h-0.5 bg-green-400 mr-1.5" style={{ display: 'inline-block', verticalAlign: 'middle' }} />Renewable % (right)</span>
      </div>
    </div>
  )
}

const ZONE_LABELS: Record<string, string> = {
  'AT': 'Austria', 'BE': 'Belgium', 'BG': 'Bulgaria', 'CZ': 'Czechia', 'DE-LU': 'Germany',
  'DK-1': 'DK West', 'DK-2': 'DK East', 'EE': 'Estonia', 'ES': 'Spain', 'FI': 'Finland',
  'FR': 'France', 'GR': 'Greece', 'HR': 'Croatia', 'HU': 'Hungary', 'IE-SEM': 'Ireland',
  'IT-NORD': 'Italy N', 'LT': 'Lithuania', 'LV': 'Latvia', 'NL': 'Netherlands',
  'NO-1': 'Norway S', 'NO-2': 'Norway SW', 'NO-3': 'Norway MW', 'NO-4': 'Norway N',
  'NO-5': 'Norway W', 'PL': 'Poland', 'PT': 'Portugal', 'RO': 'Romania', 'SE-1': 'Sweden N',
  'SE-2': 'Sweden NC', 'SE-3': 'Sweden SC', 'SE-4': 'Sweden S', 'SI': 'Slovenia', 'SK': 'Slovakia',
}

function ZoneCfChart({ rows }: { rows: ZoneCfRow[] }) {
  const [mode, setMode] = useState<'wind' | 'solar'>('wind')

  const chartData = useMemo(() => {
    return [...rows]
      .filter((r) => (mode === 'wind' ? (r.wind_installed_mw ?? 0) > 500 : (r.solar_installed_mw ?? 0) > 500))
      .sort((a, b) => {
        const av = mode === 'wind' ? (a.wind_cf ?? 0) : (a.solar_cf ?? 0)
        const bv = mode === 'wind' ? (b.wind_cf ?? 0) : (b.solar_cf ?? 0)
        return bv - av
      })
      .map((r) => ({
        zone: ZONE_LABELS[r.zone] ?? r.zone,
        value: mode === 'wind' ? r.wind_cf : r.solar_cf,
        installed: mode === 'wind' ? (r.wind_installed_mw ?? 0) / 1000 : (r.solar_installed_mw ?? 0) / 1000,
      }))
  }, [rows, mode])

  const color = mode === 'wind' ? '#38bdf8' : '#fbbf24'

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Zone Capacity Factors - Latest Day (%)</h2>
        <div className="flex gap-1 ml-auto">
          {(['wind', 'solar'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded text-xs ${m === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
            >
              {m === 'wind' ? 'Wind' : 'Solar'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Actual generation / installed capacity. Zones with &lt;500 MW installed excluded.
      </p>
      <ResponsiveContainer width="100%" height={Math.max(chartData.length * 18, 160)}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 40, bottom: 2, left: 64 }}>
          <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} unit="%" domain={[0, 100]} />
          <YAxis type="category" dataKey="zone" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} width={60} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v, _name, props) => {
              const n = typeof v === 'number' ? v : null
              const installed = (props.payload as { installed: number }).installed
              return [
                n != null ? `${n.toFixed(1)}% CF  (${installed.toFixed(1)} GW installed)` : '--',
                mode === 'wind' ? 'Wind CF' : 'Solar CF',
              ]
            }}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          />
          <Bar dataKey="value" fill={color} fillOpacity={0.8} radius={[0, 2, 2, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const YEAR_DOT_COLORS: Record<number, string> = {
  2024: '#64748b',
  2025: '#3b82f6',
  2026: '#f59e0b',
}

function EuPriceReScatter({ rows }: { rows: EuPriceRePoint[] }) {
  // Group by year and build scatter series
  const byYear = useMemo(() => {
    const groups: Record<number, { re_pct: number; eu_avg_eur: number; price_date: string }[]> = {}
    for (const r of rows) {
      if (r.re_pct == null || r.eu_avg_eur == null) continue
      const yr = parseInt(r.price_date.slice(0, 4))
      if (!groups[yr]) groups[yr] = []
      groups[yr].push({ re_pct: r.re_pct, eu_avg_eur: r.eu_avg_eur, price_date: r.price_date })
    }
    return groups
  }, [rows])

  const years = Object.keys(byYear).map(Number).sort()

  // Compute Pearson correlation
  const corr = useMemo(() => {
    const valid = rows.filter((r) => r.re_pct != null && r.eu_avg_eur != null)
    if (valid.length < 5) return null
    const xs = valid.map((r) => r.re_pct as number)
    const ys = valid.map((r) => r.eu_avg_eur as number)
    const mx = xs.reduce((a, b) => a + b) / xs.length
    const my = ys.reduce((a, b) => a + b) / ys.length
    const num = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0)
    const den = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0))
    return den > 0 ? num / den : null
  }, [rows])

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h2 className="text-sm font-medium text-muted-foreground">Merit Order Effect: RE% vs EU Avg Price</h2>
        {corr != null && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded" style={{ color: corr < -0.3 ? '#f87171' : '#64748b' }}>
            r = {corr.toFixed(2)}
          </span>
        )}
        <div className="ml-auto flex gap-3">
          {years.map((yr) => (
            <span key={yr} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: YEAR_DOT_COLORS[yr] ?? '#94a3b8' }} />
              {yr}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Each dot = one day. X = EU renewable % (wind+solar+hydro), Y = EU avg day-ahead base price.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 4, right: 16, bottom: 20, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            type="number"
            dataKey="re_pct"
            name="RE%"
            unit="%"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            label={{ value: 'Renewable %', position: 'insideBottomRight', offset: -4, style: { fontSize: 9, fill: '#64748b' } }}
            domain={[0, 100]}
          />
          <YAxis
            type="number"
            dataKey="eu_avg_eur"
            name="Price"
            unit=" €"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <ZAxis range={[12, 12]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#475569' }}
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0]?.payload as { re_pct: number; eu_avg_eur: number; price_date: string }
              return (
                <div className="bg-card border border-border rounded px-2 py-1.5 text-xs shadow">
                  <p className="text-muted-foreground">{d.price_date}</p>
                  <p>RE: <span className="text-foreground font-medium">{d.re_pct.toFixed(1)}%</span></p>
                  <p>Price: <span className="text-foreground font-medium">{d.eu_avg_eur.toFixed(1)} €/MWh</span></p>
                </div>
              )
            }}
          />
          {years.map((yr) => (
            <Scatter
              key={yr}
              name={String(yr)}
              data={byYear[yr]}
              fill={YEAR_DOT_COLORS[yr] ?? '#94a3b8'}
              fillOpacity={0.55}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function EuDuckCurveChart({ rows }: { rows: EuDuckCurvePoint[] }) {
  const data = rows.map((r) => ({
    h: `${r.hour.toString().padStart(2, '0')}h`,
    avg: r.avg_eur,
    p25: r.p25_eur,
    p75: r.p75_eur,
    neg_pct: r.neg_pct,
  }))
  const minHour = rows.find((r) => r.avg_eur != null && r.avg_eur === Math.min(...rows.map((x) => x.avg_eur ?? Infinity)))
  const maxNeg = rows.reduce((a, b) => (b.neg_pct ?? 0) > (a.neg_pct ?? 0) ? b : a, rows[0])
  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <div className="flex flex-wrap items-center gap-4 mb-2">
        <h2 className="text-sm font-medium text-muted-foreground">EU-34 Duck Curve - Avg Hourly Price Profile (30d trailing)</h2>
        {minHour && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">
            Trough: {minHour.hour.toString().padStart(2, '0')}:00 ({minHour.avg_eur?.toFixed(0)} €/MWh)
          </span>
        )}
        {maxNeg && (maxNeg.neg_pct ?? 0) > 1 && (
          <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">
            Peak neg: {maxNeg.hour.toString().padStart(2, '0')}:00 ({maxNeg.neg_pct?.toFixed(0)}% hrs)
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-2">Avg (blue), IQR band. Red bars = negative price frequency. Solar trough at midday confirms duck curve.</p>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="h" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={3} />
          <YAxis yAxisId="price" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={36} unit="€" />
          <YAxis yAxisId="neg" orientation="right" tick={{ fontSize: 8, fill: '#f8717180' }} tickLine={false} width={28} unit="%" domain={[0, 'auto']} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null
              if (name === 'p25') return [n != null ? `${n.toFixed(0)} €` : '--', 'P25']
              if (name === 'p75') return [n != null ? `${n.toFixed(0)} €` : '--', 'P75']
              if (name === 'avg') return [n != null ? `${n.toFixed(0)} €/MWh` : '--', 'Avg']
              if (name === 'neg_pct') return [n != null ? `${n.toFixed(1)}%` : '--', 'Neg hrs']
              return [String(v), String(name)]
            }}
          />
          <Area yAxisId="price" type="monotone" dataKey="p75" stroke="none" fill="#38bdf8" fillOpacity={0.12} legendType="none" />
          <Area yAxisId="price" type="monotone" dataKey="p25" stroke="none" fill="#0f1117" fillOpacity={1} legendType="none" />
          <Line yAxisId="price" type="monotone" dataKey="avg" stroke="#38bdf8" strokeWidth={2} dot={false} />
          <Bar yAxisId="neg" dataKey="neg_pct" fill="#f87171" opacity={0.4} />
          <ReferenceLine yAxisId="price" y={0} stroke="#475569" strokeDasharray="2 2" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const ZONE_PROFILE_COLORS: Record<string, string> = {
  'DE-LU': '#60a5fa',
  'FR':    '#4ade80',
  'ES':    '#f97316',
  'NO-2':  '#a78bfa',
  'IT-NORD': '#facc15',
  'NL':    '#38bdf8',
}
const ZONE_PROFILE_DEFAULT = ['DE-LU', 'FR', 'ES', 'NO-2']

function ZoneHourlyComparisonChart({ rows }: { rows: ZoneHourlyProfileRow[] }) {
  const allZones = useMemo(() => [...new Set(rows.map((r) => r.zone))].sort(), [rows])
  const [selected, setSelected] = useState<string[]>(ZONE_PROFILE_DEFAULT)

  const byZone = useMemo(() => {
    const m: Record<string, ZoneHourlyProfileRow[]> = {}
    for (const r of rows) {
      if (!m[r.zone]) m[r.zone] = []
      m[r.zone].push(r)
    }
    return m
  }, [rows])

  const chartData = useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => {
      const entry: Record<string, number | null> = { hour: h }
      for (const z of selected) {
        entry[z] = byZone[z]?.find((r) => r.hour === h)?.avg_eur ?? null
      }
      return entry
    })
  }, [byZone, selected])

  const toggle = (z: string) =>
    setSelected((prev) =>
      prev.includes(z) ? (prev.length > 1 ? prev.filter((x) => x !== z) : prev) : [...prev, z]
    )

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-1">
        Zone hourly DA price profile - 30-day average (€/MWh)
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Average price by hour of day, trailing 30 days. The solar duck curve depth varies by zone:
        DE-LU/ES have a deep midday trough; nuclear-dominated FR has a flatter profile; NO-2 (hydro)
        stays high during heating hours.
      </p>
      <div className="flex flex-wrap gap-1 mb-3">
        {allZones.map((z) => (
          <button
            key={z}
            onClick={() => toggle(z)}
            className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
              selected.includes(z)
                ? 'text-background font-medium'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
            style={selected.includes(z) ? { background: ZONE_PROFILE_COLORS[z] ?? '#94a3b8' } : undefined}
          >
            {z}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(h: number) => `${String(h).padStart(2, '0')}:00`}
            ticks={[0, 4, 8, 12, 16, 20, 23]}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            unit=" €"
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => [
              v != null ? `${Number(v).toFixed(1)} €/MWh` : '--',
              name != null ? String(name) : '',
            ]}
            labelFormatter={(h: unknown) => `${String(Number(h)).padStart(2, '0')}:00`}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          {selected.map((z) => (
            <Line
              key={z}
              type="monotone"
              dataKey={z}
              stroke={ZONE_PROFILE_COLORS[z] ?? '#94a3b8'}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function GenerationTrends() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gen-trends'],
    queryFn: api.genTrends,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: euHourlyData } = useQuery({
    queryKey: ['gen-eu-hourly'],
    queryFn: api.genEuHourly,
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  })

  const { data: euFuelData } = useQuery({
    queryKey: ['gen-eu-annual'],
    queryFn: api.genEuAnnual,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: euMonthlyData } = useQuery({
    queryKey: ['gen-eu-monthly'],
    queryFn: api.genEuMonthly,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: euCiData } = useQuery({
    queryKey: ['gen-eu-ci'],
    queryFn: api.genEuCarbonIntensity,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: zoneCfData } = useQuery({
    queryKey: ['gen-zones-cf'],
    queryFn: api.genZonesCf,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: priceReData } = useQuery({
    queryKey: ['gen-eu-price-re'],
    queryFn: api.genEuPriceRe,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: duckCurveData } = useQuery({
    queryKey: ['power-hourly-profile-eu'],
    queryFn: api.powerHourlyProfileEu,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: capacityData } = useQuery({
    queryKey: ['gen-capacity-annual'],
    queryFn: api.genCapacityAnnual,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const { data: negHoursData } = useQuery({
    queryKey: ['power-neg-hours-monthly'],
    queryFn: api.powerNegHoursMonthly,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: negHoursZoneData } = useQuery({
    queryKey: ['power-neg-hours-zones'],
    queryFn: api.powerNegHoursZones,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: priceReCorrData } = useQuery({
    queryKey: ['gen-zone-price-re-corr'],
    queryFn: api.genZonePriceReCorr,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const { data: monthlyFuelMixData } = useQuery({
    queryKey: ['gen-eu-monthly-fuel-mix'],
    queryFn: api.genEuMonthlyFuelMix,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const { data: hourlyProfilesData } = useQuery({
    queryKey: ['power-hourly-profiles-all'],
    queryFn: api.powerHourlyProfilesAll,
    staleTime: 6 * 60 * 60 * 1000,
  })

  // Build lookup: zone -> year -> renewable_pct
  const lookup = useMemo(() => {
    const m: Record<string, Record<number, number | null>> = {}
    for (const r of data?.rows ?? []) {
      if (!m[r.zone]) m[r.zone] = {}
      m[r.zone][r.year] = r.renewable_pct
    }
    return m
  }, [data])

  // Change from 2021 to latest year (for badge)
  const change = (zone: string): number | null => {
    const yrMap = lookup[zone]
    if (!yrMap) return null
    const years = Object.keys(yrMap).map(Number).sort()
    if (years.length < 2) return null
    const first = yrMap[years[0]]
    const last = yrMap[years[years.length - 1]]
    if (first == null || last == null) return null
    return last - first
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading generation trends...
      </div>
    )
  }

  if (error || !data || data.zones.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Generation data unavailable.
      </div>
    )
  }

  const { zones, years } = data

  return (
    <div className="p-4 h-full overflow-y-auto">
      {(euHourlyData?.rows.length ?? 0) > 0 && <EuGenHourlyChart rows={euHourlyData!.rows} />}
      {(euFuelData?.rows.length ?? 0) > 0 && <EuFuelMixChart rows={euFuelData!.rows} />}
      {(monthlyFuelMixData?.rows.length ?? 0) > 0 && <MonthlyFuelMixSeasonality rows={monthlyFuelMixData!.rows} />}
      {(capacityData?.rows.length ?? 0) > 0 && <EuCapacityChart rows={capacityData!.rows} />}
      {(negHoursData?.rows.length ?? 0) > 0 && <NegHoursMonthlyChart rows={negHoursData!.rows} />}
      {(negHoursZoneData?.rows.length ?? 0) > 0 && <NegHoursZoneRanking rows={negHoursZoneData!.rows} />}
      {(euMonthlyData?.rows.length ?? 0) > 0 && <GenMonthlyChart rows={euMonthlyData!.rows} />}
      {(euCiData?.rows.length ?? 0) > 0 && <EuCarbonIntensityChart rows={euCiData!.rows} />}
      {(duckCurveData?.rows.length ?? 0) > 0 && <EuDuckCurveChart rows={duckCurveData!.rows} />}
      {(hourlyProfilesData?.rows.length ?? 0) > 0 && <ZoneHourlyComparisonChart rows={hourlyProfilesData!.rows} />}
      {(zoneCfData?.rows.length ?? 0) > 0 && <ZoneCfChart rows={zoneCfData!.rows} />}
      {(priceReData?.rows.length ?? 0) > 0 && <EuPriceReScatter rows={priceReData!.rows} />}
      {(priceReCorrData?.rows.length ?? 0) > 0 && <ZonePriceReCorrChart rows={priceReCorrData!.rows} />}

      <div className="mb-4">
        <h1 className="text-base font-semibold">Renewable Generation Trends</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Annual average renewable % per bidding zone - wind + solar + hydro + biomass. Sorted by latest year.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5 min-w-max">
          <thead>
            <tr>
              <th className="text-left text-muted-foreground font-normal pr-3 pb-1 whitespace-nowrap">Zone</th>
              {years.map((y) => (
                <th key={y} className="text-center text-muted-foreground font-normal px-1 pb-1 min-w-[52px]">
                  {y === new Date().getFullYear() ? `${y}*` : y}
                </th>
              ))}
              <th className="text-center text-muted-foreground font-normal px-1 pb-1 whitespace-nowrap">
                5yr change
              </th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => {
              const delta = change(zone)
              return (
                <tr key={zone}>
                  <td className="text-muted-foreground pr-3 py-0.5 font-mono whitespace-nowrap">{zone}</td>
                  {years.map((yr) => {
                    const pct = lookup[zone]?.[yr] ?? null
                    return (
                      <td key={yr} className="text-center py-0.5 rounded" style={{ minWidth: 52 }}>
                        <div
                          className="rounded px-1 py-1 text-center font-medium"
                          style={{
                            backgroundColor: reColor(pct),
                            color: textColor(pct),
                          }}
                          title={`${zone} ${yr}: ${pct != null ? pct.toFixed(1) + '%' : 'n/a'}`}
                        >
                          {pct != null ? `${pct.toFixed(0)}%` : '--'}
                        </div>
                      </td>
                    )
                  })}
                  <td className="text-center py-0.5 px-1">
                    {delta != null && (
                      <span
                        className="font-semibold"
                        style={{ color: delta >= 0 ? '#4ade80' : '#f87171' }}
                      >
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(0)}pp
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden">
            {[0, 20, 40, 60, 80, 100].map((v) => (
              <div
                key={v}
                className="w-6 h-3"
                style={{ backgroundColor: reColor(v) }}
                title={`${v}%`}
              />
            ))}
          </div>
          <span>0% &rarr; 100% renewable</span>
        </div>
        <span>* Partial year (YTD average)</span>
      </div>
    </div>
  )
}
