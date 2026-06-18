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
