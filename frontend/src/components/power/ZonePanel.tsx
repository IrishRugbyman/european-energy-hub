import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type PowerLatestRow, type GenerationMixRow } from '@/lib/api'
import { powerPriceColor, zoneName } from '@/lib/scales'
import { fmtDelta } from '@/lib/utils'

type DailyWindow = '1Y' | '2Y'

const FUEL_COLORS: Record<string, string> = {
  wind:      '#60a5fa',
  solar:     '#fbbf24',
  hydro:     '#34d399',
  gas:       '#f97316',
  coal:      '#78716c',
  biomass:   '#86efac',
  oil:       '#ef4444',
  geothermal:'#a78bfa',
  unknown:   '#4b5563',
}

const FUEL_ORDER = ['wind', 'solar', 'hydro', 'biomass', 'gas', 'oil', 'coal', 'geothermal', 'unknown'] as const

interface Props {
  zone: string
  latest: PowerLatestRow | null
  onClose: () => void
}

export function ZonePanel({ zone, latest, onClose }: Props) {
  const [dailyWindow, setDailyWindow] = useState<DailyWindow>('1Y')

  const { data, isLoading } = useQuery({
    queryKey: ['power-zone', zone],
    queryFn: () => api.powerZone(zone),
  })

  const fillColor = powerPriceColor(latest?.base_eur)

  const hourlyData = buildHourlyChart(data?.hourly_recent)
  const allDaily = data?.daily_history ?? []
  const dailyData = dailyWindow === '1Y' ? allDaily.slice(-365) : allDaily

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: fillColor }} />
          <span className="font-medium text-sm">{zoneName(zone)}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      {latest && (
        <div className="grid grid-cols-2 gap-2 p-4 border-b border-border">
          <StatBox label="Base" value={latest.base_eur != null ? `${latest.base_eur.toFixed(0)} €/MWh` : '--'} big />
          <StatBox label="Peak" value={latest.peak_eur != null ? `${latest.peak_eur.toFixed(0)} €/MWh` : '--'} />
          <StatBox label="vs 30d avg" value={fmtDelta(latest.vs_30d_pct, 1, '%')} signed />
          <StatBox label="As of" value={latest.price_date} />
        </div>
      )}

      <div className="flex-1 p-4 overflow-y-auto space-y-6">
        {/* Hourly chart: last 48h */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Hourly price - last 48h (€/MWh)</p>
          {isLoading ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
          ) : hourlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={hourlyData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} interval={11} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={36}
                  tickFormatter={(v) => `${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
                  formatter={(v, name) => {
                    const num = typeof v === 'number' ? v : null
                    return num != null ? [`${num.toFixed(1)} €/MWh`, String(name)] : ['--', String(name)]
                  }}
                />
                <Line type="monotone" dataKey="price" stroke={fillColor} strokeWidth={1.5} dot={false} name="Price" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No data</div>
          )}
        </div>

        {/* Generation mix */}
        {data?.generation_mix && (
          <GenerationMixSection mix={data.generation_mix} />
        )}

        {/* Daily base/peak chart */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Daily base / peak (€/MWh)</p>
            <div className="flex items-center gap-1">
              {(['1Y', '2Y'] as DailyWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setDailyWindow(w)}
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    w === dailyWindow
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
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading...</div>
          ) : dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="price_date" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false}
                  interval={Math.floor(dailyData.length / 6)}
                  tickFormatter={(v) => v?.slice(5) ?? ''} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={36}
                  tickFormatter={(v) => `${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 11 }}
                  formatter={(v, name) => {
                    const num = typeof v === 'number' ? v : null
                    return num != null ? [`${num.toFixed(0)} €/MWh`, String(name)] : ['--', String(name)]
                  }}
                />
                <Line type="monotone" dataKey="base_eur" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Base" />
                <Line type="monotone" dataKey="peak_eur" stroke="#f59e0b" strokeWidth={1} dot={false}
                  strokeDasharray="3 2" name="Peak" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No data</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, big, signed }: { label: string; value: string; big?: boolean; signed?: boolean }) {
  const isNeg = signed && value.startsWith('-')
  const isPos = signed && value.startsWith('+')
  return (
    <div className="bg-secondary rounded p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${big ? 'text-xl' : 'text-sm'} font-medium ${isNeg ? 'text-red-400' : isPos ? 'text-green-400' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function GenerationMixSection({ mix }: { mix: GenerationMixRow }) {
  const total = mix.total_mw ?? 1
  const fuels = FUEL_ORDER.map((key) => ({
    key,
    mw: (mix[key as keyof GenerationMixRow] as number | null) ?? 0,
    color: FUEL_COLORS[key] ?? '#6b7280',
  })).filter((f) => f.mw > 0)

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        Generation mix{mix.gen_date ? ` (${mix.gen_date})` : ''} - avg MW
        {mix.renewable_pct != null && (
          <span className="ml-2 text-green-400 font-medium">{mix.renewable_pct.toFixed(0)}% renewable</span>
        )}
      </p>
      {/* Stacked bar */}
      <div className="flex h-4 rounded overflow-hidden mb-2">
        {fuels.map((f) => (
          <div
            key={f.key}
            style={{ width: `${(f.mw / total) * 100}%`, backgroundColor: f.color }}
            title={`${f.key}: ${f.mw.toFixed(0)} MW`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {fuels.map((f) => (
          <div key={f.key} className="flex items-center gap-1 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: f.color }} />
            <span>{f.key} {f.mw.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildHourlyChart(hourly: { ts: string; price_eur_mwh: number | null }[] | undefined) {
  if (!hourly) return []
  // Last 48 hours only
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  return hourly
    .filter((p) => new Date(p.ts) >= cutoff)
    .map((p) => {
      const d = new Date(p.ts)
      const label = `${String(d.getUTCHours()).padStart(2, '0')}:00`
      return { label, price: p.price_eur_mwh, ts: p.ts }
    })
}
