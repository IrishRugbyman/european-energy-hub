import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import { gasFillColor } from '@/lib/scales'
import type { StorageFacilityItem, StorageLatestRow } from '@/lib/api'

interface Props {
  facilities: StorageFacilityItem[]
  latestByCC: Record<string, StorageLatestRow>
}

function circleRadius(capacity_twh: number | null): number {
  if (!capacity_twh || capacity_twh <= 0) return 5
  // sqrt scaling: Rehden (45 TWh) -> ~20px, small (1 TWh) -> ~6px
  return Math.min(20, Math.max(4, Math.sqrt(capacity_twh) * 2.8))
}

export function StorageFacilitiesLayer({ facilities, latestByCC }: Props) {
  const map = useMap()
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers()
      map.removeLayer(layerGroupRef.current)
    }

    const group = L.layerGroup()

    for (const fac of facilities) {
      const row = latestByCC[fac.country]
      const fill = row?.full_pct ?? null
      const color = gasFillColor(fill)
      const r = circleRadius(fac.capacity_twh)

      const marker = L.circleMarker([fac.lat, fac.lon], {
        radius: r,
        fillColor: color,
        color: '#1f2937',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.82,
        // push above choropleth (pane z-index 400) but below labels (650)
        pane: 'markerPane',
      })

      const capacityStr = fac.capacity_twh != null ? `${fac.capacity_twh.toFixed(1)} TWh` : 'capacity unknown'
      const fillStr = fill != null ? `${fill.toFixed(1)}% fill (country)` : 'fill unknown'
      const operatorLine = fac.operator ? `<br/><span style="color:#9ca3af">${fac.operator}</span>` : ''

      marker.bindTooltip(
        `<div style="font-size:12px;line-height:1.5">
          <strong>${fac.name}</strong>${operatorLine}<br/>
          ${capacityStr} &nbsp;&middot;&nbsp; ${fac.country}<br/>
          <span style="color:#d1d5db">${fillStr}</span>
        </div>`,
        { sticky: true, opacity: 0.95 }
      )

      group.addLayer(marker)
    }

    group.addTo(map)
    layerGroupRef.current = group

    return () => {
      if (layerGroupRef.current) {
        map.removeLayer(layerGroupRef.current)
        layerGroupRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilities, latestByCC])

  return null
}
