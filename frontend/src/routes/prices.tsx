import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { api, type PricesDailyPoint } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/prices')({
  component: PricesDashboard,
})

type Window = '1Y' | '2Y' | '5Y' | 'ALL'
const WINDOWS: Window[] = ['1Y', '2Y', '5Y', 'ALL']

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
  { key: 'ttf_eur_mwh', label: 'TTF (€/MWh)', color: '#60a5fa', unit: '€/MWh' },
  { key: 'eua_eur_t',   label: 'EUA (€/tCO2)', color: '#34d399', unit: '€/t' },
  { key: 'coal_usd_t',  label: 'Coal ($/t)', color: '#f59e0b', unit: '$/t' },
  { key: 'hh_usd_mmbtu', label: 'Henry Hub ($/MMBtu)', color: '#f87171', unit: '$/MMBtu' },
] as const

type SeriesKey = (typeof SERIES)[number]['key']

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
          tickFormatter={(v) => (indexed ? v.toFixed(0) : v.toFixed(0))}
          unit={indexed ? '' : ''}
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

function PricesDashboard() {
  const [window, setWindow] = useState<Window>('2Y')
  const [indexed, setIndexed] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['prices'],
    queryFn: api.prices,
    staleTime: 15 * 60 * 1000,
  })

  const rows = data?.rows ?? []

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
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Commodity Prices{indexed ? ' - Indexed to 100 at window start' : ''}
          </h2>
          <PricesChart rows={rows} window={window} indexed={indexed} />
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
