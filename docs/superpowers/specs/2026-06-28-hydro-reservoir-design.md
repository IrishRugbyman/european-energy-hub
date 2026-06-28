# Phase 84: Hydro Reservoir Levels on /generation

**Date:** 2026-06-28
**Target page:** /generation (new choropleth mode + zone panel section)

## Summary

Add a "Hydro Reserves" choropleth mode to the /generation page, coloring countries by
reservoir fill vs 5-year same-week average. A seasonal fan chart (mirroring the gas
storage country panel) appears in the zone panel for any zone in a hydro-reporting country.
14 EU/European countries have ENTSO-E weekly reservoir data; Norway (52 TWh) and Sweden
(25 TWh) dominate and are the primary EU power price signal.

## Data source

ENTSO-E Transparency Platform, document type A72 ("Aggregated Filling Rate of Water
Reservoirs and Hydro Storage Plants"). Queried via `entsoe-py`
`query_aggregate_water_reservoirs_and_hydro_storage(country_code, start, end)`. Returns
a weekly `pd.Series` of stored energy in MWh. Data is published once per week (Sunday
publication for the prior week).

**14 countries with data (2026-06-28 confirmed):**

| Country | Stored TWh (June 2025 sample) | Notes |
|---|---|---|
| NO | 52.3 | Dominant; drives Nordic spot and DE imports |
| SE | 24.7 | Second largest |
| ES | 15.3 | Iberian peninsula, drought-sensitive |
| FI | 3.65 | |
| RO | 2.68 | |
| IT | 3.38 | All Italian zones aggregated |
| CH | 2.85 | Switzerland; in ENTSO-E but limited zone overlap |
| PT | 2.88 | Iberian |
| FR | 2.51 | |
| GR | 2.28 | |
| AT | 0.94 | Alpine run-of-river dominated |
| HR | 0.91 | Croatia |
| RS | 0.45 | Serbia |
| ME | 0.41 | Montenegro |

Countries without data (confirmed API error): DE, PL, BA, SK, LV, SI.

**Normalization:** Raw MWh is not comparable across countries (different total capacity).
All UI values expressed as `vs_avg5_pct = (stored - same_week_5yr_avg) / same_week_5yr_avg * 100`.
Absolute TWh shown alongside for context. Rank (0-100 percentile vs 5yr same-week range)
computed for secondary display.

## Backend changes

### 1. PostgreSQL table (market_data)

New table added in `shared/market-data/db.py`:

```sql
CREATE TABLE IF NOT EXISTS hydro_reservoir (
    country      VARCHAR(4)   NOT NULL,
    week_date    DATE         NOT NULL,
    stored_mwh   REAL         NOT NULL,
    PRIMARY KEY (country, week_date)
);
```

### 2. Fetcher: `shared/market-data/fetchers/entso_e.py`

New function `fetch_hydro_reservoir(from_date, to_date)`:
- Countries list: `HYDRO_RESERVOIR_COUNTRIES = ['NO','SE','ES','FI','RO','IT','CH','PT','FR','GR','AT','HR','RS','ME']`
- Chunked by quarter (API limit), weekly data
- Upsert into `hydro_reservoir` via INSERT ... ON CONFLICT DO UPDATE
- Registered in `ingest.py` as `entso-e-hydro`
- Backfill target: 2017-01-01 (5yr seasonal band needs 2017-2021 at minimum for 2022+ stats)

### 3. Analytics: `backend/analytics/hydro.py`

New module producing three energy_hub.duckdb tables from the PostgreSQL `hydro_reservoir`
table via the market-data `loaders/` package (`_query` / `get_read_conn`).

**`hydro_reservoir_history`**
```
country VARCHAR, week_date DATE, stored_twh REAL
```
Full weekly history per country. `stored_twh = stored_mwh / 1e6`.

**`hydro_reservoir_seasonal`**
```
country VARCHAR, week_of_year SMALLINT, avg5_twh REAL, min5_twh REAL, max5_twh REAL
```
Trailing 5 full calendar years (years Y-6 through Y-2 relative to the current year,
excluding the current partial year and last full year to avoid recency bias matching
the gas storage convention). Aggregated by ISO week number (1-53).

**`hydro_reservoir_latest`**
```
country VARCHAR, week_date DATE, stored_twh REAL,
vs_avg5_pct REAL,   -- (stored - avg5) / avg5 * 100
yoy_pct REAL,       -- vs same week prior year
rank5yr_pct REAL    -- percentile 0-100 within 5yr same-week distribution
```
One row per country, most recent week with data.

### 4. refresh.py integration

`build_hydro_tables()` called from `refresh.py` alongside the existing analytics modules.
Tables written inside the same `CREATE OR REPLACE TABLE` transaction as all other tables.

### 5. API endpoints: `backend/app/main.py`

**`GET /api/hydro/map`**
Returns `hydro_reservoir_latest` for all countries. Response schema:
```json
{
  "countries": [
    {
      "country": "NO",
      "week_date": "2025-06-08",
      "stored_twh": 52.3,
      "vs_avg5_pct": -8.2,
      "yoy_pct": -3.1,
      "rank5yr_pct": 24.0
    }
  ],
  "refreshed_at": "2025-06-08T20:15:00Z"
}
```

**`GET /api/hydro/country/{cc}`**
Seasonal payload for the fan chart. Response schema:
```json
{
  "country": "NO",
  "history": [{"week_date": "2024-01-07", "stored_twh": 63.1}, ...],
  "seasonal": [{"week_of_year": 1, "avg5_twh": 62.0, "min5_twh": 54.0, "max5_twh": 70.0}, ...],
  "latest": {"week_date": "...", "stored_twh": 52.3, "vs_avg5_pct": -8.2, "yoy_pct": -3.1}
}
```
History covers current year + prior year (enough for the fan chart). Seasonal covers
weeks 1-53.

## Frontend changes

### 1. Mode toggle on /generation

The existing metric-mode selector (Renewable % | Dominant Fuel) gains a third option:
**Hydro Reserves**. Implemented as the same button group used for existing modes.

### 2. Choropleth coloring in Hydro mode

- **Color scale:** Diverging, `vs_avg5_pct` domain anchored at [-30, 0, +30]:
  - <= -30%: deep red (`#b91c1c`)
  - -15%: medium red (`#ef4444`)
  - 0%: neutral grey (`#6b7280`)
  - +15%: medium blue (`#3b82f6`)
  - +30%: deep blue (`#1d4ed8`)
  - Colorblind-safe (red-blue diverging avoids red-green)
- **Country vs zone:** The GeoJSON is bidding-zone level. A `ZONE_TO_HYDRO_COUNTRY` constant
  maps each zone to its ENTSO-E country code:
  ```
  NO-1..NO-5 -> NO
  SE-1..SE-4 -> SE
  ES -> ES
  FI -> FI
  RO -> RO
  IT-NORD, IT-CNOR, IT-CSUD, IT-SUD, IT-SICI, IT-SARD -> IT
  CH -> CH
  PT -> PT
  FR -> FR
  GR -> GR
  AT -> AT
  HR -> HR
  ```
  Serbia (RS) and Montenegro (ME) are excluded if not present in bidding_zones.geojson.
- **No-data zones:** Opacity 0.15, fill `#374151` (same as current no-data style).
- **Legend:** Horizontal diverging gradient strip, labeled "% vs 5yr avg", ticks at
  -30, -15, 0, +15, +30.

### 3. Stat strip in Hydro mode

Replaces the Renewable % stat strip with:
- **EU hydro** (volume-weighted avg of all 14 countries by stored_twh capacity proxy):
  shown as `vs_avg5_pct` chip with trend arrow
- **NO** and **SE** shown individually (they dominate and are the market-relevant signal)
- Format: `NO -8% vs avg | SE +3% | EU -4%`

### 4. Zone panel: HydroReservoirSection

Added to the zone panel (GenerationZonePanel or equivalent) for zones that have a
hydro country mapping. Rendered below the existing generation content. Always shown when
clicking into a hydro zone (regardless of active choropleth mode), so the context is
available even when viewing Renewable % mode.

**Layout:**
- Header: "Hydro Reservoirs - [Country Name]"
- Chips: `stored_twh TWh stored`, `vs_avg5_pct% vs 5yr avg` (red/green colored),
  `yoy_pct% vs last year`
- Seasonal fan chart (recharts ComposedChart):
  - X axis: week of year (1-53), labeled Jan/Apr/Jul/Oct at approximate week positions
  - Y axis: TWh stored
  - Area: 5yr min-max band (light fill, same palette as gas storage band)
  - Line: 5yr avg (dashed, mid-weight)
  - Line: prior year (thin, muted)
  - Line: current year (solid white/accent, prominent)
  - Tooltip: shows all four values at hovered week
- Data fetched via `GET /api/hydro/country/{cc}`, cached 15 min (TanStack Query).

### 5. Query hook

New `useHydroMap()` and `useHydroCountry(cc)` hooks in `src/lib/api.ts` (or wherever
the existing query hooks live). staleTime 15 minutes (data is weekly, but API data
freshness is daily after refresh).

## Zone-to-country mapping completeness

Confirmed zones in existing bidding_zones.geojson that map to hydro countries: NO-1..5,
SE-1..4, FR, AT, FI, PT, ES, GR, RO, HR, IT-NORD (and likely other IT zones). CH and
the Balkan zones (RS, ME) may not be in the GeoJSON. Code must be defensive: zones not
present in the GeoJSON simply do not appear on the map regardless of hydro data.

## What this is NOT

- Not a new page - hydro lives on /generation
- Not a forecast - shows historical fill levels and vs-avg comparison only
- Not intraday - weekly ENTSO-E data only; no higher-frequency hydro signal exists in
  the free API
- Not per-facility - country aggregate only (facility-level reservoir data is not in
  the ENTSO-E free tier)

## Phases not covered here (future)

- Hydro as a fundamental power price driver on /prices or /spreads (regression of NO
  reservoir fill vs NO-2 spot, correlation chart)
- Nordic hydro fill as a factor in the /spreads signal model
