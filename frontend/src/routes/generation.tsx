import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api, type EuAnnualFuelRow, type GenMonthlyRow, type EuCiDailyPoint, type ZoneCfRow, type EuPriceRePoint, type EuGenHourlyPoint } from '@/lib/api'
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
      {(euMonthlyData?.rows.length ?? 0) > 0 && <GenMonthlyChart rows={euMonthlyData!.rows} />}
      {(euCiData?.rows.length ?? 0) > 0 && <EuCarbonIntensityChart rows={euCiData!.rows} />}
      {(zoneCfData?.rows.length ?? 0) > 0 && <ZoneCfChart rows={zoneCfData!.rows} />}
      {(priceReData?.rows.length ?? 0) > 0 && <EuPriceReScatter rows={priceReData!.rows} />}

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
