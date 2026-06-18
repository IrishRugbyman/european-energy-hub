import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
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
import { api, type GasYearTrack, type StorageLatestRow } from '@/lib/api'
import { countryName, gasFillColor } from '@/lib/scales'
import { fmtDelta, fmtPct } from '@/lib/utils'

interface Props {
  country: string
  latest: StorageLatestRow | null
  onClose: () => void
}

export function CountryPanel({ country, latest, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['gas-country', country],
    queryFn: () => api.gasCountry(country),
  })

  const { data: flowData } = useQuery({
    queryKey: ['gas-flows-country', country],
    queryFn: () => api.gasFlowsCountry(country),
    retry: false,
    // 404 = country not in ENTSOG dataset; treat as no data (don't throw)
  })

  const fillColor = gasFillColor(latest?.full_pct)

  // Build seasonal chart data: merge band + current + prior year by DOY
  const seasonalChartData = buildSeasonalChart(data)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: fillColor }} />
          <span className="font-medium text-sm">{countryName(country)}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      {latest && (
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-border">
          <StatBox label="Fill" value={fmtPct(latest.full_pct)} big />
          <StatBox label="vs 5yr avg" value={fmtDelta(latest.vs_avg5_pct, 1, 'pp')} signed />
          <StatBox label="7-day change" value={fmtDelta(latest.d7_pct, 1, 'pp')} signed />
          <StatBox label="YoY" value={fmtDelta(latest.yoy_pct, 1, 'pp')} signed />
          {latest.working_gas_volume != null && (
            <StatBox label="Working gas" value={`${(latest.working_gas_volume / 1000).toFixed(0)} TWh`} />
          )}
          <StatBox label="As of" value={latest.gas_day} />
        </div>
      )}

      {/* Physical gas flows (ENTSOG - AT, BE, DE, FR, IT, NL only) */}
      {flowData && flowData.rows.length > 0 && (() => {
        const latest_flow = flowData.rows.reduce((a, b) => a.period_date > b.period_date ? a : b)
        const net = latest_flow.net_gwh_d
        const isImporter = net != null && net >= 0
        const chartData = [...flowData.rows]
          .sort((a, b) => a.period_date.localeCompare(b.period_date))
          .map((r) => ({ date: r.period_date.slice(5), net: r.net_gwh_d }))
        return (
          <div className="border-b border-border p-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Physical gas net flow (ENTSOG)</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-secondary rounded p-2">
                <p className="text-xs text-muted-foreground">Net</p>
                <p className={`text-sm font-medium ${isImporter ? 'text-blue-400' : 'text-amber-400'}`}>
                  {net != null ? `${net >= 0 ? '+' : ''}${net.toFixed(0)}` : '--'}
                  <span className="text-xs font-normal ml-1">GWh/d</span>
                </p>
              </div>
              <div className="bg-secondary rounded p-2">
                <p className="text-xs text-muted-foreground">Entry</p>
                <p className="text-sm font-medium text-foreground">
                  {latest_flow.entry_gwh_d != null ? latest_flow.entry_gwh_d.toFixed(0) : '--'}
                  <span className="text-xs font-normal ml-1">GWh/d</span>
                </p>
              </div>
              <div className="bg-secondary rounded p-2">
                <p className="text-xs text-muted-foreground">Exit</p>
                <p className="text-sm font-medium text-foreground">
                  {latest_flow.exit_gwh_d != null ? latest_flow.exit_gwh_d.toFixed(0) : '--'}
                  <span className="text-xs font-normal ml-1">GWh/d</span>
                </p>
              </div>
            </div>
            {chartData.length > 7 && (
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={Math.floor(chartData.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
                    formatter={(v) => {
                      const n = typeof v === 'number' ? v : null
                      return n != null ? [`${n >= 0 ? '+' : ''}${n.toFixed(0)} GWh/d`, 'Net flow'] : ['--', 'Net flow']
                    }}
                  />
                  <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    fill="#3b82f6"
                    fillOpacity={0.15}
                    dot={false}
                    name="Net GWh/d"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )
      })()}

      {/* Seasonal chart */}
      <div className="flex-1 p-4 overflow-y-auto">
        <p className="text-xs text-muted-foreground mb-2">Fill % - seasonal overlay</p>
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Loading...</div>
        ) : seasonalChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={seasonalChartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                interval={30}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
                width={32}
              />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
                formatter={(v, name) => {
                  const num = typeof v === 'number' ? v : null
                  return num != null ? [`${num.toFixed(1)}%`, String(name)] : ['--', String(name)]
                }}
              />
              {/* 5yr band */}
              <Area
                type="monotone"
                dataKey="max5"
                stroke="none"
                fill="#16a34a"
                fillOpacity={0.1}
                legendType="none"
                name="5yr max"
              />
              <Area
                type="monotone"
                dataKey="min5"
                stroke="none"
                fill="#0f1117"
                fillOpacity={1}
                legendType="none"
                name="5yr min"
              />
              {/* 5yr avg */}
              <Line
                type="monotone"
                dataKey="avg5"
                stroke="#64748b"
                strokeWidth={1}
                dot={false}
                name="5yr avg"
                strokeDasharray="4 2"
              />
              {/* Prior year */}
              <Line
                type="monotone"
                dataKey="prior"
                stroke="#94a3b8"
                strokeWidth={1}
                dot={false}
                name="Prior year"
              />
              {/* Current year */}
              <Line
                type="monotone"
                dataKey="current"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                name="Current year"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">No data</div>
        )}

        {/* Injection / withdrawal bars */}
        {latest?.injection != null && latest.withdrawal != null && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">Latest day flows (GWh)</p>
            <div className="space-y-1">
              {(() => {
                const flowMax = Math.max(latest.injection ?? 0, latest.withdrawal ?? 0, 1)
                return (
                  <>
                    <FlowBar label="Injection" value={latest.injection} color="#16a34a" max={flowMax} />
                    <FlowBar label="Withdrawal" value={latest.withdrawal} color="#dc2626" max={flowMax} />
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* Year-on-year spaghetti chart */}
        {(data?.yearly_tracks?.length ?? 0) > 0 && (
          <div className="mt-5">
            <p className="text-xs text-muted-foreground mb-2">Fill % - year on year</p>
            <StorageYoyChart tracks={data!.yearly_tracks} />
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({
  label,
  value,
  big,
  signed,
}: {
  label: string
  value: string
  big?: boolean
  signed?: boolean
}) {
  const isNeg = signed && value.startsWith('-')
  const isPos = signed && value.startsWith('+')
  return (
    <div className="bg-secondary rounded p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`${big ? 'text-xl' : 'text-sm'} font-medium ${
          isNeg ? 'text-red-400' : isPos ? 'text-green-400' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function FlowBar({ label, value, color, max }: { label: string; value: number; color: string; max: number }) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
        <span>{label}</span>
        <span>{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

interface ChartPoint {
  label: string
  avg5: number | null
  min5: number | null
  max5: number | null
  current: number | null
  prior: number | null
}

function buildSeasonalChart(data: Awaited<ReturnType<typeof api.gasCountry>> | undefined): ChartPoint[] {
  if (!data) return []

  // Index band by DOY
  const bandByDoy: Record<number, { avg5: number | null; min5: number | null; max5: number | null }> = {}
  for (const b of data.seasonal_band) {
    bandByDoy[b.doy] = { avg5: b.avg5, min5: b.min5, max5: b.max5 }
  }

  // Index current/prior by DOY
  const currentByDoy: Record<number, number | null> = {}
  for (const p of data.current_year) {
    const d = new Date(p.gas_day)
    const doy = Math.ceil((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000)
    currentByDoy[doy] = p.full_pct
  }
  const priorByDoy: Record<number, number | null> = {}
  for (const p of data.prior_year) {
    const d = new Date(p.gas_day)
    const doy = Math.ceil((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000)
    priorByDoy[doy] = p.full_pct
  }

  const points: ChartPoint[] = []
  for (let doy = 1; doy <= 365; doy++) {
    const band = bandByDoy[doy] ?? { avg5: null, min5: null, max5: null }
    const monthLabel = doyToMonthLabel(doy)
    points.push({
      label: monthLabel,
      avg5: band.avg5,
      min5: band.min5,
      max5: band.max5,
      current: currentByDoy[doy] ?? null,
      prior: priorByDoy[doy] ?? null,
    })
  }
  return points
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

function doyToMonthLabel(doy: number): string {
  for (let i = MONTH_STARTS.length - 1; i >= 0; i--) {
    if (doy >= MONTH_STARTS[i]) {
      const dayInMonth = doy - MONTH_STARTS[i] + 1
      return dayInMonth === 1 ? MONTH_LABELS[i] : ''
    }
  }
  return ''
}

// Colors for each historical year. 2022 is highlighted (energy crisis).
const YOY_COLORS: Record<number, { stroke: string; width: number }> = {
  2019: { stroke: '#1e3a5f', width: 1 },
  2020: { stroke: '#1e3a5f', width: 1 },
  2021: { stroke: '#1e3a5f', width: 1 },
  2022: { stroke: '#f59e0b', width: 1.5 },
  2023: { stroke: '#334155', width: 1 },
  2024: { stroke: '#64748b', width: 1.5 },
  2025: { stroke: '#94a3b8', width: 1.5 },
  2026: { stroke: '#38bdf8', width: 2.5 },
}

type YoyPoint = { doy: number; label: string; [k: string]: number | string | null }

function buildYoyChart(tracks: GasYearTrack[]): { rows: YoyPoint[]; years: number[] } {
  if (!tracks.length) return { rows: [], years: [] }
  const years = tracks.map((t) => t.year)

  // Index each track by DOY
  const byYear: Record<number, Record<number, number | null>> = {}
  for (const track of tracks) {
    const m: Record<number, number | null> = {}
    for (const pt of track.data) m[pt.doy] = pt.full_pct
    byYear[track.year] = m
  }

  const rows: YoyPoint[] = []
  for (let doy = 1; doy <= 366; doy++) {
    const row: YoyPoint = { doy, label: doyToMonthLabel(doy) }
    for (const yr of years) row[`y${yr}`] = byYear[yr]?.[doy] ?? null
    rows.push(row)
  }
  return { rows, years }
}

function StorageYoyChart({ tracks }: { tracks: GasYearTrack[] }) {
  const { rows, years } = useMemo(() => buildYoyChart(tracks), [tracks])

  if (!rows.length) return null

  const currentYear = new Date().getFullYear()

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={32}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
            formatter={(v, name) => {
              const num = typeof v === 'number' ? v : null
              return num != null ? [`${num.toFixed(1)}%`, String(name).replace('y', '')] : null
            }}
            labelFormatter={(label) => label || ''}
          />
          <ReferenceLine y={90} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1} strokeOpacity={0.6} />
          {years.map((yr) => {
            const style = YOY_COLORS[yr] ?? { stroke: '#334155', width: 1 }
            return (
              <Line
                key={yr}
                type="monotone"
                dataKey={`y${yr}`}
                stroke={style.stroke}
                strokeWidth={style.width}
                dot={false}
                connectNulls={false}
                name={`y${yr}`}
                isAnimationActive={false}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {years.map((yr) => {
          const style = YOY_COLORS[yr] ?? { stroke: '#334155', width: 1 }
          return (
            <div key={yr} className="flex items-center gap-1">
              <div className="w-4 h-0.5 rounded" style={{ backgroundColor: style.stroke }} />
              <span className="text-xs" style={{ color: yr === currentYear ? '#38bdf8' : '#64748b' }}>
                {yr}
                {yr === 2022 ? ' ⚡' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
