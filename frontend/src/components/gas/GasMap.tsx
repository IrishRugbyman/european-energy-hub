import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import { gasFillColor, CHOROPLETH_FILL_OPACITY, CHOROPLETH_STROKE, CHOROPLETH_STROKE_WIDTH, countryName } from '@/lib/scales'
import type { StorageLatestRow } from '@/lib/api'

// Three-layer approach: no-labels base -> GeoJSON choropleth -> labels on top.
// This avoids the double-border mismatch between tile country outlines and GeoJSON polygons.
const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

interface Props {
  rows: StorageLatestRow[]
  selected: string | null
  onSelect: (cc: string | null) => void
}

export function GasMap({ rows, selected, onSelect }: Props) {
  const latestByCC: Record<string, StorageLatestRow> = {}
  for (const r of rows) {
    if (r.country !== 'EU') latestByCC[r.country] = r
  }

  return (
    <MapContainer
      center={[52, 13]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      {/* Base: terrain + ocean, no country outlines */}
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      {/* Choropleth fills - GeoJSON is sole source of country borders */}
      {Object.keys(latestByCC).length > 0 && (
        <GasChoroLayer latestByCC={latestByCC} selected={selected} onSelect={onSelect} />
      )}
      {/* Labels on top of choropleth fills */}
      <Pane name="labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function GasChoroLayer({
  latestByCC,
  selected,
  onSelect,
}: {
  latestByCC: Record<string, StorageLatestRow>
  selected: string | null
  onSelect: (cc: string | null) => void
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)

  // Load GeoJSON once
  useEffect(() => {
    let cancelled = false
    fetch('/geo/countries.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) {
          map.removeLayer(geoRef.current)
        }
        const layer = createLayer(geo, latestByCC, selected, onSelect)
        layer.addTo(map)
        geoRef.current = layer
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update styles when data or selection changes
  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((layer: Layer) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = (layer as any).feature as Feature
      if (!f?.properties) return
      const cc: string = f.properties['ISO_A2'] ?? f.properties['iso_a2'] ?? ''
      const row = latestByCC[cc]
      const isSelected = cc === selected
      const style: PathOptions = {
        fillColor: gasFillColor(row?.full_pct),
        fillOpacity: isSelected ? 0.9 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
      ;(layer as L.Path).setStyle(style)
    })
  }, [latestByCC, selected])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  latestByCC: Record<string, StorageLatestRow>,
  selected: string | null,
  onSelect: (cc: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = latestByCC[cc]
      return {
        fillColor: gasFillColor(row?.full_pct),
        fillOpacity: cc === selected ? 0.9 : CHOROPLETH_FILL_OPACITY,
        color: cc === selected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: cc === selected ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = latestByCC[cc]
      if (!row) return

      layer.on({
        click: (e: LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onSelect(cc === selected ? null : cc)
        },
        mouseover: (e: LeafletMouseEvent) => {
          const path = e.target as L.Path
          path.setStyle({ weight: 2, color: '#94a3b8' })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = (e.target as any)._map as L.Map
          L.popup({ closeButton: false })
            .setLatLng(e.latlng)
            .setContent(tooltipContent(cc, row))
            .openOn(m)
        },
        mouseout: (e: LeafletMouseEvent) => {
          const path = e.target as L.Path
          path.setStyle({
            weight: cc === selected ? 2 : CHOROPLETH_STROKE_WIDTH,
            color: cc === selected ? '#38bdf8' : CHOROPLETH_STROKE,
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(e.target as any)._map?.closePopup()
        },
      })
    },
  })
}

function tooltipContent(cc: string, row: StorageLatestRow): string {
  const fill = row.full_pct != null ? `${row.full_pct.toFixed(1)}%` : '--'
  const d7 = row.d7_pct != null ? `${row.d7_pct >= 0 ? '+' : ''}${row.d7_pct.toFixed(1)}pp` : '--'
  return `<div style="font-size:12px;line-height:1.5">
    <strong>${countryName(cc)}</strong><br/>
    Fill: ${fill}<br/>
    7d: ${d7}
  </div>`
}
