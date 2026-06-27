# European Energy Hub

Live dashboard for European gas and power markets - [energy.lbzgiu.xyz](https://energy.lbzgiu.xyz)

[![CI](https://github.com/IrishRugbyman/european-energy-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/IrishRugbyman/european-energy-hub/actions/workflows/ci.yml)

Daily-refreshing data from AGSI+, ENTSO-E, ENTSOG, and SMARD across five dashboards and 60+ API endpoints. The /spreads page documents a 57-phase quantitative signal research arc on day-ahead power fair value.

---

## Dashboards

| Route | What it shows |
|---|---|
| `/gas` | EU gas storage by country - fill %, 5-year seasonal band, injection/withdrawal pace, ENTSOG physical flows overlay, LNG terminal status |
| `/map` | Day-ahead power prices and generation by ENTSO-E bidding zone (27 zones). Six metric modes: Price, Range, Negative-hours, 2yr-rank, Renewable%, Dominant fuel. Interconnection flows toggle. Zone panel: 48h price chart, fuel breakdown, daily generation + RE% trend, daily price range. |
| `/spreads` | Clean spark/dark/fuel-switching spread analytics with the full signal-research arc below |
| `/prices` | TTF, EUA, API2 coal, Henry Hub - time series, seasonality decomposition, cross-commodity correlation matrix |
| `/imbalance` | German reBAP imbalance prices (SMARD) with a walk-forward forecast-error signal (70.3% directional accuracy, Sharpe 3.75 OOS) |

US dashboards at `/us-gas`, `/us-power`, `/us-plants` cover EIA storage regions, generation mix by ISO, and 624 natural gas power plants on a Leaflet map.

---

## Signal research - /spreads

The spreads page is a live, interactive record of a 57-phase iterative research arc on European day-ahead power fair value and the residual fade trade. Each phase is documented with what was tried, what was found, and what decision it drove - including phases where the hypothesis was wrong.

### The core thesis

DA power prices exhibit a nonlinear response to renewable penetration. A low-wind hinge basis explains more OOS variance than a linear fair-value model, and the hinge residual mean-reverts with half-lives of 1.2-2.7 trading days across all five fundamental zones (BE, DE-LU, FR, IT-NORD, NL).

### Research arc summary (phases 42-57)

**Fair-value model:**
Linear OLS baseline (TTF, EUA, wind%, solar%) extended to a nonlinear hinge OLS with a single additional coefficient: DA price drops sharply once wind penetration exceeds each zone's 25th-percentile threshold, approximately +10 EUR/MWh per percentage-point below the knot on DE-LU and NL. The entire arc uses ENTSO-E A69 day-ahead forecasts at gate closure, not realised generation. The look-ahead premium (realised vs forecast) is measured explicitly: +0.91 gross Sharpe on DE-LU, i.e. about 43% of the peeking edge was hindsight.

**Backtests and robustness:**
- Walk-forward OOS with 252-day training windows, 1-day OOS prediction, signals aligned to gate-closure information
- Cost robustness: the nonlinear edge survives 2 EUR/MWh round-trip execution cost on 4 of 5 zones and, critically, *trades less frequently* than the linear baseline
- Cross-zone dose-response: nonlinear edge scales with wind penetration (r = +0.88 across zones, p < 0.01), confirming the mechanism rather than asserting it

**Complexity ladder (fit vs. signal):**
Enriched factors (residual demand GW, day-over-day TTF move, D-1 nuclear output lag) tighten OOS RMSE on 4 of 5 zones but reduce tradeable Sharpe almost everywhere. A tighter fair-value model absorbs the mean-reverting residual the fade trades. LightGBM trails the hinge OLS on tradeable Sharpe on every single zone despite winning RMSE on two. The arc's conclusion: the parsimonious one-hinge model is the right fair-value model for a *tradeable* signal. Complexity past that point buys fit and costs alpha.

**Residual diagnostics:**
Before any P&L is shown, the residual mean-reversion premise is tested directly. On all five zones: OU/AR(1) half-life 1.2-2.7 days, Lo-MacKinlay variance ratio 0.08-0.18 (random-walk rejected at p < 0.05), variance-scaling Hurst 0.01-0.05. The classical rescaled-range (R/S) Hurst estimator was rejected because it is upward-biased on short mean-reverting series (reads 0.7-0.9 vs the OU and VR results of ~0.05) - the diagnostic choice is documented and justified.

**Portfolio:**
Five-zone inverse-vol blended book (genuinely OOS: rolling 252-day trailing weights lagged one day). OOS portfolio Sharpe 3.80 vs 1.16 for DE-LU alone. Diversification ratio 1.34x. Euler risk attribution is balanced across zones (16-22% each), so no single hub is load-bearing.

**Robustness triad:**
| Metric | Portfolio | DE-LU alone |
|---|---|---|
| OOS Sharpe | 3.80 | 1.16 |
| Deflated Sharpe (25-trial haircut) | 0.99 | 0.22 |
| Block-bootstrap 90% CI (10-day blocks, 2000 resamples) | [2.67, 5.12] | [0.10, 2.25] |

The single-zone DE-LU book collapses on both tests. The portfolio survives both, and the contrast is the lesson: diversification across low-correlation zone fades, not any one signal, is what clears the multiple-testing bar.

**Falsified hypotheses (documented, not hidden):**
Phase 57 tested whether a nuclear × wind interaction term belongs in the enriched model. The hypothesis was wrong in direction (the coefficient is negative - oversupply occurs when both nuclear AND wind are simultaneously high, not when nuclear is low). AIC-justified on 1 of 5 zones (BE), BIC disagrees, and the Sharpe improves only on BE. The section ships as a documented falsifiable test, not a retraction: the negative coefficient is economically meaningful (joint supply shock), but the enriched baseline is the right canonical model.

### reBAP signal (/imbalance)

Walk-forward OLS predicting whether next-day German reBAP will be above or below its 5-day trailing mean. Features at D-1 gate closure: wind forecast error, solar forecast error, DA wind forecast as % of load, prior-day reBAP deviation from trend. Model accuracy on the excess-above-trend target: **70.3%** vs 50.5% naive. OOS Sharpe **3.75** net of 2 EUR/MWh round-trip cost. All four coefficients are stable (CV < 1) with economically correct signs.

The naive always-long baseline earns Sharpe 39 - this is structural, not skill, because reBAP is positive 99.6% of OOS days. Target framing (excess above trend, not raw level) is the methodological point: always verify the naive before reporting directional accuracy on a skewed target.

---

## Architecture

```
PostgreSQL market_data  ──►  refresh.py (twice daily)  ──►  energy_hub.duckdb (read-only)
                                                                      |
                                                              FastAPI :8004
                                                                      |
                                                           nginx TLS reverse proxy
                                                                      |
                                                         React 19 / Vite SPA (CDN-cached)
```

`refresh.py` reads the shared `market_data` PostgreSQL database via the `market-data` loaders package and writes a precomputed `energy_hub.duckdb`. The API is strictly read-only against the DuckDB file; the live PostgreSQL is never touched at request time. `energy-refresh.timer` fires twice daily: 13:45 UTC (after ENTSO-E day-ahead price publication) and 20:15 UTC (after AGSI gas-day publication).

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, TanStack Router + Query, Leaflet, recharts, Tailwind v4 |
| Backend | FastAPI, DuckDB 1.5, pandas, LightGBM, slowapi (rate limiting) |
| Pipeline | Python 3.12, psycopg2, quant-lib (OU/VR/Hurst diagnostics, block bootstrap) |
| Deployment | systemd (energy-api.service + energy-refresh.timer), nginx, certbot, Cloudflare |

---

## Data sources

All sources are free public APIs. No synthetic data.

| Source | Coverage |
|---|---|
| [AGSI+](https://agsi.gie.eu) | EU gas storage by country, daily |
| [ENTSO-E Transparency](https://transparency.entsoe.eu) | DA prices, cross-border flows (NTC + scheduled), full generation mix (A75), DA generation forecasts (A69), 27 bidding zones |
| [ENTSOG](https://www.entsog.eu) | Physical gas flows |
| [SMARD](https://www.smard.de) | German reBAP imbalance prices, realised renewable generation + load |
| [DB.nomics / ICE](https://db.nomics.world) | TTF front-month |
| yfinance (CO2.L) | EUA front-month |
| [IMF via DB.nomics](https://db.nomics.world) | API2 coal (monthly) |
| yfinance (NG=F) | Henry Hub front-month |
| [EIA API](https://www.eia.gov/opendata) | US gas storage by region, US generation by ISO, 624 NG power plants |

---

## Running locally

**Prerequisites:** Python 3.12+, Node 20+, `uv`, and a populated `market_data` PostgreSQL database (see `~/quant/shared/market-data`).

**Backend:**

```bash
cd backend
uv sync
# build the serving DB from existing market_data (skip the network fetch step)
.venv/bin/python scripts/refresh.py --skip-ingest
# start the API
.venv/bin/python -m uvicorn app.main:app --port 8004 --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev    # Vite dev server; /api proxied to :8004
```

**Tests:**

```bash
cd backend
.venv/bin/python -m pytest          # 108 tests
.venv/bin/python -m pytest --cov    # with coverage
```

Tests use a seeded in-memory DuckDB fixture and `fastapi.testclient.TestClient` - no live database or network access required.

**Manual data refresh:**

```bash
# full refresh (fetch + rebuild)
.venv/bin/python scripts/refresh.py

# skip fetch, rebuild from existing market_data
.venv/bin/python scripts/refresh.py --skip-ingest
```

---

## Production deployment

Runs on a Hetzner CX33 (Helsinki). Deployment notes for reference:

```bash
# backend change
sudo systemctl restart energy-api.service
sudo journalctl -u energy-api -n 50 --no-pager

# frontend change (dist/ is the nginx root)
cd frontend && npm run build

# manual data refresh
cd backend && .venv/bin/python scripts/refresh.py --skip-ingest
```

Refresh schedule: `energy-refresh.timer` (persistent, catches up after downtime). TLS: certbot auto-renewed. DNS: Cloudflare orange-cloud proxy.
