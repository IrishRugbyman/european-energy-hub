import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type GenMapItem } from '@/lib/api'
import { renewablePctColor, zoneName } from '@/lib/scales'

type TrendWindow = '3M' | '1Y' | 'ALL'

const FUEL_COLORS: Record<string, string> = {
  wind:       '#60a5fa',
  solar:      '#fbbf24',
  hydro:      '#34d399',
  biomass:    '#86efac',
  gas:        '#f97316',
  oil:        '#ef4444',
  coal:       '#78716c',
  geothermal: '#a78bfa',
  unknown:    '#4b5563',
}

// Bottom-to-top stacking: fossil fuels at bottom, renewables on top
const STACK_ORDER = ['unknown', 'oil', 'coal', 'geothermal', 'gas', 'biomass', 'hydro', 'solar', 'wind'] as const

interface Props {
  zone: string
  item: GenMapItem | null
  onClose: () => void
  selectedDate?: string
}

export function ZoneGenPanel({ zone, item, onClose, selectedDate }: Props) {
  const [trendWindow, setTrendWindow] = useState<TrendWindow>('1Y')

  const { data, isLoading } = useQuery({
    queryKey: ['gen-zone', zone],
    queryFn: () => api.genZone(zone),
    staleTime: 15 * 60 * 1000,
  })

  const renewableColor = renewablePctColor(item?.renewable_pct)

  const hourlyChart = buildHourlyChart(data?.hourly)
  const allDaily = data?.daily ?? []
  const dailyChart = buildDailyChart(allDaily, trendWindow)

  const totalMW = item?.total_mw
  const renewableMW = (item?.solar_mw ?? 0) + (item?.wind_mw ?? 0) + (item?.hydro_mw ?? 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: renewableColor }} />
          <span className="font-medium text-sm">{zoneName(zone)}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 p-4 border-b border-border">
        <StatBox
          label="Renewable"
          value={item?.renewable_pct != null ? `${item.renewable_pct.toFixed(0)}%` : '--'}
          big
          highlight
        />
        <StatBox
          label="Total"
          value={totalMW != null ? `${(totalMW / 1000).toFixed(1)} GW` : '--'}
        />
        <StatBox
          label="Wind + Solar + Hydro"
          value={renewableMW > 0 ? `${(renewableMW / 1000).toFixed(1)} GW` : '--'}
        />
        <StatBox
          label="Dominant fuel"
          value={data?.dominant_fuel ?? item ? (data?.dominant_fuel ?? '--') : '--'}
        />
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        {/* 24h stacked area chart */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Generation mix - today (avg MW, last 24h)
            {data?.gen_date ? ` · ${data.gen_date}` : ''}
          </p>
          {isLoading ? (
            <Placeholder />
          ) : hourlyChart.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={hourlyChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    tickLine={false}
                    interval={5}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    tickLine={false}
                    width={36}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                    formatter={(v, name) => {
                      const mw = typeof v === 'number' ? v : null
                      return mw != null ? [`${mw.toFixed(0)} MW`, String(name)] : ['--', String(name)]
                    }}
                  />
                  {STACK_ORDER.map((fuel) => (
                    <Area
                      key={fuel}
                      type="monotone"
                      dataKey={fuel}
                      stackId="1"
                      stroke={FUEL_COLORS[fuel] ?? '#6b7280'}
                      fill={FUEL_COLORS[fuel] ?? '#6b7280'}
                      fillOpacity={0.85}
                      strokeWidth={0}
                      name={fuel}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              <FuelLegend />
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No hourly data</div>
          )}
        </div>

        {/* Renewable % trend */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Renewable % trend</p>
            <div className="flex items-center gap-1">
              {(['3M', '1Y', 'ALL'] as TrendWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setTrendWindow(w)}
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    w === trendWindow
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
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={dailyChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="gen_date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(dailyChart.length / 5)}
                  tickFormatter={(v: string) => v?.slice(5) ?? ''}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={28}
                  tickFormatter={(v) => `${v}%`}
                />
                <ReferenceLine y={50} stroke="#374151" strokeDasharray="2 2" />
                {selectedDate && dailyChart.some((d) => d.gen_date === selectedDate) && (
                  <ReferenceLine
                    x={selectedDate}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    label={{ value: selectedDate.slice(5), position: 'top', fontSize: 8, fill: '#f59e0b' }}
                  />
                )}
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    const pct = typeof v === 'number' ? v : null
                    if (pct == null) return ['--', String(name)]
                    return [`${pct.toFixed(0)}%`, name === 'rolling30' ? '30d avg' : 'Renewable %']
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="renewable_pct"
                  stroke="#22c55e"
                  strokeWidth={1}
                  dot={false}
                  name="renewable_pct"
                />
                <Line
                  type="monotone"
                  dataKey="rolling30"
                  stroke="#86efac"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  name="rolling30"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No trend data</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, big, highlight }: { label: string; value: string; big?: boolean; highlight?: boolean }) {
  return (
    <div className="bg-secondary rounded p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${big ? 'text-xl' : 'text-sm'} font-medium ${highlight ? 'text-green-400' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function Placeholder() {
  return <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
}

function FuelLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      {STACK_ORDER.slice().reverse().map((fuel) => (
        <div key={fuel} className="flex items-center gap-1 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: FUEL_COLORS[fuel] }} />
          {fuel}
        </div>
      ))}
    </div>
  )
}

function buildHourlyChart(
  hourly: { ts: string; wind?: number | null; solar?: number | null; hydro?: number | null; gas?: number | null; coal?: number | null; biomass?: number | null; oil?: number | null; geothermal?: number | null; unknown?: number | null }[] | undefined,
) {
  if (!hourly || hourly.length === 0) return []
  // Show last 24h only
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000)
  return hourly
    .filter((p) => new Date(p.ts) >= cutoff)
    .map((p) => {
      const d = new Date(p.ts)
      const hour = `${String(d.getUTCHours()).padStart(2, '0')}:00`
      return {
        hour,
        wind: p.wind ?? 0,
        solar: p.solar ?? 0,
        hydro: p.hydro ?? 0,
        biomass: p.biomass ?? 0,
        gas: p.gas ?? 0,
        oil: p.oil ?? 0,
        coal: p.coal ?? 0,
        geothermal: p.geothermal ?? 0,
        unknown: p.unknown ?? 0,
      }
    })
}

function buildDailyChart(
  daily: { gen_date: string; renewable_pct: number | null }[],
  window: TrendWindow,
) {
  const cutoff =
    window === '3M' ? daily.length - 90 :
    window === '1Y' ? daily.length - 365 :
    0
  const sliced = daily.slice(Math.max(0, cutoff))

  // 30-day rolling average
  return sliced.map((pt, i, arr) => {
    const start = Math.max(0, i - 29)
    const window30 = arr.slice(start, i + 1).map((p) => p.renewable_pct).filter((v): v is number => v != null)
    const rolling30 = window30.length > 0 ? Math.round(window30.reduce((a, b) => a + b, 0) / window30.length) : null
    return { ...pt, rolling30 }
  })
}
