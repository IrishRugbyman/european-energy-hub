import L from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import type { GeoJsonObject } from 'geojson'
import type { UsStorageLatestRow } from '@/lib/api'

const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type UsGasColorMode = 'vs-avg' | 'implied-fill'

// vs 5yr avg % -> color. Diverging: deep red (deficit) -> grey (neutral) -> deep green (surplus).
function vsAvgColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'
  if (pct <= -20) return '#7f1d1d'
  if (pct <= -10) return '#b91c1c'
  if (pct <= -5)  return '#d97706'
  if (pct <= -2)  return '#ca8a04'
  if (pct <=  2)  return '#4b5563'
  if (pct <=  5)  return '#4d7c0f'
  if (pct <= 10)  return '#16a34a'
  return '#15803d'
}

// Implied fill % (current vs 5yr max) -> color. Same scale as EU gas fill.
function impliedFillColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'
  const v = Math.max(0, Math.min(100, pct))
  if (v < 40)  return '#7f1d1d'
  if (v < 55)  return '#b91c1c'
  if (v < 70)  return '#d97706'
  if (v < 80)  return '#ca8a04'
  if (v < 88)  return '#65a30d'
  if (v < 95)  return '#16a34a'
  return '#15803d'
}

function resolveColor(row: UsStorageLatestRow | undefined, mode: UsGasColorMode): string {
  if (!row) return '#374151'
  return mode === 'implied-fill'
    ? impliedFillColor(row.implied_fill_pct)
    : vsAvgColor(row.vs_avg5_pct)
}

interface Props {
  rows: UsStorageLatestRow[]
  selected: string | null
  onSelect: (region: string | null) => void
  colorMode?: UsGasColorMode
}

export function USGasMap({ rows, selected, onSelect, colorMode = 'vs-avg' }: Props) {
  const latestByRegion: Record<string, UsStorageLatestRow> = {}
  for (const r of rows) {
    latestByRegion[r.region] = r
  }

  return (
    <MapContainer
      center={[39, -96]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      {Object.keys(latestByRegion).length > 0 && (
        <USGasChoroLayer
          latestByRegion={latestByRegion}
          selected={selected}
          onSelect={onSelect}
          colorMode={colorMode}
        />
      )}
      <Pane name="labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function USGasChoroLayer({
  latestByRegion,
  selected,
  onSelect,
  colorMode,
}: {
  latestByRegion: Record<string, UsStorageLatestRow>
  selected: string | null
  onSelect: (region: string | null) => void
  colorMode: UsGasColorMode
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/us_gas_regions.geojson')
      .then((r) => r.json())
      .then((geojson: GeoJsonObject) => {
        if (cancelled) return
        const layer = L.geoJSON(geojson, {
          style: (feature) => {
            const region: string = feature?.properties?.region ?? ''
            const row = latestByRegion[region]
            const color = resolveColor(row, colorMode)
            const isSelected = selectedRef.current === region
            return {
              fillColor: color,
              fillOpacity: isSelected ? 1.0 : 0.82,
              color: isSelected ? '#f8fafc' : '#0f172a',
              weight: isSelected ? 2 : 0.6,
            }
          },
          onEachFeature: (feature, layer) => {
            const region: string = feature?.properties?.region ?? ''
            const row = latestByRegion[region]

            const tipLines = [
              `<strong>${region}</strong>`,
              row
                ? [
                    `${row.value_bcf != null ? row.value_bcf.toFixed(0) : '--'} Bcf`,
                    row.vs_avg5_bcf != null
                      ? `${row.vs_avg5_bcf >= 0 ? '+' : ''}${row.vs_avg5_bcf.toFixed(0)} Bcf vs 5yr avg`
                      : '',
                    row.vs_avg5_pct != null
                      ? `(${row.vs_avg5_pct >= 0 ? '+' : ''}${row.vs_avg5_pct.toFixed(1)}%)`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                : 'no data',
            ]
            layer.bindTooltip(tipLines.join('<br>'), { sticky: true })

            layer.on('click', () => {
              const was = selectedRef.current
              const next = was === region ? null : region
              selectedRef.current = next
              onSelect(next)
              ;(geoRef.current as L.GeoJSON | null)?.eachLayer((l) => {
                const f = (l as L.Path & { feature?: GeoJSON.Feature }).feature
                const r: string = f?.properties?.region ?? ''
                const data = latestByRegion[r]
                const col = resolveColor(data, colorMode)
                const sel = next === r
                ;(l as L.Path).setStyle({
                  fillColor: col,
                  fillOpacity: sel ? 1.0 : 0.82,
                  color: sel ? '#f8fafc' : '#0f172a',
                  weight: sel ? 2 : 0.6,
                })
              })
            })
          },
        })
        geoRef.current = layer
        layer.addTo(map)
      })
    return () => {
      cancelled = true
      if (geoRef.current) {
        geoRef.current.remove()
        geoRef.current = null
      }
    }
  }, [map, latestByRegion, onSelect, colorMode])

  // Update styles when selection changes without reloading GeoJSON
  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((l) => {
      const f = (l as L.Path & { feature?: GeoJSON.Feature }).feature
      const region: string = f?.properties?.region ?? ''
      const row = latestByRegion[region]
      const color = resolveColor(row, colorMode)
      const isSelected = selected === region
      ;(l as L.Path).setStyle({
        fillColor: color,
        fillOpacity: isSelected ? 1.0 : 0.82,
        color: isSelected ? '#f8fafc' : '#0f172a',
        weight: isSelected ? 2 : 0.6,
      })
    })
  }, [selected, latestByRegion, colorMode])

  return null
}

// Color scale exports for legend
export { vsAvgColor, impliedFillColor }
