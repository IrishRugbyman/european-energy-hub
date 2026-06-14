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

## 8. Phases

---

### Phase 1 - Gas dashboard MVP, deployed at energy.lbzgiu.xyz

*Goal: visiting energy.lbzgiu.xyz shows a live EU gas storage choropleth with
per-country seasonal drill-down, refreshed daily, on ~20 countries.*
*Depends on: nothing. Estimated: 2-3 sessions.*

#### Data layer
- [x] Edit `market-data/config.py`: expand `AGSI_COUNTRIES` to 17 countries (AT BE BG CZ DE ES FR HR HU IT LV NL PL PT RO SK UA)
- [x] Backfill: `ingest.py agsi --from-date 2016-01-01` (all 17 countries, ~3815 rows each; BG returned 0 rows - accepted)
- [x] Verify: 16 countries + EU aggregate in storage_latest; DE fill % checked against live data
- [ ] Log the NBP data gap in `~/quant/ideas.md`

#### Project scaffold
- [x] `mkdir -p ~/quant/energy/{backend,frontend,docs}`
- [x] `backend/pyproject.toml`: name `energy-api`, deps duckdb fastapi pydantic uvicorn slowapi + editable market-data/quant-lib; `uv sync --extra dev`
- [x] Backend: `main.py` (FastAPI, CORS, GZip, slowapi), `db.py` (read-only + lock-retry), `project_paths.py`, `schemas.py`
- [x] `tests/conftest.py`: seeded temp DuckDB fixture (TemporaryDirectory, not mkstemp); session-scoped client fixture

#### Refresh job
- [x] `scripts/refresh.py` with `--skip-ingest` flag; builds storage_history / storage_seasonal / storage_latest / meta
- [x] Seasonal math: 5 most recent complete calendar years, DOY band (avg5/min5/max5), EU aggregate weighted by working_gas_volume. Pure functions in `analytics/gas.py`
- [x] `energy-refresh.service` + `energy-refresh.timer` (OnCalendar 13:45 + 20:15 UTC, Persistent=true) in `backend/`; installed + enabled
- [x] Run refresh manually: 60,410 history rows, 6,222 seasonal rows, 17 latest rows (incl. EU)

#### API
- [x] `GET /api/health`, `GET /api/meta`
- [x] `GET /api/gas/map`, `GET /api/gas/country/{cc}` (404 unknown country, cc.upper())
- [x] pytest: 7/7 green against seeded fixture

#### Frontend
- [x] Scaffold: React 19 + Vite + TS, TanStack Router + Query, Leaflet, recharts, Tailwind v4
- [x] Vendor `public/geo/countries.geojson` (GISCO 1:20m, 47 European countries, ISO_A2 property, 261 KB)
- [x] `lib/scales.ts`: fill % -> color thresholds; `lib/api.ts` typed fetchers
- [x] `routes/__root.tsx` nav; `routes/index.tsx` redirect -> `/gas`
- [x] `routes/gas.tsx`: full-screen Leaflet map, GeoJSON choropleth, hover tooltip, EU stat strip
- [x] `components/gas/CountryPanel.tsx`: side panel; recharts seasonal fan chart + inj/wd bars
- [x] `npm run build` clean (0 TS errors)

#### Deploy
- [ ] **USER ACTION**: add Cloudflare A record `energy.lbzgiu.xyz` -> 178.104.244.177 (DNS-only / grey cloud for certbot)
- [ ] **sudo**: `ln -s ~/quant/energy/nginx-energy-bootstrap.conf /etc/nginx/sites-enabled/energy && nginx -t && systemctl reload nginx`
- [ ] **sudo**: `certbot --nginx -d energy.lbzgiu.xyz`
- [ ] **sudo**: swap symlink to production config: `ln -sf ~/quant/energy/nginx-energy.conf /etc/nginx/sites-enabled/energy && nginx -t && systemctl reload nginx`; then re-enable Cloudflare orange-cloud
- [x] `energy-api.service` installed + enabled (running on :8004)
- [x] `energy-refresh.timer` installed + enabled (next fire: 2026-06-13 13:45 UTC)
- [ ] Smoke-test the live site; mark Phase 1 complete

#### Definition of done
- https://energy.lbzgiu.xyz/gas renders the choropleth with ~20 countries colored
- Clicking Germany shows the seasonal fan chart and the numbers match agsi.gie.eu
- `systemctl list-timers` shows energy-refresh; a manual run updates the map data
- `pytest -q` green in backend; `npm test` green in frontend

---

### Phase 2 - Power dashboard

