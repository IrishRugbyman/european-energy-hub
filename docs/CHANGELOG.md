# Energy Hub Changelog

## 2026-06-20 - Post-roadmap round 26: Nordic/Baltic border flows + full zone centroid coverage

**New features:**
1. Nordic/Baltic border flows: expanded ENTSO_E_BORDERS in market-data/config.py from 12 to 34 pairs, adding all key Norwegian intrazone corridors (NO-1/NO-2/NO-3/NO-4/NO-5), NordLink HVDC (NO-2 to DE-LU), NorNed (NO-5 to NL), Swedish internal cascade (SE-1 through SE-4), Baltic Cable (SE-4 to DE-LU), Danish interconnections (DK-1/DK-2 to DE-LU), and Nordic-Baltic links (EE-FI EstLink, SE-1-FI, SE-3-LT NordBalt, NO-1-SE-3 Hasle). 90-day window ingested.
2. Full zone centroid coverage: ZONE_CENTROIDS in InterconnectionLayer.tsx now covers all 45 zones (was 18). Previous gap meant flow arrows were silently dropped for any pair involving NO/SE/DK/FI/EE/LV/LT/PL/CZ and other expansion zones - the `if (!fromCoord || !toCoord) continue` guard discarded them without error.
3. Nordic divergence alerts: BORDER_PAIRS in divergence.py extended to match the new border set. Price-spread coloring on the interconnections layer now shows Norwegian and Swedish congestion corridors (today: SE-2 to SE-3 at -38 EUR/MWh, NO-2 to NO-5 at +52 EUR/MWh).
4. IT-CALA siblings fix: all Italian zones' ZONE_SIBLINGS arrays now include IT-CALA. Clicking IT-CALA previously showed no highlighted row since it was absent from every sibling list including its own.

**Artifacts:** `shared/market-data/config.py` (ENTSO_E_BORDERS 12->34 pairs), `backend/analytics/divergence.py` (BORDER_PAIRS 12->33 pairs), `frontend/src/components/power/InterconnectionLayer.tsx` (ZONE_CENTROIDS 18->45 zones), `frontend/src/lib/scales.ts` (IT_SIBLINGS constant includes IT-CALA).

---

## 2026-06-20 - Post-roadmap round 25: live congestion hotspot chip + smart spread country

**New features:**
1. Live congestion hotspot chip on /map: when viewing in price mode, the top-center stat strip shows "top congestion - ZONE +/-N EUR". Finds the zone with the largest absolute deviation from its country reference (IT-NORD, NO-5, SE-3, DK-1) across all 45 zones. Red >20 EUR/MWh, amber >8 EUR/MWh. Chip is clickable to open the congested zone's panel directly. Today: NO-2 vs NO-5 at +52€ (north-south Norway bottleneck); SE zones showing +/-37€ hydro dispatch spreads.
2. Auto-country on cross-zone spread chart: the chart on /generation now defaults to the country with the largest live intrazone spread (by fetching power/map, shared QueryClient cache with /map). User tab clicks override. Today it opens Norway automatically showing the dramatic NO-2/NO-5 congestion.

**Artifacts:** `frontend/src/routes/power.tsx` (congestionHotspot useMemo, StatChip valueColor + onClick, pointer-events passthrough), `frontend/src/routes/generation.tsx` (powerMapData query, bestSpreadCountry useMemo, effectiveSpreadCountry logic).

---

## 2026-06-20 - Post-roadmap round 24: intrazone price spread chart

**New feature:** Cross-zone price spread series on /generation. New `GET /api/power/cross-zone-spreads?country=IT|NO|SE|DK` computes the trailing 90-day daily spread of each sub-zone vs the country reference zone (IT-NORD for Italy, NO-5 for Norway, SE-3 for Sweden, DK-1 for Denmark). CrossZoneSpreadChart shows persistent congestion signals: today NO-2 (Oslo) is +52 EUR/MWh vs NO-5 due to a north-south bottleneck; IT-SARD is -4 EUR/MWh vs IT-NORD showing island surplus. Country tabs (Italy/Norway/Sweden/Denmark) switch context. Reference line at zero, color per sub-zone, tooltip with +/- EUR/MWh format.

