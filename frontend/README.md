# Energy Hub Frontend

React 19 + Vite + TypeScript SPA for [energy.lbzgiu.xyz](https://energy.lbzgiu.xyz).

See the [project README](../README.md) for full documentation.

## Stack

- React 19, TypeScript
- TanStack Router (file-based routing, `src/routes/`)
- TanStack Query (long staleTime - data refreshes daily, not every 60s)
- Leaflet + react-leaflet (choropleth maps, Carto dark tiles)
- recharts (time series, bar charts, equity curves)
- Tailwind v4

## Development

```bash
npm install
npm run dev       # dev server at :5173, /api proxied to :8004
npm run build     # tsc + vite build -> dist/
npm run test      # vitest
```

GeoJSON files are vendored in `public/geo/`:
- `countries.geojson` - Eurostat GISCO 1:3M (filtered to Europe)
- `bidding_zones.geojson` - ElectricityMaps ODbL
