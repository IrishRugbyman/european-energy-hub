# European Energy Hub - Build Roadmap

Delivery blueprint for **energy.lbzgiu.xyz**: a standalone live web app with two
co-equal dashboards, **/gas** (EU gas storage choropleth) and **/power** (day-ahead
price choropleth by bidding zone), bridged by spread analytics (spark/dark/fuel-switching).
Sister site to freight.lbzgiu.xyz, built on the exact same stack and conventions.

This file is the single source of truth for the build. Read it at the start of every
session, find the first unchecked task, and execute. Mark tasks `[x]` and phases with
a completion line as you go.

---

## 1. Vision

- **One sentence**: A live European gas + power market dashboard where each side lands
  on a full-screen map (gas storage fill by country, day-ahead power price by bidding
  zone), with the spark/dark spread analytics connecting them.
- **Who**: lbzgiu (portfolio showcase + personal market monitor); secondary: anyone
  evaluating the portfolio (recruiters, traders).
- **Why**: quant-portfolio is a *static precompute* showcase. Gas and power are one
  physical system with daily-refreshing public data; they deserve a *living* app, the
  same way freight got one. Five existing research projects (gas-storage, spark-dark,
  power-spreads, battery-dispatch, p2-imbalance) gain context next to live maps.
- **Constraints**: same stack as freight (React 19/Vite/TS + Leaflet front, FastAPI +
  DuckDB back, systemd + nginx deploy). No GPU. Free data sources only, keys already
  in hand (AGSI_API_KEY, ENTSO_E_TOKEN). **Hard rule: no synthetic data, ever.**
- **Looks like**: dark theme matching freight (Carto dark map tiles, Tailwind), map as
  the first thing you see on each dashboard, side panel drill-down on click.

## 2. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript, npm | Identical to freight; consistency across all apps |
| Routing | TanStack Router, file-based `src/routes/` | Freight convention |
| Data fetching | TanStack Query (long staleTime; data is daily, not 60s) | Freight convention, tuned for daily data |
| Maps | react-leaflet + Leaflet `L.geoJSON` choropleths, Carto dark tiles | Freight convention; choropleth needs no plugins |
| Charts | recharts | Already used in freight dispersion charts |
| Styling | Tailwind v4 (`@tailwindcss/vite`) | Freight convention |
| Backend | FastAPI `energy-api` on **:8004**, uvicorn, slowapi rate limit | 8002 = quant-portfolio, 8003 = freight |
| Database | DuckDB: reads precomputed `energy_hub.duckdb` only (read-only, lock-retry) | API never touches commo.duckdb at request time |
| Refresh | `energy-refresh` systemd service + timer, twice daily | Mirrors `freight-analytics.timer` pattern |
| Tests | pytest + `fastapi.testclient` + seeded temp DuckDB fixture; vitest for pure TS logic | Repo-wide convention |
| Venv | `uv sync`, pyproject + uv.lock, `[tool.uv.sources]` editable market-data/quant-lib | Repo-wide convention |
| Deploy | nginx vhost (symlinked) + certbot TLS + Cloudflare A record | Freight convention |
| Lint | pre-commit hooks via `bash ~/quant/setup-hooks.sh`, shared ruff.toml | Repo-wide convention |

## 3. Data inventory (verified 2026-06-12, all in commo.duckdb)

