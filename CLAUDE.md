# CLAUDE.md - European Energy Hub

Standalone live web app at **energy.lbzgiu.xyz**. Four dashboards:
**/gas** (EU gas storage choropleth, AGSI+), **/power** (day-ahead price choropleth by ENTSO-E bidding zone),
**/spreads** (CSS/CDS/FSS spark/dark spread analytics), **/prices** (TTF/EUA/coal/HH commodity charts).
Sister site to freight.lbzgiu.xyz, same stack and conventions.

**Active build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).** Phase 1-4 + Rebase generation mix are complete.
ENTSO-E backfill still running (34 zones from 2019-01-01, check with `ps aux | grep entso`).
Once backfill finishes: run `scripts/refresh.py --skip-ingest` to populate power/spreads tables,
then `ingest.py rebase-generation --from-date 2019-01-01` for generation mix history.

## Key paths

| Path | Role |
|---|---|
| `backend/app/main.py` | FastAPI :8004, all endpoints |
| `backend/scripts/refresh.py` | Rebuilds energy_hub.duckdb from commo.duckdb |
| `backend/analytics/` | gas.py, power.py, spreads.py, flows.py, generation.py |
| `backend/data/energy_hub.duckdb` | Precomputed read-only DB served by API |
| `frontend/src/routes/` | gas.tsx, power.tsx, spreads.tsx, prices.tsx |
| `frontend/public/geo/` | countries.geojson (GISCO 1:3M), bidding_zones.geojson (EM-contrib) |
| `nginx-energy.conf` | Production nginx config (TLS) |
| `energy-api.service` | systemd unit, :8004 |
| `energy-refresh.service/.timer` | Twice-daily refresh (13:45 + 20:15 UTC) |

## Service commands

```bash
sudo systemctl restart energy-api.service
sudo systemctl status energy-refresh.timer
sudo journalctl -u energy-api -n 50 --no-pager

# Manual refresh (after backfill finishes)
cd ~/quant/energy/backend
.venv/bin/python scripts/refresh.py --skip-ingest

# Run Rebase generation backfill (after ENTSO-E backfill finishes)
cd ~/quant/shared/market-data
.venv/bin/python ingest.py rebase-generation --from-date 2019-01-01
```

## Stack
React 19 + Vite + TypeScript + TanStack Router/Query + Leaflet + recharts + Tailwind v4.
FastAPI + DuckDB + uv venv. Nginx + certbot TLS. Cloudflare proxy.

## Data sources
- AGSI+ gas storage (agsi.gie.eu) - gas dashboard
- ENTSO-E Transparency (transparency.entsoe.eu) - power prices, cross-border flows
- Rebase Grid API (grid.rebase.energy) - generation mix by fuel type (beta key in market-data/.env)
- TTF front-month: ICE via DB.nomics
- EUA: yfinance CO2.L
- Coal API2: IMF via DB.nomics
- Henry Hub: CME NYMEX via yfinance

## Reference implementation: `~/quant/freight/`
When unsure how to structure anything (db.py, systemd units, nginx, test fixtures, route layout),
open the corresponding freight file and mirror it.
