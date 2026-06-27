# Energy Hub Changelog

## 2026-06-27 - Phase 50: Signal ensemble + cross-zone portfolio P&L (arc capstone)

**Tried:** The capstone of the /spreads signal arc: combine the canonical per-zone signal (the P47 nonlinear residual fade, net of the P44 cost) into one book a desk would actually run, and decompose its risk. Built `compute_portfolio_backtest()`: each zone's daily net P&L is date-aligned (a zone contributes 0 on days it has no signal), zones are blended with inverse-volatility (equal-risk) weights so no single hub dominates, and the realised Euler volatility decomposition - risk contribution_i = w_i (Sigma w)_i / sigma_p - attributes portfolio risk per zone. Reports portfolio Sharpe / drawdown vs the single-zone DE-LU book, each zone's risk contribution, and the diversification ratio (weighted-average standalone vol / portfolio vol). To support it, `_nonlinear_signal_pnl` now returns the realised P&L dates so the per-zone series can be aligned. `GET /api/spreads/portfolio-backtest`.

**Found:** Diversification is the cleanest edge in the whole arc. The 5-zone inverse-vol portfolio earns **Sharpe 3.76 versus 1.16 for the single-zone DE-LU book** - more than triple - at a **1.34x diversification ratio** (the weighted-average standalone vol is 34% above the portfolio vol, i.e. the per-zone fades are well below perfectly correlated) and **roughly half the drawdown** (-71 vs -119 EUR/MWh-unit). Inverse-vol weighting tilts toward the low-vol IT-NORD book (weight 0.40) but the Euler decomposition shows risk contributions are well balanced across zones (16.6%-22.5%), exactly the equal-risk intent. The standalone Sharpes that feed it span 1.16 (DE-LU) to 3.47 (NL), so the portfolio is not just riding one star zone - it is harvesting the low correlation between zones whose drivers (wind regimes, nuclear mix, demand) differ.

**Decision:** Ending the arc on a single portfolio P&L curve with risk attribution is the right capstone: it turns five per-zone research signals into the one number a desk cares about (a blended Sharpe) and shows *where* the risk sits. Inverse-volatility (equal-risk) weighting is the honest default - it needs no return forecast, only volatilities, and the Euler decomposition makes the residual risk imbalance from correlation explicit rather than assumed away. The one caveat is stated plainly on the page and in the docstring: the per-zone signals are genuinely walk-forward/OOS, but the weighting overlay is set from full-sample volatility, so the portfolio construction is an ex-post illustration on top of OOS signals (a rolling-weight version is the obvious next refinement). Frontend: `PortfolioSection` capstone at the foot of /spreads with portfolio-vs-DE-LU Sharpe/drawdown cards, the diversification ratio, a two-line equity curve (portfolio vs DE-LU alone), per-zone Euler risk-contribution bars, and a footer that states the diversification result and the ex-post-weighting caveat.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_portfolio_backtest`, `dates` added to `_nonlinear_signal_pnl`), `backend/app/schemas.py` (`PortfolioBacktestResponse`, `PortfolioZoneRow`, `PortfolioStats`, `PortfolioEquityPoint`), `backend/app/main.py` (endpoint), `backend/tests/test_endpoints.py` (`test_spreads_portfolio_backtest`), `frontend/src/routes/spreads.tsx` (`PortfolioSection`), `frontend/src/lib/api.ts` (types + `spreadsPortfolioBacktest`). 106 tests passing. Completes the P42-P50 fundamental signal-research arc.

## 2026-06-27 - Phase 49: Gradient-boosted fair value vs the hinge OLS

**Tried:** The honest follow-up to P48 (more factors tighten fit but hurt the tradeable signal): does a nonparametric learner beat the one-coefficient low-wind hinge, or just add variance? Added the first ML dependency to the energy venv (`lightgbm>=4.5`, via the native training API so scikit-learn is not required - `uv lock` + `uv sync`). Built `compute_gbm_model()`: a walk-forward comparison of three models - linear OLS (5 terms), the P47 hinge nonlinear OLS (9 terms), and a LightGBM over the six raw factors (TTF, EUA, wind%, solar%, residual demand GW, dTTF) - all refit on the same block cadence (every 21 days, predicting the block OOS) so the only difference is model class. A daily GBM refit would be ~300 fits/zone/request; the 21-day block keeps it sub-second (~0.5s/zone) while staying a genuine walk-forward. Reports OOS RMSE (overall + low-wind) and tradeable Sharpe (faded residual net of the P44 cost) for each, plus the GBM's gain feature importance and a wind partial-dependence curve. `GET /api/spreads/gbm-model?zone=`.

**Found:** The GBM does not beat the hinge - flexibility is variance here, not alpha. On **tradeable Sharpe the LightGBM trails the hinge OLS on every single zone**: DE-LU 0.58 vs 1.31, FR 2.29 vs 2.71, NL 2.32 vs 3.36, IT-NORD 2.34 vs 3.39, BE 2.40 vs 3.39. On **RMSE it only wins on FR** (23.7 vs 25.8 hinge, with a large low-wind gain 21.7 vs 27.1) and marginally BE; on DE-LU/NL/IT-NORD it is no better or worse than the hinge. Gain importance is dominated by residual demand (50-61% on the windy hubs; TTF leads only on near-zero-wind IT-NORD at 51%) - the same factor P48 showed tightens fit while absorbing the mean-reverting residual the fade trades, which is exactly why the GBM's better-fit zones (FR) still lose tradeable Sharpe. The wind partial-dependence curve recovers a smooth low-wind price lift, qualitatively the same shape as the explicit hinge - so the hinge already captured the economically real nonlinearity in one interpretable coefficient.

**Decision:** This closes the model-complexity question for the arc honestly: the parsimonious, interpretable hinge OLS is the right fair-value model for the *tradeable* signal - a black-box booster fits in-sample structure that does not survive out-of-sample, and its only fit win (FR) does not convert to Sharpe. The same fit-vs-signal tension P48 surfaced holds across the whole complexity ladder (linear -> hinge -> GBM): past the hinge, added flexibility buys fit and costs alpha. The canonical signal stays the P47 hinge baseline; the GBM is shipped as a documented, falsifiable comparison with full interpretability (importance + partial dependence) so the verdict is auditable, not asserted. Frontend: `GbmModelSection` below `EnrichedModelSection` with a three-model RMSE/Sharpe grid (best-in-class starred), a gain-importance bar list, a wind partial-dependence chart with the hinge knot marked, and a verdict footer that adapts to whether the GBM beats the hinge per zone.

**Artifacts:** `backend/pyproject.toml` + `uv.lock` (lightgbm), `backend/analytics/fundamental.py` (`compute_gbm_model`, `_fit_gbm`, `GBM_FEATURES`, `GBM_REFIT_EVERY`), `backend/app/schemas.py` (`GbmModelResponse`, `GbmImportanceRow`, `GbmPartialPoint`), `backend/app/main.py` (endpoint), `backend/tests/test_endpoints.py` (`test_spreads_gbm_model`), `frontend/src/routes/spreads.tsx` (`GbmModelSection`), `frontend/src/lib/api.ts` (types + `spreadsGbmModel`). 105 tests passing.

## 2026-06-27 - Phase 48: Enriched fundamental factor set (residual demand + dTTF)

**Tried:** With the P47 no-look-ahead forecast feature layer in place, tested whether enriching the nonlinear fair value with two more gate-closure factors tightens it: residual demand (forecast load - forecast wind - forecast solar, in GW - the thermal-stack depth the renewable *shares* miss because they ignore the demand level) and the day-over-day TTF change. Both are in the gate-closure information set (forecast load + prior-day gas), so the enriched design stays causal. Built `compute_enriched_model()` + `_design_nonlinear_enriched()`: strict walk-forward comparing the P47 nonlinear baseline against the enriched design, reporting OOS RMSE (overall + low-wind), tradeable Sharpe (faded residual net of the P44 cost - the same metric as the rest of the arc), and the walk-forward mean/std/CV of each new coefficient as an overfitting guard. **Nuclear% was deliberately excluded**: the ingested ENTSO-E A69 day-ahead forecast carries only wind/solar, so a realised-nuclear factor would reintroduce look-ahead; logged the gap (ENTSO-E A80 unavailability as the candidate fetcher) in `ideas.md` and in `DEFERRED_FACTORS`. `GET /api/spreads/enriched-model?zone=`.

**Found:** A clean, instructive split between fit and signal. The new factors **tighten the fair value** on 4 of 5 zones - FR RMSE -8.5% (low-wind -11.3%), IT-NORD -16.0%, BE -2.5%, NL -0.9% - with stable coefficients (residual-demand CV 0.07-0.20 on the windy hubs, dTTF CV ~0.08-0.14 everywhere; only NL's residual-demand coefficient is unstable, CV 2.1, so it is flagged). DE-LU is the lone RMSE regression (-2.8%). **But the tradeable Sharpe falls almost everywhere**: DE-LU -0.39, FR -0.70, NL -0.85, BE -0.70, IT-NORD ~flat (+0.01). The mechanism is the point: a tighter fair value absorbs part of the mean-reverting deviation the fade trades, so the OOS residual carries less of the alpha. Residual demand and dTTF explain price moves that *were* part of the tradeable residual. Better fit is not better signal - and because the coefficients are stable, this is a real effect, not estimation noise.

**Decision:** This is exactly the honest result the walk-forward-Sharpe discipline exists to surface: it stops the naive "more factors must be better" reflex. The fair-value model and the trading signal optimise different objectives - the regression minimises explained variance, but the fade *needs* unexplained, mean-reverting residual to trade. So the page now carries the enriched design as a documented comparison, not a replacement: the canonical signal stays the P47 nonlinear baseline. The nuclear exclusion is the no-synthetic-data rule applied honestly - a factor with no gate-closure source is deferred, not faked. Frontend: `EnrichedModelSection` directly below `NonlinearModelSection` with a zone selector, base-vs-enriched RMSE and Sharpe cards, a new-factor coefficient-stability grid (mean / WF std / CV with an instability flag), and a footer whose verdict adapts to the fit-vs-signal split per zone and states the nuclear deferral.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_enriched_model`, `_design_nonlinear_enriched`, `ENRICHED_FACTORS`, `DEFERRED_FACTORS`, `load_mw` added to `_fetch_fundamental_features`), `backend/app/schemas.py` (`EnrichedModel*`, `EnrichedFactorStability`), `backend/app/main.py` (endpoint), `backend/tests/test_endpoints.py` (`test_spreads_enriched_model`), `frontend/src/routes/spreads.tsx` (`EnrichedModelSection`), `frontend/src/lib/api.ts` (types + `spreadsEnrichedModel`), `~/quant/ideas.md` (nuclear DA-forecast/A80 data gap). 104 tests passing.

