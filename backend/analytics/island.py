"""Island (non-interconnected) power system analytics.

Builds the tables behind the Corsica view. An EDF SEI island has no market price, so the
usual price analytics are meaningless for it; what matters instead is **where the power
came from**: the subsea cable, the local oil fleet, or local renewables. The cable is the
island's cheap marginal supply, so cable share is the closest thing it has to a price
signal, and the oil fleet is what runs when the cable cannot cover the gap.

Tables produced (all keyed on `zone`, currently FR-COR only):

  island_daily          - daily mean cable flow, local generation by broad category, and
                          cable share of total supply. Padded across the source gap.
  island_hourly_recent  - last 14 days at native resolution (the EDF realtime window).
  island_hourly_profile - mean intraday shape over the trailing year of available data.
  island_latest         - one headline row per zone.

**The gap is explicit.** The EDF history set is frozen at 2024-12-31 and the realtime feed
only retains 14 days, so nothing exists between 2025-01-01 and 2026-07-19. `island_daily`
is reindexed over the full calendar so those days are present with NULL values. Without
that padding a line chart silently draws a straight segment across 19 missing months,
which reads as data rather than absence.
"""

from __future__ import annotations

import pandas as pd
from loaders._base import _query, get_read_conn

# Zones with no market price, served by EDF SEI. Kept here rather than inlined so the
# frontend's NO_PRICE_ZONES has a single backend counterpart to stay in sync with.
ISLAND_ZONES = ("FR-COR",)

# Native resolution of the realtime feed is 15-min and its window is 14 days.
_HOURLY_RECENT_DAYS = 14
_PROFILE_DAYS = 365

# Local generation is rolled up into three categories that actually mean something on an
# island: the dispatchable oil fleet, renewables, and everything else.
_OIL_TECHS = ("oil", "coal", "gas")
_RENEWABLE_TECHS = ("solar", "wind_onshore", "wind_offshore", "hydro", "biomass", "geothermal")

_DAILY_COLS = [
    "zone",
    "gen_date",
    "net_import_mw",
    "min_import_mw",
    "max_import_mw",
    "local_gen_mw",
    "oil_mw",
    "renewable_mw",
    "total_supply_mw",
    "import_share_pct",
    "renewable_share_pct",
]
_HOURLY_COLS = ["zone", "ts", "net_import_mw", "oil_mw", "renewable_mw", "total_supply_mw"]
_PROFILE_COLS = [
    "zone",
    "hour",
    "net_import_mw",
    "oil_mw",
    "renewable_mw",
    "import_share_pct",
    "n_days",
]
_LATEST_COLS = [
    "zone",
    "gen_date",
    "net_import_mw",
    "local_gen_mw",
    "oil_mw",
    "renewable_mw",
    "total_supply_mw",
    "import_share_pct",
    "renewable_share_pct",
    "max_import_mw",
    "peak_supply_mw",
    "data_start",
    "data_end",
    "gap_days",
]


def build_island_tables() -> dict[str, pd.DataFrame]:
    """Return all island DataFrames ready for energy_hub.duckdb."""
    imports = _load_imports()
    generation = _load_generation()

    daily = _build_daily(imports, generation)
    hourly_recent = _build_hourly_recent(imports, generation)
    profile = _build_hourly_profile(imports, generation)
    latest = _build_latest(daily)

    return {
        "island_daily": daily,
        "island_hourly_recent": hourly_recent,
        "island_hourly_profile": profile,
        "island_latest": latest,
    }