*Goal: /power shows a bidding-zone DA price choropleth for ~30 European zones with
per-zone hourly and historical drill-down.*
*Depends on: Phase 1. Estimated: 2 sessions.*

#### Data layer
- [ ] Expand `ENTSO_E_ZONES` in `market-data/config.py` with EIC codes from the
      entsoe-py Area enum: ES PT PL CZ SK HU RO BG GR SI HR FI EE LV LT DK1 DK2
      SE1 SE2 SE3 SE4 NO1 NO2 NO3 NO4 NO5 IE-SEM
- [ ] Backfill new zones from 2019-01-01: `ingest.py entso_e --from-date 2019-01-01`
      (fetcher chunks monthly and is idempotent; run in tmux/background, it is hours
      of API calls; existing 7 zones stay incremental)
- [ ] Verify row counts per zone; spot-check ES and SE3 daily means against a public
      source (e.g. epexspot or entsoe transparency UI)

#### Refresh job
- [ ] Extend refresh.py: build power_daily (base/peak/offpeak from hourly, local-time
      peak 08-20), power_hourly_recent (8d), power_latest (vs 30d). Pure functions in
      `analytics/power.py`, unit-tested (incl. DST days: 23h/25h)
- [ ] Extend seeded test fixture with 2 zones

#### API
- [ ] `GET /api/power/map?date=`, `GET /api/power/zone/{zone}` + pytest

#### Frontend
- [ ] Vendor `public/geo/bidding_zones.geojson` (electricitymaps-contrib, filtered +
      mapshaper-simplified, < 600 KB; document the command; ODbL attribution noted
      for the Phase 4 About section)
- [ ] Zone color scale in `lib/scales.ts` (quantile domain, vitest)
- [ ] `routes/power.tsx`: full-screen choropleth, date picker (default latest),
      hover tooltip (zone, base, peak); enable Power in nav
- [ ] `components/power/ZonePanel.tsx`: hourly curve (latest day vs previous) +
      2y daily base/peak history chart
- [ ] Build + deploy (npm run build; restart energy-api)

#### Definition of done
- /power renders ~30 zones; SE1-SE4 and NO1-NO5 visibly distinct polygons
- DE-LU vs IT-NORD price difference visible by color on a normal day
- Clicking a zone shows hourly + history; date picker changes the map
- Tests green; live site verified

---

### Phase 3 - Spreads bridge + prices

*Goal: /spreads shows CSS/CDS/FSS with regime detection (the gas-to-power bridge);
/prices shows the fuel complex (TTF, EUA, coal, Henry Hub).*
*Depends on: Phase 2. Estimated: 1-2 sessions.*

#### Refresh job
- [ ] Add `hmmlearn` and `ruptures` to backend pyproject (`uv lock`)
- [ ] `analytics/spreads.py`: daily DE-LU mean power + TTF + EUA + coal -> CSS/CDS/FSS
      with the exact spark-dark constants; threshold regime; 2-state GaussianHMM on
      (FSS, rolling_std_20d); PELT breaks. Reuse/port from
      `~/quant/research/spark-dark/src/` rather than rewriting; unit-test the spread
      arithmetic against the values in spark-dark's CLAUDE.md (2026-05-22: CSS=-20.06,
      CDS=-0.35, FSS=-19.71)
- [ ] Build spreads_daily + prices_daily in refresh.py; extend fixture

#### API
- [ ] `GET /api/spreads` (series + current regime summary), `GET /api/prices` + pytest

#### Frontend
- [ ] `routes/spreads.tsx`: FSS chart with HMM-state background shading and PELT
      break markers; CSS and CDS series; "today" cards (CSS, CDS, marginal fuel);
      short methodology text (formulas, HMM caveat: states = crisis vs normal)
- [ ] `routes/prices.tsx`: four level charts + indexed-to-100 comparison toggle
- [ ] Enable Spreads + Prices in nav; build + deploy

#### Definition of done
- /spreads current-day numbers match a manual run of the spark-dark project
- 2021-2022 crisis period visibly shaded by the HMM on the FSS chart
- /prices renders all four series with correct units; tests green; live verified

---

### Phase 4 - Bridge polish + integration (COMPLETE 2026-06-12) ✅

*Goal: the hub feels finished: flows on the power map, About/attributions, mobile,
cross-links, registry updated.*
*Completed: 2026-06-12, commits 7d37953..ed0b1f4*

- [x] Refresh + API + map: borders_daily from cross_border_flows (24 existing pairs);
      `GET /api/flows?date=`; toggleable arrow layer on /power (direction + width by
      net flow, freight LayerToggles pattern)
