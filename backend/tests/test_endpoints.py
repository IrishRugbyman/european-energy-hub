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
