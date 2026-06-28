import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Flame,
  Zap,
  TrendingUp,
  DollarSign,
  Activity,
  Wind,
  Globe,
  BarChart2,
  Factory,
  ArrowRight,
  TrendingDown,
  Minus,
} from 'lucide-react'
import { api, type MarketPulseResponse, type MarketPulseSpread, type NuclearHeatRiskResponse } from '@/lib/api'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

type DashRoute =
  | '/gas' | '/power' | '/spreads' | '/prices' | '/imbalance'
  | '/us-power' | '/us-gas' | '/generation' | '/us-plants'

interface Dashboard {
  to: DashRoute
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  featured: boolean
  wide: boolean
}

const DASHBOARDS: Dashboard[] = [
  {
    to: '/gas',
    label: 'EU Gas Storage',
    icon: Flame,
    description: 'Storage levels across 23 EU countries vs. 5-year seasonal ranges.',
    featured: true,
    wide: false,
  },
  {
    to: '/power',
    label: 'EU Power',
    icon: Zap,
    description: 'Day-ahead prices, generation mix, and capacity factors for 30+ bidding zones.',
    featured: true,
    wide: false,
  },
  {
    to: '/spreads',
    label: 'Spreads',
    icon: TrendingUp,
    description: 'Clean spark, dark, and fuel-switch spreads with fundamental OLS signal model.',
    featured: true,
    wide: false,
  },
  {
    to: '/prices',
    label: 'Prices',
    icon: DollarSign,
    description: 'TTF, EUA, API2 coal, and Henry Hub with regime detection.',
    featured: false,
    wide: false,
  },
  {
    to: '/imbalance',
    label: 'Imbalance',
    icon: Activity,
    description: 'German reBAP imbalance prices via SMARD.',
    featured: false,
    wide: false,
  },
  {
    to: '/us-power',
    label: 'US Power',
    icon: BarChart2,
    description: 'EIA Form 930 regional generation and renewable mix.',
    featured: false,
    wide: false,
  },
  {
    to: '/us-gas',
    label: 'US Gas',
    icon: Globe,
    description: 'EIA weekly gas storage across 5 regions vs. seasonal norms.',
    featured: false,
    wide: false,
  },
  {
    to: '/generation',
    label: 'RE Trends',
    icon: Wind,
    description: 'European renewable generation trends by country and fuel type, from ENTSO-E.',
    featured: false,
    wide: true,
  },
  {
    to: '/us-plants',
    label: 'US Plants',
    icon: Factory,
    description: 'US power plant capacity and technology breakdown by region.',
    featured: false,
    wide: true,
  },
]

const SOURCES = ['ENTSO-E', 'AGSI+', 'ENTSOG', 'EIA', 'SMARD', 'ICE / DB.nomics', 'IMF', 'yfinance']

function fmt1(v: number | null | undefined): string {
  if (v == null) return '-'
  return v.toFixed(1)
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return '-'
  return Math.round(v).toString()
}