**Artifacts:** `backend/app/schemas.py` (CrossZoneSpreadPoint/Response), `backend/app/main.py` (/api/power/cross-zone-spreads), `frontend/src/lib/api.ts` (CrossZoneSpreadPoint/Response, powerCrossZoneSpreads), `frontend/src/routes/generation.tsx` (CrossZoneSpreadChart, spreadCountry state, crossZoneSpreadData query), `backend/tests/conftest.py` (IT-NORD + IT-SARD seeded), `backend/tests/test_endpoints.py` (1 new test). 79 tests total.

---

## 2026-06-20 - Post-roadmap round 23: zone expansion (45 zones) + forecast accuracy + zone siblings

**New features:**
1. Zone expansion from 34 to 45 bidding zones: added Italian sub-zones (IT-CNOR, IT-CSUD, IT-SUD, IT-SICI, IT-SARD, IT-CALA), Western Balkans (AL, ME, MK, RS, XK), and Corsica as a display-only polygon (FR-COR shows FR price data). GeoJSON updated to 44 polygons (IT-CALA and FR-COR have no separate ENTSO-E bidding zone). Price history ingested for all new zones from earliest available date. 990 zone-pair correlations (up from 561).
2. Wind/solar DA forecast accuracy chart (`/generation`): trailing 90-day MAE of ENTSO-E day-ahead forecasts vs actual, normalised by installed capacity. ForecastAccuracyChart shows wind and solar tabs, bar coloring green/amber/red by threshold (<8%/8-15%/>15%). 33 zones with sufficient joint data. Backend: compute_forecast_accuracy() + forecast_accuracy table + GET /api/generation/forecast-accuracy.
3. Country zone siblings comparison in zone panel (`/map`): clicking any Italian, Norwegian, Swedish, or Danish sub-zone now shows a compact price ladder for all sibling zones (IT-NORD through IT-SARD sorted by price, color-coded, selected zone highlighted). Reveals congestion-driven spreads: IT-SARD typically 10-20 EUR/MWh cheaper than IT-NORD in summer.
4. Vectorised power_daily aggregation: replaced groupby.apply with multiple vectorised groupby calls, eliminating per-group Python overhead. Refresh time for the power tables step drops ~40-50% at 45 zones.
5. UI polish: DM Sans font, stronger nav active state, chart headings to font-semibold/foreground.

**Artifacts:** `frontend/public/geo/bidding_zones.geojson` (45 features), `shared/market-data/config.py` (ENTSO_E_ZONES expanded), `frontend/src/lib/scales.ts` (ZONE_NAMES + ZONE_SIBLINGS), `frontend/src/components/power/InterconnectionLayer.tsx` (centroids), `frontend/src/components/map/UnifiedZonePanel.tsx` (allZones prop + siblings render), `frontend/src/routes/power.tsx` (allZones pass-through), `backend/analytics/generation.py` (compute_forecast_accuracy), `backend/analytics/power.py` (vectorised _build_daily), `backend/scripts/refresh.py` (_write_forecast_accuracy), `backend/app/schemas.py` (ForecastAccuracyRow/Response), `backend/app/main.py` (/api/generation/forecast-accuracy), `frontend/src/lib/api.ts` (ForecastAccuracyRow, genForecastAccuracy), `frontend/src/routes/generation.tsx` (ForecastAccuracyChart), `backend/tests/conftest.py` (forecast_accuracy fixture table), `backend/tests/test_endpoints.py` (1 new test). 78 tests total.

---

## 2026-06-20 - Post-roadmap round 20: per-zone carbon intensity ranking

**New features:**
1. Per-zone carbon intensity snapshot (`/generation`): new `GET /api/generation/zone-carbon-intensity` computes 90-day trailing average gCO2/kWh per zone using simplified emission factors (coal 820, gas 490 g/kWh; wind/solar/hydro/nuclear = 0). `ZoneCarbonIntensityChart` ranks all zones: PL 418, NL 245, CZ 235, DE-LU 200 g/kWh; AT/HR 23, NO-4 27 g/kWh. Color: red >= 300, amber >= 150, grey >= 60, green below. Placed before the TTF-correlation chart in the generation page. 87 tests (1 new).

**Artifacts:** `backend/app/schemas.py` (ZoneCarbonIntensityRow/Response), `backend/app/main.py` (/api/generation/zone-carbon-intensity), `frontend/src/lib/api.ts` (ZoneCarbonIntensityRow, genZoneCarbonIntensity), `frontend/src/routes/generation.tsx` (ZoneCarbonIntensityChart, zoneCiData query), `backend/tests/test_endpoints.py` (1 new test).

