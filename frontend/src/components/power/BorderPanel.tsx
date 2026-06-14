import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import type { CongestionRow, BorderFlowRow } from '@/lib/api'
import { utilizationColor, zoneName } from '@/lib/scales'

type HistWindow = '3M' | '1Y' | 'all'

interface Props {
  from: string
  to: string
  congestion: CongestionRow[]
  flows: BorderFlowRow[]
  onClose: () => void
}

export function BorderPanel({ from, to, congestion, flows, onClose }: Props) {
  const [histWindow, setHistWindow] = useState<HistWindow>('1Y')

  const fwdRow = congestion.find((r) => r.from_zone === from && r.to_zone === to) ?? null
  const revRow = congestion.find((r) => r.from_zone === to && r.to_zone === from) ?? null
  const flowRow = flows.find(
    (r) =>
      (r.from_zone === from && r.to_zone === to) ||
      (r.from_zone === to && r.to_zone === from),
  ) ?? null

  const { data: fwdHist, isLoading } = useQuery({
    queryKey: ['congestion-border', from, to],
    queryFn: () => api.powerCongestionBorder(from, to),
    staleTime: 15 * 60 * 1000,
  })
  const { data: revHist } = useQuery({
    queryKey: ['congestion-border', to, from],
    queryFn: () => api.powerCongestionBorder(to, from),
    staleTime: 15 * 60 * 1000,
  })

  const fwdByDate = Object.fromEntries((fwdHist?.rows ?? []).map((r) => [r.price_date, r]))
  const revByDate = Object.fromEntries((revHist?.rows ?? []).map((r) => [r.price_date, r]))
  const allDates = Array.from(
    new Set([...Object.keys(fwdByDate), ...Object.keys(revByDate)]),
  ).sort()

  let chartData = allDates.map((d) => ({
    price_date: d,
    fwd: fwdByDate[d]?.utilization_pct ?? null,
    rev: revByDate[d]?.utilization_pct ?? null,
  }))
  if (histWindow === '3M') chartData = chartData.slice(-90)
  else if (histWindow === '1Y') chartData = chartData.slice(-365)

  const netFlow = flowRow?.net_flow_mw ?? null
  const netFlowStr =
    netFlow != null
      ? `${Math.abs(netFlow).toFixed(0)} MW ${netFlow > 0 ? `${from}→${to}` : `${to}→${from}`}`
      : '--'

  const fwdColor = utilizationColor(fwdRow?.utilization_pct)
  const revColor = utilizationColor(revRow?.utilization_pct)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <p className="font-medium text-sm">
            {zoneName(from)} &harr; {zoneName(to)}
          </p>
          <p className="text-xs text-muted-foreground">Interconnection</p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Today's stats */}
      <div className="p-4 border-b border-border space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <DirBox dir={`${from}→${to}`} row={fwdRow} color={fwdColor} />
          <DirBox dir={`${to}→${from}`} row={revRow} color={revColor} />
        </div>
        <div className="bg-secondary rounded p-2">
          <p className="text-xs text-muted-foreground">Net physical flow</p>
          <p className="text-sm font-medium text-foreground">{netFlowStr}</p>
        </div>
      </div>

      {/* Historical utilization chart */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">NTC utilization history (%)</p>
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
          <div className="flex items-center justify-center h-40 text-muted-foreground text-xs">
            Loading...
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="price_date"
                tick={{ fontSize: 9, fill: '#64748b' }}
                tickLine={false}
                interval={Math.floor(chartData.length / 6)}
                tickFormatter={(v) => (v as string)?.slice(5) ?? ''}
              />
              <YAxis
                domain={[0, 'auto']}
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickLine={false}
                width={30}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
                formatter={(v, name) => {
                  const num = typeof v === 'number' ? v : null
                  return num != null ? [`${num.toFixed(0)}%`, String(name)] : ['--', String(name)]
                }}
              />
              <ReferenceLine
                y={80}
                stroke="#d97706"
                strokeDasharray="4 2"
                opacity={0.6}
                label={{ value: '80%', fill: '#d97706', fontSize: 9, position: 'right' }}
              />
              <ReferenceLine
                y={100}
                stroke="#b91c1c"
                strokeDasharray="4 2"
                opacity={0.6}
                label={{ value: '100%', fill: '#b91c1c', fontSize: 9, position: 'right' }}
              />
              <Line
                type="monotone"
                dataKey="fwd"
                stroke={fwdColor}
                strokeWidth={1.5}
                dot={false}
                name={`${from}→${to}`}
                connectNulls={false}
              />
              {(revHist?.rows.length ?? 0) > 0 && (
                <Line
                  type="monotone"
                  dataKey="rev"
                  stroke={revColor}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="3 2"
                  name={`${to}→${from}`}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-xs">
            No historical data
          </div>
        )}
        {fwdRow?.price_date && (
          <p className="text-xs text-muted-foreground mt-3">As of {fwdRow.price_date}</p>
        )}
      </div>
    </div>
  )
}

function DirBox({
  dir,
  row,
  color,
}: {
  dir: string
  row: CongestionRow | null
  color: string
}) {
  return (
    <div className="bg-secondary rounded p-2">
      <p className="text-xs text-muted-foreground font-mono">{dir}</p>
      <p className="text-lg font-medium" style={{ color }}>
        {row?.utilization_pct != null ? `${row.utilization_pct.toFixed(0)}%` : '--'}
      </p>
      <p className="text-xs text-muted-foreground">
        {row?.scheduled_mw != null ? `${row.scheduled_mw.toFixed(0)}` : '--'} /{' '}
        {row?.ntc_mw != null ? `${row.ntc_mw.toFixed(0)} MW` : '--'}
      </p>
    </div>
  )
}
