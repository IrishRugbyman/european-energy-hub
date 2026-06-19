import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import {
  api,
  type PowerLatestRow,
  type GenMapItem,
  type CapacityFactorPoint,
  type HourlyProfilePoint,
  type DowPoint,
  type MonthPoint,
  type ZoneCorrelationRow,
} from '@/lib/api'
import { powerPriceColor, renewablePctColor, computeCarbonIntensity, FUEL_PALETTE, zoneName } from '@/lib/scales'
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

type PanelTab = 'price' | 'generation'

export function UnifiedZonePanel({ zone, powerLatest, genItem, onClose, selectedDate }: Props) {
  const [tab, setTab] = useState<PanelTab>('price')
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

  const { data: capacityData } = useQuery({
    queryKey: ['gen-capacity', zone],
    queryFn: () => api.genCapacity(zone),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

  const { data: profileData } = useQuery({
    queryKey: ['power-zone-profile', zone],
    queryFn: () => api.powerZoneProfile(zone),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

  const { data: seasonalityData } = useQuery({
    queryKey: ['power-zone-seasonality', zone],
    queryFn: () => api.powerZoneSeasonality(zone),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })

  const { data: corrData } = useQuery({
    queryKey: ['power-correlations'],
    queryFn: api.powerCorrelations,
    staleTime: 60 * 60 * 1000,
  })

  const priceColor = powerPriceColor(powerLatest?.base_eur)
  const reColor = renewablePctColor(genItem?.renewable_pct)
  const carbonIntensity = computeCarbonIntensity(genItem)

  const hourlyPriceData = buildHourlyPriceChart(powerData?.hourly_recent)
  const priceHeatmapRows = buildPriceHeatmap(powerData?.hourly_recent)
  const allDaily = powerData?.daily_history ?? []
  const priceDaily = priceWindow === '1Y' ? allDaily.slice(-365) : allDaily

  const allGenDaily = genData?.daily ?? []
  const genDailyChart = buildGenDailyChart(allGenDaily, genWindow)
  const genHourlyChart = buildGenHourlyChart(genData?.hourly ?? [])

  const latestFuels = buildFuelBreakdown(genItem)
  const capacityFactorChart = buildCapacityFactorChart(capacityData?.daily ?? [])

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

      {/* Tab switcher */}
      <div className="flex border-b border-border">
        {(['price', 'generation'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t
                ? 'text-foreground border-b-2 border-sky-500'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'price' ? 'Price' : 'Generation'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---- PRICE TAB ---- */}
        {tab === 'price' && <>

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
            {powerData?.net_import_mw != null && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                <span
                  className="font-medium"
                  style={{ color: powerData.net_import_mw > 0 ? '#f87171' : '#4ade80' }}
                >
                  {powerData.net_import_mw > 0 ? 'Net import' : 'Net export'}
                  {' '}{Math.abs(powerData.net_import_mw / 1000).toFixed(1)} GW
                </span>
                <span className="text-muted-foreground">
                  {powerData.net_import_mw > 0
                    ? '(buying from neighbors - price support)'
                    : '(selling to neighbors - price suppressed)'}
                </span>
              </div>
            )}
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

        {/* Price heatmap: 8d x 24h */}
        {!powerLoading && priceHeatmapRows.length > 0 && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">Price heatmap - last 8 days (hover for exact price)</p>
            <PriceHeatmap rows={priceHeatmapRows} />
          </div>
        )}

        {/* 24h price profile: avg by hour-of-day over 90 days */}
        {profileData && profileData.rows.length > 0 && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Avg. hourly profile - 90 days (CET)
            </p>
            <HourlyProfileChart rows={profileData.rows} />
          </div>
        )}

        {/* Seasonal price patterns */}
        {seasonalityData && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">Price seasonality - 2yr avg (€/MWh)</p>
            <SeasonalityCharts dow={seasonalityData.dow} monthly={seasonalityData.monthly} />
          </div>
        )}

        </> /* end price tab */}

        {/* ---- GENERATION TAB ---- */}
        {tab === 'generation' && <>

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

        {/* Wind & Solar capacity factors */}
        {capacityFactorChart.length > 0 && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">
              Wind &amp; solar capacity factor
              {capacityData?.wind_installed_mw != null && capacityData?.solar_installed_mw != null && (
                <span className="ml-1 text-xs opacity-70">
                  ({(capacityData.wind_installed_mw / 1000).toFixed(0)} GW wind / {(capacityData.solar_installed_mw / 1000).toFixed(0)} GW solar installed)
                </span>
              )}
            </p>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={capacityFactorChart} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="gen_date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  interval={Math.floor(capacityFactorChart.length / 5)}
                  tickFormatter={(v) => (v as string)?.slice(5) ?? ''}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickLine={false}
                  width={28}
                  tickFormatter={(v) => `${Math.round((v as number) * 100)}%`}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
                  formatter={(v, name) => {
                    const n = typeof v === 'number' ? v : null
                    return n != null ? [`${(n * 100).toFixed(1)}%`, String(name) === 'wind_cf30' ? 'Wind CF' : 'Solar CF'] : ['--', String(name)]
                  }}
                  labelFormatter={(l) => String(l)}
                />
                <Line type="monotone" dataKey="wind_cf30" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="wind_cf30" />
                <Line type="monotone" dataKey="solar_cf30" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="solar_cf30" />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-4 h-0.5 bg-sky-400" /><span>Wind CF</span></div>
              <div className="flex items-center gap-1"><div className="w-4 h-0.5 bg-amber-400" /><span>Solar CF</span></div>
              <span className="opacity-60">30d rolling avg</span>
            </div>
          </div>
        )}

        </> /* end generation tab */}

        {/* ---- PRICE TAB (continued: historical charts) ---- */}
        {tab === 'price' && <>

        {/* Calendar heatmap - 52 weeks of daily base price */}
        {allDaily.length >= 14 && (
          <div className="p-3 pt-1">
            <p className="text-xs text-muted-foreground mb-2">Daily price calendar (€/MWh)</p>
            <PriceCalendarHeatmap daily={allDaily.slice(-365)} />
          </div>
        )}

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

        {/* 30-day price correlation with other zones */}
        {corrData && <ZoneCorrelationChart zone={zone} rows={corrData.rows} />}

        </> /* end price tab continued */}
      </div>
    </div>
  )
}

