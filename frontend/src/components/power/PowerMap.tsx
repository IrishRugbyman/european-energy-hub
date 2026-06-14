import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef, type ReactNode, type MutableRefObject } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import {
  powerPriceColor,
  dayRangeColor,
  negHoursColor,
  pctRankColor,
  CHOROPLETH_FILL_OPACITY,
  CHOROPLETH_STROKE,
  CHOROPLETH_STROKE_WIDTH,
  zoneName,
} from '@/lib/scales'
import type { PowerLatestRow } from '@/lib/api'

const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type PowerMetric = 'price' | 'range' | 'neg_hours' | 'pct_rank'

export function metricColor(metric: PowerMetric, row: PowerLatestRow | undefined): string {
  if (!row) return '#374151'
  switch (metric) {
    case 'price':    return powerPriceColor(row.base_eur)
    case 'range':    return dayRangeColor(row.day_range_eur)
    case 'neg_hours': return negHoursColor(row.neg_hours)
    case 'pct_rank': return pctRankColor(row.pct_rank_2yr)
  }
}

interface Props {
  rows: PowerLatestRow[]
  selected: string | null
  onSelect: (zone: string | null) => void
  metric?: PowerMetric
  children?: ReactNode
}

export function PowerMap({ rows, selected, onSelect, metric = 'price', children }: Props) {
  const latestByZone: Record<string, PowerLatestRow> = {}
  for (const r of rows) latestByZone[r.zone] = r

  return (
    <MapContainer
      center={[54, 15]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      {Object.keys(latestByZone).length > 0 && (
        <PowerChoroLayer
          latestByZone={latestByZone}
          selected={selected}
          onSelect={onSelect}
          metric={metric}
        />
      )}
      {children}
      <Pane name="power-labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function PowerChoroLayer({
  latestByZone,
  selected,
  onSelect,
  metric,
}: {
  latestByZone: Record<string, PowerLatestRow>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: PowerMetric
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)
  const metricRef = useRef<PowerMetric>(metric)

  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { metricRef.current = metric }, [metric])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/bidding_zones.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) map.removeLayer(geoRef.current)
        const layer = createLayer(geo, latestByZone, selectedRef, metricRef, onSelect)
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
      const row = latestByZone[zone]
      const isSelected = zone === selected
      ;(layer as L.Path).setStyle({
        fillColor: metricColor(metric, row),
        fillOpacity: isSelected ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      })
    })
  }, [latestByZone, selected, metric])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  latestByZone: Record<string, PowerLatestRow>,
  selectedRef: MutableRefObject<string | null>,
  metricRef: MutableRefObject<PowerMetric>,
  onSelect: (zone: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const zone = feature?.properties?.['zone'] ?? ''
      const row = latestByZone[zone]
      const sel = selectedRef.current
      return {
        fillColor: metricColor(metricRef.current, row),
        fillOpacity: zone === sel ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: zone === sel ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: zone === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const zone = feature?.properties?.['zone'] ?? ''
      const row = latestByZone[zone]

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
            .setContent(tooltipContent(zone, row, metricRef.current))
            .openOn(m)
        },
        mouseout: (e: LeafletMouseEvent) => {
          const isSel = zone === selectedRef.current
          ;(e.target as L.Path).setStyle({
            weight: isSel ? 2 : CHOROPLETH_STROKE_WIDTH,
            color: isSel ? '#38bdf8' : CHOROPLETH_STROKE,
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(e.target as any)._map?.closePopup()
        },
      })
    },
  })
}

function tooltipContent(zone: string, row: PowerLatestRow | undefined, metric: PowerMetric): string {
  const name = zoneName(zone)
  const base = row?.base_eur != null ? `${row.base_eur.toFixed(0)} €/MWh` : '--'
  const vs = row?.vs_30d_pct != null
    ? `${row.vs_30d_pct >= 0 ? '+' : ''}${row.vs_30d_pct.toFixed(1)}% vs 30d`
    : ''

  const metricLine = (() => {
    switch (metric) {
      case 'range':
        return row?.day_range_eur != null ? `Range: ${row.day_range_eur.toFixed(0)} €/MWh` : ''
      case 'neg_hours':
        return row?.neg_hours != null ? `Neg hours: ${row.neg_hours}h` : ''
      case 'pct_rank':
        return row?.pct_rank_2yr != null ? `2yr rank: ${row.pct_rank_2yr.toFixed(0)}th pct` : ''
      default:
        return vs
    }
  })()

  return `<div style="font-size:12px;line-height:1.5">
    <strong>${name}</strong><br/>
    Base: ${base}${metricLine ? `<br/>${metricLine}` : ''}
  </div>`
}
