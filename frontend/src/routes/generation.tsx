import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, type EuAnnualFuelRow, type GenMonthlyRow, type EuCiDailyPoint } from '@/lib/api'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
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

function GenerationTrends() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['gen-trends'],
    queryFn: api.genTrends,
    staleTime: 6 * 60 * 60 * 1000,
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
      {(euFuelData?.rows.length ?? 0) > 0 && <EuFuelMixChart rows={euFuelData!.rows} />}
      {(euMonthlyData?.rows.length ?? 0) > 0 && <GenMonthlyChart rows={euMonthlyData!.rows} />}
      {(euCiData?.rows.length ?? 0) > 0 && <EuCarbonIntensityChart rows={euCiData!.rows} />}

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
