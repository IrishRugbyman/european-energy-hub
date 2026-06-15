import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type PowerLatestRow, type GenMapItem } from '@/lib/api'
import { powerPriceColor, renewablePctColor, FUEL_PALETTE, zoneName } from '@/lib/scales'
import { computeCarbonIntensity } from '@/components/map/EuroMap'
import { fmtDelta } from '@/lib/utils'

type TrendWindow = '3M' | '1Y' | 'ALL'
type DailyWindow = '1Y' | '2Y'

const FUEL_COLORS: Record<string, string> = FUEL_PALETTE
const STACK_ORDER = ['other', 'oil', 'coal', 'geothermal', 'gas', 'nuclear', 'biomass', 'hydro', 'solar', 'wind'] as const

interface Props {
  zone: string
  powerLatest: PowerLatestRow | null
  genItem: GenMapItem | null
  onClose: () => void
  selectedDate?: string
}

export function UnifiedZonePanel({ zone, powerLatest, genItem, onClose, selectedDate }: Props) {
  const [genWindow, setGenWindow] = useState<TrendWindow>('1Y')
  const [priceWindow, setPriceWindow] = useState<DailyWindow>('1Y')

  const { data: powerData, isLoading: powerLoading } = useQuery({
    queryKey: ['power-zone', zone],
    queryFn: () => api.powerZone(zone),
  })

  const { data: genData, isLoading: genLoading } = useQuery({
    queryKey: ['gen-zone', zone],
    queryFn: () => api.genZone(zone),
    staleTime: 15 * 60 * 1000,
  })

  const priceColor = powerPriceColor(powerLatest?.base_eur)
  const reColor = renewablePctColor(genItem?.renewable_pct)
  const carbonIntensity = computeCarbonIntensity(genItem)

  const hourlyPriceData = buildHourlyPriceChart(powerData?.hourly_recent)
  const allDaily = powerData?.daily_history ?? []
  const priceDaily = priceWindow === '1Y' ? allDaily.slice(-365) : allDaily

  const allGenDaily = genData?.daily ?? []
  const genDailyChart = buildGenDailyChart(allGenDaily, genWindow)
  const genHourlyChart = buildGenHourlyChart(genData?.hourly ?? [])

  const latestFuels = buildFuelBreakdown(genItem)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: priceColor }} />
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: reColor }} />
          <span className="font-medium text-sm">{zoneName(zone)}</span>
          {powerLatest?.base_eur != null && (
            <span className="text-xs text-sky-400 font-medium">{powerLatest.base_eur.toFixed(0)} €/MWh</span>
          )}
          {genItem?.renewable_pct != null && (
            <span className="text-xs text-green-400 font-medium">{genItem.renewable_pct.toFixed(0)}% RE</span>
          )}
          {carbonIntensity != null && (
            <span className="text-xs text-muted-foreground font-medium">{carbonIntensity} gCO₂/kWh</span>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Price stats */}
        {powerLatest && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Day-ahead prices
              {powerLatest.price_date ? ` - ${powerLatest.price_date}` : ''}
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <StatBox label="Base" value={powerLatest.base_eur != null ? `${powerLatest.base_eur.toFixed(0)} €/MWh` : '--'} big />
              <StatBox label="Peak" value={powerLatest.peak_eur != null ? `${powerLatest.peak_eur.toFixed(0)} €/MWh` : '--'} />
              <StatBox label="vs 30d avg" value={fmtDelta(powerLatest.vs_30d_pct, 1, '%')} signed />
              <StatBox
                label="2yr rank"
                value={powerLatest.pct_rank_2yr != null ? `${powerLatest.pct_rank_2yr.toFixed(0)}th` : '--'}
                title="Percentile of today's base price in the 2yr history."
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <StatBox
                label="Intraday range"
                value={powerLatest.day_range_eur != null ? `${powerLatest.day_range_eur.toFixed(0)} €` : '--'}
                title="Max - min hourly price."
              />
              <StatBox
                label="Neg. hours"
                value={powerLatest.neg_hours != null ? `${powerLatest.neg_hours}h` : '--'}
                title="Hours with negative DA price today."
              />
            </div>
          </div>
        )}

        {/* Hourly price chart */}
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">Price - last 48h (€/MWh)</p>
          {powerLoading ? (
            <Placeholder />
          ) : hourlyPriceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={hourlyPriceData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={11} />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v) => {
                    const n = typeof v === 'number' ? v : null
                    return n != null ? [`${n.toFixed(1)} €/MWh`] : ['--']
                  }}
                />
                <Line type="monotone" dataKey="price" stroke={priceColor} strokeWidth={1.5} dot={false} name="Price" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <NoData />
          )}
        </div>

        {/* Fuel mix today */}
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">
            Fuel mix today
            {genItem?.total_mw != null ? ` - ${(genItem.total_mw / 1000).toFixed(1)} GW` : ''}
            {genData?.gen_date ? ` - ${genData.gen_date}` : ''}
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
          ) : genLoading ? (
            <Placeholder />
          ) : (
            <NoData />
          )}
        </div>

        {/* 24h gen mix stacked area */}
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">Generation mix - today (avg MW)</p>
          {genLoading ? (
            <Placeholder />
          ) : genHourlyChart.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={genHourlyChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} interval={5} />
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
              <FuelLegend fuels={latestFuels.map((f) => f.fuel)} />
            </>
          ) : (
            <NoData />
          )}
        </div>

        {/* Daily gen trend + RE% */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Daily fuel mix + renewable %</p>
            <div className="flex items-center gap-1">
              {(['3M', '1Y', 'ALL'] as TrendWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setGenWindow(w)}
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    w === genWindow
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          {genLoading ? (
            <Placeholder />
          ) : genDailyChart.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={genDailyChart} margin={{ top: 4, right: 28, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="gen_date"
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    tickLine={false}
                    interval={Math.floor(genDailyChart.length / 5)}
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
                  {selectedDate && genDailyChart.some((d) => d.gen_date === selectedDate) && (
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
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <div className="w-4 h-0.5 bg-[#f0fdf4]" />
                <span>Renewable %</span>
              </div>
            </>
          ) : (
            <NoData />
          )}
        </div>

        {/* Daily price range */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Daily price range (€/MWh)</p>
            <div className="flex items-center gap-1">
              {(['1Y', '2Y'] as DailyWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setPriceWindow(w)}
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    w === priceWindow
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          {powerLoading ? (
            <Placeholder />
          ) : priceDaily.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={buildDailyBandData(priceDaily)} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="price_date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(priceDaily.length / 6)}
                  tickFormatter={(v) => (v as string)?.slice(5) ?? ''}
                />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    if (name === '_band_base') return false
                    const n = typeof v === 'number' ? v : null
                    return n != null ? [`${n.toFixed(0)} €/MWh`, String(name)] : ['--', String(name)]
                  }}
                />
                <Area type="monotone" dataKey="_band_base" stackId="band" stroke="none" fill="transparent" legendType="none" tooltipType="none" />
                <Area type="monotone" dataKey="_band_height" stackId="band" stroke="none" fill="rgba(56,189,248,0.10)" legendType="none" name="_band_base" />
                <Line type="monotone" dataKey="base_eur" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Base" />
                <Line type="monotone" dataKey="peak_eur" stroke="#f59e0b" strokeWidth={1} dot={false} strokeDasharray="3 2" name="Peak" />
                <Line type="monotone" dataKey="offpeak_eur" stroke="#818cf8" strokeWidth={1} dot={false} strokeDasharray="2 3" name="Off-peak" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoData />
          )}
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, big, signed, title }: {
  label: string
  value: string
  big?: boolean
  signed?: boolean
  title?: string
}) {
  const isNeg = signed && value.startsWith('-')
  const isPos = signed && value.startsWith('+')
  return (
    <div className="bg-secondary rounded p-2" title={title}>
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className={`${big ? 'text-base' : 'text-sm'} font-medium ${isNeg ? 'text-red-400' : isPos ? 'text-green-400' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function FuelLegend({ fuels }: { fuels: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      {fuels.map((fuel) => (
        <div key={fuel} className="flex items-center gap-1 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: FUEL_COLORS[fuel] }} />
          {fuel}
        </div>
      ))}
    </div>
  )
}

function Placeholder() {
  return <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">Loading...</div>
}

function NoData() {
  return <div className="flex items-center justify-center h-16 text-muted-foreground text-xs">No data</div>
}

function buildFuelBreakdown(item: GenMapItem | null): { fuel: string; mw: number; pct: number }[] {
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
}

function buildHourlyPriceChart(hourly: { ts: string; price_eur_mwh: number | null }[] | undefined) {
  if (!hourly) return []
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  return hourly
    .filter((p) => new Date(p.ts) >= cutoff)
    .map((p) => {
      const d = new Date(p.ts)
      return { label: `${String(d.getUTCHours()).padStart(2, '0')}:00`, price: p.price_eur_mwh }
    })
}

function buildGenHourlyChart(
  hourly: { ts: string; wind?: number | null; solar?: number | null; hydro?: number | null; nuclear?: number | null; gas?: number | null; coal?: number | null; biomass?: number | null; oil?: number | null; geothermal?: number | null; other?: number | null }[],
) {
  if (hourly.length === 0) return []
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000)
  return hourly
    .filter((p) => new Date(p.ts) >= cutoff)
    .map((p) => {
      const d = new Date(p.ts)
      return {
        hour: `${String(d.getUTCHours()).padStart(2, '0')}:00`,
        wind: p.wind ?? 0, solar: p.solar ?? 0, hydro: p.hydro ?? 0,
        nuclear: p.nuclear ?? 0, biomass: p.biomass ?? 0, gas: p.gas ?? 0,
        oil: p.oil ?? 0, coal: p.coal ?? 0, geothermal: p.geothermal ?? 0, other: p.other ?? 0,
      }
    })
}

function buildGenDailyChart(
  daily: { gen_date: string; renewable_pct: number | null; solar?: number | null; wind?: number | null; hydro?: number | null; gas?: number | null; coal?: number | null; nuclear?: number | null; biomass?: number | null; geothermal?: number | null; oil?: number | null; other?: number | null }[],
  window: TrendWindow,
) {
  const cutoff = window === '3M' ? daily.length - 90 : window === '1Y' ? daily.length - 365 : 0
  return daily.slice(Math.max(0, cutoff)).map((pt) => ({
    gen_date: pt.gen_date,
    renewable_pct: pt.renewable_pct,
    wind: pt.wind ?? 0, solar: pt.solar ?? 0, hydro: pt.hydro ?? 0,
    nuclear: pt.nuclear ?? 0, biomass: pt.biomass ?? 0, gas: pt.gas ?? 0,
    oil: pt.oil ?? 0, coal: pt.coal ?? 0, geothermal: pt.geothermal ?? 0, other: pt.other ?? 0,
  }))
}

function buildDailyBandData(
  daily: { price_date: string; base_eur: number | null; peak_eur: number | null; offpeak_eur: number | null; min_eur: number | null; max_eur: number | null }[],
) {
  return daily.map((d) => ({
    price_date: d.price_date,
    base_eur: d.base_eur,
    peak_eur: d.peak_eur,
    offpeak_eur: d.offpeak_eur,
    _band_base: d.min_eur,
    _band_height: d.min_eur != null && d.max_eur != null ? d.max_eur - d.min_eur : null,
  }))
}