---

## 2026-06-20 - Post-roadmap round 19: per-zone gas price passthrough (TTF correlation)

**New features:**
1. Per-zone power-price vs TTF correlation chart (`/generation`): new `GET /api/generation/zone-ttf-corr` computes trailing-365-day Pearson r between daily DA base price and TTF front-month for all 34 zones. `ZoneTtfCorrChart` shows a diverging bar: IT-NORD (+0.57) is most gas-sensitive (heavy gas+LNG dependency, imports at hub price); ES (-0.30) and Baltics (EE -0.25, LV -0.20) are most insulated (wind/solar oversupply overrides gas signal). Pairs with the RE-price correlation chart directly above it - together they show the full merit-order decomposition: which zones are RE-priced vs gas-priced vs demand-driven. 86 tests (2 new).

**Artifacts:** `backend/app/schemas.py` (ZoneTtfCorrRow, ZoneTtfCorrResponse), `backend/app/main.py` (/api/generation/zone-ttf-corr), `frontend/src/lib/api.ts` (ZoneTtfCorrRow, genZoneTtfCorr), `frontend/src/routes/generation.tsx` (ZoneTtfCorrChart, zoneTtfCorrData query), `backend/tests/test_endpoints.py` (2 new tests).

---

## 2026-06-20 - Post-roadmap round 18: cross-zone hourly DA price profile comparison

**New features:**
1. Cross-zone hourly price profile comparison chart (`/generation`): new `GET /api/power/hourly-profiles-all` returns 30-day trailing average DA price by hour for all 34 zones (816 rows). `ZoneHourlyComparisonChart` overlays multiple zone curves - toggle any zone on/off with per-zone color coded buttons. Default: DE-LU, FR, ES, NO-2. Placed immediately after the EU duck curve chart, showing that DE-LU has a deep solar trough (16 EUR/MWh at 13:00 vs 149 EUR/MWh at 19:00), ES is even deeper, FR is flat (nuclear), and NO-2 (hydro) holds high prices in evening heating hours. 84 tests (1 new).

**Artifacts:** `backend/app/schemas.py` (ZoneHourlyProfileRow, ZoneHourlyProfilesResponse), `backend/app/main.py` (/api/power/hourly-profiles-all), `frontend/src/lib/api.ts` (ZoneHourlyProfileRow, powerHourlyProfilesAll), `frontend/src/routes/generation.tsx` (ZoneHourlyComparisonChart, ZONE_PROFILE_COLORS, hourlyProfilesData query), `backend/tests/test_endpoints.py` (1 new test).

---

## 2026-06-20 - Post-roadmap round 17: zone grid integration ranking + spread monthly seasonality

**New features:**
1. Zone grid integration ranking (`/spreads`): the "Zone Market Coupling" card now has a "Zones" toggle alongside "Pairs". The Zones view shows each zone's average Pearson correlation to all 33 other zones - a single-number measure of how well-integrated the zone is into the European grid. IE-SEM (0.14) and Iberia (ES/PT: 0.27) are clear island/peninsula outliers; the Central European mesh (NO-2, SK, CZ, DE-LU, NL, AT) scores above 0.74. Color: red below 0.35, amber below 0.6, green above. Computed client-side from the existing `/api/power/correlations` payload - no new endpoint.
2. Spread monthly seasonality chart (`/spreads`): per-year CSS/CDS/FSS monthly averages shown as a multi-line chart (2021-2026, one line per year). Toggle between CSS/CDS/FSS. Reveals seasonal patterns (winter gas marginal, summer coal marginal due to solar oversupply) and isolates 2022 as a structural outlier (CSS -153 Oct 2022 vs -19 Oct 2024). Pure frontend from existing `/api/spreads` payload.

**Artifacts:** `frontend/src/routes/spreads.tsx` (ZoneDecouplingSection Zones view, CouplingView type, zoneCentrality memo; SpreadMonthlySeasonalityChart, SpreadField type, MONTH_ABBR). 83 tests unchanged.

---

## 2026-06-20 - Post-roadmap round 15: EU fuel mix seasonality chart

