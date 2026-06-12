import { Link, Outlet, createRootRoute } from '@tanstack/react-router'
import { Flame, Zap, TrendingUp, DollarSign } from 'lucide-react'

export const Route = createRootRoute({
  component: Root,
})

const NAV = [
  { to: '/gas', label: 'Gas', icon: Flame, enabled: true },
  { to: '/power', label: 'Power', icon: Zap, enabled: true },
  { to: '/spreads', label: 'Spreads', icon: TrendingUp, enabled: true },
  { to: '/prices', label: 'Prices', icon: DollarSign, enabled: true },
]

function Root() {
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors [&.active]:text-primary [&.active]:bg-secondary"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            ) : (
              <span
                key={to}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-muted-foreground/40 cursor-not-allowed select-none"
                title="Coming soon"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </span>
            )
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <a href="https://freight.lbzgiu.xyz" className="hover:text-foreground transition-colors">
            freight.lbzgiu.xyz
          </a>
          <a href="https://quant.lbzgiu.xyz" className="hover:text-foreground transition-colors">
            quant.lbzgiu.xyz
          </a>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