function ZoneCorrelationChart({ zone, rows }: { zone: string; rows: ZoneCorrelationRow[] }) {
  const peers = useMemo(() => {
    const relevant = rows
      .filter((r) => r.zone_a === zone || r.zone_b === zone)
      .map((r) => ({
        peer: r.zone_a === zone ? r.zone_b : r.zone_a,
        corr: r.correlation ?? 0,
      }))
      .sort((a, b) => b.corr - a.corr)
    if (!relevant.length) return []
    // Top 8 most correlated + bottom 3 least correlated, deduped
    const top = relevant.slice(0, 8)
    const bottom = relevant.slice(-3).filter((r) => !top.includes(r))
    return [...top, ...bottom]
  }, [zone, rows])

  if (!peers.length) return null

  const corrColor = (c: number) => {
    if (c >= 0.95) return '#16a34a'   // deep green - very tight coupling
    if (c >= 0.85) return '#4d7c0f'   // lime - strong
    if (c >= 0.70) return '#ca8a04'   // yellow - moderate
    if (c >= 0.50) return '#d97706'   // amber - weak
    if (c >= 0)    return '#78350f'   // brown - poor
    return '#b91c1c'                   // red - negative / counter-cyclical
  }

  return (
    <div className="p-3 pt-1 border-t border-border/50">
      <p className="text-xs text-muted-foreground mb-2">30d price correlation (vs other zones)</p>
      <div className="space-y-1">
        {peers.map(({ peer, corr }) => (
          <div key={peer} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-14 shrink-0 text-right">{peer}</span>
            <div className="flex-1 h-3 bg-secondary rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${Math.max(0, Math.min(100, Math.abs(corr) * 100))}%`,
                  background: corrColor(corr),
                }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums w-10 shrink-0" style={{ color: corrColor(corr) }}>
              {corr >= 0 ? '+' : ''}{corr.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground/60 mt-2">Green = tightly coupled zone. Red = counter-cyclical.</p>
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

function PriceHeatmap({ rows }: { rows: HeatmapRow[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      {/* Hour labels: 0 6 12 18 24 */}
      <div className="flex ml-[36px] mb-0.5">
        {[0, 6, 12, 18].map((h) => (
          <span
            key={h}
            className="text-[9px] text-muted-foreground"
            style={{ width: `${(6 / 24) * 100}%` }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      {rows.map(({ dayLabel, cells }) => (
        <div key={dayLabel} className="flex items-center gap-0.5 mb-0.5">
          <span className="text-[9px] text-muted-foreground w-[36px] shrink-0 text-right pr-1 font-mono">
            {dayLabel}
          </span>
          <div className="flex flex-1 gap-[1px]">
            {cells.map((price, h) => (
              <div
                key={h}
                className="flex-1 rounded-sm"
                style={{
                  height: 10,
                  backgroundColor: price != null ? powerPriceColor(price) : '#1e293b',
                }}
                title={price != null ? `${String(h).padStart(2, '0')}:00  ${price.toFixed(1)} €/MWh` : `${String(h).padStart(2, '0')}:00  --`}
              />
            ))}
          </div>
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

function SeasonalityCharts({ dow, monthly }: { dow: DowPoint[]; monthly: MonthPoint[] }) {
  const WEEKDAY_COLOR = '#60a5fa'
  const WEEKEND_COLOR = '#94a3b8'
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon-Sun
  const sortedDow = DOW_ORDER.map((d) => dow.find((r) => r.dow === d)).filter(Boolean) as DowPoint[]

  const isWeekend = (d: DowPoint) => d.dow === 0 || d.dow === 6

  return (
    <div className="space-y-3">
      {/* Day of week */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">Day of week</p>
        <ResponsiveContainer width="100%" height={70}>
          <BarChart data={sortedDow} margin={{ top: 2, right: 2, bottom: 0, left: 0 }} barCategoryGap="10%">
            <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(1)} €/MWh` : '--', 'Avg']}
            />
            <Bar dataKey="avg_eur" radius={[2, 2, 0, 0]}>
              {sortedDow.map((d) => (
                <rect key={d.dow} fill={isWeekend(d) ? WEEKEND_COLOR : WEEKDAY_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-400 inline-block" />Weekday</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-400 inline-block" />Weekend</span>
        </div>
      </div>
      {/* Month of year */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">Month of year</p>
        <ResponsiveContainer width="100%" height={70}>
          <BarChart data={monthly} margin={{ top: 2, right: 2, bottom: 0, left: 0 }} barCategoryGap="10%">
            <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
              formatter={(v: unknown, name: unknown) => {
                const n = typeof v === 'number' ? v : null
                return name === 'avg_neg_hrs'
                  ? [n != null ? `${n.toFixed(1)}h` : '--', 'Neg hrs']
                  : [n != null ? `${n.toFixed(1)} €/MWh` : '--', 'Avg price']
              }}
            />
            <Bar dataKey="avg_eur" fill="#60a5fa" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function HourlyProfileChart({ rows }: { rows: HourlyProfilePoint[] }) {
  const data = rows.map((r) => ({
    h: `${r.hour.toString().padStart(2, '0')}`,
    avg: r.avg_eur,
    p25: r.p25_eur,
    p75: r.p75_eur,
    neg_pct: r.neg_pct,
  }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="h" tick={{ fontSize: 8, fill: '#64748b' }} tickLine={false} interval={3} />
          <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} width={36} />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null
              if (name === 'avg') return [n != null ? `${n.toFixed(1)} €/MWh` : '--', 'Avg']
              if (name === 'p25') return [n != null ? `${n.toFixed(1)} €/MWh` : '--', 'P25']
              if (name === 'p75') return [n != null ? `${n.toFixed(1)} €/MWh` : '--', 'P75']
              return [n != null ? `${n.toFixed(1)}%` : '--', 'Neg %']
            }}
          />
          {/* IQR band as faint area between p25 and p75 */}
          <Area type="monotone" dataKey="p75" stroke="none" fill="#38bdf8" fillOpacity={0.12} legendType="none" />
          <Area type="monotone" dataKey="p25" stroke="none" fill="#0f1117" fillOpacity={1} legendType="none" />
          {/* Negative hours as faint red bars */}
          <Bar dataKey="neg_pct" yAxisId="neg" fill="#f87171" opacity={0.35} legendType="none" />
          <YAxis yAxisId="neg" orientation="right" tick={{ fontSize: 8, fill: '#f8717160' }} tickLine={false} width={28} tickFormatter={(v) => `${v}%`} />
          <Line type="monotone" dataKey="avg" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="avg" />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-sky-400" /><span>Avg price</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 bg-sky-400/15 rounded-sm" /><span>IQR band</span></div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 bg-red-400/35 rounded-sm" /><span>Neg. hour %</span></div>
      </div>
    </div>
  )
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

type HeatmapRow = { dayLabel: string; cells: (number | null)[] }

function buildPriceHeatmap(hourly: { ts: string; price_eur_mwh: number | null }[] | undefined): HeatmapRow[] {
  if (!hourly || hourly.length === 0) return []
  // Group by UTC date + hour; average sub-hourly readings (e.g. 15-min ENTSO-E data)
  const byDateHour: Record<string, Record<number, number[]>> = {}
  for (const pt of hourly) {
    if (pt.price_eur_mwh == null) continue
    const d = new Date(pt.ts)
    const dateKey = d.toISOString().slice(0, 10)
    const hour = d.getUTCHours()
    if (!byDateHour[dateKey]) byDateHour[dateKey] = {}
    if (!byDateHour[dateKey][hour]) byDateHour[dateKey][hour] = []
    byDateHour[dateKey][hour].push(pt.price_eur_mwh)
  }
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return Object.keys(byDateHour)
    .sort()
    .slice(-8)
    .map((dateKey) => {
      const d = new Date(dateKey + 'T12:00:00Z')
      const dayLabel = `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, ' ')}`
      const cells: (number | null)[] = Array.from({ length: 24 }, (_, h) => {
        const readings = byDateHour[dateKey][h]
        if (!readings || readings.length === 0) return null
        return readings.reduce((s, v) => s + v, 0) / readings.length
      })
      return { dayLabel, cells }
    })
    .reverse()
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

function buildCapacityFactorChart(daily: CapacityFactorPoint[], windowDays = 30) {
  if (daily.length === 0) return []
  // O(n) sliding-window rolling average - maintain running sums instead of re-slicing each step.
  const result: { gen_date: string; wind_cf30: number | null; solar_cf30: number | null }[] = []
  let windSum = 0, windCount = 0, solarSum = 0, solarCount = 0
  for (let i = 0; i < daily.length; i++) {
    // Add incoming value
    const wIn = daily[i].wind_cf
    const sIn = daily[i].solar_cf
    if (wIn != null) { windSum += wIn; windCount++ }
    if (sIn != null) { solarSum += sIn; solarCount++ }
    // Drop outgoing value when window is full
    if (i >= windowDays) {
      const wOut = daily[i - windowDays].wind_cf
      const sOut = daily[i - windowDays].solar_cf
      if (wOut != null) { windSum -= wOut; windCount-- }
      if (sOut != null) { solarSum -= sOut; solarCount-- }
    }
    result.push({
      gen_date: daily[i].gen_date,
      wind_cf30: windCount > 0 ? windSum / windCount : null,
      solar_cf30: solarCount > 0 ? solarSum / solarCount : null,
    })
  }
  // Skip the initial warm-up period (< 15 days of data)
  return result.filter((_, i) => i >= 14)
}

function PriceCalendarHeatmap({ daily }: { daily: { price_date: string; base_eur: number | null }[] }) {
  // Build quantile-based color mapping - memoized so sort only re-runs when daily data changes.
  const quantiles = useMemo(() => {
    const prices = daily.map((d) => d.base_eur).filter((v): v is number => v != null)
    if (prices.length === 0) return null
    const sorted = [...prices].sort((a, b) => a - b)
    const q = (p: number) => sorted[Math.max(0, Math.floor(p * sorted.length) - 1)]
    return { q0: q(0), q20: q(0.2), q40: q(0.4), q60: q(0.6), q80: q(0.8), q100: q(1) }
  }, [daily])
  if (quantiles == null) return null
  const { q0, q20, q40, q60, q80, q100 } = quantiles

  const cellColor = (price: number | null): string => {
    if (price == null) return '#1e293b'
    if (price < 0) return '#7c3aed'     // negative price: purple
    if (price <= q20) return '#166534'  // very cheap: dark green
    if (price <= q40) return '#15803d'  // cheap: green
    if (price <= q60) return '#78350f'  // mid: dark amber
    if (price <= q80) return '#b45309'  // expensive: amber
    return '#b91c1c'                     // very expensive: red
  }

  // Group by week (Mon-Sun). Align to Monday of the first week.
  const byDate = new Map(daily.map((d) => [d.price_date, d.base_eur]))
  // Start from Monday of the week containing the earliest date
  const firstDate = new Date(daily[0].price_date)
  const dayOfWeek = firstDate.getDay() // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const startDate = new Date(firstDate)
  startDate.setDate(startDate.getDate() + mondayOffset)

  const endDate = new Date(daily[daily.length - 1].price_date)

  const weeks: { date: string; price: number | null; dayOfWeek: number; monthLabel?: string }[][] = []
  let cur = new Date(startDate)
  let currentWeek: typeof weeks[0] = []
  let prevMonth = -1

  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  while (cur <= endDate) {
    const iso = toLocalIso(cur)
    const month = cur.getMonth()
    const dayIdx = cur.getDay() === 0 ? 6 : cur.getDay() - 1 // 0=Mon, 6=Sun
    const monthLabel = month !== prevMonth ? cur.toLocaleString('en', { month: 'short' }) : undefined
    prevMonth = month
    currentWeek.push({ date: iso, price: byDate.get(iso) ?? null, dayOfWeek: dayIdx, monthLabel })
    if (dayIdx === 6) {
      weeks.push(currentWeek)
      currentWeek = []
    }
    cur.setDate(cur.getDate() + 1)
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const CELL = 9
  const GAP = 1

  return (
    <div className="overflow-x-auto">
      <div style={{ display: 'grid', gridTemplateColumns: `18px repeat(${weeks.length}, ${CELL}px)`, gap: 0 }}>
        {/* Day labels column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
          <div style={{ height: 12 }} />
          {DAYS.map((d, i) => (
            <div key={i} style={{ height: CELL, fontSize: 7, color: '#475569', display: 'flex', alignItems: 'center' }}>{d}</div>
          ))}
        </div>
        {/* Week columns */}
        {weeks.map((week, wi) => {
          const monthLabelCell = week.find((d) => d.monthLabel)
          return (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
              <div style={{ height: 12, fontSize: 7, color: '#64748b', whiteSpace: 'nowrap', overflow: 'visible', lineHeight: '12px' }}>
                {monthLabelCell?.monthLabel ?? ''}
              </div>
              {Array.from({ length: 7 }, (_, di) => {
                const cell = week.find((d) => d.dayOfWeek === di)
                const price = cell?.price ?? null
                return (
                  <div
                    key={di}
                    title={cell ? `${cell.date}: ${price != null ? `${price.toFixed(0)} €/MWh` : 'no data'}` : ''}
                    style={{
                      width: CELL,
                      height: CELL,
                      backgroundColor: cell ? cellColor(price) : 'transparent',
                      borderRadius: 1.5,
                    }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
        <span style={{ fontSize: 8 }}>Cheap</span>
        {(['#166534', '#15803d', '#78350f', '#b45309', '#b91c1c'] as const).map((color, i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
        ))}
        <span style={{ fontSize: 8 }}>Expensive</span>
        <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#7c3aed', marginLeft: 6 }} />
        <span style={{ fontSize: 8 }}>Negative</span>
        <span className="ml-auto" style={{ fontSize: 8 }}>
          range {q0.toFixed(0)} - {q100.toFixed(0)} €/MWh
        </span>
      </div>
    </div>
  )
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
