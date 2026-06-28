# Hydro Reservoir Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Hydro Fill" choropleth mode to /power and a seasonal reservoir fan chart in the zone panel, sourcing weekly ENTSO-E reservoir data for 14 European countries.

**Architecture:** New PostgreSQL table `hydro_reservoir` in market_data, fetched via a new `fetch_hydro_reservoir()` in the shared market-data fetcher. `analytics/hydro.py` pre-computes three energy_hub.duckdb tables (history, seasonal band, latest). Two new API endpoints serve the choropleth payload and per-country seasonal series. On the frontend, `MapMetric` gains a `'hydro_fill'` option; `EuroMap.tsx` accepts a new `hydroByZone` prop; `power.tsx` expands country-level hydro data to per-zone and drives the stat strip; `UnifiedZonePanel.tsx` renders a fan chart for zones in hydro-reporting countries.

**Tech Stack:** Python/psycopg2/entsoe-py (market-data), FastAPI/DuckDB (energy backend), React 19/TanStack Query/recharts/TypeScript (frontend).

## Global Constraints

- No synthetic data - every series comes from ENTSO-E `query_aggregate_water_reservoirs_and_hydro_storage`
- All timestamps stored UTC; convert to display timezone only at presentation layer
- market-data loaders package (`_query`, `get_read_conn`) for all PostgreSQL reads in analytics
- DuckDB `energy_hub.duckdb` is write-only from refresh.py; API reads it read-only via `app/db.py`
- ruff lint/format must pass; pre-commit hooks run on commit
- No AI attribution in commit messages

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `shared/market-data/db.py` | Modify | Add `hydro_reservoir` CREATE TABLE to `init_schema()` |
| `shared/market-data/fetchers/entso_e.py` | Modify | Add `HYDRO_RESERVOIR_COUNTRIES`, `fetch_hydro_reservoir()` |
| `shared/market-data/ingest.py` | Modify | Register `entso-e-hydro` CLI command |
| `backend/analytics/hydro.py` | Create | `build_hydro_tables()` -> 3 DataFrames |
| `backend/scripts/refresh.py` | Modify | Import + call `build_hydro_tables()`, add `_write_hydro()` |
| `backend/app/schemas.py` | Modify | Add `HydroCountryLatest`, `HydroMapResponse`, `HydroHistPoint`, `HydroSeasonalPoint`, `HydroCountryResponse` |
| `backend/app/main.py` | Modify | Add `GET /api/hydro/map`, `GET /api/hydro/country/{cc}` |
| `backend/tests/conftest.py` | Modify | Seed `hydro_reservoir_history`, `hydro_reservoir_seasonal`, `hydro_reservoir_latest` |
| `backend/tests/test_endpoints.py` | Modify | Add hydro endpoint tests |
| `frontend/src/lib/api.ts` | Modify | Add TS types + `api.hydroMap()`, `api.hydroCountry(cc)` |
| `frontend/src/lib/scales.ts` | Modify | Add `ZONE_TO_HYDRO_COUNTRY` constant |
| `frontend/src/components/map/EuroMap.tsx` | Modify | Add `'hydro_fill'` to `MapMetric`; add `hydroFillColor()`; update `zoneColor()`, `EuroChoroLayer`, `createLayer`, `Props` to accept `hydroByZone` |
| `frontend/src/routes/power.tsx` | Modify | Add `'hydro_fill'` to `METRIC_CONFIG` + `GEN_METRICS`; fetch `/api/hydro/map`; build `hydroByZone`; pass to `EuroMap`; add hydro stat strip |
| `frontend/src/components/map/UnifiedZonePanel.tsx` | Modify | Add `useQuery` for hydro country; render `HydroReservoirSection` fan chart |

---

## Task 1: PostgreSQL table + fetcher + ingest registration

**Files:**
- Modify: `shared/market-data/db.py`
- Modify: `shared/market-data/fetchers/entso_e.py`
- Modify: `shared/market-data/ingest.py`

**Interfaces:**
- Produces: `hydro_reservoir` PostgreSQL table (country VARCHAR, week_date DATE, stored_mwh REAL, PRIMARY KEY (country, week_date))
- Produces: `fetch_hydro_reservoir(from_date, to_date)` function importable from `fetchers.entso_e`
- Produces: `ingest.py entso-e-hydro --from-date 2017-01-01` CLI command

- [ ] **Step 1: Add hydro_reservoir table to db.py init_schema()**

In `shared/market-data/db.py`, find the last `cur.execute(...)` block inside `init_schema()` and add immediately after it:

```python
    cur.execute("""
        CREATE TABLE IF NOT EXISTS hydro_reservoir (
            country      VARCHAR(4)  NOT NULL,
            week_date    DATE        NOT NULL,
            stored_mwh   REAL        NOT NULL,
            PRIMARY KEY (country, week_date)
        )
    """)
```

Then `conn.commit()` is already called at the end - no change needed there.

- [ ] **Step 2: Add fetch_hydro_reservoir() to entso_e.py**

In `shared/market-data/fetchers/entso_e.py`, add after the `CHUNK_MONTHS = 1` line near the top:

```python
HYDRO_RESERVOIR_COUNTRIES = [
    "NO", "SE", "ES", "FI", "RO", "IT", "CH", "PT", "FR", "GR", "AT", "HR", "RS", "ME",
]
```

Then add this function before the `fetch()` alias at the bottom of the file:

```python
def fetch_hydro_reservoir(from_date: date | None = None, to_date: date | None = None) -> None:
    """Fetch ENTSO-E weekly hydro reservoir fill (A72) for all hydro countries."""
    if to_date is None:
        to_date = date.today()

    client = _client()
    conn = get_conn()
    init_schema(conn)

    for country in HYDRO_RESERVOIR_COUNTRIES:
        effective_from = (
            from_date
            or latest_stored_date(conn, "hydro_reservoir", "week_date", {"country": country})
            or date(2017, 1, 1)
        )
        if effective_from >= to_date:
            logger.info(f"entso-e hydro [{country}]: up to date")
            continue

        total = 0
        for chunk_start, chunk_end in _chunks(effective_from, to_date):
            try:
                s = client.query_aggregate_water_reservoirs_and_hydro_storage(
                    country, start=_ts(chunk_start), end=_ts(chunk_end)
                )
                if isinstance(s, pd.DataFrame):
                    # Some countries return DataFrame with a single column
                    s = s.iloc[:, 0]
                s = _to_naive(s)
                rows = [
                    (country, ts.date().isoformat(), float(v))
                    for ts, v in s.items()
                    if pd.notna(v) and float(v) > 0
                ]
                if not rows:
                    continue
                cur = conn.cursor()
                execute_values(
                    cur,
                    """
                    INSERT INTO hydro_reservoir (country, week_date, stored_mwh)
                    VALUES %s
                    ON CONFLICT (country, week_date) DO UPDATE SET
                        stored_mwh = EXCLUDED.stored_mwh
                    """,
                    rows,
                )
                conn.commit()
                cur.close()
                total += len(rows)
                logger.info(f"entso-e hydro [{country}] {chunk_start:%Y-%m}: {len(rows)} weeks")
            except Exception as e:
                if _is_no_data(e):
                    logger.info(f"entso-e hydro [{country}] {chunk_start:%Y-%m}: no data")
                elif _is_rate_limit(e):
                    logger.warning(f"entso-e hydro [{country}]: rate limited, skipping chunk")
                    import time as _time
                    _time.sleep(60)
                else:
                    logger.warning(f"entso-e hydro [{country}] {chunk_start:%Y-%m}: {e!r}")

        logger.info(f"entso-e hydro [{country}]: {total} weekly rows total")

    conn.close()
```