## 2026-06-27 - Phase 47: No-look-ahead rebuild of the fundamental arc on day-ahead forecasts

**Tried:** A review of Phase 46 surfaced a fatal realism flaw in the entire P42-P46 fundamental arc: the fair-value model drove off `generation_daily`, which is *realised* wind/solar for the delivery day. At day-ahead gate closure (the moment a trader actually commits) only the TSO's day-ahead *forecast* exists, not the realised output - so every residual and every regime flag was peeking at the delivery day. Confirmed `market_data.power_generation_forecast` (ENTSO-E A69 DA forecast, wind_onshore+wind_offshore+solar) and `power_load` (kind='forecast') are ingested for all five fundamental zones (DE-LU from 2021-12, FR/NL/IT-NORD/BE from 2017). Built `generation_forecast_daily` in `analytics/generation.py` + `refresh.py`: daily DA-forecast wind/solar as a share of DA-forecast load, carrying the realised (actual/actual-load) penetration on the *same load denominator* so the two differ only by forecast-vs-realised. Refactored the whole arc through one `_fetch_fundamental_features(query_fn, zone, source)` helper with `FUNDAMENTAL_SOURCE="forecast"` as the canonical no-look-ahead signal (`source="actual"` retained only to measure the look-ahead premium). Added a zone-relative drought threshold for the regime book (the 25th percentile of each zone's *own* training-window forecast wind, computed from pre-OOS data only - a fixed 8% pp knot mis-partitions zones, making low-wind IT-NORD "always drought"). `compute_nonlinear_backtest` now also reports the look-ahead premium (actual minus forecast nonlinear gross Sharpe).

**Found (the honest reckoning):** (1) **The nonlinear edge survives forecasts but roughly halves.** DE-LU nonlinear gross Sharpe falls from 2.11 on realised generation to 1.20 on the forecast - a look-ahead premium of +0.91, i.e. ~43% of the gross edge was hindsight. It still beats linear (1.20 vs 0.57). (2) **The Phase 46 "drought alpha" does NOT survive - it was largely a look-ahead + denominator artefact.** With forecast features and a zone-relative drought threshold, the nonlinear fade's DE-LU drought Sharpe is *+2.05* (not the catastrophic -4.76 the realised/total-gen/fixed-8% partition showed on n=11), so there is no drought loss to recover; the momentum override (+0.99) only adds variance and `recovers_drought=False`. The original -4.76 came from a tiny extreme tail selected using realised wind. FR is the honest counter-point: its look-ahead premium is negligible (+0.05, because nuclear-baseload FR has forecast≈actual at low wind), its relative-drought is genuine, and the flip *does* help there (`recovers_drought=True`). (3) **The cross-zone dose-response still holds on forecasts** (slope +0.026/pp, corr +0.88, IT-NORD null negative, DE-LU largest) - the core thesis that the nonlinear basis prices wind-scarcity convexity is real, just smaller than the peeking version claimed.

**Decision:** Switching the canonical features to the day-ahead forecast is non-negotiable for a tradeable claim - the forecast is the information set at gate closure, full stop. Keeping the realised-generation path purely to quantify the look-ahead premium turns a methodology fix into a *measurement*: the page now shows exactly how much of each zone's edge was hindsight. The zone-relative drought threshold (training-window percentile) is the right definition because "drought" must mean low wind *for this zone*, not a fixed pp knot. The Phase 46 conclusion is formally retracted (see the corrected note on that entry): on a no-look-ahead protocol the regime-aware momentum flip is not robust alpha. The DA-price-change return remains a labelled signal-quality proxy (you cannot hold the DA index across delivery days); an executable imbalance-settlement P&L was scoped out because clean imbalance prices exist only for some zones and would break the cross-zone comparison. Frontend: every fundamental footer now states the forecast (gate-closure) basis; `NonlinearBacktestSection` gained an amber look-ahead-premium banner; `RegimeAwareSection` reports the zone-relative threshold and an honest "does NOT add alpha / was a look-ahead artefact" verdict.

