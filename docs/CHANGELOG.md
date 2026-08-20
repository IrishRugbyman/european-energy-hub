# Energy Hub Changelog

## Archives

- [2026-Q2](changelog/2026-Q2.md) - 108 entries, 2026-06-12 to 2026-06-28

## 2026-08-19 - Phases 86+87: the /imbalance signal re-framed, NRV-Saldo wired in, the lag surfaced

**Verified before touching anything**: `nrv-saldo-de` had already been fetched into
`market_data.imbalance_prices_de.nrv_mw` on 2026-08-09 (`market-data/docs/CHANGELOG.md`),
so Phase 87's headline data gap was already closed - it just was not read by anything in
this app, and this module's own docstring still said NULL throughout. Confirmed against
the live table: 417,660 of 442,908 rows populated, 2014-01-01 through today (the
operational feed is current to ~yesterday, unlike quality-assured reBAP).

**Feature drop confirmed live, not just from the 2026-07-31 note**: re-checked
`wind_err_lag1` and `solar_err_lag1` against current production data before removing them
- cv 11.10 and 1.28 respectively (vs. `wind_fc_d` 0.28 and `rebap_dev_lag1` 0.33), so the
prior finding held and had if anything gotten worse.

**`nrv_dev_lag1` was chosen over the raw NRV-Saldo level after checking correlations, not
assumed.** The daily mean level correlates with the reBAP *level* (r=0.30) but barely with
the *excess* this model actually predicts (r=0.09) - the level is largely swallowed by the
same detrending the model already does to reBAP itself. Applying the identical
deviation-from-own-5-day-trend transform used for `rebap_dev_lag1` gets r=0.21 against the
excess, matching `rebap_dev_lag1`'s own 0.23, and lifts in-sample R² from 0.128 (2-feature
base) to 0.150. `build_imbalance_tables()` now aggregates a `nrv_mean_mw` column into
`imbalance_daily`; `compute_rebap_signal` computes the deviation from it at request time,
mirroring how `rebap_dev_lag1` is built from `mean_eur` rather than being precomputed.

**The P&L basis fix (Phase 86) is the one that mattered most for how the page reads.**
`compute_rebap_signal` positioned on the predicted *excess* but booked P&L on the *level*,
so the displayed "naive" comparator was an always-positive-reBAP baseline (Sharpe 24.6)
that dwarfed the model's own Sharpe (3.45) despite the model being directionally right
63-64% of the time on the thing it was actually forecasting. Booking on the excess instead
gives `model` Sharpe 3.70 against a `naive_excess` baseline of **-0.44** (always guessing
above-trend loses money net of cost) - the apples-to-apples comparison the accuracy metric
was already implying. The old always-long-the-level number is kept as `structural_long`,
reported separately with copy stating explicitly that it answers a different question and
is not a comparator - both in the API response shape (renamed keys, not a repurposed
`naive`) and in the UI (a dedicated note, not a 5th tile in the stats grid, and left out of
the equity chart entirely so nothing implies it is plottable against `model`).

**Full feature set change**: `[wind_err_lag1, solar_err_lag1, wind_fc_d, rebap_dev_lag1]` →
`[wind_fc_d, rebap_dev_lag1, nrv_dev_lag1]`. Net effect on real data: accuracy 63.0% → 64.3%,
every remaining coefficient's cv under 0.5 (none were before).