- [ ] **Step 3: Register entso-e-hydro command in ingest.py**

In `shared/market-data/ingest.py`, find the block of `@cli.command(name="entso-e-capacity")` and add directly after it:

```python
@cli.command(name="entso-e-hydro")
@add_date_opts
def entso_e_hydro(from_date, to_date):
    """Fetch ENTSO-E weekly hydro reservoir fill (A72) for 14 European countries."""
    entso_e_fetcher.fetch_hydro_reservoir(from_date, to_date)
```

- [ ] **Step 4: Run backfill**

```bash
cd ~/quant/shared/market-data
.venv/bin/python ingest.py entso-e-hydro --from-date 2017-01-01
```

Expected: logs showing weekly rows per country (NO will have ~400 weeks). Confirm with:

```bash
.venv/bin/python -c "
from db import get_conn
conn = get_conn()
cur = conn.cursor()
cur.execute(\"SELECT country, MIN(week_date), MAX(week_date), COUNT(*) FROM hydro_reservoir GROUP BY country ORDER BY COUNT(*) DESC\")
for r in cur.fetchall(): print(r)
"
```

Expected: 14 rows, NO and SE with ~400+ weeks each.

- [ ] **Step 5: Commit**

```bash
cd ~/quant/shared/market-data
git add db.py fetchers/entso_e.py ingest.py
git commit -m "feat: hydro_reservoir table + ENTSO-E A72 fetcher + entso-e-hydro ingest command"
```

---

## Task 2: Analytics module

**Files:**
- Create: `backend/analytics/hydro.py`

**Interfaces:**
- Consumes: `hydro_reservoir` PostgreSQL table via `get_read_conn()` / `_query()`
- Produces: `build_hydro_tables() -> dict[str, pd.DataFrame]` with keys: `hydro_reservoir_history`, `hydro_reservoir_seasonal`, `hydro_reservoir_latest`

Schema of each DataFrame:
- `hydro_reservoir_history`: columns `[country, week_date, stored_twh]`
- `hydro_reservoir_seasonal`: columns `[country, week_of_year, avg5_twh, min5_twh, max5_twh]`
- `hydro_reservoir_latest`: columns `[country, week_date, stored_twh, vs_avg5_pct, yoy_pct, rank5yr_pct]`

- [ ] **Step 1: Create analytics/hydro.py**

```python
"""Hydro reservoir analytics: seasonal band, latest snapshot by country.

Source: hydro_reservoir table in PostgreSQL market_data (ENTSO-E A72 weekly data).
Produces three energy_hub.duckdb tables:
  hydro_reservoir_history   - full weekly series per country in TWh
  hydro_reservoir_seasonal  - 5-year same-week band (avg/min/max) per country
  hydro_reservoir_latest    - most recent week per country with vs_avg5_pct / yoy_pct / rank
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from loguru import logger

from loaders._base import _query, get_read_conn

HYDRO_COUNTRIES = [
    "NO", "SE", "ES", "FI", "RO", "IT", "CH", "PT", "FR", "GR", "AT", "HR", "RS", "ME",
]


def build_hydro_tables() -> dict[str, pd.DataFrame]:
    """Return all hydro DataFrames ready for energy_hub.duckdb."""
    conn = get_read_conn()
    raw = _query(
        conn,
        """
        SELECT country, week_date, stored_mwh
        FROM hydro_reservoir
        WHERE stored_mwh IS NOT NULL AND stored_mwh > 0
        ORDER BY country, week_date
        """,
    )
    conn.close()

    if raw.empty:
        empty = pd.DataFrame()
        return {
            "hydro_reservoir_history": empty,
            "hydro_reservoir_seasonal": empty,
            "hydro_reservoir_latest": empty,
        }

    raw["week_date"] = pd.to_datetime(raw["week_date"]).dt.date
    raw["stored_twh"] = raw["stored_mwh"] / 1_000_000.0

    history = raw[["country", "week_date", "stored_twh"]].copy()

    seasonal = _build_seasonal(raw)
    latest = _build_latest(raw, seasonal)

    return {
        "hydro_reservoir_history": history,
        "hydro_reservoir_seasonal": seasonal,
        "hydro_reservoir_latest": latest,
    }


def _build_seasonal(df: pd.DataFrame) -> pd.DataFrame:
    """5-year trailing same-week band per country.

    Uses calendar years Y-6 through Y-2 (5 full years, excluding the current
    partial year and the most recent full year to avoid recency anchoring).
    ISO week number 1-53.
    """
    import datetime

    current_year = datetime.date.today().year
    band_years = list(range(current_year - 6, current_year - 1))

    df2 = df.copy()
    df2["year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().year.astype(int)
    df2["week_of_year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().week.astype(int)
    band_df = df2[df2["year"].isin(band_years)].copy()

    if band_df.empty:
        return pd.DataFrame(columns=["country", "week_of_year", "avg5_twh", "min5_twh", "max5_twh"])

    seasonal = (
        band_df.groupby(["country", "week_of_year"])["stored_twh"]
        .agg(avg5_twh="mean", min5_twh="min", max5_twh="max")
        .reset_index()
    )
    return seasonal


def _build_latest(df: pd.DataFrame, seasonal: pd.DataFrame) -> pd.DataFrame:
    """One row per country: most recent week + vs_avg5_pct / yoy_pct / rank5yr_pct."""
    import datetime

    current_year = datetime.date.today().year

    # Most recent week per country
    idx = df.groupby("country")["week_date"].idxmax()
    latest = df.loc[idx].copy()
    latest["week_of_year"] = pd.to_datetime(latest["week_date"]).dt.isocalendar().week.astype(int)

    # Merge seasonal avg
    if not seasonal.empty:
        latest = latest.merge(
            seasonal[["country", "week_of_year", "avg5_twh", "min5_twh", "max5_twh"]],
            on=["country", "week_of_year"],
            how="left",
        )
    else:
        latest["avg5_twh"] = np.nan
        latest["min5_twh"] = np.nan
        latest["max5_twh"] = np.nan

    # vs_avg5_pct
    def _vs_avg(row) -> float | None:
        if pd.isna(row["avg5_twh"]) or row["avg5_twh"] == 0:
            return None
        return round((row["stored_twh"] - row["avg5_twh"]) / row["avg5_twh"] * 100, 1)

    latest["vs_avg5_pct"] = latest.apply(_vs_avg, axis=1)

    # yoy_pct: same week prior year
    prior_year = current_year - 1
    df2 = df.copy()
    df2["year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().year.astype(int)
    df2["week_of_year"] = pd.to_datetime(df2["week_date"]).dt.isocalendar().week.astype(int)
    prior = df2[df2["year"] == prior_year][["country", "week_of_year", "stored_twh"]].rename(
        columns={"stored_twh": "prior_twh"}
    )
    latest = latest.merge(prior, on=["country", "week_of_year"], how="left")

    def _yoy(row) -> float | None:
        if pd.isna(row.get("prior_twh")) or row["prior_twh"] == 0:
            return None
        return round((row["stored_twh"] - row["prior_twh"]) / row["prior_twh"] * 100, 1)

    latest["yoy_pct"] = latest.apply(_yoy, axis=1)

    # rank5yr_pct: percentile within 5-year same-week distribution (0-100)
    band_years = list(range(current_year - 6, current_year - 1))
    hist_band = df2[df2["year"].isin(band_years)][["country", "week_of_year", "stored_twh"]]

    def _rank(row) -> float | None:
        woy = row["week_of_year"]
        cc = row["country"]
        vals = hist_band[(hist_band["country"] == cc) & (hist_band["week_of_year"] == woy)]["stored_twh"]
        if vals.empty:
            return None
        below = (vals < row["stored_twh"]).sum()
        return round(below / len(vals) * 100, 1)

    latest["rank5yr_pct"] = latest.apply(_rank, axis=1)

    result = latest[
        ["country", "week_date", "stored_twh", "vs_avg5_pct", "yoy_pct", "rank5yr_pct"]
    ].copy()
    result["week_date"] = result["week_date"].astype(str)
    logger.info(f"hydro latest: {len(result)} countries")
    return result
```

