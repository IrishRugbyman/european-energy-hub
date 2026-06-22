import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import { gasFillColor, gasDeficitColor, CHOROPLETH_FILL_OPACITY, CHOROPLETH_STROKE, CHOROPLETH_STROKE_WIDTH, countryName } from '@/lib/scales'
import type { StorageLatestRow, GasFlowItem, StorageFacilityItem } from '@/lib/api'
import { GasFlowsLayer } from './GasFlowsLayer'
import { StorageFacilitiesLayer } from './StorageFacilitiesLayer'

// Three-layer approach: no-labels base -> GeoJSON choropleth -> labels on top.
// This avoids the double-border mismatch between tile country outlines and GeoJSON polygons.
const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type GasColorMode = 'fill' | 'deficit'

interface Props {
  rows: StorageLatestRow[]
  selected: string | null
  onSelect: (cc: string | null) => void
  colorMode?: GasColorMode
  showFlows?: boolean
  flowRows?: GasFlowItem[]
  selectedFlow?: string | null
  onSelectFlow?: (cc: string | null) => void
  showFacilities?: boolean
  facilityRows?: StorageFacilityItem[]
}

export function GasMap({ rows, selected, onSelect, colorMode = 'fill', showFlows = false, flowRows = [], selectedFlow, onSelectFlow, showFacilities = false, facilityRows = [] }: Props) {
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
        <GasChoroLayer latestByCC={latestByCC} selected={selected} onSelect={onSelect} colorMode={colorMode} />
      )}
      {/* Physical gas flows overlay - colors countries by net GWh/d */}
      {showFlows && flowRows.length > 0 && (
        <GasFlowsLayer
          rows={flowRows}
          selected={selectedFlow ?? selected}
          onSelect={onSelect}
          onSelectFlow={onSelectFlow}
        />
      )}
      {/* UGS facility circles - above choropleth, below labels */}
      {showFacilities && facilityRows.length > 0 && (
        <StorageFacilitiesLayer facilities={facilityRows} latestByCC={latestByCC} />
      )}
      {/* Labels on top of choropleth fills */}
      <Pane name="labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function resolveColor(row: StorageLatestRow | undefined, colorMode: GasColorMode): string {
  if (!row) return '#374151'
  return colorMode === 'deficit' ? gasDeficitColor(row.vs_avg5_pct) : gasFillColor(row.full_pct)
}

function GasChoroLayer({
  latestByCC,
  selected,
  onSelect,
  colorMode,
}: {
  latestByCC: Record<string, StorageLatestRow>
  selected: string | null
  onSelect: (cc: string | null) => void
  colorMode: GasColorMode
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)

  // Keep ref in sync so click handlers always see current selection
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

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
        const layer = createLayer(geo, latestByCC, selectedRef, onSelect, colorMode)
        layer.addTo(map)
        geoRef.current = layer
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update styles when data, selection, or color mode changes
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
        fillColor: resolveColor(row, colorMode),
        fillOpacity: isSelected ? 0.9 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
      ;(layer as L.Path).setStyle(style)
    })
  }, [latestByCC, selected, colorMode])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  latestByCC: Record<string, StorageLatestRow>,
  selectedRef: MutableRefObject<string | null>,
  onSelect: (cc: string | null) => void,
  colorMode: GasColorMode,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = latestByCC[cc]
      const sel = selectedRef.current
      return {
        fillColor: resolveColor(row, colorMode),
        fillOpacity: cc === sel ? 0.9 : CHOROPLETH_FILL_OPACITY,
        color: cc === sel ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: cc === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = latestByCC[cc]
      if (!row) return

      layer.on({
        click: (e: LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onSelect(cc === selectedRef.current ? null : cc)
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
          const isSel = cc === selectedRef.current
          path.setStyle({
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

function tooltipContent(cc: string, row: StorageLatestRow): string {
  const fill = row.full_pct != null ? `${row.full_pct.toFixed(1)}%` : '--'
  const d7 = row.d7_pct != null ? `${row.d7_pct >= 0 ? '+' : ''}${row.d7_pct.toFixed(1)}pp` : '--'
  const vs5yr = row.vs_avg5_pct != null ? `${row.vs_avg5_pct >= 0 ? '+' : ''}${row.vs_avg5_pct.toFixed(1)}pp` : '--'
  return `<div style="font-size:12px;line-height:1.5">
    <strong>${countryName(cc)}</strong><br/>
    Fill: ${fill}<br/>
    7d: ${d7}<br/>
    vs 5yr: ${vs5yr}
  </div>`
}
