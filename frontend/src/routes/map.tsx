import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type PowerLatestRow, type GenMapItem } from '@/lib/api'
import { EuroMap, type MapMetric, isPriceMetric, zoneColor } from '@/components/map/EuroMap'
import { UnifiedZonePanel } from '@/components/map/UnifiedZonePanel'
import { BorderPanel } from '@/components/power/BorderPanel'
import { InterconnectionLayer, type BorderKey } from '@/components/power/InterconnectionLayer'
import { StaleBanner } from '@/components/StaleBanner'
import { FUEL_PALETTE, renewablePctColor } from '@/lib/scales'

export const Route = createFileRoute('/map')({
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
}

const PRICE_METRICS: MapMetric[] = ['price', 'range', 'neg_hours', 'pct_rank']
const GEN_METRICS: MapMetric[] = ['renewable', 'dominant_fuel']

function MapDashboard() {
  const { date: urlDate } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [selectedZone, setSelectedZone]     = useState<string | null>(null)
  const [selectedBorder, setSelectedBorder] = useState<BorderKey | null>(null)
  const [showInterconnections, setShowInterconnections] = useState(false)
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
  const panelOpen = selectedZone !== null || selectedBorder !== null
  const isGenMetric = !isPriceMetric(metric)

  return (
    <div className="relative h-full flex">
      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5 items-end">
        {/* Interconnections toggle */}
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

      {/* Top-center stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 px-4 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {powerLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : powerError ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : (
          <>
            {medianPrice != null && (
              <StatChip label="EU median price" value={`${medianPrice.toFixed(0)} €/MWh`} />
            )}
            {weightedRE != null && (
              <StatChip label="EU avg renewable" value={`${weightedRE.toFixed(0)}%`} />
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
          <p className="text-muted-foreground mb-1 font-medium">NTC utilization</p>
          {UTILIZATION_LEGEND.map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
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
            />
          )}
          {selectedBorder && (
            <BorderPanel
              from={selectedBorder.from}
              to={selectedBorder.to}
              congestion={congestionData?.rows ?? []}
              flows={flowsData?.rows ?? []}
              onClose={() => setSelectedBorder(null)}
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
