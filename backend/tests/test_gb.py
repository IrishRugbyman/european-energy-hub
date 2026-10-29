"""GB reshaping into the ENTSO-E long formats (analytics.gb)."""

import pandas as pd
import pytest
from analytics.gb import (
    GB_ZONE,
    cap_at_day,
    complete_days_only,
    daily_from_long,
    mix_to_long,
    prices_to_hourly,
)
from analytics.generation import _pivot_and_merge_wind


def test_prices_to_hourly_averages_the_two_half_hours():
    df = pd.DataFrame(
        {
            "ts": pd.to_datetime(["2026-10-28 10:00", "2026-10-28 10:30", "2026-10-28 11:00"]),
            "price_eur_mwh": [80.0, 100.0, 50.0],
        }
    )
    out = prices_to_hourly(df)
    assert list(out.columns) == ["ts", "zone", "price_eur_mwh"]
    assert out["zone"].eq(GB_ZONE).all()
    assert out["price_eur_mwh"].tolist() == pytest.approx([90.0, 50.0])
    assert out["ts"].tolist() == list(pd.to_datetime(["2026-10-28 10:00", "2026-10-28 11:00"]))


def test_prices_to_hourly_drops_hour_without_eur_price_instead_of_filling():
    df = pd.DataFrame(
        {
            "ts": pd.to_datetime(["2026-10-28 10:00", "2026-10-28 10:30", "2026-10-28 11:00"]),
            "price_eur_mwh": [80.0, float("nan"), float("nan")],
        }
    )
    out = prices_to_hourly(df)
    assert out["price_eur_mwh"].tolist() == [80.0]


def test_prices_to_hourly_empty_input_keeps_schema():
    assert list(prices_to_hourly(pd.DataFrame()).columns) == ["ts", "zone", "price_eur_mwh"]


def _mix(**cols):
    idx = pd.to_datetime(["2026-10-28 10:00", "2026-10-28 10:30"])
    return pd.DataFrame(cols, index=idx)


def test_mix_to_long_sums_both_wind_series_and_drops_imports_storage():
    mix = _mix(
        wind_mw=[4000.0, 4100.0],
        wind_embedded_mw=[1000.0, 900.0],
        imports_mw=[1500.0, 1500.0],
        storage_mw=[20.0, 30.0],
    )
    long = mix_to_long(mix)
    assert set(long["tech"]) == {"wind_onshore"}
    assert long["mw"].tolist() == [5000.0, 5000.0]


def test_mix_to_long_leaves_null_out_rather_than_zero():
    long = mix_to_long(_mix(gas_mw=[15000.0, None], coal_mw=[0.0, 0.0]))
    gas = long[long["tech"] == "gas"]
    assert len(gas) == 1
    assert len(long[long["tech"] == "coal"]) == 2  # a real 0 MW reading is kept


def test_gb_rows_survive_the_shared_pivot_with_wind_and_total():
    long = mix_to_long(
        _mix(gas_mw=[15000.0, 15000.0], wind_mw=[4000.0, 4000.0], solar_mw=[0.0, 0.0])
    )
    wide = _pivot_and_merge_wind(long, "ts")
    row = wide.iloc[0]
    assert row["wind"] == 4000.0
    assert row["total_mw"] == 19000.0
    assert row["renewable_pct"] == pytest.approx(round(4000 / 19000 * 100, 1))


def test_daily_from_long_means_per_utc_day():
    long = pd.DataFrame(
        {
            "zone": GB_ZONE,
            "ts": pd.to_datetime(["2026-10-28 23:00", "2026-10-28 23:30", "2026-10-29 00:00"]),
            "tech": "gas",
            "mw": [100.0, 200.0, 999.0],
        }
    )
    out = daily_from_long(long)
    assert out["mw"].tolist() == [150.0, 999.0]
    assert out["gen_date"].dt.date.astype(str).tolist() == ["2026-10-28", "2026-10-29"]


def test_complete_days_only_drops_the_utc_day_in_progress():
    rows = pd.DataFrame(
        {"ts": pd.to_datetime(["2026-10-28 23:00", "2026-10-29 00:00", "2026-10-29 01:00"])}
    )
    out = complete_days_only(rows, pd.Timestamp("2026-10-29 02:40", tz="UTC"))
    assert out["ts"].tolist() == [pd.Timestamp("2026-10-28 23:00")]


def test_complete_days_only_converts_an_aware_now_to_utc_first():
    rows = pd.DataFrame({"ts": pd.to_datetime(["2026-10-27 23:30", "2026-10-28 23:30"])})
    # 00:30 in Berlin on the 29th is 22:30 UTC on the 28th, so the 28th is in progress
    now = pd.Timestamp("2026-10-29 00:30", tz="Europe/Berlin")
    assert complete_days_only(rows, now)["ts"].tolist() == [pd.Timestamp("2026-10-27 23:30")]


def test_cap_at_day_keeps_through_the_end_of_the_last_entsoe_day():
    rows = pd.DataFrame(
        {"ts": pd.to_datetime(["2026-10-27 22:00", "2026-10-27 23:00", "2026-10-28 00:00"])}
    )
    out = cap_at_day(rows, pd.Timestamp("2026-10-27 23:00"))
    assert out["ts"].tolist() == list(pd.to_datetime(["2026-10-27 22:00", "2026-10-27 23:00"]))


def test_cap_at_day_without_entsoe_rows_leaves_gb_uncapped():
    rows = pd.DataFrame({"ts": pd.to_datetime(["2026-10-28 00:00"])})
    assert len(cap_at_day(rows, None)) == 1