**Publication lag**: `/imbalance` now shows "Data through `<date>` (`<N>`d behind real
time)" computed client-side from `imbalance_latest.current_ts` (already in the payload -
no backend change needed), styled as a neutral note rather than the amber staleness
banner, since the ~2-3 week lag is `StaleBanner`'s (48h refresh-pipeline) province a
structural property of quality-assured Netztransparenz data. Checked and confirmed: there
is no lower-latency reBAP series (the fetcher's own docstring already established "no
Betrieblich reBAP endpoint" on 2026-07-26); NRV-Saldo is the one series on this API with a
near-real-time variant, which is exactly why it was worth ingesting even though it cannot
make reBAP itself live.

**Schema drift caught by actually rebuilding, not just running fixture tests**:
`refresh.py:_write_imbalance` carries its own `CREATE TABLE imbalance_daily` DDL,
independent of the DataFrame shape `build_imbalance_tables()` returns. The fixture DB in
`tests/conftest.py` creates the table directly and never exercises this path, so the extra
`nrv_mean_mw` column passed every test and only broke on `scripts/refresh.py
--skip-ingest` (`BinderException: table imbalance_daily has 5 columns but 6 values were
supplied`). Fixed by adding the column to the DDL; the duplication itself is unchanged and
worth remembering next time `imbalance_daily`'s shape moves.

**Verified live**: `energy-api` restarted, `/api/imbalance/signal` serves the new shape at
energy.lbzgiu.xyz; frontend rebuilt and deployed; Playwright pass against the live page -
zero console errors/warnings, lag banner reads "Data through 2026-07-27 (23d behind real
time)", signal section renders the 3-feature coefficient table and the structural-long
context note as designed.

**Artifacts:** `backend/analytics/imbalance.py`, `backend/app/schemas.py`,
`backend/app/main.py`, `backend/scripts/refresh.py` (added `nrv-saldo-de` to
`INGEST_FETCHERS`, fixed the `imbalance_daily` DDL), `backend/tests/conftest.py`,
`backend/tests/test_endpoints.py`, `backend/tests/test_refresh_fetchers.py`,
`frontend/src/lib/api.ts`, `frontend/src/routes/imbalance.tsx`. 171 backend tests green,
97 frontend tests green, `ruff check`/`ruff format --check` clean, `tsc -b` clean.

## 2026-08-05 - reBAP attribution corrected across every user-facing surface

The 2026-07-31 entry below swapped the reBAP *fetcher* from `smard-imbalance-de` to `rebap-de`
(Netztransparenz) but left every human-readable credit pointing at SMARD. The app was therefore
serving Netztransparenz data under a SMARD byline for five days: the About modal in `__root.tsx`,
the /imbalance header and "What is reBAP?" explainer, the landing-page card description and its
`SOURCES` chip row, the README summary line, dashboard table and source table, and the data-source
list in `CLAUDE.md`.

Worth stating plainly because a mis-credit here is not cosmetic: SMARD module 4169 is the DE/LU
day-ahead price, so crediting SMARD asserts the page is showing the very series the July
post-mortem established it is *not* showing. The README additionally credited SMARD for "realised
renewable generation + load", which the app has never sourced from SMARD - generation and the
day-ahead forecasts both come from ENTSO-E (`entso-e-gen-full`, `power_generation_forecast`). No
SMARD fetcher remains in `INGEST_FETCHERS`; SMARD contributes nothing to this app.

Every remaining SMARD mention is now deliberate: the post-mortem docstrings, the
`DISABLED_FETCHERS` guard in `test_refresh_fetchers.py`, and the historical entries below, which
are left as written. `CLAUDE.md`'s data-source row now carries the "not SMARD, and why" note plus
the ~2-week quality-assured publication lag, so the next reader does not re-derive it.

**Artifacts:** `frontend/src/routes/__root.tsx`, `frontend/src/routes/imbalance.tsx`,
`frontend/src/routes/index.tsx`, `README.md`, `CLAUDE.md`, `docs/INTERVIEW_PREP_ENERGY.md`.
`npm run build` (tsc -b) clean.

## 2026-08-03 - Corsica surfaced on /map: a zone with no price, and the map says why

Follow-on to the ingest entry below. The FR-COR polygon no longer carries `"displayAs": "FR"`, so
Corsica is now its own zone on the map instead of being painted with mainland French numbers.

