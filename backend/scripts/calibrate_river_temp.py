"""Calibrate the air_temp -> river_temp heuristic using Hub'Eau historical data.

Fetches hourly river temperature at Rhone/Roquemaure (station 06121500, 2008-2026)
and Open-Meteo archive daily max air temperature at the same coordinates,
then characterises the real distribution of (river_daily_max - air_daily_max).

Key question: during sustained heat events (air_max >= 30C), is the -5C offset
assumed in heat_risk.py accurate, and how much variance is there?

Outputs:
  1. Console table: offset stats by month and by air-temp regime
  2. results/calibration_river_temp.csv  (daily joined data)

Usage:
    cd ~/quant/energy/backend
    .venv/bin/python scripts/calibrate_river_temp.py
"""

from __future__ import annotations

import time
import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import requests

# ---- constants ---------------------------------------------------------------

# Rhone at Roquemaure, BRGM station 06121500
# lat=44.072, lon=4.769 - 28 km downstream from Tricastin
STATION   = "06121500"
STAT_LAT  = 44.072
STAT_LON  = 4.769

DATA_START = datetime.date(2008, 10, 14)   # first Hub'Eau record at this station
DATA_END   = datetime.date(2026, 3, 25)    # last known update (station went stale after this)

HUBEAU_URL   = "https://hubeau.eaufrance.fr/api/v1/temperature/chronique"
ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"

OUT_CSV = Path(__file__).parent.parent / "results" / "calibration_river_temp.csv"

# ---- helpers -----------------------------------------------------------------

def _get(url: str, params: dict, retries: int = 4) -> dict:
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  retry {attempt + 1} in {wait}s: {exc}")
            time.sleep(wait)
    return {}


def fetch_hubeau_year(year: int) -> pd.DataFrame:
    """Fetch all hourly river temp records for one calendar year, return daily max."""
    start = max(DATA_START, datetime.date(year, 1, 1)).isoformat()
    end   = min(DATA_END,   datetime.date(year, 12, 31)).isoformat()
    if start > end:
        return pd.DataFrame()

    rows: list[dict] = []
    page = 1
    page_size = 5000
    while True:
        data = _get(HUBEAU_URL, {
            "code_station":      STATION,
            "grandeur_hydro":    "T",
            "date_debut_mesure": start,
            "date_fin_mesure":   end,
            "format":            "json",
            "size":              page_size,
            "page":              page,
        })
        records = data.get("data", [])
        rows.extend(records)
        total = data.get("count", 0)
        if len(rows) >= total or not records:
            break
        page += 1
        time.sleep(0.2)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame({
        "date":        pd.to_datetime([r["date_mesure_temp"] for r in rows]),
        "river_temp":  [r["resultat"] for r in rows],
    })
    df["date"] = df["date"].dt.date
    daily = df.groupby("date")["river_temp"].max().reset_index()
    daily.columns = ["date", "river_max_c"]
    return daily


def fetch_openmeteo_archive(start: str, end: str) -> pd.DataFrame:
    """Fetch daily max air temperature from Open-Meteo archive."""
    data = _get(ARCHIVE_URL, {
        "latitude":   STAT_LAT,
        "longitude":  STAT_LON,
        "start_date": start,
        "end_date":   end,
        "daily":      "temperature_2m_max",
        "timezone":   "Europe/Paris",
    })
    times = data["daily"]["time"]
    temps = data["daily"]["temperature_2m_max"]
    df = pd.DataFrame({
        "date":     [datetime.date.fromisoformat(t) for t in times],
        "air_max_c": temps,
    })
    return df.dropna()


# ---- main --------------------------------------------------------------------

