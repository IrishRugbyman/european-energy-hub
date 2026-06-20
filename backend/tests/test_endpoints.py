"""Endpoint tests against the seeded DuckDB fixture."""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["refreshed_at_gas"] is not None


def test_meta(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert set(data["gas_countries"]) == {"DE", "EU", "FR"}


def test_gas_map(client):
    r = client.get("/api/gas/map")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) == 3
    countries = {row["country"] for row in data["rows"]}
    assert "DE" in countries and "EU" in countries and "FR" in countries
    for row in data["rows"]:
        assert row["full_pct"] is not None
        assert 0 <= row["full_pct"] <= 100


def test_gas_country_de(client):
    r = client.get("/api/gas/country/DE")
    assert r.status_code == 200
    data = r.json()
    assert data["country"] == "DE"
    assert data["latest"]["full_pct"] == 72.5
    assert len(data["seasonal_band"]) > 0
    assert len(data["current_year"]) > 0 or len(data["prior_year"]) > 0


def test_gas_country_eu(client):
    r = client.get("/api/gas/country/EU")
    assert r.status_code == 200
    data = r.json()
    assert data["country"] == "EU"


def test_gas_country_lowercase(client):
    r = client.get("/api/gas/country/de")
    assert r.status_code == 200
    assert r.json()["country"] == "DE"


def test_gas_country_unknown(client):
    r = client.get("/api/gas/country/XX")
    assert r.status_code == 404


def test_gas_country_pace(client):
    r = client.get("/api/gas/country/DE")
    assert r.status_code == 200
    data = r.json()
    pace = data.get("pace")
    assert pace is not None, "pace field missing from gas_country response"
    assert pace["country"] == "DE"
    assert pace["target_pct"] == 90.0
    assert pace["days_to_target"] > 0
    assert pace["current_rate_gwh_per_day"] is not None
    assert isinstance(pace["on_track"], bool)


def test_power_map(client):
    r = client.get("/api/power/map")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) == 2
    zones = {row["zone"] for row in data["rows"]}
    assert "DE-LU" in zones and "FR" in zones
    for row in data["rows"]:
        assert row["base_eur"] is not None
        assert row["base_eur"] > 0


def test_power_zone_delu(client):
    r = client.get("/api/power/zone/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert data["latest"]["base_eur"] == 80.0
    assert len(data["hourly_recent"]) > 0
    assert len(data["daily_history"]) > 0
    # Generation mix
    assert data["generation_mix"] is not None
    assert data["generation_mix"]["renewable_pct"] is not None
    assert data["generation_mix"]["wind"] == 12000.0


def test_power_zone_seasonality(client):
    r = client.get("/api/power/zone/DE-LU/seasonality")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert len(data["dow"]) == 7
    assert len(data["monthly"]) == 12
    dow_labels = [d["label"] for d in data["dow"]]
    assert "Mon" in dow_labels and "Sun" in dow_labels
    for d in data["dow"]:
        assert d["avg_eur"] is not None
    for m in data["monthly"]:
        assert m["avg_eur"] is not None
        assert m["avg_neg_hrs"] is not None


def test_power_zone_profile(client):
    r = client.get("/api/power/zone/DE-LU/profile")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert data["days"] == 90
    rows = data["rows"]
    assert len(rows) == 24
    hours = [r["hour"] for r in rows]
    assert hours == list(range(24))
    for row in rows:
        assert row["avg_eur"] is not None
        assert row["p25_eur"] is not None
        assert row["p75_eur"] is not None
        assert row["neg_pct"] is not None
        assert 0.0 <= row["neg_pct"] <= 100.0


def test_power_zone_unknown(client):
    r = client.get("/api/power/zone/XX-1")
    assert r.status_code == 404


def test_meta_includes_power(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert "DE-LU" in data["power_zones"]
    assert data["power_refreshed_at"] is not None


def test_spreads(client):
    r = client.get("/api/spreads")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) > 0
    row = data["rows"][0]
    assert "css" in row and "cds" in row and "fss" in row
    assert row["power_de"] is not None
    assert row["regime_threshold"] in ("gas", "coal")


def test_prices(client):
    r = client.get("/api/prices")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) > 0
    row = data["rows"][0]
    assert row["ttf_eur_mwh"] is not None
    assert row["eua_eur_t"] is not None
    assert "nbp_eur_mwh" in row


