import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import type { BorderFlowRow } from '@/lib/api'

// Approximate zone centroids [lat, lng]
const CENTROIDS: Record<string, [number, number]> = {
  'AT':      [47.5, 14.5],
  'BE':      [50.5,  4.5],
  'CH':      [46.8,  8.3],
  'DE-LU':   [51.0, 10.0],
  'FR':      [46.5,  2.5],
  'IT-NORD': [45.5, 10.5],
  'NL':      [52.3,  5.3],
}

const MAX_WIDTH = 8
const MIN_FLOW_THRESHOLD = 100 // MW - hide tiny flows

function bearing(from: [number, number], to: [number, number]): number {
  const dLon = ((to[1] - from[1]) * Math.PI) / 180
  const lat1 = (from[0] * Math.PI) / 180
  const lat2 = (to[0] * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

interface Props {
  flows: BorderFlowRow[]
}

export function FlowArrowsLayer({ flows }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()

    const maxAbs = Math.max(...flows.map((f) => Math.abs(f.net_flow_mw ?? 0)), 1)

    for (const flow of flows) {
      const net = flow.net_flow_mw ?? 0
      if (Math.abs(net) < MIN_FLOW_THRESHOLD) continue

      const fromCentroid = CENTROIDS[flow.from_zone]
      const toCentroid = CENTROIDS[flow.to_zone]
      if (!fromCentroid || !toCentroid) continue

      // Actual from/to based on net sign
      const [actualFrom, actualTo] = net > 0 ? [fromCentroid, toCentroid] : [toCentroid, fromCentroid]

      const width = Math.max(1.5, (Math.abs(net) / maxAbs) * MAX_WIDTH)
      const color = '#38bdf8' // always sky blue - direction shown by arrow

      // Line
      L.polyline([actualFrom, actualTo], {
        color,
        weight: width,
        opacity: 0.6,
        pane: 'overlayPane',
      }).addTo(group)

      // Arrowhead at 65% point toward "to"
      const tip: [number, number] = [
        actualFrom[0] + (actualTo[0] - actualFrom[0]) * 0.65,
        actualFrom[1] + (actualTo[1] - actualFrom[1]) * 0.65,
      ]
      const deg = bearing(actualFrom, actualTo)

      const icon = L.divIcon({
        html: `<div style="
          width:0;height:0;
          border-left:${width * 1.5}px solid transparent;
          border-right:${width * 1.5}px solid transparent;
          border-bottom:${width * 3}px solid ${color};
          transform:rotate(${deg}deg);
          transform-origin:50% 100%;
          opacity:0.8;
        "></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        className: '',
      })

      L.marker(tip, { icon, interactive: false }).addTo(group)

      // Tooltip with MW value at midpoint
      const mid = midpoint(actualFrom, actualTo)
      const mwLabel = L.divIcon({
        html: `<div style="
          background:rgba(15,23,42,0.85);
          color:#94a3b8;
          font-size:9px;
          padding:1px 3px;
          border-radius:2px;
          white-space:nowrap;
          pointer-events:none;
        ">${Math.round(Math.abs(net))} MW</div>`,
        iconSize: [0, 0],
        iconAnchor: [-2, 6],
        className: '',
      })
      L.marker(mid, { icon: mwLabel, interactive: false }).addTo(group)
    }

    group.addTo(map)
    layerRef.current = group

    return () => {
      if (layerRef.current) {
        layerRef.current.clearLayers()
        map.removeLayer(layerRef.current)
      }
    }
  }, [map, flows])

  return null
}