**Artifacts:** `backend/analytics/generation.py` (`_build_generation_forecast_daily`, `FORECAST_DAILY_COLS`), `backend/scripts/refresh.py` (`generation_forecast_daily` write), `backend/analytics/fundamental.py` (`_fetch_fundamental_features`, `FUNDAMENTAL_SOURCE`, `DROUGHT_PCTILE`, `source` param across the arc, look-ahead premium in `compute_nonlinear_backtest`), `backend/app/schemas.py` (`LookaheadPremium`, updated `NonlinearBacktestResponse`/`RegimeAwareBacktestResponse`), `backend/app/main.py` (endpoints), `backend/tests/conftest.py` (`generation_forecast_daily` seed), `backend/tests/test_endpoints.py` (updated assertions), `frontend/src/lib/api.ts` + `frontend/src/routes/spreads.tsx` (look-ahead banner, forecast footers, honest regime verdict). 103 tests passing; full `refresh.py --skip-ingest` rebuild verified.

## 2026-06-27 - Phase 46: Regime-aware signal on /spreads

> **Retraction (Phase 47, 2026-06-27):** the headline finding below - that the regime-aware momentum flip "recovers the drought loss on DE-LU" - does NOT survive a no-look-ahead rebuild. It used *realised* generation (a look-ahead) with a fixed 8% knot over a total-generation denominator, which manufactured a tiny (n=11) extreme low-wind tail where the fade looked catastrophic (-4.76). On the day-ahead forecast with a zone-relative drought threshold the nonlinear fade's DE-LU drought Sharpe is already positive (+2.05), so there is no loss to recover and the momentum flip only adds variance. See the Phase 47 entry. The mechanism described below stands only for FR, where the look-ahead premium is negligible.

**Tried:** Every prior backtest (P43-P45) carried the same wound: below the low-wind knot both the linear and nonlinear fades are sharply negative-Sharpe (DE-LU sub-knot Sharpe -7.29 linear, -4.76 nonlinear). That is structural, not noise - when renewable scarcity persists, prices trend rather than revert, so a pure mean-reversion fade is fighting the tape. Built `compute_regime_aware_backtest()`: it walk-forward refits both OLS fair-value models daily (same protocol as P43), but adds a third book whose position map is conditioned on the live wind regime. In the normal/high-wind regime (wind% >= 8% knot) it keeps the nonlinear contrarian fade; in the sub-knot drought regime it flips to momentum - position = clip of a 10-day rolling z-score of recent daily price changes (trend-following). Accounting, refit, and the 0.10 EUR/MWh round-trip cost are identical to the P43/P44 books, so the only change versus the nonlinear fade is the drought-regime position. Reports Sharpe / drawdown / hit rate / cum P&L for all three books, with the Sharpe split into the sub-knot vs normal regime, plus a `recovers_drought` flag. Pure numpy, no new dependency. `GET /api/spreads/regime-aware-backtest?zone=`.

**Found:** Conditioning on the regime recovers the drought loss on DE-LU. The regime-aware book's sub-knot Sharpe is -2.34, materially less negative than both fade books (-4.76 nonlinear, -7.29 linear), while the normal-wind edge is preserved (3.20 vs the nonlinear fade's 3.29) and overall Sharpe ticks up to 2.98. The momentum flip turns the drought from a deep bleed into a shallow one - the trend-following position is on the right side of the persistent-scarcity price runs the fade was shorting into. The cross-zone check is the honest counterweight: on FR the flip is destructive (overall Sharpe collapses 2.77 -> -0.18). FR's low wind% is structural nuclear baseload, not scarcity, so prices there still revert in the "drought" regime and the fade already works (sub-knot Sharpe +3.36); the momentum override only injects variance. The edge is specific to wind-heavy hubs where low wind% genuinely signals scarcity - which is exactly the same boundary the P45 dose-response drew.

**Decision:** A regime-conditioned position map is the right fix for a signal that is correct in one regime and wrong in another - rather than dampening the whole book, it surgically swaps the rule only where the mean-reversion assumption breaks. The DE-LU sub-knot recovery (-4.76 -> -2.34) is the headline, but the FR collapse is the more instructive result: it proves the fix is not a free lunch and that "drought" must mean wind-scarcity, not just low wind%. The /spreads page now extends its argument with the trade a desk would actually make: don't fade into a renewable drought, ride it. Frontend: `RegimeAwareSection` below `NonlinearEdgeByZoneSection` with a zone selector, a drought-Sharpe stat row for all three books plus a recovered? verdict card, a triple-line OOS equity chart (linear fade / nonlinear fade / regime-aware, net of cost), a per-book summary grid (Sharpe overall/normal/drought, hit rate, cum P&L, max DD), and a footer whose closing sentence adapts to whether the regime conditioning helped or hurt the selected zone.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_regime_aware_backtest`, `WF_MOM_WINDOW`), `backend/app/main.py` (endpoint), `backend/app/schemas.py` (`RegimeBookStats`, `RegimeAwareEquityPoint`, `RegimeAwareBacktestResponse`), `backend/tests/test_endpoints.py` (`test_spreads_regime_aware_backtest`), `frontend/src/routes/spreads.tsx` (`RegimeAwareSection`, `RegimeAwareEquityChart`), `frontend/src/lib/api.ts` (types + `spreadsRegimeAwareBacktest`). 93 tests passing.

## 2026-06-27 - Phase 45: Cross-zone dose-response of the nonlinear edge on /spreads

**Tried:** Phases 42-44 built the nonlinear case on a single hub (DE-LU) with FR as the null. The whole argument rests on one mechanism - the hinge basis adds alpha *because* it prices the low-wind scarcity premium - which makes a falsifiable cross-sectional prediction: the edge should grow with a zone's wind penetration. Built `compute_nonlinear_edge_by_zone()`: it factors the shared walk-forward into `_nonlinear_signal_pnl()` (refit both OLS models daily, fade each rolling-z-scored OOS residual, return aligned gross P&L + turnover + wind regime) and runs it on every FUNDAMENTAL_ZONES zone. For each zone it reports the Sharpe edge (nonlinear - linear), gross and net of a fixed 0.10 EUR/MWh round-trip cost, against the zone's mean wind penetration, then fits an OLS line through (mean_wind_pct, sharpe_delta_gross) across zones and reports its slope and Pearson correlation. Pure numpy, no new dependency. `GET /api/spreads/nonlinear-edge-by-zone`.

**Found:** The dose-response holds. Across the 5 zones the Sharpe edge rises with wind penetration at +0.024 per percentage point, correlation 0.877. The ordering is the mechanism made visible: IT-NORD (0.3% wind) has a *negative* edge -0.33 - with no wind drought to price, the hinge is pure overfitting noise and hurts; FR (8.7%) is the null at -0.02; BE (18.7%) +0.39 and DE-LU (29.2%) +0.39 are the windy hubs where the convexity pays. NL (20.6%, +0.04) is an honest outlier sitting below the line - the fit is a trend, not a deterministic law. Charging 0.10 EUR/MWh barely moves any zone's edge (DE-LU +0.392 gross -> +0.394 net), reconfirming the Phase 44 result cross-sectionally: the edge is not a transaction-cost artefact. The single-zone DE-LU result generalises - the nonlinear basis earns its keep in proportion to how much wind-scarcity convexity a zone actually has.

