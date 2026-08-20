# CLAUDE.md - energy frontend

Assumes `~/quant/energy/CLAUDE.md` (dashboards, data sources, the Corsica/no-price rules)
has been read; this file covers only what is specific to `frontend/`.

## Stack

React 19 + Vite + TypeScript, TanStack Router (file-based) + TanStack Query, Tailwind v4,
react-leaflet + Leaflet, recharts, lucide-react. `npm`, not bun or pnpm. No deck.gl here
(unlike freight): the choropleths are 45 polygons, plain `L.geoJSON` is the right tool.

```bash
npm install
npm run dev      # :5173, proxies /api -> :8004
npm test         # vitest run
npm run build    # tsc -b && vite build -> dist/ (nginx root, no reload needed)
```

`@` aliases `./src`, in both `vite.config.ts` and `vitest.config.ts`.

## Routing

`src/routes/` is scanned by the TanStack Router plugin and `routeTree.gen.ts` is
**generated** - never hand-edit it. Adding a route: create the file, then
`npx vite build --emptyOutDir=false` before `npm run build` to regenerate the tree.

Nav lives in the `NAV` array in `src/routes/__root.tsx`, tagged `group: 'EU' | 'US'`. The
desktop bar inserts a divider wherever the group changes and the mobile sheet renders the
same array grouped under headings, so a new dashboard is one entry in that array, not two
lists to keep in sync. `__root.tsx` also owns the About modal (which lists every data source
and map attribution: update it when a source is added) and the 404 component.

`/map` redirects to `/power`, which is the live unified price + generation dashboard. The
root CLAUDE.md describes the redirect in the opposite direction; the code is the truth here.

Route-level search params are validated in the route definition (`validateSearch` on
`/power` for `?date=`), not parsed ad hoc in the component.

## Data layer

`src/lib/api.ts` (~2.4k lines) is the single API surface: a TypeScript interface per backend
pydantic model, then one `api` object of thunks, all going through one `get<T>()` helper.
Note this is **not** the freight shape: there are no exported `use*` hooks here, components
call `useQuery({ queryKey, queryFn: api.something })` themselves. Keep that shape. Add a
method to `api` and its response interface; never `fetch` from a component and never put a
raw URL in a route file.

`staleTime` tiers, matched to how the data is actually produced (the app refreshes twice
daily, so nothing here polls):

| Value | Applies to |
|---|---|
| 15 min (global default in `main.tsx`) | anything unspecified |
| 15 min explicit | tables the refresh job rewrites: prices, zone panels, meta |
| 1 h | the backend's TTL-cached model endpoints (`/spreads/*`, correlations, profiles) |
| 6 h | monthly rollups that move once a month |

Query keys are `['name', ...params]` and must include every parameter that changes the URL,
or the cache will serve one zone's response for another. Use `enabled:` to suppress queries
that would 404 by design (`enabled: !noPrice` for the price queries on an island zone) and
`retry: false` on endpoints that legitimately 404 for some zones, rather than letting a
permanent red line accumulate in the network log on every selection.

## Pure logic lives in `src/lib/` and is unit-tested

`scales.ts` is the design system for data: every choropleth colour ramp
(`powerPriceColor`, `renewablePctColor`, `carbonIntensityColor`, `utilizationColor`, ...),
the zone and country name maps, `ZONE_SIBLINGS`, `ZONE_TO_HYDRO_COUNTRY`, `FUEL_PALETTE`,
IPCC `EMISSION_FACTORS`, and the `MapMetric` type. `island.ts` holds the gap-preserving
monthly rollup. `utils.ts` holds `cn`, the `DateWindow` cutoff helper and the `fmt*` family.

- **Never hardcode a hex in a component** - import the scale function. The legend arrays in
  `power.tsx` (`METRIC_CONFIG`) are the one hand-maintained mirror of the ramps: change a
  threshold in `scales.ts` and change the legend in the same commit.
- **vitest runs `environment: 'node'`.** A module under test must not import Leaflet or
  recharts, or the run dies on `window is not defined`. That is exactly why `MapMetric` /
  `isPriceMetric` / `noPriceFillFor` live in `scales.ts` rather than in `EuroMap.tsx`, and
  why the island history rollup is in `lib/island.ts` rather than in the panel. New display
  logic with a branch or a formula belongs in `lib/` with a test, not inline in a chart file.
