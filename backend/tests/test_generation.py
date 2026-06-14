"""Generation map and zone endpoint tests."""


def test_generation_map(client):
    r = client.get("/api/generation/map")
    assert r.status_code == 200
    data = r.json()
    assert "zones" in data
    assert len(data["zones"]) >= 1
    zones = {z["zone"] for z in data["zones"]}
    assert "DE-LU" in zones
    de = next(z for z in data["zones"] if z["zone"] == "DE-LU")
    assert de["renewable_pct"] is not None
    assert 0 <= de["renewable_pct"] <= 100
    assert de["wind_mw"] == 12000.0
    assert de["solar_mw"] == 6000.0
    assert de["total_mw"] == 34400.0


def test_generation_map_has_as_of(client):
    r = client.get("/api/generation/map")
    assert r.status_code == 200
    data = r.json()
    assert "as_of" in data


def test_generation_zone_delu(client):
    r = client.get("/api/generation/zone/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "DE-LU"
    assert data["renewable_pct"] == 57.4
    assert data["dominant_fuel"] is not None
    # Wind (12000 MW) is largest contributor in DE-LU seed data
    assert data["dominant_fuel"] == "wind"
    assert data["gen_date"] is not None


def test_generation_zone_hourly(client):
    r = client.get("/api/generation/zone/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert len(data["hourly"]) > 0
    pt = data["hourly"][0]
    assert "ts" in pt
    assert pt["wind"] is not None
    assert pt["gas"] == 5000.0


def test_generation_zone_daily(client):
    r = client.get("/api/generation/zone/DE-LU")
    assert r.status_code == 200
    data = r.json()
    assert len(data["daily"]) > 0
    pt = data["daily"][0]
    assert "gen_date" in pt
    assert "renewable_pct" in pt
    assert pt["renewable_pct"] is not None


def test_generation_zone_lowercase(client):
    r = client.get("/api/generation/zone/de-lu")
    assert r.status_code == 200
    assert r.json()["zone"] == "DE-LU"


def test_generation_zone_unknown(client):
    r = client.get("/api/generation/zone/ZZ-99")
    assert r.status_code == 404


def test_generation_zone_fr(client):
    r = client.get("/api/generation/zone/FR")
    assert r.status_code == 200
    data = r.json()
    assert data["zone"] == "FR"
    assert data["renewable_pct"] == 22.3
    # FR fixture has nuclear=38000 MW as the largest fuel type
    assert data["dominant_fuel"] == "nuclear"
