import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AlertTriangle } from 'lucide-react'

const STALE_HOURS = 48

function hoursOld(isoStr: string | null | undefined): number | null {
  if (!isoStr) return null
  const ms = Date.now() - new Date(isoStr).getTime()
  return ms / 3600000
}

export function StaleBanner({ datasetKey }: { datasetKey: 'gas' | 'power' | 'spreads' }) {
  const { data } = useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    staleTime: 15 * 60 * 1000,
  })

  const refreshedAt =
    datasetKey === 'gas'
      ? data?.gas_refreshed_at
      : datasetKey === 'power'
        ? data?.power_refreshed_at
        : data?.spreads_refreshed_at

  const hours = hoursOld(refreshedAt)
  if (hours == null || hours < STALE_HOURS) return null

  return (
    <div className="absolute bottom-0 left-0 right-0 z-[1100] flex items-center gap-2 px-4 py-2 bg-amber-950 border-t border-amber-800 text-amber-300 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      Data last refreshed {Math.round(hours)}h ago. The refresh service may be delayed.
    </div>
  )
}
