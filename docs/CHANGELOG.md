# Energy Hub Changelog

## 2026-06-13 - Post-v1 UX improvements

- prices: indexed-to-100 toggle for cross-commodity trend comparison (TTF/EUA/coal/HH on different units)
- spreads: regime background shading on FSS chart (gas marginal = blue, coal marginal = amber)
- gas: fill % color legend added to map (mirrors power map legend)
- gas: dynamic flow bar scale per country (was hardcoded 500 GWh, clipped NL/EU)
- power zone panel: 1Y/2Y toggle for daily history chart
- backend: httpx -> httpx2 to silence starlette deprecation warning
- refresh: add rebase-generation to daily fetcher list (generation mix was not being updated)
- rebase-generation backfill running from 2019-01-01 for all 34 zones
- frontend: vitest config + 14 unit tests for lib/scales.ts color thresholds
- About modal: add Rebase Grid API attribution

## 2026-06-12 - v1.0: mobile pass + final polish

- Side panels converted to bottom sheets on mobile (< 640px), right-side panel on sm+
- Nav collapses to icon-only on small screens; sibling links hidden on mobile
- Price legend hidden on mobile to keep map usable
- EU stat strip hides "vs 5yr avg" chip on mobile
- nginx: immutable cache headers for Vite hashed /assets/ (1y max-age)
- Cross-links from quant-portfolio gas-storage/spark-dark/power-spreads pages
- ROADMAP Phase 4 marked complete; tagged v1.0

## 2026-06-12 - Initial build: Phase 1-4 + Rebase generation mix

### Phase 1: Gas storage dashboard
- EU gas storage choropleth (AGSI+ data, 17 countries + EU aggregate)
- Country drill-down: seasonal fan chart (current year, prior year, 5yr min/max/avg band), injection/withdrawal bars
- Twice-daily refresh via energy-refresh.timer (13:45 + 20:15 UTC)
- FastAPI energy-api on :8004, energy_hub.duckdb precomputed by refresh.py
- TLS via certbot, Cloudflare proxy re-enabled after cert

### Phase 2: Power day-ahead price dashboard
- Bidding-zone choropleth (34 ENTSO-E zones) using electricitymaps-contrib GeoJSON
- Zone drill-down: hourly curve (last 48h) + 2-year daily base/peak history
- GISCO 1:3M GeoJSON for country borders (3-layer Leaflet: no-labels base + GeoJSON fill + labels-only pane at z-650)
- ENTSO-E backfill running for all 34 zones from 2019-01-01 (was in progress at launch)

### Phase 3: Spreads and prices
- /spreads: CSS/CDS/FSS spark/dark/fuel-switch spread chart, DE-LU, regime label, 1Y/2Y/5Y/ALL window
- /prices: TTF/EUA/coal/HH commodity level charts
- analytics/spreads.py using market-data loaders (editable install)

### Phase 4: Cross-border flows + About + UX polish
- Toggleable flow arrow layer on /power (15 border pairs, net MW, arrowhead direction)
- About modal: data sources, map attributions (GISCO, Electricity Maps ODbL, AGSI, ENTSO-E, CARTO)
- Stale data banner (>48h since last refresh, amber warning strip)
- GET /api/flows endpoint

### Rebase Grid API integration
- rebase_generation table in commo.duckdb: hourly fuel mix (biomass/coal/gas/hydro/oil/solar/wind) for 34 zones
- fetchers/rebase.py: 90-day chunked fetcher, 1H resolution
- generation_latest precomputed in energy_hub.duckdb
- /api/power/zone/{zone} includes generation_mix
- ZonePanel: stacked fuel-type bar with renewable % label