- [ ] **Step 2: Verify the module runs against live data**

```bash
cd ~/quant/energy/backend
.venv/bin/python -c "
from analytics.hydro import build_hydro_tables
tables = build_hydro_tables()
for k, v in tables.items():
    print(k, v.shape, v.columns.tolist() if not v.empty else 'EMPTY')
    if not v.empty: print(v.head(3))
"
```

Expected: three DataFrames, `hydro_reservoir_latest` with 14 rows, `vs_avg5_pct` column non-null for most countries.

- [ ] **Step 3: Commit**

```bash
cd ~/quant/energy
git add backend/analytics/hydro.py
git commit -m "feat: analytics/hydro.py - reservoir history/seasonal/latest tables"
```

---

## Task 3: refresh.py integration + API endpoints + tests

**Files:**
- Modify: `backend/scripts/refresh.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_endpoints.py`

**Interfaces:**
- Consumes: `build_hydro_tables()` from `analytics.hydro`
- Produces: `GET /api/hydro/map` -> `HydroMapResponse`
- Produces: `GET /api/hydro/country/{cc}` -> `HydroCountryResponse`

- [ ] **Step 1: Add _write_hydro() and wire into refresh.py**

In `backend/scripts/refresh.py`, add to the imports block:

```python
from analytics.hydro import build_hydro_tables
```

In the main build function (inside `try:` block, after the existing `_write_us_plants` call), add:

```python
        hydro_tables = build_hydro_tables()
        _write_hydro(conn, hydro_tables)
```

Also add to the meta section:

```python
        conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", ["refreshed_at_hydro", now_iso])
```

Add the writer function alongside the other `_write_*` functions:

```python
def _write_hydro(conn: duckdb.DuckDBPyConnection, tables: dict) -> None:
    history = tables["hydro_reservoir_history"]
    seasonal = tables["hydro_reservoir_seasonal"]
    latest = tables["hydro_reservoir_latest"]

    conn.execute("""
        CREATE OR REPLACE TABLE hydro_reservoir_history (
            country VARCHAR, week_date DATE, stored_twh REAL
        )
    """)
    if not history.empty:
        conn.execute("INSERT INTO hydro_reservoir_history SELECT * FROM history")

    conn.execute("""
        CREATE OR REPLACE TABLE hydro_reservoir_seasonal (
            country VARCHAR, week_of_year SMALLINT,
            avg5_twh REAL, min5_twh REAL, max5_twh REAL
        )
    """)
    if not seasonal.empty:
        conn.execute("INSERT INTO hydro_reservoir_seasonal SELECT * FROM seasonal")

    conn.execute("""
        CREATE OR REPLACE TABLE hydro_reservoir_latest (
            country VARCHAR, week_date VARCHAR, stored_twh REAL,
            vs_avg5_pct REAL, yoy_pct REAL, rank5yr_pct REAL
        )
    """)
    if not latest.empty:
        conn.execute("INSERT INTO hydro_reservoir_latest SELECT * FROM latest")

    logger.info("hydro tables written")
```

- [ ] **Step 2: Run refresh and verify**

```bash
cd ~/quant/energy/backend
.venv/bin/python scripts/refresh.py --skip-ingest
```

Expected: completes without error, log line "hydro tables written". Verify:

```bash
.venv/bin/python -c "
import duckdb
conn = duckdb.connect('data/energy_hub.duckdb', read_only=True)
print(conn.execute('SELECT COUNT(*) FROM hydro_reservoir_latest').fetchone())
print(conn.execute('SELECT * FROM hydro_reservoir_latest ORDER BY stored_twh DESC LIMIT 3').fetchdf())
"
```

Expected: 14 rows in latest, NO has highest stored_twh.

- [ ] **Step 3: Add schemas to schemas.py**

In `backend/app/schemas.py`, add after the existing gas schemas:

```python
class HydroCountryLatest(BaseModel):
    country: str
    week_date: str
    stored_twh: float | None
    vs_avg5_pct: float | None
    yoy_pct: float | None
    rank5yr_pct: float | None

class HydroMapResponse(BaseModel):
    countries: list[HydroCountryLatest]
    refreshed_at: str | None

class HydroHistPoint(BaseModel):
    week_date: str
    stored_twh: float | None

class HydroSeasonalPoint(BaseModel):
    week_of_year: int
    avg5_twh: float | None
    min5_twh: float | None
    max5_twh: float | None

class HydroCountryResponse(BaseModel):
    country: str
    history: list[HydroHistPoint]
    seasonal: list[HydroSeasonalPoint]
    latest: HydroCountryLatest | None
```