def test_prices_curve(client):
    r = client.get("/api/prices/curve")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) > 0
    row = data["rows"][0]
    assert "contract" in row
    assert "settlement" in row
    assert "tenor_type" in row
    # Contracts should be sorted by delivery (Q3-26 is first)
    assert data["rows"][0]["contract"] == "Q3-26"
    # No individual monthly contracts in response
    tenor_types = {r["tenor_type"] for r in data["rows"]}
    assert tenor_types.issubset({"Q1", "Q2", "Q3", "Q4", "WIN", "SUM", "CAL"})


def test_flows(client):
    r = client.get("/api/flows")
    assert r.status_code == 200
    data = r.json()
    assert data["price_date"] is not None
    assert len(data["rows"]) == 3
    zones = {(row["from_zone"], row["to_zone"]) for row in data["rows"]}
    assert ("DE-LU", "FR") in zones


def test_flows_date_filter(client):
    import datetime
    today = datetime.date.today().isoformat()
    r = client.get(f"/api/flows?date={today}")
    assert r.status_code == 200
    data = r.json()
    assert len(data["rows"]) == 3


def test_gas_flows_map(client):
    r = client.get("/api/gas/flows")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) == 2
    by_cc = {row["country"]: row for row in data["rows"]}
    assert "AT" in by_cc and "DE" in by_cc
    # AT is net importer
    assert by_cc["AT"]["net_gwh_d"] > 0
    assert by_cc["AT"]["entry_gwh_d"] == 120.0
    # DE is slight net exporter
    assert by_cc["DE"]["net_gwh_d"] < 0


def test_gas_flows_country(client):
    r = client.get("/api/gas/flows/AT")
    assert r.status_code == 200
    data = r.json()
    assert data["country"] == "AT"
    assert len(data["rows"]) == 60
    # Most recent row should have largest entry (seeded as 100 + 59*0.5 = 129.5)
    latest = max(data["rows"], key=lambda x: x["period_date"])
    assert latest["entry_gwh_d"] > 100


def test_gas_flows_country_not_found(client):
    r = client.get("/api/gas/flows/XX")
    assert r.status_code == 404


def test_gas_flows_country_case_insensitive(client):
    r = client.get("/api/gas/flows/at")
    assert r.status_code == 200
    assert r.json()["country"] == "AT"


def test_power_congestion(client):
    r = client.get("/api/power/congestion")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) == 2
    by_border = {(row["from_zone"], row["to_zone"]): row for row in data["rows"]}
    assert ("FR", "DE-LU") in by_border
    fr_de = by_border[("FR", "DE-LU")]
    assert fr_de["ntc_mw"] == 3000.0
    assert fr_de["utilization_pct"] == 92.0


