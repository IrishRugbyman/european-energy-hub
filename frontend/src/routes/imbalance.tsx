import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type ImbalanceDailyPoint, type ImbalanceRecentPoint, type ImbalanceHourlyPoint, type BatteryHourlyPoint, type ImbalanceMonthlyRow } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/imbalance')({
  component: ImbalanceDashboard,
})

type Window = '3M' | '1Y' | '2Y'
const WINDOWS: Window[] = ['3M', '1Y', '2Y']

function cutoffDays(w: Window): number {
  return w === '3M' ? 90 : w === '1Y' ? 365 : 730
}

function fmt(v: number | null | undefined, digits = 0): string {
  if (v == null) return '--'
  return `${v.toFixed(digits)} €/MWh`
}

function ImbalanceDashboard() {
  const [window, setWindow] = useState<Window>('1Y')

  const { data, isLoading, error } = useQuery({
    queryKey: ['imbalance'],
    queryFn: api.imbalance,
    staleTime: 15 * 60 * 1000,
  })

  const { data: dispatchData } = useQuery({
    queryKey: ['imbalance-dispatch'],
    queryFn: api.imbalanceDispatch,
    staleTime: 15 * 60 * 1000,
  })

  const { data: profileData } = useQuery({
    queryKey: ['imbalance-profile'],
    queryFn: api.imbalanceProfile,
    staleTime: 60 * 60 * 1000,
  })

  const { data: monthlyData } = useQuery({
    queryKey: ['imbalance-monthly'],
    queryFn: api.imbalanceMonthly,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const latest = data?.latest
  const recent = data?.recent ?? []
  const daily = data?.daily ?? []

  const recentChart = buildRecentChart(recent)
  const dailyChart = buildDailyChart(daily, window)

  const isStale = data?.as_of
    ? (Date.now() - new Date(data.as_of).getTime()) > 48 * 3600 * 1000
    : false

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-foreground">German reBAP Imbalance Prices</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            15-minute balancing settlement prices from SMARD/Bundesnetzagentur
          </p>
        </div>

        {/* Now cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NowCard
            label="Current reBAP"
            value={latest ? fmt(latest.rebap_eur_mwh) : isLoading ? 'Loading...' : '--'}
            highlight
          />
          <NowCard label="Today mean" value={fmt(latest?.today_mean)} />
          <NowCard label="Today min" value={fmt(latest?.today_min)} />
          <NowCard label="Today max" value={fmt(latest?.today_max)} />
        </div>

        {isStale && (
          <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">
            Data may be stale (last refresh: {data?.as_of ? new Date(data.as_of).toUTCString() : 'unknown'})
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
            API unavailable
          </div>
        )}

        {/* Recent 15-min chart */}
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Recent prices - 15-min resolution (last 10 days)
          </p>
          {isLoading ? (
            <Placeholder />
          ) : recentChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={recentChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="recentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(recentChart.length / 8)}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={42}
                  tickFormatter={(v) => `${v}`}
                />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v) => {
                    const n = typeof v === 'number' ? v : null
                    return n != null ? [`${n.toFixed(1)} €/MWh`, 'reBAP'] : ['--', 'reBAP']
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="rebap"
                  stroke="#06b6d4"
                  strokeWidth={1}
                  fill="url(#recentGrad)"
                  dot={false}
                  name="reBAP"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Placeholder text="No recent data" />
          )}
        </div>

        {/* Daily history chart */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">Daily mean / range</p>
            <div className="flex items-center gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-1.5 py-0.5 rounded text-xs ${
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
          {isLoading ? (
            <Placeholder />
          ) : dailyChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={dailyChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="rangeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="price_date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(dailyChart.length / 7)}
                  tickFormatter={(v: string) => v?.slice(5) ?? ''}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={42}
                  tickFormatter={(v) => `${v}`}
                />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    const n = typeof v === 'number' ? v : null
                    const label = name === 'mean' ? 'Mean' : name === 'min' ? 'Min' : 'Max'
                    return n != null ? [`${n.toFixed(1)} €/MWh`, label] : ['--', label]
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="max"
                  stroke="transparent"
                  fill="url(#rangeGrad)"
                  fillOpacity={1}
                  dot={false}
                  name="max"
                />
                <Area
                  type="monotone"
                  dataKey="min"
                  stroke="transparent"
                  fill="#0f1117"
                  fillOpacity={1}
                  dot={false}
                  name="min"
                />
                <Line
                  type="monotone"
                  dataKey="mean"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                  name="mean"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <Placeholder text="No daily history" />
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-4 border-t-2 border-cyan-400 inline-block" /> daily mean
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-cyan-400/15 inline-block rounded-sm" /> daily min/max range
            </span>
          </div>
        </div>

        {/* Hourly reBAP profile */}
        {(profileData?.rows.length ?? 0) > 0 && (
          <RebalancingHourlyProfile rows={profileData!.rows} />
        )}

        {/* Year-on-Year monthly comparison */}
        {(monthlyData?.rows.length ?? 0) > 0 && (
          <ImbalanceYoYChart rows={monthlyData!.rows} />
        )}

        {/* Extreme reBAP events */}
        {daily.length > 0 && <ExtremeEvents daily={daily} />}

        {/* Battery oracle dispatch */}
        {dispatchData && <BatteryDispatchPanel hourly={dispatchData.hourly} summary={dispatchData.summary} />}

        {/* Methodology */}
        <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground space-y-2">
          <p className="text-foreground font-medium text-xs">What is reBAP?</p>
          <p>
            reBAP (Regelenergie-Bilanzierungspreis) is the German TSO balancing settlement price,
            published at 15-minute resolution by SMARD (Bundesnetzagentur). It represents the
            cost TSOs incur to balance the grid after renewable forecast errors and load deviations.
          </p>
          <p>
            High positive reBAP prices occur when the system is short (generation below load
            plus forecasts), meaning expensive fast-response capacity was dispatched.
            Negative prices reflect excess generation that had to be curtailed or exported at a loss.
          </p>
          <p>
            This data feeds the{' '}
            <a href="https://quant.lbzgiu.xyz" className="text-primary hover:underline">
              P2 Imbalance Signal
            </a>{' '}
            research project, which predicts reBAP sign from renewable forecast errors.
          </p>
        </div>
      </div>

      <StaleBanner datasetKey="imbalance" variant="inline" />
    </div>
  )
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const YOY_COLORS: Record<number, string> = { 2024: '#64748b', 2025: '#38bdf8', 2026: '#4ade80' }

function ImbalanceYoYChart({ rows }: { rows: ImbalanceMonthlyRow[] }) {
  const years = [...new Set(rows.map((r) => r.year))].sort()

  // Build pivot: month -> { year -> avg_eur }
  const byMonth = useMemo(() => {
    const m: Record<number, Record<number, number | null>> = {}
    for (const r of rows) {
      if (!m[r.month]) m[r.month] = {}
      m[r.month][r.year] = r.avg_eur
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
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Monthly avg reBAP - year on year (€/MWh)</h2>
        <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
          {years.map((yr) => (
            <span key={yr} className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: YOY_COLORS[yr] ?? '#94a3b8' }} />
              {yr}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barCategoryGap="20%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={(v) => `${v as number}`}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v: unknown, name: string | number | undefined) => [
              v != null ? `${(v as number).toFixed(1)} €/MWh` : '--',
              name != null ? String(name) : '',
            ]}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
          {years.map((yr) => (
            <Bar key={yr} dataKey={String(yr)} fill={YOY_COLORS[yr] ?? '#94a3b8'} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground mt-1">
        Monthly mean reBAP price. Current year is partial (YTD average). Higher = tighter balancing markets.
      </p>
    </div>
  )
}

function ExtremeEvents({ daily }: { daily: ImbalanceDailyPoint[] }) {
  const top = useMemo(() => {
    return [...daily]
      .filter((d) => d.max_eur != null)
      .sort((a, b) => (b.max_eur ?? 0) - (a.max_eur ?? 0))
      .slice(0, 10)
  }, [daily])

  if (top.length === 0) return null

  const fmtEur = (v: number | null) => (v != null ? `${v.toFixed(0)} €` : '--')

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3">Top 10 extreme reBAP days (by intraday max)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 font-normal text-muted-foreground">Date</th>
              <th className="text-right py-1.5 font-normal text-muted-foreground">Daily mean</th>
              <th className="text-right py-1.5 font-normal text-muted-foreground">Intraday max</th>
              <th className="text-left py-1.5 font-normal text-muted-foreground pl-3">Severity</th>
            </tr>
          </thead>
          <tbody>
            {top.map((d, i) => {
              const max = d.max_eur ?? 0
              const color = max >= 500 ? '#f87171' : max >= 300 ? '#f59e0b' : '#94a3b8'
              const barW = Math.round((max / (top[0].max_eur ?? 1)) * 100)
              return (
                <tr key={d.price_date} className="border-b border-border/40">
                  <td className="py-1.5 font-mono text-foreground">
                    {i === 0 && <span className="text-[10px] text-red-400 mr-1">max</span>}
                    {d.price_date}
                  </td>
                  <td className="py-1.5 text-right text-muted-foreground">{fmtEur(d.mean_eur)}/MWh</td>
                  <td className="py-1.5 text-right font-semibold" style={{ color }}>{fmtEur(d.max_eur)}/MWh</td>
                  <td className="py-1.5 pl-3">
                    <div className="h-2 rounded-sm" style={{ width: `${barW}%`, background: color, maxWidth: 80, minWidth: 4 }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Based on 2-year daily history. Max = highest single 15-min interval in the day.</p>
    </div>
  )
}

function BatteryDispatchPanel({
  hourly,
  summary,
}: {
  hourly: BatteryHourlyPoint[]
  summary: NonNullable<ReturnType<typeof api.imbalanceDispatch> extends Promise<infer T> ? T : never>['summary']
}) {
  const chartData = useMemo(() => {
    const step = Math.max(1, Math.floor(hourly.length / 400))
    return hourly
      .filter((_, i) => i % step === 0 || i === hourly.length - 1)
      .map((p) => {
        const d = new Date(p.ts)
        const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h`
        return {
          label,
          rebap: p.rebap_price,
          pnl: p.cumulative_pnl_eur,
          charge: (p.charge_mw ?? 0) > 0.01 ? p.rebap_price : null,
          discharge: (p.discharge_mw ?? 0) > 0.01 ? p.rebap_price : null,
        }
      })
  }, [hourly])

  const s = summary
  const fmtEur = (v: number | null | undefined) => (v != null ? `${v.toFixed(0)} €` : '--')
  const fmtRate = (v: number | null | undefined) => (v != null ? `${v.toFixed(1)} €/MWh` : '--')

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-foreground">Battery Oracle P&amp;L</h2>
        <span className="text-xs text-muted-foreground">1 MW / 2 MWh, trailing {s?.trailing_days ?? 30} days</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total P&L" value={fmtEur(s?.total_pnl_eur)} color="#34d399" />
        <SummaryCard label="Avg spread" value={fmtRate(s?.avg_spread_captured_eur)} />
        <SummaryCard label="Avg buy" value={fmtRate(s?.avg_buy_price_eur)} color="#60a5fa" />
        <SummaryCard label="Avg sell" value={fmtRate(s?.avg_sell_price_eur)} color="#f59e0b" />
      </div>

      {/* reBAP + charge/discharge markers */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">reBAP price with charge (blue) / discharge (amber) events</p>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 8, fill: '#64748b' }}
              tickLine={false}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#64748b' }}
              tickLine={false}
              width={40}
              tickFormatter={(v) => `${v}`}
            />
            <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 2" />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(v, name) => {
                const n = typeof v === 'number' ? v : null
                const label = name === 'rebap' ? 'reBAP' : name === 'charge' ? 'Charge' : 'Discharge'
                return n != null ? [`${n.toFixed(1)} €/MWh`, label] : ['--', label]
              }}
            />
            <Line
              type="monotone"
              dataKey="rebap"
              stroke="#06b6d4"
              strokeWidth={1}
              dot={false}
              name="rebap"
            />
            <Scatter dataKey="charge" fill="#60a5fa" name="charge" shape="circle" />
            <Scatter dataKey="discharge" fill="#f59e0b" name="discharge" shape="circle" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative P&L line */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Cumulative oracle P&L (EUR)</p>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 8, fill: '#64748b' }}
              tickLine={false}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#64748b' }}
              tickLine={false}
              width={48}
              tickFormatter={(v) => `${v}`}
            />
            <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 2" />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(v) => {
                const n = typeof v === 'number' ? v : null
                return n != null ? [`${n.toFixed(0)} €`, 'Cum P&L'] : ['--', 'Cum P&L']
              }}
            />
            <Line
              type="monotone"
              dataKey="pnl"
              stroke="#34d399"
              strokeWidth={1.5}
              dot={false}
              name="pnl"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">
        Oracle dispatch: perfect foresight of hourly reBAP prices. Degradation cost 28 EUR/MWh charged.
        Upper bound on achievable P&L - actual forecast-based dispatch captures less.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-secondary rounded p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-medium mt-0.5" style={color ? { color } : {}}>
        {value}
      </p>
    </div>
  )
}

function NowCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-medium mt-0.5 ${highlight ? 'text-cyan-400' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function Placeholder({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">{text}</div>
  )
}

function buildRecentChart(recent: ImbalanceRecentPoint[]) {
  return recent.map((p) => {
    const d = new Date(p.ts)
    const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return { label, rebap: p.rebap_eur_mwh }
  })
}

function buildDailyChart(daily: ImbalanceDailyPoint[], w: Window) {
  const cutoff = cutoffDays(w)
  const sliced = daily.slice(Math.max(0, daily.length - cutoff))
  return sliced.map((p) => ({
    price_date: p.price_date,
    mean: p.mean_eur,
    min: p.min_eur,
    max: p.max_eur,
  }))
}

function RebalancingHourlyProfile({ rows }: { rows: ImbalanceHourlyPoint[] }) {
  const data = rows.map((r) => ({
    h: `${r.hour.toString().padStart(2, '0')}h`,
    avg: r.avg_eur,
    p25: r.p25_eur,
    p75: r.p75_eur,
    neg: r.neg_pct,
  }))

  // Color by avg: negative/near-zero = purple, low = green, mid = amber, high = red
  const color = (avg: number | null) => {
    if (avg == null) return '#475569'
    if (avg < 0) return '#7c3aed'
    if (avg < 40) return '#16a34a'
    if (avg < 80) return '#d97706'
    if (avg < 130) return '#dc2626'
    return '#9f1239'
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">
        reBAP hourly profile - 90-day avg by CET hour (avg/IQR + negative price %)
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 4, right: 42, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="h" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={1} />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            width={38}
            tickFormatter={(v) => `${v}`}
          />
          <YAxis
            yAxisId="neg"
            orientation="right"
            tick={{ fontSize: 9, fill: '#f87171' }}
            tickLine={false}
            width={36}
            tickFormatter={(v) => `${v}%`}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null
              if (name === 'neg') return n != null ? [`${n.toFixed(1)}%`, 'Neg price'] : ['--', 'Neg price']
              if (name === 'avg') return n != null ? [`${n.toFixed(1)} €/MWh`, 'Avg reBAP'] : ['--', 'Avg']
              return n != null ? [`${n.toFixed(1)} €/MWh`, String(name)] : ['--', String(name)]
            }}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" strokeWidth={1} />
          {/* IQR band */}
          <Area type="monotone" dataKey="p75" stroke="none" fill="#06b6d4" fillOpacity={0.1} legendType="none" />
          <Area type="monotone" dataKey="p25" stroke="none" fill="#0f1117" fillOpacity={1} legendType="none" />
          {/* Avg line with colored dots */}
          <Line
            type="monotone"
            dataKey="avg"
            stroke="#06b6d4"
            strokeWidth={1.5}
            dot={(props) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: typeof data[0] }
              return <circle key={`dot-${payload.h}`} cx={cx} cy={cy} r={3} fill={color(payload.avg)} />
            }}
            name="avg"
          />
          {/* Negative % bars on right axis */}
          <Bar yAxisId="neg" dataKey="neg" name="neg" opacity={0.35}>
            {data.map((d) => (
              <Cell key={d.h} fill="#f87171" />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-4 border-t border-cyan-400/30 bg-cyan-400/10 h-3 inline-block rounded-sm" /> IQR band
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 border-t-2 border-cyan-400 inline-block" /> avg reBAP
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-red-400/35 inline-block rounded-sm" /> neg price %
        </span>
      </div>
    </div>
  )
}
