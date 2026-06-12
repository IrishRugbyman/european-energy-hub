import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type PowerLatestRow } from '@/lib/api'
import { PowerMap } from '@/components/power/PowerMap'
import { ZonePanel } from '@/components/power/ZonePanel'

export const Route = createFileRoute('/power')({
  component: PowerDashboard,
})

function PowerDashboard() {
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['power-map'],
    queryFn: api.powerMap,
  })

  const latestByZone: Record<string, PowerLatestRow> = {}
  for (const row of data?.rows ?? []) latestByZone[row.zone] = row

  // Representative stats: median base price across all zones
  const prices = (data?.rows ?? []).map((r) => r.base_eur).filter((v): v is number => v != null).sort((a, b) => a - b)
  const medianPrice = prices.length ? prices[Math.floor(prices.length / 2)] : null
  const priceDate = data?.price_date ?? null

  return (
    <div className="relative h-full flex">
      {/* Stat strip */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-4 px-4 py-2 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg text-sm pointer-events-none">
        {medianPrice != null ? (
          <>
            <StatChip label="EU median" value={`${medianPrice.toFixed(0)} €/MWh`} />
            <StatChip label="zones" value={`${prices.length}`} />
            {priceDate && <span className="text-muted-foreground text-xs">{priceDate}</span>}
          </>
        ) : isLoading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : error ? (
          <span className="text-destructive text-xs">API unavailable</span>
        ) : null}
      </div>

      {/* Price legend */}
      <div className="absolute bottom-6 left-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs space-y-1">
        <p className="text-muted-foreground mb-1 font-medium">€/MWh</p>
        {[
          { label: '< 20',  color: '#1d4ed8' },
          { label: '20-50', color: '#0369a1' },
          { label: '50-80', color: '#0e7490' },
          { label: '80-120',color: '#15803d' },
          { label: '120-160',color:'#65a30d' },
          { label: '160-200',color:'#ca8a04' },
          { label: '200-250',color:'#d97706' },
          { label: '> 250', color: '#b91c1c' },
          { label: 'no data',color:'#374151'},
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="flex-1">
        <PowerMap rows={data?.rows ?? []} selected={selected} onSelect={setSelected} />
      </div>

      {/* Side panel */}
      {selected && (
        <div className="absolute right-0 top-0 h-full w-80 bg-card border-l border-border z-[1000] overflow-y-auto">
          <ZonePanel
            zone={selected}
            latest={latestByZone[selected] ?? null}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}
