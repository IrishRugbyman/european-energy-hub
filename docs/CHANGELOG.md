# Energy Hub Changelog

## 2026-06-19 - Phase 24: Pipeline disruption context on /spreads and /gas

**Added:** World Monitor pipeline disruption data surfaced on two dashboards.

**Spreads (/spreads):** `disruption_bcm` column added to `spreads_daily` in `energy_hub.duckdb`. The FSS chart gains a "Disruption overlay" toggle: when active, a dashed orange line on a right Y-axis (bcm/yr) plots how much EU gas pipeline capacity was offline each day, making the NS1 sabotage (Sep 2022: +130 bcm/yr step), Druzhba North suspension (Feb 2023), and Ukraine transit expiry (Jan 2025: +142 bcm/yr step) visible alongside spread movements. Current figure (288 bcm/yr) also shown as a small label in the stat strip. Tooltip shows gas offline bcm/yr on hover.

**Gas (/gas):** `pipeline_offline_bcm` field added to `GasMapResponse`. The stat strip overlay shows "pipeline offline: 288 bcm/yr" next to the EU fill/7d/vs-5yr chips (hidden on mobile).

Data source: World Monitor (Global Energy Monitor, CC-BY 4.0) via `load_capacity_offline_series(commodity='gas')` loader. Step function: 17 -> 72 -> 138 -> 268 -> 288 bcm/yr.

**Artifacts:** `backend/analytics/spreads.py` (disruption_bcm column in _build_spreads), `backend/scripts/refresh.py` (DDL update), `backend/app/schemas.py` (SpreadsDailyPoint + GasMapResponse), `backend/app/main.py` (/api/spreads + /api/gas/map), `frontend/src/lib/api.ts`, `frontend/src/routes/spreads.tsx` (toggle + dual Y-axis), `frontend/src/routes/gas.tsx` (stat chip).

---

## 2026-06-18 - Post-roadmap round 4: EU fuel mix, borders table, percentile ranks, refresh fixes

**Tried:** Six improvements plus three critical infrastructure fixes:
1. EU aggregate fuel mix chart on /generation page showing annual solar/wind/coal/gas/nuclear trend 2021-present (34 zones)
2. Borders table panel on /map (sortable by spread EUR/MWh or NTC utilization %, click-through to border panel)
3. 2yr percentile rank badges on spreads zone snapshot chart (BE CSS 87th%, NL CSS 83rd%)
4. Three critical refresh script bugs: eua_carbon/coal_api2 used underscore vs hyphen; nbp and eia-natgas missing from refresh fetcher list; DuckDB write-lock conflict during concurrent API + rebuild
5. Increased entso-e-gen-full timeout from 30min to 2h
6. Manual rebuild to bring power prices current (June 17 data now live)

**Found:**
- Solar EU-34 capacity grew 120% from 2021 to 2025; coal down 38%
- EUA/coal prices were not refreshing for unknown duration due to underscore vs hyphen typo
- NBP/HH prices going stale since initial deployment (missing from fetcher list)
- DuckDB 1.5.3 requires write-lock retry when API threads are active

**Decision:** Six commits (3d64c96 to 98bd62d). 55 tests pass.

**Artifacts:** `GET /api/generation/eu/annual`; `EuFuelMixChart`; `BordersTable`; percentile rank badges; DuckDB lock retry.

---

## 2026-06-18 - Post-roadmap round 3: pace charts, YoY prices, perf, reBAP profile

**Tried:** Eight more improvements, focusing on gas pace analytics, performance, and imbalance depth:
1. Per-country gas pace stats in /gas/country/{cc} endpoint (current rate vs required rate to hit 90% by Nov 1)
2. CountryPaceBar widget in CountryPanel: on-track chip, current/required rates, progress bar
3. Batch /gas/pace/countries endpoint + "Pace" tab in rankings panel with grouped bar chart (grey=required, green/red=current)
4. Year-on-year % change for all commodities in /prices stat strip (TTF+9.9% YoY, HH -18.4% YoY)
5. DuckDB thread-local connections: eliminated 200-300ms cold I/O overhead per request (power/zone: 260ms -> 61ms)
6. Multi-zone spreads payload trimmed from 5yr to 2yr (276ms -> 80ms hot path)
7. 90-day reBAP hourly profile (imbalance_hourly_profile, 24 rows) + chart on /imbalance showing duck curve in balancing prices (H12 avg 16 EUR/MWh / 44% neg, H20 avg 165 EUR/MWh)
8. Test suite expanded from 52 to 54 tests

