import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import { countryName, gasFlowColor } from '@/lib/scales'

type HistWindow = '3M' | '1Y' | 'all'

interface Props {
  country: string
  latestNet: number | null
  latestEntry: number | null
  latestExit: number | null
  latestDate: string | null
  onClose: () => void
}

export function GasFlowPanel({ country, latestNet, latestEntry, latestExit, latestDate, onClose }: Props) {
  const [histWindow, setHistWindow] = useState<HistWindow>('1Y')

  const { data, isLoading } = useQuery({
    queryKey: ['gas-flows-country', country],
    queryFn: () => api.gasFlowsCountry(country),
    staleTime: 15 * 60 * 1000,
  })

  const { chartData, rolling30 } = useMemo(() => {
    const rows = data?.rows ?? []
    if (rows.length === 0) return { chartData: [], rolling30: null }

    const sorted = [...rows].sort((a, b) => a.period_date.localeCompare(b.period_date))

    // Apply window filter
    let filtered = sorted
    if (histWindow === '3M') filtered = sorted.slice(-90)
    else if (histWindow === '1Y') filtered = sorted.slice(-365)

    const chart = filtered.map((r) => ({
      date: r.period_date.slice(5),
      entry: r.entry_gwh_d,
      exit: r.exit_gwh_d ? -Math.abs(r.exit_gwh_d) : null,
      net: r.net_gwh_d,
    }))

    // 30d rolling average of net
    const last30 = sorted.slice(-30).filter((r) => r.net_gwh_d != null)
    const rolling = last30.length > 0
      ? last30.reduce((s, r) => s + (r.net_gwh_d ?? 0), 0) / last30.length
      : null

    return { chartData: chart, rolling30: rolling }
  }, [data, histWindow])

  const directionStr = latestNet == null ? '' : latestNet >= 0 ? 'Net importer' : 'Net exporter'
  const netColor = gasFlowColor(latestNet)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-medium text-sm">{countryName(country)}</p>
          <p className="text-xs text-muted-foreground">ENTSOG physical gas flows</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Latest stats */}
      <div className="p-4 border-b border-border space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-secondary rounded p-2">
            <p className="text-xs text-muted-foreground">Net flow</p>
            <p className="text-sm font-medium" style={{ color: netColor }}>
              {latestNet != null ? `${latestNet >= 0 ? '+' : ''}${latestNet.toFixed(0)} GWh/d` : '--'}
            </p>
            {directionStr && <p className="text-xs text-muted-foreground">{directionStr}</p>}
          </div>
          <div className="bg-secondary rounded p-2">
            <p className="text-xs text-muted-foreground">Entry</p>
            <p className="text-sm font-medium text-blue-400">
              {latestEntry != null ? `${latestEntry.toFixed(0)} GWh/d` : '--'}
            </p>
          </div>
          <div className="bg-secondary rounded p-2">
            <p className="text-xs text-muted-foreground">Exit</p>
            <p className="text-sm font-medium text-amber-400">
              {latestExit != null ? `${latestExit.toFixed(0)} GWh/d` : '--'}
            </p>
          </div>
        </div>
        {rolling30 != null && (
          <p className="text-xs text-muted-foreground">
            30d avg net: <span style={{ color: gasFlowColor(rolling30) }}>{rolling30 >= 0 ? '+' : ''}{rolling30.toFixed(0)} GWh/d</span>
            {latestDate && <span className="ml-2">As of {latestDate}</span>}
          </p>
        )}
      </div>

      {/* History chart */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">Flow history (GWh/d)</p>
          <div className="flex items-center gap-1">
            {(['3M', '1Y', 'all'] as HistWindow[]).map((w) => (
              <button
                key={w}
                onClick={() => setHistWindow(w)}
                className={`px-1.5 py-0.5 rounded text-xs ${
                  w === histWindow
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
          <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
            Loading...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
            No ENTSOG data for this country
          </div>
        ) : (
          <>
            {/* Entry/Exit bars */}
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 8, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(chartData.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={36}
                  tickFormatter={(v) => `${v}`}
                />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    const n = typeof v === 'number' ? v : null
                    const label = name === 'entry' ? 'Entry' : name === 'exit' ? 'Exit' : 'Net'
                    return n != null ? [`${Math.abs(n).toFixed(0)} GWh/d`, label] : ['--', label]
                  }}
                />
                <Bar dataKey="entry" fill="#3b82f6" opacity={0.7} name="entry" />
                <Bar dataKey="exit" fill="#f59e0b" opacity={0.7} name="exit" />
              </BarChart>
            </ResponsiveContainer>

            {/* Net flow line with 30d rolling avg */}
            <p className="text-xs text-muted-foreground mt-3 mb-1">Net flow + 30d avg</p>
            <ResponsiveContainer width="100%" height={120}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 8, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(chartData.length / 6)}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={36}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 2" />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v) => {
                    const n = typeof v === 'number' ? v : null
                    return n != null ? [`${n >= 0 ? '+' : ''}${n.toFixed(0)} GWh/d`, 'Net'] : ['--', 'Net']
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                />
                {rolling30 != null && (
                  <ReferenceLine
                    y={rolling30}
                    stroke={gasFlowColor(rolling30)}
                    strokeDasharray="5 3"
                    label={{
                      value: `30d: ${rolling30.toFixed(0)}`,
                      fill: gasFlowColor(rolling30),
                      fontSize: 9,
                      position: 'right',
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  )
}
