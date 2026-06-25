"""Nuclear thermal curtailment risk tracker.

Uses Open-Meteo (free, no key) to fetch daily max air temperature at each French nuclear
plant's coordinates. River temperature lags air temperature by 1-3 days and is typically
~5°C cooler in summer heat events. When air temp sustained >35°C near a plant, the
adjacent river is likely approaching thermal permit limits (~24-28°C), triggering EDF
curtailment orders from ASN.

Called at refresh time; writes three tables to energy_hub.duckdb:
  nuclear_heat_risk_latest   - one row per plant, current + risk level + 10d forecast peak
  nuclear_heat_risk_trend    - 90-day history + 10-day forecast per plant
  nuclear_heat_risk_seasonal - 5yr avg/min/max per (plant_code, doy)
"""

from __future__ import annotations

import datetime
import time
from typing import Any

import pandas as pd
import requests
from loguru import logger

# French nuclear plants on thermally-constrained rivers.
# capacity_mw is the curtailable output (not installed - excludes units long offline).
NUCLEAR_PLANTS: list[dict[str, Any]] = [
    {"code": "TRICASTIN",   "name": "Tricastin",     "river": "Rhone",   "lat": 44.332, "lon": 4.732,  "capacity_mw": 3600},
    {"code": "CRUAS",       "name": "Cruas-Meysse",  "river": "Rhone",   "lat": 44.638, "lon": 4.755,  "capacity_mw": 3700},
    {"code": "SAINT_ALBAN", "name": "Saint-Alban",   "river": "Rhone",   "lat": 45.408, "lon": 4.805,  "capacity_mw": 1500},
    {"code": "BUGEY",       "name": "Bugey",         "river": "Rhone",   "lat": 45.797, "lon": 5.270,  "capacity_mw": 1850},
    {"code": "GOLFECH",     "name": "Golfech",       "river": "Garonne", "lat": 44.107, "lon": 0.851,  "capacity_mw": 1400},
    {"code": "DAMPIERRE",   "name": "Dampierre",     "river": "Loire",   "lat": 47.734, "lon": 2.514,  "capacity_mw": 3700},
    {"code": "BELLEVILLE",  "name": "Belleville",    "river": "Loire",   "lat": 47.510, "lon": 2.868,  "capacity_mw": 2600},
    {"code": "CATTENOM",    "name": "Cattenom",      "river": "Moselle", "lat": 49.400, "lon": 6.218,  "capacity_mw": 5400},
    {"code": "CHINON",      "name": "Chinon",        "river": "Loire",   "lat": 47.231, "lon": 0.164,  "capacity_mw": 1900},
]

# Air temperature thresholds -> river thermal risk level.
# River temp ≈ air_max - 5°C in sustained summer heat; permit limits ~24-28°C.
THRESHOLDS = [
    (38.0, "critical"),   # river likely >= 26°C, ASN curtailment probable
    (35.0, "warning"),    # river likely >= 24°C, approaching permit limit
    (30.0, "watch"),      # river warming, monitor closely
]

_FORECAST_API = "https://api.open-meteo.com/v1/forecast"
_ARCHIVE_API  = "https://archive-api.open-meteo.com/v1/archive"
_COMMON_PARAMS = "daily=temperature_2m_max&timezone=Europe/Paris"


def _alert(temp_c: float | None) -> str:
    if temp_c is None:
        return "normal"
    for thr, level in THRESHOLDS:
        if temp_c >= thr:
            return level
    return "normal"