- [ ] **Step 4: Add endpoints to main.py**

In `backend/app/main.py`, add to the imports from schemas.py:

```python
    HydroCountryLatest,
    HydroMapResponse,
    HydroHistPoint,
    HydroSeasonalPoint,
    HydroCountryResponse,
```

Add two endpoints (place after the gas endpoints, before or after generation endpoints):

```python
@app.get("/api/hydro/map", response_model=HydroMapResponse)
def hydro_map():
    rows_df = db.query(
        "SELECT country, week_date, stored_twh, vs_avg5_pct, yoy_pct, rank5yr_pct FROM hydro_reservoir_latest ORDER BY stored_twh DESC"
    )
    countries = [
        HydroCountryLatest(
            country=r.country,
            week_date=str(r.week_date),
            stored_twh=_float(r.stored_twh),
            vs_avg5_pct=_float(r.vs_avg5_pct),
            yoy_pct=_float(r.yoy_pct),
            rank5yr_pct=_float(r.rank5yr_pct),
        )
        for r in rows_df.itertuples()
    ] if not rows_df.empty else []
    return HydroMapResponse(countries=countries, refreshed_at=_meta_val("refreshed_at_hydro"))


@app.get("/api/hydro/country/{cc}", response_model=HydroCountryResponse)
def hydro_country(cc: str):
    cc = cc.upper()
    latest_df = db.query(
        "SELECT country, week_date, stored_twh, vs_avg5_pct, yoy_pct, rank5yr_pct FROM hydro_reservoir_latest WHERE country = ?",
        [cc],
    )
    if latest_df.empty:
        raise HTTPException(status_code=404, detail=f"Hydro country not found: {cc}")

    r = latest_df.iloc[0]
    latest = HydroCountryLatest(
        country=cc,
        week_date=str(r["week_date"]),
        stored_twh=_float(r["stored_twh"]),
        vs_avg5_pct=_float(r["vs_avg5_pct"]),
        yoy_pct=_float(r["yoy_pct"]),
        rank5yr_pct=_float(r["rank5yr_pct"]),
    )

    # History: current year + prior year for fan chart
    import datetime as _dt
    current_year = _dt.datetime.now(_dt.timezone.utc).year
    hist_df = db.query(
        """
        SELECT week_date::VARCHAR AS week_date, stored_twh
        FROM hydro_reservoir_history
        WHERE country = ? AND YEAR(week_date::DATE) >= ?
        ORDER BY week_date
        """,
        [cc, current_year - 1],
    )
    history = [
        HydroHistPoint(week_date=str(row.week_date), stored_twh=_float(row.stored_twh))
        for row in hist_df.itertuples()
    ] if not hist_df.empty else []

    seasonal_df = db.query(
        "SELECT week_of_year, avg5_twh, min5_twh, max5_twh FROM hydro_reservoir_seasonal WHERE country = ? ORDER BY week_of_year",
        [cc],
    )
    seasonal = [
        HydroSeasonalPoint(
            week_of_year=int(row.week_of_year),
            avg5_twh=_float(row.avg5_twh),
            min5_twh=_float(row.min5_twh),
            max5_twh=_float(row.max5_twh),
        )
        for row in seasonal_df.itertuples()
    ] if not seasonal_df.empty else []

    return HydroCountryResponse(country=cc, history=history, seasonal=seasonal, latest=latest)
```

- [ ] **Step 5: Seed hydro tables in conftest.py**

In `backend/tests/conftest.py`, inside `_seed_db()`, add after the existing storage tables block. Add before the `conn.close()` at the end of the function (or wherever the other tables end):

```python
    conn.execute("""
        CREATE TABLE hydro_reservoir_history (
            country VARCHAR, week_date DATE, stored_twh REAL
        )
    """)
    conn.execute("""
        CREATE TABLE hydro_reservoir_seasonal (
            country VARCHAR, week_of_year SMALLINT,
            avg5_twh REAL, min5_twh REAL, max5_twh REAL
        )
    """)
    conn.execute("""
        CREATE TABLE hydro_reservoir_latest (
            country VARCHAR, week_date VARCHAR, stored_twh REAL,
            vs_avg5_pct REAL, yoy_pct REAL, rank5yr_pct REAL
        )
    """)

    import datetime as _dt
    from datetime import timedelta as _td
    _today = _dt.date.today()
    _week = _today - _td(days=_today.weekday() + 1)  # last Sunday
    for _cc, _twh in [("NO", 52.0), ("SE", 24.0), ("FR", 2.5)]:
        conn.execute(
            "INSERT INTO hydro_reservoir_latest VALUES (?, ?, ?, ?, ?, ?)",
            [_cc, str(_week), _twh, -8.0, -3.0, 30.0],
        )
        # 2 years of weekly history (104 weeks)
        for _wi in range(104):
            _wd = _week - _td(weeks=_wi)
            _woy = _wd.isocalendar()[1]
            conn.execute(
                "INSERT INTO hydro_reservoir_history VALUES (?, ?, ?)",
                [_cc, str(_wd), _twh + (_woy - 26) * 0.2],
            )
        # seasonal band (53 weeks)
        for _woy in range(1, 54):
            conn.execute(
                "INSERT INTO hydro_reservoir_seasonal VALUES (?, ?, ?, ?, ?)",
                [_cc, _woy, _twh + (_woy - 26) * 0.2, _twh - 5, _twh + 5],
            )
```

- [ ] **Step 6: Add endpoint tests**

In `backend/tests/test_endpoints.py`, add:

```python
def test_hydro_map(client):
    r = client.get("/api/hydro/map")
    assert r.status_code == 200
    data = r.json()
    assert "countries" in data
    assert len(data["countries"]) == 3  # NO, SE, FR seeded
    no_row = next(c for c in data["countries"] if c["country"] == "NO")
    assert no_row["stored_twh"] == pytest.approx(52.0)
    assert no_row["vs_avg5_pct"] == pytest.approx(-8.0)


def test_hydro_country_found(client):
    r = client.get("/api/hydro/country/NO")
    assert r.status_code == 200
    data = r.json()
    assert data["country"] == "NO"
    assert data["latest"]["stored_twh"] == pytest.approx(52.0)
    assert len(data["history"]) > 0
    assert len(data["seasonal"]) > 0
    pt = data["seasonal"][0]
    assert "week_of_year" in pt
    assert "avg5_twh" in pt


def test_hydro_country_not_found(client):
    r = client.get("/api/hydro/country/XX")
    assert r.status_code == 404
```

- [ ] **Step 7: Run tests**

```bash
cd ~/quant/energy/backend
.venv/bin/python -m pytest tests/ -v
```

