import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { Flame, Zap, TrendingUp, DollarSign, Activity, Wind, Info, X } from 'lucide-react'
import { useState } from 'react'

export const Route = createRootRoute({
  component: Root,
})

const NAV = [
  { to: '/gas',        label: 'Gas',        icon: Flame,      enabled: true },
  { to: '/power',      label: 'Power',      icon: Zap,        enabled: true },
  { to: '/generation', label: 'RE Trends',  icon: Wind,       enabled: true },
  { to: '/spreads',    label: 'Spreads',    icon: TrendingUp, enabled: true },
  { to: '/prices',     label: 'Prices',     icon: DollarSign, enabled: true },
  { to: '/imbalance',  label: 'Imbalance',  icon: Activity,   enabled: true },
]

function Root() {
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-6 px-4 py-2 border-b border-border bg-card shrink-0 z-50">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors">
          <Flame className="w-5 h-5 text-primary" />
          <span className="text-sm">Energy Hub</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, enabled }) =>
            enabled ? (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors [&.active]:text-primary [&.active]:bg-secondary"
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ) : (
              <span
                key={to}
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded text-sm text-muted-foreground/40 cursor-not-allowed select-none"
                title="Coming soon"
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </span>
            )
          )}
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
          <span className="hidden sm:block text-border">|</span>
          <a href="https://freight.lbzgiu.xyz" className="hidden sm:block hover:text-foreground transition-colors">
            freight.lbzgiu.xyz
          </a>
          <a href="https://quant.lbzgiu.xyz" className="hidden sm:block hover:text-foreground transition-colors">
            quant.lbzgiu.xyz
          </a>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
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
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Flame className="w-4 h-4 text-primary" />
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
              <span className="text-foreground">Gas storage</span> - AGSI+ (GIE), daily,{' '}
              <a href="https://agsi.gie.eu" className="text-primary hover:underline" target="_blank" rel="noreferrer">agsi.gie.eu</a>
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
