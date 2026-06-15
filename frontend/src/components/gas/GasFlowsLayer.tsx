import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { useMap } from 'react-leaflet'
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import { gasFlowColor, CHOROPLETH_STROKE, CHOROPLETH_STROKE_WIDTH, countryName } from '@/lib/scales'
import type { GasFlowItem } from '@/lib/api'

interface Props {
  rows: GasFlowItem[]
  selected: string | null
  onSelect: (cc: string | null) => void
  onSelectFlow?: (cc: string | null) => void
}

export function GasFlowsLayer({ rows, selected, onSelect, onSelectFlow }: Props) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)

  const flowByCC: Record<string, GasFlowItem> = {}
  for (const r of rows) flowByCC[r.country] = r

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  // Load GeoJSON once and store the layer
  useEffect(() => {
    let cancelled = false
    fetch('/geo/countries.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) map.removeLayer(geoRef.current)
        const layer = createLayer(geo, flowByCC, selectedRef, onSelectFlow ?? onSelect)
        layer.addTo(map)
        geoRef.current = layer
      })
      .catch(console.error)
    return () => {
      cancelled = true
      if (geoRef.current) {
        map.removeLayer(geoRef.current)
        geoRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-style when data or selection changes
  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((layer: Layer) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = (layer as any).feature as Feature
      if (!f?.properties) return
      const cc: string = f.properties['ISO_A2'] ?? f.properties['iso_a2'] ?? ''
      const row = flowByCC[cc]
      const isSelected = cc === selected
      const style: PathOptions = {
        fillColor: gasFlowColor(row?.net_gwh_d),
        fillOpacity: row ? (isSelected ? 0.9 : 0.8) : 0,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
      ;(layer as L.Path).setStyle(style)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  flowByCC: Record<string, GasFlowItem>,
  selectedRef: MutableRefObject<string | null>,
  onSelect: (cc: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = flowByCC[cc]
      const sel = selectedRef.current
      return {
        fillColor: gasFlowColor(row?.net_gwh_d),
        fillOpacity: row ? (cc === sel ? 0.9 : 0.8) : 0,
        color: cc === sel ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: cc === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const cc = feature?.properties?.['ISO_A2'] ?? feature?.properties?.['iso_a2'] ?? ''
      const row = flowByCC[cc]
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

function tooltipContent(cc: string, row: GasFlowItem): string {
  const net = row.net_gwh_d != null ? `${row.net_gwh_d >= 0 ? '+' : ''}${row.net_gwh_d.toFixed(0)} GWh/d` : '--'
  const entry = row.entry_gwh_d != null ? `${row.entry_gwh_d.toFixed(0)} GWh/d` : '--'
  const exit_ = row.exit_gwh_d != null ? `${row.exit_gwh_d.toFixed(0)} GWh/d` : '--'
  const dir = row.net_gwh_d == null ? '' : row.net_gwh_d >= 0 ? 'Net importer' : 'Net exporter'
  return `<div style="font-size:12px;line-height:1.6">
    <strong>${countryName(cc)}</strong><br/>
    Net: <strong>${net}</strong>${dir ? ` (${dir})` : ''}<br/>
    Entry: ${entry} &nbsp; Exit: ${exit_}<br/>
    <span style="color:#64748b;font-size:10px">${row.period_date}</span>
  </div>`
}