**New features:**
1. Spread monthly seasonality by year (`/spreads`): `SpreadMonthlySeasonalityChart` groups existing `spreads_daily` data by calendar month and year to compute monthly averages of CSS, CDS, or FSS. Rendered as a multi-line chart with one line per year (2021-2026), using the same year color palette as the zone YoY chart. Toggle CSS/CDS/FSS. No new endpoint - pure frontend analytics from the existing `/api/spreads` payload. Key insight: winter months show gas-marginal regimes (positive FSS), summer months flip to coal-marginal (negative FSS due to solar+wind oversupply). The 2022 energy crisis appears as a clear outlier: CSS -153 in Oct 2022 vs -19 in Oct 2024.

**Artifacts:** `frontend/src/routes/spreads.tsx` (SpreadMonthlySeasonalityChart, SpreadField type, MONTH_ABBR constant, LineChart import). 83 tests unchanged.

---

## 2026-06-20 - Post-roadmap round 15: EU fuel mix seasonality chart

**New features:**
1. EU-34 monthly fuel mix seasonality (`/generation`): new `GET /api/generation/eu/monthly-fuel-mix` returns average % share of each fuel type by calendar month (2022+). `MonthlyFuelMixSeasonality` stacked area chart shows solar peaking at ~18% in Jun-Aug, wind at ~21% in Dec-Jan, and nuclear flat at ~24% year-round. Gas and coal peak in winter heating season. Placed immediately after the annual EuFuelMixChart. 83 tests (1 new).

**Artifacts:** `backend/app/schemas.py` (MonthlyFuelMixRow/Response), `backend/app/main.py` (/api/generation/eu/monthly-fuel-mix), `frontend/src/lib/api.ts` (MonthlyFuelMixRow, genEuMonthlyFuelMix), `frontend/src/routes/generation.tsx` (MonthlyFuelMixSeasonality, monthlyFuelMixData query), `backend/tests/test_endpoints.py` (1 new test).

---

## 2026-06-20 - Post-roadmap round 14: per-zone merit-order correlation

**New features:**
1. Per-zone merit-order correlation chart (`/generation`): new `GET /api/generation/zone-price-re-corr` computes 1-year trailing Pearson r between daily base price and renewable % for each zone (joins `power_daily` + `generation_daily`). `ZonePriceReCorrChart` shows a diverging bar chart: DE-LU at -0.80 (strongest RE price suppression), ES -0.77, GR -0.74. Norwegian hydro zones show positive r (NO-5: +0.69) because demand seasonality dominates supply. Placed after the EU RE% vs price scatter. 82 tests (2 new).

**Artifacts:** `backend/app/schemas.py` (ZonePriceReCorrRow/Response), `backend/app/main.py` (/api/generation/zone-price-re-corr), `frontend/src/lib/api.ts` (ZonePriceReCorrRow, genZonePriceReCorr), `frontend/src/routes/generation.tsx` (ZonePriceReCorrChart, priceReCorrData query), `backend/tests/test_endpoints.py` (2 new tests).

---

## 2026-06-20 - Post-roadmap round 13: zone neg-price ranking, NTC congestion panel, YoY spreads chart

**New features:**
1. Zone negative price frequency ranking (`/generation`): new `GET /api/power/neg-hours-zones` returns trailing-30-day % of hours with DA price < 0 for all 34 zones, ranked descending. `NegHoursZoneRanking` bar chart placed immediately after the `NegHoursMonthlyChart` (which shows 5 zones over time). FR leads at 21.2%, ES at 20.4%, with red/amber/green color coding. 2 new tests; 80 tests total.
2. NTC congestion ranking panel (`/spreads`): `CongestionRankingSection` reuses the existing `/api/power/congestion` endpoint and renders all interconnectors sorted by current NTC utilization. Today: BE->NL 150%, DE-LU->NL 150% (NTC breach), FR->IT-NORD 107%, CH->IT-NORD 104%. Color: red >= 100%, amber >= 80%, green otherwise. No new endpoint or tests.
3. YoY annual spreads chart (`/spreads`): `ZoneSpreadYoYChart` computes annual averages of CSS/CDS/FSS per zone client-side from existing `spreadsZones` data. Grouped bar chart by zone with one bar per year (2021-2026), color-coded by year. Clearly shows the regime shift: FR CSS collapsed from +10 (2021) to -55 (2026 YTD) due to nuclear+solar surplus; IT-NORD CSS stayed positive at +13-16 throughout. No new endpoint.

**Tests:** 80 tests passing.