def test_power_congestion_border(client):
    r = client.get("/api/power/congestion/border/FR/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert data["from_zone"] == "FR"
    assert data["to_zone"] == "DE-LU"
    assert len(data["rows"]) == 90
    # Most recent row should have highest scheduled (2000 + 89*5 = 2445)
    latest = max(data["rows"], key=lambda x: x["price_date"])
    assert latest["scheduled_mw"] > 2400


def test_power_congestion_border_not_found(client):
    r = client.get("/api/power/congestion/border/XX/YY")
    assert r.status_code == 404


def test_power_congestion_border_hyphen_normalization(client):
    # Underscores in zone names should be normalized to hyphens
    r = client.get("/api/power/congestion/border/fr/DE_LU")
    assert r.status_code == 200
    data = r.json()
    assert data["from_zone"] == "FR"
    assert data["to_zone"] == "DE-LU"


def test_gen_map_latest(client):
    r = client.get("/api/generation/map")
    assert r.status_code == 200
    data = r.json()
    assert len(data["zones"]) == 2
    assert data["min_date"] is not None
    assert data["max_date"] is not None


def test_gen_map_historical_date(client):
    import datetime
    # Use a date 30 days ago (within the seeded 2-year history)
    target = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
    r = client.get(f"/api/generation/map?date={target}")
    assert r.status_code == 200
    data = r.json()
    # Should have DE-LU data for that date
    zones = {z["zone"] for z in data["zones"]}
    assert "DE-LU" in zones
    # gen_date on each row should match the requested date
    for z in data["zones"]:
        assert z["gen_date"] == target


def test_gen_map_out_of_range_date(client):
    r = client.get("/api/generation/map?date=2000-01-01")
    assert r.status_code == 404


def test_gen_trends(client):
    r = client.get("/api/generation/trends")
    assert r.status_code == 200
    data = r.json()
    assert "zones" in data and "years" in data and "rows" in data
    assert isinstance(data["zones"], list)
    assert isinstance(data["years"], list)
    # Each row has zone, year, renewable_pct
    for row in data["rows"]:
        assert "zone" in row
        assert "year" in row
        if row["renewable_pct"] is not None:
            assert 0.0 <= row["renewable_pct"] <= 100.0


def test_imbalance_endpoint(client):
    r = client.get("/api/imbalance")
    assert r.status_code == 200
    data = r.json()
    # latest snapshot
    assert data["latest"] is not None
    assert data["latest"]["rebap_eur_mwh"] == 95.0
    assert data["latest"]["today_mean"] == 88.0
    # recent: 10 days of 15-min data
    assert len(data["recent"]) > 0
    assert "ts" in data["recent"][0]
    assert "rebap_eur_mwh" in data["recent"][0]
    # daily: 2 years of daily aggregates
    assert len(data["daily"]) > 0
    day0 = data["daily"][0]
    assert "price_date" in day0
    assert "mean_eur" in day0
    assert "min_eur" in day0
    assert "max_eur" in day0


def test_imbalance_structure(client):
    r = client.get("/api/imbalance")
    data = r.json()
    # daily min should be less than mean, mean less than max
    for d in data["daily"][:10]:
        if d["min_eur"] is not None and d["mean_eur"] is not None and d["max_eur"] is not None:
            assert d["min_eur"] <= d["mean_eur"] <= d["max_eur"]


def test_power_divergence(client):
    r = client.get("/api/power/divergence")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert "history" in data
    assert len(data["rows"]) >= 1
    row = data["rows"][0]
    assert "from_zone" in row
    assert "to_zone" in row
    assert "diff_eur_mwh" in row
    # rows should be sorted by abs(diff) descending
    diffs = [abs(r["diff_eur_mwh"]) for r in data["rows"] if r["diff_eur_mwh"] is not None]
    assert diffs == sorted(diffs, reverse=True)


def test_power_divergence_history(client):
    r = client.get("/api/power/divergence")
    data = r.json()
    # Should have history for FR->DE-LU (seeded 30 days)
    hist_keys = {(h["from_zone"], h["to_zone"]) for h in data["history"]}
    assert ("FR", "DE-LU") in hist_keys
    fr_delu = next(h for h in data["history"] if h["from_zone"] == "FR" and h["to_zone"] == "DE-LU")
    assert len(fr_delu["history"]) == 30
    pt = fr_delu["history"][0]
    assert "price_date" in pt
    assert "diff_eur_mwh" in pt


def test_imbalance_dispatch(client):
    r = client.get("/api/imbalance/dispatch")
    assert r.status_code == 200
    data = r.json()
    assert "hourly" in data
    assert "summary" in data
    assert len(data["hourly"]) == 30 * 24
    h0 = data["hourly"][0]
    assert "ts" in h0
    assert "rebap_price" in h0
    assert "charge_mw" in h0
    assert "discharge_mw" in h0
    assert "soc_mwh" in h0
    assert "cumulative_pnl_eur" in h0


def test_imbalance_dispatch_summary(client):
    r = client.get("/api/imbalance/dispatch")
    data = r.json()
    s = data["summary"]
    assert s is not None
    assert "total_pnl_eur" in s
    assert "n_charge_hours" in s
    assert "n_discharge_hours" in s
    assert "avg_spread_captured_eur" in s
    assert s["trailing_days"] == 30


def test_imbalance_profile(client):
    r = client.get("/api/imbalance/profile")
    assert r.status_code == 200
    data = r.json()
    assert data["days"] == 90
    assert len(data["rows"]) == 24
    hours = [row["hour"] for row in data["rows"]]
    assert hours == list(range(24))
    for row in data["rows"]:
        assert row["avg_eur"] is not None
        assert row["p25_eur"] is not None
        assert row["p75_eur"] is not None
        assert row["neg_pct"] is not None
        assert 0 <= row["neg_pct"] <= 100


def test_generation_eu_annual(client):
    r = client.get("/api/generation/eu/annual")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) >= 2
    for row in data["rows"]:
        assert "year" in row and row["year"] >= 2021
        assert "solar_mw" in row and row["solar_mw"] is not None
        assert "wind_mw" in row and row["wind_mw"] is not None
        assert "coal_mw" in row and row["coal_mw"] is not None
        assert "zones" in row and row["zones"] >= 1
    years = [row["year"] for row in data["rows"]]
    assert years == sorted(set(years))


