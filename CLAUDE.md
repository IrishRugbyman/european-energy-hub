# CLAUDE.md - European Energy Hub

Standalone live web app at **energy.lbzgiu.xyz**. Five dashboards:
**/gas** (EU gas storage choropleth, AGSI+), **/power** (day-ahead price choropleth by ENTSO-E bidding zone),
**/generation** (renewable % choropleth by bidding zone, Rebase Grid API),
**/spreads** (CSS/CDS/FSS spark/dark spread analytics), **/prices** (TTF/EUA/coal/HH commodity charts).
Sister site to freight.lbzgiu.xyz, same stack and conventions.

**Active build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).** Phase 1-5 built. Phase 5 is live in code
but the /generation map needs one manual refresh once the rebase-generation backfill finishes.
Check backfill status: `tail /tmp/rebase_backfill.log` or `ps aux | grep ingest`.
Once done: `cd ~/quant/energy/backend && .venv/bin/python scripts/refresh.py --skip-ingest`

## Key paths

| Path | Role |
|---|---|
| `backend/app/main.py` | FastAPI :8004, all endpoints |
| `backend/scripts/refresh.py` | Rebuilds energy_hub.duckdb from commo.duckdb |
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

# Manual refresh (populate generation tables once backfill finishes)
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