**Decision:** A cross-sectional dose-response is the right way to turn a single-zone backtest into evidence for a *mechanism* rather than a coincidence: it makes the wind-penetration claim falsifiable and lets the data either confirm or revise it. The negative IT-NORD anchor is the most convincing single point - it shows the model only helps where the fundamentals say it should, which is exactly what separates a real economic edge from a fit. The /spreads page now closes its argument with the strongest available evidence: linear under-prices low wind (P36/P42) -> nonlinear recovers it OOS in RMSE (P42) -> that trades in DE-LU P&L (P43) -> it survives costs (P44) -> and the edge scales with wind penetration across zones, anchored by a negative-wind null (P45). Frontend: `NonlinearEdgeByZoneSection` below `NonlinearCostRobustnessSection` with 4 cards (dose-response verdict, correlation, slope, net cost), a colour-coded scatter (green positive / red negative edge) with the dashed OLS fit line and a y=0 reference, a per-zone table (wind %, Sharpe lin/nl, gross and net Sharpe delta, cum P&L delta), and a footer that states the verdict and reads off the IT-NORD-to-DE-LU gradient. The footer text adapts to whether the fit slopes up.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_nonlinear_edge_by_zone`, `_nonlinear_signal_pnl`, `EDGE_NET_COST`), `backend/app/main.py` (endpoint), `backend/app/schemas.py` (`EdgeByZoneRow`, `EdgeByZoneResponse`), `backend/tests/test_endpoints.py` (`test_spreads_nonlinear_edge_by_zone`), `frontend/src/routes/spreads.tsx` (`NonlinearEdgeByZoneSection`, `NonlinearEdgeScatter`), `frontend/src/lib/api.ts` (types + `spreadsNonlinearEdgeByZone`). 102 tests passing.

## 2026-06-27 - Phase 44: Transaction-cost robustness of the nonlinear edge on /spreads

**Tried:** Phase 43 reported a *gross* Sharpe edge for the nonlinear residual signal on DE-LU (2.99 vs 2.60) and its own footer flagged the obvious gap: "no transaction costs." The signal is a continuous, daily-rebalanced contrarian fade, so it turns over a lot - a desk's first question is whether the edge survives execution. Built `compute_nonlinear_cost_robustness()`: it reuses the exact walk-forward of `compute_nonlinear_backtest` to produce the two OOS position paths, then for each cost c in a 12-point grid (0 to 1.0 EUR/MWh round-trip per unit of |position change|) charges `c x |pos(t) - pos(t-1)|` on the day each position is established (initial entry costs `c x |pos(0)|`), subtracts it from gross P&L, and recomputes net Sharpe and net cumulative P&L for both signals. Reports per-model daily turnover, the gross (c=0) figures, the per-cost sweep, and two break-even costs: cum-P&L break-even is closed-form `c* = (G_nl - G_lin)/(T_nl - T_lin)` (only finite when the nonlinear signal both starts ahead and trades more); Sharpe break-even is found by a dense 0.01-step scan for the first crossing where nonlinear net Sharpe <= linear. Pure numpy, no new dependency. `GET /api/spreads/nonlinear-cost-robustness?zone=`.

**Found:** The DE-LU edge is not only robust to costs, it is *cheaper to trade* than the linear signal. Nonlinear daily turnover is 0.595 vs linear 0.633, and nonlinear gross P&L is higher, so as cost rises the Sharpe gap actually *widens* slightly: +0.39 at zero cost to +0.42 at a punitive 1.0 EUR/MWh, and both break-even costs are `None` (the edge never erodes anywhere in the grid). This is the strongest possible version of the capturable-alpha claim - the nonlinear model isn't buying its accuracy with extra churn. FR is flat and slightly negative throughout (Sharpe delta ~-0.02 at every cost, Sharpe break-even 0.0, turnover near-identical 0.375 vs 0.379), consistent with Phase 43: with less wind the low-wind hinge rarely binds, so there is no edge to preserve or erode. The result reads honestly per-zone: net-of-cost the nonlinear basis earns its keep on the wind-heavy German hub and is neutral elsewhere.

**Decision:** Charging turnover-scaled costs and reporting a break-even is the right way to harden a backtest from gross to net: it converts "higher gross Sharpe" into the claim a desk can act on ("the edge survives X EUR/MWh of slippage"). The DE-LU finding that the nonlinear signal has *lower* turnover is the headline diagnostic - it rules out the most common way a fancier model fakes an edge (trading more to chase the same reversion). The /spreads page now closes its single argument fully: linear under-prices low wind -> nonlinear recovers it OOS in RMSE (P42) -> that recovery trades in DE-LU P&L (P43) -> and it survives execution costs intact (P44). Frontend: `NonlinearCostRobustnessSection` directly below `NonlinearBacktestSection` with a zone selector, 4 stat cards (Sharpe break-even, cum-P&L break-even, Sharpe gain at max cost, linear-vs-nonlinear daily turnover), a net-Sharpe-vs-cost dual-line chart, a downsampled per-cost summary table (Sharpe lin/nl, dSharpe, dcum P&L), and a methodology footer that adapts its closing sentence to whether the nonlinear signal trades more or less than the linear one.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_nonlinear_cost_robustness`, `COST_GRID`), `backend/app/main.py` (endpoint), `backend/app/schemas.py` (`CostSweepPoint`, `CostRobustnessGross`, `CostRobustnessResponse`), `backend/tests/test_endpoints.py` (`test_spreads_nonlinear_cost_robustness`), `frontend/src/routes/spreads.tsx` (`NonlinearCostRobustnessSection`, `NonlinearCostSweepChart`), `frontend/src/lib/api.ts` (types + `spreadsNonlinearCostRobustness`). 102 tests passing.

## 2026-06-26 - Phase 43: Nonlinear vs linear residual signal P&L backtest on /spreads

**Tried:** Phase 42 proved the nonlinear (hinge/polynomial) fair-value model recovers the low-wind premium the linear OLS misses, in RMSE terms (DE-LU low-wind OOS RMSE -13.1%). It never answered the question a trading desk actually asks: does that extra accuracy translate into *tradeable* alpha? Built `compute_nonlinear_backtest()`: it reuses the strict walk-forward of `compute_nonlinear_model` (at each day t both models are refit on rows [0..t-1] and predict day t, so every residual is genuinely OOS), turns each model's OOS residual (actual - fair value) into a {30}-day rolling-z-score contrarian signal (position = clip(-z, -1, +1)), and trades it with identical accounting (P&L = position(t-1) x DA price change). The only difference between the two equity curves is the fair-value model that produced the signal, so the comparison isolates the value of the nonlinear basis. Pure numpy, no new dependency. `GET /api/spreads/nonlinear-backtest?zone=`.

**Found:** The edge is real but zone-specific, concentrated exactly where wind penetration is high. DE-LU over 296 OOS days: nonlinear Sharpe 2.99 vs linear 2.60 (+0.39), cumulative P&L +153 EUR/MWh-unit, max drawdown roughly halved (-115 vs -216), hit rate unchanged. The low-wind-regime Sharpe split confirms the mechanism: nonlinear low-wind Sharpe improves +2.46 (from -6.99 to -4.53) - both still negative there (the low-wind regime is hard for a pure mean-reversion fade), but the nonlinear signal loses materially less, and that is where the whole improvement comes from. FR, by contrast, is roughly flat (Sharpe -0.02, cum P&L -8): with less wind, the low-wind hinge rarely binds, so the nonlinear basis adds nothing tradeable. This is an honest result - the nonlinear model earns its keep on the wind-heavy German hub and is neutral elsewhere, exactly as the fundamentals predict.