**Found:**
- Belgium is withdrawing gas (-2 GWh/d) while at only 22% fill - the most extreme pace deficit in EU
- DuckDB opens a new file connection per query by default; thread-local connections give 4x speedup with no code change in endpoints
- reBAP duck curve closely mirrors DE-LU day-ahead (solar cannibalization is visible in both)

**Decision:** Eight commits (be93616 to d6b7713). All 54 backend tests pass. All features from existing data - no new PostgreSQL fetchers needed.

**Artifacts:** `GET /api/gas/pace/countries`; `GET /api/imbalance/profile`; `imbalance_hourly_profile` DuckDB table; `CountryPaceBar`, `PaceComparisonChart`, `RebalancingHourlyProfile` frontend components; `db.py` thread-local optimization.

---

## 2026-06-18 - Post-roadmap round 2: zone panel overhaul, hourly profile, seasonality, rankings charts

**Tried:** Seven more high-value improvements after the first post-roadmap batch:
1. Sortable gas storage rankings panel with table/chart toggle (vs-5yr-avg bar chart, NL -29pp, DE -21pp most deficit)
2. 24h average price profile chart per zone (90d window, CET, avg/IQR/neg-hour pct) - reveals duck curve: DE-LU H12 avg 16 EUR/MWh, 45% neg hours
3. Power price seasonality (day-of-week and month-of-year bar charts per zone, 2yr history) - Mon-Wed 100 EUR/MWh vs Sun 65, winter 112 vs June 73 in DE-LU
4. Power zone profile precomputed in DuckDB (power_hourly_profiles, 816 rows)
5. Tabbed zone panel: Price tab (stat strip, 48h, heatmap, profile, seasonality, calendar, daily range) vs Generation tab (fuel mix, hourly gen, RE trend, capacity factors)
6. Sortable zone price table on /map (all 34 zones, sortable by price/vs30d/2yr rank/neg hrs/RE%)
7. Gas storage vs-5yr-avg bar chart in Rankings panel

**Found:**
- Solar cannibalization is extreme in DE-LU summer: midday prices near zero with ~45% negative-hour rate
- Weekend prices 35% below weekday average; summer fill 40.5% (vs 5yr avg -10.6pp) - Europe significantly undersupplied heading into H2 2026
- Zone panel had grown to 11 stacked sections; tabbing immediately reduces scroll fatigue

**Decision:** Seven commits. 51 backend tests pass. All data from existing DuckDB tables/PostgreSQL with one new precomputed table (power_hourly_profiles). No new PostgreSQL queries at request time.

**Artifacts:** `GET /api/power/zone/{zone}/profile`; `GET /api/power/zone/{zone}/seasonality`; `power_hourly_profiles` DuckDB table; `HourlyProfileChart`, `SeasonalityCharts`, `StorageRankings` chart view, `ZoneTable` frontend components.

---

## 2026-06-18 - Post-roadmap features: LNG spread, YoY gas chart, price regime, RE trends heatmap

**Tried:** Four high-value analytics features after the roadmap was exhausted:
1. Gas storage year-on-year spaghetti chart (2019-2026) on the country panel
2. Rolling TTF/EUA volatility (30d std of daily changes x sqrt(252)) and TTF-EUA 90d Pearson correlation chart on /prices
3. Annual renewable % heatmap (34 zones x 6 years) as a new `/generation` page replacing the redirect
4. TTF-HH LNG arbitrage spread chart on /prices (hh_eur_mwh computed from HH USD/MMBtu x EUR/USD / 0.293)

