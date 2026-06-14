import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import { utilizationColor } from '@/lib/scales'
import type { CongestionRow } from '@/lib/api'

// Same centroids as FlowArrowsLayer - borders between these zones can be drawn on the map
const CENTROIDS: Record<string, [number, number]> = {
  'AT':      [47.5, 14.5],
  'BE':      [50.5,  4.5],
  'CH':      [46.8,  8.3],
  'DE-LU':   [51.0, 10.0],
  'FR':      [46.5,  2.5],
  'IT-NORD': [45.5, 10.5],
  'NL':      [52.3,  5.3],
}

interface Props {
  rows: CongestionRow[]
}

export function CongestionLayer({ rows }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()

    for (const row of rows) {
      const from = CENTROIDS[row.from_zone]
      const to = CENTROIDS[row.to_zone]
      if (!from || !to) continue

      const util = row.utilization_pct ?? 0
      const color = utilizationColor(row.utilization_pct)
      // Line weight: 1.5 (free) to 5 (saturated)
      const weight = 1.5 + Math.min(util / 30, 3.5)

      const line = L.polyline([from, to], {
        color,
        weight,
        opacity: 0.85,
        pane: 'overlayPane',
      })

      const ntcLabel = row.ntc_mw != null ? `${row.ntc_mw.toFixed(0)} MW` : '--'
      const schedLabel = row.scheduled_mw != null ? `${row.scheduled_mw.toFixed(0)} MW` : '--'
      const utilLabel = row.utilization_pct != null ? `${row.utilization_pct.toFixed(0)}%` : '--'
      const congested = (row.utilization_pct ?? 0) > 80

      line.bindTooltip(
        `<div style="font-size:12px;line-height:1.6">
          <strong>${row.from_zone} → ${row.to_zone}</strong><br/>
          Utilization: <strong style="color:${color}">${utilLabel}</strong>${congested ? ' &#x26A0;' : ''}<br/>
          NTC: ${ntcLabel} &nbsp; Scheduled: ${schedLabel}<br/>
          <span style="color:#64748b;font-size:10px">${row.price_date}</span>
        </div>`,
        { sticky: true, opacity: 0.97 }
      )

      line.addTo(group)

      // Midpoint utilization label
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
      const label = L.divIcon({
        html: `<div style="
          background:rgba(15,23,42,0.85);
          color:${color};
          font-size:9px;
          font-weight:600;
          padding:1px 3px;
          border-radius:2px;
          white-space:nowrap;
          pointer-events:none;
          border:1px solid ${color}22;
        ">${utilLabel}</div>`,
        iconSize: [0, 0],
        iconAnchor: [-2, 6],
        className: '',
      })
      L.marker(mid, { icon: label, interactive: false }).addTo(group)
    }

    group.addTo(map)
    layerRef.current = group

    return () => {
      if (layerRef.current) {
        layerRef.current.clearLayers()
        map.removeLayer(layerRef.current)
      }
    }
  }, [map, rows])

  return null
}