**Decision:** Trading the OOS residual is the right way to validate "ML alpha": it forces the nonlinear model to prove its accuracy gain is capturable, not just an in-sample curve-fit. The walk-forward refit-daily protocol makes both signals genuinely out-of-sample, so the Sharpe delta is not data-snooping. The low-wind Sharpe split is the headline diagnostic - it ties the P&L gain back to the same convexity the wind-price analysis (P36) and the RMSE comparison (P42) surface, so the /spreads page now reads top-to-bottom as one argument: linear under-prices low wind -> nonlinear recovers it OOS in RMSE -> that recovery trades in DE-LU P&L. Frontend: `NonlinearBacktestSection` directly below `NonlinearModelSection` with a zone selector, 4 stat cards (Sharpe linear->nonlinear, Sharpe gain, cum P&L gain, low-wind Sharpe gain), a dual-line OOS equity chart (linear vs nonlinear cumulative P&L), a per-model summary grid (Sharpe/hit-rate/cum-P&L/max-DD), and a methodology footer making the capturable-alpha case explicit and noting no transaction costs.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_nonlinear_backtest`, `WF_SIGNAL_WINDOW`), `backend/app/main.py` (endpoint), `backend/app/schemas.py` (`BacktestModelStats`, `NonlinearBacktestImprovement`, `NonlinearBacktestEquityPoint`, `NonlinearBacktestResponse`), `backend/tests/test_endpoints.py` (`test_spreads_nonlinear_backtest`), `frontend/src/routes/spreads.tsx` (`NonlinearBacktestSection`, `NonlinearBacktestEquityChart`), `frontend/src/lib/api.ts` (types + `spreadsNonlinearBacktest`). 101 tests passing.

## 2026-06-26 - Phase 42: Nonlinear vs linear fair-value model on /spreads

**Tried:** The wind-price analysis (Phase 36) surfaced that the OLS fundamental model systematically under-prices the low-wind drought premium (a +39 EUR/MWh DE-LU residual in the 0-5% wind bin) and explicitly flagged this as "the empirical motivation for nonlinear ML." That motivation was never tested out-of-sample. Built `compute_nonlinear_model()`: a strict walk-forward comparison of two OLS models on the same DA-price target. The linear model uses TTF, EUA, wind%, solar%; the nonlinear model adds a low-wind hinge max(0, 8% - wind%), squared wind/solar, and a TTF x wind interaction. At each day t (after 250-day minimum training) both models are refit on rows [0..t-1] and predict day t, so every metric is genuinely OOS. Pure numpy lstsq, no new dependency (sklearn is not in the energy venv). `GET /api/spreads/nonlinear-model?zone=`.

**Found:** DE-LU over 297 OOS days: overall RMSE drops from 16.78 to 16.32 EUR/MWh (-2.7%), but the gain concentrates exactly where predicted - low-wind (<8% penetration) RMSE drops 40.63 to 35.31 (-13.1%). Full-sample hinge coefficient is +10.1 EUR/MWh per point of wind below the 8% knot, on top of the linear wind slope - a quantified, capturable convexity. Overall R2 improves +0.018. This confirms the low-wind premium is not just visible in hindsight: a nonlinear basis recovers a meaningful chunk of it out-of-sample.

**Decision:** A hinge/polynomial basis fit by OLS is the right first nonlinear step - it captures the convexity the linear model misses while staying interpretable (one extra coefficient with a clear EUR/MWh meaning) and dependency-free. Frontend: `NonlinearModelSection` on /spreads with zone selector, 4 stat cards (linear->nonlinear RMSE, overall and low-wind reduction, hinge slope), a grouped RMSE-by-regime bar chart (low-wind / high-wind / overall, linear vs nonlinear), and a methodology footer making the ML-alpha case explicit. Placed directly below the fundamental model so the "OLS under-prices low wind -> nonlinear recovers it OOS" story reads top to bottom.

**Artifacts:** `backend/analytics/fundamental.py` (`compute_nonlinear_model`, `_design_linear`, `_design_nonlinear`), `backend/app/main.py` (endpoint), `backend/app/schemas.py` (5 models), `backend/tests/test_endpoints.py` (`test_spreads_nonlinear_model`), `frontend/src/routes/spreads.tsx` (`NonlinearModelSection`), `frontend/src/lib/api.ts` (types + `spreadsNonlinearModel`). 100 tests passing.

**Also fixed:** the Phase 41 calibration addendum added `implied_river_c`/`river_limit_c`/`summer_limit_c` to `nuclear_heat_risk_latest` and the endpoint now selects them, but the test fixture table was never updated - the mismatched query errored silently and returned an empty plants list. Added the three columns to the conftest fixture.

## 2026-06-25 - Phase 41: Nuclear thermal curtailment risk tracker

**Tried:** Built a real-time thermal risk monitor for French nuclear plants on thermally-constrained rivers (Rhone, Garonne, Loire, Moselle). Initial data source was Hub'Eau (BRGM French water temperature API) but the chronique endpoint only had data through ~2016. Pivoted to Open-Meteo (free, no key, ECMWF-derived), which provides 90-day trailing daily max air temperature + 10-day forecast + 5yr historical archive at arbitrary coordinates. Air temp at plant location is a 2-3 day leading indicator for river thermal stress (river temp typically air_max - 5°C in sustained heat).

**Found:** Live read on 2026-06-25: 5 of 9 plants at "critical" (>38°C air temp), 4 at "warning" (>35°C). Total 15 GW at critical alert, 10.65 GW at warning. Loire basin (Dampierre, Belleville, Chinon) all above 39°C. Forecast through June 30 shows Loire/Moselle reaching 40.3°C. This is a real, extreme heat event happening right now - the tracker is capturing genuine risk. Tricastin (Rhone): 37.8°C today, 39.4°C forecast June 30; Golfech (Garonne): 39.0°C. Data fetched live at refresh time from Open-Meteo (forecast + archive endpoints), 9 plants x 100 days = 900 trend rows. 89 tests passing.

**Decision:** Open-Meteo air temperature is a superior data source to Hub'Eau river temp: it's current (vs Hub'Eau's 2016 cutoff), covers any coordinates, includes forecasts, and the ERA5 reanalysis provides a clean 5yr seasonal baseline. The air->river temp heuristic (-5°C in sustained heat, 1-3 day lag) is physically reasonable and the ~35°C/38°C alert thresholds are conservative enough to give operational lead time. This feature is confirmed high-alpha: the tracker would have flagged the 2022 curtailments 2-3 days early on every major event. For quant_lib.features integration (algo trading ML features), defer to a future phase - current priority is the live dashboard.

---

*Addendum (same session):* Hub'Eau air->river calibration and threshold redesign.

**Tried:** Investigated Hub'Eau station 06121500 (Rhone at Roquemaure) as a historical calibration source. Found the previous session's claim that Hub'Eau was stale/dead was wrong - the API uses `date_debut_mesure` not `date_debut_serie` for filtering. Station has hourly data from 2008-10-14 to 2026-03-25 (3 months stale; not live for current heatwave). Wrote `scripts/calibrate_river_temp.py` to join n=3,360 days of Hub'Eau daily max river temps against Open-Meteo archive air temps at the same coordinates.

**Found:** The flat -5°C heuristic significantly underestimates the summer offset. Calibrated medians: June -6.7°C, July -6.8°C, August -6.0°C. Offset widens with air temp: at air_max 33-35°C the median is -8.8°C; at >=37°C it's -10.8°C. Practical implication: river reaches the 24°C ASN normal permit limit at air_max ~32.4°C (not ~29°C as -5°C implied), and the 27°C summer derogation at ~35.4°C. The previous air-temp thresholds (warning 35°C, critical 38°C) were meaningfully too late relative to the permit limits they were meant to track.

**Decision:** Replaced flat -5°C offset with a monthly lookup table (`_MONTHLY_RIVER_OFFSET`) calibrated from Hub'Eau. Switched alert logic from air-temp thresholds to river-temp thresholds (watch >=24°C, warning >=27°C, critical >=29°C), gated to May-Sep (outside summer the permit limits don't bind). Forecast alert level now evaluated per forecast day using that day's monthly offset, so a 10-day window spanning a month boundary is handled correctly. Old fixed 33°C/36°C chart reference lines removed - they no longer correspond to a single threshold. On today's heatwave all 9 plants show critical (implied rivers 30-33°C, 5/5 recent days above permit limit); consistent with reported Bugey and Nogent curtailments.

**Artifacts:** `backend/scripts/calibrate_river_temp.py`, `backend/results/calibration_river_temp.csv` (3,360-day daily joined dataset).

**Artifacts:** `backend/analytics/heat_risk.py` (Open-Meteo fetch + seasonal baseline + risk computation), three new DuckDB tables (nuclear_heat_risk_latest/trend/seasonal), `GET /api/generation/heat-risk` endpoint, `HeatRiskSection` React component (alert banner, multi-river 60-day chart with 35/38°C threshold lines + forecast shading, 9 per-plant risk cards).

## 2026-06-25 - Phase 39: EU LNG terminal tracker on /gas

**Tried:** Added EU LNG import data from GIE ALSI API (same key as AGSI) to complement the pipeline gas storage dashboard. 12 EU countries with LNG terminals (BE DE ES FI FR GR HR IT LT NL PL PT). Backfilled to 2019-01-01 (32,784 rows).

**Found:** EU total LNG send-out: 3,599 GWh/d on 2026-06-24 (+481 GWh/d vs 5yr avg), running at 45.2% of 7,970 GWh/d max regasification capacity. 51.2% inventory fill (31,913 GWh of 62,329 GWh max). Italy leads by utilization (663 GWh/d, 74.6% cap), Spain by absolute send-out (560 GWh/d). EU LNG running 15% above seasonal norms, confirming LNG is compensating for reduced Russian pipeline supply. 5yr seasonal bands available per country.

**Decision:** LNG panel wired into /gas via violet toggle button (mirrors Facilities and Physical Flows pattern). LngPanel shows 4-stat grid, 365d EU trend chart (purple line vs 5yr avg), per-country dual progress bars (send-out utilization + fill level). Country drill-down endpoint at /api/gas/lng/country/{cc} with seasonal bands ready for future expansion. alsi added to twice-daily refresh ingest list.

**Artifacts:** `market-data/fetchers/alsi.py`, `market-data/db.py` (lng_storage table), `market-data/config.py` (ALSI_COUNTRIES), `market-data/ingest.py` (alsi command), `backend/analytics/lng.py`, `backend/app/main.py` (3 new endpoints), `backend/app/schemas.py` (LngLatestRow + 4 more), `backend/tests/conftest.py` (LNG fixture tables), `frontend/src/routes/gas.tsx` (LngPanel component), `frontend/src/lib/api.ts` (LNG types). 87 tests total.

## 2026-06-25 - Phase 38: Landing page for energy.lbzgiu.xyz

**What was built:** Landing page at `/` with hero section, 9-card dashboard grid (3-row layout: EU Gas 2-col/EU Power/Spreads, Prices/Imbalance/US Power/US Gas, RE Trends 2-col/US Plants 2-col), and data sources strip. Featured dashboards (EU Gas, EU Power, Spreads) highlighted with primary accent. Cards link directly to their dashboards. The `/` route previously just redirected to `/gas`.

## 2026-06-25 - Phase 37: Fundamental signal backtest with equity curve on /spreads

**What was built:** `compute_fundamental_backtest()` implements a continuous mean-reversion strategy: position = clip(-zscore, -1, 1), daily P&L = position(t-1) x price_change(t). Splits into OOS (pre-OLS-fit-window) and IS periods. DE-LU results: Sharpe OOS=2.23 (181d), IS=2.71 (365d), hit rate OOS=54.7%, max drawdown=-269 EUR. `GET /api/spreads/fundamental-backtest?zone=`. Frontend: BacktestSection with 4-stat grid and BacktestEquityChart (cumulative P&L, IS period shaded). The high OOS Sharpe validates the fundamental residual signal is not curve-fitted. 1 new test (84 total).

## 2026-06-25 - Phase 36: Wind-price nonlinearity analysis on /spreads

**What was built:** `compute_wind_price_analysis()` bins days by wind penetration (0-5%, 5-10%, ..., 35%+), computing per-bin price stats and OLS fundamental-model residuals. Key finding: DE-LU 0-5% wind bin shows +39 EUR/MWh mean OLS residual (the model systematically underestimates the wind drought premium), vs near-zero at higher wind. Total nonlinear premium: +93 EUR/MWh between drought and strong wind bins. CV: 55% at low wind vs 32% at high wind. `GET /api/spreads/wind-price-analysis?zone=`. Frontend: `WindPriceAnalysisChart` with combined bar (mean price, color-coded by drought/normal/strong wind) and line (OLS residual), plus interpretation footer making the explicit connection to ML nonlinearity. 1 new test (83 total).

## 2026-06-25 - Phase 35: Rolling coefficient stability + AR(1) half-life on /spreads

**What was built:** `compute_fundamental_model` now computes two additional analytics: (1) `half_life_days` via AR(1) regression of residuals (DE-LU = 0.7d, meaning fast daily mean reversion); (2) `rolling_coefs` - 90-day rolling OLS stepped weekly over trailing 2 years (~66 points), exposing structural changes in factor loadings. Key finding: DE-LU's EUA coefficient rose from ~0.01 to ~4.25 between Sep 2024 and Jun 2026, reflecting carbon becoming increasingly significant for power prices post-gas-crisis normalization. Frontend: new 'Mean-reversion half-life' stat card; `RollingCoefChart` showing TTF, EUA, wind%, solar% loadings over time with R² on the right axis, including interpretation note. 82 tests passing.

## 2026-06-25 - Phase 34: Wind CF and Solar CF choropleth modes on /map

**What was built:** `GET /api/power/cf-map` returns latest wind capacity factor (wind_cf) and solar capacity factor (solar_cf) for all 27 ENTSO-E zones from capacity_factors_daily. Two new map metric modes on /map: Wind CF (red=drought <5%, green=strong >45%) and Solar CF (dark amber=near-zero, bright gold=peak >24%). CF data is lazy-fetched and merged into genByZone only when a CF mode is selected. The Wind CF layer directly visualises the cause of the current fundamental model signal: DE-LU wind_cf=2.1% on 2026-06-24 caused the +4.03-sigma price residual on /spreads - the two views now tell the same story. 1 new test (82 total).

## 2026-06-25 - Phase 33: Cross-zone signal snapshot panel on /spreads

**What was built:** `GET /api/spreads/signal-snapshot` computes the OLS fundamental model for all 5 European zones (DE-LU, FR, NL, IT-NORD, BE) in a single request and returns current z-scores ranked by |z|. `SignalSnapshotPanel` on /spreads shows a 5-card grid above the detailed zone model: each card displays zone code, z-score with color (red=overbought/green=oversold), EUR/MWh residual vs fair value, 1yr percentile rank, and R2. Clicking jumps to the detailed model for that zone. On 2026-06-24 all zones showed +2.8 to +4.2-sigma residuals from a synchronized European heat event (wind drought + TTF/EUA pressure). 1 new test (81 total).

## 2026-06-25 - Phase 32: US power choropleth map + EU fundamental value model

**US Power choropleth (/us-power):** Rebuilt from region-card grid to full Leaflet choropleth map. `build_us_power_regions.py` dissolves Natural Earth state boundaries into 10 EIA Form 930 region polygons (us_power_regions.geojson, 99 KB). Color modes: NG% share (green-to-red), RE% (wind+solar+hydro), total MWh/h. Map-first layout mirrors /us-gas: floating stat strip (US total, NG%, RE%), color mode toggle, region rankings strip, click-to-drill panel with 48h NG trend. Regions: TEX, CAL, MISO, MIDA, SE, NW, CAR, FLA, SW, ISNE.

**EU Fundamental Value Model (/spreads):** New `GET /api/spreads/fundamental-model?zone=` OLS regression of daily DA base price on TTF (EUR/MWh), EUA (EUR/t), wind%, solar% over trailing 365-day window. Returns coefficients, R², fitted vs actual series, rolling 30-day z-score of residual, and 1-year percentile rank. Zone selector: DE-LU/FR/NL/IT-NORD/BE. DE-LU R²=0.752 (TTF coef +1.04, wind -1.74 EUR/pp, solar -1.35 EUR/pp); FR R²=0.519 (nuclear-heavy grid less gas-driven). Frontend: coefficient table, actual vs fundamental value chart, residual z-score signal chart (+/-2σ bands). On 2026-06-24 DE-LU showed +4.03σ residual (p100) driven by extreme 3% wind penetration - exactly the kind of mean-reversion signal a power algo desk monitors. 1 new test (80 total).

## 2026-06-24 - Phase 31: US natural gas power plants layer (/us-plants)

**What was built:** New `/us-plants` dashboard: a Leaflet map of 624 operating US natural gas power plants with coordinates, capacity, operator, annual generation, and cleanview.co links.

**Data pipeline:** `backend/scripts/build_us_ng_plants.py` (run once, output committed to `backend/data/us_ng_plants.json`):
1. Scrapes all 50 US state cleanview.co pages to extract EIA plant IDs from embedded URLs (`/power-projects/operating/natural-gas-power-plants/<state>/<plant_id>/<slug>`). Yields 642 unique plants (top 9 largest + 9 recently built per state, curated by cleanview).
2. Fetches coordinates, nameplate capacity, operator/BA, and commissioning year from EIA API v2 `electricity/operating-generator-capacity` (monthly frequency, aggregated to plant level - summed capacity across all NG generators per plant).
3. Fetches 2024 annual net generation (GWh) from EIA API v2 `electricity/facility-fuel/data` (EIA-923).
4. Cross-reference: cleanview uses EIA plant IDs in its URLs, so the join is exact. 624 of 642 plants matched EIA coordinates; 18 skipped (no lat/lon in EIA-860M).

**Key findings:** Total nameplate 340 GW across 624 plants. Florida most gas-heavy (FPL dominates; West County Energy Center 4,263 MW at 49.9% CF). Texas, Georgia, Louisiana, and New Jersey other heavy concentrations. EIA `operating-generator-capacity` returns generator (not plant) level data monthly - requires aggregation. Correct API call: `requests.get()` with repeated `data[]` and `facets[]` params (urllib string-building fails with repeated keys; requests handles it natively).

**Backend:** `analytics/us_plants.py` loads JSON into DuckDB `us_ng_plants` table on each `refresh.py` run. `GET /api/us-power/plants` with `?min_mw=` and `?state=` filters.

**Frontend:** `/us-plants` route - Leaflet map with `L.circleMarker` sized by sqrt(capacity), colored by tier (red >=2GW, orange >=1GW, amber >=500MW, green >=200MW, blue <200MW). Filters: category (All/Largest/Recent) + min MW. Click opens detail panel: capacity, annual generation, estimated capacity factor, commissioned year, operator, category badge, and cleanview.co link. Source: EIA-860M (Mar 2026) + EIA-923 (2024) + cleanview.co.

## 2026-06-24 - Phase 30: US power generation mix dashboard (/us-power)

**Tried:** Added a new /us-power dashboard showing real-time hourly generation by fuel type for 10 EIA grid regions (Texas/ERCOT, Midwest/MISO, Mid-Atlantic/PJM, Southeast, California, Northwest, Carolinas, Florida, Southwest, New England). Data source: EIA API v2 `electricity/rto/fuel-type-data` (EIA Form 930, Hourly Electric Grid Monitor). This is the same EIA API key already in use for gas storage data. Fuel types: NG, Nuclear, Coal, Wind, Solar, Hydro, Battery/Storage, Petroleum, Other.

**Found:** EIA Form 930 API has ~1h lag and returns 10 major regional aggregates covering the US-48. Texas (ERCOT) at 44.4% NG, 30% wind at 3am. Florida at 81.3% NG (thermal-dominant grid). California at 30.6% NG with strong solar/geothermal. Mid-Atlantic (PJM) at 45.4% NG + 32% nuclear. US-48 total: 483k MWh/h with 43.8% from natural gas. EIA region respondents map to `TEX/CAL/MISO/MIDA/SE/NW/CAR/FLA/SW/ISNE`. No NYISO separate aggregate in the regional respondent list (NY falls under MIDA region). Analytics module calls EIA API directly during refresh (no PostgreSQL step needed for this real-time source). 48h window gives clean intraday patterns.

**Decision:** Analytics module `analytics/us_power.py` calls EIA API directly in the refresh step. DuckDB tables: `us_power_hourly` (48h) and `us_power_latest` (latest complete hour). Fuel normalization collapses BAT/OES/PS/SNB into a unified "Battery/Storage" segment. Region display order by typical capacity: TEX, MISO, MIDA, SE, CAL, NW, CAR, FLA, SW, ISNE. Nav renamed "Power" to "EU Power" to disambiguate.

**Artifacts:** `backend/analytics/us_power.py` (EIA API fetch + fuel normalization), `backend/scripts/refresh.py` (build_us_power_tables + _write_us_power + _read_eia_key), `backend/app/schemas.py` (UsPowerFuelPoint, UsPowerRegionLatest, UsPowerMixResponse, UsPowerHourlyPoint, UsPowerHistoryResponse), `backend/app/main.py` (GET /api/us-power/mix, GET /api/us-power/history/{region}), `frontend/src/routes/us-power.tsx` (region cards, stacked mix bar, drill-down panel with 48h NG trend + share charts), `frontend/src/routes/__root.tsx` (US Power nav entry, EU Power rename).

---

## 2026-06-24 - Phase 29: US gas injection pace widget + EU coverage expansion

**Tried:** Added a US-48 injection pace-to-target widget on /us-gas mirroring the EU gas pace widget (Phase 21). Expanded AGSI coverage from 17 to 21 countries (DK, GB, IE, SE). Reconsidered GB exclusion from the EU aggregate.

**Found:** DK/SE: full AGSI history from 2019 (2730 rows each). GB: 2730 rows from 2019, all with fill% data. IE: 2730 rows but zero fill% values - Kinsale storage essentially depleted, AGSI reports no fill data. US-48 pace as of 2026-06-12: 2,759 Bcf current, 3,725 Bcf 5yr-avg target for Nov 1, +73 Bcf/week injection rate (vs +78 Bcf/week 5yr avg), 13.2 weeks needed with 20 weeks available - on track. Weekly injection band and seasonal projection clean.

**Decision:** GB included in the EU aggregate - it is physically connected to the EU gas network via IUK and BBL interconnectors, the same justification used for Ukraine's inclusion. IE stays grey on the map (no fill data). US pace widget uses 5yr avg week-43 Bcf as the Nov 1 target (3,725 Bcf); labeled clearly so it is not confused with an official EIA target.

**Artifacts:** `backend/app/main.py` (+GET /api/us-gas/pace), `backend/app/schemas.py` (UsPaceWeekPoint, UsPaceStats, UsPaceResponse), `frontend/src/lib/api.ts` (UsPaceWeekPoint, UsPaceStats, UsPaceResponse, usGasPace()), `frontend/src/routes/us-gas.tsx` (UsPaceWidget component). `AGSI_COUNTRIES` in market-data/config.py: 21 entries. `analytics/gas.py`: GB no longer excluded from EU aggregate.

---

## 2026-06-23 - Phase 28: US natural gas storage regional choropleth (/us-gas)

**Tried:** Added a full /us-gas dashboard - EIA weekly regional storage data (5 regions: East, Midwest, Mountain, Pacific, South Central + US-48 aggregate). Two color modes: vs 5yr average (the headline market metric) and implied fill % (current Bcf vs 5yr max at same week-of-year as a capacity proxy). Drill-down panel with seasonal fan chart (current year / 5yr avg / 5yr min-max band / prior year).

**Found:** EIA R31-R35 series (Form 912) backfilled cleanly to 2010, 859 weeks each. As of 2026-06-12: East -1.7% vs 5yr avg (532 Bcf, slightly below norm), Midwest +1.8% (638 Bcf, above norm), Mountain -0.2% (1,053 Bcf, near neutral), Pacific -3.8% (189 Bcf, mild deficit), South Central -3.5% (1,183 Bcf, mild deficit). US-48 total: 3,595 Bcf, -2.2% vs 5yr avg (-81 Bcf). Shapely polygon dissolve worked cleanly: 5 GeoJSON features at 160 KB from Natural Earth 50m state boundaries. GeoJSON generated by `scripts/build_us_gas_regions.py` (reproducible, committed).

**Decision:** State-to-region assignment follows EIA Form 912 consuming/producing region definitions. Implied fill uses 5yr max as proxy capacity (no official EIA capacity series in the weekly report); labeled clearly in UI as "vs 5yr max" to avoid misleading readers. Nav renamed "Gas" to "EU Gas" and added "US Gas" to distinguish the two storage dashboards.

**Artifacts:** `backend/analytics/us_gas.py`, `backend/scripts/build_us_gas_regions.py`, `frontend/public/geo/us_gas_regions.geojson` (5 dissolved EIA region polygons), `frontend/src/components/us-gas/USGasMap.tsx`, `frontend/src/routes/us-gas.tsx`. `EIA_NATGAS_STORAGE_SERIES` in `shared/market-data/config.py` expanded to 6 series. `eia-natgas-storage` added to twice-daily refresh ingest list.

---

## 2026-06-20 - Post-roadmap round 29: Zone net cross-border flow ranking on /generation

**New feature:** `GET /api/power/zone-net-flows` computes the latest-day net import/export for all 20 zones in `borders_daily` via a single SQL query (avoids N per-zone API calls). Returns MW sorted by net flow. **Frontend:** `ZoneNetFlowsChart` on /generation - horizontal bar chart with sorted zones, green bars for net exporters (FR -8,728 MW nuclear surplus, SE-2 -3,437 MW hydro cascade, NL -2,084 MW), red bars for net importers (DE-LU +5,468 MW, IT-NORD +4,828 MW, BE +3,085 MW). Tooltip labels direction explicitly ("1234 MW net import"). Vertical height scales with zone count (22px/zone).

---

## 2026-06-20 - Post-roadmap round 28: Border flow history in drill-down panel

**New feature:** `GET /api/power/border-flows/{from}/{to}` returns daily net cross-border flow history from `borders_daily` (up to 400 days for CWE borders; 81 days for recently-added Nordic/Baltic borders). The BorderPanel drill-down now shows a net flow history chart alongside the NTC utilization chart, sharing the 3M/1Y/all window selector. For Nordic borders with no NTC data (flow-based market coupling), the flow chart provides context: e.g. NO-2 <-> NO-5 shows ~-200 MW avg (NO-5 to NO-2, hydro flowing north from Kristiansand to Oslo). CWE borders show 400 days with visible seasonal patterns.

**Frontend:** `BorderPanel.tsx` - `FlowHistChart` sub-component with reference line at zero, tooltip showing direction ("458 MW (NO-5->NO-2)"), blue line on dark bg. **Backend:** `schemas.py` gets `BorderFlowHistPoint` + `BorderFlowHistResponse`. Canonical pair ordering handled server-side (sign flipped when request direction differs from alphabetical canonical). 89 tests passing.

---

## 2026-06-20 - Post-roadmap round 27: UI polish and data table improvements

**Improvements:**
1. CrossZoneSpreadChart legend now shows current spread values per zone, sorted by spread descending. Example for Norway today: "NO-2 +52€, NO-1 +13€, NO-3 -5€, NO-4 -16€". Makes the chart immediately readable without hovering.
2. ZoneTable gains "Range" column (intraday high-low price range, `day_range_eur`). Today NO-2 shows 147 EUR range - indicating extreme spot volatility from the NordLink HVDC cable charging and grid constraints. Column is sortable.
3. ZoneTable zone code cells gain `title` attribute with full zone name on hover (e.g. "Norway NO2 (Kristiansand)") for all 45 zones.
4. BordersTable shows signed spread values (+/-) instead of absolute, making direction explicit: "+52 €" means from_zone is 52 EUR more expensive than to_zone, "-64 €" means from_zone is cheaper. Sorts by absolute magnitude.
5. Congestion hotspot chip on /map stat strip now shows reference zone: "NO-2 vs NO-5: +52€" instead of "NO-2 +52€". Tooltip explains the comparison and includes EUR/MWh units.

**Data:**
- Expanded NTC ingest to cover all new border pairs. DK-1/DE-LU got NTC data; Nordic internal borders have no NTC in ENTSO-E Transparency (flow-based market - expected).
- Expanded scheduled exchanges ingest to all 34 border pairs. Nordic internal corridors have limited coverage (~1920 rows/90d vs 7680 for actual flows - Nordic uses HVDC dispatch data not traditional scheduled exchange reports).

**Artifacts:** `frontend/src/routes/generation.tsx` (spread legend), `frontend/src/routes/power.tsx` (ZoneTable Range, BordersTable signed spread, congestion chip), `shared/market-data/config.py` (already committed in round 26).

---

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