- [x] About section (footer or modal): data sources, GISCO + ODbL + AGSI + ENTSO-E
      attributions, refresh cadence, links to quant.lbzgiu.xyz and freight.lbzgiu.xyz
- [x] Mobile pass: maps usable on a phone, side panels become bottom sheets,
      nav collapses to icons on small screens, legend hidden on mobile
- [x] Cross-links: on quant-portfolio, the gas-storage / spark-dark / power-spreads
      pages get "explore live at energy.lbzgiu.xyz" links
- [x] Empty/stale states: StaleBanner shown if data older than 48h (gas, power, spreads)
- [x] Lighthouse / bundle check: /assets/ immutable cache headers added to nginx;
      bundle max chunk 359 KB gzip 104 KB (no code-split needed)
- [x] Update `~/quant/PROJECTS.md` Apps row to Live; create `docs/CHANGELOG.md`;
      update `energy/CLAUDE.md` to final form
- [x] Final tag `v1.0` (see git tag v1.0)

#### Definition of done
- All four pages live, mobile-usable, attributed, registry updated - DONE

---

---

### Phase 5 - Generation Mix Dashboard (COMPLETE 2026-06-14) ✅

*Goal: /generation shows a renewable-% choropleth for 34 European bidding zones with
per-zone fuel-mix deep-dive (24h hourly stacked profile + 1Y daily renewable trend),
completing the energy trilemma picture: gas storage -> power prices -> generation mix.*
*Built 2026-06-13 (code); brought live 2026-06-14 once the rebase-generation backfill
finished and the refresh pipeline was migrated from commo.duckdb to PostgreSQL.*

All tasks below done: generation tables populated (33 zones live), /api/generation/map +
/api/generation/zone serving real data, choropleth + ZoneGenPanel shipped. The post-build
blocker (DuckDB -> PostgreSQL migration broke refresh.py) is fixed; see CHANGELOG 2026-06-14.

#### Data layer
- [x] Extend `analytics/generation.py`:
  - `build_generation_daily(db)`: daily avg MW per fuel per zone for 2019-present
    (`SELECT zone, ts::DATE AS gen_date, AVG(solar) AS solar, ... GROUP BY zone, gen_date`)
  - `build_generation_hourly_recent(db)`: last 10 days hourly mix per zone
    (use same lookback window as power_hourly_recent: `ts >= now() - interval '10 days'`)
  - Update `build_generation_latest` to pull from `generation_daily` (max gen_date per zone)
    rather than querying rebase_generation directly, so the three tables stay consistent
  - All three functions: handle empty rebase_generation gracefully (return empty DataFrame)
- [x] Add `generation_daily` and `generation_hourly_recent` to `build_generation_tables()`
- [x] Extend `scripts/refresh.py` to write `generation_daily` and `generation_hourly_recent`
  to energy_hub.duckdb (mirror how `power_daily`/`power_hourly_recent` are handled)
- [x] Verify: after a manual `refresh.py --skip-ingest`, `generation_daily` has rows
  for all populated zones and `generation_hourly_recent` covers the last 10 days

#### API
- [x] `GET /api/generation/map` - returns `{zones: [{zone, gen_date, renewable_pct, solar_mw,
  wind_mw, hydro_mw, gas_mw, coal_mw, total_mw}]}` from generation_latest;
  404 if no data (backfill not finished)
- [x] `GET /api/generation/zone/{zone}` - returns:
  - `hourly`: list of `{ts, solar, wind, hydro, gas, coal, biomass, oil, unknown}` (MW, last 10 days)
  - `daily`: list of `{gen_date, renewable_pct, solar, wind, hydro, gas, coal, total_mw}` (2Y history)
  - `latest`: `{gen_date, renewable_pct, dominant_fuel, fuel_breakdown}`
  - 404 for unknown zone
- [x] Add Pydantic schemas: `GenMapItem`, `GenMapResponse`, `GenHourly`, `GenDaily`, `GenZoneResponse`
- [x] pytest: generation map + zone endpoints against seeded fixture with 2 zones and 72h of hourly data
  (include DST boundary to test ts handling); 404 for unknown zone

