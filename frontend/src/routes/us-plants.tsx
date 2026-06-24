import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import { X, ExternalLink } from 'lucide-react'
import { api, type UsNgPlant } from '@/lib/api'

export const Route = createFileRoute('/us-plants')({
  component: UsPlantsDashboard,
})

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

// Size circle by sqrt(capacity) so area ~ capacity
function radiusFor(mw: number | null | undefined): number {
  if (!mw) return 4
  return Math.max(4, Math.min(22, Math.sqrt(mw) * 0.55))
}

// Color by capacity tier
function circleColor(mw: number | null | undefined): string {
  if (!mw) return '#94a3b8'
  if (mw >= 2000) return '#ef4444' // red - mega plants
  if (mw >= 1000) return '#f97316' // orange - large
  if (mw >= 500)  return '#fbbf24' // amber - medium-large
  if (mw >= 200)  return '#4ade80' // green - medium
  return '#60a5fa'                  // blue - small
}

// Marker layer component
function PlantMarkers({
  plants,
  onSelect,
  selected,
}: {
  plants: UsNgPlant[]
  onSelect: (p: UsNgPlant | null) => void
  selected: UsNgPlant | null
}) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return
    if (layerRef.current) {
      layerRef.current.clearLayers()
    } else {
      layerRef.current = L.layerGroup().addTo(map)
    }

    // Sort so small circles draw on top of large ones
    const sorted = [...plants].sort((a, b) => (b.nameplate_mw ?? 0) - (a.nameplate_mw ?? 0))

    for (const plant of sorted) {
      const isSelected = selected?.plant_id === plant.plant_id
      const circle = L.circleMarker([plant.lat, plant.lon], {
        radius: radiusFor(plant.nameplate_mw),
        fillColor: circleColor(plant.nameplate_mw),
        color: isSelected ? '#ffffff' : 'rgba(0,0,0,0.3)',
        weight: isSelected ? 2 : 0.5,
        fillOpacity: isSelected ? 1.0 : 0.75,
      })
      circle.bindTooltip(
        `<strong>${plant.name}</strong><br/>${plant.nameplate_mw?.toFixed(0) ?? '--'} MW &bull; ${plant.state}`,
        { direction: 'top', offset: [0, -4] }
      )
      circle.on('click', () => onSelect(plant))
      layerRef.current.addLayer(circle)
    }

    return () => {
      layerRef.current?.clearLayers()
    }
  }, [map, plants, selected, onSelect])

  return null
}

type FilterMode = 'all' | 'largest' | 'recent'
type MinMw = 0 | 200 | 500 | 1000