Expected: all existing tests pass + 3 new hydro tests pass.

- [ ] **Step 8: Commit**

```bash
cd ~/quant/energy
git add backend/scripts/refresh.py backend/app/schemas.py backend/app/main.py backend/tests/conftest.py backend/tests/test_endpoints.py
git commit -m "feat: /api/hydro/map + /api/hydro/country/{cc} endpoints with refresh.py integration"
```

---

## Task 4: Frontend types and API fetch functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: `GET /api/hydro/map`, `GET /api/hydro/country/{cc}`
- Produces: TS types `HydroCountryLatest`, `HydroMapResponse`, `HydroHistPoint`, `HydroSeasonalPoint`, `HydroCountryResponse`
- Produces: `api.hydroMap()`, `api.hydroCountry(cc: string)` functions

- [ ] **Step 1: Add types and fetch functions to api.ts**

Find the `GenMapItem` interface in `frontend/src/lib/api.ts` and add after the `GenMapResponse` interface:

```typescript
export interface HydroCountryLatest {
  country: string
  week_date: string
  stored_twh: number | null
  vs_avg5_pct: number | null
  yoy_pct: number | null
  rank5yr_pct: number | null
}

export interface HydroMapResponse {
  countries: HydroCountryLatest[]
  refreshed_at: string | null
}

export interface HydroHistPoint {
  week_date: string
  stored_twh: number | null
}

export interface HydroSeasonalPoint {
  week_of_year: number
  avg5_twh: number | null
  min5_twh: number | null
  max5_twh: number | null
}

export interface HydroCountryResponse {
  country: string
  history: HydroHistPoint[]
  seasonal: HydroSeasonalPoint[]
  latest: HydroCountryLatest | null
}
```

Then find the `api` object (where other fetch functions like `genMap` are defined) and add:

```typescript
  hydroMap: () => get<HydroMapResponse>('/hydro/map'),
  hydroCountry: (cc: string) => get<HydroCountryResponse>(`/hydro/country/${cc}`),
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/quant/energy/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/quant/energy
git add frontend/src/lib/api.ts
git commit -m "feat: HydroMapResponse/HydroCountryResponse TS types and api.hydroMap/hydroCountry fetchers"
```

---

## Task 5: scales.ts ZONE_TO_HYDRO_COUNTRY + EuroMap.tsx hydro_fill metric

**Files:**
- Modify: `frontend/src/lib/scales.ts`
- Modify: `frontend/src/components/map/EuroMap.tsx`

**Interfaces:**
- Consumes: `MapMetric` (extends with `'hydro_fill'`)
- Produces: `ZONE_TO_HYDRO_COUNTRY: Record<string, string>` exported from scales.ts
- Produces: `hydroFillColor(vsAvg5Pct: number | null | undefined): string` in EuroMap.tsx
- Produces: updated `zoneColor(metric, power, gen, hydroVsAvg?)` signature
- Produces: `EuroMap` accepting `hydroByZone?: Record<string, number | null>` prop

- [ ] **Step 1: Add ZONE_TO_HYDRO_COUNTRY to scales.ts**

In `frontend/src/lib/scales.ts`, add after the `ZONE_SIBLINGS` constant:

```typescript
// Maps each bidding zone to its ENTSO-E country code for hydro reservoir data.
// Countries without ENTSO-E hydro data (DE, PL, NL, etc.) are omitted.
export const ZONE_TO_HYDRO_COUNTRY: Record<string, string> = {
  'NO-1': 'NO', 'NO-2': 'NO', 'NO-3': 'NO', 'NO-4': 'NO', 'NO-5': 'NO',
  'SE-1': 'SE', 'SE-2': 'SE', 'SE-3': 'SE', 'SE-4': 'SE',
  'IT-NORD': 'IT', 'IT-CNOR': 'IT', 'IT-CSUD': 'IT', 'IT-SUD': 'IT',
  'IT-SICI': 'IT', 'IT-SARD': 'IT',
  'FR': 'FR',
  'AT': 'AT',
  'CH': 'CH',
  'ES': 'ES',
  'PT': 'PT',
  'FI': 'FI',
  'RO': 'RO',
  'GR': 'GR',
  'HR': 'HR',
}
```

- [ ] **Step 2: Add 'hydro_fill' to MapMetric and add hydroFillColor() in EuroMap.tsx**

In `frontend/src/components/map/EuroMap.tsx`, change the `MapMetric` type:

```typescript
export type MapMetric = 'price' | 'range' | 'neg_hours' | 'pct_rank' | 'renewable' | 'dominant_fuel' | 'carbon_intensity' | 'wind_cf' | 'solar_cf' | 'hydro_fill'
```

Add the color function after `solarCfColor`:

```typescript
// Hydro fill: diverging red (drought) -> grey (avg) -> blue (high fill)
// Input: vs_avg5_pct (e.g. -15 means 15% below 5yr avg)
function hydroFillColor(vsAvg: number | null | undefined): string {
  if (vsAvg == null) return '#374151'  // no data
  if (vsAvg <= -30) return '#7f1d1d'
  if (vsAvg <= -20) return '#b91c1c'
  if (vsAvg <= -10) return '#ef4444'
  if (vsAvg <= -5)  return '#f87171'
  if (vsAvg <   5)  return '#6b7280'  // near-average band
  if (vsAvg <  10)  return '#60a5fa'
  if (vsAvg <  20)  return '#3b82f6'
  if (vsAvg <  30)  return '#1d4ed8'
  return '#1e3a8a'  // > +30%
}
```

- [ ] **Step 3: Update zoneColor() to accept optional 4th arg**

Change the signature of `zoneColor` in EuroMap.tsx:

```typescript
export function zoneColor(
  metric: MapMetric,
  power: PowerLatestRow | undefined,
  gen: GenMapItem | undefined,
  hydroVsAvg?: number | null,
): string {
  switch (metric) {
    case 'price':          return powerPriceColor(power?.base_eur)
    case 'range':          return dayRangeColor(power?.day_range_eur)
    case 'neg_hours':      return negHoursColor(power?.neg_hours)
    case 'pct_rank':       return pctRankColor(power?.pct_rank_2yr)
    case 'renewable':      return renewablePctColor(gen?.renewable_pct)
    case 'dominant_fuel':  return dominantFuelColor(computeDominantFuel(gen))
    case 'carbon_intensity': return carbonIntensityColor(computeCarbonIntensity(gen))
    case 'wind_cf':        return windCfColor(gen?.wind_cf)
    case 'solar_cf':       return solarCfColor(gen?.solar_cf)
    case 'hydro_fill':     return hydroFillColor(hydroVsAvg)
  }
}
```

- [ ] **Step 4: Add hydroByZone prop to EuroMap and EuroChoroLayer**

