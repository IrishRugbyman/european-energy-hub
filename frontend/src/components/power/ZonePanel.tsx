import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type PowerLatestRow } from '@/lib/api'
import { powerPriceColor, zoneName } from '@/lib/scales'
import { fmtDelta } from '@/lib/utils'

interface Props {
  zone: string
  latest: PowerLatestRow | null
  onClose: () => void
}

export function ZonePanel({ zone, latest, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['power-zone', zone],
    queryFn: () => api.powerZone(zone),
  })

  const fillColor = powerPriceColor(latest?.base_eur)

  const hourlyData = buildHourlyChart(data?.hourly_recent)
  const dailyData = data?.daily_history?.slice(-365) ?? []

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

        {/* Daily base/peak chart: trailing year */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Daily base / peak - trailing year (€/MWh)</p>
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
