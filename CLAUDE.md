# CLAUDE.md - European Energy Hub

Standalone live web app at **energy.lbzgiu.xyz**. Five dashboards:
**/gas** (EU gas storage choropleth, AGSI+), **/map** (unified power+generation choropleth - six metric
modes: Price/Range/Neg-hrs/2yr-rank + Renewable%/Dominant-fuel; interconnections toggle; unified zone
panel with price stats, fuel breakdown, 48h price chart, daily gen+RE% trend, daily price range),
**/spreads** (CSS/CDS/FSS spark/dark spread analytics), **/prices** (TTF/EUA/coal/HH commodity charts),
**/imbalance** (German reBAP imbalance prices, Netztransparenz), plus the US cluster (/us-gas, /us-power,
/us-plants). The unified map lives at **/power**; `/map` redirects to it. `/generation` is its own
route. Sister site to freight.lbzgiu.xyz, same stack and conventions.

Each half has its own CLAUDE.md with the detail that belongs to it - read the one for the side you
are working on: [`backend/CLAUDE.md`](backend/CLAUDE.md) (build-time vs request-time analytics, the
snapshot swap, the ingest guards, the TTL cache, test fixtures) and
[`frontend/CLAUDE.md`](frontend/CLAUDE.md) (routing, the `api` object and staleTime tiers, the
imperative map layer, what has to live in `lib/` to stay testable).

**Data source: PostgreSQL `market_data`, NOT commo.duckdb.** Following the repo-wide
DuckDB -> PostgreSQL migration (2026-06-13), `refresh.py` and the `analytics/` modules read
from the `market_data` PostgreSQL database via the market-data `loaders/` package
(`get_read_conn()` / `_query()`, DSN `postgresql:///market_data`). They do NOT open commo.duckdb
(which is deleted; only a legacy backup ever existed). Only the *output* DB, `energy_hub.duckdb`,
is still DuckDB - it is precomputed by `refresh.py` and served read-only by the API.

## Key paths

| Path | Role |
|---|---|
| `backend/app/main.py` | FastAPI :8004, all endpoints |
| `backend/scripts/refresh.py` | Rebuilds energy_hub.duckdb from the `market_data` PostgreSQL DB |
| `backend/analytics/` | gas.py, power.py, spreads.py, flows.py, generation.py |
| `backend/data/energy_hub.duckdb` | Precomputed read-only DB served by API |
| `frontend/src/routes/` | gas.tsx, power.tsx (the unified map), generation.tsx, spreads.tsx, prices.tsx, imbalance.tsx, us-*.tsx; map.tsx redirects to /power |
| `frontend/src/components/map/` | EuroMap.tsx (unified choropleth, MapMetric), UnifiedZonePanel.tsx |
| `frontend/public/geo/` | countries.geojson (GISCO 1:3M), bidding_zones.geojson (EM-contrib) |
| `nginx-energy.conf` | Production nginx config (TLS) |
| `energy-api.service` | systemd unit, :8004 |
| `energy-refresh.service/.timer` | Twice-daily refresh (13:45 + 20:15 UTC) |

## Service commands

```bash
sudo systemctl restart energy-api.service
sudo systemctl status energy-refresh.timer
sudo journalctl -u energy-api -n 50 --no-pager

# Manual refresh (rebuild energy_hub.duckdb from PostgreSQL; --skip-ingest skips the fetch step)
cd ~/quant/energy/backend
.venv/bin/python scripts/refresh.py --skip-ingest
```

## Stack
React 19 + Vite + TypeScript + TanStack Router/Query + Leaflet + recharts + Tailwind v4.
FastAPI + DuckDB + uv venv. Nginx + certbot TLS. Cloudflare proxy.

