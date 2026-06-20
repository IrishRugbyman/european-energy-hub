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
import type { CongestionRow, BorderFlowRow, DivergenceDailyPoint, DivergenceLatestRow, BorderFlowHistPoint } from '@/lib/api'
import { utilizationColor, priceDivergenceColor, zoneName } from '@/lib/scales'

type HistWindow = '3M' | '1Y' | 'all'

interface Props {
  from: string
  to: string
  congestion: CongestionRow[]
  flows: BorderFlowRow[]
  divergenceRow: DivergenceLatestRow | null
  divergenceHistory: DivergenceDailyPoint[]
  onClose: () => void
}

export function BorderPanel({ from, to, congestion, flows, divergenceRow, divergenceHistory, onClose }: Props) {
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
  const { data: flowHist } = useQuery({
    queryKey: ['border-flow-hist', from, to],
    queryFn: () => api.powerBorderFlows(from, to),
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

      {/* Price spread section */}
      {divergenceRow && (
        <div className="p-4 border-b border-border space-y-2">
          <p className="text-xs text-muted-foreground font-medium">DA price spread (30 days)</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-secondary rounded p-2">
              <p className="text-xs text-muted-foreground font-mono">{from}</p>
              <p className="text-sm font-medium text-foreground">
                {divergenceRow.from_price != null ? `${divergenceRow.from_price.toFixed(0)} €` : '--'}
              </p>
            </div>
            <div className="bg-secondary rounded p-2">
              <p className="text-xs text-muted-foreground font-mono">{to}</p>
              <p className="text-sm font-medium text-foreground">
                {divergenceRow.to_price != null ? `${divergenceRow.to_price.toFixed(0)} €` : '--'}
              </p>
            </div>
            <div className="bg-secondary rounded p-2">
              <p className="text-xs text-muted-foreground">Spread</p>
              <p
                className="text-sm font-medium"
                style={{ color: priceDivergenceColor(divergenceRow.diff_eur_mwh) }}
              >
                {divergenceRow.diff_eur_mwh != null
                  ? `${divergenceRow.diff_eur_mwh >= 0 ? '+' : ''}${divergenceRow.diff_eur_mwh.toFixed(0)} €`
                  : '--'}
              </p>
            </div>
          </div>
          {divergenceHistory.length > 1 && (
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={divergenceHistory} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="price_date"
                  tick={{ fontSize: 8, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(divergenceHistory.length / 4)}
                  tickFormatter={(v) => (v as string)?.slice(5) ?? ''}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={28}
                  tickFormatter={(v) => `${v}`}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 2" />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v) => {
                    const num = typeof v === 'number' ? v : null
                    return num != null ? [`${num >= 0 ? '+' : ''}${num.toFixed(0)} €/MWh`, 'Spread'] : ['--', 'Spread']
                  }}
                  labelFormatter={(l) => String(l)}
                />
                <Line
                  type="monotone"
                  dataKey="diff_eur_mwh"
                  stroke="#d97706"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

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

        {/* Net physical flow history - shown when flow data exists */}
        <FlowHistChart from={from} to={to} rows={flowHist?.rows ?? []} window={histWindow} />
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

function FlowHistChart({
  from,
  to,
  rows,
  window: win,
}: {
  from: string
  to: string
  rows: BorderFlowHistPoint[]
  window: HistWindow
}) {
  if (!rows.length) return null

  const windowed =
    win === '3M' ? rows.slice(-90) :
    win === '1Y' ? rows.slice(-365) :
    rows

  const maxAbs = Math.max(...windowed.map((r) => Math.abs(r.net_flow_mw ?? 0)), 1)

  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground mb-2">Net physical flow history (MW, +={from}→{to})</p>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={windowed} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="price_date"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            interval={Math.floor(windowed.length / 5)}
            tickFormatter={(v) => (v as string)?.slice(5) ?? ''}
          />
          <YAxis
            domain={[-maxAbs * 1.1, maxAbs * 1.1]}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            width={38}
            tickFormatter={(v) => `${Math.round(v as number)}`}
          />
          <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 2" />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v) => {
              const num = typeof v === 'number' ? v : null
              if (num == null) return ['--', 'Net flow']
              const dir = num >= 0 ? `${from}→${to}` : `${to}→${from}`
              return [`${Math.abs(num).toFixed(0)} MW (${dir})`, 'Net flow']
            }}
            labelFormatter={(l) => String(l)}
          />
          <Line
            type="monotone"
            dataKey="net_flow_mw"
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
