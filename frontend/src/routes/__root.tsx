import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { Flame, Zap, TrendingUp, DollarSign, Activity, Wind, Info, X, Globe, BarChart2, Factory, Menu } from 'lucide-react'
import { Fragment, useState } from 'react'

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
})

const NAV = [
  // EU cluster
  { to: '/gas',        label: 'EU Gas',     icon: Flame,      group: 'EU' as const },
  { to: '/power',      label: 'EU Power',   icon: Zap,        group: 'EU' as const },
  { to: '/generation', label: 'Generation', icon: Wind,       group: 'EU' as const },
  { to: '/spreads',    label: 'Spreads',    icon: TrendingUp, group: 'EU' as const },
  { to: '/prices',     label: 'Prices',     icon: DollarSign, group: 'EU' as const },
  { to: '/imbalance',  label: 'Imbalance',  icon: Activity,   group: 'EU' as const },
  // US cluster
  { to: '/us-gas',     label: 'US Gas',     icon: Globe,      group: 'US' as const },
  { to: '/us-power',   label: 'US Power',   icon: BarChart2,  group: 'US' as const },
  { to: '/us-plants',  label: 'US Plants',  icon: Factory,    group: 'US' as const },
]

function Root() {
  const [aboutOpen, setAboutOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-6 px-4 py-2.5 border-b border-border bg-card shrink-0 z-50">
        <Link to="/" className="font-semibold text-base text-foreground hover:text-primary transition-colors tracking-tight shrink-0">
          Energy Hub
        </Link>

        {/* Desktop nav - EU and US clusters separated by a divider */}
        <nav className="hidden sm:flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {NAV.map(({ to, label, icon: Icon, group }, i) => (
            <Fragment key={to}>
              {i > 0 && NAV[i - 1].group !== group && (
                <span className="mx-1.5 h-4 w-px bg-border shrink-0" aria-hidden="true" />
              )}
              <Link
                to={to}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors [&.active]:text-primary [&.active]:bg-primary/10 [&.active]:font-medium"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{label}</span>
              </Link>
            </Fragment>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <button
            onClick={() => setAboutOpen(true)}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label="About"
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">About</span>
          </button>
          <span className="hidden sm:block text-muted-foreground/30">|</span>
          <a href="https://freight.lbzgiu.xyz" className="hidden sm:block hover:text-foreground transition-colors">
            freight.lbzgiu.xyz
          </a>
          <a href="https://quant.lbzgiu.xyz" className="hidden sm:block hover:text-foreground transition-colors">
            quant.lbzgiu.xyz
          </a>
          {/* Mobile menu trigger */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="sm:hidden flex items-center justify-center p-1.5 -mr-1 rounded hover:bg-secondary/60 hover:text-foreground transition-colors"
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile nav sheet - full labels, grouped by region */}
      {menuOpen && (
        <nav className="sm:hidden border-b border-border bg-card shrink-0 z-40 px-2 py-2 space-y-2">
          {(['EU', 'US'] as const).map((g) => (
            <div key={g}>
              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {g === 'EU' ? 'Europe' : 'United States'}
              </p>
              <div className="grid grid-cols-2 gap-1">
                {NAV.filter((n) => n.group === g).map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors [&.active]:text-primary [&.active]:bg-primary/10 [&.active]:font-medium"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-4 text-center">
      <p className="text-5xl font-semibold text-muted-foreground/40 tracking-tight">404</p>
      <div className="space-y-1">
        <h1 className="text-base font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          That dashboard does not exist. It may have moved or been renamed.
        </p>
      </div>
      <Link
        to="/"
        className="mt-2 px-4 py-2 rounded bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
      >
        Back to Energy Hub
      </Link>
    </div>
  )
}

function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full text-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">
            European Energy Hub
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Live European gas and power market dashboard. Refreshed twice daily (13:45 and 20:15 UTC).
          Part of the <a href="https://quant.lbzgiu.xyz" className="text-primary hover:underline">quant portfolio</a> suite.
        </p>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-foreground">Data sources</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              <span className="text-foreground">EU gas storage</span> - AGSI+ (GIE), daily,{' '}
              <a href="https://agsi.gie.eu" className="text-primary hover:underline" target="_blank" rel="noreferrer">agsi.gie.eu</a>
            </li>
            <li>
              <span className="text-foreground">US natural gas storage</span> - EIA Weekly Natural Gas Storage Report (Form 912), 5 EIA regions + US-48 aggregate,{' '}
              <a href="https://www.eia.gov/naturalgas/storage" className="text-primary hover:underline" target="_blank" rel="noreferrer">eia.gov</a>
            </li>
            <li>
              <span className="text-foreground">Power day-ahead prices</span> - ENTSO-E Transparency Platform,{' '}
              <a href="https://transparency.entsoe.eu" className="text-primary hover:underline" target="_blank" rel="noreferrer">transparency.entsoe.eu</a>
            </li>
            <li>
              <span className="text-foreground">TTF gas (front-month)</span> - ICE via DB.nomics
            </li>
            <li>
              <span className="text-foreground">EU ETS (EUA)</span> - yfinance CO2.L
            </li>
            <li>
              <span className="text-foreground">Coal (API2)</span> - IMF Primary Commodity Prices via DB.nomics
            </li>
            <li>
              <span className="text-foreground">Henry Hub</span> - CME NYMEX via yfinance
            </li>
            <li>
              <span className="text-foreground">Cross-border flows</span> - ENTSO-E Transparency Platform
            </li>
            <li>
              <span className="text-foreground">Generation mix (A75 actual)</span> - ENTSO-E Transparency Platform (all fuel types incl. nuclear)
            </li>
            <li>
              <span className="text-foreground">Physical gas flows</span> - ENTSOG Transparency Platform,{' '}
              <a href="https://transparency.entsog.eu" className="text-primary hover:underline" target="_blank" rel="noreferrer">transparency.entsog.eu</a>
            </li>
            <li>
              <span className="text-foreground">German reBAP imbalance prices</span> - SMARD.de (Bundesnetzagentur),{' '}
              <a href="https://www.smard.de" className="text-primary hover:underline" target="_blank" rel="noreferrer">smard.de</a>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-medium text-foreground">Map attributions</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>
              Country boundaries: <a href="https://gisco-services.ec.europa.eu/distribution/v2/countries/" className="text-primary hover:underline" target="_blank" rel="noreferrer">Eurostat GISCO</a>
              , &copy; EuroGeographics (1:3M)
            </li>
            <li>
              Bidding zones: <a href="https://github.com/electricitymaps/electricitymaps-contrib" className="text-primary hover:underline" target="_blank" rel="noreferrer">Electricity Maps</a>
              , ODbL license
            </li>
            <li>Map tiles: &copy; <a href="https://carto.com" className="text-primary hover:underline" target="_blank" rel="noreferrer">CARTO</a>, &copy; OpenStreetMap contributors</li>
          </ul>
        </div>

        <div className="pt-2 border-t border-border text-xs text-muted-foreground">
          Source code and methodology: <a href="https://quant.lbzgiu.xyz" className="text-primary hover:underline">quant.lbzgiu.xyz</a>
        </div>
      </div>
    </div>
  )
}