function UsPlantsDashboard() {
  const [selected, setSelected] = useState<UsNgPlant | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [minMw, setMinMw] = useState<MinMw>(0)

  const { data, isLoading } = useQuery({
    queryKey: ['us-ng-plants'],
    queryFn: api.usNgPlants,
    staleTime: 24 * 60 * 60 * 1000, // static dataset, cache for a day
  })

  const plants = useMemo(() => {
    let list = data?.plants ?? []
    if (filterMode !== 'all') list = list.filter((p) => p.category === filterMode)
    if (minMw > 0) list = list.filter((p) => (p.nameplate_mw ?? 0) >= minMw)
    return list
  }, [data, filterMode, minMw])

  const totalMw = useMemo(
    () => plants.reduce((s, p) => s + (p.nameplate_mw ?? 0), 0),
    [plants]
  )

  return (
    <div className="relative h-full flex">
      {/* Top stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm">
        {isLoading ? (
          <span className="text-muted-foreground text-xs">Loading...</span>
        ) : (
          <>
            <StatChip label="Plants shown" value={String(plants.length)} />
            <StatChip label="Total capacity" value={`${(totalMw / 1000).toFixed(1)} GW`} />
            <span className="text-muted-foreground text-border hidden sm:block">|</span>
            <span className="hidden sm:block text-[10px] text-muted-foreground">Source: cleanview.co + EIA-860</span>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
        {/* Category filter */}
        <div className="flex rounded-lg overflow-hidden border border-border shadow-lg text-xs">
          {([['all', 'All'], ['largest', 'Largest'], ['recent', 'Recent']] as [FilterMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-2.5 py-1.5 transition-colors ${
                filterMode === mode
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'bg-card/90 backdrop-blur text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Min MW filter */}
        <div className="flex rounded-lg overflow-hidden border border-border shadow-lg text-xs">
          {([0, 200, 500, 1000] as MinMw[]).map((mw) => (
            <button
              key={mw}
              onClick={() => setMinMw(mw)}
              className={`px-2.5 py-1.5 transition-colors ${
                minMw === mw
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'bg-card/90 backdrop-blur text-muted-foreground hover:text-foreground'
              }`}
            >
              {mw === 0 ? 'All MW' : `${mw}+ MW`}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0">
        <MapContainer
          center={[39.5, -98.5]}
          zoom={4}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
        >
          <TileLayer url={CARTO_DARK} attribution={CARTO_ATTR} />
          <TileLayer url={CARTO_LABELS} />
          <PlantMarkers plants={plants} onSelect={setSelected} selected={selected} />
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="hidden sm:block absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="text-muted-foreground mb-1 font-medium">Capacity (circle area ~ MW)</p>
        {[
          { color: '#ef4444', label: '>= 2,000 MW' },
          { color: '#f97316', label: '1,000 - 2,000 MW' },
          { color: '#fbbf24', label: '500 - 1,000 MW' },
          { color: '#4ade80', label: '200 - 500 MW' },
          { color: '#60a5fa', label: '< 200 MW' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.8 }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Drill-down panel */}
      {selected && (
        <div className="absolute right-0 top-0 bottom-0 w-72 z-[1000] bg-card/95 backdrop-blur border-l border-border overflow-y-auto">
          <PlantPanel plant={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

// ---------- Plant detail panel ------------------------------------------------

function PlantPanel({ plant, onClose }: { plant: UsNgPlant; onClose: () => void }) {
  const capacityFactorEst =
    plant.gen_gwh != null && plant.nameplate_mw != null && plant.nameplate_mw > 0
      ? (plant.gen_gwh * 1000) / (plant.nameplate_mw * 8760) // GWh -> MWh, divide by hours in year
      : null

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground leading-tight">{plant.name}</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {plant.county}, {plant.state} &bull; {plant.ba_code}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2 shrink-0">
          <X size={14} />
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Nameplate capacity" value={plant.nameplate_mw != null ? `${plant.nameplate_mw.toFixed(0)} MW` : '--'} accent={circleColor(plant.nameplate_mw)} />
        <MetricCard label="Annual generation" value={plant.gen_gwh != null ? `${plant.gen_gwh.toLocaleString()} GWh` : '--'} />
        <MetricCard label="Commissioned" value={plant.op_year != null ? String(plant.op_year) : '--'} />
        <MetricCard
          label="Est. capacity factor"
          value={capacityFactorEst != null ? `${(capacityFactorEst * 100).toFixed(1)}%` : '--'}
          sub="gen / (MW × 8760h)"
        />
      </div>

      {/* Operator */}
      <div className="bg-muted/20 rounded-lg px-3 py-2">
        <p className="text-[10px] text-muted-foreground mb-0.5">Operator</p>
        <p className="text-xs text-foreground">{plant.entity_name || '--'}</p>
      </div>

      {/* Cleanview link */}
      <a
        href={plant.cleanview_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
      >
        <ExternalLink size={12} />
        <span>View on cleanview.co</span>
      </a>

      {/* Category badge */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          plant.category === 'largest'
            ? 'bg-orange-500/20 text-orange-400'
            : 'bg-blue-500/20 text-blue-400'
        }`}>
          {plant.category === 'largest' ? 'Largest in state' : 'Recently built'}
        </span>
        <span className="text-[10px] text-muted-foreground">per cleanview.co</span>
      </div>

      <p className="text-[9px] text-muted-foreground leading-relaxed">
        Coordinates and capacity from EIA Form EIA-860M (Mar 2026). Annual generation from EIA Form EIA-923 (2024). Plant curation from cleanview.co.
      </p>
    </div>
  )
}

// ---------- Helpers ----------------------------------------------------------

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[10px] text-muted-foreground leading-none mb-0.5">{label}</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  )
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-muted/20 rounded-lg px-3 py-2">
      <p className="text-[10px] text-muted-foreground leading-none mb-1">{label}</p>
      <p className="text-sm font-semibold" style={{ color: accent ?? 'inherit' }}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}
