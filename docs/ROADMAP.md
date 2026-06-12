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

### Phase 4 - Bridge polish + integration

*Goal: the hub feels finished: flows on the power map, About/attributions, mobile,
cross-links, registry updated.*
*Depends on: Phase 3. Estimated: 1-2 sessions.*

- [ ] Refresh + API + map: borders_daily from cross_border_flows (24 existing pairs);
      `GET /api/flows?date=`; toggleable arrow layer on /power (direction + width by
      net flow, freight LayerToggles pattern)
- [ ] About section (footer or modal): data sources, GISCO + ODbL + AGSI + ENTSO-E
      attributions, refresh cadence, links to quant.lbzgiu.xyz and freight.lbzgiu.xyz
- [ ] Mobile pass: maps usable on a phone, side panels become bottom sheets (mirror
      whatever freight does), nav collapses
- [ ] Cross-links: on quant-portfolio, the gas-storage / spark-dark / power-spreads
      pages get an "explore live at energy.lbzgiu.xyz" banner (same seam style used
      when transport-arb moved to freight)
- [ ] Empty/stale states: if meta says data older than 48h, show a banner instead of
      silently stale maps
- [ ] Lighthouse / bundle check: geojson assets cached (long max-age in nginx),
      code-split per route if main chunk > 500 KB
- [ ] Update `~/quant/PROJECTS.md` Apps row to 🟢 Live; create `docs/CHANGELOG.md`
      with a Phase 1-4 entry each; update `energy/CLAUDE.md` to final form
- [ ] Run `/ux-audit` on the live site; fix what it finds
- [ ] Final commit + tag `v1.0`

#### Definition of done
- All four pages live, mobile-usable, attributed, registry updated, ux-audit clean

---

## 9. Build order summary

| Phase | Goal | New duckdb tables | New routes | Sessions |
|---|---|---|---|---|
| 1 | Gas dashboard live | 4 (storage_*, meta) | 4 | 2-3 |
| 2 | Power dashboard | +3 (power_*) | +2 | 2 |
| 3 | Spreads + prices | +2 (spreads_daily, prices_daily) | +2 | 1-2 |
| 4 | Flows + polish + integration | +1 (borders_daily) | +1 | 1-2 |

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
