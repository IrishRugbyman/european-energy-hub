import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import {
  renewablePctColor,
  dominantFuelColor,
  FUEL_PALETTE,
  CHOROPLETH_FILL_OPACITY,
  CHOROPLETH_STROKE,
  CHOROPLETH_STROKE_WIDTH,
  zoneName,
} from '@/lib/scales'
import type { GenMapItem } from '@/lib/api'

const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type GenMetric = 'renewable' | 'dominant'

interface Props {
  zones: GenMapItem[]
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: GenMetric
}

function computeDominantFuel(item: GenMapItem | undefined): string | null {
  if (!item) return null
  const fuels: [string, number | null][] = [
    ['solar', item.solar_mw], ['wind', item.wind_mw], ['hydro', item.hydro_mw],
    ['gas', item.gas_mw], ['coal', item.coal_mw], ['nuclear', item.nuclear_mw],
    ['biomass', item.biomass_mw], ['geothermal', item.geothermal_mw],
    ['oil', item.oil_mw], ['other', item.other_mw],
  ]
  const valid = fuels.filter(([, v]) => v != null && v > 0) as [string, number][]
  if (valid.length === 0) return null
  return valid.reduce((a, b) => (a[1] > b[1] ? a : b))[0]
}

function zoneColor(item: GenMapItem | undefined, metric: GenMetric): string {
  if (!item) return '#374151'
  if (metric === 'dominant') return dominantFuelColor(computeDominantFuel(item))
  return renewablePctColor(item.renewable_pct)
}

function top3Fuels(item: GenMapItem | undefined): { fuel: string; mw: number }[] {
  if (!item) return []
  const fuels: [string, number | null][] = [
    ['solar', item.solar_mw], ['wind', item.wind_mw], ['hydro', item.hydro_mw],
    ['gas', item.gas_mw], ['coal', item.coal_mw], ['nuclear', item.nuclear_mw],
    ['biomass', item.biomass_mw], ['geothermal', item.geothermal_mw],
    ['oil', item.oil_mw], ['other', item.other_mw],
  ]
  return fuels
    .filter(([, v]) => v != null && v > 0)
    .map(([fuel, mw]) => ({ fuel, mw: mw as number }))
    .sort((a, b) => b.mw - a.mw)
    .slice(0, 3)
}

export function GenMap({ zones, selected, onSelect, metric }: Props) {
  const byZone: Record<string, GenMapItem> = {}
  for (const z of zones) byZone[z.zone] = z

  return (
    <MapContainer
      center={[54, 15]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      <GenChoroLayer byZone={byZone} selected={selected} onSelect={onSelect} metric={metric} />
      <Pane name="gen-labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function GenChoroLayer({
  byZone,
  selected,
  onSelect,
  metric,
}: {
  byZone: Record<string, GenMapItem>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: GenMetric
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)
  const metricRef = useRef<GenMetric>(metric)

  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { metricRef.current = metric }, [metric])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/bidding_zones.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) map.removeLayer(geoRef.current)
        const layer = createLayer(geo, byZone, selectedRef, metricRef, onSelect)
        layer.addTo(map)
        geoRef.current = layer
      })
      .catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((layer: Layer) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = (layer as any).feature as Feature
      const zone: string = f?.properties?.['zone'] ?? ''
      const item = byZone[zone]
      const isSelected = zone === selected
      ;(layer as L.Path).setStyle({
        fillColor: zoneColor(item, metric),
        fillOpacity: isSelected ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#4ade80' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      })
    })
  }, [byZone, selected, metric])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  byZone: Record<string, GenMapItem>,
  selectedRef: React.MutableRefObject<string | null>,
  metricRef: React.MutableRefObject<GenMetric>,
  onSelect: (zone: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const zone = feature?.properties?.['zone'] ?? ''
      const item = byZone[zone]
      const sel = selectedRef.current
      return {
        fillColor: zoneColor(item, metricRef.current),
        fillOpacity: zone === sel ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: zone === sel ? '#4ade80' : CHOROPLETH_STROKE,
        weight: zone === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const zone = feature?.properties?.['zone'] ?? ''
      const item = byZone[zone]

      layer.on({
        click: (e: LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onSelect(zone === selectedRef.current ? null : zone)
        },
        mouseover: (e: LeafletMouseEvent) => {
          ;(e.target as L.Path).setStyle({ weight: 2, color: '#94a3b8' })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = (e.target as any)._map as L.Map
          L.popup({ closeButton: false })
            .setLatLng(e.latlng)
            .setContent(tooltipContent(zone, item, metricRef.current))
            .openOn(m)
        },
        mouseout: (e: LeafletMouseEvent) => {
          const isSel = zone === selectedRef.current
          ;(e.target as L.Path).setStyle({
            weight: isSel ? 2 : CHOROPLETH_STROKE_WIDTH,
            color: isSel ? '#4ade80' : CHOROPLETH_STROKE,
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(e.target as any)._map?.closePopup()
        },
      })
    },
  })
}

function tooltipContent(zone: string, item: GenMapItem | undefined, metric: GenMetric): string {
  const name = zoneName(zone)
  const total = item?.total_mw != null ? `${(item.total_mw / 1000).toFixed(1)} GW total` : ''

  if (metric === 'dominant') {
    const t3 = top3Fuels(item)
    const dominant = t3[0]?.fuel ?? 'no data'
    const fuelRows = t3
      .map(({ fuel, mw }) => {
        const color = FUEL_PALETTE[fuel] ?? '#6b7280'
        const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:4px"></span>`
        return `<div>${dot}${fuel} ${(mw / 1000).toFixed(1)} GW</div>`
      })
      .join('')
    return `<div style="font-size:12px;line-height:1.6">
      <strong>${name}</strong><br/>
      dominant: ${dominant}${total ? `<br/>${total}` : ''}<br/>
      ${fuelRows}
    </div>`
  }

  const pct = item?.renewable_pct != null ? `${item.renewable_pct.toFixed(0)}% renewable` : 'no data'
  const t3 = top3Fuels(item)
  const fuelRows = t3
    .map(({ fuel, mw }) => {
      const color = FUEL_PALETTE[fuel] ?? '#6b7280'
      const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:4px"></span>`
      return `<div>${dot}${fuel} ${(mw / 1000).toFixed(1)} GW</div>`
    })
    .join('')
  return `<div style="font-size:12px;line-height:1.6">
    <strong>${name}</strong><br/>
    ${pct}${total ? `<br/>${total}` : ''}<br/>
    ${fuelRows}
  </div>`
}