def main() -> None:
    print(f"=== Calibrating river temp heuristic: Rhone at Roquemaure ({STATION}) ===\n")

    # 1. Fetch Hub'Eau river temps year by year
    print("Fetching Hub'Eau hourly river temps (2008-2026), year by year...")
    river_frames: list[pd.DataFrame] = []
    for year in range(DATA_START.year, DATA_END.year + 1):
        print(f"  {year}...", end=" ", flush=True)
        df = fetch_hubeau_year(year)
        if not df.empty:
            river_frames.append(df)
            print(f"{len(df)} days")
        else:
            print("no data")

    df_river = pd.concat(river_frames, ignore_index=True)
    print(f"\nRiver data: {len(df_river)} days, "
          f"{df_river['date'].min()} to {df_river['date'].max()}")

    # 2. Fetch Open-Meteo archive air temps for the same period
    print("\nFetching Open-Meteo archive air temps (2008-2026)...")
    # Split to avoid a single huge request
    df_air1 = fetch_openmeteo_archive(DATA_START.isoformat(), "2017-12-31")
    df_air2 = fetch_openmeteo_archive("2018-01-01", DATA_END.isoformat())
    df_air  = pd.concat([df_air1, df_air2], ignore_index=True)
    print(f"Air data: {len(df_air)} days, {df_air['date'].min()} to {df_air['date'].max()}")

    # 3. Join on date
    df_river["date"] = pd.to_datetime(df_river["date"])
    df_air["date"]   = pd.to_datetime(df_air["date"])
    df = df_river.merge(df_air, on="date", how="inner").dropna()
    df["offset_c"]  = df["river_max_c"] - df["air_max_c"]   # negative = river cooler than air
    df["month"]     = df["date"].dt.month
    df["year"]      = df["date"].dt.year

    print(f"\nJoined: {len(df)} days with both river + air data\n")

    # 4. Save daily CSV
    OUT_CSV.parent.mkdir(exist_ok=True)
    df.to_csv(OUT_CSV, index=False)
    print(f"Saved daily data -> {OUT_CSV}\n")

    # 5. Overall stats
    print("=== Overall offset (river_daily_max - air_daily_max) ===")
    o = df["offset_c"]
    print(f"  n={len(o):,}  mean={o.mean():.2f}  "
          f"p5={o.quantile(.05):.1f}  p25={o.quantile(.25):.1f}  "
          f"p50={o.quantile(.50):.1f}  p75={o.quantile(.75):.1f}  "
          f"p95={o.quantile(.95):.1f}\n")

    # 6. By month
    print("=== Offset by calendar month ===")
    month_names = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
                   7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}
    print(f"{'Month':>6} {'n':>5} {'mean':>6} {'p25':>6} {'p50':>6} {'p75':>6} {'p95':>6}")
    for m, grp in df.groupby("month"):
        o = grp["offset_c"]
        print(f"{month_names[m]:>6} {len(o):>5} {o.mean():>6.2f} "
              f"{o.quantile(.25):>6.1f} {o.quantile(.50):>6.1f} "
              f"{o.quantile(.75):>6.1f} {o.quantile(.95):>6.1f}")

    # 7. By air-temp regime - the critical question for heat_risk.py
    print("\n=== Offset by air_max regime (heat-event calibration) ===")
    bins   = [-np.inf, 20, 25, 30, 33, 35, 37, np.inf]
    labels = ["<20","20-25","25-30","30-33","33-35","35-37",">=37"]
    df["regime"] = pd.cut(df["air_max_c"], bins=bins, labels=labels)
    print(f"{'Regime':>8} {'n':>5} {'mean':>6} {'p10':>6} {'p25':>6} {'p50':>6} {'p75':>6} {'p90':>6}")
    for lbl, grp in df.groupby("regime", observed=True):
        if len(grp) < 5:
            continue
        o = grp["offset_c"]
        print(f"{str(lbl):>8} {len(o):>5} {o.mean():>6.2f} "
              f"{o.quantile(.10):>6.1f} {o.quantile(.25):>6.1f} "
              f"{o.quantile(.50):>6.1f} {o.quantile(.75):>6.1f} "
              f"{o.quantile(.90):>6.1f}")

    # 8. Multi-day heat spell analysis: days 1-7 of a heat spell (air_max >= 30)
    print("\n=== During heat spells (air_max >= 30C): offset by consecutive hot day ===")
    df_sorted = df.sort_values("date").copy()
    df_sorted["hot"] = df_sorted["air_max_c"] >= 30.0
    # Assign spell number and consecutive day within spell
    df_sorted["spell_id"] = (df_sorted["hot"] != df_sorted["hot"].shift()).cumsum()
    df_sorted["day_in_spell"] = df_sorted.groupby("spell_id").cumcount() + 1
    df_sorted.loc[~df_sorted["hot"], "day_in_spell"] = 0

    hot = df_sorted[df_sorted["hot"] & (df_sorted["day_in_spell"] <= 10)]
    if not hot.empty:
        print(f"{'Day':>4} {'n':>5} {'mean':>6} {'p25':>6} {'p50':>6} {'p75':>6}")
        for day, grp in hot.groupby("day_in_spell"):
            o = grp["offset_c"]
            if len(o) < 3:
                continue
            print(f"{day:>4} {len(o):>5} {o.mean():>6.2f} "
                  f"{o.quantile(.25):>6.1f} {o.quantile(.50):>6.1f} "
                  f"{o.quantile(.75):>6.1f}")

    # 9. River temp exceedance: how often does river_max actually exceed permit limits?
    print("\n=== River temp exceedance (river_max >= threshold, Jun-Sep only) ===")
    summer = df[df["month"].isin([6, 7, 8, 9])]
    for thr in [22, 24, 25, 26, 27, 28]:
        n = (summer["river_max_c"] >= thr).sum()
        pct = 100 * n / len(summer)
        avg_air = summer[summer["river_max_c"] >= thr]["air_max_c"].mean() if n > 0 else float("nan")
        print(f"  river >= {thr}C: {n:4d} days ({pct:.1f}%), "
              f"mean air_max on those days = {avg_air:.1f}C")

    # 10. Key takeaway for heat_risk.py threshold calibration
    print("\n=== Implied river temp at heat_risk.py thresholds ===")
    print("   Current heuristic: implied_river = air_max - 5.0")
    print("   From calibration (summer, air_max >= 30C):")
    hot_summer = df[(df["month"].isin([6, 7, 8, 9])) & (df["air_max_c"] >= 30)]
    if not hot_summer.empty:
        off = hot_summer["offset_c"]
        print(f"     median offset = {off.median():.2f}C  "
              f"(p25={off.quantile(.25):.2f}, p75={off.quantile(.75):.2f})")
        print(f"     -> for air_max=35C: "
              f"median river={35+off.median():.1f}, "
              f"p25={35+off.quantile(.25):.1f}, "
              f"p75={35+off.quantile(.75):.1f}")
        print(f"     -> for air_max=38C: "
              f"median river={38+off.median():.1f}, "
              f"p25={38+off.quantile(.25):.1f}, "
              f"p75={38+off.quantile(.75):.1f}")

        # Air temp at which river >= 24C (normal permit limit)
        # river = air + offset_median -> air = 24 - offset_median
        implied_air_24 = 24 - off.median()
        implied_air_27 = 27 - off.median()
        print(f"\n   Air_max at which median river >= 24C (permit): {implied_air_24:.1f}C")
        print(f"   Air_max at which median river >= 27C (summer derogation): {implied_air_27:.1f}C")


if __name__ == "__main__":
    main()
