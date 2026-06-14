import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type PowerLatestRow } from '@/lib/api'
import { PowerMap, type PowerMetric } from '@/components/power/PowerMap'
import { ZonePanel } from '@/components/power/ZonePanel'
import { BorderPanel } from '@/components/power/BorderPanel'
import { InterconnectionLayer, type BorderKey } from '@/components/power/InterconnectionLayer'
import { StaleBanner } from '@/components/StaleBanner'

export const Route = createFileRoute('/power')({
  component: PowerDashboard,
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

const METRIC_LEGENDS: Record<PowerMetric, { title: string; items: { label: string; color: string }[] }> = {
  price: {
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
}

function PowerDashboard() {
  const [selectedZone, setSelectedZone]       = useState<string | null>(null)
  const [selectedBorder, setSelectedBorder]   = useState<BorderKey | null>(null)
  const [showInterconnections, setShowInterconnections] = useState(false)
  const [mapMetric, setMapMetric]             = useState<PowerMetric>('price')

  const { data, isLoading, error } = useQuery({
    queryKey: ['power-map'],
    queryFn: api.powerMap,
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

  const latestByZone: Record<string, PowerLatestRow> = {}
  for (const row of data?.rows ?? []) latestByZone[row.zone] = row

  const prices = (data?.rows ?? [])
    .map((r) => r.base_eur)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null
  const priceDate = data?.price_date ?? null

  function handleSelectZone(zone: string | null) {
    setSelectedZone(zone)
    if (zone) setSelectedBorder(null)
  }

  function handleSelectBorder(border: BorderKey | null) {
    setSelectedBorder(border)
    if (border) setSelectedZone(null)
  }

  const panelOpen = selectedZone !== null || selectedBorder !== null

  return (
    <div className="relative h-full flex">
      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
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

        {/* Map metric selector */}
        <div className="bg-card/90 backdrop-blur border border-border rounded shadow flex flex-col gap-0.5 p-1">
          <p className="text-muted-foreground text-[10px] px-1 pb-0.5">Map layer</p>
          {([
            ['price',     'Price'],
            ['range',     'Range'],
            ['neg_hours', 'Neg hrs'],
            ['pct_rank',  '2yr rank'],
          ] as [PowerMetric, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMapMetric(m)}
              className={`px-2 py-1 rounded text-xs text-left transition-colors ${
                m === mapMetric
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Top-center stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 px-4 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {medianPrice != null ? (
          <>
            <StatChip label="EU median" value={`${medianPrice.toFixed(0)} €/MWh`} />
            <StatChip label="zones" value={`${prices.length}`} />
            {priceDate && <span className="text-muted-foreground text-xs">{priceDate}</span>}
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Bottom-left legend */}
      <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        {showInterconnections ? (
          <>
            <p className="text-muted-foreground mb-1 font-medium">NTC utilization</p>
            {UTILIZATION_LEGEND.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{label}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            <p className="text-muted-foreground mb-1 font-medium">{METRIC_LEGENDS[mapMetric].title}</p>
            {METRIC_LEGENDS[mapMetric].items.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-muted-foreground">{label}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Map */}
      <div className="flex-1">
        <PowerMap
          rows={data?.rows ?? []}
          selected={selectedZone}
          onSelect={handleSelectZone}
          metric={mapMetric}
        >
          {showInterconnections && (
            <InterconnectionLayer
              congestion={congestionData?.rows ?? []}
              flows={flowsData?.rows ?? []}
              selected={selectedBorder}
              onSelect={handleSelectBorder}
            />
          )}
        </PowerMap>
      </div>

      <StaleBanner datasetKey="power" />

      {/* Side panel (shared slot for zone and border) */}
      {panelOpen && (
        <div className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-card border-t border-border z-[1000] overflow-y-auto rounded-t-xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none">
          <div className="flex justify-center pt-2 pb-1 sm:hidden">
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          {selectedZone && (
            <ZonePanel
              zone={selectedZone}
              latest={latestByZone[selectedZone] ?? null}
              onClose={() => setSelectedZone(null)}
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

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}
