import L, { type Layer, type PathOptions, type LeafletMouseEvent } from 'leaflet'
import { MapContainer, TileLayer, Pane, useMap } from 'react-leaflet'
import { useEffect, useRef, type ReactNode, type MutableRefObject } from 'react'
import type { GeoJsonObject, Feature } from 'geojson'
import {
  powerPriceColor,
  dayRangeColor,
  negHoursColor,
  pctRankColor,
  renewablePctColor,
  dominantFuelColor,
  FUEL_PALETTE,
  CHOROPLETH_FILL_OPACITY,
  CHOROPLETH_STROKE,
  CHOROPLETH_STROKE_WIDTH,
  zoneName,
} from '@/lib/scales'
import type { PowerLatestRow, GenMapItem } from '@/lib/api'

const CARTO_NOLABELS = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const CARTO_LABELS   = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
const CARTO_ATTR = '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors'

export type MapMetric = 'price' | 'range' | 'neg_hours' | 'pct_rank' | 'renewable' | 'dominant_fuel'

export function isPriceMetric(m: MapMetric): boolean {
  return m === 'price' || m === 'range' || m === 'neg_hours' || m === 'pct_rank'
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

export function zoneColor(
  metric: MapMetric,
  power: PowerLatestRow | undefined,
  gen: GenMapItem | undefined,
): string {
  switch (metric) {
    case 'price':        return powerPriceColor(power?.base_eur)
    case 'range':        return dayRangeColor(power?.day_range_eur)
    case 'neg_hours':    return negHoursColor(power?.neg_hours)
    case 'pct_rank':     return pctRankColor(power?.pct_rank_2yr)
    case 'renewable':    return renewablePctColor(gen?.renewable_pct)
    case 'dominant_fuel': return dominantFuelColor(computeDominantFuel(gen))
  }
}

function tooltipContent(
  zone: string,
  power: PowerLatestRow | undefined,
  gen: GenMapItem | undefined,
  metric: MapMetric,
): string {
  const name = zoneName(zone)
  const price = power?.base_eur != null ? `${power.base_eur.toFixed(0)} €/MWh` : null
  const re = gen?.renewable_pct != null ? `${gen.renewable_pct.toFixed(0)}% RE` : null

  const top3 = gen
    ? (([
        ['solar', gen.solar_mw], ['wind', gen.wind_mw], ['hydro', gen.hydro_mw],
        ['gas', gen.gas_mw], ['coal', gen.coal_mw], ['nuclear', gen.nuclear_mw],
        ['biomass', gen.biomass_mw], ['geothermal', gen.geothermal_mw],
        ['oil', gen.oil_mw], ['other', gen.other_mw],
      ] as [string, number | null][])
        .filter(([, v]) => v != null && v > 0)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)
        .map(([fuel]) => {
          const color = FUEL_PALETTE[fuel] ?? '#6b7280'
          return `<span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;margin-right:2px;vertical-align:middle"></span>${fuel}`
        })
        .join(' '))
    : ''

  const metricExtra = (() => {
    switch (metric) {
      case 'range':
        return power?.day_range_eur != null ? `Range: ${power.day_range_eur.toFixed(0)} €` : ''
      case 'neg_hours':
        return power?.neg_hours != null ? `Neg hours: ${power.neg_hours}h` : ''
      case 'pct_rank':
        return power?.pct_rank_2yr != null ? `2yr rank: ${power.pct_rank_2yr.toFixed(0)}th pct` : ''
      case 'price': {
        const delta = power?.vs_30d_pct
        return delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs 30d` : ''
      }
      default: return ''
    }
  })()

  const summary = [price, re].filter(Boolean).join(' | ')
  const lines = [
    `<strong>${name}</strong>`,
    summary || null,
    metricExtra || null,
    top3 ? `<span style="font-size:10px">${top3}</span>` : null,
  ].filter(Boolean).join('<br/>')

  return `<div style="font-size:12px;line-height:1.6">${lines}</div>`
}

interface Props {
  powerByZone: Record<string, PowerLatestRow>
  genByZone: Record<string, GenMapItem>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: MapMetric
  children?: ReactNode
}

export function EuroMap({ powerByZone, genByZone, selected, onSelect, metric, children }: Props) {
  return (
    <MapContainer
      center={[54, 15]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer url={CARTO_NOLABELS} attribution={CARTO_ATTR} />
      <EuroChoroLayer
        powerByZone={powerByZone}
        genByZone={genByZone}
        selected={selected}
        onSelect={onSelect}
        metric={metric}
      />
      {children}
      <Pane name="euro-labels" style={{ zIndex: 650 }}>
        <TileLayer url={CARTO_LABELS} />
      </Pane>
    </MapContainer>
  )
}

function EuroChoroLayer({
  powerByZone,
  genByZone,
  selected,
  onSelect,
  metric,
}: {
  powerByZone: Record<string, PowerLatestRow>
  genByZone: Record<string, GenMapItem>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: MapMetric
}) {
  const map = useMap()
  const geoRef = useRef<L.GeoJSON | null>(null)
  const selectedRef = useRef<string | null>(selected)
  const metricRef = useRef<MapMetric>(metric)
  const powerRef = useRef<Record<string, PowerLatestRow>>(powerByZone)
  const genRef = useRef<Record<string, GenMapItem>>(genByZone)

  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { metricRef.current = metric }, [metric])
  useEffect(() => { powerRef.current = powerByZone }, [powerByZone])
  useEffect(() => { genRef.current = genByZone }, [genByZone])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/bidding_zones.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) map.removeLayer(geoRef.current)
        const layer = createLayer(geo, powerRef, genRef, selectedRef, metricRef, onSelect)
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
      const isSelected = zone === selected
      ;(layer as L.Path).setStyle({
        fillColor: zoneColor(metric, powerByZone[zone], genByZone[zone]),
        fillOpacity: isSelected ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      })
    })
  }, [powerByZone, genByZone, selected, metric])

  return null
}

function createLayer(
  geo: GeoJsonObject,
  powerRef: MutableRefObject<Record<string, PowerLatestRow>>,
  genRef: MutableRefObject<Record<string, GenMapItem>>,
  selectedRef: MutableRefObject<string | null>,
  metricRef: MutableRefObject<MapMetric>,
  onSelect: (zone: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const zone = feature?.properties?.['zone'] ?? ''
      const sel = selectedRef.current
      return {
        fillColor: zoneColor(metricRef.current, powerRef.current[zone], genRef.current[zone]),
        fillOpacity: zone === sel ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: zone === sel ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: zone === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    onEachFeature: (feature: Feature, layer: Layer) => {
      const zone = feature?.properties?.['zone'] ?? ''

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
            .setContent(
              tooltipContent(zone, powerRef.current[zone], genRef.current[zone], metricRef.current),
            )
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