**The problem this had to solve.** Four of the six map metrics are price-based, and Corsica has no
price and never will. Colouring it in the `#374151` missing-data grey would have been actively
misleading: it implies a feed someone could go and fix. So no-price zones get a dedicated fill
(`#2f2a3d`) plus a **dashed stroke** under price metrics only, a legend entry of their own, and a
tooltip that states the reason rather than the symptom ("No market price - EDF SEI island system,
clears inside FR"). Under generation metrics they colour normally, because that data does exist -
verified in the browser: Corsica renders `#2f2a3d` + `stroke-dasharray="4 3"` on Price and `#92400e`
with a normal solid stroke on Renewable %, and it is the only one of the 45 paths treated that way.

**One `zoneStyle()` for three call sites.** Path styling was previously built inline in three
places (initial render, data-change re-style, mouseout restore). With a dash in play that is a drift
waiting to happen - the mouseout handler would have quietly restored a solid stroke. They now share
one helper. Incidentally fixed a latent bug there: mouseout compared `zone` while every other site
compared `dataZone`, which only ever agreed because FR-COR was the sole `displayAs` user.

**New Island tab.** `UnifiedZonePanel` swaps Price for an "Island system" tab backed by a new
`/api/island/{zone}` endpoint and `analytics/island.py`. It shows cable import and cable share as
the headline (the cable is the island's cheap marginal supply, so its share is the nearest thing to
a price signal), the 14-day supply stack, the intraday shape, and cable share since 2019. The
intraday chart earns its place: the cable runs near flat while oil swings from ~118 to ~250 MW, so
the link is baseload and the local diesel fleet absorbs the entire daily load shape; midday solar
(190 MW mean at h12, against 168 MW of oil) pushes both down. Price queries are gated with
`enabled: !noPrice` so they stop 404ing on every selection, and the active tab is **derived, not
stored** - the panel is not remounted between zones, so a user sitting on Price who clicks Corsica
would otherwise land on a tab that cannot render. Verified both directions in the browser.

**The gap is drawn, not hidden.** `island_daily` is reindexed over the full calendar so the 565
missing days exist as NULL rows, and the monthly rollup emits `share: null` for empty months, so
recharts breaks the line instead of drawing a clean segment across 19 months EDF never published.
That was the single most misleading thing this chart could have done. `gap_days` and `profile_days`
are surfaced in the API so the UI states the gap in prose and never implies a year of evidence
behind a profile currently built on 15 days.

**Also deliberate:** `MapMetric`/`isPriceMetric` moved from `EuroMap.tsx` to `lib/scales.ts` and the
history rollup to `lib/island.ts`, purely so the logic is testable - vitest runs `environment: 'node'`
here and importing Leaflet or recharts into a test blows up on `window is not defined`.

**Verification:** 171 backend tests (+30), 97 frontend tests (+37), zero console errors or warnings
across a full browser walkthrough of both zone types and all six metrics.

## 2026-08-03 - Corsica (FR-COR) ingested as a 46th generation zone

**Question:** "do we have data in Corsica?" No. `power_latest` and `generation_latest` both held exactly
45 zones, FR only; `market_data` had no `FR-COR` row in `power_prices` or `power_generation_actual`.
The island appeared on `/map` solely because `bidding_zones.geojson` carries an `FR-COR` polygon with
`"displayAs": "FR"`, which `EuroMap.tsx` resolves to mainland French numbers. `scales.ts:105` had a
`'FR-COR': 'Corsica (France)'` label that nothing could reach.

**Source hunt.** RTE/ODRE eco2mix is a dead end: `eco2mix-regional-tr`, `eco2mix-regional-cons-def` and
`consommation-quotidienne-brute-regionale` all carry exactly the 12 mainland regions. Corsica is an EDF
SEI territory, not an RTE balancing region. EDF's own portal has also moved - `opendata-corse-outremer.edf.fr`
now 302s to `opendata.edf.fr`, whose Opendatasoft v2.1 API returns **410 Gone** and v1 returns 404. The
portal was rebuilt on **data-fair**: `https://opendata.edf.fr/data-fair/api/v1/datasets/{slug}/lines`,
`size` hard-capped at 10000, paging via a server-issued `next` cursor.

**What the two usable datasets actually are.** Neither is sufficient alone, which is the whole design
constraint:
- `production-delectricite-par-filiere-en-temps-reel`: 15-min, refreshed ~every 15 min, **rolling
  14-day window only** (1,344 rows). Server-side history is not retained, so it has to be accumulated
  locally. Publishes Paris local time with offset.
- `production-d-electricite-par-filiere-et-couts-de-production-au-pas-horaire-corse`: hourly, 52,608
  rows, 2019-01-01 to **2024-12-31 and frozen** (its `updatedAt` of 2026-02-24 is a metadata touch, not
  new data). Publishes UTC.

That leaves a **permanent unfillable gap, 2025-01-01 to 2026-07-19**. Verified there is no third source.

**Rejected: the production-cost series.** The history set carries `cout_moyen_de_production_eur_mwh`,
tempting as a marginal-cost proxy for an island system. It is non-null for exactly **8,759 rows -
calendar 2019 - and then stops**. Ingesting it would create a price-like column that silently dies
after one year, on a zone whose defining property is that it has no price. Left out deliberately.

**Rejected: `cross_border_flows` for the cables.** ENTSO-E has no Corsican border at all (FR's only
entries are BE, CH, DE-LU, IT-NORD - SACOI and SARCO are absent entirely), and EDF publishes cable flow
as a single **net scalar** with no per-cable or per-counterparty split. Writing it as a directional
FR-COR<->IT-SARD pair would have fabricated the counterparty. New `island_net_imports` table instead
(ts, zone, net_import_mw; positive = importing). It is also kept out of the fuel mix, so `total_mw`
stays domestic generation, consistent with every other zone.

**Fuel mapping.** Both `moteur_diesel` and `tac` (fioul combustion turbines) burn oil products and map
to `oil`; `micro_hydro` folds into `hydro`. Two source columns collapsing onto one tech means the
mapper must **sum**, not overwrite - a naive dict build silently drops most of Corsica's thermal fleet.
EDF also meters distributed PV and wind net of self-consumption and publishes small negatives overnight
(-1.06 MW of PV at 23:00), so readings are clamped at zero **per source column before summing**, or an
artifact on one column would cancel real output on another sharing its tech. Net cable flow is never
clamped: negative there is a real export.

**Installed capacity.** ENTSO-E's `installed_generation_capacity` excludes Corsica, so annual snapshots
are derived from the RNIPSE registry (1,020 installations, `puismaxinstallee` published in **kW**) as a
cumulative sum by commissioning date, minus anything disconnected by that year end. Yields solar
198 -> 281 MW (2019 -> 2026) and wind 18 -> 29.7 MW, both consistent with the real fleet. Only solar and
wind are stored: the table has no oil column, so the diesel/TAC fleet (~413 MW, the island's largest)
has nowhere to go. Capacity factors only use wind and solar, so no consumer is affected.

**Result.** 269,760 generation rows and 53,952 cable-flow rows, 2019-01-01 to present. Daily means:
oil 106.5 MW (peak 313), hydro 52.1 (peak 213), solar 30.3 (peak 183), wind 1.8, biomass 0.5; net
imports average 73.3 MW, range -27 to +155. Re-running is idempotent (row count unchanged). Latest day:
209.5 MW oil, 70 MW solar, 29.8% renewable on 299.3 MW total. `analytics/generation.py` needed **no
change** - it is keyed on `zone` and picked FR-COR up as the 46th zone automatically.

**Not done, deliberately.** The geojson still aliases the polygon to FR, so the map is visually
unchanged. Un-aliasing it means four of the six map metrics (Price, Range, Neg-hrs, 2yr-rank) need a
"no price exists" fill distinct from "data missing", plus conditionally hiding the price stats, 48h
price chart and daily price range in `UnifiedZonePanel`. That is more special-casing than the zone
returns on a price-centric map; surfacing Corsica in generation-only content is the cheaper option.
The one behavioural change today: `/power`'s headline weighted RE% and carbon intensity now include
FR-COR, which is ~0.1% of European generation by MW weight.

## 2026-07-31 - Refresh runtime: 2-3 hours to ~1 minute of fetching (gen-full progress marker)

**Problem:** Each twice-daily refresh took 2-3 hours, entirely inside `entso-e-gen-full`. The 13:45 run
routinely finished after 16:00 and the 20:15 run after 23:00, so the box spent ~25% of its day on the
job and `energy-refresh.timer` showed no next elapse because the service was still activating.

**Cause:** `fetch_generation_full` took its per-zone incremental start from the freshness of that zone's
`tech='nuclear'` rows. That marker is wrong in two independent ways. **31 of the 45 zones have no
nuclear fleet at all** (all Nordic and Italian zones, PL, PT, DK, the Baltics, AT, IE-SEM, GR, HR and
the Balkans), so `latest_stored_date` returned NULL and `effective_from` fell back to
`_GEN_FULL_DEFAULT_START` = 2021-01-01 on *every single run*. Worse, zones that **retire** nuclear
freeze their marker at the shutdown date: DE-LU - the most important zone in the app - sat at
**2023-04-15**, the day Germany shut its last reactors, re-fetching 3+ years per run with the window
growing by a day every day. Net effect: ~64,000 zone-days of monthly ENTSO-E chunks re-fetched twice a
day, every day, to UPSERT rows that already existed (31 no-nuclear zones x 2,037 days, plus DE-LU's
1,203, against ~20 for the 13 zones whose marker actually worked). The backfill had been *complete* since well before
this; the job was re-doing it perpetually. The gen-full subprocess output is captured rather than
streamed to the journal, so none of this was visible in the logs - only the multi-hour gap between
"ingest entso-e-scheduled: OK" and "ingest entso-e-gen-full: OK".

**Fix:** New `_gen_full_progress()` in `market-data/fetchers/entso_e.py` takes the max ts over
non-wind/solar techs. wind/solar are excluded because they predate this fetcher (an earlier
wind/solar-only ingest wrote them), so their freshness would falsely signal that the full-mix backfill
had reached a zone; every zone has at least one other tech, so the marker resolves for all 45. A 3-day
lookback buffer (`_GEN_FULL_REFETCH_DAYS`) is subtracted so ENTSO-E's revisions to recent actuals are
still picked up - the one real risk of tightening the window. Per-run work drops from ~65,000 zone-days
to **217** (99.7% less); 44 of 45 zones now fetch a 4-day window, and only AL fetches more (41 days,
because its ENTSO-E publication genuinely stops at 2026-06-23).

**Measured:** `ingest.py entso-e-gen-full` standalone: **54 seconds**, against 2-3 hours before.
Caveat on that number: inside a full refresh, gen-full runs straight after `entso-e-prices`, `-ntc` and
`-scheduled` have all just hammered the same API, so it can land in ENTSO-E's 429 backoff ladder
(`_RATE_LIMIT_BACKOFF = [60, 120, 240, 480]`) and sit in `clock_nanosleep` for several minutes. That is
the API pushing back, not the fetcher being stuck, and it is bounded by the per-fetcher timeout. The
54s figure is the fetch cost proper; a sequential run should be budgeted higher.

**Also:** ENTSO-E NTC and scheduled-flow fetches were hitting the flat 600s subprocess ceiling and
failing silently every few runs (verified in the journal for 2026-07-29: both logged "timed out after
600s" and the run continued as if nothing happened). `refresh.py` now carries a per-fetcher
`INGEST_TIMEOUTS` map with both raised to 1800s, and
gen-full lowered 10800s to 1800s (the 3h ceiling only ever made sense for the broken marker, and it sat
above the new unit timeout where it could never fire).

**And a second hang, unrelated to ingest:** a refresh was observed stuck for 14 minutes with 1s of CPU,
blocked in `poll()` *after* the ingest phase. The rebuild phase makes unbounded HTTP calls (Open-Meteo
heat risk, EIA us_power and us_plants) with no per-request timeout, so a slow external API hangs the job
indefinitely; the unit then sits in `activating` and `systemctl list-timers` shows no NEXT elapse, which
is precisely how a stuck run stays invisible. Added `TimeoutStartSec=3600` to `energy-refresh.service`
so any hang fails the unit and the next firing recovers (the job is idempotent). Per-request timeouts on
those calls are still missing and would be the better fix.

**Not the timeouts, after all:** `congestion_daily` sits a day behind `power_daily`, and the raised
timeouts did not close that gap - after a run where both fetches returned OK, `scheduled_exchanges`
still maxes at 2026-07-29 against 2026-07-30 for `ntc_dayahead` and `power_prices`. ENTSO-E publishes
scheduled commercial exchanges a day later than day-ahead prices, so the congestion lag is inherent to
the source and is not a bug to chase. The timeout fix stands on its own evidence.

**Operational trap worth knowing:** `energy-refresh.timer` declares `Requires=energy-refresh.service`,
so `systemctl stop energy-refresh.service` - the obvious response to a stuck run - also stops the
**timer** and silently kills the schedule. All four freight timers share this pattern, so it was
documented in the service header rather than changed unilaterally. After stopping the service, always
`systemctl start energy-refresh.timer` and confirm a NEXT elapse.

**Note:** the generation backfill is complete - all 45 zones span 2020-12-31 to present, 25.7M rows.
The "backfill in progress for the 27 non-core zones" note in `CLAUDE.md` was stale and has been
corrected, with a warning not to revert the marker to a single tech.

**Artifacts:** `market-data/fetchers/entso_e.py` (`_gen_full_progress`, `_GEN_FULL_MARKER_EXCLUDED`,
`_GEN_FULL_REFETCH_DAYS`), `market-data/tests/test_gen_full_progress.py` (7 new unit tests, stubbed
connection, no DB), `energy/backend/scripts/refresh.py` (`INGEST_TIMEOUTS`), `energy/CLAUDE.md`.
37 market-data tests, 141 energy tests passing.

## 2026-07-31 - Revalidation of Phases 55 and 65 on real reBAP (retracts the published findings)

**Context:** On 2026-07-26 the `smard-imbalance-de` fetcher was found to be ingesting the wrong series. SMARD module 4169 is the DE/LU **day-ahead price**, not reBAP, and `imbalance_prices_de.settlement_eur_mwh` was verified bit-identical to `power_prices` for DE-LU across 28,440 hours. Every result on /imbalance published before that date was computed on the day-ahead price wearing a reBAP label. The table has since been repopulated from the Netztransparenz `NrvSaldo/reBAP` endpoint (439,960 quarter-hourly rows, 2014-01-01 to 2026-07-20, single-source). Two more defects were found on 2026-07-31 and fixed: `refresh.py` still listed the disabled `smard-imbalance-de` and never called `rebap-de`, so /imbalance had frozen at 2026-07-20 and every refresh run raised; and `entso-e-hydro` was missing from the same list, freezing the hydro tables at 2026-06-14 for seven weeks.

**Method:** The poisoned input is exactly reconstructible (it *was* the DE-LU day-ahead price), so both phases were re-run twice over an identical 2024-07-20..2026-07-20 window: once on real reBAP, once with `imbalance_daily.mean_eur` swapped for `power_daily.base_eur`. Every other table was left untouched, isolating the data defect from drift elsewhere. The reconstruction reproduces the published numbers closely (Phase 55: n_oos 664, naive positive rate 99.6%, naive Sharpe 39.77 vs 39.6 published; Phase 65: Q5-Q1 differential 27.2 vs 27 published), which validates the comparison.

**Found - Phase 55 (reBAP renewable forecast-error signal). The headline mechanism does not survive.** On real reBAP, OOS excess-direction accuracy is **62.7% vs a 48.6% naive baseline** (n_oos 667), down from the published 70.3% vs 50.5%. Sharpe 3.16 (vs 4.03 on the poisoned series) and max drawdown nearly triples, -3,177 vs -1,132 EUR. But the damage is in the coefficients, not the headline. `wind_err_lag1` - the feature the entire phase was named for - collapses from -1.534 (cv 0.39, stable) to **-0.129 with cv 9.36, i.e. indistinguishable from noise**. `solar_err_lag1` **flips sign**, -0.771 to +1.707, and is unstable in both runs. Only `wind_fc_d` (-0.94 to -1.02, cv 0.13 to 0.27) and `rebap_dev_lag1` (+0.294 to +0.153, cv 0.20 to 0.34) keep their sign and stability. **The surviving signal is a day-ahead wind-forecast-level effect plus mean-reversion in reBAP's own deviation - not a forecast-error effect.** The phase's title and its "coefficient signs are economically motivated" narrative are retracted. Separately, the published claim that all four features were stable (cv < 1) was already false on its own data: `solar_err_lag1` had cv 1.63 there too.

**Found - Phase 65 (reBAP vs DA z-score correlation). Right answer, wrong reason; numbers restated.** Pearson r is **0.398 on real reBAP vs 0.387 on the reconstructed poisoned series** - essentially unchanged, so the published r=0.42 was not far off by luck. But the published *interpretation* ("DA prices in the shortfall at gate closure, reBAP prices it in real-time") described a cross-market linkage that the data could not have shown: it was correlating a DA fundamental-model residual against the DA price itself. Only now is it genuinely cross-market. Restated on real reBAP: Spearman 0.221, and the quintile spread widens to **43.5 EUR/MWh** (Q1 92.8 to Q5 136.3) from the published 27. The published "near-monotonic" description is retracted - the response is **not** monotone in either run (real: 92.8, 94.9, 89.6, 107.6, 136.3; Q3 sits below Q1). The effect is concentrated almost entirely in the top quintile, and Spearman well below Pearson confirms it is carried by extreme episodes rather than a uniform rank relationship.

**Found - a methodological defect independent of the data.** `compute_rebap_signal` takes its position from predicted *excess* (`analytics/imbalance.py:241`) but books P&L on the *level* (line 244), while measuring accuracy on excess (line 262). Since reBAP's daily mean is positive on 97.9% of days in the last two years, booking on the level reintroduces into the P&L exactly the structural long bias the phase removed from the accuracy metric. Re-booking the same positions against the excess they actually predict: Sharpe **3.34** on real reBAP (positions 54.1% long, so the bias is milder than feared) against a naive-on-excess Sharpe of **-0.47**. The signal survives the correction and the honest Sharpe is marginally *better*. On the poisoned series the same correction moved Sharpe 4.03 to 7.47, so the two bases diverge sharply and reporting them interchangeably is not safe.

**Real reBAP, for the record** (the distribution the old series never had): 18.3% of quarter-hours are negative, quarter-hourly range -8,271 to +24,455 EUR/MWh, daily mean positive on 94.8% of all days and 97.9% of the last two years. The old series was positive 99.6% of days with none of the tails.

**Decision:** Phase 55's forecast-error framing is retracted; the signal is kept but must be re-described around `wind_fc_d` and mean-reversion. Phase 65's finding stands and its numbers are restated above. Two follow-ups moved to ROADMAP: settle the P&L basis in `compute_rebap_signal`, and surface the ~11-day Netztransparenz publication lag in the /imbalance UI - the quality-assured reBAP is inherently ~2 weeks behind, which the page currently does not say.

**Artifacts:** `backend/scripts/refresh.py` (`INGEST_FETCHERS` / `INGEST_TIMEOUTS`, `smard-imbalance-de` to `rebap-de`, `entso-e-hydro` added, ENTSO-E NTC/scheduled timeouts 600s to 1800s), `backend/analytics/imbalance.py` (corrected module docstring), `backend/tests/test_refresh_fetchers.py` (6 new guards; verified to fail against the old list). 141 tests passing.
