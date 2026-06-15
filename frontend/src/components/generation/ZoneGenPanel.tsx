import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type GenMapItem } from '@/lib/api'
import { renewablePctColor, FUEL_PALETTE, zoneName } from '@/lib/scales'

type TrendWindow = '3M' | '1Y' | 'ALL'

const FUEL_COLORS: Record<string, string> = FUEL_PALETTE

// Bottom-to-top stacking: fossil fuels at bottom, renewables on top
const STACK_ORDER = ['other', 'oil', 'coal', 'geothermal', 'gas', 'nuclear', 'biomass', 'hydro', 'solar', 'wind'] as const

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

  // Fuel breakdown for today from latest
  const latestFuels = buildFuelBreakdown(item, data?.dominant_fuel ?? null)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: renewableColor }} />
          <span className="font-medium text-sm">{zoneName(zone)}</span>
          {item?.renewable_pct != null && (
            <span className="text-xs text-green-400 font-medium">{item.renewable_pct.toFixed(0)}% RE</span>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Fuel breakdown */}
      <div className="p-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-2">
          Fuel mix today
          {item?.total_mw != null ? ` · ${(item.total_mw / 1000).toFixed(1)} GW total` : ''}
          {data?.gen_date ? ` · ${data.gen_date}` : ''}
        </p>
        {latestFuels.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {latestFuels.map(({ fuel, mw, pct }) => (
              <div key={fuel} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: FUEL_COLORS[fuel] ?? '#6b7280' }}
                />
                <span className="text-muted-foreground capitalize">{fuel}</span>
                <span className="text-foreground ml-auto tabular-nums">
                  {(mw / 1000).toFixed(1)}GW
                  <span className="text-muted-foreground"> {pct}%</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No fuel data</div>
        )}
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        {/* 24h stacked area chart */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Generation mix - today (avg MW, last 24h)
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

        {/* Stacked fuel daily trend + renewable % overlay */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Daily fuel mix + renewable %</p>
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
            <ResponsiveContainer width="100%" height={160}>
              <ComposedChart data={dailyChart} margin={{ top: 4, right: 28, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="gen_date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(dailyChart.length / 5)}
                  tickFormatter={(v: string) => v?.slice(5) ?? ''}
                />
                <YAxis
                  yAxisId="mw"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={36}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={24}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    if (name === 'renewable_pct') {
                      const pct = typeof v === 'number' ? v : null
                      return pct != null ? [`${pct.toFixed(0)}%`, 'Renewable %'] : ['--', 'Renewable %']
                    }
                    const mw = typeof v === 'number' ? v : null
                    return mw != null ? [`${mw.toFixed(0)} MW`, String(name)] : ['--', String(name)]
                  }}
                />
                {selectedDate && dailyChart.some((d) => d.gen_date === selectedDate) && (
                  <ReferenceLine
                    x={selectedDate}
                    yAxisId="mw"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    label={{ value: selectedDate.slice(5), position: 'top', fontSize: 8, fill: '#f59e0b' }}
                  />
                )}
                {STACK_ORDER.map((fuel) => (
                  <Area
                    key={fuel}
                    yAxisId="mw"
                    type="monotone"
                    dataKey={fuel}
                    stackId="1"
                    stroke={FUEL_COLORS[fuel] ?? '#6b7280'}
                    fill={FUEL_COLORS[fuel] ?? '#6b7280'}
                    fillOpacity={0.75}
                    strokeWidth={0}
                    name={fuel}
                  />
                ))}
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="renewable_pct"
                  stroke="#f0fdf4"
                  strokeWidth={1.5}
                  dot={false}
                  name="renewable_pct"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No trend data</div>
          )}
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <div className="w-4 h-0.5 bg-[#f0fdf4]" />
            <span>Renewable %</span>
          </div>
        </div>
      </div>
    </div>
  )
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

function Placeholder() {
  return <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
}

function buildFuelBreakdown(
  item: GenMapItem | null,
  dominantFuel: string | null,
): { fuel: string; mw: number; pct: number }[] {
  if (!item || !item.total_mw || item.total_mw === 0) return []
  const total = item.total_mw
  const entries: [string, number | null][] = [
    ['solar', item.solar_mw], ['wind', item.wind_mw], ['hydro', item.hydro_mw],
    ['nuclear', item.nuclear_mw], ['gas', item.gas_mw], ['coal', item.coal_mw],
    ['biomass', item.biomass_mw], ['geothermal', item.geothermal_mw],
    ['oil', item.oil_mw], ['other', item.other_mw],
  ]
  return entries
    .filter(([, v]) => v != null && v > 0)
    .map(([fuel, mw]) => ({
      fuel,
      mw: mw as number,
      pct: Math.round(((mw as number) / total) * 100),
    }))
    .sort((a, b) => b.mw - a.mw)
    .filter(({ fuel }) => fuel !== dominantFuel || true)  // keep all, dominant first
    .sort((a, b) => (a.fuel === dominantFuel ? -1 : b.fuel === dominantFuel ? 1 : b.mw - a.mw))
}

function buildHourlyChart(
  hourly: { ts: string; wind?: number | null; solar?: number | null; hydro?: number | null; nuclear?: number | null; gas?: number | null; coal?: number | null; biomass?: number | null; oil?: number | null; geothermal?: number | null; other?: number | null }[] | undefined,
) {
  if (!hourly || hourly.length === 0) return []
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
        nuclear: p.nuclear ?? 0,
        biomass: p.biomass ?? 0,
        gas: p.gas ?? 0,
        oil: p.oil ?? 0,
        coal: p.coal ?? 0,
        geothermal: p.geothermal ?? 0,
        other: p.other ?? 0,
      }
    })
}

function buildDailyChart(
  daily: { gen_date: string; renewable_pct: number | null; solar?: number | null; wind?: number | null; hydro?: number | null; gas?: number | null; coal?: number | null; nuclear?: number | null; biomass?: number | null; geothermal?: number | null; oil?: number | null; other?: number | null }[],
  window: TrendWindow,
) {
  const cutoff =
    window === '3M' ? daily.length - 90 :
    window === '1Y' ? daily.length - 365 :
    0
  return daily.slice(Math.max(0, cutoff)).map((pt) => ({
    gen_date: pt.gen_date,
    renewable_pct: pt.renewable_pct,
    wind: pt.wind ?? 0,
    solar: pt.solar ?? 0,
    hydro: pt.hydro ?? 0,
    nuclear: pt.nuclear ?? 0,
    biomass: pt.biomass ?? 0,
    gas: pt.gas ?? 0,
    oil: pt.oil ?? 0,
    coal: pt.coal ?? 0,
    geothermal: pt.geothermal ?? 0,
    other: pt.other ?? 0,
  }))
}
