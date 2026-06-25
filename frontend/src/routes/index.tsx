import { createFileRoute, Link } from '@tanstack/react-router'
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
} from 'lucide-react'

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

function LandingPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 lg:px-14">

        {/* Hero */}
        <section className="pt-12 pb-10">
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
