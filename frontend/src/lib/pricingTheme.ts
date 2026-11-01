// Chart styling for the Tools pages. Neutrals resolve through the Tailwind theme variables
// (declared in index.css) so the charts follow the app palette; the SERIES colours are data
// colours, kept here for the same reason scales.ts holds the map ramps.

export const CHART = {
  grid: 'var(--color-border)',
  axisLine: 'var(--color-muted-foreground)',
  axisText: 'var(--color-muted-foreground)',
  tooltipBg: 'var(--color-card)',
  tooltipBorder: 'var(--color-border)',
  tooltipText: 'var(--color-foreground)',
} as const

export const SERIES = {
  blue: 'hsl(200 80% 60%)',
  green: 'hsl(142 70% 55%)',
  amber: 'hsl(38 92% 60%)',
  violet: 'hsl(258 90% 66%)',
  red: 'hsl(0 72% 60%)',
  salmon: 'hsl(0 70% 60%)',
  purple: 'hsl(280 70% 65%)',
  teal: 'hsl(160 60% 50%)',
} as const

// Five tenor curves on the smile charts (0.25y ... 2.00y).
export const SMILE_COLORS = [SERIES.blue, SERIES.green, SERIES.amber, SERIES.violet, SERIES.red]

// Tenor curves and moneyness lines on /vol-surface.
export const TENOR_COLORS = [
  'hsl(25 95% 53%)',
  'hsl(45 93% 47%)',
  'hsl(142 71% 45%)',
  'hsl(217 91% 60%)',
  'hsl(271 91% 65%)',
]
export const MONEYNESS_LINE_COLORS = ['hsl(25 95% 53%)', 'hsl(142 71% 45%)', 'hsl(239 84% 67%)']

// Recharts tooltip, shared by every panel.
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: CHART.tooltipBg,
    border: `1px solid ${CHART.tooltipBorder}`,
    borderRadius: 6,
  },
  labelStyle: { color: CHART.axisText },
  itemStyle: { color: CHART.tooltipText },
}

// Text drawn over a heat-map cell: dark ink on light cells, light ink on dark cells.
export const HEAT_TEXT_DARK = 'hsl(222 47% 11%)'
export const HEAT_TEXT_LIGHT = 'hsl(210 40% 96%)'

// Plotly draws to canvas/WebGL and cannot resolve CSS variables, so the 3D surface mirrors the
// theme tokens (index.css @theme) as literals. Keep in sync with --color-muted-foreground,
// --color-border and --color-card.
export const PLOTLY = {
  text: 'hsl(220 8% 52%)',
  grid: 'hsl(222 12% 16%)',
  sceneBg: 'hsl(222 20% 5%)',
  colorscale: [
    [0, 'hsl(213 53% 25%)'],
    [0.25, 'hsl(221 83% 53%)'],
    [0.5, 'hsl(142 71% 45%)'],
    [0.75, 'hsl(45 93% 47%)'],
    [1, 'hsl(25 95% 53%)'],
  ] as [number, string][],
} as const