In EuroMap.tsx, update the `Props` interface for `EuroMap`:

```typescript
interface Props {
  powerByZone: Record<string, PowerLatestRow>
  genByZone: Record<string, GenMapItem>
  hydroByZone?: Record<string, number | null>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: MapMetric
  children?: ReactNode
}
```

Update the `EuroMap` function and the `EuroChoroLayer` invocation:

```typescript
export function EuroMap({ powerByZone, genByZone, hydroByZone, selected, onSelect, metric, children }: Props) {
  return (
    <MapContainer ...>
      ...
      <EuroChoroLayer
        powerByZone={powerByZone}
        genByZone={genByZone}
        hydroByZone={hydroByZone ?? {}}
        selected={selected}
        onSelect={onSelect}
        metric={metric}
      />
      ...
    </MapContainer>
  )
}
```

Update `EuroChoroLayer` function signature and internals:

```typescript
function EuroChoroLayer({
  powerByZone,
  genByZone,
  hydroByZone,
  selected,
  onSelect,
  metric,
}: {
  powerByZone: Record<string, PowerLatestRow>
  genByZone: Record<string, GenMapItem>
  hydroByZone: Record<string, number | null>
  selected: string | null
  onSelect: (zone: string | null) => void
  metric: MapMetric
}) {
  // ... existing refs ...
  const hydroRef = useRef<Record<string, number | null>>(hydroByZone)

  // ... existing useEffects for selected, metric, power, gen ...
  useEffect(() => { hydroRef.current = hydroByZone }, [hydroByZone])

  useEffect(() => {
    let cancelled = false
    fetch('/geo/bidding_zones.geojson')
      .then((r) => r.json())
      .then((geo: GeoJsonObject) => {
        if (cancelled) return
        if (geoRef.current) map.removeLayer(geoRef.current)
        const layer = createLayer(geo, powerRef, genRef, hydroRef, selectedRef, metricRef, onSelect)
        layer.addTo(map)
        geoRef.current = layer
      })
      .catch(console.error)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!geoRef.current) return
    geoRef.current.eachLayer((layer: Layer) => {
      const f = (layer as any).feature as Feature
      const zone: string = f?.properties?.['zone'] ?? ''
      const dataZone: string = f?.properties?.['displayAs'] ?? zone
      const isSelected = dataZone === selected
      ;(layer as L.Path).setStyle({
        fillColor: zoneColor(metric, powerByZone[dataZone], genByZone[dataZone], hydroByZone[dataZone] ?? null),
        fillOpacity: isSelected ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: isSelected ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: isSelected ? 2 : CHOROPLETH_STROKE_WIDTH,
      })
    })
  }, [powerByZone, genByZone, hydroByZone, selected, metric])

  return null
}
```

Update `createLayer` signature and its `zoneColor` call:

```typescript
function createLayer(
  geo: GeoJsonObject,
  powerRef: MutableRefObject<Record<string, PowerLatestRow>>,
  genRef: MutableRefObject<Record<string, GenMapItem>>,
  hydroRef: MutableRefObject<Record<string, number | null>>,
  selectedRef: MutableRefObject<string | null>,
  metricRef: MutableRefObject<MapMetric>,
  onSelect: (zone: string | null) => void,
): L.GeoJSON {
  return L.geoJSON(geo, {
    style: (feature: Feature | undefined): PathOptions => {
      const zone = feature?.properties?.['zone'] ?? ''
      const dataZone = feature?.properties?.['displayAs'] ?? zone
      const sel = selectedRef.current
      return {
        fillColor: zoneColor(
          metricRef.current,
          powerRef.current[dataZone],
          genRef.current[dataZone],
          hydroRef.current[dataZone] ?? null,
        ),
        fillOpacity: dataZone === sel ? 0.95 : CHOROPLETH_FILL_OPACITY,
        color: dataZone === sel ? '#38bdf8' : CHOROPLETH_STROKE,
        weight: dataZone === sel ? 2 : CHOROPLETH_STROKE_WIDTH,
      }
    },
    // ... rest of onEachFeature unchanged ...
  })
}
```

- [ ] **Step 5: Update tooltipContent() for hydro_fill in EuroMap.tsx**

In the `tooltipContent()` function inside EuroMap.tsx, find the `metricExtra` switch and add the hydro_fill case. The function signature needs `hydroVsAvg` too:

```typescript
function tooltipContent(
  zone: string,
  power: PowerLatestRow | undefined,
  gen: GenMapItem | undefined,
  metric: MapMetric,
  hydroVsAvg?: number | null,
): string {
  // ... existing code ...
  const metricExtra = (() => {
    switch (metric) {
      // ... existing cases ...
      case 'hydro_fill':
        return hydroVsAvg != null
          ? `<br/>Hydro: ${hydroVsAvg > 0 ? '+' : ''}${hydroVsAvg.toFixed(1)}% vs 5yr avg`
          : '<br/>Hydro: no data'
      default: return null
    }
  })()
  // ... rest unchanged ...
}
```

Also update the call site within `onEachFeature` to pass `hydroRef.current[dataZone] ?? null` as the fifth argument to `tooltipContent`.

- [ ] **Step 6: TypeScript check**

```bash
cd ~/quant/energy/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd ~/quant/energy
git add frontend/src/lib/scales.ts frontend/src/components/map/EuroMap.tsx
git commit -m "feat: ZONE_TO_HYDRO_COUNTRY + hydro_fill MapMetric + hydroByZone prop in EuroMap"
```

---

## Task 6: power.tsx - hydro_fill metric wiring + stat strip

**Files:**
- Modify: `frontend/src/routes/power.tsx`

**Interfaces:**
- Consumes: `api.hydroMap()`, `ZONE_TO_HYDRO_COUNTRY` from scales.ts, `HydroMapResponse` from api.ts
- Consumes: `'hydro_fill'` MapMetric from EuroMap.tsx
- Produces: `hydroByZone: Record<string, number | null>` passed as prop to `<EuroMap>`
- Produces: stat strip section showing NO/SE/EU hydro fill summary when metric is `'hydro_fill'`

- [ ] **Step 1: Add import and update GEN_METRICS**

In `frontend/src/routes/power.tsx`, update the imports to include:

```typescript
import { api, type PowerLatestRow, type GenMapItem, type DivergenceLatestRow, type CongestionRow, type EuCfLatestResponse, type NuclearHeatRiskResponse, type HydroMapResponse } from '@/lib/api'
import { FUEL_PALETTE, renewablePctColor, carbonIntensityColor, computeCarbonIntensity, zoneName, ZONE_TO_HYDRO_COUNTRY } from '@/lib/scales'
```

Change `GEN_METRICS`:

```typescript
const GEN_METRICS: MapMetric[] = ['renewable', 'dominant_fuel', 'carbon_intensity', 'wind_cf', 'solar_cf', 'hydro_fill']
```