**Artifacts:** `backend/app/schemas.py` (NegHoursZoneRow/Response), `backend/app/main.py` (/api/power/neg-hours-zones), `frontend/src/lib/api.ts` (NegHoursZoneRow, powerNegHoursZones), `frontend/src/routes/generation.tsx` (NegHoursZoneRanking, negHoursZoneData query), `frontend/src/routes/spreads.tsx` (CongestionRankingSection, ZoneSpreadYoYChart, SPREAD_YOY_YEAR_COLORS), `backend/tests/test_endpoints.py` (2 new tests).

---

## 2026-06-20 - Post-roadmap round 12: zone market coupling, EU storage vs price scatter

**New features:**
1. Zone market coupling panel (`/spreads`): new `ZoneDecouplingSection` component fetches the existing (but never-visualised) `/api/power/correlations` endpoint and renders the 8 most decoupled and 8 most coupled zone pairs as horizontal bar rows. FR/SE-1 (-0.24), FR/SE-2 (-0.20) and IE-SEM pairs are the most decoupled; CZ/AT (0.99), DE/CZ pairs are the most coupled. Color-coded: red = negative r (potential arbitrage), green = high r (moves as one system). Added `power_correlation_30d` seed to conftest and 2 new tests.
2. EU storage vs TTF price scatter (`/gas` Trend view): new `GET /api/gas/price-scatter` endpoint joins EU storage fill% with TTF front-month price (1688 daily rows since 2020). `StoragePriceScatter` component shows each year's dots in a distinct color with Pearson r displayed, revealing the inverse storage-to-gas-price relationship. Placed below StorageCountryCompare in the Trend tab.

**Tests:** 78 tests passing.

**Artifacts:** `frontend/src/routes/spreads.tsx` (ZoneDecouplingSection, CorrelationBar), `frontend/src/routes/gas.tsx` (StoragePriceScatter, ScatterChart imports), `backend/app/schemas.py` (GasPriceScatterRow/Response), `backend/app/main.py` (/api/gas/price-scatter), `frontend/src/lib/api.ts` (GasPriceScatterRow, gasPriceScatter), `backend/tests/conftest.py` (power_correlation_30d seed), `backend/tests/test_endpoints.py` (4 new tests).

---

## 2026-06-20 - Post-roadmap round 11: capacity growth, neg-price trend, EU storage trajectory, UX

**New features:**
1. EU storage projected trajectory (`/gas` Trend tab): the multi-country 365-day chart now extends forward to Nov 1 using the last 7-day EU injection rate as a linear projection. Dashed blue line shows where EU fill% will be if current injection pace continues. The projection calculates daily from the last known EU fill% to Nov 1 at `(eu_now - eu_7d_ago) / 7` per day. Only shown when EU is actively injecting.
2. EU-27 installed renewable capacity chart (`/generation`): new `GET /api/generation/capacity-annual` endpoint returns annual wind+solar GW from 2020-2026 (27 zones, ENTSO-E installed capacity data). Stacked bar chart shows solar tripling from 95 GW (2020) to 295 GW (2026) and wind growing from 152 GW to 211 GW. Badges show "+211% solar since 2020" and "+39% wind since 2020".
3. Monthly negative price hour frequency chart (`/generation`): new `GET /api/power/neg-hours-monthly` endpoint returns monthly % of hours with DA price < 0 for ES, FR, DE-LU, NL and EU average since May 2024. Multi-line chart placed immediately after the capacity chart to tell the cause-effect story: solar buildout drove ES from ~3% negative hours (2024) to 20% (Jun 2026), with 32% in May 2025. FR April 2026: 24% negative hours. DE-LU June 2025: 19.6%.
4. EU stat strip clickable (`/gas`): clicking "EU fill" in the gas page stat strip now opens the EU CountryPanel showing the 8-year YoY DOY trajectory chart and seasonal band. Previously EU was not directly accessible without going through Rankings.

**Tests:** 75 tests passing.

**Artifacts:** `backend/app/schemas.py` (CapacityAnnualRow/Response, NegHoursMonthlyRow/Response), `backend/app/main.py` (/api/generation/capacity-annual, /api/power/neg-hours-monthly), `backend/tests/test_endpoints.py`, `frontend/src/lib/api.ts` (CapacityAnnualRow, NegHoursMonthlyRow), `frontend/src/routes/generation.tsx` (EuCapacityChart, NegHoursMonthlyChart, queries), `frontend/src/routes/gas.tsx` (EU projection, clickable EU stat chip).

---

