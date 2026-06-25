import L from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import type { GeoJsonObject } from 'geojson'
import type { UsPowerRegionLatest } from '@/lib/api'

const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type UsPowerColorMode = 'ng-pct' | 're-pct' | 'total-mwh'

const RE_FUELS = new Set(['WND', 'SUN', 'WAT'])

export function computeRePct(region: UsPowerRegionLatest): number {
  if (region.total_mwh <= 0) return 0
  const reMwh = region.fuels
    .filter((f) => RE_FUELS.has(f.fueltype))
    .reduce((s, f) => s + f.value_mwh, 0)
  return (100 * reMwh) / region.total_mwh
}

// NG% color: green (low gas) -> amber -> red (high gas, like FL at ~81%)
export function ngPctColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'
  if (pct < 20)  return '#15803d'  // deep green
  if (pct < 35)  return '#16a34a'
  if (pct < 45)  return '#65a30d'
  if (pct < 55)  return '#ca8a04'
  if (pct < 65)  return '#d97706'
  if (pct < 75)  return '#b91c1c'
  return '#7f1d1d'                  // deep red (Florida/very gas-heavy)
}

// RE% color: grey (low RE) -> green (high RE)
export function rePctColor(pct: number | null | undefined): string {
  if (pct == null) return '#374151'
  if (pct < 10)  return '#374151'
  if (pct < 20)  return '#1d4ed8'
  if (pct < 30)  return '#2563eb'
  if (pct < 40)  return '#65a30d'
  if (pct < 55)  return '#16a34a'
  if (pct < 70)  return '#15803d'
  return '#064e3b'  // deep green (very high RE, e.g. NW hydro)
}

// Total MWh color: blue gradient by generation scale
export function totalMwhColor(mwh: number | null | undefined): string {
  if (mwh == null || mwh <= 0) return '#374151'
  if (mwh < 10000)  return '#1e3a5f'
  if (mwh < 20000)  return '#1d4ed8'
  if (mwh < 35000)  return '#2563eb'
  if (mwh < 55000)  return '#3b82f6'
  if (mwh < 80000)  return '#60a5fa'
  if (mwh < 110000) return '#93c5fd'
  return '#bfdbfe'  // pale blue (largest regions, MISO/MIDA)
}

function resolveColor(region: UsPowerRegionLatest | undefined, mode: UsPowerColorMode): string {
  if (!region) return '#374151'
  if (mode === 'ng-pct') return ngPctColor(region.ng_pct)
  if (mode === 're-pct') return rePctColor(computeRePct(region))
  return totalMwhColor(region.total_mwh)
}

interface Props {
  regions: UsPowerRegionLatest[]
  selected: string | null
  onSelect: (region: string | null) => void
  colorMode: UsPowerColorMode
}

export function USPowerMap({ regions, selected, onSelect, colorMode }: Props) {
  const byRegion: Record<string, UsPowerRegionLatest> = {}
  for (const r of regions) byRegion[r.region] = r

  return (
    <MapContainer
      center={[39, -96]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      {Object.keys(byRegion).length > 0 && (
        <USPowerChoroLayer
          byRegion={byRegion}
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

function tooltipHtml(region: UsPowerRegionLatest, _mode: UsPowerColorMode): string {
  const rePct = computeRePct(region)
  const lines = [
    `<strong>${region.region_name}</strong> (${region.region})`,
    `NG: ${region.ng_pct.toFixed(1)}%  &bull;  RE: ${rePct.toFixed(1)}%`,
    `Total: ${(region.total_mwh / 1000).toFixed(1)}k MWh/h`,
  ]
  return lines.join('<br>')
}

function USPowerChoroLayer({
  byRegion,
  selected,
  onSelect,
  colorMode,
}: {
  byRegion: Record<string, UsPowerRegionLatest>
  selected: string | null
  onSelect: (region: string | null) => void
  colorMode: UsPowerColorMode
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/us_power_regions.geojson')
      .then((r) => r.json())
      .then((geojson: GeoJsonObject) => {
        if (cancelled) return
        const layer = L.geoJSON(geojson, {
          style: (feature) => {
            const region: string = feature?.properties?.region ?? ''
            const row = byRegion[region]
            const color = resolveColor(row, colorMode)
            const isSelected = selectedRef.current === region
            return {
              fillColor: color,
              fillOpacity: isSelected ? 1.0 : 0.82,
              color: isSelected ? '#f8fafc' : '#0f172a',
              weight: isSelected ? 2 : 0.5,
            }
          },
          onEachFeature: (feature, lyr) => {
            const region: string = feature?.properties?.region ?? ''
            const row = byRegion[region]
            if (row) {
              lyr.bindTooltip(tooltipHtml(row, colorMode), { sticky: true })
            } else {
              lyr.bindTooltip(`<strong>${feature?.properties?.region_name ?? region}</strong><br>no data`, { sticky: true })
            }

            lyr.on('click', () => {
              const was = selectedRef.current
              const next = was === region ? null : region
              selectedRef.current = next
              onSelect(next)
              ;(geoRef.current as L.GeoJSON | null)?.eachLayer((l) => {
                const f = (l as L.Path & { feature?: GeoJSON.Feature }).feature
                const r: string = f?.properties?.region ?? ''
                const data = byRegion[r]
                const col = resolveColor(data, colorMode)
                const sel = next === r
                ;(l as L.Path).setStyle({
                  fillColor: col,
                  fillOpacity: sel ? 1.0 : 0.82,
                  color: sel ? '#f8fafc' : '#0f172a',
                  weight: sel ? 2 : 0.5,
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
  }, [map, byRegion, onSelect, colorMode])

  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((l) => {
      const f = (l as L.Path & { feature?: GeoJSON.Feature }).feature
      const region: string = f?.properties?.region ?? ''
      const row = byRegion[region]
      const color = resolveColor(row, colorMode)
      const isSelected = selected === region
      ;(l as L.Path).setStyle({
        fillColor: color,
        fillOpacity: isSelected ? 1.0 : 0.82,
        color: isSelected ? '#f8fafc' : '#0f172a',
        weight: isSelected ? 2 : 0.5,
      })
    })
  }, [selected, byRegion, colorMode])

  return null
}

export { resolveColor }