def test_spreads_zones(client):
    r = client.get("/api/spreads/zones")
    assert r.status_code == 200
    data = r.json()
    assert "zones" in data and "rows" in data
    # All 6 zones present
    assert set(data["zones"]) == {"AT", "BE", "DE-LU", "FR", "IT-NORD", "NL"}
    assert len(data["rows"]) > 0
    row = data["rows"][0]
    assert "price_date" in row and "zone" in row
    assert "css" in row and "cds" in row and "fss" in row
    assert row["regime_threshold"] in ("gas", "coal")


def test_spreads_zones_per_zone_count(client):
    r = client.get("/api/spreads/zones")
    data = r.json()
    rows = data["rows"]
    by_zone: dict[str, int] = {}
    for row in rows:
        by_zone[row["zone"]] = by_zone.get(row["zone"], 0) + 1
    # Each zone should have the same number of rows
    counts = list(by_zone.values())
    assert len(counts) == 6
    # All zones have the same row count (1 row per calendar day)
    assert min(counts) == max(counts)


def test_gas_pace(client):
    r = client.get("/api/gas/pace")
    assert r.status_code == 200
    data = r.json()
    assert "eu" in data
    eu = data["eu"]
    assert eu["country"] == "EU"
    assert eu["target_pct"] == 90.0
    assert eu["target_date"] is not None
    assert eu["days_to_target"] > 0
    assert len(eu["history"]) > 0
    # Verify history has actual + projected sections
    actual = [h for h in eu["history"] if h["full_pct"] is not None]
    projected = [h for h in eu["history"] if h["projected"] is not None]
    assert len(actual) > 0
    assert len(projected) > 0


def test_gas_pace_countries(client):
    r = client.get("/api/gas/pace/countries")
    assert r.status_code == 200
    data = r.json()
    assert "target_date" in data
    assert "rows" in data
    rows = data["rows"]
    # Should include DE and FR, but NOT EU
    countries = {r["country"] for r in rows}
    assert "DE" in countries
    assert "FR" in countries
    assert "EU" not in countries
    # Verify field structure
    for row in rows:
        assert "country" in row
        assert "current_pct" in row
        assert "current_rate_gwh_per_day" in row
        assert "required_gwh_per_day" in row
        assert "pct_gap" in row
        assert "on_track" in row
    # DE is seeded at 72.5% fill - pct_gap should be 90 - 72.5 = 17.5
    de_row = next(r for r in rows if r["country"] == "DE")
    assert de_row["pct_gap"] is not None
    assert abs(de_row["pct_gap"] - 17.5) < 0.1