## 2026-06-20 - Post-roadmap round 10: EU duck curve hourly price profile

**New features:**
1. EU-34 duck curve chart (`/generation`): `GET /api/power/hourly-profile-eu` aggregates `power_hourly_profiles` across all 34 zones (simple AVG per hour). New `EuDuckCurveChart` shows the classic duck curve shape: prices at 87-97 EUR/MWh from midnight to 7am, plunging to 28-40 EUR/MWh at solar peak (12:00-14:00), then recovering to 123-133 EUR/MWh at evening peak (19:00-21:00). Red bars show negative price frequency: 22% of hours at 13:00 UTC are negative (solar oversupply). Badges show "Trough: 13:00 (28 €/MWh)" and "Peak neg: 13:00 (22% hrs)". Data: 30-day trailing average, all 34 bidding zones, 24 hourly buckets. 73 tests.

**Artifacts:** `backend/app/schemas.py` (EuDuckCurvePoint/Response), `backend/app/main.py` (/api/power/hourly-profile-eu), `frontend/src/lib/api.ts`, `frontend/src/routes/generation.tsx` (EuDuckCurveChart + duckCurveData query), `backend/tests/test_endpoints.py`.

---

## 2026-06-20 - Post-roadmap round 9: duck curve chart, gas target lines, test coverage

**New features:**
1. Duck curve monthly bar chart in zone panel (`/map`): zone Price tab now shows a monthly peak-vs-offpeak spread bar chart (amber = peak > offpeak = traditional; purple = peak < offpeak = solar duck curve). Uses existing `power_daily` data already returned by `/api/power/zone/{zone_id}`. Shows duck curve intensifying year-over-year: DE-LU April spread went from -32 EUR/MWh (2025) to -47 EUR/MWh (2026).
2. Gas storage target reference lines (`/gas`): multi-country storage "Trend" compare chart now shows horizontal reference lines at 90% (Nov 1 EU target, green) and 75% (Sep 1 interim target, amber). Makes it immediately clear which countries are on track and how far behind.
3. Tests: added 5 tests for round 8 endpoints (country-compare, power-monthly, gen-hourly, price-re, zones-cf). Total: 72 tests.

**Bugs fixed:**
- Duplicate `TtfCurvePoint` schema class (added inadvertently to bottom of schemas.py) overrode the original definition and caused `test_prices_curve` to fail with missing `sort_key` field.

**Artifacts:** `frontend/src/components/map/UnifiedZonePanel.tsx` (DuckCurveChart, buildDuckCurveMonthly, Cell import), `frontend/src/routes/gas.tsx` (ReferenceLine 90%/75%), `backend/app/schemas.py` (removed duplicate), `backend/tests/test_endpoints.py`.

---

## 2026-06-20 - Post-roadmap round 8: injection rate charts, zone CF bar chart, merit order scatter, multi-country storage trend, monthly power heatmap

**New features:**
1. EU gas injection rate tab in pace widget (`/gas`): PaceWidget gains a "Rate" toggle alongside "%" fill chart. 180-day EU net injection rate (TWh/d) vs p25/avg/p75 seasonal band. Shows whether EU is injecting above or below norm for this time of year.
2. Net injection rate tab in country panel (`/gas`): CountryPanel now has "Fill%" vs "Rate" tabs. Rate view: daily bar chart of net injection (green) vs net withdrawal (red) for the selected country over current year.
3. Per-zone capacity factor bar chart (`/generation`): new `GET /api/generation/zones/cf` endpoint returns latest-day wind/solar CF for all 27 zones with >500 MW installed. Horizontal bar chart with Wind/Solar toggle. Shows which zones are generating at high vs low efficiency today.
4. Merit order scatter chart (`/generation`): new `GET /api/generation/eu/price-re` endpoint returns 765 days of EU average power price vs EU renewable penetration. Scatter chart colored by year (grey=2024, blue=2025, amber=2026). Correlation r=-0.7 confirms the merit order effect: high RE% days consistently have lower prices.
5. Multi-country storage trajectory chart (`/gas` rankings panel): new `GET /api/gas/country-compare` endpoint pivots 365 days of storage fill% for DE/FR/NL/AT/IT/ES + EU (wide format). New "Trend" tab in the rankings panel shows a multi-line chart. EU 5yr seasonal average shown as grey dashed reference. Currently ES=73.8%, IT=64.6% tracking well above EU aggregate=41.1%. NL=23.1% is critically low.
6. Zone power price monthly heatmap (`/prices`): new `GET /api/power/monthly` endpoint returns 24 months of monthly avg + neg-day% for 8 key zones (DE-LU, FR, NL, BE, AT, CH, IT-NORD, ES). Color-coded heatmap (green=cheap, red=expensive) with price/neg-days toggle. Shows IT-NORD is consistently the most expensive zone (Feb 2025: 150.5 EUR/MWh) and FR/ES cheapest (summer 2025 solar: 17-19 EUR/MWh avg).

