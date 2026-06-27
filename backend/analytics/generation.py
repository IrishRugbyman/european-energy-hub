"""Generation mix analytics from power_generation_actual (ENTSO-E A75 full fuel mix).

Tables produced for energy_hub.duckdb:
  generation_daily         - daily avg MW per fuel per zone, 2021-present
  generation_hourly_recent - last 10 days of hourly mix per zone
  generation_latest        - most recent generation_daily row per zone
  capacity_factors_daily   - daily wind/solar capacity factor per zone (CF = avg_mw / installed_mw)
  forecast_accuracy        - trailing 90-day wind/solar DA forecast MAE per zone

Wind is stored as wind_onshore + wind_offshore in the source table; we merge
them here into a single 'wind' column. Nuclear and fossil fuels (coal, gas, oil)
are included. renewable_pct = (solar + wind + hydro + biomass) / total_mw.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from loguru import logger

from loaders._base import _query, get_read_conn
from loaders.power import load_installed_capacity

# Fuel types stored in power_generation_actual after fetch_generation_full
_SOURCE_TECHS = (
    "biomass",
    "coal",
    "gas",
    "geothermal",
    "hydro",
    "nuclear",
    "oil",
    "other",
    "solar",
    "wind_onshore",
    "wind_offshore",
)

# Output fuel columns (wind_onshore + wind_offshore merged into wind)
FUEL_COLS = ("biomass", "coal", "gas", "geothermal", "hydro", "nuclear", "oil", "other", "solar", "wind")

RENEWABLE_COLS = ("solar", "wind", "hydro")


def build_generation_tables() -> dict[str, pd.DataFrame]:
    """Return all generation DataFrames ready for energy_hub.duckdb."""
    daily = _build_generation_daily()
    hourly_recent = _build_generation_hourly_recent()
    latest = _build_generation_latest_from_daily(daily)
    capacity_factors = _build_capacity_factors(daily)
    forecast_daily = _build_generation_forecast_daily()
    return {
        "generation_daily": daily,
        "generation_hourly_recent": hourly_recent,
        "generation_latest": latest,
        "capacity_factors_daily": capacity_factors,
        "generation_forecast_daily": forecast_daily,
    }


# Columns of the no-look-ahead daily renewable-penetration table. Penetration is
# defined over forecast (resp. actual) load so the forecast and actual variants share
# a denominator and differ only by forecast-vs-realised - the clean basis for isolating
# the look-ahead premium in the fundamental signal arc.
FORECAST_DAILY_COLS = (
    "zone", "gen_date",
    "wind_pct", "solar_pct",                 # DA forecast wind/solar as % of forecast load
    "wind_pct_actual", "solar_pct_actual",   # realised wind/solar as % of realised load
    "load_fc_mw", "load_actual_mw",
    "nuclear_lag1_gw",                       # previous day's realised nuclear output in GW (gate-closure proxy)
)


def _empty_forecast_daily() -> pd.DataFrame:
    return pd.DataFrame(columns=list(FORECAST_DAILY_COLS))


def _build_nuclear_lag(conn) -> "pd.DataFrame | None":
    """Daily nuclear generation (GW), lagged 1 day within each zone.

    Uses power_generation_actual tech=nuclear. The shift makes day D's value equal to
    D-1's realised output -- genuinely available at gate closure for the day-ahead market.
    Zones without nuclear (IT-NORD) produce 0.0.
    """
    try:
        nuc = _query(conn, """
            SELECT zone,
                   DATE_TRUNC('day', ts)::DATE AS gen_date,
                   AVG(mw) / 1000.0 AS nuclear_gw
            FROM power_generation_actual
            WHERE tech = 'nuclear'
            GROUP BY zone, gen_date
        """)
    except Exception:
        logger.exception("nuclear lag query failed")
        return None

    if nuc is None or nuc.empty:
        return None

    nuc = nuc.copy()
    nuc["gen_date"] = pd.to_datetime(nuc["gen_date"])
    nuc = nuc.sort_values(["zone", "gen_date"]).reset_index(drop=True)
    nuc["nuclear_lag1_gw"] = nuc.groupby("zone")["nuclear_gw"].shift(1)
    return nuc[["zone", "gen_date", "nuclear_lag1_gw"]]


def _build_generation_forecast_daily() -> pd.DataFrame:
    """Daily wind/solar penetration from the ENTSO-E day-ahead forecast (A69) and load.

    The fundamental fair-value signal (Phases 42-46) originally drove off *actual*
    generation, which is not in the information set at day-ahead gate closure - a
    look-ahead. This table provides the gate-closure analog: the published DA wind+solar
    forecast as a share of the DA load forecast, per zone per day. It also carries the
    realised (actual/actual-load) penetration on the same denominator so the two can be
    compared like-for-like to quantify the look-ahead premium. All source series are read
    from market_data via the loaders connection.
    """
    try:
        conn = get_read_conn()
        gen_fc = _query(conn, """
            SELECT zone, DATE_TRUNC('day', ts)::DATE AS gen_date, tech, AVG(mw) AS mw
            FROM power_generation_forecast
            WHERE forecast_type = 'DA'
              AND tech IN ('wind_onshore', 'wind_offshore', 'solar')
            GROUP BY zone, gen_date, tech
        """)
        gen_act = _query(conn, """
            SELECT zone, DATE_TRUNC('day', ts)::DATE AS gen_date, tech, AVG(mw) AS mw
            FROM power_generation_actual
            WHERE tech IN ('wind_onshore', 'wind_offshore', 'solar')
            GROUP BY zone, gen_date, tech
        """)
        load = _query(conn, """
            SELECT zone, DATE_TRUNC('day', ts)::DATE AS gen_date, kind, AVG(mw) AS mw
            FROM power_load
            WHERE kind IN ('forecast', 'actual')
            GROUP BY zone, gen_date, kind
        """)
        nuclear_lag = _build_nuclear_lag(conn)
        conn.close()
    except Exception:
        logger.exception("_build_generation_forecast_daily failed")
        return _empty_forecast_daily()

    if gen_fc is None or gen_fc.empty or load is None or load.empty:
        logger.warning("generation_forecast_daily: missing forecast or load data")
        return _empty_forecast_daily()

    def _pivot_ws(df: pd.DataFrame) -> pd.DataFrame:
        """Long (zone, gen_date, tech, mw) -> wide wind (on+off) + solar MW."""
        if df is None or df.empty:
            return pd.DataFrame(columns=["zone", "gen_date", "wind_mw", "solar_mw"])
        w = df.pivot_table(index=["zone", "gen_date"], columns="tech", values="mw", aggfunc="sum")
        w.columns.name = None
        w = w.reset_index()
        for c in ("wind_onshore", "wind_offshore", "solar"):
            if c not in w.columns:
                w[c] = 0.0
        w["wind_mw"] = w["wind_onshore"].fillna(0.0) + w["wind_offshore"].fillna(0.0)
        w["solar_mw"] = w["solar"].fillna(0.0)
        return w[["zone", "gen_date", "wind_mw", "solar_mw"]]

    fc = _pivot_ws(gen_fc).rename(columns={"wind_mw": "wind_fc", "solar_mw": "solar_fc"})
    act = _pivot_ws(gen_act).rename(columns={"wind_mw": "wind_act", "solar_mw": "solar_act"})
    load_w = load.pivot_table(index=["zone", "gen_date"], columns="kind", values="mw", aggfunc="mean")
    load_w.columns.name = None
    load_w = load_w.reset_index().rename(columns={"forecast": "load_fc_mw", "actual": "load_actual_mw"})

    df = fc.merge(load_w, on=["zone", "gen_date"], how="inner")
    df = df.merge(act, on=["zone", "gen_date"], how="left")

    fc_ok = df["load_fc_mw"].notna() & (df["load_fc_mw"] > 0)
    df["wind_pct"] = np.where(fc_ok, df["wind_fc"] / df["load_fc_mw"] * 100, np.nan)
    df["solar_pct"] = np.where(fc_ok, df["solar_fc"] / df["load_fc_mw"] * 100, np.nan)
    act_ok = df["load_actual_mw"].notna() & (df["load_actual_mw"] > 0)
    df["wind_pct_actual"] = np.where(act_ok, df["wind_act"] / df["load_actual_mw"] * 100, np.nan)
    df["solar_pct_actual"] = np.where(act_ok, df["solar_act"] / df["load_actual_mw"] * 100, np.nan)

    df = df[df["wind_pct"].notna()].copy()
    for c in ("wind_pct", "solar_pct", "wind_pct_actual", "solar_pct_actual", "load_fc_mw", "load_actual_mw"):
        df[c] = df[c].round(3)

    # Nuclear D-1 lag: merge by zone + gen_date (both as datetime for the merge, then stringify)
    df["gen_date"] = pd.to_datetime(df["gen_date"])
    if nuclear_lag is not None and not nuclear_lag.empty:
        df = df.merge(nuclear_lag, on=["zone", "gen_date"], how="left")
        df["nuclear_lag1_gw"] = df["nuclear_lag1_gw"].fillna(0.0).round(4)
    else:
        df["nuclear_lag1_gw"] = 0.0

    df["gen_date"] = df["gen_date"].dt.strftime("%Y-%m-%d")
    df = df.sort_values(["zone", "gen_date"]).reset_index(drop=True)
    logger.info(f"generation_forecast_daily: {len(df)} rows, {df['zone'].nunique()} zones")
    return df[list(FORECAST_DAILY_COLS)].copy()


def _pivot_and_merge_wind(df: pd.DataFrame, ts_col: str) -> pd.DataFrame:
    """Pivot long (zone, ts_col, tech, mw) -> wide per-fuel columns, merge wind."""
    if df.empty:
        return df

    wide = df.pivot_table(index=["zone", ts_col], columns="tech", values="mw", aggfunc="sum")
    wide.columns.name = None
    wide = wide.reset_index()

    # Merge wind variants
    wind_cols = [c for c in ("wind_onshore", "wind_offshore") if c in wide.columns]
    wide["wind"] = wide[wind_cols].sum(axis=1) if wind_cols else 0.0
    wide = wide.drop(columns=wind_cols, errors="ignore")

    # Ensure all FUEL_COLS exist (zero-fill missing fuels)
    for col in FUEL_COLS:
        if col not in wide.columns:
            wide[col] = 0.0

    for col in FUEL_COLS:
        wide[col] = wide[col].fillna(0.0).round(1)

    wide["total_mw"] = wide[list(FUEL_COLS)].sum(axis=1)
    renewable_sum = wide[list(RENEWABLE_COLS)].sum(axis=1)
    wide["renewable_pct"] = (
        renewable_sum / wide["total_mw"].replace(0, float("nan")) * 100
    ).round(1)
    return wide


def _empty_daily() -> pd.DataFrame:
    return pd.DataFrame(columns=["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"])


def _empty_hourly() -> pd.DataFrame:
    return pd.DataFrame(columns=["zone", "ts"] + list(FUEL_COLS))


def _build_generation_daily() -> pd.DataFrame:
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT
                zone,
                DATE_TRUNC('day', ts)::DATE AS gen_date,
                tech,
                AVG(mw) AS mw
            FROM power_generation_actual
            GROUP BY zone, gen_date, tech
            ORDER BY zone, gen_date, tech
            """,
        )
        conn.close()
    except Exception:
        logger.exception("_build_generation_daily failed")
        return _empty_daily()

    if df.empty:
        return _empty_daily()

    wide = _pivot_and_merge_wind(df, "gen_date")
    wide["gen_date"] = wide["gen_date"].astype(str)
    cols = ["zone", "gen_date"] + list(FUEL_COLS) + ["renewable_pct", "total_mw"]
    return wide[[c for c in cols if c in wide.columns]].copy()