function DeltaChip({ v, unit = '', invert = false }: { v: number | null | undefined; unit?: string; invert?: boolean }) {
  if (v == null) return null
  const positive = invert ? v < 0 : v > 0
  const negative = invert ? v > 0 : v < 0
  const color = positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-muted-foreground'
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus
  const sign = v > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono ${color}`}>
      <Icon className="w-2.5 h-2.5" />
      {sign}{fmt1(v)}{unit}
    </span>
  )
}

function PulseCard({
  label,
  value,
  unit,
  delta,
  deltaUnit,
  deltaInvert,
  to,
  dim,
}: {
  label: string
  value: string
  unit: string
  delta?: number | null
  deltaUnit?: string
  deltaInvert?: boolean
  to?: DashRoute
  dim?: boolean
}) {
  const inner = (
    <div className={[
      'flex h-full flex-col gap-1 px-3 py-2.5 rounded-md border min-w-[100px]',
      dim
        ? 'bg-card/40 border-border/40'
        : 'bg-card border-border hover:border-border/80 transition-colors',
      to ? 'cursor-pointer' : '',
    ].filter(Boolean).join(' ')}>
      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/80 leading-none">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-foreground leading-tight">
          {value}
        </span>
        <span className="text-[10px] text-muted-foreground/60">{unit}</span>
      </div>
      {delta != null && (
        <DeltaChip v={delta} unit={deltaUnit} invert={deltaInvert} />
      )}
    </div>
  )
  if (to) {
    return <Link to={to} className="flex">{inner}</Link>
  }
  return inner
}

function SpreadMiniCard({ sp, zscore, pctRank }: { sp: MarketPulseSpread; zscore?: number | null; pctRank?: number | null }) {
  const regimeColor =
    sp.regime === 'gas' ? 'text-blue-400' :
    sp.regime === 'coal' ? 'text-amber-400' :
    'text-muted-foreground'
  const zColor =
    zscore != null && Math.abs(zscore) >= 1.5 ? (zscore > 0 ? '#f87171' : '#4ade80') :
    zscore != null && Math.abs(zscore) >= 0.75 ? (zscore > 0 ? '#fb923c' : '#86efac') :
    '#64748b'
  return (
    <div className="flex h-full flex-col gap-1 px-3 py-2.5 rounded-md border bg-card border-border min-w-[92px]">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/80 leading-none">
          {sp.zone}
        </span>
        {sp.regime && (
          <span className={`text-[9px] font-mono uppercase ${regimeColor}`}>{sp.regime}</span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] text-muted-foreground/55">CSS</span>
        <span className="text-sm font-semibold tabular-nums text-foreground leading-tight">
          {sp.css != null ? fmt1(sp.css) : '-'}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] text-muted-foreground/55">CDS</span>
        <span className="text-[12px] font-medium tabular-nums text-muted-foreground leading-tight">
          {sp.cds != null ? fmt1(sp.cds) : '-'}
        </span>
      </div>
      {zscore != null && (
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] text-muted-foreground/55">z</span>
          <span className="text-[11px] font-semibold tabular-nums leading-tight" style={{ color: zColor }}>
            {zscore > 0 ? '+' : ''}{zscore.toFixed(2)}
          </span>
          {pctRank != null && (
            <span className="text-[9px] text-muted-foreground/50 leading-tight">{pctRank}p</span>
          )}
        </div>
      )}
    </div>
  )
}

function MarketPulse() {
  const { data, isLoading } = useQuery<MarketPulseResponse>({
    queryKey: ['market-pulse'],
    queryFn: api.marketPulse,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: heatRisk } = useQuery<NuclearHeatRiskResponse>({
    queryKey: ['gen-heat-risk'],
    queryFn: api.genHeatRisk,
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  })

  if (isLoading || !data) {
    return (
      <div className="h-14 flex items-center">
        <div className="h-3 w-48 rounded bg-border/40 animate-pulse" />
      </div>
    )
  }

  return (
    <section className="pb-8">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/35">
          Market pulse
        </span>
        <span className="text-[10px] text-muted-foreground/30">{data.as_of}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Commodities */}
        <PulseCard
          to="/prices"
          label="TTF"
          value={fmt1(data.ttf_eur_mwh)}
          unit="EUR/MWh"
          delta={data.ttf_d1}
          deltaUnit=" d/d"
        />
        <PulseCard
          to="/prices"
          label="EUA"
          value={fmtInt(data.eua_eur_t)}
          unit="EUR/t"
          delta={data.eua_d1}
          deltaUnit=" d/d"
        />

        {/* Separator */}
        <div className="w-px bg-border/30 self-stretch mx-0.5" />

        {/* Gas storage */}
        <PulseCard
          to="/gas"
          label="EU Storage"
          value={fmt1(data.eu_storage_pct)}
          unit="% full"
          delta={data.eu_storage_vs_avg5}
          deltaUnit="% vs avg"
          deltaInvert={false}
        />

        {/* Separator */}
        <div className="w-px bg-border/30 self-stretch mx-0.5" />

        {/* DE-LU power */}
        <PulseCard
          to="/power"
          label="DE-LU DA"
          value={fmtInt(data.de_lu_price)}
          unit="EUR/MWh"
          delta={data.de_lu_vs_30d_pct}
          deltaUnit="% vs 30d"
        />

        {/* Spreads */}
        {data.spreads.map((sp) => {
          const sig = data.signal.find((s) => s.zone === sp.zone)
          return (
            <Link key={sp.zone} to="/spreads" className="flex">
              <SpreadMiniCard sp={sp} zscore={sig?.zscore} pctRank={sig?.pct_rank_1yr} />
            </Link>
          )
        })}

        {/* Separator */}
        <div className="w-px bg-border/30 self-stretch mx-0.5" />

        {/* reBAP */}
        {data.rebap_today_mean != null && (
          <PulseCard
            to="/imbalance"
            label="reBAP"
            value={fmtInt(data.rebap_today_mean)}
            unit="EUR/MWh"
          />
        )}

        {/* Nuclear heat risk - only shown when warning or critical */}
        {heatRisk && (heatRisk.capacity_critical_mw > 0 || heatRisk.capacity_warning_mw > 0) && (() => {
          const totalGw = ((heatRisk.capacity_critical_mw + heatRisk.capacity_warning_mw) / 1000).toFixed(1)
          const isCritical = heatRisk.capacity_critical_mw > 0
          return (
            <>
              <div className="w-px bg-border/30 self-stretch mx-0.5" />
              <Link to="/generation" className="flex">
                <div className={`flex h-full flex-col justify-center gap-1 rounded-md px-3 py-2.5 border cursor-pointer transition-opacity hover:opacity-80 ${isCritical ? 'bg-red-950/70 border-red-600/50' : 'bg-amber-950/70 border-amber-600/50'}`}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground/80 leading-none">FR Nuclear</div>
                  <div className={`text-xs font-semibold leading-tight ${isCritical ? 'text-red-300' : 'text-amber-300'}`}>
                    {totalGw} GW at risk
                  </div>
                  <div className={`text-[10px] leading-tight ${isCritical ? 'text-red-400' : 'text-amber-400'}`}>
                    {isCritical ? 'CRITICAL' : 'WARNING'}
                  </div>
                </div>
              </Link>
            </>
          )
        })()}
      </div>
    </section>
  )
}

function LandingPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 lg:px-14">

        {/* Hero */}
        <section className="pt-12 pb-8">
          <h1 className="text-4xl md:text-5xl lg:text-[3.25rem] font-semibold tracking-tight leading-[1.06] text-foreground mb-4">
            European Energy<br className="hidden sm:block" /> Markets
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed mb-7 max-w-[50ch]">
            Live gas storage, power prices, generation mix, and spread analytics across 30+ European bidding zones.
          </p>
          <Link
            to="/gas"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded font-medium text-sm hover:bg-primary/85 transition-colors"
          >
            Open dashboard
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>

        {/* Live market numbers */}
        <MarketPulse />

        {/* Dashboard grid */}
        <section className="pb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Row 1: EU Gas (2 col), EU Power, Spreads */}
            <DashCard d={DASHBOARDS[0]} extraClass="lg:col-span-2" />
            <DashCard d={DASHBOARDS[1]} />
            <DashCard d={DASHBOARDS[2]} />
            {/* Row 2: Prices, Imbalance, US Power, US Gas */}
            <DashCard d={DASHBOARDS[3]} />
            <DashCard d={DASHBOARDS[4]} />
            <DashCard d={DASHBOARDS[5]} />
            <DashCard d={DASHBOARDS[6]} />
            {/* Row 3: RE Trends (2 col), US Plants (2 col) */}
            <DashCard d={DASHBOARDS[7]} extraClass="lg:col-span-2" />
            <DashCard d={DASHBOARDS[8]} extraClass="lg:col-span-2" />
          </div>
        </section>

        {/* Sources strip */}
        <section className="pb-8">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground/35 mr-1">
              Sources
            </span>
            {SOURCES.map((s) => (
              <span key={s} className="text-[11px] text-muted-foreground/45">{s}</span>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}

function DashCard({ d, extraClass = '' }: { d: Dashboard; extraClass?: string }) {
  const { to, label, icon: Icon, description, featured } = d
  return (
    <Link
      to={to}
      className={[
        'group flex flex-col justify-between gap-4 p-4 rounded-lg border transition-colors min-h-[108px]',
        featured
          ? 'bg-primary/[0.055] border-primary/[0.16] hover:bg-primary/[0.09] hover:border-primary/[0.28]'
          : 'bg-card border-border hover:bg-secondary/50 hover:border-border',
        extraClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={[
            'p-1.5 rounded shrink-0',
            featured
              ? 'bg-primary/15 text-primary'
              : 'bg-secondary text-muted-foreground group-hover:text-foreground transition-colors',
          ].join(' ')}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <ArrowRight className="w-3 h-3 text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors mt-0.5 shrink-0" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">{label}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </Link>
  )
}
