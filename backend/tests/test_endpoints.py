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


def test_power_zone_unknown(client):
    r = client.get("/api/power/zone/XX-1")
    assert r.status_code == 404


def test_meta_includes_power(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert "DE-LU" in data["power_zones"]
    assert data["power_refreshed_at"] is not None
