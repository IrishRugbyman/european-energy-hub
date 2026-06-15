"""Cross-zone DA price divergence analytics.

Computes daily base price differences across canonical ENTSO-E border pairs
from the already-computed power_daily DataFrame.

Output tables:
  divergence_latest  - one row per border pair (most recent date)
  divergence_30d     - last 30 days per border pair (sparkline source)
"""

from __future__ import annotations

import pandas as pd

# Same pairs as market-data/config.py ENTSO_E_BORDERS, restricted to the 7
# zones that have power_daily data (the core CWE + Alpine bloc).
BORDER_PAIRS: list[tuple[str, str]] = [
    ("FR", "DE-LU"),
    ("FR", "CH"),
    ("DE-LU", "CH"),
    ("FR", "BE"),
    ("FR", "IT-NORD"),
    ("DE-LU", "NL"),
    ("DE-LU", "BE"),
    ("DE-LU", "AT"),
    ("BE", "NL"),
    ("CH", "AT"),
    ("CH", "IT-NORD"),
    ("AT", "IT-NORD"),
]

_EMPTY_COLS = ["from_zone", "to_zone", "price_date", "from_price", "to_price", "diff_eur_mwh"]


def build_divergence_tables(power_daily: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Return divergence_latest and divergence_30d DataFrames.

    Args:
        power_daily: output of analytics/power.py build_power_tables(), columns
                     [zone, price_date, base_eur, ...]. price_date is Python date.
    """
    empty = pd.DataFrame(columns=_EMPTY_COLS)
    if power_daily.empty or "base_eur" not in power_daily.columns:
        return {"divergence_latest": empty, "divergence_30d": empty}

    # Pivot to date x zone
    pivot = power_daily.pivot_table(index="price_date", columns="zone", values="base_eur")

    rows: list[pd.DataFrame] = []
    for a, b in BORDER_PAIRS:
        if a not in pivot.columns or b not in pivot.columns:
            continue
        pair = pivot[[a, b]].dropna().reset_index()
        pair.columns = ["price_date", "from_price", "to_price"]
        pair["from_zone"] = a
        pair["to_zone"] = b
        pair["diff_eur_mwh"] = (pair["from_price"] - pair["to_price"]).round(2)
        rows.append(pair[_EMPTY_COLS])

    if not rows:
        return {"divergence_latest": empty, "divergence_30d": empty}

    all_div = pd.concat(rows, ignore_index=True)
    all_div["price_date"] = pd.to_datetime(all_div["price_date"]).dt.date

    # 30-day window
    max_date = max(all_div["price_date"])
    cutoff = (pd.Timestamp(max_date) - pd.Timedelta(days=30)).date()
    div_30d = all_div[all_div["price_date"] >= cutoff].copy()

    # Latest snapshot per pair
    idx = all_div.groupby(["from_zone", "to_zone"])["price_date"].idxmax()
    div_latest = all_div.loc[idx].reset_index(drop=True)

    return {"divergence_latest": div_latest, "divergence_30d": div_30d}