## Data sources
- AGSI+ gas storage (agsi.gie.eu) - gas dashboard
- ENTSO-E Transparency (transparency.entsoe.eu) - power prices, cross-border flows (NTC, scheduled, congestion), generation mix (A75 full fuel mix including nuclear; replaces Rebase Grid API as of Phase 12)
- ENTSOG (entsog.eu) - physical gas flows overlay on /gas
- Netztransparenz (netztransparenz.de) - German reBAP imbalance prices (/imbalance), via the
  four TSOs' Daten-API (fetcher `rebap-de`). Not SMARD: the earlier SMARD module-4169 series was
  the DE/LU day-ahead price mislabelled as reBAP and has been purged. See the post-mortem in
  `market-data/fetchers/smard_imbalance.py`. Quality-assured reBAP lags ~2 weeks, so /imbalance
  backtests but cannot drive a live *price* signal; the page states the lag explicitly (Phase 87).
  The same API's NRV-Saldo (fetcher `nrv-saldo-de`, near-real-time operational variant) feeds the
  `nrv_dev_lag1` feature in `compute_rebap_signal`'s reBAP trend-deviation signal (Phase 86).
- EDF SEI (opendata.edf.fr) - Corsica (FR-COR) generation mix + subsea cable imports. See below.
- TTF front-month: ICE via DB.nomics
- EUA: yfinance CO2.L
- Coal API2: IMF via DB.nomics
- Henry Hub: CME NYMEX via yfinance

## Generation data coverage
`refresh.py` calls `entso-e-gen-full` (not `rebase-generation`) for incremental updates. **Backfill is
complete** (verified 2026-07-31): all 45 zones span 2020-12-31 to present, 25.7M rows. The only gap is
AL (Albania), whose ENTSO-E publication is sparse and stops 2026-06-23.

Incremental progress per zone comes from `_gen_full_progress()` in `market-data/fetchers/entso_e.py`,
which takes the max ts over non-wind/solar techs. Do **not** revert it to keying on a single tech: it
previously keyed on nuclear, which meant the 31 zones with no nuclear fleet re-fetched from 2021-01-01
on every run, and DE-LU re-fetched from 2023-04-15 (its reactor shutdown date) forever. That was the
whole reason a refresh took 2-3 hours instead of ~1 minute.

## Corsica (FR-COR): a 46th generation zone with no price
Corsica is not an ENTSO-E bidding zone - it clears inside FR and is run by EDF SEI as a
non-interconnected system, so it has **no market price and never will** (regulated tariff + CSPE).
`entso-e-gen-full` therefore never sees it; `refresh.py` runs `edf-sei-corsica` for it instead.

Consequences to keep in mind:
- `generation_*` tables carry 46 zones, `power_*` tables carry 45. Any code that assumes the two
  zone lists match will be wrong. `ZoneTable` iterates `power` and left-joins gen, so it is safe.
- **The realtime EDF feed keeps only a rolling 14-day window.** If `energy-refresh.timer` is off for
  more than a fortnight, those days are lost permanently - there is no way to re-fetch them.
- There is a permanent hole from 2025-01-01 to 2026-07-20: the EDF history set is frozen at
  2024-12-31 and the realtime feed only reaches back 14 days. No public dataset fills it.
  `island_daily` is padded with NULL rows across it *on purpose* - never filter them out before
  charting, or the line joins 2024-12-31 to 2026-07-20 and presents absence as measurement.
- Cable flow lands in `island_net_imports`, not `cross_border_flows` and not the fuel mix.

**The no-price treatment.** `NO_PRICE_ZONES` in `frontend/src/lib/scales.ts` must stay in sync with
`ISLAND_ZONES` in `backend/analytics/island.py`. Under the four price metrics (Price/Range/Neg-hrs/
2yr-rank) `EuroMap` gives these zones a dedicated fill plus a dashed stroke, never the `#374151`
missing-data grey: "no market exists" and "the fetch failed" must not look alike. All path styling
goes through the single `zoneStyle()` helper so the initial render, the data-change re-style, and
the mouseout restore cannot drift. `UnifiedZonePanel` swaps its Price tab for an **Island system**
tab (`/api/island/{zone}`) and gates the price queries with `enabled: !noPrice` so they do not 404
on every selection. The active tab is *derived*, not stored, because the panel is not remounted
when the selected zone changes.

## Reference implementation: `~/quant/freight/`
When unsure how to structure anything (db.py, systemd units, nginx, test fixtures, route layout),
open the corresponding freight file and mirror it.