**Found:**
- YoY spaghetti chart reveals 2026 storage is tracking well below all prior years at the same DOY. 2022 (highlighted amber as the energy crisis year) reached 90%+ by Nov 1 because of an emergency EU fill directive.
- TTF realized vol peaked at 352 EUR/MWh annualized during the 2022 crisis; current vol is 25.8 EUR/MWh. TTF-EUA 90d correlation hit -0.84 at worst (decoupled during crisis); currently -0.11.
- RE trends heatmap: BE doubled from 20% to 43% renewable in 5 years; DE-LU 36->53%; PL 15->34%; ES 47->57%. Norway/Sweden zones already 99%+. SK/CZ remain below 20%.

**Decision:** Four commits (03e1fb4, e8c2f79, 0c86cac, 072f8fd). All 49 backend tests pass. Features use existing DuckDB data with one new refresh step for hh_eur_mwh. Navigation updated to include "RE Trends" link.

**Artifacts:** `GET /api/gas/country/{cc}` extended with `yearly_tracks`; `GET /api/prices/regime`; `GET /api/generation/trends`; `hh_eur_mwh` column in prices_daily; `StorageYoyChart`, `PriceRegimeCharts`, `GenerationTrends`, `TtfHhSpread` frontend components.

---

## 2026-06-18 - Phases 21-23: Gas pace widget, TTF seasonality boxplot, power price calendar

**Tried:** Three analytics features using existing DB tables without new ingest steps:
- Phase 21: EU gas storage pace-to-target (AGSI storage_history + storage_seasonal)
- Phase 22: TTF monthly seasonality distribution upgrade (prices_daily, 2019-present)
- Phase 23: Power price calendar heatmap (power_daily, zone-level, trailing 365d)

**Found:**
- EU gas storage at 40.5% on 2026-06-16, needing 5174 GWh/d to reach 90% by Nov 1 but injecting only 3847 GWh/d. At current pace: 186 days needed, 138 days available. Clearly behind (worst pace since 2021 crisis year). The pace widget makes this immediately visible.
- TTF seasonality: the 2019-present distribution reveals wide multi-year ranges. Aug/Sep 2022 crisis produced max values of 339/243 EUR/MWh; axis is capped at 150 to protect IQR readability. Jun 2026 at 42.5 EUR/MWh sits above the 8yr median (34.2) but within the IQR (31.5-35.4).
- Calendar heatmap: all 13 zones rendered correctly. DE-LU shows clearly visible negative-price days (purple cells) on Sundays in spring/autumn due to solar + wind surpluses. FR shows cold-snap pricing (2024 winter spike). No new API needed; reuses existing power_daily data already fetched by the panel.

**Decision:** All three phases complete. Phase 22 replaces the previous simple 5yr-avg bar chart with a proper boxplot (p25/median/p75 IQR box + whiskers + current month marker). Phase 21 `GET /api/gas/pace` endpoint computes in real-time from DuckDB without a new precomputed table. Phase 23 is pure frontend using existing data. 47 backend tests pass.

**Artifacts:** `GET /api/gas/pace`, `GasPaceResponse` schema, `PaceWidget` gas.tsx component, `GET /api/prices/seasonality`, `TtfSeasonalityResponse` schema, upgraded `TtfSeasonality` component in prices.tsx, `PriceCalendarHeatmap` in UnifiedZonePanel.tsx.

---

## 2026-06-17 - Phase 19: Wind/solar capacity factor trend

**Tried:** Fetch ENTSO-E annual installed generation capacity (A68 report) for all 34 bidding zones via `query_installed_generation_capacity`, join against existing daily generation averages to compute CF = avg_mw / installed_mw. Forward-fill annual snapshots to daily grain using `merge_asof(..., direction="backward")`.

**Found:** 30 of 34 zones returned data (IT-NORD and SE-1..4 had no ENTSO-E capacity records). 2019-2026 snapshots stored - 8 annual rows per zone. Resulting `capacity_factors_daily` table: 53,758 rows. Sanity checks: DE-LU wind avg CF 22.4%, DK-1 wind 33.4%, ES solar 22.9% - all physically plausible. The 2026 snapshot shows DE-LU solar installed capacity grew from 77 GW (2024) to 104 GW (2026), visibly reflected in falling per-unit CF despite higher absolute output.

