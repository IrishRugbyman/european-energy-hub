# Energy Hub Changelog

## 2026-06-14 - Phase 9: German reBAP imbalance dashboard (/imbalance)

- New /imbalance route: chart-first dashboard for German reBAP balancing prices
  (SMARD/Bundesnetzagentur, 15-min resolution from 2021-12 to present)
- Current-price cards: current reBAP, today's mean/min/max
- 10-day 15-min area chart and 2Y daily mean/min/max area chart (3M/1Y/2Y toggle)
- Methodology note explaining reBAP and linking to the p2-imbalance research project
- "Imbalance" added to 6-tab nav (Activity icon from lucide-react)
- SMARD.de attribution added to About modal
- analytics/imbalance.py: reads imbalance_prices_de from PostgreSQL; emits imbalance_recent
  (10 days), imbalance_daily (2Y daily aggs), imbalance_latest (current snapshot)
- GET /api/imbalance; imbalance_refreshed_at in meta response; StaleBanner supports 'imbalance'
- refresh.py: smard-imbalance-de added to daily fetcher list; 3 new DuckDB tables
- 2 new backend tests; 36 total green
- Note: NRV column is null in SMARD dataset (single reBAP price, no long/short system-state)

## 2026-06-14 - Phase 8: Historical date scrubber for /generation

- Date picker added to /generation (top-right, same dark-glass style as /power): scrubs the
  choropleth across all dates in generation_daily; defaults to latest, "Latest" reset button
  appears when a historical date is selected
- URL-synced via ?date=YYYY-MM-DD query param (TanStack Router validateSearch) so historical
  views are shareable
- EU avg renewable strip and top-zone chip recompute for the selected date; date label turns
  amber with "(historical)" suffix when not on latest
- ZoneGenPanel trend chart highlights the selected date with an amber dashed reference line
- Backend: GET /api/generation/map now accepts optional ?date= param; queries generation_daily
  for that date (404 if no data); GenMapResponse gains min_date/max_date so the picker knows
  the valid range without a separate /dates endpoint
- 3 new pytest cases: latest map, historical date, out-of-range 404 (37 tests total green)

## 2026-06-14 - Phase 7: NTC congestion layer on /power

- New "Congestion" toggle on /power (top-right, alongside "Flows"): colors each border line
  by utilization_pct (NTC-used / NTC-available), red = saturated, grey = uncongested
- Border click opens a utilization history chart (trailing 400 days): NTC, scheduled, and
  utilization % as dual-axis recharts ComposedChart
- analytics/congestion.py: joins ntc_dayahead + scheduled_exchanges per directed border-day,
  clips utilization 0-100, guards ntc=0; emits congestion_latest + congestion_daily
- New endpoints: GET /api/power/congestion?date= and GET /api/power/congestion/border/{from}/{to}
- scales.ts: utilizationColor() warm sequential scale (green-to-red); vitest coverage
- refresh.py: adds entso-e-ntc and entso-e-scheduled to the fetcher list; writes congestion tables
- 5 new backend tests; 34 total green; 2 new vitest tests

## 2026-06-14 - Phase 6: ENTSOG Physical Gas Flows on /gas

- New "Physical flows" toggle button on /gas (top-right): overlays ENTSOG physical gas flow
  data (AT/BE/DE/FR/IT/NL) as a diverging choropleth (blue = net importer, amber = net exporter)
  on top of the existing storage fill % layer
- Legend swaps between "Fill %" and "Net flow GWh/d" depending on which overlay is active
- CountryPanel: net/entry/exit GWh/d stat boxes + 400-day trailing AreaChart for ENTSOG
  countries; countries without ENTSOG coverage (PL, RO, etc.) silently show no flow section
- Backend: analytics/gas_flows.py reads entsog_flows from PostgreSQL, pivots entry/exit per
  country-day, computes net_gwh_d (positive = net importer); gas_flows_latest +
  gas_flows_daily tables in energy_hub.duckdb (6 countries, 2193 daily rows)
- New endpoints: GET /api/gas/flows (latest per country), GET /api/gas/flows/{cc} (400-day history)
- scales.ts: gasFlowColor() diverging scale (blue-700 through amber-700 with grey neutral)
- refresh.py: adds entsog fetcher to ingest list; writes gas_flows_* tables and refreshed_at_gas_flows
- 4 new tests; all 27 backend tests pass

## 2026-06-14 - Fix: migrate refresh pipeline to PostgreSQL (was broken since DB migration)

- The 2026-06-13 commo.duckdb -> PostgreSQL migration broke the energy refresh: refresh.py
  and 4 of 5 analytics modules still opened the deleted commo.duckdb file, so energy-refresh
  had been failing since the migration (live site serving stale data from Jun 13 13:47, and
  /generation returning 503 because generation tables were never populated)
- analytics/{gas,power,flows,generation}.py + spreads.py Henry Hub query: now read from
  market_data (PostgreSQL) via the market-data loaders' get_read_conn() / _query() helpers,
  matching the repo-wide postgresql:///market_data convention the loaders already use
- Dropped the now-unused commo_db path argument from all build_*_tables() signatures
- refresh.py: removed the commo.duckdb existence guard; output still written to energy_hub.duckdb
- Added psycopg2-binary to backend deps (the loaders import it; it was missing from the venv,
  so even spreads' loader path was failing post-migration)
- Verified: refresh.py --skip-ingest rebuilds all tables from PostgreSQL (storage 63129 rows,
  power 25964 daily, spreads 1699, flows 4620, generation 33 latest / 79364 daily / 6993 hourly);
  23 backend tests green; /api/generation/map now returns 33 zones (was 503)
- Completes Phase 5: /generation is now live with real data

## 2026-06-13 - Phase 5: Generation Mix Dashboard

- New `/generation` route: bidding-zone choropleth colored by renewable % (green gradient,
  fixed thresholds: 0-20 brown through 80-100 deep green), EU-weighted avg stat strip,
  color legend, StaleBanner, mobile bottom-sheet panel
- ZoneGenPanel: 24h stacked area chart (9 fuel types stacked bottom-to-top fossil-to-renewable),
  renewable % trend chart with 30d rolling average, 3M/1Y/ALL window toggle
- generation_daily + generation_hourly_recent tables in energy_hub.duckdb (daily avg MW per
  fuel per zone full history; last 10 days hourly); generation_latest derived from daily
- New API endpoints: GET /api/generation/map, GET /api/generation/zone/{zone}
- ZonePanel on /power upgraded: GenerationMixSection now shows 24h stacked area chart
  (falls back to flat bar when hourly data absent)
- 8 new backend tests (23 total green); 7 new vitest tests (21 total green)
- Generation nav item added (Wind icon); 5-tab nav: Gas / Power / Generation / Spreads / Prices
- /generation returns 503 until rebase-generation backfill finishes and refresh.py runs

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