| Table | Coverage today | Needed expansion |
|---|---|---|
| `gas_storage` (gas_day, country, full, trend, injection, withdrawal, working_gas_volume) | AT BE DE FR IT NL, 2019-01 to current, daily | **Expand `AGSI_COUNTRIES` to all countries AGSI exposes** (add ES PT PL CZ SK HU RO BG HR DK SE LV UA at minimum), backfill `--from-date 2016-01-01` so a true 5-year band exists from 2021 |
| `power_prices` (ts, bidding_zone, price_eur_mwh) | AT BE CH DE-LU FR IT-NORD NL, hourly, 2015/2018 to current | **Expand `ENTSO_E_ZONES`** (add ES PT PL CZ SK HU RO BG GR SI HR FI EE LV LT DK1 DK2 SE1-SE4 NO1-NO5 IE-SEM), backfill from 2019-01-01 for new zones |
| `ttf_prices` (price_date, front_month) | 2017-10 to current, daily | none |
| `carbon_prices` (EUA front month) | 2021-10 to current | none (binding constraint on spread history, accepted) |
| `coal_prices` (monthly, USD/t, fwd-filled) | 1990 to current | none |
| `natgas_futures` (product='NG' = Henry Hub) | to current | none (used on /prices only) |
| `cross_border_flows` (24 directed pairs among core 7 zones) | hourly, current | optional extra pairs in Phase 4 |
| `power_generation_actual` (solar/wind, 7 zones), `power_load` (DE-LU) | current | not used in v1 |

Fetchers are config-driven: country/zone lists live in `market-data/config.py`
(`AGSI_COUNTRIES`, `ENTSO_E_ZONES`, `ENTSO_E_BORDERS`). Expansion = edit the list,
run `ingest.py <fetcher> --from-date ...`. Zone EIC codes: take them from the
`entsoe-py` Area enum. All fetchers are idempotent (INSERT OR REPLACE).

**Known data gap: NBP (UK gas).** Not ingested, no fetcher. Per the no-synthetic-data
hard rule it is OUT of v1. Log it in `~/quant/ideas.md` as a data gap during Phase 1.

**GeoJSON assets (static, vendored into `frontend/public/geo/`):**
- `countries.geojson`: eurostat GISCO countries, 1:20m, EPSG:4326
  (https://gisco-services.ec.europa.eu/distribution/v2/countries/, file like
  `CNTR_RG_20M_2024_4326.geojson`), filtered to Europe. Attribution "© EuroGeographics"
  in the About section.
