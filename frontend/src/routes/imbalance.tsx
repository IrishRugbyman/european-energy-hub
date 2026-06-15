import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import { api, type ImbalanceDailyPoint, type ImbalanceRecentPoint, type BatteryHourlyPoint } from '@/lib/api'
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