def _build_generation_hourly_recent() -> pd.DataFrame:
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT zone, ts, tech, mw
            FROM power_generation_actual
            WHERE ts >= NOW() - INTERVAL '10 days'
            ORDER BY zone, ts, tech
            """,
        )
        conn.close()
    except Exception:
        logger.exception("_build_generation_hourly_recent failed")
        return _empty_hourly()

    if df.empty:
        return _empty_hourly()

    wide = _pivot_and_merge_wind(df, "ts")
    fuel_present = [c for c in FUEL_COLS if c in wide.columns]
    return wide[["zone", "ts"] + fuel_present].copy()


def _build_generation_latest_from_daily(daily: pd.DataFrame) -> pd.DataFrame:
    if daily.empty:
        return _empty_daily()
    idx = daily.groupby("zone")["gen_date"].idxmax()
    return daily.loc[idx].reset_index(drop=True)


def _build_capacity_factors(daily: pd.DataFrame) -> pd.DataFrame:
    """Compute daily wind/solar capacity factors per zone.

    CF = daily_avg_mw / installed_mw (forward-filled from annual ENTSO-E snapshots).
    Installed capacity is matched by year: the year-N snapshot applies to all days
    in year N until a newer snapshot supersedes it.

    Returns DataFrame: zone, gen_date, wind_cf, solar_cf,
    wind_mw, solar_mw, wind_installed_mw, solar_installed_mw.
    """
    _empty = pd.DataFrame(columns=[
        "zone", "gen_date", "wind_cf", "solar_cf",
        "wind_mw", "solar_mw", "wind_installed_mw", "solar_installed_mw",
    ])
    if daily.empty:
        return _empty

    try:
        cap = load_installed_capacity()
    except Exception:
        logger.exception("_build_capacity_factors: load_installed_capacity failed")
        return _empty

    if cap.empty:
        return _empty

    # Compute total wind installed (onshore + offshore)
    cap = cap.copy()
    cap["wind_installed_mw"] = (
        cap["wind_onshore_mw"].fillna(0) + cap["wind_offshore_mw"].fillna(0)
    )
    cap = cap.rename(columns={"solar_mw": "solar_installed_mw"})
    cap = cap[["zone", "year", "wind_installed_mw", "solar_installed_mw"]]

    # Add year column to daily generation data
    gen = daily[["zone", "gen_date", "wind", "solar"]].copy()
    gen["gen_date"] = pd.to_datetime(gen["gen_date"])
    gen["year"] = gen["gen_date"].dt.year.astype("int64")

    # Ensure capacity year is same dtype before merge_asof
    cap["year"] = cap["year"].astype("int64")

    # Merge: for each zone, use the capacity snapshot for that year (or last prior year).
    # merge_asof requires left sorted by 'on' key globally.
    cap_sorted = cap.sort_values("year")
    merged = pd.merge_asof(
        gen.sort_values("year"),
        cap_sorted,
        by="zone",
        on="year",
        direction="backward",
    )

    # Capacity factors (clamped to [0, 1])
    merged["wind_installed_mw"] = merged["wind_installed_mw"].replace(0, float("nan"))
    merged["solar_installed_mw"] = merged["solar_installed_mw"].replace(0, float("nan"))
    merged["wind_cf"] = (merged["wind"] / merged["wind_installed_mw"]).clip(0, 1).round(4)
    merged["solar_cf"] = (merged["solar"] / merged["solar_installed_mw"]).clip(0, 1).round(4)

    merged["gen_date"] = merged["gen_date"].dt.strftime("%Y-%m-%d")
    result = merged[[
        "zone", "gen_date", "wind_cf", "solar_cf",
        "wind", "solar", "wind_installed_mw", "solar_installed_mw",
    ]].rename(columns={"wind": "wind_mw", "solar": "solar_mw"})

    return result.dropna(subset=["wind_cf", "solar_cf"], how="all").reset_index(drop=True)


def compute_forecast_accuracy(window_days: int = 90) -> pd.DataFrame:
    """Trailing wind/solar DA forecast accuracy per zone.

    Joins power_generation_actual with power_generation_forecast on (ts, zone, tech)
    for wind_onshore, wind_offshore, solar over the trailing window_days.
    Aggregates into wind (onshore + offshore combined) and solar MAE per zone,
    then normalises by installed capacity.

    Returns a DataFrame with columns:
      zone, wind_mae_mw, wind_avg_mw, solar_mae_mw, solar_avg_mw,
      wind_installed_mw, solar_installed_mw, wind_mae_pct, solar_mae_pct, n_hours
    """
    conn = get_read_conn()
    sql = f"""
        SELECT
            a.zone,
            a.tech,
            ROUND(AVG(ABS(a.mw - f.mw))::numeric, 1)      AS mae_mw,
            ROUND(AVG(a.mw)::numeric, 1)                   AS avg_actual_mw,
            COUNT(*)                                        AS n_hours
        FROM power_generation_actual a
        JOIN power_generation_forecast f
            ON a.ts = f.ts AND a.zone = f.zone AND a.tech = f.tech
        WHERE a.tech IN ('wind_onshore', 'wind_offshore', 'solar')
          AND a.ts >= NOW() - INTERVAL '{window_days} days'
        GROUP BY a.zone, a.tech
        HAVING COUNT(*) >= 200
        ORDER BY a.zone, a.tech
    """
    df = _query(conn, sql)
    if df is None or df.empty:
        logger.warning("forecast_accuracy: no data")
        return pd.DataFrame(
            columns=["zone", "wind_mae_mw", "wind_avg_mw", "solar_mae_mw", "solar_avg_mw",
                     "wind_installed_mw", "solar_installed_mw", "wind_mae_pct", "solar_mae_pct", "n_hours"]
        )

    # Cast Decimal columns returned by PostgreSQL ROUND(::numeric) to float
    for col in ("mae_mw", "avg_actual_mw"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Pivot: (zone, tech) -> columns
    wind = df[df["tech"].isin(["wind_onshore", "wind_offshore"])].groupby("zone", as_index=False).agg(
        wind_mae_mw=("mae_mw", "sum"),
        wind_avg_mw=("avg_actual_mw", "sum"),
        n_hours=("n_hours", "max"),
    )
    solar = df[df["tech"] == "solar"][["zone", "mae_mw", "avg_actual_mw"]].rename(
        columns={"mae_mw": "solar_mae_mw", "avg_actual_mw": "solar_avg_mw"}
    )

    combined = wind.merge(solar, on="zone", how="outer")

    # Join installed capacity for normalisation
    # load_installed_capacity returns columns: zone, year, solar_mw, wind_onshore_mw, wind_offshore_mw, ...
    cap_df = load_installed_capacity()
    if cap_df is not None and not cap_df.empty:
        latest_year = cap_df["year"].max()
        cap_latest = cap_df[cap_df["year"] == latest_year].copy()
        cap_latest["wind_installed_mw"] = (
            cap_latest["wind_onshore_mw"].fillna(0) + cap_latest["wind_offshore_mw"].fillna(0)
        )
        cap_latest["solar_installed_mw"] = cap_latest["solar_mw"].fillna(0)
        combined = combined.merge(
            cap_latest[["zone", "wind_installed_mw", "solar_installed_mw"]],
            on="zone", how="left"
        )
    else:
        combined["wind_installed_mw"] = float("nan")
        combined["solar_installed_mw"] = float("nan")

    # Compute % of installed capacity
    combined["wind_mae_pct"] = (
        combined["wind_mae_mw"] / combined["wind_installed_mw"] * 100
    ).round(1)
    combined["solar_mae_pct"] = (
        combined["solar_mae_mw"] / combined["solar_installed_mw"] * 100
    ).round(1)

    # Round MW columns
    for col in ["wind_mae_mw", "wind_avg_mw", "solar_mae_mw", "solar_avg_mw",
                "wind_installed_mw", "solar_installed_mw"]:
        if col in combined.columns:
            combined[col] = combined[col].round(0)

    combined["n_hours"] = combined["n_hours"].fillna(0).astype(int)

    return combined.sort_values("wind_mae_pct", ascending=False, na_position="last").reset_index(drop=True)
