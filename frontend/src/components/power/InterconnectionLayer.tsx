import L from 'leaflet'
import { useMap } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import { utilizationColor, priceDivergenceColor, zoneName } from '@/lib/scales'
import type { CongestionRow, BorderFlowRow, DivergenceLatestRow } from '@/lib/api'

export const ZONE_CENTROIDS: Record<string, [number, number]> = {
  'AT':      [47.5, 14.5],
  'BE':      [50.5,  4.5],
  'CH':      [46.8,  8.3],
  'DE-LU':   [51.0, 10.0],
  'FR':      [46.5,  2.5],
  'IT-NORD': [45.5, 10.5],
  'NL':      [52.3,  5.3],
}

export interface BorderKey {
  from: string
  to: string
}

function borderKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

function bearing(from: [number, number], to: [number, number]): number {
  const dLon = ((to[1] - from[1]) * Math.PI) / 180
  const lat1 = (from[0] * Math.PI) / 180
  const lat2 = (to[0] * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export type InterconnMode = 'congestion' | 'spread'

interface Props {
  congestion: CongestionRow[]
  flows: BorderFlowRow[]
  divergence: DivergenceLatestRow[]
  colorMode: InterconnMode
  selected: BorderKey | null
  onSelect: (b: BorderKey | null) => void
}

export function InterconnectionLayer({ congestion, flows, divergence, colorMode, selected, onSelect }: Props) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)
  const selectedRef = useRef<BorderKey | null>(selected)

  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
      map.removeLayer(layerRef.current)
    }

    const group = L.layerGroup()

    // Build lookup: undirected key -> congestion rows (both directions)
    const congByKey = new Map<string, CongestionRow[]>()
    for (const row of congestion) {
      const key = borderKey(row.from_zone, row.to_zone)
      if (!congByKey.has(key)) congByKey.set(key, [])
      congByKey.get(key)!.push(row)
    }

    // Build lookup: undirected key -> flow row
    const flowByKey = new Map<string, BorderFlowRow>()
    for (const row of flows) {
      flowByKey.set(borderKey(row.from_zone, row.to_zone), row)
    }

    // Build lookup: undirected key -> divergence row
    const divByKey = new Map<string, DivergenceLatestRow>()
    for (const row of divergence) {
      divByKey.set(borderKey(row.from_zone, row.to_zone), row)
    }

    // Collect all unique undirected border pairs across all datasets
    const allKeys = new Set([...congByKey.keys(), ...flowByKey.keys(), ...divByKey.keys()])

    const maxAbsFlow = Math.max(
      ...Array.from(flowByKey.values()).map((f) => Math.abs(f.net_flow_mw ?? 0)),
      1,
    )

    for (const key of allKeys) {
      const congRows = congByKey.get(key) ?? []
      const flowRow  = flowByKey.get(key)
      const divRow   = divByKey.get(key)

      // Pick the two zones from whichever dataset has them
      const sample = congRows[0] ?? flowRow ?? divRow
      if (!sample) continue
      const zA = sample.from_zone
      const zB = sample.to_zone

      const fromCoord = ZONE_CENTROIDS[zA]
      const toCoord   = ZONE_CENTROIDS[zB]
      if (!fromCoord || !toCoord) continue

      // Best utilization: max of both directed rows
      const bestUtil = congRows.reduce<number | null>((acc, r) => {
        if (r.utilization_pct == null) return acc
        return acc == null ? r.utilization_pct : Math.max(acc, r.utilization_pct)
      }, null)

      const netFlow  = flowRow?.net_flow_mw ?? null
      const diffEur  = divRow?.diff_eur_mwh ?? null

      const color = colorMode === 'spread'
        ? priceDivergenceColor(diffEur)
        : utilizationColor(bestUtil)
      const isSel = selected !== null && borderKey(selected.from, selected.to) === key
      const weight = isSel ? 5 : colorMode === 'spread'
        ? 2 + (diffEur != null ? Math.min(Math.abs(diffEur) / 15, 2.5) : 0)
        : 2 + (bestUtil != null ? Math.min(bestUtil / 35, 2.5) : 0)

      // Main line
      const line = L.polyline([fromCoord, toCoord], {
        color,
        weight,
        opacity: isSel ? 1 : 0.85,
        pane: 'overlayPane',
        interactive: true,
      })

      line.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        const cur = selectedRef.current
        onSelect(cur && borderKey(cur.from, cur.to) === key ? null : { from: zA, to: zB })
      })

      // Build tooltip
      const flowStr = netFlow != null
        ? `${Math.abs(netFlow).toFixed(0)} MW ${netFlow >= 0 ? `${zA}→${zB}` : `${zB}→${zA}`}`
        : '--'

      let tooltipBody: string
      if (colorMode === 'spread') {
        const fromP = divRow?.from_price != null ? `${divRow.from_price.toFixed(0)} €` : '--'
        const toP   = divRow?.to_price   != null ? `${divRow.to_price.toFixed(0)} €` : '--'
        const diffStr = diffEur != null
          ? `<strong style="color:${color}">${diffEur >= 0 ? '+' : ''}${diffEur.toFixed(0)} €/MWh</strong>`
          : '--'
        tooltipBody = `
          ${zoneName(zA)}: ${fromP}/MWh<br/>
          ${zoneName(zB)}: ${toP}/MWh<br/>
          Spread: ${diffStr}<br/>
          Net flow: ${flowStr}`
      } else {
        const utilStr  = bestUtil != null ? `${bestUtil.toFixed(0)}%` : '--'
        const maxNtc   = congRows.reduce<number | null>((acc, r) => {
          if (r.ntc_mw == null) return acc
          return acc == null ? r.ntc_mw : Math.max(acc, r.ntc_mw)
        }, null)
        const congested = (bestUtil ?? 0) > 80
        tooltipBody = `
          Utilization: <strong style="color:${color}">${utilStr}</strong>${congested ? ' &#x26A0;' : ''}<br/>
          Net flow: ${flowStr}<br/>
          ${maxNtc != null ? `Max NTC: ${maxNtc.toFixed(0)} MW` : ''}`
      }

      line.bindTooltip(
        `<div style="font-size:12px;line-height:1.6">
          <strong>${zoneName(zA)} &harr; ${zoneName(zB)}</strong><br/>
          ${tooltipBody}
        </div>`,
        { sticky: true, opacity: 0.97 },
      )

      line.addTo(group)

      // Flow arrow at 60% point
      if (netFlow != null && Math.abs(netFlow) > 50) {
        const [actualFrom, actualTo] = netFlow >= 0 ? [fromCoord, toCoord] : [toCoord, fromCoord]
        const tip: [number, number] = [
          actualFrom[0] + (actualTo[0] - actualFrom[0]) * 0.60,
          actualFrom[1] + (actualTo[1] - actualFrom[1]) * 0.60,
        ]
        const deg = bearing(actualFrom, actualTo)
        const arrowSize = Math.max(2, (Math.abs(netFlow) / maxAbsFlow) * 5)

        const icon = L.divIcon({
          html: `<div style="
            width:0;height:0;
            border-left:${arrowSize}px solid transparent;
            border-right:${arrowSize}px solid transparent;
            border-bottom:${arrowSize * 2}px solid ${color};
            transform:rotate(${deg}deg);
            transform-origin:50% 100%;
            opacity:0.9;
          "></div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          className: '',
        })

        L.marker(tip, { icon, interactive: false }).addTo(group)
      }

      // Midpoint label: utilization % in congestion mode, spread EUR in spread mode
      const midLabel = colorMode === 'spread'
        ? (diffEur != null ? `${diffEur >= 0 ? '+' : ''}${diffEur.toFixed(0)}€` : null)
        : (bestUtil != null ? `${bestUtil.toFixed(0)}%` : null)

      if (midLabel != null) {
        const mid: [number, number] = [(fromCoord[0] + toCoord[0]) / 2, (fromCoord[1] + toCoord[1]) / 2]
        const label = L.divIcon({
          html: `<div style="
            background:rgba(15,23,42,0.88);
            color:${color};
            font-size:9px;
            font-weight:600;
            padding:1px 4px;
            border-radius:2px;
            white-space:nowrap;
            pointer-events:none;
            border:1px solid ${color}44;
            box-shadow:0 1px 3px rgba(0,0,0,0.5);
          ">${midLabel}</div>`,
          iconSize: [0, 0],
          iconAnchor: [-2, 6],
          className: '',
        })
        L.marker(mid, { icon: label, interactive: false }).addTo(group)
      }
    }

    group.addTo(map)
    layerRef.current = group

    return () => {
      if (layerRef.current) {
        layerRef.current.clearLayers()
        map.removeLayer(layerRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, congestion, flows, selected])

  return null
}
