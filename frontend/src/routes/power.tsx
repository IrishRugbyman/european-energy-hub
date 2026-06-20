import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api, type PowerLatestRow, type GenMapItem, type DivergenceLatestRow, type CongestionRow, type EuCfLatestResponse } from '@/lib/api'
import { EuroMap, type MapMetric, isPriceMetric, zoneColor } from '@/components/map/EuroMap'
import { UnifiedZonePanel } from '@/components/map/UnifiedZonePanel'
import { BorderPanel } from '@/components/power/BorderPanel'
import { InterconnectionLayer, type BorderKey, type InterconnMode } from '@/components/power/InterconnectionLayer'
import { StaleBanner } from '@/components/StaleBanner'
import { FUEL_PALETTE, renewablePctColor, carbonIntensityColor, computeCarbonIntensity } from '@/lib/scales'

export const Route = createFileRoute('/power')({
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === 'string' && search.date ? search.date : undefined,
  }),
  component: MapDashboard,
})

const UTILIZATION_LEGEND = [
  { label: '> 100%',  color: '#7f1d1d' },
  { label: '90-100%', color: '#b91c1c' },
  { label: '80-90%',  color: '#d97706' },
  { label: '60-80%',  color: '#ca8a04' },
  { label: '40-60%',  color: '#65a30d' },
  { label: '20-40%',  color: '#16a34a' },
  { label: '< 20%',   color: '#15803d' },
  { label: 'no data', color: '#374151' },
]

const DIVERGENCE_LEGEND = [
  { label: '> 40 €/MWh',  color: '#7f1d1d' },
  { label: '20-40 €/MWh', color: '#b91c1c' },
  { label: '10-20 €/MWh', color: '#d97706' },
  { label: '5-10 €/MWh',  color: '#ca8a04' },
  { label: '< 5 €/MWh',   color: '#374151' },
]

type MetricConfig = {
  label: string
  title: string
  items: { label: string; color: string }[]
}