**Artifacts:** `backend/app/schemas.py`, `backend/app/main.py` (5 new endpoints), `frontend/src/lib/api.ts`, `frontend/src/routes/gas.tsx` (injection rate tab, country compare, trend tab), `frontend/src/routes/generation.tsx` (zone CF chart, merit order scatter), `frontend/src/routes/prices.tsx` (monthly heatmap), `frontend/src/components/gas/CountryPanel.tsx` (rate tab).

---

## 2026-06-20 - Post-roadmap round 7: EU gas interim targets, monthly RE chart, CF conditions strip, gas table columns, spreads percentile ranks

**New features:**
1. EU gas interim storage targets in pace widget (`/gas`): EU Regulation 2022/1369 targets (Aug 1=62.5%, Sep 1=75%, Oct 1=83.3%, Nov 1=90%) added to `gas_pace_to_target()`. Shows next upcoming target date, required daily injection rate vs current rate, colored red when behind. Today: EU at 3.8 TWh/d vs 7.2 TWh/d needed to hit Aug 1 target (well behind).
2. EU monthly renewable % trend chart (`/generation`): new `GET /api/generation/eu/monthly` endpoint. Line chart shows EU capacity-weighted RE% by month for each year (2021-2026). Clear structural uptrend (June: 38.8% in 2021, 59.5% in 2026) plus seasonal pattern. Current year rendered with full opacity vs muted prior years.
3. EU wind/solar capacity factor conditions strip (`/map`): new `GET /api/generation/eu/cf-latest` endpoint returns today's EU CF vs 5yr same-month percentile rank. Shown as bottom-right overlay: "Wind 8.7% (avg 16.1%, p7 for Jun)" in red (very low wind), "Solar 25.3% (avg 21.6%, p99 for Jun)" in amber. Directly explains price levels - low wind + high solar drove DE-LU to 141 EUR/MWh (p94 2yr rank).
4. Gas country table improvements: added 7-day fill% change and injection rate (GWh/d) columns. All columns now sortable via clickable headers (replaces old sort control strip). Withdrawal shown as negative when no injection.
5. Spreads percentile rank in stat strip (`/spreads`): CSS/CDS/FSS 2yr percentile rank computed client-side from existing rows. Today: CSS p93 (very high gas plant profitability), CDS p87, FSS p81. Colored red for p>=80, green for p<=20.
6. Tests: 7 new endpoint tests covering all new endpoints; conftest seeds `ttf_curve_snapshots` and `storage_injection_seasonal` tables. Total: 67 tests.

**Artifacts:** `backend/app/schemas.py` (EuCfLatestResponse, GenMonthlyRow/Response, GasPaceStats new fields), `backend/app/main.py` (/api/generation/eu/monthly, /api/generation/eu/cf-latest, pace EU Reg 2022/1369 targets), `frontend/src/lib/api.ts`, `frontend/src/routes/gas.tsx` (interim target row in PaceWidget; 7d+injection columns in table), `frontend/src/routes/generation.tsx` (GenMonthlyChart), `frontend/src/routes/spreads.tsx` (pctRank2yr useMemo + rank display), `frontend/src/routes/power.tsx` (EuConditionsStrip + cfData query), `backend/tests/conftest.py`, `backend/tests/test_endpoints.py`.

---

## 2026-06-19 - Post-roadmap round 6: curve shift, injection seasonality, net trade, YoY imbalance