def _load_imports() -> pd.DataFrame:
    """Raw (zone, ts, net_import_mw) for every island zone."""
    empty = pd.DataFrame(columns=["zone", "ts", "net_import_mw"])
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT zone, ts, net_import_mw
            FROM island_net_imports
            WHERE zone = ANY(%s)
            ORDER BY zone, ts
            """,
            [list(ISLAND_ZONES)],
        )
        conn.close()
    except Exception:
        return empty
    if df.empty:
        return empty
    df["ts"] = pd.to_datetime(df["ts"])
    return df


def _load_generation() -> pd.DataFrame:
    """Local generation for island zones, rolled up to (zone, ts, oil_mw, renewable_mw)."""
    empty = pd.DataFrame(columns=["zone", "ts", "oil_mw", "renewable_mw", "local_gen_mw"])
    try:
        conn = get_read_conn()
        df = _query(
            conn,
            """
            SELECT zone, ts, tech, mw
            FROM power_generation_actual
            WHERE zone = ANY(%s)
            ORDER BY zone, ts
            """,
            [list(ISLAND_ZONES)],
        )
        conn.close()
    except Exception:
        return empty
    if df.empty:
        return empty
    df["ts"] = pd.to_datetime(df["ts"])
    return categorise_generation(df)


def categorise_generation(df: pd.DataFrame) -> pd.DataFrame:
    """Long (zone, ts, tech, mw) -> wide (zone, ts, oil_mw, renewable_mw, local_gen_mw).

    `local_gen_mw` sums every tech present, not just the two categories, so an unmapped
    tech appearing in the source still shows up in the total rather than vanishing.
    """
    if df.empty:
        return pd.DataFrame(columns=["zone", "ts", "oil_mw", "renewable_mw", "local_gen_mw"])
    wide = df.pivot_table(index=["zone", "ts"], columns="tech", values="mw", aggfunc="sum")
    out = pd.DataFrame(index=wide.index)
    out["oil_mw"] = wide.reindex(columns=list(_OIL_TECHS)).fillna(0).sum(axis=1)
    out["renewable_mw"] = wide.reindex(columns=list(_RENEWABLE_TECHS)).fillna(0).sum(axis=1)
    out["local_gen_mw"] = wide.fillna(0).sum(axis=1)
    return out.reset_index()


def compute_import_share(net_import_mw: pd.Series, local_gen_mw: pd.Series) -> pd.Series:
    """Cable flow as a percentage of total supply (local generation + net import).

    Left signed on purpose: when the island exports, the share is negative, which is the
    honest reading. Returns NaN where total supply is zero or negative rather than
    dividing by it.
    """
    total = local_gen_mw + net_import_mw
    return (net_import_mw / total.where(total > 0) * 100).round(1)


def _build_daily(imports: pd.DataFrame, generation: pd.DataFrame) -> pd.DataFrame:
    if imports.empty and generation.empty:
        return pd.DataFrame(columns=_DAILY_COLS)

    frames = []
    for zone in sorted(
        set(imports.get("zone", pd.Series(dtype=str)))
        | set(generation.get("zone", pd.Series(dtype=str)))
    ):
        imp = imports[imports["zone"] == zone] if not imports.empty else imports
        gen = generation[generation["zone"] == zone] if not generation.empty else generation

        imp_daily = (
            imp.set_index("ts")["net_import_mw"]
            .resample("D")
            .agg(["mean", "min", "max"])
            .rename(
                columns={"mean": "net_import_mw", "min": "min_import_mw", "max": "max_import_mw"}
            )
            if not imp.empty
            else pd.DataFrame(columns=["net_import_mw", "min_import_mw", "max_import_mw"])
        )
        gen_daily = (
            gen.set_index("ts")[["oil_mw", "renewable_mw", "local_gen_mw"]].resample("D").mean()
            if not gen.empty
            else pd.DataFrame(columns=["oil_mw", "renewable_mw", "local_gen_mw"])
        )

        merged = imp_daily.join(gen_daily, how="outer")
        if merged.empty:
            continue

        # Reindex across the full calendar so the 2025 source gap is materialised as NULL
        # rows. A chart that skips missing dates would otherwise join 2024-12-31 straight
        # to 2026-07-20 and present 19 absent months as a flat line.
        merged = merged.reindex(pd.date_range(merged.index.min(), merged.index.max(), freq="D"))

        merged["zone"] = zone
        merged["total_supply_mw"] = merged["local_gen_mw"] + merged["net_import_mw"]
        merged["import_share_pct"] = compute_import_share(
            merged["net_import_mw"], merged["local_gen_mw"]
        )
        merged["renewable_share_pct"] = (
            merged["renewable_mw"]
            / merged["total_supply_mw"].where(merged["total_supply_mw"] > 0)
            * 100
        ).round(1)
        merged = merged.reset_index(names="gen_date")
        frames.append(merged)

    if not frames:
        return pd.DataFrame(columns=_DAILY_COLS)

    out = pd.concat(frames, ignore_index=True)
    out["gen_date"] = pd.to_datetime(out["gen_date"]).dt.strftime("%Y-%m-%d")
    for col in (
        "net_import_mw",
        "min_import_mw",
        "max_import_mw",
        "local_gen_mw",
        "oil_mw",
        "renewable_mw",
        "total_supply_mw",
    ):
        out[col] = out[col].round(1)
    return out[_DAILY_COLS].sort_values(["zone", "gen_date"]).reset_index(drop=True)


def _build_hourly_recent(imports: pd.DataFrame, generation: pd.DataFrame) -> pd.DataFrame:
    if imports.empty:
        return pd.DataFrame(columns=_HOURLY_COLS)
    cutoff = imports["ts"].max() - pd.Timedelta(days=_HOURLY_RECENT_DAYS)
    imp = imports[imports["ts"] >= cutoff]
    if imp.empty:
        return pd.DataFrame(columns=_HOURLY_COLS)

    merged = imp.merge(generation, on=["zone", "ts"], how="left") if not generation.empty else imp
    for col in ("oil_mw", "renewable_mw", "local_gen_mw"):
        if col not in merged:
            merged[col] = pd.NA
    merged["total_supply_mw"] = merged["local_gen_mw"] + merged["net_import_mw"]
    merged["ts"] = merged["ts"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    for col in ("net_import_mw", "oil_mw", "renewable_mw", "total_supply_mw"):
        merged[col] = pd.to_numeric(merged[col], errors="coerce").round(1)
    return merged[_HOURLY_COLS].sort_values(["zone", "ts"]).reset_index(drop=True)


def _build_hourly_profile(imports: pd.DataFrame, generation: pd.DataFrame) -> pd.DataFrame:
    """Mean intraday shape over the trailing `_PROFILE_DAYS` **calendar** days.

    Anchored on the last observation rather than today: with a 19-month gap in the source,
    anchoring on today would window onto empty space and return nothing.

    _PROFILE_DAYS is a ceiling, not a promise. Right now the trailing year contains only
    the 14 days of the realtime window, because everything before it falls in the gap, so
    the profile is built on 14 days. It widens on its own as data accumulates. The actual
    number of distinct days behind each average is returned as `n_days` so the UI can
    state the window instead of implying a year of evidence.
    """
    if imports.empty:
        return pd.DataFrame(columns=_PROFILE_COLS)
    cutoff = imports["ts"].max() - pd.Timedelta(days=_PROFILE_DAYS)
    imp = imports[imports["ts"] >= cutoff]
    if imp.empty:
        return pd.DataFrame(columns=_PROFILE_COLS)

    merged = imp.merge(generation, on=["zone", "ts"], how="left") if not generation.empty else imp
    for col in ("oil_mw", "renewable_mw", "local_gen_mw"):
        if col not in merged:
            merged[col] = float("nan")
    merged["hour"] = merged["ts"].dt.hour
    merged["day"] = merged["ts"].dt.normalize()

    grouped = (
        merged.groupby(["zone", "hour"])[
            ["net_import_mw", "oil_mw", "renewable_mw", "local_gen_mw"]
        ]
        .mean()
        .reset_index()
    )
    n_days = merged.groupby("zone")["day"].nunique()
    grouped["n_days"] = grouped["zone"].map(n_days).astype(int)
    grouped["import_share_pct"] = compute_import_share(
        grouped["net_import_mw"], grouped["local_gen_mw"]
    )
    for col in ("net_import_mw", "oil_mw", "renewable_mw"):
        grouped[col] = grouped[col].round(1)
    return grouped[_PROFILE_COLS].sort_values(["zone", "hour"]).reset_index(drop=True)


def _build_latest(daily: pd.DataFrame) -> pd.DataFrame:
    """One headline row per zone, taken from the most recent day that actually has data."""
    if daily.empty:
        return pd.DataFrame(columns=_LATEST_COLS)

    rows = []
    for zone, zdf in daily.groupby("zone"):
        observed = zdf.dropna(subset=["net_import_mw"])
        if observed.empty:
            continue
        last = observed.iloc[-1]
        rows.append(
            {
                "zone": zone,
                "gen_date": last["gen_date"],
                "net_import_mw": last["net_import_mw"],
                "local_gen_mw": last["local_gen_mw"],
                "oil_mw": last["oil_mw"],
                "renewable_mw": last["renewable_mw"],
                "total_supply_mw": last["total_supply_mw"],
                "import_share_pct": last["import_share_pct"],
                "renewable_share_pct": last["renewable_share_pct"],
                "max_import_mw": observed["max_import_mw"].max(),
                "peak_supply_mw": observed["total_supply_mw"].max(),
                "data_start": observed["gen_date"].min(),
                "data_end": observed["gen_date"].max(),
                # Days inside the observed span with no data at all - the source gap, surfaced
                # as a number so the UI can state it rather than leave a silent hole.
                "gap_days": int(zdf["net_import_mw"].isna().sum()),
            }
        )

    if not rows:
        return pd.DataFrame(columns=_LATEST_COLS)
    return pd.DataFrame(rows)[_LATEST_COLS]