const METRIC_CONFIG: Record<MapMetric, MetricConfig> = {
  price: {
    label: 'Price',
    title: '€/MWh',
    items: [
      { label: '< 20',    color: '#1d4ed8' },
      { label: '20-50',   color: '#0369a1' },
      { label: '50-80',   color: '#0e7490' },
      { label: '80-120',  color: '#15803d' },
      { label: '120-160', color: '#65a30d' },
      { label: '160-200', color: '#ca8a04' },
      { label: '200-250', color: '#d97706' },
      { label: '> 250',   color: '#b91c1c' },
      { label: 'no data', color: '#374151' },
    ],
  },
  range: {
    label: 'Range',
    title: 'Intraday range (€/MWh)',
    items: [
      { label: '< 20',    color: '#1e293b' },
      { label: '20-40',   color: '#4c1d95' },
      { label: '40-60',   color: '#6d28d9' },
      { label: '60-80',   color: '#7c3aed' },
      { label: '80-100',  color: '#8b5cf6' },
      { label: '100-150', color: '#a78bfa' },
      { label: '> 150',   color: '#c4b5fd' },
      { label: 'no data', color: '#374151' },
    ],
  },
  neg_hours: {
    label: 'Neg hrs',
    title: 'Negative-price hours',
    items: [
      { label: '0',    color: '#374151' },
      { label: '1',    color: '#ca8a04' },
      { label: '2-3',  color: '#d97706' },
      { label: '4-7',  color: '#ea580c' },
      { label: '8-11', color: '#b91c1c' },
      { label: '12+',  color: '#7f1d1d' },
    ],
  },
  pct_rank: {
    label: '2yr rank',
    title: '2yr price rank',
    items: [
      { label: '< 10th (cheap)', color: '#1d4ed8' },
      { label: '10-25th',        color: '#0369a1' },
      { label: '25-40th',        color: '#0e7490' },
      { label: '40-60th (mid)',  color: '#15803d' },
      { label: '60-75th',        color: '#65a30d' },
      { label: '75-90th',        color: '#d97706' },
      { label: '> 90th (dear)',  color: '#b91c1c' },
      { label: 'no data',        color: '#374151' },
    ],
  },
  renewable: {
    label: 'Renewable %',
    title: 'Renewable %',
    items: [
      { label: '80-100%', color: renewablePctColor(90) },
      { label: '60-80%',  color: renewablePctColor(70) },
      { label: '40-60%',  color: renewablePctColor(50) },
      { label: '20-40%',  color: renewablePctColor(30) },
      { label: '0-20%',   color: renewablePctColor(10) },
      { label: 'no data', color: '#374151' },
    ],
  },
  dominant_fuel: {
    label: 'Dom. fuel',
    title: 'Dominant fuel',
    items: [
      { label: 'nuclear',    color: FUEL_PALETTE.nuclear },
      { label: 'wind',       color: FUEL_PALETTE.wind },
      { label: 'hydro',      color: FUEL_PALETTE.hydro },
      { label: 'solar',      color: FUEL_PALETTE.solar },
      { label: 'gas',        color: FUEL_PALETTE.gas },
      { label: 'coal',       color: FUEL_PALETTE.coal },
      { label: 'biomass',    color: FUEL_PALETTE.biomass },
      { label: 'geothermal', color: FUEL_PALETTE.geothermal },
      { label: 'oil',        color: FUEL_PALETTE.oil },
      { label: 'no data',    color: '#374151' },
    ],
  },
  carbon_intensity: {
    label: 'Carbon',
    title: 'Carbon intensity (gCO₂/kWh)',
    items: [
      { label: '< 50 (clean)',  color: carbonIntensityColor(30) },
      { label: '50-100',        color: carbonIntensityColor(75) },
      { label: '100-200',       color: carbonIntensityColor(150) },
      { label: '200-300',       color: carbonIntensityColor(250) },
      { label: '300-400',       color: carbonIntensityColor(350) },
      { label: '400-500',       color: carbonIntensityColor(450) },
      { label: '> 500 (dirty)', color: carbonIntensityColor(550) },
      { label: 'no data',       color: '#374151' },
    ],
  },
}

const PRICE_METRICS: MapMetric[] = ['price', 'range', 'neg_hours', 'pct_rank']
const GEN_METRICS: MapMetric[] = ['renewable', 'dominant_fuel', 'carbon_intensity']

function cfRankColor(rank: number | null, type: 'wind' | 'solar'): string {
  if (rank == null) return '#64748b'
  if (type === 'wind') {
    if (rank <= 15) return '#f87171'    // low wind - bearish for RE, bullish for prices
    if (rank >= 85) return '#4ade80'    // high wind
    return '#64748b'
  } else {
    if (rank <= 15) return '#94a3b8'
    if (rank >= 85) return '#fbbf24'    // high solar - bright yellow
    return '#64748b'
  }
}

function EuConditionsStrip({ cf }: { cf: EuCfLatestResponse }) {
  const windColor = cfRankColor(cf.wind_cf_month_pct_rank, 'wind')
  const solarColor = cfRankColor(cf.solar_cf_month_pct_rank, 'solar')
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const mo = cf.gen_date ? monthNames[parseInt(cf.gen_date.slice(5,7)) - 1] : ''

  return (
    <div className="flex items-center gap-3 text-xs bg-card/80 backdrop-blur border border-border rounded px-2.5 py-1.5 shadow-sm">
      <span className="text-muted-foreground font-medium">EU conditions</span>
      <span className="text-muted-foreground">|</span>
      <span>
        <span className="text-muted-foreground">Wind </span>
        <span className="font-medium" style={{ color: windColor }}>{cf.wind_cf ?? '--'}%</span>
        {cf.wind_cf_month_avg != null && (
          <span className="text-muted-foreground"> (avg {cf.wind_cf_month_avg}%, p{cf.wind_cf_month_pct_rank ?? 0} for {mo})</span>
        )}
      </span>
      <span className="text-muted-foreground">|</span>
      <span>
        <span className="text-muted-foreground">Solar </span>
        <span className="font-medium" style={{ color: solarColor }}>{cf.solar_cf ?? '--'}%</span>
        {cf.solar_cf_month_avg != null && (
          <span className="text-muted-foreground"> (avg {cf.solar_cf_month_avg}%, p{cf.solar_cf_month_pct_rank ?? 0} for {mo})</span>
        )}
      </span>
      <span className="text-muted-foreground">|</span>
      <span className="text-muted-foreground">{(cf.wind_installed_gw ?? 0).toFixed(0)} GW wind / {(cf.solar_installed_gw ?? 0).toFixed(0)} GW solar installed</span>
    </div>
  )
}