- Tests sit beside the logic (`scales.test.ts`); `components/map/island.test.ts` is the one
  that does not, and it covers `lib/island.ts` + the no-price branch of `lib/scales.ts`.

## The map layer

`components/map/EuroMap.tsx` renders the unified choropleth **imperatively** against the
Leaflet API: the GeoJSON is fetched once into an `L.geoJSON` layer, and live data reaches
the style/tooltip callbacks through refs so a data change re-styles paths in place instead of
rebuilding the layer. Everything outside the map is normal declarative React.

- **All path styling goes through the single `zoneStyle()` helper.** Initial render, the
  data-change re-style and the mouseout restore all call it. They were three inline objects
  once, and the mouseout handler silently dropped the no-price dash.
- Features carry `zone` and an optional `displayAs`; **always resolve `dataZone =
  displayAs ?? zone` and key data lookups and selection on `dataZone`**, not `zone`. No
  polygon currently sets `displayAs` (FR-COR stopped doing so when Corsica got its own
  identity), so a mismatch will not show up in testing.
- No-price zones (`NO_PRICE_ZONES` in `scales.ts`, kept in sync with `ISLAND_ZONES` in
  `backend/analytics/island.py`) get `NO_PRICE_FILL` + a dashed stroke under price metrics
  only, and a tooltip that states the reason rather than the symptom. They must never render
  in the `#374151` missing-data grey: "no market exists" and "the fetch failed" cannot look
  alike.
- Map labels ride in a `Pane` at `zIndex: 650` above the choropleth (Carto dark, no-labels
  base + labels-only overlay).
- GeoJSON assets live in `public/geo/` and are vendored, not generated at build time. The
  curl + script recipes and the electricitymaps -> ENTSO-E zone name mapping are in
  `geo-README.md`.

`UnifiedZonePanel.tsx` is the drill-down. Its active tab is **derived, not stored**: the
panel is not remounted when the selected zone changes, so a user sitting on Price who clicks
Corsica would otherwise land on a tab that cannot render. Do not "fix" that with a syncing
`useEffect`.

## Styling

Tailwind v4 with the theme declared in `src/index.css` under `@theme` - a dark, low-chroma
palette (`background`, `card`, `primary`, `muted`, `border`, ...). **Use the semantic tokens**
(`bg-card`, `text-muted-foreground`, `border-border`), never raw hex or `bg-slate-800`, with
the deliberate exception of data colours, which come from `scales.ts`. Fonts are DM Sans
(sans) + JetBrains Mono (mono); `tabular-nums` is already on `body`. The Leaflet dark-mode
overrides at the bottom of `index.css` are what stop popups and controls rendering white.

## Page conventions

Route files are large and single-file by design (`spreads.tsx` ~6k lines, `generation.tsx`
~2.3k): a page is a set of top-level section components plus a tab strip driven by a
`const TABS` array and local state (`SPREAD_TABS` / `SpreadTab` is the pattern to copy).
Section-local chart helpers and tooltip components stay co-located with their section.

- Every panel handles three states: loading, empty, and data. The backend returns
  empty-but-valid bodies routinely, so empty is a normal path, not an error path.
- `StaleBanner` warns when its dataset is >48 h old. Use `variant="overlay"` on map pages and
  `variant="inline"` on scrollable ones, and pass the right `datasetKey` (`gas` | `power` |
  `spreads` | `imbalance`) - it reads the matching `refreshed_at_*` from `/api/meta`.
- A chart must not draw across a data gap. Emit `null` for absent periods so recharts breaks
  the line; see `buildIslandHistory` for why (19 months EDF never published would otherwise
  render as a clean segment).

## Build and deploy

`vite.config.ts` splits router/query/leaflet/lucide/recharts/react into manual chunks so
recharts stays off the critical path for the map pages. Keep new heavy deps out of the
initial chunk.

`npm run build` runs `tsc -b` first, so a type error fails the build. Fix types, do not `any`
past them. CI (`.github/workflows/ci.yml`) runs exactly `npm ci && npm run build`; the deploy
workflow then re-runs it on the VPS, where `dist/` is the nginx root and no reload is needed.