**Decision:** Phase 19 complete. New `GET /api/generation/zone/{zone}/capacity` endpoint returns 2Y daily wind_cf + solar_cf with installed GW context. UnifiedZonePanel shows 30-day rolling avg wind (sky-blue) and solar (amber) CF line chart for any zone with data. Zones without ENTSO-E capacity records (IT-NORD, SE-*) simply show no chart - graceful fallback. 45 backend tests pass. `entso-e-capacity` ingest command added to market-data; runs annually (data only updates once per year).

**Artifacts:** `installed_generation_capacity` PostgreSQL table, `fetchers/entso_e.py::fetch_installed_capacity`, `loaders/power.py::load_installed_capacity`, `analytics/generation.py::_build_capacity_factors`, `capacity_factors_daily` DuckDB table, `GET /api/generation/zone/{zone}/capacity`.

---

## 2026-06-17 - TTF forward curve panel + stale price data fix

**TTF forward curve** added to `/prices` as a color-coded bar chart below the main price history.
22 contracts from Q3-26 through CAL-30, ordered by delivery start, color-coded by tenor type
(quarterly = indigo, summer = amber, winter = sky-blue, calendar = emerald). Shows the current
deep backwardation: 42.6 EUR/MWh near-term to 22.1 EUR/MWh in 2030.

Backend: `analytics/spreads.py` gains `_build_ttf_curve()` which pulls the latest snapshot from
`ttf_curve` in `market_data` PostgreSQL and sorts by delivery date. `refresh.py` writes a new
`ttf_curve_latest` DuckDB table. New endpoint `GET /api/prices/curve` filters to Q*/SUM/WIN/CAL
tenor types (excludes individual monthly contracts) and returns them sorted. 43 backend tests pass.

**Stale price data fix**: `dbnomics` Python package was missing from the market-data venv (not in
`pyproject.toml`), causing TTF spot to stall at 2026-05-22. Added to deps + uv.lock. All prices
refreshed: TTF 42.5, EUA 75.6, Coal 99.2 USD/t, HH 3.25 USD/MMBtu, NBP 39.9 EUR/MWh.

---

## 2026-06-16 - UK NBP gas price on /prices page (Phase 18)

Added UK NBP (National Balancing Point) front-month gas price to the /prices dashboard.

Data source: yfinance `NBP=F` (NYMEX, USD/MMBtu). History: 2017-05-22 to present (2147 rows).
Conversion to EUR/MWh uses the daily `eur_usd` rate from `fx_rates` in `market_data` PostgreSQL
(price_eur_mwh = price_usd_mmbtu * eur_usd / 0.29307). Current spread: NBP at ~39.7 EUR/MWh vs
TTF at ~48.7 EUR/MWh (UK trading at discount to EU).

Changes:
- `market-data/fetchers/nbp.py`: incremental yfinance fetcher, stores raw USD/MMBtu
- `market-data/db.py`: `nbp_prices (price_date PK, front_month, source)` table
- `market-data/ingest.py`: `nbp` CLI command, added to `run_all`
- `market-data/loaders/gas.py`: `load_nbp_daily()` loader
- `analytics/spreads.py`: `_build_prices()` extended with NBP->EUR/MWh conversion
- `scripts/refresh.py`: `prices_daily` schema gains `nbp_eur_mwh REAL`
- `schemas.py` + `main.py`: `PricesDailyPoint` and `/api/prices` return `nbp_eur_mwh`
- `prices.tsx`: NBP (violet line) added to stat strip, chart, correlation matrix (6 pairs:
  TTF/NBP, TTF/EUA, TTF/Coal, NBP/EUA, NBP/Coal, EUA/Coal); new TTF-NBP basis spread panel
  (2Y trailing, with zero line and 2Y average) shows UK/EU gas arb
