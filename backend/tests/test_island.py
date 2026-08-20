"""Unit tests for the island (FR-COR) analytics.

Three behaviours here are load-bearing and all fail silently if broken:

  - the fuel rollup must total *every* tech, not just the two named categories, or an
    unmapped tech would vanish from `local_gen_mw` and inflate the cable's apparent share;
  - `compute_import_share` must keep negative values (the island does export) and must not
    divide by a zero or negative denominator;
  - `_build_daily` must reindex across the 19-month EDF source gap so those days exist as
    NULL rows. Without them a chart joins 2024-12-31 to 2026-07-20 with a straight line
    and presents absence as measurement.
"""

from __future__ import annotations

import pandas as pd
import pytest
from analytics.island import (
    _build_daily,
    _build_hourly_profile,
    _build_latest,
    categorise_generation,
    compute_import_share,
)


def _gen_long(rows: list[tuple[str, str, float]], zone: str = "FR-COR") -> pd.DataFrame:
    """Build a long (zone, ts, tech, mw) frame from (ts, tech, mw) tuples."""
    return pd.DataFrame(
        [{"zone": zone, "ts": pd.Timestamp(ts), "tech": tech, "mw": mw} for ts, tech, mw in rows]
    )


def _imports(rows: list[tuple[str, float]], zone: str = "FR-COR") -> pd.DataFrame:
    return pd.DataFrame(
        [{"zone": zone, "ts": pd.Timestamp(ts), "net_import_mw": mw} for ts, mw in rows]
    )


class TestCategoriseGeneration:
    def test_oil_category_absorbs_every_thermal_tech(self):
        df = _gen_long(
            [("2024-01-01", "oil", 100.0), ("2024-01-01", "gas", 20.0), ("2024-01-01", "coal", 5.0)]
        )
        out = categorise_generation(df)
        assert out.loc[0, "oil_mw"] == pytest.approx(125.0)

    def test_renewable_category_sums_all_renewable_techs(self):
        df = _gen_long(
            [
                ("2024-01-01", "solar", 50.0),
                ("2024-01-01", "hydro", 30.0),
                ("2024-01-01", "wind_onshore", 5.0),
                ("2024-01-01", "biomass", 1.0),
            ]
        )
        out = categorise_generation(df)
        assert out.loc[0, "renewable_mw"] == pytest.approx(86.0)

    def test_local_gen_totals_every_tech_including_unmapped_ones(self):
        """An unrecognised tech must still reach the total, or cable share is overstated."""
        df = _gen_long([("2024-01-01", "oil", 100.0), ("2024-01-01", "something_new", 40.0)])
        out = categorise_generation(df)
        assert out.loc[0, "oil_mw"] == pytest.approx(100.0)
        assert out.loc[0, "renewable_mw"] == pytest.approx(0.0)
        assert out.loc[0, "local_gen_mw"] == pytest.approx(140.0)

    def test_missing_categories_are_zero_not_nan(self):
        df = _gen_long([("2024-01-01", "oil", 100.0)])
        out = categorise_generation(df)
        assert out.loc[0, "renewable_mw"] == 0.0

    def test_empty_input_returns_empty_frame_with_columns(self):
        out = categorise_generation(pd.DataFrame())
        assert out.empty
        assert list(out.columns) == ["zone", "ts", "oil_mw", "renewable_mw", "local_gen_mw"]


class TestComputeImportShare:
    def test_share_of_total_supply(self):
        share = compute_import_share(pd.Series([25.0]), pd.Series([75.0]))
        assert share.iloc[0] == pytest.approx(25.0)

    def test_negative_import_yields_negative_share(self):
        """The island exports sometimes; flipping the sign would hide that."""
        share = compute_import_share(pd.Series([-20.0]), pd.Series([120.0]))
        assert share.iloc[0] < 0

    def test_zero_total_supply_is_nan_not_a_division_error(self):
        share = compute_import_share(pd.Series([0.0]), pd.Series([0.0]))
        assert pd.isna(share.iloc[0])

    def test_negative_total_supply_is_nan(self):
        share = compute_import_share(pd.Series([-10.0]), pd.Series([5.0]))
        assert pd.isna(share.iloc[0])

    def test_all_supply_from_cable_is_one_hundred_percent(self):
        share = compute_import_share(pd.Series([50.0]), pd.Series([0.0]))
        assert share.iloc[0] == pytest.approx(100.0)


class TestBuildDaily:
    def test_gap_days_are_present_as_null_rows(self):
        """The whole reason _build_daily reindexes: absence must be visible."""
        imports = _imports([("2024-01-01 00:00", 100.0), ("2024-01-05 00:00", 120.0)])
        gen = categorise_generation(
            _gen_long([("2024-01-01 00:00", "oil", 200.0), ("2024-01-05 00:00", "oil", 210.0)])
        )
        daily = _build_daily(imports, gen)

        assert list(daily["gen_date"]) == [
            "2024-01-01",
            "2024-01-02",
            "2024-01-03",
            "2024-01-04",
            "2024-01-05",
        ]
        assert daily["net_import_mw"].isna().sum() == 3
        assert daily.loc[0, "net_import_mw"] == pytest.approx(100.0)
        assert daily.loc[4, "net_import_mw"] == pytest.approx(120.0)

    def test_daily_aggregates_mean_min_max_within_a_day(self):
        imports = _imports(
            [
                ("2024-01-01 00:00", 100.0),
                ("2024-01-01 12:00", 50.0),
                ("2024-01-01 23:00", 150.0),
            ]
        )
        daily = _build_daily(imports, pd.DataFrame())
        assert daily.loc[0, "net_import_mw"] == pytest.approx(100.0)
        assert daily.loc[0, "min_import_mw"] == pytest.approx(50.0)
        assert daily.loc[0, "max_import_mw"] == pytest.approx(150.0)

    def test_import_share_uses_daily_means(self):
        imports = _imports([("2024-01-01 00:00", 25.0)])
        gen = categorise_generation(_gen_long([("2024-01-01 00:00", "oil", 75.0)]))
        daily = _build_daily(imports, gen)
        assert daily.loc[0, "import_share_pct"] == pytest.approx(25.0)

    def test_empty_inputs_return_empty_frame(self):
        assert _build_daily(pd.DataFrame(), pd.DataFrame()).empty


