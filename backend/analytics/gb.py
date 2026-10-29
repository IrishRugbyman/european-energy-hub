"""Great Britain rows for the power and generation tables.

GB is not on the ENTSO-E platform since Brexit, so its data comes from different
market-data tables (Elexon prices, NESO generation mix). This module reshapes them into
the exact long formats the ENTSO-E readers produce, so GB flows through the same
builders as every other zone:

- prices: (ts, zone, price_eur_mwh), hourly. The source is Elexon's Market Index price
  (EPEX), converted at the ECB reference rate. It is the GB reference price for
  short-term trades, not a day-ahead auction clearing price, which Elexon does not
  publish; ``GB_PRICE_NOTE`` says so wherever it is shown.
- generation: (zone, ts, tech, mw) in the ENTSO-E tech vocabulary. Imports and
  storage discharge are left out, as they are for the ENTSO-E zones (A75 is domestic
  generation only); pumped-storage output stays in hydro, as it does there.
"""

from __future__ import annotations

import pandas as pd
from loaders.power import load_gb_generation_mix, load_gb_prices
from loguru import logger

GB_ZONE = "GB"
GB_PRICE_NOTE = (
    "GB price is the Elexon Market Index (EPEX short-term trades), converted from GBP at "
    "the ECB reference rate. It is not a day-ahead auction price."
)

# gb_generation_mix column -> ENTSO-E tech. Both wind columns map to wind_onshore only
# so the generation builder's onshore+offshore merge yields their sum as 'wind'; the
# transmission series is a mix of onshore and offshore that NESO does not split.
_MIX_TO_TECH = {
    "gas_mw": "gas",
    "coal_mw": "coal",
    "nuclear_mw": "nuclear",
    "wind_mw": "wind_onshore",
    "wind_embedded_mw": "wind_onshore",
    "hydro_mw": "hydro",
    "biomass_mw": "biomass",
    "other_mw": "other",
    "solar_mw": "solar",
}


def prices_to_hourly(df: pd.DataFrame) -> pd.DataFrame:
    """Half-hourly GB prices -> hourly (ts, zone, price_eur_mwh).

    The hour's price is the mean of its two half-hours. An hour with only one traded
    half-hour keeps that one; an hour with no EUR price (no trades, or no ECB fixing
    yet) is dropped rather than filled.
    """
    if df.empty:
        return pd.DataFrame(columns=["ts", "zone", "price_eur_mwh"])
    hourly = (
        df.dropna(subset=["price_eur_mwh"])
        .assign(ts=lambda d: pd.to_datetime(d["ts"]).dt.floor("h"))
        .groupby("ts", as_index=False)["price_eur_mwh"]
        .mean()
    )
    hourly.insert(1, "zone", GB_ZONE)
    return hourly


def complete_days_only(rows: pd.DataFrame, now: pd.Timestamp, ts_col: str = "ts") -> pd.DataFrame:
    """Drop rows from the UTC day still in progress at ``now``.

    The ENTSO-E zones carry complete delivery days (the day-ahead auction clears a whole
    day at once), while Elexon's market index fills in through the day. Without this the
    current day shows as a null daily row, or as a base price averaged over a few
    night-time hours.
    """
    if rows.empty:
        return rows
    now = pd.Timestamp(now)
    now_utc = now.tz_convert("UTC").tz_localize(None) if now.tzinfo else now
    cutoff = now_utc.normalize()
    return rows[pd.to_datetime(rows[ts_col]) < cutoff]


def cap_at_day(rows: pd.DataFrame, last_ts, ts_col: str = "ts") -> pd.DataFrame:
    """Keep rows up to the end of the UTC day containing ``last_ts``.

    ENTSO-E prices land one day behind (the ingest on day D covers D-1), while Elexon's
    index is complete for D-1 from midnight, so GB alone would show a newer day on the
    map until the next refresh. Capping at the ENTSO-E zones' last day keeps every zone
    on the same delivery day. ``last_ts`` None (no ENTSO-E rows) leaves GB uncapped.
    """
    if rows.empty or last_ts is None or pd.isna(last_ts):
        return rows
    end = pd.Timestamp(last_ts).normalize() + pd.Timedelta(days=1)
    return rows[pd.to_datetime(rows[ts_col]) < end]


def mix_to_long(mix: pd.DataFrame) -> pd.DataFrame:
    """Wide NESO mix (indexed by ts) -> long (zone, ts, tech, mw), duplicate techs summed.

    A NULL fuel value stays out rather than becoming 0, so a missing reading does not
    read as zero output.
    """
    if mix.empty:
        return pd.DataFrame(columns=["zone", "ts", "tech", "mw"])
    cols = [c for c in _MIX_TO_TECH if c in mix.columns]
    long = (
        mix[cols]
        .rename_axis("ts")
        .reset_index()
        .melt(id_vars="ts", var_name="col", value_name="mw")
        .dropna(subset=["mw"])
    )
    long["tech"] = long["col"].map(_MIX_TO_TECH)
    out = long.groupby(["ts", "tech"], as_index=False)["mw"].sum()
    out.insert(0, "zone", GB_ZONE)
    return out[["zone", "ts", "tech", "mw"]]


def daily_from_long(long: pd.DataFrame) -> pd.DataFrame:
    """Long half-hourly rows -> (zone, gen_date, tech, mw) daily mean on the UTC day,
    the same bucketing the ENTSO-E query uses (DATE_TRUNC('day', ts))."""
    if long.empty:
        return pd.DataFrame(columns=["zone", "gen_date", "tech", "mw"])
    return (
        long.assign(gen_date=pd.to_datetime(long["ts"]).dt.floor("D"))
        .groupby(["zone", "gen_date", "tech"], as_index=False)["mw"]
        .mean()
    )


def load_price_rows(since: pd.Timestamp) -> pd.DataFrame:
    """Hourly GB price rows from ``since``; empty (with a warning) if the read fails."""
    try:
        hourly = prices_to_hourly(load_gb_prices(start=since.date()))
        return complete_days_only(hourly, pd.Timestamp.now(tz="UTC"))
    except Exception:
        logger.exception("GB price rows failed; GB omitted from the power tables")
        return prices_to_hourly(pd.DataFrame())


def load_generation_long(since: pd.Timestamp | None = None) -> pd.DataFrame:
    """Long half-hourly GB generation rows; empty (with a warning) if the read fails."""
    try:
        return mix_to_long(load_gb_generation_mix(start=since.date() if since else None))
    except Exception:
        logger.exception("GB generation rows failed; GB omitted from the generation tables")
        return mix_to_long(pd.DataFrame())