def test_prices_seasonality(client):
    r = client.get("/api/prices/seasonality")
    assert r.status_code == 200
    data = r.json()
    assert "months" in data
    assert len(data["months"]) == 12
    assert data["current_month"] in range(1, 13)
    for m in data["months"]:
        assert "month" in m
        assert "label" in m
        assert "n_years" in m
        # If data available, percentiles should be ordered
        if m["p25"] is not None and m["p75"] is not None:
            assert m["p25"] <= m["p75"]
        if m["min"] is not None and m["median"] is not None:
            assert m["min"] <= m["median"]


def test_prices_regime(client):
    r = client.get("/api/prices/regime")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    rows = data["rows"]
    assert len(rows) >= 30

    # Once enough history, vol and corr should be non-null
    late = [r for r in rows if r["ttf_vol_30d"] is not None]
    assert len(late) > 0, "No rows with ttf_vol_30d populated"

    for r in late:
        assert r["ttf_vol_30d"] >= 0
        assert r["eua_vol_30d"] is None or r["eua_vol_30d"] >= 0
        if r["ttf_eua_corr_90d"] is not None:
            assert -1.0 <= r["ttf_eua_corr_90d"] <= 1.0


def test_generation_zone(client):
    r = client.get("/api/generation/zone/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert data["gen_date"] is not None
    assert data["renewable_pct"] is not None
    assert data["dominant_fuel"] is not None
    assert isinstance(data["hourly"], list)
    assert isinstance(data["daily"], list)
    assert len(data["daily"]) > 0
    for row in data["daily"][:3]:
        assert "gen_date" in row
        assert "renewable_pct" in row
        assert "total_mw" in row


def test_generation_zone_not_found(client):
    r = client.get("/api/generation/zone/XX-FAKE")
    assert r.status_code == 404


def test_generation_zone_lowercase(client):
    r = client.get("/api/generation/zone/de-lu")
    assert r.status_code == 200
    assert r.json()["zone"] == "DE-LU"


def test_generation_zone_capacity(client):
    r = client.get("/api/generation/zone/DE-LU/capacity")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert isinstance(data["daily"], list)
    assert len(data["daily"]) > 0
    for row in data["daily"][:3]:
        assert "gen_date" in row
        assert "wind_cf" in row
        assert "solar_cf" in row
        if row["wind_cf"] is not None:
            assert 0.0 <= row["wind_cf"] <= 1.0
        if row["solar_cf"] is not None:
            assert 0.0 <= row["solar_cf"] <= 1.0


def test_generation_zone_capacity_not_found(client):
    r = client.get("/api/generation/zone/XX-FAKE/capacity")
    assert r.status_code == 404


def test_generation_eu_monthly(client):
    r = client.get("/api/generation/eu/monthly")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    # The fixture has only 1 zone (DE-LU); the endpoint requires >=5 zones, so rows may be empty.
    # Just validate structure if rows are present.
    for row in data["rows"]:
        assert "year" in row and "month" in row
        assert row["year"] >= 2021
        assert 1 <= row["month"] <= 12
        if row["renewable_pct"] is not None:
            assert 0.0 <= row["renewable_pct"] <= 100.0


def test_generation_eu_monthly_schema(client):
    r = client.get("/api/generation/eu/monthly")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data["rows"], list)


def test_generation_eu_cf_latest(client):
    r = client.get("/api/generation/eu/cf-latest")
    assert r.status_code == 200
    data = r.json()
    assert "wind_cf" in data
    assert "solar_cf" in data
    assert "wind_installed_gw" in data
    assert "wind_cf_month_avg" in data
    if data["wind_cf"] is not None:
        assert 0.0 <= data["wind_cf"] <= 100.0
    if data["solar_cf"] is not None:
        assert 0.0 <= data["solar_cf"] <= 100.0
    if data["wind_cf_month_pct_rank"] is not None:
        assert 0.0 <= data["wind_cf_month_pct_rank"] <= 100.0


