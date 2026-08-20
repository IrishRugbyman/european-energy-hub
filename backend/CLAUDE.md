# CLAUDE.md - energy backend

Assumes `~/quant/energy/CLAUDE.md` (dashboards, data sources, the Corsica/no-price rules,
generation coverage) has been read; this file covers only what is specific to `backend/`.

## Shape of the tree

```
app/          FastAPI service on :8004. main.py (~6.1k lines, 109 GET endpoints) +
              schemas.py (~2.4k lines of pydantic response models) + db.py (the only
              DuckDB handle) + project_paths.py (ENERGY_DB override).
analytics/    Two different kinds of module living in one directory - see below.
scripts/      refresh.py (the batch job) + build_us_*.py / calibrate_river_temp.py,
              which are one-shot, run by hand, and write committed artefacts.
tests/        pytest, TestClient + a session-scoped seeded temp DuckDB. conftest.py
              owns every fixture.
data/         energy_hub.duckdb (+ .ts sidecar) written by refresh.py, never committed;
              us_ng_plants.json and analytics/wm_to_agsi.json ARE committed inputs.
results/      calibration_river_temp.csv, output of the one-shot calibration script.
```

`app/main.py` is one module by design (single `app`, no routers), mirroring freight. A new
endpoint goes in main.py next to its domain neighbours, its response model in `schemas.py`,
and a method on the `api` object in `frontend/src/lib/api.ts`. Do not split main.py into
routers as a drive-by refactor.

## The two kinds of analytics module

This is the single most important distinction in the backend, and the directory does not
advertise it.

**Build-time** (`gas`, `lng`, `power`, `spreads`, `flows`, `generation`, `island`,
`imbalance.build_imbalance_tables`, `congestion`, `gas_flows`, `divergence`, `hydro`,
`hydro_balance`, `us_gas`, `us_power`, `us_plants`, `battery`, `heat_risk`): called only by
`refresh.py`. They read the **PostgreSQL `market_data`** DB through the market-data loaders
(`from loaders._base import get_read_conn, _query`) and return `dict[str, DataFrame]` that a
`_write_*` helper in refresh.py persists. They must never touch energy_hub.duckdb.
`heat_risk` and `us_power` are the exceptions that call an external HTTP API (Open-Meteo,
EIA) instead of PostgreSQL.

**Request-time** (`fundamental.py`, `nuclear.py`, `imbalance.compute_rebap_signal`):
imported lazily inside the endpoint body and called per request. They take a `query_fn`
(always `db.query`) and read **energy_hub.duckdb**. They have no refresh dependency, which
is what makes them testable against the fixture DB and what makes a model change deploy with
a service restart rather than a rebuild.

## Hard rules

1. **The API never writes.** `db.query()` opens `read_only=True` thread-local connections.
   The sole writer of energy_hub.duckdb is `scripts/refresh.py`.
2. **All DB access goes through `app/db.py`.** Never `duckdb.connect` in an endpoint: db.py
   is what honours the `ENERGY_DB` env var, and that override is what makes the test suite
   possible.
3. **Market data is read through the market-data `loaders/` package** (quant-wide rule),
   not a raw psycopg2 connection.
4. **Placeholder styles differ**: DuckDB uses `?`, PostgreSQL uses `%s` and `= ANY(%s)` with
   a Python list. Mixing them is the easiest bug to write here.
5. **`db.query()` returns an empty DataFrame on failure**, including a missing DB file and a
   missing table (`CatalogException`); it never raises. Every endpoint must handle
   `df.empty` explicitly, and choose deliberately between an empty-but-valid body (a normal
   state on a fresh machine) and an explicit `HTTPException(404)` (as `/api/island/{zone}`
   does for a zone that is not an island).

## The snapshot swap

`refresh.py` builds every table in memory, writes them into a fresh `energy_hub_new.duckdb`
inside one transaction, `os.replace()`s it over the live file, then writes the
`energy_hub.duckdb.ts` sidecar. `db.py` stats that sidecar before each query and reopens its
thread-local connection when the mtime moves, so the API serves a fully consistent snapshot
throughout a ~10 minute rebuild without ever contending on the file.

All four properties are load-bearing: temp file, single transaction with rollback + unlink on
failure, atomic rename, sidecar bump. Keep them in any change to the write path.

## The ingest step

`INGEST_FETCHERS` in refresh.py is a list of bare strings shelled out to market-data's
`ingest.py` in a subprocess. Fetcher failures are logged as warnings and the rebuild
continues (exit 0); only a rebuild failure exits 1. That tolerance is deliberate, and it is
also how two silent outages happened, so `tests/test_refresh_fetchers.py` now guards the
list: no duplicates, no disabled fetchers (`smard-imbalance-de` raises on call), `rebap-de`
and `entso-e-hydro` present, every timeout override attached to a fetcher that actually runs
and no smaller than the 600 s default, and every name a real `ingest.py` command. Add a
fetcher and the guards apply automatically; remove one and expect a red test.

`INGEST_TIMEOUTS` overrides exist because ENTSO-E answers 429 with a [60, 120, 240, 480]s
backoff ladder, so a rate-limited fetcher can legitimately sit for ~15 min per chunk. Every
value must stay under the unit's `TimeoutStartSec=3600` or it can never fire.