- `tests/conftest.py`: seeder adds `nbp_eur_mwh` to `prices_daily` fixture

---

## 2026-06-15 - Multi-zone CSS/CDS/FSS comparison on /spreads

Extended spread analytics from DE-LU-only to 6 EU bidding zones (DE-LU, FR, NL, IT-NORD, BE, AT),
all using TTF as the common gas reference (standard EU practice). Backend: `_build_multi_zone_spreads`
in `analytics/spreads.py` loops over SPREAD_ZONES using the existing `load_spread_inputs` loader,
writes 10k+ rows to a new `multi_zone_spreads` DuckDB table. New endpoint `GET /api/spreads/zones`
returns pivoted zone data. Frontend: `/spreads` gains a multi-zone comparison section below the
DE-LU history chart - CSS/CDS/FSS toggle, latest snapshot bar chart (one bar per zone) and a
history line chart with per-zone colour coding.

---

## 2026-06-15 - Test coverage for divergence and battery dispatch endpoints

Added 4 new backend tests (total 40): `test_power_divergence`, `test_power_divergence_history`,
`test_imbalance_dispatch`, `test_imbalance_dispatch_summary`. The conftest seeder now creates
`divergence_latest`, `divergence_30d`, `battery_dispatch_recent`, and `battery_summary` tables
with realistic seeded data so all new Phase 14/16 endpoints are covered.

---

## 2026-06-15 - Gas flow drill-down panel (Phase 17)

Clicking a country on the ENTSOG physical flows overlay now opens a dedicated `GasFlowPanel`
instead of the storage panel. The panel shows: net / entry / exit stat strip (latest day),
30-day rolling average of net flow, a 3M/1Y/all time-window toggle, a stacked entry/exit
bar chart, and a net-flow line chart with a 30-day average reference line. History comes
from the existing `GET /api/gas/flows/{cc}` endpoint (365 days). The storage `CountryPanel`
is still shown when flows mode is off.

Implementation: new `GasFlowPanel.tsx` component; `GasFlowsLayer.tsx` and `GasMap.tsx` gained
optional `onSelectFlow` prop so clicks route to a separate `selectedFlow` state; `gas.tsx`
conditionally renders the flow panel vs storage panel based on `showFlows` + `selectedFlow`.

---

## 2026-06-15 - Price heatmap, computeCarbonIntensity refactor, data bug fixes

**Price heatmap** (zone panel) - 8-day x 24-hour color grid showing DA prices.
Rows = last 8 days newest-at-top, columns = hours 0-23, each cell uses `powerPriceColor`
with a hover tooltip. Sub-hourly ENTSO-E 15-min data is averaged to hourly. Shows weekend
dips, morning ramps, and midday solar troughs immediately.

**computeCarbonIntensity refactor** - moved from EuroMap.tsx to scales.ts next to
EMISSION_FACTORS. Added 19 new vitest tests; total 46 green.

---

## 2026-06-15 - Fix power_daily column order bug and neg_hours counting

Two bugs in `_daily_agg` introduced when `offpeak_eur` was added to the schema: (1) the
Series key order did not match the DuckDB table column order, so `min_eur`, `max_eur`,
`day_range_eur`, and `neg_hours` were stored in the wrong columns (neg_hours was storing
max price ~110-187; day_range_eur was storing the raw minimum ~-53); (2) neg_hours counted
raw rows, not distinct clock-hours, so 15-min data returned 4x too many negative hours.

Fixed by reordering Series keys to match schema and switching to
`dt.floor("h").nunique()` for neg_hours. INSERT is now explicit by column name.
DE-LU 2026-06-13: neg_hours=11 (was 110), day_range_eur=163.48 (was -52.99).

---

## 2026-06-15 - Carbon intensity metric, offpeak in chart, dead code removal

