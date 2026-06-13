import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import { api, type SpreadsDailyPoint } from '@/lib/api'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/spreads')({
  component: SpreadsDashboard,
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

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null) return '-'
  return `${v.toFixed(digits)} €/MWh`
}

function latest(rows: SpreadsDailyPoint[], key: keyof SpreadsDailyPoint): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key]
    if (v != null) return v as number
  }
  return null
}

interface RegimeSpan {
  x1: string
  x2: string
  regime: string
}

function buildRegimeSpans(
  data: (SpreadsDailyPoint & { label: string })[],
): RegimeSpan[] {
  if (!data.length) return []
  const spans: RegimeSpan[] = []
  let spanStart = data[0].label
  let spanRegime = data[0].regime_threshold ?? 'coal'
  for (let i = 1; i < data.length; i++) {
    const r = data[i].regime_threshold ?? 'coal'
    if (r !== spanRegime) {
      spans.push({ x1: spanStart, x2: data[i - 1].label, regime: spanRegime })
      spanStart = data[i].label
      spanRegime = r
    }
  }
  spans.push({ x1: spanStart, x2: data[data.length - 1].label, regime: spanRegime })
  return spans
}

// Custom tooltip
function SpreadTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: SpreadsDailyPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as SpreadsDailyPoint
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {[
        { key: 'css', label: 'Clean Spark', color: '#60a5fa' },
        { key: 'cds', label: 'Clean Dark', color: '#f59e0b' },
        { key: 'fss', label: 'Fuel Switch', color: '#a78bfa' },
      ].map(({ key, label: name, color }) => {
        const v = d[key as keyof SpreadsDailyPoint]
        if (v == null) return null
        return (
          <p key={key} style={{ color }}>
            {name}: {(v as number).toFixed(1)} €/MWh
          </p>
        )
      })}
      {d.regime_threshold && (
        <p className="text-muted-foreground mt-1">
          regime: {d.regime_threshold === 'gas' ? 'gas marginal' : 'coal marginal'}
        </p>
      )}
    </div>
  )
}

function SpreadChart({ rows, window: w }: { rows: SpreadsDailyPoint[]; window: Window }) {
  const cutoff = cutoffDate(w)

  const { data, regimeSpans } = useMemo(() => {
    const filtered = cutoff ? rows.filter((r) => r.price_date >= cutoff) : rows
    // Sample for performance: max 500 points
    const step = Math.max(1, Math.floor(filtered.length / 500))
    const sampled = filtered
      .filter((_, i) => i % step === 0 || i === filtered.length - 1)
      .map((r) => ({ ...r, label: r.price_date.slice(0, 10) }))
    return { data: sampled, regimeSpans: buildRegimeSpans(sampled) }
  }, [rows, cutoff])

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
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
          tickFormatter={(v) => `${v.toFixed(0)}`}
          unit=" €"
        />
        <Tooltip content={<SpreadTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) =>
            value === 'css' ? 'Clean Spark (CSS)' : value === 'cds' ? 'Clean Dark (CDS)' : 'Fuel Switch (FSS)'
          }
        />
        {/* Regime background shading */}
        {regimeSpans.map((span, i) => (
          <ReferenceArea
            key={i}
            x1={span.x1}
            x2={span.x2}
            fill={span.regime === 'gas' ? '#1e3a5f' : '#3b1c0a'}
            fillOpacity={0.35}
            strokeOpacity={0}
          />
        ))}
        <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 2" />
        <Line dataKey="css" stroke="#60a5fa" dot={false} strokeWidth={1.5} name="css" />
        <Line dataKey="cds" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="cds" />
        <Line dataKey="fss" stroke="#a78bfa" dot={false} strokeWidth={2} name="fss" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function SpreadsDashboard() {
  const [window, setWindow] = useState<Window>('2Y')

  const { data, isLoading, error } = useQuery({
    queryKey: ['spreads'],
    queryFn: api.spreads,
    staleTime: 15 * 60 * 1000,
  })

  const rows = data?.rows ?? []
  const cssNow = latest(rows, 'css')
  const cdsNow = latest(rows, 'cds')
  const fssNow = latest(rows, 'fss')
  const regimeNow = rows.length ? rows[rows.length - 1].regime_threshold : null

  return (
    <div className="p-4 h-full overflow-y-auto">
      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <StatChip label="Clean Spark (CSS)" value={fmt(cssNow)} color="#60a5fa" />
        <StatChip label="Clean Dark (CDS)" value={fmt(cdsNow)} color="#f59e0b" />
        <StatChip label="Fuel Switch (FSS)" value={fmt(fssNow)} color="#a78bfa" />
        {regimeNow && (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              regimeNow === 'gas' ? 'bg-blue-950 text-blue-300' : 'bg-amber-950 text-amber-300'
            }`}
          >
            {regimeNow === 'gas' ? 'Gas marginal' : 'Coal marginal'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
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

      <StaleBanner datasetKey="spreads" variant="inline" />

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {error && <p className="text-destructive text-sm">API unavailable</p>}

      {rows.length > 0 && (
        <>
          <div className="bg-card border border-border rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Spark / Dark / Fuel-Switch Spreads - DE-LU (€/MWh)
              </h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#1e3a5f', opacity: 0.8 }} />
                  gas marginal
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#3b1c0a', opacity: 0.8 }} />
                  coal marginal
                </span>
              </div>
            </div>
            <SpreadChart rows={rows} window={window} />
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <SpreadExplainer />
          </div>
        </>
      )}
    </div>
  )
}

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

function SpreadExplainer() {
  return (
    <div className="text-xs text-muted-foreground space-y-2">
      <p className="font-medium text-foreground">Methodology</p>
      <p>
        <span className="text-blue-400">Clean Spark Spread (CSS)</span> = Power - TTF/efficiency -
        EUA x gas emission factor. Proxy for gas plant profitability.
      </p>
      <p>
        <span className="text-amber-400">Clean Dark Spread (CDS)</span> = Power - Coal/efficiency -
        EUA x coal emission factor. Proxy for coal plant profitability.
      </p>
      <p>
        <span className="text-violet-400">Fuel Switch Spread (FSS)</span> = CSS - CDS. Positive
        means gas is the marginal fuel; negative means coal is marginal.
      </p>
      <p>
        Background shading indicates the marginal fuel regime (gas = blue, coal = amber) derived
        from the sign of the FSS.
      </p>
      <p className="text-muted-foreground/70">
        Constants: gas eff 49%, gas EF 0.364 tCO2/MWh; coal eff 36%, coal EF 0.96 tCO2/MWh.
        Power = DE-LU day-ahead base. TTF = front-month EUR/MWh. EUA = ETS front-year.
      </p>
    </div>
  )
}