function MapDashboard() {
  const { date: urlDate } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [selectedZone, setSelectedZone]     = useState<string | null>(null)
  const [selectedBorder, setSelectedBorder] = useState<BorderKey | null>(null)
  const [showInterconnections, setShowInterconnections] = useState(false)
  const [showZoneTable, setShowZoneTable]    = useState(false)
  const [showBordersTable, setShowBordersTable] = useState(false)
  const [interconnMode, setInterconnMode]   = useState<InterconnMode>('congestion')
  const [metric, setMetric]                 = useState<MapMetric>('price')

  const { data: powerData, isLoading: powerLoading, error: powerError } = useQuery({
    queryKey: ['power-map'],
    queryFn: api.powerMap,
  })

  const { data: genData } = useQuery({
    queryKey: ['gen-map', urlDate ?? 'latest'],
    queryFn: () => api.genMap(urlDate),
    staleTime: 15 * 60 * 1000,
  })

  const { data: congestionData } = useQuery({
    queryKey: ['power-congestion'],
    queryFn: api.powerCongestion,
    staleTime: 15 * 60 * 1000,
    enabled: showInterconnections,
  })

  const { data: flowsData } = useQuery({
    queryKey: ['flows'],
    queryFn: api.flows,
    staleTime: 15 * 60 * 1000,
    enabled: showInterconnections,
  })

  const { data: divergenceData } = useQuery({
    queryKey: ['power-divergence'],
    queryFn: api.powerDivergence,
    staleTime: 15 * 60 * 1000,
    enabled: showInterconnections,
  })

  const { data: cfData } = useQuery({
    queryKey: ['gen-eu-cf-latest'],
    queryFn: api.genEuCfLatest,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const powerByZone: Record<string, PowerLatestRow> = {}
  for (const r of powerData?.rows ?? []) powerByZone[r.zone] = r

  const genByZone: Record<string, GenMapItem> = {}
  for (const z of genData?.zones ?? []) genByZone[z.zone] = z

  const prices = (powerData?.rows ?? [])
    .map((r) => r.base_eur)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null
  const priceDate = powerData?.price_date ?? null

  const withGenData = (genData?.zones ?? []).filter((z) => z.renewable_pct != null && z.total_mw != null && z.total_mw > 0)
  const totalMW = withGenData.reduce((s, z) => s + (z.total_mw ?? 0), 0)
  const weightedRE = totalMW > 0
    ? withGenData.reduce((s, z) => s + (z.renewable_pct ?? 0) * (z.total_mw ?? 0), 0) / totalMW
    : null
  const zonesWithCI = withGenData.map((z) => ({ ci: computeCarbonIntensity(z), mw: z.total_mw ?? 0 })).filter((z) => z.ci != null)
  const ciTotalMW = zonesWithCI.reduce((s, z) => s + z.mw, 0)
  const weightedCI = ciTotalMW > 0
    ? Math.round(zonesWithCI.reduce((s, z) => s + (z.ci ?? 0) * z.mw, 0) / ciTotalMW)
    : null
  const genDate = genData?.zones[0]?.gen_date ?? null
  const minDate = genData?.min_date ?? undefined
  const maxDate = genData?.max_date ?? undefined
  const isHistorical = !!urlDate && urlDate !== maxDate

  function handleSelectZone(zone: string | null) {
    setSelectedZone(zone)
    if (zone) setSelectedBorder(null)
  }

  function handleSelectBorder(border: BorderKey | null) {
    setSelectedBorder(border)
    if (border) setSelectedZone(null)
  }

  function setDate(d: string) {
    void navigate({ search: { date: !d || d === maxDate ? undefined : d } })
  }

  const cfg = METRIC_CONFIG[metric]
  const legend = showInterconnections ? null : cfg
  const panelOpen = selectedZone !== null || selectedBorder !== null || showZoneTable || showBordersTable
  const isGenMetric = !isPriceMetric(metric)

  return (
    <div className="relative h-full flex">
      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5 items-end">
        {/* Interconnections toggle + mode sub-toggle */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowInterconnections((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border transition-colors ${
              showInterconnections
                ? 'bg-amber-900 border-amber-600 text-amber-200'
                : 'bg-card/90 border-border text-muted-foreground hover:text-foreground'
            } backdrop-blur shadow`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            Interconnections
          </button>
          {showInterconnections && (
            <div className="flex rounded border border-border bg-card/90 backdrop-blur shadow overflow-hidden text-xs">
              <button
                onClick={() => setInterconnMode('congestion')}
                className={`px-2 py-1.5 transition-colors ${
                  interconnMode === 'congestion'
                    ? 'bg-amber-800 text-amber-200'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                NTC
              </button>
              <button
                onClick={() => setInterconnMode('spread')}
                className={`px-2 py-1.5 transition-colors ${
                  interconnMode === 'spread'
                    ? 'bg-amber-800 text-amber-200'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                Spread
              </button>
            </div>
          )}
        </div>

        {/* Zone table toggle */}
        <button
          onClick={() => { setShowZoneTable((v) => !v); setSelectedZone(null); setSelectedBorder(null); setShowBordersTable(false) }}
          className={`px-2.5 py-1.5 rounded text-xs border transition-colors backdrop-blur shadow ${
            showZoneTable
              ? 'bg-sky-900 border-sky-600 text-sky-200'
              : 'bg-card/90 border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Zone table
        </button>

        {/* Borders table toggle */}
        <button
          onClick={() => { setShowBordersTable((v) => !v); setSelectedZone(null); setSelectedBorder(null); setShowZoneTable(false); if (!showInterconnections) setShowInterconnections(true) }}
          className={`px-2.5 py-1.5 rounded text-xs border transition-colors backdrop-blur shadow ${
            showBordersTable
              ? 'bg-amber-900 border-amber-600 text-amber-200'
              : 'bg-card/90 border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Borders
        </button>

        {/* Date picker (gen metrics) */}
        {isGenMetric && (minDate || maxDate) && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={urlDate ?? maxDate ?? ''}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="text-xs px-2 py-1.5 rounded border border-border bg-card/90 text-foreground backdrop-blur shadow focus:outline-none focus:border-sky-500"
            />
            {isHistorical && (
              <button
                onClick={() => setDate(maxDate ?? '')}
                className="px-2 py-1.5 rounded border border-border bg-card/90 text-muted-foreground hover:text-foreground text-xs backdrop-blur shadow transition-colors"
              >
                Latest
              </button>
            )}
          </div>
        )}

        {/* Metric selector */}
        <div className="bg-card/90 backdrop-blur border border-border rounded shadow flex flex-col gap-0.5 p-1">
          <p className="text-muted-foreground text-[10px] px-1 pb-0.5">Prices</p>
          {PRICE_METRICS.map((m) => (
            <MetricBtn key={m} m={m} active={metric} label={METRIC_CONFIG[m].label} onChange={setMetric} />
          ))}
          <div className="border-t border-border my-0.5" />
          <p className="text-muted-foreground text-[10px] px-1 pb-0.5">Generation</p>
          {GEN_METRICS.map((m) => (
            <MetricBtn key={m} m={m} active={metric} label={METRIC_CONFIG[m].label} onChange={setMetric} />
          ))}
        </div>
      </div>

      {/* Top-center stat strip - shows the single most relevant EU aggregate for the active metric */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 px-4 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {powerLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : powerError ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : (
          <>
            {isPriceMetric(metric) && medianPrice != null && (
              <StatChip label="EU median price" value={`${medianPrice.toFixed(0)} €/MWh`} />
            )}
            {(metric === 'renewable' || metric === 'dominant_fuel') && weightedRE != null && (
              <StatChip label="EU avg renewable" value={`${weightedRE.toFixed(0)}%`} />
            )}
            {metric === 'carbon_intensity' && weightedCI != null && (
              <StatChip label="EU carbon intensity" value={`${weightedCI} gCO₂/kWh`} />
            )}
            {priceDate && !isHistorical && (
              <span className="text-muted-foreground text-xs">{priceDate}</span>
            )}
            {genDate && isHistorical && (
              <span className="text-amber-400 text-xs">{genDate} (historical)</span>
            )}
          </>
        )}
      </div>

      {/* Bottom-left legend */}
      {legend && (
        <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
          <p className="text-muted-foreground mb-1 font-medium">{legend.title}</p>
          {legend.items.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}
      {showInterconnections && (
        <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
          <p className="text-muted-foreground mb-1 font-medium">
            {interconnMode === 'spread' ? 'Price spread' : 'NTC utilization'}
          </p>
          {(interconnMode === 'spread' ? DIVERGENCE_LEGEND : UTILIZATION_LEGEND).map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom-right: EU wind/solar conditions strip */}
      {cfData && !isHistorical && (
        <div className="hidden sm:block absolute bottom-6 right-3 z-[1000]">
          <EuConditionsStrip cf={cfData} />
        </div>
      )}

      {/* Map */}
      <div className="flex-1">
        <EuroMap
          powerByZone={powerByZone}
          genByZone={genByZone}
          selected={selectedZone}
          onSelect={handleSelectZone}
          metric={metric}
        >
          {showInterconnections && (
            <InterconnectionLayer
              congestion={congestionData?.rows ?? []}
              flows={flowsData?.rows ?? []}
              divergence={divergenceData?.rows ?? []}
              colorMode={interconnMode}
              selected={selectedBorder}
              onSelect={handleSelectBorder}
            />
          )}
        </EuroMap>
      </div>

      <StaleBanner datasetKey="power" />

      {/* Side panel */}
      {panelOpen && (
        <div className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-card border-t border-border z-[1000] overflow-y-auto rounded-t-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none">
          <div className="flex justify-center pt-2 pb-1 sm:hidden">
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          {selectedZone && (
            <UnifiedZonePanel
              zone={selectedZone}
              powerLatest={powerByZone[selectedZone] ?? null}
              genItem={genByZone[selectedZone] ?? null}
              onClose={() => setSelectedZone(null)}
              selectedDate={urlDate}
              allZones={powerData?.rows}
            />
          )}
          {selectedBorder && (() => {
            const bKey = [selectedBorder.from, selectedBorder.to].sort().join('|')
            const divRow = (divergenceData?.rows ?? []).find(
              (r) => [r.from_zone, r.to_zone].sort().join('|') === bKey,
            ) ?? null
            const divHist = (divergenceData?.history ?? []).find(
              (h) => [h.from_zone, h.to_zone].sort().join('|') === bKey,
            )?.history ?? []
            return (
              <BorderPanel
                from={selectedBorder.from}
                to={selectedBorder.to}
                congestion={congestionData?.rows ?? []}
                flows={flowsData?.rows ?? []}
                divergenceRow={divRow}
                divergenceHistory={divHist}
                onClose={() => setSelectedBorder(null)}
              />
            )
          })()}
          {showZoneTable && !selectedZone && !selectedBorder && (
            <ZoneTable
              power={powerData?.rows ?? []}
              gen={genData?.zones ?? []}
              onSelect={(zone) => { setShowZoneTable(false); setSelectedZone(zone) }}
              onClose={() => setShowZoneTable(false)}
            />
          )}
          {showBordersTable && !selectedZone && !selectedBorder && (
            <BordersTable
              divergence={divergenceData?.rows ?? []}
              congestion={congestionData?.rows ?? []}
              onSelect={(fz, tz) => { setShowBordersTable(false); setSelectedBorder({ from: fz, to: tz }) }}
              onClose={() => setShowBordersTable(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MetricBtn({
  m, active, label, onChange,
}: { m: MapMetric; active: MapMetric; label: string; onChange: (m: MapMetric) => void }) {
  return (
    <button
      onClick={() => onChange(m)}
      className={`px-2 py-1 rounded text-xs text-left transition-colors ${
        m === active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      {label}
    </button>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}

// Expose zoneColor for use in legend previews (keeps import clean)
export { zoneColor }

type ZoneSortKey = 'base_eur' | 'vs_30d_pct' | 'pct_rank_2yr' | 'neg_hours' | 'renewable_pct'

function ZoneTable({
  power,
  gen,
  onSelect,
  onClose,
}: {
  power: PowerLatestRow[]
  gen: GenMapItem[]
  onSelect: (zone: string) => void
  onClose: () => void
}) {
  const [sortKey, setSortKey] = useState<ZoneSortKey>('base_eur')
  const [sortAsc, setSortAsc] = useState(false)

  const reByZone = useMemo(() => {
    const m: Record<string, number | null> = {}
    gen.forEach((g) => { m[g.zone] = g.renewable_pct })
    return m
  }, [gen])

  const rows = useMemo(() => {
    return [...power]
      .map((r) => ({ ...r, renewable_pct: reByZone[r.zone] ?? null }))
      .sort((a, b) => {
        const av = (a as Record<string, number | null | string>)[sortKey] as number | null
        const bv = (b as Record<string, number | null | string>)[sortKey] as number | null
        const diff = (av ?? (sortAsc ? Infinity : -Infinity)) - (bv ?? (sortAsc ? Infinity : -Infinity))
        return sortAsc ? diff : -diff
      })
  }, [power, reByZone, sortKey, sortAsc])

  const toggleSort = (key: ZoneSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortArrow = (key: ZoneSortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  const fmtPrice = (v: number | null) => v != null ? `${v.toFixed(0)}` : '--'
  const fmtDelta = (v: number | null) => {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
  }
  const fmtRank = (v: number | null) => v != null ? `${v.toFixed(0)}th` : '--'
  const fmtPct = (v: number | null) => v != null ? `${v.toFixed(0)}%` : '--'

  const headerBtn = (key: ZoneSortKey, label: string) => (
    <th
      className="px-2 py-1.5 text-right font-normal text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap"
      onClick={() => toggleSort(key)}
    >
      {label}{sortArrow(key)}
    </th>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-medium text-sm">All zones - today</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="text-left px-4 py-1.5 font-normal text-muted-foreground">Zone</th>
              {headerBtn('base_eur', '€/MWh')}
              {headerBtn('vs_30d_pct', 'vs 30d')}
              {headerBtn('pct_rank_2yr', '2yr %')}
              {headerBtn('neg_hours', 'Neg')}
              {headerBtn('renewable_pct', 'RE%')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vsColor = r.vs_30d_pct == null ? '#64748b' : r.vs_30d_pct >= 0 ? '#f87171' : '#4ade80'
              const reColor = r.renewable_pct == null ? '#64748b' : r.renewable_pct >= 60 ? '#4ade80' : r.renewable_pct >= 30 ? '#fbbf24' : '#f87171'
              return (
                <tr
                  key={r.zone}
                  className="border-b border-border/40 hover:bg-secondary/50 cursor-pointer"
                  onClick={() => onSelect(r.zone)}
                >
                  <td className="px-4 py-1.5 font-mono text-foreground">{r.zone}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-foreground">{fmtPrice(r.base_eur)}</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: vsColor }}>{fmtDelta(r.vs_30d_pct)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtRank(r.pct_rank_2yr)}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">{r.neg_hours ?? 0}h</td>
                  <td className="px-2 py-1.5 text-right" style={{ color: reColor }}>{fmtPct(r.renewable_pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
        Click a row to open zone detail - click column headers to sort
      </div>
    </div>
  )
}

type BorderSortKey = 'diff' | 'util' | 'ntc'

function BordersTable({
  divergence,
  congestion,
  onSelect,
  onClose,
}: {
  divergence: DivergenceLatestRow[]
  congestion: CongestionRow[]
  onSelect: (fz: string, tz: string) => void
  onClose: () => void
}) {
  const [sortKey, setSortKey] = useState<BorderSortKey>('diff')
  const [sortAsc, setSortAsc] = useState(false)

  const congMap = useMemo(() => {
    const m: Record<string, CongestionRow> = {}
    congestion.forEach((r) => { m[`${r.from_zone}|${r.to_zone}`] = r })
    return m
  }, [congestion])

  const rows = useMemo(() => {
    return [...divergence]
      .map((d) => {
        const cong = congMap[`${d.from_zone}|${d.to_zone}`] ?? congMap[`${d.to_zone}|${d.from_zone}`]
        return {
          from_zone: d.from_zone,
          to_zone: d.to_zone,
          diff: d.diff_eur_mwh != null ? Math.abs(d.diff_eur_mwh) : null,
          util: cong?.utilization_pct ?? null,
          ntc: cong?.ntc_mw ?? null,
        }
      })
      .sort((a, b) => {
        const av = a[sortKey] as number | null
        const bv = b[sortKey] as number | null
        const diff = (av ?? (sortAsc ? Infinity : -Infinity)) - (bv ?? (sortAsc ? Infinity : -Infinity))
        return sortAsc ? diff : -diff
      })
  }, [divergence, congMap, sortKey, sortAsc])

  const toggleSort = (key: BorderSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortArrow = (key: BorderSortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  const headerBtn = (key: BorderSortKey, label: string) => (
    <th
      className="px-2 py-1.5 text-right font-normal text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap"
      onClick={() => toggleSort(key)}
    >
      {label}{sortArrow(key)}
    </th>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-medium text-sm">Border spreads + congestion</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="text-left px-4 py-1.5 font-normal text-muted-foreground">Border</th>
              {headerBtn('diff', 'Spread')}
              {headerBtn('util', 'NTC util')}
              {headerBtn('ntc', 'NTC MW')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diffColor = r.diff == null ? '#64748b' : r.diff >= 30 ? '#f87171' : r.diff >= 10 ? '#fbbf24' : '#4ade80'
              const utilColor = r.util == null ? '#64748b' : r.util >= 90 ? '#f87171' : r.util >= 70 ? '#fbbf24' : '#4ade80'
              return (
                <tr
                  key={`${r.from_zone}-${r.to_zone}`}
                  className="border-b border-border/40 hover:bg-secondary/50 cursor-pointer"
                  onClick={() => onSelect(r.from_zone, r.to_zone)}
                >
                  <td className="px-4 py-1.5 font-mono text-foreground whitespace-nowrap">
                    {r.from_zone} <span className="text-muted-foreground">→</span> {r.to_zone}
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium" style={{ color: diffColor }}>
                    {r.diff != null ? `${r.diff.toFixed(1)} €/MWh` : '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={{ color: utilColor }}>
                    {r.util != null ? `${Math.min(r.util, 150).toFixed(0)}%` : '--'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {r.ntc != null ? `${r.ntc.toFixed(0)}` : '--'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
        Click a row to open border detail - spread color: green &lt;10, amber &lt;30, red 30+ EUR/MWh
      </div>
    </div>
  )
}