#### Frontend
- [x] `lib/scales.ts`: add `renewablePctColor(pct: number): string` - fixed thresholds
  (0-20 brown #8B4513, 20-40 amber #B8860B, 40-60 #8B8B00, 60-80 #4A8B4A, 80-100 #1B6B1B);
  add vitest tests (0, 19, 20, 50, 80, 100 boundary checks + null/undefined guard)
- [x] `lib/api.ts`: add `fetchGenMap()` and `fetchGenZone(zone)` typed fetchers;
  staleTime 15 min (daily-refresh data)
- [x] `routes/generation.tsx`: full-screen Leaflet choropleth on bidding_zones.geojson
  - Same structure as power.tsx: map fills viewport, side panel opens on zone click
  - GeoJSON colored by renewable_pct via `renewablePctColor`; grey if no data for zone
  - Hover tooltip: zone name + renewable_pct + dominant fuel
  - Top-right legend: color gradient with 5 labels (0% / 20% / 40% / 60% / 80%+)
  - EU summary strip (top): avg renewable_pct weighted by total_mw, highest/lowest zone
  - StaleBanner: show if gen_date > 48h old (reuse existing StaleBanner component)
  - No date picker (v5 shows today only; historical date picker is a v6+ idea)
- [x] `components/generation/ZoneGenPanel.tsx`:
  - Header: zone name, gen_date, renewable_pct badge (green), dominant fuel label
  - Stacked area chart (recharts AreaChart): 24h hourly fuel mix, last full day;
    fuel stacking order bottom-to-top: nuclear/hydro (green), wind (light green),
    solar (yellow), biomass (tan), gas (blue-grey), coal (dark), oil/unknown (red/grey);
    X-axis: hour (local time Europe/Berlin); Y-axis: MW
  - Renewable % trend chart (recharts LineChart): daily renewable_pct for last 365 days;
    30d rolling average line overlay; Y-axis 0-100%; X-axis: month labels
  - Window toggle: 3M / 1Y / ALL for the trend chart (mirrors gas/power panel toggles)
  - Mobile: bottom sheet (same pattern as CountryPanel/ZonePanel)
- [x] Upgrade `components/power/ZonePanel.tsx` GenerationMixSection:
  - Replace current flat-bar display with a proper 24h stacked area chart
  - Fetch `generation_hourly_recent` data from the zone endpoint (already in the response)
  - Keep compact: fits within the existing ZonePanel scroll area
- [x] Add "Generation" to nav in `routes/__root.tsx` (icon: Zap or Wind from lucide-react);
  enable on desktop and mobile icon bar
- [x] Run `npx vite build --emptyOutDir=false` once to regenerate routeTree.gen.ts, then
  `npm run build`; verify no TS errors

#### Definition of done
- /generation renders 34 bidding zones colored by renewable % (green Nordics, darker south/east)
- Clicking DE-LU shows 24h stacked hourly fuel mix + 1Y renewable trend; numbers are plausible
  vs Rebase API source (spot-check one zone)
- ZonePanel on /power shows upgraded 24h stacked chart instead of flat bar
- `pytest -q` green (all generation tests pass); `npm test` green (scale tests pass)
- Live at energy.lbzgiu.xyz/generation after `npm run build` + `sudo systemctl restart energy-api`

---

### Phase 6 - ENTSOG physical gas flows on /gas [COMPLETE - 2026-06-14]

Physical gas flow choropleth overlay on /gas. "Physical flows" toggle (top-right) colors
AT/BE/DE/FR/IT/NL by net GWh/d (blue = net importer, amber = net exporter). CountryPanel
shows net/entry/exit stat boxes + 400-day AreaChart for ENTSOG countries.
Endpoints: GET /api/gas/flows, GET /api/gas/flows/{cc}. 27 tests pass.

---

### Phase 7 - Power congestion (NTC vs scheduled) on /power [COMPLETE - 2026-06-14] ✅

*Goal: /power surfaces cross-border congestion: how much of each border's day-ahead transfer
capacity (NTC) is used by scheduled commercial flows - the borders that are "full" are where
price spreads are highest.*
*Completed: 2026-06-14, commit d696ebb*

#### Data layer
- [x] Add `entso-e-ntc`, `entso-e-scheduled` to the refresh fetcher list
- [x] `analytics/congestion.py`: `build_congestion_tables()` - per directed border per day, join daily
  mean scheduled_mw to daily mean ntc_mw; `utilization_pct = scheduled / ntc` (clip 0-100, guard ntc=0).
  Emit `congestion_latest` (latest day per border pair: ntc, scheduled, utilization, both directions)
  and `congestion_daily` (trailing 400d per border for the panel). Restrict to the zones present
  in `bidding_zones.geojson` so every border is mappable
- [x] Verify one border (DE-LU <-> FR) utilization is in 0-100 and plausible

#### Refresh job
- [x] `_write_congestion()`; stamp `refreshed_at_congestion`. Handle empty inputs gracefully

#### API
- [x] `GET /api/power/congestion?date=` - latest (or given-date) border utilizations for the map layer
- [x] `GET /api/power/congestion/border/{from}/{to}` - trailing-400d utilization + ntc + scheduled series
- [x] Schemas + pytest (2 borders, a congested and an uncongested day; ntc=0 guard)

#### Frontend
- [x] New toggleable "Congestion" layer on /power: color each border line by utilization_pct
  (sequential warm scale, red = saturated); reuse the existing flow-arrow geometry between zone centroids
- [x] `lib/scales.ts`: `utilizationColor(pct)` + vitest
- [x] Border click (or a small panel): utilization history chart for that border
- [x] Legend; mobile parity with the existing flows layer

#### Definition of done
- /power shows a congestion layer; a saturated border (e.g. FR->DE in a known tight period) reads red
- Border drill-down shows utilization history; tests green; live verified - DONE

---

### Phase 8 - Historical date scrubber for /generation [COMPLETE - 2026-06-14] ✅

*Goal: /generation gains a historical date picker (like /power already has), letting users replay
past days' generation mix and renewable-% choropleth, not just today.*
*Depends on: Phase 5. No new data/refresh wiring - `generation_daily` already holds full history.*
*Completed: 2026-06-14*

#### API
- [x] Extend `GET /api/generation/map` to accept `?date=` (default: latest); serve the per-zone
  generation_daily row for that date (renewable_pct + fuel breakdown), 404/empty-safe for gaps
- [x] min_date/max_date included in GenMapResponse so the picker knows the valid range
- [x] pytest: map at an explicit historical date returns that day's rows; out-of-range date returns 404

#### Frontend
- [x] Date picker on /generation (top-right, same style as /power), default latest with "Latest" reset button
- [x] Map recolors by the selected date's renewable_pct; EU summary strip recomputes for that date
- [x] Zone panel trend chart highlights the selected date with an amber reference line
- [x] URL-sync the date via ?date= query param (TanStack Router validateSearch); shareable links

#### Definition of done
- /generation date picker scrubs the choropleth across history; tests green; live verified - DONE

---

### Phase 9 - German imbalance / reBAP dashboard (/imbalance)

*Goal: a new /imbalance dashboard bringing the p2-imbalance research live: German balancing
(reBAP) prices and system state. Single-zone (DE), so chart-first rather than map-first.*
*Depends on: Phase 5. Source: `imbalance_prices_de` (155k rows, 15-min, long/short/NRV, 2021-12 to present).*
*Data note: add `smard-imbalance-de` to the daily-refresh fetcher list (preferred source per market-data).*

#### Data layer
- [ ] Add `smard-imbalance-de` to the refresh fetcher list
- [ ] `analytics/imbalance.py`: `build_imbalance_tables()` from `imbalance_prices_de`
  (ts, long_eur_mwh, short_eur_mwh, nrv_mw). Emit `imbalance_recent` (15-min, trailing ~10 days),
  `imbalance_daily` (daily mean/min/max of the reBAP price + mean |NRV|, 2Y), and `imbalance_latest`
  (current price, current system direction long/short from NRV sign, today's range)
- [ ] Document the reBAP sign convention; reuse any constants from `research/p2-imbalance`

#### Refresh job
- [ ] `_write_imbalance()`; stamp `refreshed_at_imbalance`. Empty-safe

#### API
- [ ] `GET /api/imbalance` - latest snapshot + recent 15-min series + daily 2Y series + system state
- [ ] Schemas + pytest (seeded fixture: a long-system and a short-system interval)

#### Frontend
- [ ] `routes/imbalance.tsx`: chart-first dashboard - reBAP price line (recent 15-min + daily history
  with window toggle), NRV/system-state band (long vs short shading), "system now" cards
  (current reBAP, direction, today's range). Short methodology note (what reBAP is, the data source)
- [ ] Add "Imbalance" to nav (`__root.tsx`); desktop + mobile icon bar; regenerate routeTree.gen.ts
- [ ] StaleBanner; About-modal attribution for SMARD/ENTSO-E imbalance
- [ ] Cross-link from quant-portfolio's p2-imbalance page to energy.lbzgiu.xyz/imbalance

#### Definition of done
- /imbalance renders reBAP price + system-state; current numbers match a manual p2-imbalance check
- New nav item works on desktop + mobile; `pytest -q` + `npm test` green; live verified

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

## 10. Deliberately NOT building (v1)

- **NBP / UK gas**: not ingested, no fetcher. No synthetic data. Logged in ideas.md.
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
