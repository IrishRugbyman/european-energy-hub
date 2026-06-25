"""EU nuclear generation tracker helpers.

Reads from energy_hub.duckdb via the app.db module (query/scalar). Intended to be
called from main.py at request time.
"""

from __future__ import annotations

import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app import db as DbModule

# Approximate installed nuclear capacity in MW (ENTSO-E 2024 figures)
INSTALLED_MW: dict[str, int] = {
    "FR": 63130,
    "ES": 7398,
    "BE": 5930,
    "FI": 4393,
    "CH": 2990,
    "SE": 6891,
    "CZ": 3930,
    "SK": 2315,
    "BG": 2006,
    "HU": 1889,
    "RO": 1300,
    "NL": 482,
    "DE-LU": 8113,
}


def _float(v) -> float | None:
    import math
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def nuclear_country_latest(db: "DbModule") -> list[dict[str, Any]]:
    """Latest nuclear generation per country with 5yr seasonal context at today's DOY."""
    today = datetime.date.today()
    doy = today.timetuple().tm_yday
    band_years = list(range(today.year - 5, today.year))

    df = db.query(
        """
        WITH latest AS (
            SELECT zone, nuclear AS nuclear_mw, gen_date
            FROM generation_daily
            WHERE (zone, gen_date) IN (
                SELECT zone, MAX(gen_date)
                FROM generation_daily
                WHERE zone IN ('FR','BE','CH','FI','ES','CZ','SK','RO','BG','HU',
                               'NL','DE-LU','SE-3')
                GROUP BY zone
            )
        ),
        seasonal AS (
            SELECT zone,
                   AVG(nuclear) AS avg5, MIN(nuclear) AS min5, MAX(nuclear) AS max5
            FROM generation_daily
            WHERE zone IN ('FR','BE','CH','FI','ES','CZ','SK','RO','BG','HU',
                           'NL','DE-LU','SE-3')
              AND YEAR(gen_date) = ANY(?)
              AND DAYOFYEAR(gen_date) = ?
            GROUP BY zone
        )
        SELECT
            CASE WHEN l.zone = 'SE-3' THEN 'SE' ELSE l.zone END AS display_zone,
            l.gen_date::TEXT AS gen_date,
            l.nuclear_mw,
            s.avg5, s.min5, s.max5
        FROM latest l
        LEFT JOIN seasonal s ON l.zone = s.zone
        ORDER BY l.nuclear_mw DESC
        """,
        [band_years, doy],
    )

    if df is None or df.empty:
        return []

    result = []
    for row in df.itertuples(index=False):
        nuclear_mw = _float(row.nuclear_mw) or 0.0
        avg5_mw = _float(row.avg5)
        min5_mw = _float(row.min5)
        max5_mw = _float(row.max5)
        zone = row.display_zone
        installed = INSTALLED_MW.get(zone)
        util_pct = round(nuclear_mw / installed * 100, 1) if installed and installed > 0 else None
        vs_avg5 = (
            round((nuclear_mw - avg5_mw) / avg5_mw * 100, 1)
            if avg5_mw and avg5_mw > 0
            else None
        )
        result.append({
            "zone": zone,
            "gen_date": str(row.gen_date),
            "nuclear_mw": round(nuclear_mw, 0),
            "avg5_mw": round(avg5_mw, 0) if avg5_mw is not None else None,
            "min5_mw": round(min5_mw, 0) if min5_mw is not None else None,
            "max5_mw": round(max5_mw, 0) if max5_mw is not None else None,
            "vs_avg5_pct": vs_avg5,
            "util_pct": util_pct,
            "installed_mw": installed,
        })
    result.sort(key=lambda x: -(x["nuclear_mw"] or 0))
    return result


def nuclear_fr_trend(db: "DbModule") -> list[dict[str, Any]]:
    """FR nuclear MW + 5yr seasonal avg + FR-DE price spread, last 365 days."""
    band_years = list(range(datetime.date.today().year - 5, datetime.date.today().year))

    df = db.query(
        """
        WITH seasonal AS (
            SELECT DAYOFYEAR(gen_date) AS doy, AVG(nuclear) AS avg5_nuc
            FROM generation_daily
            WHERE zone = 'FR'
              AND YEAR(gen_date) = ANY(?)
            GROUP BY doy
        )
        SELECT
            g.gen_date::TEXT AS gen_date,
            g.nuclear AS nuclear_mw,
            s.avg5_nuc AS avg5_nuclear_mw,
            p.base_eur - p2.base_eur AS fr_de_spread
        FROM generation_daily g
        JOIN power_daily p  ON g.gen_date = p.price_date  AND p.zone  = 'FR'
        JOIN power_daily p2 ON g.gen_date = p2.price_date AND p2.zone = 'DE-LU'
        LEFT JOIN seasonal s ON DAYOFYEAR(g.gen_date) = s.doy
        WHERE g.zone = 'FR'
          AND g.gen_date >= CURRENT_DATE - INTERVAL '365 days'
        ORDER BY g.gen_date
        """,
        [band_years],
    )

    if df is None or df.empty:
        return []

    return [
        {
            "gen_date": str(row.gen_date),
            "nuclear_mw": round(_float(row.nuclear_mw) or 0.0, 0),
            "avg5_nuclear_mw": round(v, 0) if (v := _float(row.avg5_nuclear_mw)) is not None else None,
            "fr_de_spread": round(s, 2) if (s := _float(row.fr_de_spread)) is not None else None,
        }
        for row in df.itertuples(index=False)
    ]


def nuclear_fr_scatter(db: "DbModule") -> list[dict[str, Any]]:
    """FR nuclear MW vs FR-DE spread, 730-day scatter dataset."""
    df = db.query(
        """
        SELECT
            g.gen_date::TEXT AS gen_date,
            g.nuclear AS nuclear_mw,
            p.base_eur - p2.base_eur AS fr_de_spread
        FROM generation_daily g
        JOIN power_daily p  ON g.gen_date = p.price_date  AND p.zone  = 'FR'
        JOIN power_daily p2 ON g.gen_date = p2.price_date AND p2.zone = 'DE-LU'
        WHERE g.zone = 'FR'
          AND g.gen_date >= CURRENT_DATE - INTERVAL '730 days'
        ORDER BY g.gen_date
        """
    )

    if df is None or df.empty:
        return []

    return [
        {
            "gen_date": str(row.gen_date),
            "nuclear_mw": round(_float(row.nuclear_mw) or 0.0, 0),
            "fr_de_spread": round(s, 2) if (s := _float(row.fr_de_spread)) is not None else None,
        }
        for row in df.itertuples(index=False)
    ]
