# GeoJSON assets

Static files vendored into `public/geo/`. Re-run these commands if you need to update them.

## countries.geojson

Source: Eurostat GISCO countries, 1:3M resolution, 2020 vintage, EPSG:4326.
Attribution: (C) EuroGeographics (add to About section in Phase 4).
Final size: ~400KB (gzip ~130KB). 30-day cache in nginx.

Build:
```bash
curl -s "https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/CNTR_RG_03M_2020_4326.geojson" \
  -o /tmp/gisco_03m.geojson

python3 scripts/build_geojson.py
```

Script at `scripts/build_geojson.py` filters to European countries, applies RDP
simplification (epsilon=0.03 degrees, ~3km), rounds to 3 decimal places, and strips
all properties except ISO_A2. The 1:3M source gives clean borders at zoom 4-7;
1:20M was too coarse and produced jagged coastlines.

## bidding_zones.geojson

Source: electricitymaps-contrib `geo/world.geojson` (ODbL license).
Attribution: "Map data from Electricity Maps (CC BY 4.0 / ODbL)" -- add to About section in Phase 4.
Final size: ~53KB. Long cache in nginx.

Build:
```bash
curl -s "https://raw.githubusercontent.com/electricitymaps/electricitymaps-contrib/master/geo/world.geojson" \
  -o /tmp/em_world.geojson

python3 scripts/build_bidding_zones.py
```

Zone name mapping (electricitymaps key -> ENTSO-E zone name stored in DB):
- DE -> DE-LU, IT-NO -> IT-NORD, DK-DK1 -> DK-1, SE-SE1 -> SE-1, NO-NO1 -> NO-1, IE -> IE-SEM