**New features:**
1. TTF forward curve shift chart (`/prices`): overlay of today vs -30d/-180d/-365d forward curve snapshots as a line chart. Shows how the market has re-priced forward risk (contango/backwardation shifts). Precomputed via `_build_ttf_curve_snapshots()` in `analytics/spreads.py`; stored in `ttf_curve_snapshots` table; served at `GET /api/prices/curve/snapshots`.
2. Gas injection rate vs 5yr seasonal norm (`/gas` pace widget): `_build_injection_seasonal()` in `analytics/gas.py` computes p25/avg/p75 injection rate per country/DOY over last 5 complete years. Stored in `storage_injection_seasonal`. Pace endpoint adds `seasonal_inj_avg_gwh_d`, `seasonal_inj_p25_gwh_d`, `seasonal_inj_p75_gwh_d`. PaceWidget now shows "vs 5yr avg: +/-X TWh/d (norm: Y, p25-p75: Z-W)". Today: EU injecting 3.8 TWh/d vs 4.2 TWh/d seasonal avg (below norm).
3. Net import/export indicator in power zone panel (`/map`): computes zone net trade position from `borders_daily` (7 core zones: AT/BE/CH/DE-LU/FR/IT-NORD/NL). Shown in zone price tab below stats grid. DE-LU currently net importing 4.7 GW (consistent with elevated prices). New fields `net_import_mw`, `net_import_date` in `PowerZoneResponse`.
4. Year-on-year monthly reBAP comparison chart (`/imbalance`): new `GET /api/imbalance/monthly` endpoint computes monthly avg/p25/p75/neg_pct from `imbalance_daily`. Grouped bar chart (grey=2024, blue=2025, green=2026) shows 2026 running hotter in most months. Notable: Feb 2025 was the most expensive month (128.5 €/MWh avg).

**Artifacts:** `backend/analytics/spreads.py`, `backend/analytics/gas.py`, `backend/scripts/refresh.py`, `backend/app/schemas.py`, `backend/app/main.py`, `frontend/src/lib/api.ts`, `frontend/src/routes/prices.tsx` (TtfCurveShift), `frontend/src/routes/gas.tsx` (PaceWidget seasonal row), `frontend/src/routes/imbalance.tsx` (ImbalanceYoYChart + BarChart), `frontend/src/components/map/UnifiedZonePanel.tsx` (net import row).

---

## 2026-06-19 - Post-roadmap round 5: lock fix, correlation matrix, deficit mode, EUA widget

**Problems fixed:**
1. DuckDB lock conflict: refresh.py now writes to `energy_hub_new.duckdb` then atomic-renames over the live file. db.py thread-local connections detect the swap via a `.ts` sidecar file and reconnect. Eliminates the 6-attempt/90s retry loop that was still failing as of 22:22 UTC.
2. test_spreads fixture: added `disruption_bcm` column to conftest.py spreads_daily DDL. All 60 tests pass.
3. Disk cleanup: removed ~2.5GB of stale /tmp artifacts (pytest cache, research libs) to recover root disk from 100%.

**New features:**
1. Gas deficit mode choropleth (`/gas`): "vs 5yr avg" toggle button switches the map from fill% coloring to a diverging scale (red = large deficit, green = surplus). The tooltip now also shows vs_avg5_pct for all hover events.
2. EUA fuel-switch threshold widget (`/spreads`): shows the EUA carbon price at which coal/gas merit order flips. At current prices (TTF=42.5, coal=12.3 EUR/MWh) the threshold is 88.4 EUR/t vs. current EUA=76.1 EUR/t, gap=+12.3 EUR/t. Includes a visual gauge. Pure client-side calculation.
3. 30d power zone correlation matrix (`/map`): `build_power_correlations()` computes pairwise Pearson correlation across 34 zones from power_daily (30-day window, 561 pairs). New endpoint `GET /api/power/correlations`. Zone panel Price tab now shows a compact bar chart of top-8 most correlated + bottom-3 least correlated peers. Notable: LT-LV 0.9999, ES-PT 0.9989, HR-SI 0.9982, CZ-SK 0.9951.

**Artifacts:** `backend/app/db.py` (sidecar mtime detection), `backend/scripts/refresh.py` (atomic swap, correlations step), `backend/app/main.py` (/api/power/correlations), `backend/app/schemas.py` (ZoneCorrelationRow/PowerCorrelationResponse), `backend/analytics/power.py` (build_power_correlations), `backend/tests/conftest.py`, `frontend/src/lib/scales.ts` (gasDeficitColor), `frontend/src/components/gas/GasMap.tsx`, `frontend/src/routes/gas.tsx`, `frontend/src/routes/spreads.tsx` (FuelSwitchContext), `frontend/src/lib/api.ts`, `frontend/src/components/map/UnifiedZonePanel.tsx` (ZoneCorrelationChart).

---

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