class TestBuildLatest:
    def test_latest_skips_trailing_null_gap_rows(self):
        """The headline must come from a day with data, not the last calendar row."""
        daily = pd.DataFrame(
            {
                "zone": ["FR-COR"] * 3,
                "gen_date": ["2024-01-01", "2024-01-02", "2024-01-03"],
                "net_import_mw": [100.0, 120.0, None],
                "min_import_mw": [90.0, 110.0, None],
                "max_import_mw": [110.0, 130.0, None],
                "local_gen_mw": [200.0, 210.0, None],
                "oil_mw": [150.0, 160.0, None],
                "renewable_mw": [50.0, 50.0, None],
                "total_supply_mw": [300.0, 330.0, None],
                "import_share_pct": [33.3, 36.4, None],
                "renewable_share_pct": [16.7, 15.2, None],
            }
        )
        latest = _build_latest(daily)
        assert latest.loc[0, "gen_date"] == "2024-01-02"
        assert latest.loc[0, "net_import_mw"] == pytest.approx(120.0)

    def test_gap_days_counts_the_null_rows(self):
        daily = pd.DataFrame(
            {
                "zone": ["FR-COR"] * 4,
                "gen_date": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"],
                "net_import_mw": [100.0, None, None, 120.0],
                "min_import_mw": [90.0, None, None, 110.0],
                "max_import_mw": [110.0, None, None, 130.0],
                "local_gen_mw": [200.0, None, None, 210.0],
                "oil_mw": [150.0, None, None, 160.0],
                "renewable_mw": [50.0, None, None, 50.0],
                "total_supply_mw": [300.0, None, None, 330.0],
                "import_share_pct": [33.3, None, None, 36.4],
                "renewable_share_pct": [16.7, None, None, 15.2],
            }
        )
        latest = _build_latest(daily)
        assert latest.loc[0, "gap_days"] == 2
        assert latest.loc[0, "data_start"] == "2024-01-01"
        assert latest.loc[0, "data_end"] == "2024-01-04"

    def test_peak_is_taken_across_the_whole_history_not_the_last_day(self):
        daily = pd.DataFrame(
            {
                "zone": ["FR-COR"] * 2,
                "gen_date": ["2024-01-01", "2024-01-02"],
                "net_import_mw": [100.0, 50.0],
                "min_import_mw": [90.0, 40.0],
                "max_import_mw": [155.0, 60.0],
                "local_gen_mw": [200.0, 210.0],
                "oil_mw": [150.0, 160.0],
                "renewable_mw": [50.0, 50.0],
                "total_supply_mw": [300.0, 260.0],
                "import_share_pct": [33.3, 19.2],
                "renewable_share_pct": [16.7, 19.2],
            }
        )
        latest = _build_latest(daily)
        assert latest.loc[0, "max_import_mw"] == pytest.approx(155.0)
        assert latest.loc[0, "peak_supply_mw"] == pytest.approx(300.0)

    def test_all_null_history_yields_no_row_rather_than_a_nan_row(self):
        daily = pd.DataFrame(
            {
                "zone": ["FR-COR"],
                "gen_date": ["2025-06-01"],
                "net_import_mw": [None],
                "min_import_mw": [None],
                "max_import_mw": [None],
                "local_gen_mw": [None],
                "oil_mw": [None],
                "renewable_mw": [None],
                "total_supply_mw": [None],
                "import_share_pct": [None],
                "renewable_share_pct": [None],
            }
        )
        assert _build_latest(daily).empty

    def test_empty_daily_returns_empty(self):
        assert _build_latest(pd.DataFrame()).empty


class TestBuildHourlyProfile:
    def test_reports_the_actual_number_of_days_behind_the_average(self):
        """n_days must reflect reality: the 365-day window is a ceiling, not a promise."""
        imports = _imports(
            [
                ("2024-01-01 06:00", 100.0),
                ("2024-01-02 06:00", 120.0),
                ("2024-01-03 06:00", 140.0),
            ]
        )
        profile = _build_hourly_profile(imports, pd.DataFrame())
        assert profile["n_days"].unique().tolist() == [3]
        assert profile.loc[profile["hour"] == 6, "net_import_mw"].iloc[0] == pytest.approx(120.0)

    def test_groups_by_hour_of_day(self):
        imports = _imports(
            [
                ("2024-01-01 06:00", 100.0),
                ("2024-01-01 18:00", 200.0),
                ("2024-01-02 06:00", 140.0),
            ]
        )
        profile = _build_hourly_profile(imports, pd.DataFrame())
        by_hour = dict(zip(profile["hour"], profile["net_import_mw"], strict=True))
        assert by_hour[6] == pytest.approx(120.0)
        assert by_hour[18] == pytest.approx(200.0)

    def test_empty_imports_return_empty_frame(self):
        assert _build_hourly_profile(pd.DataFrame(), pd.DataFrame()).empty