def test_prices_curve_snapshots(client):
    r = client.get("/api/prices/curve/snapshots")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) > 0
    labels = {row["snapshot_label"] for row in data["rows"]}
    assert "today" in labels
    row = data["rows"][0]
    assert "contract" in row
    assert "settlement" in row and row["settlement"] > 0
    assert "tenor_type" in row


def test_imbalance_monthly(client):
    r = client.get("/api/imbalance/monthly")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) > 0
    row = data["rows"][0]
    assert "year" in row and "month" in row
    assert row["year"] >= 2024
    assert 1 <= row["month"] <= 12
    if row["avg_eur"] is not None:
        assert row["avg_eur"] > 0


def test_gas_pace_has_seasonal_norm(client):
    r = client.get("/api/gas/pace")
    assert r.status_code == 200
    data = r.json()
    eu = data["eu"]
    assert "seasonal_inj_avg_gwh_d" in eu
    assert "next_interim_date" in eu
    assert "next_interim_pct" in eu


def test_gas_pace_interim_target_values(client):
    r = client.get("/api/gas/pace")
    assert r.status_code == 200
    eu = r.json()["eu"]
    if eu["next_interim_pct"] is not None:
        assert eu["next_interim_pct"] in (62.5, 75.0, 83.3, 90.0)
    if eu["next_interim_date"] is not None:
        assert eu["next_interim_date"][:4].isdigit()


def test_gas_country_compare(client):
    """gas/country-compare returns correct schema; may be empty if fixture lacks multi-country data."""
    r = client.get("/api/gas/country-compare")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    # Each row must have gas_day and at least the EU field (may be None)
    for row in data["rows"]:
        assert "gas_day" in row
        assert "EU" in row


def test_power_monthly(client):
    """power/monthly returns 8 zones x 24 months structure (may be empty in test DB)."""
    r = client.get("/api/power/monthly")
    assert r.status_code == 200
    data = r.json()
    assert "zones" in data
    assert "months" in data
    assert "cells" in data
    # If data present, each cell must have zone/yr/mo
    for cell in data["cells"]:
        assert "zone" in cell
        assert "yr" in cell
        assert "mo" in cell
        assert 1 <= cell["mo"] <= 12


def test_generation_eu_hourly(client):
    """generation/eu/hourly returns correct schema (empty OK: test fixture only has 1 zone)."""
    r = client.get("/api/generation/eu/hourly")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    for row in data["rows"]:
        assert "ts" in row
        assert "wind" in row
        assert "nuclear" in row
        assert "n_zones" in row
        assert row["n_zones"] >= 28


def test_generation_eu_price_re(client):
    """generation/eu/price-re returns correct schema (empty OK if <10 zones in test data)."""
    r = client.get("/api/generation/eu/price-re")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    for row in data["rows"]:
        assert "price_date" in row
        assert "eu_avg_eur" in row
        assert "re_pct" in row
        if row["re_pct"] is not None:
            assert 0 <= row["re_pct"] <= 100


def test_generation_zones_cf(client):
    """generation/zones/cf returns zone CF rows with correct fields."""
    r = client.get("/api/generation/zones/cf")
    assert r.status_code == 200
    data = r.json()
    assert "gen_date" in data
    assert "rows" in data
    for row in data["rows"]:
        assert "zone" in row
        assert "wind_cf" in row
        assert "solar_cf" in row


def test_power_hourly_profile_eu(client):
    """power/hourly-profile-eu returns 24 hourly rows with correct schema."""
    r = client.get("/api/power/hourly-profile-eu")
    assert r.status_code == 200
    data = r.json()
    assert "rows" in data
    assert len(data["rows"]) == 24
    for row in data["rows"]:
        assert "hour" in row
        assert 0 <= row["hour"] <= 23
        assert "avg_eur" in row
        assert "neg_pct" in row