- [ ] **Step 2: Add METRIC_CONFIG entry for hydro_fill**

In the `METRIC_CONFIG` constant, add:

```typescript
  hydro_fill: {
    label: 'Hydro',
    title: 'Reservoir fill vs 5yr avg',
    items: [
      { label: '>+30%', color: '#1e3a8a' },
      { label: '+10 to +30%', color: '#3b82f6' },
      { label: '±10% (avg)', color: '#6b7280' },
      { label: '-10 to -30%', color: '#ef4444' },
      { label: '<-30%', color: '#7f1d1d' },
      { label: 'no data', color: '#374151' },
    ],
  },
```

- [ ] **Step 3: Add hydro data fetch**

In the component, alongside the other `useQuery` calls, add:

```typescript
  const { data: hydroData } = useQuery<HydroMapResponse>({
    queryKey: ['hydro-map'],
    queryFn: api.hydroMap,
    staleTime: 60 * 60 * 1000,  // hourly; data is weekly
    enabled: metric === 'hydro_fill',
  })
```

- [ ] **Step 4: Build hydroByZone and pass to EuroMap**

After the existing `genByZone` construction block, add:

```typescript
  // Expand country-level hydro data to zone level using ZONE_TO_HYDRO_COUNTRY
  const hydroByCountry: Record<string, number | null> = {}
  for (const c of hydroData?.countries ?? []) {
    hydroByCountry[c.country] = c.vs_avg5_pct ?? null
  }
  const hydroByZone: Record<string, number | null> = {}
  for (const [zone, country] of Object.entries(ZONE_TO_HYDRO_COUNTRY)) {
    hydroByZone[zone] = hydroByCountry[country] ?? null
  }
```

Find the `<EuroMap` JSX element and add the `hydroByZone` prop:

```tsx
<EuroMap
  powerByZone={powerByZone}
  genByZone={genByZone}
  hydroByZone={hydroByZone}
  selected={selectedZone}
  onSelect={setSelectedZone}
  metric={metric}
>
```

- [ ] **Step 5: Add hydro stat strip**

Find the section where the stat strip is rendered (look for `metric === 'price'` or similar conditional stat strip rendering). Add a hydro_fill branch.

The stat strip for hydro should show NO, SE, and a volume-weighted EU aggregate. Add this after the existing stat strip conditionals:

```tsx
{metric === 'hydro_fill' && hydroData && (
  <div className="flex flex-wrap gap-3 items-center text-xs text-muted-foreground px-3 py-2">
    <span className="font-semibold text-foreground">Hydro reservoirs vs 5yr avg</span>
    {['NO', 'SE', 'ES', 'FR'].map((cc) => {
      const row = hydroData.countries.find((c) => c.country === cc)
      if (!row || row.vs_avg5_pct == null) return null
      const pct = row.vs_avg5_pct
      const color = pct < -10 ? '#ef4444' : pct > 10 ? '#60a5fa' : '#9ca3af'
      return (
        <span key={cc} className="font-mono" style={{ color }}>
          {cc}: {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
      )
    })}
    {(() => {
      // Volume-weighted EU aggregate (NO + SE dominate)
      const total = hydroData.countries.reduce((s, c) => s + (c.stored_twh ?? 0), 0)
      if (total === 0) return null
      const wtd = hydroData.countries.reduce((s, c) => {
        if (c.vs_avg5_pct == null || c.stored_twh == null) return s
        return s + c.vs_avg5_pct * c.stored_twh
      }, 0) / total
      const color = wtd < -10 ? '#ef4444' : wtd > 10 ? '#60a5fa' : '#9ca3af'
      return (
        <span className="font-mono" style={{ color }}>
          EU wtd: {wtd > 0 ? '+' : ''}{wtd.toFixed(1)}%
        </span>
      )
    })()}
  </div>
)}
```

- [ ] **Step 6: TypeScript check and dev server smoke test**

```bash
cd ~/quant/energy/frontend
npx tsc --noEmit 2>&1 | head -20
npm run dev &
```

Open http://localhost:5173/power, switch to "Hydro" metric mode. Confirm zones in NO/SE/FR/ES get colored, other zones grey.

Stop dev server (`kill %1`).

- [ ] **Step 7: Commit**

```bash
cd ~/quant/energy
git add frontend/src/routes/power.tsx
git commit -m "feat: hydro_fill choropleth mode on /power with stat strip and zone expansion"
```

---

## Task 7: UnifiedZonePanel - HydroReservoirSection fan chart

**Files:**
- Modify: `frontend/src/components/map/UnifiedZonePanel.tsx`

**Interfaces:**
- Consumes: `api.hydroCountry(cc)`, `ZONE_TO_HYDRO_COUNTRY` from scales.ts
- Consumes: `HydroCountryResponse`, `HydroHistPoint`, `HydroSeasonalPoint` from api.ts
- Produces: `HydroReservoirSection` rendered inside `UnifiedZonePanel` for hydro zones

- [ ] **Step 1: Add hydro imports and query to UnifiedZonePanel**

At the top of `UnifiedZonePanel.tsx`, update the `api` import to include the new hydro types:

```typescript
import {
  api,
  type PowerLatestRow,
  type GenMapItem,
  type CapacityFactorPoint,
  type HourlyProfilePoint,
  type DowPoint,
  type MonthPoint,
  type ZoneCorrelationRow,
  type HydroCountryResponse,
} from '@/lib/api'
import { powerPriceColor, renewablePctColor, computeCarbonIntensity, FUEL_PALETTE, zoneName, ZONE_SIBLINGS, ZONE_TO_HYDRO_COUNTRY } from '@/lib/scales'
```

Inside the `UnifiedZonePanel` function, after the existing `useQuery` calls, add:

```typescript
  const hydroCountry = ZONE_TO_HYDRO_COUNTRY[zone] ?? null

  const { data: hydroData } = useQuery<HydroCountryResponse>({
    queryKey: ['hydro-country', hydroCountry],
    queryFn: () => api.hydroCountry(hydroCountry!),
    staleTime: 60 * 60 * 1000,
    enabled: hydroCountry != null,
  })
```

- [ ] **Step 2: Add HydroReservoirSection component at end of UnifiedZonePanel.tsx**

Add this component function at the bottom of the file (after `UnifiedZonePanel`):