- `bidding_zones.geojson`: from electricitymaps-contrib `web/geo/world.geojson`
  (https://github.com/electricitymaps/electricitymaps-contrib), filter to European
  zone keys, simplify with `npx mapshaper -simplify 12% keep-shapes`. Target < 600 KB.
  ODbL attribution in the About section.
- Write a one-off `scripts/build_geojson.py` (or mapshaper one-liners documented in a
  README) so the assets are reproducible. Commit the outputs.

## 4. Architecture and data flow

> **Note (2026-06-14):** the diagram below is the original v1 design. After the repo-wide
> DuckDB -> PostgreSQL migration, the source DB is now `market_data` (PostgreSQL), read via
> the market-data `loaders/` package. Mentally substitute "commo.duckdb (read-only)" with
> "market_data PostgreSQL". `energy_hub.duckdb` (the precomputed serving DB) is unchanged.

```
                       (writer: commo.duckdb)
ingest.py agsi|entso_e|ttf|eua_carbon|coal_api2     [market-data venv, subprocess]
        │
        ▼
scripts/refresh.py  ──reads commo.duckdb (read-only)──►  writes data/energy_hub.duckdb
  [energy backend venv; systemd energy-refresh.timer, twice daily 13:45 + 20:15 Europe/Berlin]
        │
        ▼
backend/app (FastAPI :8004)  ──reads ONLY energy_hub.duckdb (read-only, lock-retry)
        │
        ▼
frontend (TanStack Query, staleTime 15 min)  ──nginx──►  https://energy.lbzgiu.xyz
```

Why two timer firings: ENTSO-E publishes next-day DA prices ~13:00 CET; AGSI publishes
the previous gas day ~19:30 CET. One idempotent job, run after each.

Refresh job contract (`scripts/refresh.py`):
1. Step 1 (optional per run, `--skip-ingest` flag for tests): subprocess the
   market-data venv's `ingest.py` for `agsi entso_e ttf eua_carbon coal_api2`. If
   commo.duckdb is write-locked, log and continue with existing data (stale > broken).
2. Step 2: open commo.duckdb read-only, rebuild every table in energy_hub.duckdb via
   `CREATE OR REPLACE TABLE` inside one transaction, stamp `meta`.
3. Exit non-zero only if Step 2 fails. Step 1 failures are logged warnings.

## 5. Data model: `backend/data/energy_hub.duckdb` (complete, designed upfront)

```sql
-- Phase 1 (gas)
storage_history   (country VARCHAR, gas_day DATE, full_pct REAL,
                   injection REAL, withdrawal REAL, working_gas_volume REAL)
storage_seasonal  (country VARCHAR, doy SMALLINT,          -- 1..366
                   avg5 REAL, min5 REAL, max5 REAL)        -- trailing 5 full calendar years
storage_latest    (country VARCHAR, gas_day DATE, full_pct REAL,
                   d7_pct REAL,                            -- change vs 7 days ago
                   vs_avg5_pct REAL,                       -- current minus 5yr avg at same doy
                   yoy_pct REAL,                           -- current minus same doy last year
                   injection REAL, withdrawal REAL, working_gas_volume REAL)
-- 'EU' aggregate row included in all three (working-gas-volume-weighted fill %)

-- Phase 2 (power)
power_daily         (zone VARCHAR, price_date DATE, base_eur REAL,   -- mean of 24h
                     peak_eur REAL, offpeak_eur REAL)                -- peak = 08-20 local
power_hourly_recent (zone VARCHAR, ts TIMESTAMP, price_eur_mwh REAL) -- trailing 8 days
power_latest        (zone VARCHAR, price_date DATE, base_eur REAL, peak_eur REAL,
                     vs_30d_pct REAL)                                -- base vs trailing 30d mean

-- Phase 3 (spreads + prices)
spreads_daily (price_date DATE, power_de REAL, ttf REAL, eua REAL, coal_eur_mwh REAL,
               css REAL, cds REAL, fss REAL,
               regime_threshold VARCHAR,      -- 'gas' | 'coal' | 'ambiguous'
               hmm_state SMALLINT, hmm_prob REAL,
               pelt_break BOOLEAN)
prices_daily  (price_date DATE, ttf_eur_mwh REAL, eua_eur_t REAL,
               coal_usd_t REAL, hh_usd_mmbtu REAL)

-- Phase 4 (flows)
borders_daily (price_date DATE, from_zone VARCHAR, to_zone VARCHAR, net_flow_mw REAL)

-- All phases
meta (key VARCHAR PRIMARY KEY, value VARCHAR)   -- refreshed_at_gas, refreshed_at_power, ...
```

Spread formulas (constants identical to `market-data/transforms/power.py` and
`research/spark-dark/`; import or copy the constants, do not invent new ones):
- `CSS = power - TTF/0.49 - EUA*0.364`
- `CDS = power - (coal_usd_t*0.92/EURUSD)/6.978/0.36 ... ` use the exact spark-dark
  implementation: `CDS = power - (coal_usd_t*0.92/6.978)/0.36 - EUA*0.96`
- `FSS = CSS - CDS` (>0 gas marginal, <0 coal marginal)

## 6. API surface (complete)

| Route | Phase | Purpose |
|---|---|---|
| `GET /api/health` | 1 | liveness + meta freshness |
| `GET /api/meta` | 1 | refreshed_at per dataset, country/zone lists |
| `GET /api/gas/map` | 1 | storage_latest, all countries + EU row (choropleth payload) |
| `GET /api/gas/country/{cc}` | 1 | seasonal payload: current-year daily series, prior 2 years, 5yr band, inj/wd, wgv |
| `GET /api/power/map?date=` | 2 | power_latest per zone (default latest date with data) |
| `GET /api/power/zone/{zone}` | 2 | hourly recent (8d) + daily history (base/peak, 2y) |
| `GET /api/spreads` | 3 | spreads_daily series + current regime summary |
| `GET /api/prices` | 3 | prices_daily series (TTF, EUA, coal, HH) |
| `GET /api/flows?date=` | 4 | borders_daily for map arrows |

Conventions (mirror freight `app/`): pydantic response models in `schemas.py`,
read-only DuckDB connection with lock-retry in `db.py`, `project_paths.py` for
absolute paths, slowapi rate limiting, no auth (public read-only).

## 7. Frontend pages (complete)

| Route | Phase | Content |
|---|---|---|
| `/` | 1 | redirect to `/gas` |
| `/gas` | 1 | full-screen country choropleth (fill %), stat strip (EU fill %, d7, vs 5yr), click country -> side panel: seasonal fan chart (current year line, 5yr min-max band, 5yr avg, last year dashed), inj/wd bars |
| `/power` | 2 | full-screen bidding-zone choropleth (DA base price), date picker (default: latest), click zone -> side panel: hourly curve (today/yesterday) + 2y daily base/peak chart |
| `/spreads` | 3 | CSS/CDS/FSS time series with HMM regime background shading + PELT break markers, "what is marginal today" cards, methodology note |
| `/prices` | 3 | TTF / EUA / coal / Henry Hub dashboard: level charts + indexed-to-100 comparison toggle |
| About section | 4 | footer or modal: data sources, attributions (GISCO, electricitymaps ODbL, AGSI, ENTSO-E), refresh cadence, links to quant.lbzgiu.xyz + freight.lbzgiu.xyz |

Conventions (mirror freight): pure logic in `src/lib/` with vitest tests, in
particular `lib/scales.ts` (value -> color for both choropleths; colorblind-safe;
gas = red/amber/green by fill %, power = sequential warm scale with domain from data
quantiles). Components per dashboard under `src/components/gas/` and
`src/components/power/`. Nav in `__root.tsx`: Gas | Power | Spreads | Prices.

## 8. Phases (completed - see docs/CHANGELOG.md for details)

- Phase 1 - Gas dashboard MVP [COMPLETE 2026-06-13]
- Phase 2 - Power dashboard [COMPLETE 2026-06-13]
- Phase 3 - Spreads + prices [COMPLETE 2026-06-13]
- Phase 4 - Bridge polish + integration [COMPLETE 2026-06-12]
- Phase 5 - Generation mix dashboard [COMPLETE 2026-06-14]
- Phase 6 - ENTSOG gas flows on /gas [COMPLETE 2026-06-14]
- Phase 7 - Power congestion (NTC vs scheduled) [COMPLETE 2026-06-14]
- Phase 8 - Historical date scrubber for /generation [COMPLETE 2026-06-14]
- Phase 9 - German imbalance / reBAP dashboard (/imbalance) [COMPLETE 2026-06-14]
- Phase 10 - Power map enrichment (intraday range, neg-price hours, 2yr rank) [COMPLETE 2026-06-14]
- Phase 11 - Clickable interconnections layer on /power [COMPLETE 2026-06-14]
- Phase 12 - Full generation mix with nuclear via ENTSO-E A75 [COMPLETE 2026-06-14]
- Phase 13 - Dominant-fuel choropleth + full fuel breakdown on /generation [COMPLETE 2026-06-15]

### Upcoming phases

- Phase 14 - Cross-zone price divergence alerts on /map [COMPLETE 2026-06-15]
- Phase 15 - /prices page enrichment (EUA/coal correlation, TTF-EUA scatter, seasonality) [COMPLETE 2026-06-15]
- Phase 16 - Battery dispatch widget on /imbalance [COMPLETE 2026-06-15]
- Phase 17 - Gas flow volume drill-down panel on /gas [COMPLETE 2026-06-15]
- Phase 18 - NBP / UK gas price on /prices page [COMPLETE 2026-06-16]
- Phase 19 - Wind/solar capacity factor trend on /generation [COMPLETE 2026-06-17]
- Phase 20 - Interconnector utilization % coloring on /map flow arrows [COMPLETE - already implemented in Phase 11/14]
- Phase 21 - Gas storage pace-to-target widget on /gas [COMPLETE 2026-06-17]
- Phase 22 - TTF seasonality strip on /prices (monthly boxplot vs 5yr range) [COMPLETE 2026-06-18]
- Phase 23 - Power price heatmap calendar on zone drill-down panel [COMPLETE 2026-06-18]

- Phase 24 - Pipeline disruption context on /spreads and /gas [COMPLETE 2026-06-19]

- Phase 25 - UGS facilities layer on /gas [COMPLETE 2026-06-22]

---

- Phase 26 - Per-facility fill data from AGSI [COMPLETE 2026-06-22]

---

## 9. Build order summary

| Phase | Goal | New duckdb tables | New routes | Sessions |
|---|---|---|---|---|
| 1 | Gas dashboard live | 4 (storage_*, meta) | 4 | 2-3 |
| 2 | Power dashboard | +3 (power_*) | +2 | 2 |
| 3 | Spreads + prices | +2 (spreads_daily, prices_daily) | +2 | 1-2 |
| 4 | Flows + polish + integration | +1 (borders_daily) | +1 | 1-2 |
| 5 | Generation mix dashboard | +2 (generation_daily, generation_hourly_recent) | +2 | 1-2 |
| 6 | ENTSOG gas flows on /gas | +2 (gas_flows_latest, gas_flows_daily) | +0 (layer on /gas) | 1 |
| 7 | Power congestion (NTC vs scheduled) | +2 (congestion_latest, congestion_daily) | +0 (layer on /power) | 1-2 |
| 8 | Historical date scrubber for /generation | +0 (reuses generation_daily) | +0 (enhances /generation) | 1 |
| 9 | German imbalance / reBAP dashboard | +3 (imbalance_recent, imbalance_daily, imbalance_latest) | +1 (/imbalance) | 1-2 |
| 13 | Generation map: dominant-fuel choropleth + full fuel daily chart | +0 (extend existing tables) | +0 | 1 |
| 14 | Cross-zone price divergence alerts | +1 (divergence_latest) | +0/+1 | 1 |
| 15 | /prices enrichment (correlation, scatter, seasonality) | +1 (prices_correlations) | +0 | 1 |
| 16 | Battery dispatch widget on /imbalance | +1 (battery_dispatch_recent) | +1 | 1-2 |
| 17 | Gas flow volume drill-down panel | +0 | +1 | 1 |
| 18 | NBP / UK gas | +0/+1 col | +0 | 2 (needs fetcher first) |
| 19 | Wind/solar capacity factor trend on /generation | +0 (compute from generation_daily vs installed cap) | +0 | 1 |
| 20 | Interconnector utilization % on /map flow arrows | +0 (derive from congestion + borders tables) | +0 | 1 |
| 21 | Gas storage pace-to-target widget on /gas | +0 (analytics over storage_history) | +0 | 1 |
| 22 | TTF seasonality strip on /prices (monthly boxplot) | +1 (ttf_seasonality) | +0 | 1 |
| 23 | Power price heatmap calendar on zone drill-down | +0 (reuses power_daily) | +0 | 1 |

- Phase 28 - US natural gas storage regional choropleth (/us-gas) [COMPLETE 2026-06-23]
- Phase 30 - US power generation mix dashboard (/us-power) [COMPLETE 2026-06-24]
- Phase 31 - US natural gas power plants layer (/us-plants, cleanview.co + EIA-860) [COMPLETE 2026-06-24]

- Phase 39 - EU LNG terminal tracker on /gas [COMPLETE 2026-06-25]
- Phase 40 - EU nuclear generation tracker on /generation [COMPLETE 2026-06-25]
- Phase 41 - Nuclear thermal curtailment risk tracker (Open-Meteo air temp at 9 FR plants) [COMPLETE 2026-06-25]
- Phase 42 - Nonlinear vs linear fair-value model on /spreads (walk-forward OOS, low-wind hinge) [COMPLETE 2026-06-26]
- Phase 43 - Nonlinear vs linear residual signal P&L backtest on /spreads (walk-forward OOS Sharpe, low-wind split) [COMPLETE 2026-06-26]
- Phase 44 - Transaction-cost robustness of the nonlinear edge on /spreads [COMPLETE 2026-06-27]
- Phase 45 - Cross-zone dose-response of the nonlinear edge on /spreads [COMPLETE 2026-06-27]

---

## Next arc: deepen the /spreads signal research track

Forward-looking only. The nonlinear fair-value arc (P42-45) proved the hinge basis
adds *capturable, cost-robust, wind-scaling* alpha on the windy hubs. This arc pushes
the signal research toward what a power algo desk actually runs: capture the regime
both models still lose in, enrich the fundamental factor set, test whether a real
learner beats the interpretable hinge, and combine the per-zone signals into one book.
Aligns with the EU power signal-analytics focus (see memory: TGP interview).

**Hard-rule reminder:** no synthetic data. Every new factor must come from `market_data`
via the loaders. Where a factor is not yet ingested (e.g. load coverage beyond DE-LU,
FR nuclear unavailability A80), the phase's first task is to verify coverage and either
add a fetcher or restrict the factor to zones that have real data and flag the gap. Never
fabricate a series to "complete" a factor.

### Phase 46 - Regime-aware signal on /spreads [COMPLETE 2026-06-27, partially retracted by P47]

### Phase 47 - No-look-ahead rebuild of the fundamental arc on DA forecasts [COMPLETE 2026-06-27]

### Phase 48 - Expand the fundamental factor set [COMPLETE 2026-06-27]

### Phase 49 - Gradient-boosted fair value vs the hinge OLS [COMPLETE 2026-06-27]

### Phase 50 - Signal ensemble + cross-zone portfolio P&L [COMPLETE 2026-06-27]

### Phase 51 - Harden the portfolio capstone: OOS rolling weights + deflated Sharpe [COMPLETE 2026-06-27]
- US ISO day-ahead prices: ERCOT, PJM, CAISO, MISO, NYISO, ISO-NE each publish DA LMP data. Adding a zone-level price choropleth to /us-power would mirror the EU /power dashboard pattern.

## 10. Deliberately NOT building (v1)

- **Intraday/live power prices**: ENTSO-E DA only. This is a daily app; no websockets,
  no minute polling.
- **Gas flows map (ENTSOG)**: entsog_flows exists for 6 countries only; a flows layer
  on the gas map is a v2 idea, not v1.
- **Absorbing battery-dispatch / p2-imbalance pages**: they stay on quant-portfolio
  for v1. Migration is a separate decision after v1 ships (same playbook as
  transport-arb -> freight).
- **Auth / users / preferences**: public read-only app, like freight.
- **Forecasts of any kind**: this app reports markets; it does not predict them.
- **Bun, SSR, deck.gl**: npm + client-side Vite + plain Leaflet are enough; the maps
  are ~30 polygons, not 1500 moving points.

## 11. Execution notes for the building agent

- Freight is the reference implementation. When unsure how to structure anything
  (db.py lock-retry, systemd units, nginx vhost, test fixtures, route file layout,
  panel components), open the corresponding freight file and mirror it.
- DuckDB single-writer: never let the API open commo.duckdb. Only refresh.py reads
  it, and only energy_hub.duckdb is served.
- All timestamps: store UTC in duckdb; convert to Europe/Berlin only at the
  presentation layer and in peak/offpeak bucketing.
- After frontend route additions run `npx vite build --emptyOutDir=false` once if
  routeTree.gen.ts is missing entries (quant-portfolio convention, applies here too).
- Steps marked **sudo** need elevated rights; steps marked **USER ACTION** need the
  Cloudflare dashboard. Batch them and ask once per phase.
- Commit at phase boundaries with `Phase N complete: <goal>`. No AI attribution in
  commit messages.