**Carbon intensity choropleth** - new map metric under Generation. Colors each zone by
gCO2eq/kWh computed from the ENTSO-E A75 fuel mix using IPCC AR6 lifecycle median emission
factors (coal 820, oil 650, gas 490, biomass 230, solar 45, geothermal 38, hydro 24, nuclear 12,
wind 11). Scale: deep green (< 50, nuclear/hydro/wind dominated) to red (> 500, coal-heavy).
Tooltip shows gCO2/kWh. EU weighted average appears in the stat strip. Zone panel header shows
per-zone carbon intensity alongside RE%. Pure frontend computation from existing GenMapItem data.

**Offpeak in daily price chart** - offpeak_eur was already computed and stored in power_daily
by refresh.py but was never returned by the API or displayed. Added to PowerDailyPoint schema,
SQL query, and plotted as an indigo dashed line alongside base (sky) and peak (amber).

**Dead code removal** - deleted 6 component files (GenMap, ZoneGenPanel, PowerMap, ZonePanel,
CongestionLayer, FlowArrowsLayer) that were all superseded by the unified EuroMap +
UnifiedZonePanel + InterconnectionLayer introduced in the /power merge. No remaining imports.

---

## 2026-06-15 - Merge /power and /generation into unified /map page

Merged the two separate European choropleth pages into a single /map page, matching
the industry-standard approach (Electricity Maps, ENTSO-E transparency). One map, six
metric modes in the right-panel toggle grouped by type:

- Prices section: Price (EUR/MWh), Range (intraday), Neg hrs, 2yr rank
- Generation section: Renewable %, Dominant fuel

Clicking any zone opens a unified UnifiedZonePanel showing price stats, 48h price
chart, fuel breakdown grid, 24h stacked gen mix, daily fuel+RE% ComposedChart, and
daily price range - all in one scrollable view. Tooltip always shows price + RE% +
top-3 fuel colored dots regardless of active metric. Date picker appears only when a
generation metric is active.

/power and /generation now redirect to /map. Nav shrinks from 6 to 5 tabs.

Fixed stale-ref tooltip bug from old GenMap/PowerMap: now uses `powerRef`/`genRef`
so hover tooltips always read current data instead of the empty snapshot captured
at layer-creation mount time.

**Artifacts:** `EuroMap.tsx` (unified choropleth, MapMetric type, ref-based tooltip),
`UnifiedZonePanel.tsx` (merged price+gen panel), `map.tsx` (new route), `power.tsx`
and `generation.tsx` (now redirects), `__root.tsx` (nav update, Map icon).

---

## 2026-06-15 - Phase 13: Dominant-fuel choropleth + full fuel breakdown on /generation

**Tried:** Expose all 10 ENTSO-E A75 fuel types through the generation map API and ZoneGenPanel,
adding a "Dominant fuel" choropleth mode that colors each zone by its largest generation source.

**Found:** All fuel data was already in `generation_daily` and `generation_latest` in DuckDB;
the gap was purely in the API (GenMapItem only exposed 5 of 10 fuels) and the frontend
(ZoneGenPanel daily chart only had renewable % as a line). The `ComposedChart` dual-Y-axis
approach (MW stacked areas left, renewable % line right) works well in recharts with `yAxisId`
routing. Dominant fuel coloring makes the nuclear dominance of FR and the hydro character
of the Nordic zones immediately visible.

**Decision:** Two-button metric selector (Renewable % / Dominant fuel) with a context-aware
legend, tooltip top-3 fuel list, and ZoneGenPanel fuel breakdown grid replacing the stat boxes.
The fuel breakdown sorts dominant fuel first, then by MW. Renewable % white line overlaid on
the stacked daily chart gives the signal-vs-structure view in one panel.

**Artifacts:** `GenMap.tsx` (GenMetric type, dominantFuelColor dispatch, enriched tooltip),
`generation.tsx` (metric toggle, context stat strip, dual legend), `ZoneGenPanel.tsx`
(fuel breakdown grid, ComposedChart dual-axis trend), `scales.ts` (FUEL_PALETTE,
dominantFuelColor), `api.ts` + `schemas.py` (5 new fuel columns in GenMapItem,
5 new in GenDailyPoint). 36 backend tests green.

---

## 2026-06-14 - Phase 11: Clickable interconnections layer on /power

