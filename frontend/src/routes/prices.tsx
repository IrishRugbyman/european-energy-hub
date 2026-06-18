import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts'
import { api, type PricesDailyPoint, type PriceRegimePoint, type TtfCurvePoint, type TtfSeasonalMonth } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'
import { cutoffDate, latestNonNull, type DateWindow } from '@/lib/utils'

export const Route = createFileRoute('/prices')({
  component: PricesDashboard,
})

type Window = DateWindow
const WINDOWS: Window[] = ['1Y', '2Y', '5Y', 'ALL']

const latest = (rows: PricesDailyPoint[], key: keyof PricesDailyPoint) => latestNonNull(rows, key)

const SERIES = [
  { key: 'ttf_eur_mwh',  label: 'TTF (€/MWh)',       color: '#60a5fa', unit: '€/MWh'   },
  { key: 'nbp_eur_mwh',  label: 'NBP (€/MWh)',        color: '#a78bfa', unit: '€/MWh'   },
  { key: 'eua_eur_t',    label: 'EUA (€/tCO2)',       color: '#34d399', unit: '€/t'     },
  { key: 'coal_usd_t',   label: 'Coal ($/t)',          color: '#f59e0b', unit: '$/t'     },
  { key: 'hh_usd_mmbtu', label: 'Henry Hub ($/MMBtu)', color: '#f87171', unit: '$/MMBtu' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

// Pearson correlation between two arrays of equal length (no nulls)
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 5) return NaN
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2)
}

function correlationColor(r: number): string {
  if (isNaN(r)) return '#374151'
  if (r > 0.7)  return '#15803d'
  if (r > 0.4)  return '#65a30d'
  if (r > 0.1)  return '#4b5563'
  if (r > -0.1) return '#4b5563'
  if (r > -0.4) return '#b45309'
  if (r > -0.7) return '#d97706'
  return '#b91c1c'
}

function computeIndexed(
  rows: (PricesDailyPoint & { label: string })[],
): (PricesDailyPoint & { label: string })[] {
  const bases: Partial<Record<SeriesKey, number>> = {}
  for (const row of rows) {
    for (const { key } of SERIES) {
      if (bases[key] == null) {
        const v = row[key as keyof PricesDailyPoint]
        if (v != null && (v as number) !== 0) bases[key] = v as number
      }
    }
    if (SERIES.every(({ key }) => bases[key] != null)) break
  }
  return rows.map((row) => {
    const out: PricesDailyPoint & { label: string } = { ...row }
    for (const { key } of SERIES) {
      const base = bases[key]
      const v = row[key as keyof PricesDailyPoint]
      if (base != null && v != null) {
        ;(out as unknown as Record<string, unknown>)[key] = ((v as number) / base) * 100
      }
    }
    return out
  })
}

function PricesTooltip({
  active,
  payload,
  label,
  indexed,
}: {
  active?: boolean
  payload?: { dataKey: string; value: number }[]
  label?: string
  indexed: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {SERIES.map(({ key, label: name, color, unit }) => {
        const entry = payload.find((p) => p.dataKey === key)
        if (!entry || entry.value == null) return null
        const val = entry.value
        return (
          <p key={key} style={{ color }}>
            {name}: {indexed ? `${val.toFixed(1)} (idx)` : `${val.toFixed(2)} ${unit}`}
          </p>
        )
      })}
    </div>
  )
}