def _get(url: str, params: dict, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            if attempt == retries - 1:
                raise
            logger.warning(f"Open-Meteo retry {attempt + 1}: {exc}")
            time.sleep(2 ** attempt)
    return {}


def build_heat_risk_tables() -> dict[str, pd.DataFrame]:
    """Fetch Open-Meteo data for all plants and return three DataFrames."""
    today = datetime.date.today()
    band_start = datetime.date(today.year - 5, 1, 1)
    band_end   = datetime.date(today.year - 1, 12, 31)

    trend_rows: list[dict] = []
    seasonal_rows: list[dict] = []
    latest_rows: list[dict] = []

    for plant in NUCLEAR_PLANTS:
        code = plant["code"]
        lat, lon = plant["lat"], plant["lon"]
        name = plant["name"]
        river = plant["river"]
        cap = plant["capacity_mw"]

        # 1. Current: 90-day trailing history + 10-day forecast
        try:
            current = _get(_FORECAST_API, {
                "latitude": lat, "longitude": lon,
                "daily": "temperature_2m_max",
                "timezone": "Europe/Paris",
                "past_days": 90,
                "forecast_days": 10,
            })
            times = current["daily"]["time"]
            temps = current["daily"]["temperature_2m_max"]
            for dt_str, t in zip(times, temps):
                is_fc = dt_str > today.isoformat()
                trend_rows.append({
                    "plant_code": code, "plant_name": name, "river": river,
                    "obs_date": dt_str, "temp_max_c": t, "is_forecast": is_fc,
                })
        except Exception as exc:
            logger.error(f"heat_risk: failed to fetch current for {code}: {exc}")
            times, temps = [], []

        # 2. Seasonal baseline: 5 prior full calendar years
        try:
            archive = _get(_ARCHIVE_API, {
                "latitude": lat, "longitude": lon,
                "start_date": band_start.isoformat(),
                "end_date": band_end.isoformat(),
                "daily": "temperature_2m_max",
                "timezone": "Europe/Paris",
            })
            df_arch = pd.DataFrame({
                "date": pd.to_datetime(archive["daily"]["time"]),
                "temp": archive["daily"]["temperature_2m_max"],
            }).dropna()
            df_arch["doy"] = df_arch["date"].dt.dayofyear
            seasonal = (
                df_arch.groupby("doy")["temp"]
                .agg(avg5="mean", min5="min", max5="max")
                .reset_index()
            )
            for _, row in seasonal.iterrows():
                seasonal_rows.append({
                    "plant_code": code, "doy": int(row["doy"]),
                    "avg5": round(float(row["avg5"]), 1),
                    "min5": round(float(row["min5"]), 1),
                    "max5": round(float(row["max5"]), 1),
                })
        except Exception as exc:
            logger.error(f"heat_risk: failed to fetch archive for {code}: {exc}")
            seasonal = pd.DataFrame()

        # 3. Latest summary for this plant
        today_str = today.isoformat()
        obs_temps = [(dt, t) for dt, t in zip(times, temps) if dt <= today_str and t is not None]
        fc_temps  = [(dt, t) for dt, t in zip(times, temps) if dt >  today_str and t is not None]
        latest_temp  = obs_temps[-1][1] if obs_temps else None
        latest_date  = obs_temps[-1][0] if obs_temps else None
        peak_fc_temp = max((t for _, t in fc_temps), default=None)
        peak_fc_date = next((dt for dt, t in fc_temps if t == peak_fc_temp), None) if peak_fc_temp else None

        # 5yr avg at today's DOY
        doy = today.timetuple().tm_yday
        avg5 = None
        if not seasonal.empty and "doy" in seasonal.columns:
            row = seasonal[seasonal["doy"] == doy]
            if not row.empty:
                avg5 = float(row["avg5"].iloc[0])

        # 5-day rolling sum > 35°C (heat wave indicator)
        recent5 = [t for _, t in obs_temps[-5:] if t is not None]
        days_above_35 = sum(1 for t in recent5 if t >= 35.0)

        latest_rows.append({
            "plant_code": code, "plant_name": name, "river": river,
            "capacity_mw": cap, "lat": lat, "lon": lon,
            "obs_date": latest_date, "temp_max_c": latest_temp,
            "avg5_temp_c": avg5,
            "anomaly_c": round(latest_temp - avg5, 1) if latest_temp is not None and avg5 is not None else None,
            "alert_level": _alert(latest_temp),
            "days_above_35_last5": days_above_35,
            "peak_fc_temp_c": peak_fc_temp,
            "peak_fc_date": peak_fc_date,
            "fc_alert_level": _alert(peak_fc_temp),
        })

    df_latest   = pd.DataFrame(latest_rows)
    df_trend    = pd.DataFrame(trend_rows)
    df_seasonal = pd.DataFrame(seasonal_rows)

    return {
        "nuclear_heat_risk_latest":   df_latest,
        "nuclear_heat_risk_trend":    df_trend,
        "nuclear_heat_risk_seasonal": df_seasonal,
    }