**Tried:** Replace the separate "Flows" and "Congestion" map toggles with a single unified
"Interconnections" layer; make border lines clickable to open a history panel.

**Found:** Merging the two overlays eliminated the awkward dual-toggle UX and reduced state
complexity. `InterconnectionLayer.tsx` draws undirected border lines colored by
max(utilization_pct) across both directed pairs, with flow-direction arrows sized to
|net_flow_mw| at the 60% point. `BorderPanel` shows directed DirBox stats for A->B and B->A,
a net-flow direction indicator, and a historical utilization LineChart with 80%/100% reference
lines. `selectedBorder` and `selectedZone` are mutually exclusive - the side panel serves both.

**Decision:** Single "Interconnections" toggle is the right abstraction. Flow direction and
congestion level belong on the same line object, not separate layers. Carry `BorderKey`
(undirected pair) as the selection primitive.

**Artifacts:** `InterconnectionLayer.tsx` (new), `BorderPanel.tsx` (new); `power.tsx` refactored.

---

## 2026-06-14 - Phase 10: Power map enrichment - intraday range, neg-price hours, 2yr rank

**Tried:** Add three derived price metrics to the power choropleth as toggleable map layers:
intraday range (max-min hourly), negative-price hours count, and 2-year percentile rank.

**Found:** All three computed cleanly from existing `power_prices` hourly data in
`analytics/power.py`. The 4-button metric selector (Price / Range / Neg hrs / 2yr rank) with
dedicated color scales (`dayRangeColor`, `negHoursColor`, `pctRankColor`) gives a materially
richer picture than price alone - negative hours in particular is a useful battery dispatch
signal. ZonePanel daily chart upgraded to a ComposedChart with shaded min/max band.
conftest DDL needed updating to 9-column power tables after the schema expansion.

**Decision:** All three metrics kept; they answer different questions and have distinct scales.
The toggleable-layer pattern (single state variable, color-dispatch function) is the right
pattern for future map enrichment.

**Artifacts:** `scales.ts` - 3 new color functions; `power.tsx` - metric selector + METRIC_LEGENDS.

---

## 2026-06-14 - Phase 12: Full generation mix with nuclear via ENTSO-E A75

**Tried:** Replace Rebase Grid API (omits nuclear) with ENTSO-E A75 actual generation
(`fetch_generation_full`, one API call per zone per month returning all 20 PSR fuel types).
Backfilled 6 zones (DE-LU, FR, BE, NL, AT, CH) from 2021-01 with a 429 retry/backoff loop.

**Found:** Root cause of 0-rows-inserted was a column label mismatch: `_parse_gen_full()` extracted
`[:3]` from MultiIndex level-0 labels expecting PSR codes ("B04") but entsoe-py maps through
`PSRTYPE_MAPPINGS` so actual labels are display names ("Fossil Gas"). Every lookup missed.
Fixed by adding `_PSR_NAME_TO_TECH`. FR nuclear now 34,036 MW (was 0 due to Rebase gap; total
jumped from 11.8 GW to 50.5 GW). 5.5M rows inserted across 6 zones in ~1h with backoff.
conftest had a 15-vs-14 placeholder mismatch that broke all 36 tests; fixed alongside.
`ZoneGenPanel` on /generation still had hardcoded "unknown" key - fixed to nuclear/other.

**Decision:** ENTSO-E A75 is the canonical source for all generation mix data. Rebase Grid API
dropped entirely. Both /power zone panel and /generation zone panel now show nuclear correctly.
Phase 13 planned: expose the full 10-fuel breakdown in the /generation choropleth (dominant-fuel
mode) and replace the renewable-% line trend with a stacked fuel area chart.

**Artifacts:** `fetchers/entso_e.py` - `_PSR_NAME_TO_TECH`, `_is_rate_limit()`, retry logic in
`fetch_generation_full()`; `analytics/generation.py` rewritten; 10-fuel DDL in `refresh.py`,
`schemas.py`, `main.py`; `ZoneGenPanel.tsx` fuel legend fixed; 36 tests green.

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
