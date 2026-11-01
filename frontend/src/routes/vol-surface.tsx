import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { MethodologyToggle } from '@/components/ui/methodology-toggle'
import { api } from '@/lib/api'
import { useDebouncedValue } from '@/lib/debounce'
import { CHART, MONEYNESS_LINE_COLORS, PLOTLY, TENOR_COLORS, TOOLTIP_STYLE } from '@/lib/pricingTheme'
import {
  MONEYNESS, MONEYNESS_LINES, TENORS, TENOR_LABELS, buildSmileData, buildTermData, getByKey,
  summarise1Y, surfaceZ, volColor,
} from '@/lib/volSurface'

export const Route = createFileRoute('/vol-surface')({
  component: VolSurfacePage,
})

function VolSurfacePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [PlotComponent, setPlotComponent] = useState<React.ComponentType<any> | null>(null)
  const [plotError, setPlotError] = useState<string | null>(null)
  const plotLoaded = useRef(false)
  useEffect(() => {
    if (plotLoaded.current) return
    plotLoaded.current = true
    Promise.all([
      import('react-plotly.js/factory'),
      // @ts-expect-error - plotly.js-dist-min has no type declarations
      import('plotly.js-dist-min'),
    ]).then(([factoryMod, plotlyMod]) => {
      // Vite/CJS interop can double-wrap defaults - unwrap until we hit a function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let factory: any = factoryMod
      while (factory && typeof factory !== 'function' && factory.default) factory = factory.default
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let Plotly: any = plotlyMod
      while (Plotly && Plotly.default && typeof Plotly.newPlot !== 'function') Plotly = Plotly.default
      if (typeof factory !== 'function') {
        setPlotError(`factory not a function: ${typeof factory}`)
        return
      }
      if (!Plotly || typeof Plotly !== 'object') {
        setPlotError(`Plotly not an object: ${typeof Plotly}`)
        return
      }
      const Component = factory(Plotly)
      setPlotComponent(() => Component)
    }).catch(err => {
      console.error('Plotly load failed:', err)
      setPlotError(String(err))
    })
  }, [])

  const [sigmaAtm, setSigmaAtm] = useState(0.20)
  const [skew, setSkew] = useState(-0.05)
  const [convexity, setConvexity] = useState(0.10)

  // Sliders fire a change per tick; the request follows the settled value only.
  const settled = useDebouncedValue({ sigma_atm: sigmaAtm, skew, convexity }, 250)

  const { data, error, isFetching } = useQuery({
    queryKey: ['pricing-surface', settled.sigma_atm, settled.skew, settled.convexity],
    queryFn: () => api.pricing.surface(settled),
    staleTime: Infinity,
    retry: false,
    placeholderData: (prev) => prev,
  })

  const grid = data?.grid ?? []

  const smileData = buildSmileData(grid)
  const termData = buildTermData(grid)
  const { atm: atm1y, riskReversal, butterfly } = summarise1Y(grid)

  const vols = grid.map(p => p.vol)
  const minVol = Math.min(...vols)
  const maxVol = Math.max(...vols)

  return (
    <div className="h-full overflow-y-auto bg-background">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Implied Volatility Surface</h1>
        <p className="text-muted-foreground">
          Parametric vol surface for commodity options. The smile is shaped by ATM vol, skew (risk reversal),
          and convexity (butterfly), with automatic term-structure flattening at longer tenors.
        </p>
      </div>

      {/* Parameter panel */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { label: 'ATM Vol', value: sigmaAtm, set: setSigmaAtm, min: 0.05, max: 0.80, step: 0.01, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
              { label: 'Skew', value: skew, set: setSkew, min: -0.30, max: 0.10, step: 0.01, fmt: (v: number) => v.toFixed(2) },
              { label: 'Convexity', value: convexity, set: setConvexity, min: 0.00, max: 0.40, step: 0.01, fmt: (v: number) => v.toFixed(2) },
            ].map(({ label, value, set, min, max, step, fmt }) => (
              <div key={label} className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground">{fmt(value)}</span>
                </div>
                <input
                  type="range"
                  min={min} max={max} step={step}
                  value={value}
                  onChange={e => set(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1.5 cursor-pointer"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          Surface request failed: {error instanceof Error ? error.message : 'error'}
        </p>
      )}
      {!error && isFetching && grid.length === 0 && (
        <p className="text-muted-foreground text-sm">Computing surface...</p>
      )}

      {/* Summary stats */}
      {grid.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '1Y ATM Vol', value: `${(atm1y * 100).toFixed(1)}%` },
            { label: '1Y Risk Reversal (90%−110%)', value: `${riskReversal > 0 ? '+' : ''}${riskReversal.toFixed(1)} vol pts` },
            { label: '1Y Butterfly (wings − ATM)', value: `${butterfly > 0 ? '+' : ''}${butterfly.toFixed(1)} vol pts` },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-mono font-semibold mt-1">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 3D surface */}
      {grid.length > 0 && (() => {
        const z = surfaceZ(grid)
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">3D Implied Vol Surface</CardTitle>
              <p className="text-xs text-muted-foreground">Drag to rotate, scroll to zoom.</p>
            </CardHeader>
            <CardContent className="-mx-2">
              {!PlotComponent && !plotError && (
                <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">Loading 3D surface...</div>
              )}
              {plotError && (
                <div className="h-[120px] flex items-center justify-center text-destructive text-xs font-mono px-4 text-center">3D surface failed to load: {plotError}</div>
              )}
              {PlotComponent && <PlotComponent
                  data={[{
                    type: 'surface' as const,
                    x: MONEYNESS.map(k => parseFloat((k * 100).toFixed(1))),
                    y: TENORS,
                    z,
                    colorscale: PLOTLY.colorscale,
                    showscale: true,
                    colorbar: {
                      title: { text: 'Vol %', font: { color: PLOTLY.text, size: 11 } },
                      tickfont: { color: PLOTLY.text, size: 10 },
                      thickness: 12,
                    },
                  }]}
                  layout={{
                    height: 420,
                    margin: { l: 0, r: 0, t: 0, b: 0 },
                    paper_bgcolor: 'transparent',
                    scene: {
                      xaxis: {
                        title: { text: 'Moneyness %', font: { color: PLOTLY.text, size: 11 } },
                        tickfont: { color: PLOTLY.text, size: 9 },
                        gridcolor: PLOTLY.grid,
                        zerolinecolor: PLOTLY.grid,
                        backgroundcolor: PLOTLY.sceneBg,
                      },
                      yaxis: {
                        title: { text: 'Tenor (years)', font: { color: PLOTLY.text, size: 11 } },
                        tickvals: TENORS,
                        ticktext: TENORS.map(t => TENOR_LABELS[t]),
                        tickfont: { color: PLOTLY.text, size: 9 },
                        gridcolor: PLOTLY.grid,
                        zerolinecolor: PLOTLY.grid,
                        backgroundcolor: PLOTLY.sceneBg,
                      },
                      zaxis: {
                        title: { text: 'Implied Vol %', font: { color: PLOTLY.text, size: 11 } },
                        tickfont: { color: PLOTLY.text, size: 9 },
                        gridcolor: PLOTLY.grid,
                        zerolinecolor: PLOTLY.grid,
                        backgroundcolor: PLOTLY.sceneBg,
                      },
                      bgcolor: PLOTLY.sceneBg,
                      camera: { eye: { x: 1.6, y: -1.4, z: 0.9 } },
                    },
                    font: { color: PLOTLY.text },
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />}
              <MethodologyToggle label="Parametric surface formula">
                <p><span className="text-foreground font-medium">Parametric surface formula.</span> This is a synthetic surface generated from three parameters, not a market-calibrated surface fitted to real options prices. The formula is: vol(K, T) = σ_ATM + skew × (K/F − 1) × t_factor + conv × (K/F − 1)² × t_factor, where t_factor = √(0.25/T) normalises the smile magnitude to the 3M tenor, so longer-dated surfaces are naturally flatter - consistent with the empirical observation that commodity vol smiles flatten with tenor as the central limit theorem averages out near-term supply shocks.</p>
                <p><span className="text-foreground font-medium">Limitations.</span> A real implied vol surface must be arbitrage-free (positive calendar spread, positive butterfly spread, no negative local vol). This parametric form has no such guarantee for extreme parameter choices. Market-calibrated surfaces use stochastic vol models (Heston, SABR) or non-parametric methods (SVI, kernel smoothing) fitted to a live options chain with bid-offer constraints.</p>
              </MethodologyToggle>
            </CardContent>
          </Card>
        )
      })()}

      {grid.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Smile chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Vol Smile by Tenor</CardTitle>
              <p className="text-xs text-muted-foreground">Skew flattens at longer tenors (t_factor = √(0.25/T))</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={smileData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: CHART.axisText }}
                    label={{ value: 'Moneyness K/F', position: 'insideBottom', offset: -2, fill: CHART.axisText, fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: CHART.axisText }}
                    tickFormatter={v => `${v}%`}
                    width={40}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    contentStyle={{ ...TOOLTIP_STYLE.contentStyle, fontSize: 11 }}
                    formatter={(v: unknown) => [`${v}%`]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {TENORS.map((t, i) => (
                    <Line
                      key={t}
                      dataKey={TENOR_LABELS[t]}
                      stroke={TENOR_COLORS[i]}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <MethodologyToggle label="Skew & smile interpretation">
                <p><span className="text-foreground font-medium">Skew in commodity markets.</span> Equity vol surfaces have negative skew (puts are expensive - crash risk). Commodity surfaces depend on the supply/demand structure. Crude oil typically shows negative skew as well: downside puts are bid up as producers buy protection against price crashes, and refiners hedge margin compression. The default −0.05 skew models this modest downside premium. Energy crises (2022) can briefly flip skew positive as the upside calls become more expensive.</p>
                <p><span className="text-foreground font-medium">Convexity and butterfly.</span> Convexity controls tail premium symmetrically - both OTM calls and puts are bid up relative to ATM. A positive butterfly (average wing vol minus ATM vol) reflects the market pricing non-normality: fat tails from sudden inventory shocks, geopolitical events, or demand destruction. The 1Y butterfly shown above is the conventional 25-delta measure.</p>
              </MethodologyToggle>
            </CardContent>
          </Card>

          {/* Term structure chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Vol Term Structure</CardTitle>
              <p className="text-xs text-muted-foreground">ATM vol and wings across the tenor curve</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={termData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: CHART.axisText }}
                    label={{ value: 'Tenor', position: 'insideBottom', offset: -2, fill: CHART.axisText, fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: CHART.axisText }}
                    tickFormatter={v => `${v}%`}
                    width={40}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    contentStyle={{ ...TOOLTIP_STYLE.contentStyle, fontSize: 11 }}
                    formatter={(v: unknown) => [`${v}%`]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {MONEYNESS_LINES.map(({ label }, i) => {
                    const color = MONEYNESS_LINE_COLORS[i]
                    return (
                    <Line
                      key={label}
                      dataKey={label}
                      stroke={color}
                      strokeWidth={1.5}
                      dot={{ r: 3, fill: color }}
                    />
                    )
                  })}
                </LineChart>
              </ResponsiveContainer>
              <MethodologyToggle label="Term structure dynamics">
                <p><span className="text-foreground font-medium">Term structure flattening.</span> The t_factor = √(0.25/T) scaling means the smile magnitude is normalised to the 3-month tenor. At 2Y, the smile width is √(0.25/2) ≈ 35% of the 3M width. This reflects the empirical observation that commodity vol smiles flatten as tenor increases - near-term supply shocks average out over longer horizons. ATM vol itself does not change with tenor in this model (no term structure of ATM vol), which is a simplification relative to market-calibrated surfaces.</p>
              </MethodologyToggle>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Heatmap */}
      {grid.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Surface Heatmap</CardTitle>
            <p className="text-xs text-muted-foreground">Implied vol (%) by moneyness and tenor. Dark blue = low vol, orange = high vol.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="text-xs font-mono w-full">
                <thead>
                  <tr>
                    <th className="text-left text-muted-foreground font-normal py-1 pr-4 w-16">Tenor</th>
                    {MONEYNESS.map(k => (
                      <th key={k} className="text-center text-muted-foreground font-normal py-1 px-1 min-w-[52px]">
                        {(k * 100).toFixed(0)}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TENORS.map(t => (
                    <tr key={t}>
                      <td className="text-muted-foreground py-1 pr-4">{TENOR_LABELS[t]}</td>
                      {MONEYNESS.map(k => {
                        const v = getByKey(grid, k, t)
                        return (
                          <td
                            key={k}
                            className="text-center py-1.5 px-1 rounded text-foreground text-[11px]"
                            style={{ background: volColor(v, minVol, maxVol) }}
                          >
                            {(v * 100).toFixed(1)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <MethodologyToggle label="Reading the surface">
              <p><span className="text-foreground font-medium">Reading the heatmap.</span> Each cell shows implied vol (%) at a specific moneyness (columns, 80%-120% of forward) and tenor (rows, 3M-2Y). The color gradient maps from dark blue (low vol) to orange (high vol). In a typical commodity surface with negative skew: the 80% column (deep OTM puts) is the hottest (orange), the 120% column (OTM calls) is cooler, and all cells cool as tenor increases due to t_factor normalization.</p>
            </MethodologyToggle>
          </CardContent>
        </Card>
      )}

      <Separator />
      <MethodologyToggle label="Calibration data & model assumptions">
        <p><span className="text-foreground font-medium">Model assumptions.</span> This is a synthetic parametric surface, not calibrated to real market option prices. The three parameters (ATM vol, skew, convexity) are user-controlled via the sliders. A production implied vol surface would be calibrated daily to exchange-traded options (CME crude oil options, ICE Brent options) using a model such as SVI or SABR, with bid-offer constraints and arbitrage checks applied.</p>
      </MethodologyToggle>
    </div>
    </div>
  )
}