```typescript
function HydroReservoirSection({ data, country }: { data: HydroCountryResponse; country: string }) {
  const latest = data.latest
  if (!latest) return null

  const currentYear = new Date().getFullYear()

  // Map week_date -> week-of-year using ISO week (built-in via toLocaleDateString trick)
  const getWoy = (weekDate: string): number => {
    const d = new Date(weekDate + 'T12:00:00Z')
    const jan4 = new Date(d.getFullYear(), 0, 4)  // Jan 4 is always in week 1
    const diff = (d.getTime() - jan4.getTime()) / 86400000
    return Math.max(1, Math.ceil((diff + jan4.getDay() + 1) / 7))
  }

  // Build lookup maps for current and prior year history (week-of-year -> TWh)
  const currentMap = new Map<number, number | null>()
  const priorMap = new Map<number, number | null>()
  for (const h of data.history) {
    const yr = parseInt(h.week_date.slice(0, 4))
    const woy = getWoy(h.week_date)
    if (yr === currentYear) currentMap.set(woy, h.stored_twh)
    else if (yr === currentYear - 1) priorMap.set(woy, h.stored_twh)
  }

  // Chart data: one row per week-of-year from the seasonal band
  // Use stacked Areas for the band: base (min5) is transparent, height (max5-min5) is colored
  const chartData = data.seasonal.map((s) => ({
    woy: s.week_of_year,
    band_base: s.min5_twh,
    band_height: s.max5_twh != null && s.min5_twh != null ? s.max5_twh - s.min5_twh : null,
    avg5: s.avg5_twh,
    prior: priorMap.get(s.week_of_year) ?? null,
    current: currentMap.get(s.week_of_year) ?? null,
  }))

  const MONTH_TICKS = [1, 5, 9, 14, 18, 22, 27, 31, 35, 40, 44, 48]
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const pct = latest.vs_avg5_pct
  const pctColor = pct == null ? '#9ca3af' : pct < -10 ? '#ef4444' : pct > 10 ? '#60a5fa' : '#9ca3af'

  const countryNames: Record<string, string> = {
    NO: 'Norway', SE: 'Sweden', FR: 'France', AT: 'Austria', CH: 'Switzerland',
    IT: 'Italy', PT: 'Portugal', ES: 'Spain', FI: 'Finland', RO: 'Romania',
    GR: 'Greece', HR: 'Croatia', RS: 'Serbia', ME: 'Montenegro',
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-xs font-semibold text-foreground">
          Hydro Reservoirs - {countryNames[country] ?? country}
        </h3>
        <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">
          {latest.stored_twh != null ? `${latest.stored_twh.toFixed(1)} TWh` : '--'}
        </span>
        {pct != null && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ color: pctColor, background: '#1e293b' }}>
            {pct > 0 ? '+' : ''}{pct.toFixed(1)}% vs 5yr avg
          </span>
        )}
        {latest.yoy_pct != null && (
          <span className="text-xs text-muted-foreground">
            {latest.yoy_pct > 0 ? '+' : ''}{latest.yoy_pct.toFixed(1)}% YoY
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Weekly stored energy (TWh). Shaded band = 5yr min-max, dashed = 5yr avg, grey = prior year.
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="woy"
            ticks={MONTH_TICKS}
            tickFormatter={(v: number) => MONTH_LABELS[MONTH_TICKS.indexOf(v)] ?? ''}
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${(v as number).toFixed(0)}`}
            width={28}
          />
          <Tooltip
            contentStyle={{ background: '#0f1117', border: '1px solid #1e293b', fontSize: 10 }}
            labelFormatter={(v) => `Week ${v}`}
            formatter={(v, name) => {
              if (name === 'band_base' || name === 'band_height') return null
              const val = typeof v === 'number' ? `${(v as number).toFixed(1)} TWh` : '--'
              const label = name === 'avg5' ? '5yr avg' : name === 'prior' ? 'Prior year' : 'Current year'
              return [val, label]
            }}
          />
          {/* Stacked band: transparent base (min5) + colored height (max5-min5) */}
          <Area type="monotone" dataKey="band_base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area type="monotone" dataKey="band_height" stackId="band" stroke="none" fill="#1e3a5f" fillOpacity={0.5} isAnimationActive={false} />
          <Line type="monotone" dataKey="avg5" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="prior" stroke="#475569" strokeWidth={1} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="current" stroke="#e2e8f0" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 3: Render HydroReservoirSection in the panel**

Find the return statement of `UnifiedZonePanel` that renders the panel content. Near the end, before the closing `</div>`, add the hydro section:

```tsx
{hydroCountry && hydroData && (
  <HydroReservoirSection data={hydroData} country={hydroCountry} />
)}
```

Place this after the generation tab content / at the bottom of whichever tab section is most appropriate. Given the panel has `'price'` and `'generation'` tabs, add it at the bottom of the `generation` tab, or outside both tabs as a universal section. The cleanest option: outside the tab switcher, at the very bottom of the panel, visible in both tabs.

- [ ] **Step 4: TypeScript check**

```bash
cd ~/quant/energy/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Dev server integration test**

```bash
cd ~/quant/energy/frontend
npm run dev &
```

1. Navigate to http://localhost:5173/power
2. Switch to "Hydro" metric - Norway zones (NO-1..NO-5) should be colored
3. Click NO-2 - zone panel should open showing "Hydro Reservoirs - Norway" section with fan chart
4. Click FR - should show "Hydro Reservoirs - France"
5. Click DE-LU - NO hydro section (no mapping)

Stop dev server.

- [ ] **Step 6: Commit**

```bash
cd ~/quant/energy
git add frontend/src/components/map/UnifiedZonePanel.tsx
git commit -m "feat: HydroReservoirSection fan chart in zone panel for hydro-reporting countries"
```

---

## Task 8: Production build + deploy + ROADMAP update

**Files:**
- Modify: `frontend/` (build)
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Production build**

```bash
cd ~/quant/energy/frontend
npm run build 2>&1 | tail -20
```

Expected: no errors, `dist/` updated.

- [ ] **Step 2: Restart energy-api and run refresh**

```bash
sudo systemctl restart energy-api.service
cd ~/quant/energy/backend
.venv/bin/python scripts/refresh.py --skip-ingest
sudo journalctl -u energy-api -n 20 --no-pager
```

Expected: no errors in logs, refresh completes.

- [ ] **Step 3: Smoke test live site**

```bash
curl -s https://energy.lbzgiu.xyz/api/hydro/map | python3 -m json.tool | head -30
curl -s https://energy.lbzgiu.xyz/api/hydro/country/NO | python3 -m json.tool | head -20
```

Expected: valid JSON with Norwegian hydro data.

- [ ] **Step 4: Update ROADMAP.md**

In `docs/ROADMAP.md`, add before the Phase 56 entry:

```markdown
### Phase 84 - Hydro reservoir levels on /power [COMPLETE 2026-06-28]
```

Remove any placeholder content for Phase 84 if it exists.

- [ ] **Step 5: Final commit**

```bash
cd ~/quant/energy
git add docs/ROADMAP.md
git commit -m "docs: Phase 84 complete in ROADMAP"
```
