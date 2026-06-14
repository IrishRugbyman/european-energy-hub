# CLAUDE.md - European Energy Hub

Standalone live web app at **energy.lbzgiu.xyz**. Five dashboards:
**/gas** (EU gas storage choropleth, AGSI+), **/power** (day-ahead price choropleth by ENTSO-E bidding zone),
**/generation** (renewable % choropleth by bidding zone, Rebase Grid API),
**/spreads** (CSS/CDS/FSS spark/dark spread analytics), **/prices** (TTF/EUA/coal/HH commodity charts).
Sister site to freight.lbzgiu.xyz, same stack and conventions.

**Active build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).** Phase 1-5 built and live, including /generation.

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
| `frontend/src/routes/` | gas.tsx, power.tsx, generation.tsx, spreads.tsx, prices.tsx |
| `frontend/src/components/generation/` | GenMap.tsx, ZoneGenPanel.tsx |
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
- ENTSO-E Transparency (transparency.entsoe.eu) - power prices, cross-border flows
- Rebase Grid API (grid.rebase.energy) - generation mix by fuel type (beta key in market-data/.env)
- TTF front-month: ICE via DB.nomics
- EUA: yfinance CO2.L
- Coal API2: IMF via DB.nomics
- Henry Hub: CME NYMEX via yfinance

## Reference implementation: `~/quant/freight/`
When unsure how to structure anything (db.py, systemd units, nginx, test fixtures, route layout),
open the corresponding freight file and mirror it.
