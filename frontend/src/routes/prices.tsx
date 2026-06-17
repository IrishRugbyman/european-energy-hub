import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
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
import { api, type PricesDailyPoint, type TtfCurvePoint } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/prices')({
  component: PricesDashboard,
})

type Window = '1Y' | '2Y' | '5Y' | 'ALL'
const WINDOWS: Window[] = ['1Y', '2Y', '5Y', 'ALL']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function cutoffDate(w: Window): string | null {
  const now = new Date()
  if (w === 'ALL') return null
  const years = w === '1Y' ? 1 : w === '2Y' ? 2 : 5
  now.setFullYear(now.getFullYear() - years)
  return now.toISOString().slice(0, 10)
}

function latest(rows: PricesDailyPoint[], key: keyof PricesDailyPoint): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key]
    if (v != null) return v as number
  }
  return null
}

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
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    const cutStr = cutoff.toISOString().slice(0, 10)
    const valid = rows.filter((r) => r.price_date >= cutStr && r.ttf_eur_mwh != null && r.eua_eur_t != null)
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
function TtfSeasonality({ rows }: { rows: PricesDailyPoint[] }) {
  const data = useMemo(() => {
    const valid = rows.filter((r) => r.ttf_eur_mwh != null)
    const currentYear = new Date().getFullYear()
    const fiveYrCutoff = String(currentYear - 5) + '-01-01'

    // Group by (year, month)
    const byYearMonth = new Map<string, number[]>()
    for (const r of valid) {
      if (r.price_date < fiveYrCutoff) continue
      const [yr, mo] = r.price_date.split('-').map(Number)
      const k = `${yr}-${mo}`
      if (!byYearMonth.has(k)) byYearMonth.set(k, [])
      byYearMonth.get(k)!.push(r.ttf_eur_mwh as number)
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      // 5yr avg across all prior complete years (exclude current)
      const hist: number[] = []
      for (let y = currentYear - 5; y < currentYear; y++) {
        const vals = byYearMonth.get(`${y}-${month}`)
        if (vals && vals.length > 0) hist.push(avg(vals))
      }
      const currVals = byYearMonth.get(`${currentYear}-${month}`)
      return {
        month: MONTHS[i],
        avg5: hist.length > 0 ? parseFloat(avg(hist).toFixed(2)) : null,
        current: currVals && currVals.length > 0 ? parseFloat(avg(currVals).toFixed(2)) : null,
      }
    })
  }, [rows])

  const hasData = data.some((d) => d.avg5 != null || d.current != null)
  if (!hasData) return null

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">
        TTF monthly seasonality (€/MWh)
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v, name) => {
              const num = typeof v === 'number' ? v : null
              return num != null ? [`${num.toFixed(2)} €/MWh`, String(name)] : ['--', String(name)]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar dataKey="avg5" name="5yr avg" fill="#60a5fa" opacity={0.6} radius={[2, 2, 0, 0]}>
            {data.map((_, idx) => (
              <Cell key={idx} fill="#60a5fa" opacity={0.55} />
            ))}
          </Bar>
          <Bar dataKey="current" name={`${new Date().getFullYear()}`} fill="#34d399" radius={[2, 2, 0, 0]}>
            {data.map((_, idx) => (
              <Cell key={idx} fill="#34d399" opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// TTF minus NBP spread - the UK/EU gas basis
function TtfNbpSpread({ rows }: { rows: PricesDailyPoint[] }) {
  const data = useMemo(() => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 2)
    const cutStr = cutoff.toISOString().slice(0, 10)
    return rows
      .filter((r) => r.price_date >= cutStr && r.ttf_eur_mwh != null && r.nbp_eur_mwh != null)
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

const TENOR_COLORS: Record<string, string> = {
  Q1: '#818cf8',
  Q2: '#818cf8',
  Q3: '#818cf8',
  Q4: '#818cf8',
  SUM: '#f59e0b',
  WIN: '#60a5fa',
  CAL: '#6ee7b7',
}

function tenorColor(tenorType: string): string {
  return TENOR_COLORS[tenorType] ?? '#94a3b8'
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
              <Cell key={i} fill={tenorColor(r.tenor_type)} />
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
          <TtfNbpSpread rows={rows} />
          <TtfEuaScatter rows={rows} />
          <TtfSeasonality rows={rows} />
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