## Request-time compute and the TTL cache

The `/spreads` model endpoints refit walk-forward OLS/LightGBM on every request. They are all
wrapped in `_cached_compute(key, fn, ttl)`, an in-process dict + lock:

| TTL | Used for |
|---|---|
| 300 s | signal-freshness endpoints (`fundamental_{zone}`, `signal_snapshot`) |
| 600 s | the `_API_CACHE_TTL` default |
| 3600 s | backtests, robustness sweeps, seasonality: expensive and slow-moving |

Any new endpoint that fits a model must be wrapped, and **the cache key must include every
parameter** (`f"nl_model_{zone}"`, not `"nl_model"`) or one zone's result will be served for
another. The cache is per-process and dies on restart; that is fine, the frontend's 1 h
`staleTime` means the first visitor after a refresh warms it for everyone else.

## analytics/fundamental.py

3.4k lines, the whole `/spreads` signal stack: linear fundamental model -> nonlinear
(low-wind knot) -> enriched (residual demand, dTTF, nuclear) -> GBM -> portfolio backtest,
plus the factor tests (storage, load error, reBAP z-score, zone signal correlations) and the
robustness layer (deflated Sharpe, PSR, block-bootstrap CI).

Conventions to preserve: every entry point takes `query_fn` as its first argument so it can
be pointed at a fixture DB; walk-forward only (`WF_MIN_TRAIN` before the first OOS
prediction, `WF_MAX_OOS` caps the evaluation window to bound response time); costs are
explicit (`EDGE_NET_COST`, `COST_GRID`); the bootstrap seed is fixed (`PORTFOLIO_BOOT_SEED`)
so a reported CI is reproducible across requests. Do not add an endpoint that reports
in-sample fit as though it were performance.

## Middleware and serving

- slowapi limiter, 120/minute per IP, 429 JSON body.
- GZip above 1024 bytes.
- CORS is an explicit allow-list: `https://energy.lbzgiu.xyz` + `http://localhost:5173`,
  GET only.

## Tests

```bash
cd backend && uv sync --extra dev
.venv/bin/python -m pytest -q
.venv/bin/python -m pytest tests/test_island.py -q
.venv/bin/python scripts/refresh.py --skip-ingest   # rebuild without the fetch step
```

`tests/conftest.py` seeds one temp DuckDB (`seeded_db`, session-scoped for speed) with DE,
FR and an EU aggregate over ~3 years, and the `client` fixture points `ENERGY_DB` at it
before importing `app.main`. Add tables to `_seed_db` rather than building a DuckDB inside a
test.

**Every new endpoint gets a test** (quant-wide convention for FastAPI services), and it must
assert the degenerate path too: an unknown zone, an empty table, a 404 that is by design.
Pure logic gets ordinary unit tests: `test_island.py` and `test_generation.py` are that.
Small synthetic arrays inside a test are fine; the no-synthetic-data rule governs production
analysis inputs, not fixtures.

## Lint and typecheck

`ruff check backend/` and `ruff format --check backend/` run in CI (`.github/workflows/ci.yml`)
and in the pre-commit hooks. Pyright config lives at the repo root: `typeCheckingMode` is
deliberately `off` (this code is pandas-heavy and untyped; `basic` produced ~770 false
positives), but `reportMissingImports` stays `error`, and `extraPaths` points at the
market-data and quant-lib source trees because pyright cannot follow uv's PEP 660 editable
install hooks. Do not "fix" that config by turning type checking on without dealing with the
noise first.

## Gotchas

- **`energy-refresh.timer` declares `Requires=energy-refresh.service`**, so
  `systemctl stop energy-refresh.service` (the natural response to a stuck run) silently
  stops the timer too. Always `systemctl start energy-refresh.timer` afterwards and confirm
  a NEXT elapse in `systemctl list-timers`.
- `TimeoutStartSec=3600` on the refresh unit exists because the rebuild phase makes unbounded
  HTTP calls (Open-Meteo, EIA) with no per-request timeout; without it a hung external API
  leaves the unit "activating" forever and the timer reports no next elapse.
- `generation_*` and `island_*` tables carry 46 zones, `power_*` carries 45 (Corsica has no
  price). Any code that assumes the two zone lists match is wrong.
- `ISLAND_ZONES` in `analytics/island.py` must stay in sync with `NO_PRICE_ZONES` in
  `frontend/src/lib/scales.ts`.
- `island_daily` is padded with NULL rows across the 2025-01-01 to 2026-07-20 EDF gap on
  purpose. Never filter them out before serving.
- `scripts/build_us_gas_regions.py`, `build_us_power_regions.py`, `build_us_ng_plants.py` and
  `calibrate_river_temp.py` are one-shot: run by hand, write committed JSON/GeoJSON/CSV, not
  part of the refresh.
- `backend/energy_api.egg-info/` is build output from the editable install; ignore it.
  `.gitignore` covers `backend/data/` wholesale with a single `!us_ng_plants.json` negation,
  so a new committed input under `data/` needs its own negation line or it will vanish.
- Nothing in `data/` except the two committed JSON inputs is reproducible from git; it comes
  back by running `refresh.py`.