function PricesChart({
  rows,
  window: w,
  indexed,
}: {
  rows: PricesDailyPoint[]
  window: Window
  indexed: boolean
}) {
  const cutoff = cutoffDate(w)
  const data = useMemo(() => {
    const filtered = cutoff ? rows.filter((r) => r.price_date >= cutoff) : rows
    const step = Math.max(1, Math.floor(filtered.length / 500))
    const sampled = filtered
      .filter((_, i) => i % step === 0 || i === filtered.length - 1)
      .map((r) => ({ ...r, label: r.price_date.slice(0, 10) }))
    return indexed ? computeIndexed(sampled) : sampled
  }, [rows, cutoff, indexed])

  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          label={
            indexed
              ? { value: 'Indexed (base=100)', angle: -90, position: 'insideLeft', offset: 12, style: { fontSize: 9, fill: '#64748b' } }
              : undefined
          }
          width={indexed ? 52 : 36}
        />
        <Tooltip content={<PricesTooltip indexed={indexed} />} />
        {indexed && <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 2" />}
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {SERIES.map(({ key, label, color }) => (
          <Line
            key={key}
            dataKey={key}
            name={label}
            stroke={color}
            dot={false}
            strokeWidth={1.5}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// Rolling 90d Pearson correlations among TTF, NBP, EUA, Coal
function CorrelationMatrix({ rows }: { rows: PricesDailyPoint[] }) {
  const pairs = useMemo(() => {
    const recent = rows.slice(-90)
    const valid = recent.filter(
      (r) => r.ttf_eur_mwh != null && r.nbp_eur_mwh != null && r.eua_eur_t != null && r.coal_usd_t != null,
    )
    const xs  = valid.map((r) => r.ttf_eur_mwh as number)
    const nbp = valid.map((r) => r.nbp_eur_mwh as number)
    const ys  = valid.map((r) => r.eua_eur_t as number)
    const zs  = valid.map((r) => r.coal_usd_t as number)
    return [
      { label: 'TTF / NBP',  r: pearson(xs, nbp) },
      { label: 'TTF / EUA',  r: pearson(xs, ys) },
      { label: 'TTF / Coal', r: pearson(xs, zs) },
      { label: 'NBP / EUA',  r: pearson(nbp, ys) },
      { label: 'NBP / Coal', r: pearson(nbp, zs) },
      { label: 'EUA / Coal', r: pearson(ys, zs) },
    ]
  }, [rows])

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">90-day rolling correlation</h2>
      <div className="grid grid-cols-3 gap-3">
        {pairs.map(({ label, r }) => {
          const color = correlationColor(r)
          return (
            <div key={label} className="bg-secondary rounded p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-xl font-semibold" style={{ color }}>
                {isNaN(r) ? '--' : r.toFixed(2)}
              </p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-2">Green = co-move, red = diverge, based on last 90 trading days</p>
    </div>
  )
}

// TTF vs EUA scatter, last 365 days, colored by year
function TtfEuaScatter({ rows }: { rows: PricesDailyPoint[] }) {
  const { byYear, years } = useMemo(() => {
    const cutStr = cutoffDate('1Y')
    const valid = rows.filter((r) => (cutStr == null || r.price_date >= cutStr) && r.ttf_eur_mwh != null && r.eua_eur_t != null)
    const yMap = new Map<number, { ttf: number; eua: number }[]>()
    for (const r of valid) {
      const y = parseInt(r.price_date.slice(0, 4))
      if (!yMap.has(y)) yMap.set(y, [])
      yMap.get(y)!.push({ ttf: r.ttf_eur_mwh as number, eua: r.eua_eur_t as number })
    }
    const sortedYears = Array.from(yMap.keys()).sort()
    return { byYear: yMap, years: sortedYears }
  }, [rows])

  const YEAR_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa']

  if (years.length === 0) return null

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">TTF vs EUA scatter (trailing 12 months)</h2>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="ttf"
            name="TTF"
            unit=" €/MWh"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            label={{ value: 'TTF (€/MWh)', position: 'insideBottom', offset: -4, style: { fontSize: 10, fill: '#64748b' } }}
          />
          <YAxis
            dataKey="eua"
            name="EUA"
            unit=" €/t"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            width={40}
            label={{ value: 'EUA (€/t)', angle: -90, position: 'insideLeft', offset: 8, style: { fontSize: 10, fill: '#64748b' } }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v, name) => [`${(v as number).toFixed(1)}`, String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          {years.map((y, i) => (
            <Scatter
              key={y}
              name={String(y)}
              data={byYear.get(y)!}
              fill={YEAR_COLORS[i % YEAR_COLORS.length]}
              opacity={0.7}
              shape="circle"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

// TTF monthly seasonality: 5yr avg vs current year
const Y_CAP = 150 // cap axis at 150 to prevent 2022 crisis spikes from distorting IQR

function TtfSeasonality({ months }: { months: TtfSeasonalMonth[] }) {
  const data = useMemo(() => {
    return months.map((m) => ({
      label: m.label,
      // Stacked bar approach for IQR box: invisible base (0 to p25) + amber box (p25 to p75)
      base: m.p25 ?? 0,
      iqr: m.p25 != null && m.p75 != null ? Math.min(m.p75, Y_CAP) - m.p25 : null,
      // Thin whisker bars: (0 to min) transparent + (min to p25) gray lower whisker
      wbase: m.min ?? 0,
      wlow: m.p25 != null && m.min != null ? m.p25 - Math.max(m.min, 0) : null,
      // Upper whisker above p75
      wtop: m.p75 ?? 0,
      whigh: m.p75 != null && m.max != null ? Math.min(m.max, Y_CAP) - m.p75 : null,
      median: m.median,
      current: m.current != null ? Math.min(m.current, Y_CAP) : null,
      _raw: m,
    }))
  }, [months])

  if (!months.some((m) => m.n_years > 0)) return null

  const f = (v: number | null | undefined) =>
    v != null ? `${v.toFixed(1)} €/MWh` : '--'

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          TTF monthly seasonality - IQR box (€/MWh, historical 2019-present)
        </h2>
        <span className="text-xs text-muted-foreground">axis capped at {Y_CAP}</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={34}
            domain={[0, Y_CAP]}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const d = payload[0]?.payload as (typeof data)[0]
              const r = d._raw
              return (
                <div className="bg-card border border-border rounded p-2 text-xs space-y-0.5">
                  <p className="font-medium text-foreground mb-1">{label} ({r.n_years}yr)</p>
                  {r.current != null && (
                    <p className="text-sky-400">Current: {f(r.current)}</p>
                  )}
                  <p className="text-amber-400">Median: {f(r.median)}</p>
                  <p className="text-muted-foreground">IQR: {f(r.p25)} - {f(r.p75)}</p>
                  <p className="text-muted-foreground">Range: {f(r.min)} - {f(r.max)}{r.max != null && r.max > Y_CAP ? ' (capped)' : ''}</p>
                </div>
              )
            }}
          />
          {/* Lower whisker: transparent base + thin gray bar from min to p25 */}
          <Bar dataKey="wbase" stackId="wsk" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="wlow" stackId="wsk" fill="#475569" fillOpacity={0.7} barSize={3} isAnimationActive={false} legendType="none" />
          {/* IQR box: transparent base from 0 to p25, amber box from p25 to p75 */}
          <Bar dataKey="base" stackId="iqr" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="iqr" stackId="iqr" fill="#f59e0b" fillOpacity={0.35} radius={[2, 2, 0, 0]} isAnimationActive={false} name="IQR (p25-p75)" />
          {/* Upper whisker: transparent base at p75 + thin gray bar to max */}
          <Bar dataKey="wtop" stackId="upr" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="whigh" stackId="upr" fill="#475569" fillOpacity={0.7} barSize={3} isAnimationActive={false} legendType="none" />
          {/* Median as dots floating at the right height */}
          <Line
            dataKey="median"
            stroke="#f59e0b"
            strokeWidth={0}
            dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
            name="Median"
          />
          {/* Current month spot price as highlighted blue dot */}
          <Line
            dataKey="current"
            stroke="#38bdf8"
            strokeWidth={0}
            dot={{ r: 5, fill: '#38bdf8', stroke: '#0f1117', strokeWidth: 1.5 }}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
            name="Current"
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) =>
              value === 'IQR (p25-p75)' ? 'IQR p25-p75' :
              value === 'Median' ? 'Median' :
              value === 'Current' ? 'Current spot' : value
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// TTF minus NBP spread - the UK/EU gas basis
function TtfNbpSpread({ rows }: { rows: PricesDailyPoint[] }) {
  const data = useMemo(() => {
    const cutStr = cutoffDate('2Y')
    return rows
      .filter((r) => (cutStr == null || r.price_date >= cutStr) && r.ttf_eur_mwh != null && r.nbp_eur_mwh != null)
      .map((r) => ({
        label: r.price_date.slice(0, 10),
        spread: parseFloat(((r.ttf_eur_mwh as number) - (r.nbp_eur_mwh as number)).toFixed(2)),
      }))
  }, [rows])

  if (data.length === 0) return null

  const avg = data.reduce((a, b) => a + b.spread, 0) / data.length
  const latestSpread = data[data.length - 1]?.spread ?? null

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">TTF minus NBP basis (€/MWh, trailing 2Y)</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          Latest: <span className="font-semibold text-foreground">{latestSpread != null ? `${latestSpread > 0 ? '+' : ''}${latestSpread.toFixed(2)}` : '--'}</span>
          {' '}&bull;{' '}2Y avg: <span className="font-semibold text-foreground">{`${avg > 0 ? '+' : ''}${avg.toFixed(2)}`}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v) => [`${(v as number).toFixed(2)} €/MWh`, 'TTF - NBP']}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          <ReferenceLine y={avg} stroke="#a78bfa" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: 'avg', position: 'right', fontSize: 9, fill: '#a78bfa' }} />
          <Line dataKey="spread" name="TTF - NBP" stroke="#60a5fa" dot={false} strokeWidth={1.5} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">Positive = TTF premium over NBP (EU gas more expensive than UK)</p>
    </div>
  )
}

// TTF minus HH (converted to EUR/MWh) - the LNG arbitrage spread
function TtfHhSpread({ rows }: { rows: PricesDailyPoint[] }) {
  const data = useMemo(() => {
    const cutStr = cutoffDate('2Y')
    return rows
      .filter((r) => (cutStr == null || r.price_date >= cutStr) && r.ttf_eur_mwh != null && r.hh_eur_mwh != null)
      .map((r) => ({
        label: r.price_date.slice(0, 10),
        spread: parseFloat(((r.ttf_eur_mwh as number) - (r.hh_eur_mwh as number)).toFixed(2)),
      }))
  }, [rows])

  if (data.length === 0) return null

  const avg = data.reduce((a, b) => a + b.spread, 0) / data.length
  const latestSpread = data[data.length - 1]?.spread ?? null

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">TTF minus Henry Hub LNG spread (€/MWh, trailing 2Y)</h2>
        <span className="text-xs text-muted-foreground ml-auto">
          Latest: <span className="font-semibold text-foreground">{latestSpread != null ? `${latestSpread > 0 ? '+' : ''}${latestSpread.toFixed(2)}` : '--'}</span>
          {' '}&bull;{' '}2Y avg: <span className="font-semibold text-foreground">{`${avg > 0 ? '+' : ''}${avg.toFixed(2)}`}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v) => [`${(v as number).toFixed(2)} €/MWh`, 'TTF - HH (EUR equiv.)']}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
          <ReferenceLine y={avg} stroke="#a78bfa" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: 'avg', position: 'right', fontSize: 9, fill: '#a78bfa' }} />
          <Line dataKey="spread" name="TTF - HH" stroke="#fb923c" dot={false} strokeWidth={1.5} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">
        HH converted to EUR/MWh (1 MMBtu = 0.293 MWh). Positive = European gas more expensive than US; drives LNG exports to Europe.
      </p>
    </div>
  )
}

const TENOR_COLORS: Record<string, string> = {
  Q1: '#818cf8',
  Q2: '#818cf8',
  Q3: '#818cf8',
  Q4: '#818cf8',
  SUM: '#f59e0b',
  WIN: '#60a5fa',
  CAL: '#6ee7b7',
}


function TtfForwardCurve({ rows }: { rows: TtfCurvePoint[] }) {
  if (rows.length === 0) return null

  const spotApprox = rows[0]?.settlement ?? null

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">TTF forward curve (€/MWh)</h2>
        <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
          {[
            { label: 'Quarterly', color: TENOR_COLORS.Q1 },
            { label: 'Summer', color: TENOR_COLORS.SUM },
            { label: 'Winter', color: TENOR_COLORS.WIN },
            { label: 'Calendar', color: TENOR_COLORS.CAL },
          ].map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="contract"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v, _name, props) => [
              `${(v as number).toFixed(2)} €/MWh`,
              props.payload?.contract ?? '',
            ]}
            labelFormatter={() => ''}
          />
          {spotApprox != null && (
            <ReferenceLine
              y={spotApprox}
              stroke="#60a5fa"
              strokeDasharray="4 2"
              strokeOpacity={0.5}
              label={{ value: 'front', position: 'right', fontSize: 9, fill: '#60a5fa' }}
            />
          )}
          <Bar dataKey="settlement" name="Settlement" radius={[2, 2, 0, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={TENOR_COLORS[r.tenor_type] ?? '#94a3b8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">
        Dashed line = near-term contract. Backwardation = market expects prices to fall.
      </p>
    </div>
  )
}

function PriceRegimeCharts({ rows }: { rows: PriceRegimePoint[] }) {
  const [win, setWin] = useState<Window>('2Y')

  const filtered = useMemo(() => {
    const cut = cutoffDate(win)
    return cut ? rows.filter((r) => r.price_date >= cut) : rows
  }, [rows, win])

  const currentVol = rows.at(-1)?.ttf_vol_30d ?? null
  const currentCorr = rows.at(-1)?.ttf_eua_corr_90d ?? null
  const maxVol = useMemo(() => {
    let m = 0
    for (const r of rows) if (r.ttf_vol_30d != null && r.ttf_vol_30d > m) m = r.ttf_vol_30d
    return m > 0 ? m : null
  }, [rows])

  const fmt = (v: number | null, d = 1) => (v != null ? v.toFixed(d) : '--')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">Price Regime</h2>
        <div className="flex items-center gap-1">
          {(['1Y', '2Y', '5Y', 'ALL'] as Window[]).map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`px-2 py-0.5 rounded text-xs ${
                w === win
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap gap-6 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">TTF 30d vol (now)</p>
          <p className="text-sm font-semibold text-sky-400">{fmt(currentVol)} EUR/MWh ann.</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">TTF 30d vol (peak 2022)</p>
          <p className="text-sm font-semibold text-amber-400">{fmt(maxVol)} EUR/MWh ann.</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">TTF-EUA 90d corr (now)</p>
          <p
            className="text-sm font-semibold"
            style={{ color: currentCorr != null && currentCorr >= 0 ? '#34d399' : '#f87171' }}
          >
            {currentCorr != null ? fmt(currentCorr, 2) : '--'}
          </p>
        </div>
      </div>

      {/* Vol chart */}
      <p className="text-xs text-muted-foreground mb-1">TTF realized volatility (30d, EUR/MWh ann.)</p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={filtered} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="price_date"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v: string) => v.slice(0, 7)}
            minTickGap={60}
          />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={36} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v) => {
              const n = typeof v === 'number' ? v : null
              return n != null ? [`${n.toFixed(1)} EUR/MWh`, 'TTF vol'] : null
            }}
            labelFormatter={(l) => String(l).slice(0, 10)}
          />
          <Line type="monotone" dataKey="ttf_vol_30d" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="TTF vol" />
          <Line type="monotone" dataKey="eua_vol_30d" stroke="#34d399" strokeWidth={1} dot={false} strokeDasharray="3 2" name="EUA vol" />
        </LineChart>
      </ResponsiveContainer>

      {/* Correlation chart */}
      <p className="text-xs text-muted-foreground mt-3 mb-1">TTF-EUA 90d rolling Pearson correlation</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={filtered} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="price_date"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v: string) => v.slice(0, 7)}
            minTickGap={60}
          />
          <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={36} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v) => {
              const n = typeof v === 'number' ? v : null
              return n != null ? [n.toFixed(2), 'TTF-EUA corr'] : null
            }}
            labelFormatter={(l) => String(l).slice(0, 10)}
          />
          <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />
          <Line
            type="monotone"
            dataKey="ttf_eua_corr_90d"
            stroke="#a78bfa"
            strokeWidth={1.5}
            dot={false}
            name="TTF-EUA corr"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        <span><span className="inline-block w-3 h-0.5 bg-sky-400 mr-1 align-middle" />TTF vol (solid)</span>
        <span><span className="inline-block w-3 h-0.5 bg-emerald-400 mr-1 align-middle" />EUA vol (dashed)</span>
        <span><span className="inline-block w-3 h-0.5 bg-violet-400 mr-1 align-middle" />TTF-EUA corr (90d)</span>
      </div>
    </div>
  )
}

function PricesDashboard() {
  const [window, setWindow] = useState<Window>('2Y')
  const [indexed, setIndexed] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['prices'],
    queryFn: api.prices,
    staleTime: 15 * 60 * 1000,
  })

  const { data: curveData } = useQuery({
    queryKey: ['prices-curve'],
    queryFn: api.pricesCurve,
    staleTime: 15 * 60 * 1000,
  })

  const { data: seasonalityData } = useQuery({
    queryKey: ['prices-seasonality'],
    queryFn: api.pricesSeasonality,
    staleTime: 24 * 60 * 60 * 1000,
  })

  const { data: regimeData } = useQuery({
    queryKey: ['prices-regime'],
    queryFn: api.pricesRegime,
    staleTime: 60 * 60 * 1000,
  })

  const rows = data?.rows ?? []
  const curveRows = curveData?.rows ?? []

  return (
    <div className="p-4 h-full overflow-y-auto">
      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-6 mb-4">
        {SERIES.map(({ key, label, color, unit }) => {
          const v = latest(rows, key as keyof PricesDailyPoint)
          return (
            <div key={key} className="flex flex-col">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-sm font-semibold" style={{ color }}>
                {v != null ? `${v.toFixed(2)} ${unit}` : '-'}
              </span>
            </div>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setIndexed((v) => !v)}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              indexed
                ? 'bg-violet-900 border-violet-600 text-violet-200'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            Indexed
          </button>
          <span className="text-border text-muted-foreground">|</span>
          <div className="flex items-center gap-1">
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
      </div>

      <StaleBanner datasetKey="spreads" variant="inline" />

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error && <p className="text-destructive text-sm">API unavailable</p>}

      {rows.length > 0 && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-sm font-medium text-muted-foreground mb-3">
              Commodity Prices{indexed ? ' - Indexed to 100 at window start' : ''}
            </h2>
            <PricesChart rows={rows} window={window} indexed={indexed} />
          </div>

          {curveRows.length > 0 && <TtfForwardCurve rows={curveRows} />}
          <CorrelationMatrix rows={rows} />
          {(regimeData?.rows?.length ?? 0) > 0 && <PriceRegimeCharts rows={regimeData!.rows} />}
          <TtfNbpSpread rows={rows} />
          <TtfHhSpread rows={rows} />
          <TtfEuaScatter rows={rows} />
          <TtfSeasonality months={seasonalityData?.months ?? []} />
        </div>
      )}

      {rows.length === 0 && !isLoading && !error && (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          No price data available yet.
        </div>
      )}
    </div>
  )
}
