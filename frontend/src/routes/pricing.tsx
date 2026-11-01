import { useState, useCallback, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer, Legend, ComposedChart,
} from 'recharts'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CHART, SERIES, SMILE_COLORS, TOOLTIP_STYLE } from '@/lib/pricingTheme'
import {
  averagingVol, bsPrice, bsProfile, geometricAsian, heatTextColor, HEAT_LEGEND_GRADIENT,
  mertonSeries, normCDF, normPDF, perCalendarDay, perRatePoint, perVolPoint, rgbCss,
  spreadPayoffData, volHeatRgb,
} from '@/lib/pricingMath'
import { api, type PricingRequest, type BSResult, type CRRResult,
  type SpreadRequest, type SpreadResult, type SurfaceResult, type OptionType,
  type CrackRequest, type CrackResult, type CrackCalibration,
  type HestonRequest, type HestonResult, type LSMRequest, type LSMResult,
  type HestonSurfaceRequest, type MertonSurfaceRequest,
  type DigitalRequest, type DigitalResult, type AsianRequest, type AsianResult,
  type MertonRequest, type MertonResult } from '@/lib/api'

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
})

// ---- shared helpers ----

function Num({ label, value, onChange, step = 0.01, min }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="bg-secondary border border-border rounded-md px-3 py-1.5 text-sm
                   text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full"
      />
    </label>
  )
}

function TypeToggle({ value, onChange }: { value: OptionType; onChange: (t: OptionType) => void }) {
  return (
    <div className="flex gap-1">
      {(['call', 'put'] as OptionType[]).map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === t
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-muted-foreground hover:text-foreground'
          }`}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return <p className="text-destructive text-sm mt-2">{msg}</p>
}

// ---- Shared math accordion ----

interface MathSection { heading: string; body: React.ReactNode }

// Inline formula chip - use for short expressions within prose
function F({ c }: { c: string }) {
  return (
    <code className="font-mono text-[0.78rem] bg-secondary text-foreground px-1.5 py-0.5 rounded mx-0.5 whitespace-nowrap">
      {c}
    </code>
  )
}

// Display formula - one prominent line, own row
function Eq({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 font-mono text-sm text-foreground border-l-2 border-primary/40 pl-4 py-0.5 leading-7">
      {children}
    </div>
  )
}

function MathAccordion({ title, sections }: { title: string; sections: MathSection[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <Separator />
      <button
        type="button"
        className="flex w-full items-center justify-between py-3 text-sm font-medium text-foreground hover:text-primary transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span>{title}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pb-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
          {sections.map(s => (
            <div key={s.heading} className="space-y-2">
              <h3 className="text-foreground font-medium">{s.heading}</h3>
              {s.body}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- BS Pricer tab ----

function BSPricerPanel() {
  const [params, setParams] = useState<PricingRequest>(
    { S: 95, K: 100, T: 0.5, r: 0.02, sigma: 0.20, option_type: 'call' }
  )
  const [result, setResult] = useState<BSResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof PricingRequest) => (v: number | OptionType) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.price(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const profile = useMemo(
    () => result ? bsProfile(params.K, params.T, params.r, params.sigma, params.option_type) : null,
    [result, params.K, params.T, params.r, params.sigma, params.option_type]
  )

  const tooltipStyle = TOOLTIP_STYLE

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S"          value={params.S}     onChange={set('S') as (v: number) => void}     step={1} min={0.01} />
              <Num label="Strike K"        value={params.K}     onChange={set('K') as (v: number) => void}     step={1} />
              <Num label="Maturity T (yr)" value={params.T}     onChange={set('T') as (v: number) => void}     step={0.05} min={0.01} />
              <Num label="Rate r"          value={params.r}     onChange={set('r') as (v: number) => void}     step={0.001} />
              <Num label="Vol σ"           value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
            </div>
            <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Calculating...' : 'Price'}
            </Button>
            {error && <ErrorMsg msg={error} />}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Black-Scholes</p>
                  <p className="text-3xl font-mono font-bold text-foreground">{result.price.toFixed(4)}</p>
                </div>
                <div className="bg-secondary rounded-lg p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Bachelier (normal)</p>
                  <p className="text-3xl font-mono font-bold text-foreground">{result.bachelier_price.toFixed(4)}</p>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 text-muted-foreground font-normal text-xs">Greek</th>
                    <th className="text-right py-1 text-muted-foreground font-normal text-xs pr-5">Value</th>
                    <th className="text-left py-1 text-muted-foreground font-normal text-xs">Interpretation</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {([
                    ['Delta', result.delta,  `P&L per +$1 in spot`],
                    ['Gamma', result.gamma,  'Delta change per +$1 in spot'],
                    ['Vega',  perVolPoint(result.vega),     'P&L per +1pp in vol'],
                    ['Theta', perCalendarDay(result.theta), 'Time decay per calendar day'],
                    ['Rho',   perRatePoint(result.rho),     'P&L per +1pp in rate'],
                  ] as [string, number, string][]).map(([name, val, desc]) => (
                    <tr key={name} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-4 text-primary font-semibold">{name}</td>
                      <td className="py-1.5 pr-5 text-right text-foreground">{val.toFixed(4)}</td>
                      <td className="py-1.5 text-muted-foreground text-xs font-sans">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>Greek profiles vs spot</CardTitle>
            <p className="text-sm text-muted-foreground">
              Delta and gamma across the full spot range. The vertical line marks the current spot S = {params.S}.
              Delta is the S-curve; gamma peaks at-the-money where delta sensitivity is greatest.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Delta</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={profile} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="S" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(2)} domain={params.option_type === 'call' ? [0, 1] : [-1, 0]} />
                  <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} labelFormatter={(v) => `S = ${v}`} />
                  <ReferenceLine x={params.S} stroke={SERIES.violet} strokeDasharray="4 3"
                    label={{ value: 'S', fill: SERIES.violet, fontSize: 10 }} />
                  <ReferenceLine x={params.K} stroke={CHART.axisLine} strokeDasharray="2 4"
                    label={{ value: 'K', fill: CHART.axisText, fontSize: 10 }} />
                  <Line type="monotone" dataKey="delta" name="Delta" dot={false}
                    stroke={SERIES.blue} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Gamma</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={profile} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="S" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(0)} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(4)} domain={[0, 'auto']} />
                  <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(5) : v)} labelFormatter={(v) => `S = ${v}`} />
                  <ReferenceLine x={params.S} stroke={SERIES.violet} strokeDasharray="4 3"
                    label={{ value: 'S', fill: SERIES.violet, fontSize: 10 }} />
                  <ReferenceLine x={params.K} stroke={CHART.axisLine} strokeDasharray="2 4"
                    label={{ value: 'K', fill: CHART.axisText, fontSize: 10 }} />
                  <Line type="monotone" dataKey="gamma" name="Gamma" dot={false}
                    stroke={SERIES.green} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <MathAccordion title="Black-Scholes: how it works" sections={[
        {
          heading: 'Pricing formula',
          body: (<>
            <p>Under geometric Brownian motion (constant vol, log-normal returns), the European call and put prices are:</p>
            <Eq>C = S·N(d1) − K·exp(−rT)·N(d2)</Eq>
            <Eq>d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T) &nbsp;&nbsp; d2 = d1 − σ·√T</Eq>
            <p><F c="N(·)" /> is the standard normal CDF. <F c="N(d2)" /> is the risk-neutral probability of finishing in-the-money. Put-call parity <F c="C − P = S − K·exp(−rT)" /> holds exactly.</p>
          </>),
        },
        {
          heading: 'Greeks',
          body: (<>
            <p>First- and second-order sensitivities of the option price to market inputs:</p>
            <Eq>
              Δ (delta) = N(d1) &nbsp; Γ (gamma) = φ(d1)/(S·σ·√T)<br/>
              ν (vega)  = S·φ(d1)·√T &nbsp; ρ (rho) = K·T·exp(−rT)·N(d2)
            </Eq>
            <p>Gamma peaks at-the-money, where delta is most sensitive and delta-hedging is most expensive. Vega grows with √T, so longer-dated options carry more vol risk per unit notional.</p>
          </>),
        },
        {
          heading: 'Bachelier model (for when prices go negative)',
          body: (<>
            <p>WTI settled at −$37.63/bbl in April 2020. Log-normal models assign zero probability to negative prices, so they break near zero. The Bachelier model uses arithmetic Brownian motion instead:</p>
            <Eq>C = exp(−rT)·[(F−K)·N(d) + σ_N·√T·φ(d)] &nbsp; d = (F−K)/(σ_N·√T)</Eq>
            <p><F c="σ_N" /> is the <em>normal</em> vol in $/unit/year, not a dimensionless ratio. For ATM options, <F c="σ_N ≈ σ·S" />. The pricer shows both side-by-side.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- CRR Convergence tab ----

function CRRPanel() {
  const [params, setParams] = useState<PricingRequest>(
    { S: 95, K: 100, T: 0.5, r: 0.02, sigma: 0.20, option_type: 'call' }
  )
  const [result, setResult] = useState<CRRResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof PricingRequest) => (v: number | OptionType) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.crr(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const chartData = result?.steps.map(s => ({
    n: s.n,
    crr: +s.price.toFixed(4),
    err: +(Math.abs(s.price - result.bs_price)).toFixed(5),
  }))

  const tooltipStyle = TOOLTIP_STYLE

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Parameters</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Num label="Spot S"  value={params.S}     onChange={set('S') as (v: number) => void}     step={1} min={0.01} />
            <Num label="Strike K" value={params.K}    onChange={set('K') as (v: number) => void}     step={1} />
            <Num label="T (yr)"  value={params.T}     onChange={set('T') as (v: number) => void}     step={0.05} min={0.01} />
            <Num label="Rate r"  value={params.r}     onChange={set('r') as (v: number) => void}     step={0.001} />
            <Num label="Vol σ"   value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
          </div>
          <div className="flex items-center gap-4">
            <div className="w-40">
              <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            </div>
            <Button onClick={submit} disabled={loading}>
              {loading ? 'Computing...' : 'Run Convergence'}
            </Button>
          </div>
          {error && <ErrorMsg msg={error} />}
        </CardContent>
      </Card>

      {result && chartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>CRR(N) price vs BS limit</CardTitle>
                <span className="text-xs text-muted-foreground font-mono bg-secondary px-2 py-1 rounded">
                  BS = {result.bs_price.toFixed(4)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Binomial tree price as a function of tree depth. The dashed line is the Black-Scholes analytical limit.
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={270}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="n" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }}
                    label={{ value: 'Tree steps N', position: 'insideBottom', offset: -10, fill: CHART.axisText, fontSize: 11 }} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }}
                    tickFormatter={(v: number) => v.toFixed(3)} domain={['auto', 'auto']} />
                  <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} />
                  <ReferenceLine y={result.bs_price} stroke={SERIES.violet} strokeDasharray="6 3"
                    label={{ value: 'BS', fill: SERIES.violet, fontSize: 11 }} />
                  <Line type="monotone" dataKey="crr" name="CRR(N)"
                    stroke={SERIES.blue} strokeWidth={2} dot={{ fill: SERIES.blue, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Absolute error |CRR - BS|</CardTitle>
              <p className="text-sm text-muted-foreground">
                Error decays roughly as O(1/N), oscillating due to odd/even parity of the tree (a known artefact of the discrete lattice).
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={270}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="n" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }}
                    label={{ value: 'Tree steps N', position: 'insideBottom', offset: -10, fill: CHART.axisText, fontSize: 11 }} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }}
                    tickFormatter={(v: number) => v.toFixed(4)} domain={[0, 'auto']} />
                  <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(5) : v)} />
                  <Line type="monotone" dataKey="err" name="|error|"
                    stroke={SERIES.amber} strokeWidth={2} dot={{ fill: SERIES.amber, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <MathAccordion title="Binomial tree (Cox-Ross-Rubinstein): mathematics" sections={[
        {
          heading: 'Tree construction',
          body: (<>
            <p>The asset is modelled as a recombining lattice. At each step of duration Δt = T/N, the price moves up by factor u or down by d, calibrated so the lattice matches GBM volatility:</p>
            <Eq>u = exp(σ·√Δt),  d = 1/u</Eq>
            <p>The risk-neutral probability p is set so the expected gross return in one step equals the risk-free rate - making the discounted asset price a martingale under Q:</p>
            <Eq>p = (exp(r·Δt) − d) / (u − d)</Eq>
          </>),
        },
        {
          heading: 'Backward induction',
          body: (<>
            <p>At expiry, each node holds the intrinsic payoff. The tree is rolled back one step at a time by discounting the risk-neutral expectation:</p>
            <Eq>V[i,j] = exp(−r·Δt) · [p·V[i+1,j+1] + (1−p)·V[i+1,j]]</Eq>
            <p>For American options, at each node take the maximum of the continuation value and the immediate exercise payoff. This is the principal advantage of the tree over closed-form BS: American early-exercise is trivial to handle. As N→∞ the CRR price converges to the BS price at rate O(1/N). The convergence oscillates above and below BS - the error chart above shows this odd/even lattice-parity artefact clearly.</p>
          </>),
        },
        {
          heading: 'Closed-form CRR (European only)',
          body: (<>
            <p>For European options, backward induction can be short-circuited. Let a be the minimum number of up-moves to finish in-the-money. The price is a complementary binomial CDF:</p>
            <Eq>C = S·Ψ(a, N, p') − K·exp(−rT)·Ψ(a, N, p)</Eq>
            <p>where <F c="Ψ(a,N,p)" /> is the complementary binomial CDF and <F c="p' = p·u/exp(r·Δt)" />. Log-gamma is used for numerical stability at large N. This is the "closed-form" toggle in the pricer - same tree math, no recursion required.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Spread Options tab ----

function SpreadPanel() {
  const [params, setParams] = useState<SpreadRequest>(
    { S1: 110, S2: 100, K: 5, T: 1.0, r: 0.03, sig1: 0.25, sig2: 0.30, rho: 0.80 }
  )
  const [result, setResult] = useState<SpreadResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof SpreadRequest) => (v: number) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.spread(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const payoffData = useMemo(() => spreadPayoffData(params.K, Math.max(params.K * 3, 20)), [params.K])
  const currentSpread = params.S1 - params.S2

  const tooltipStyle = TOOLTIP_STYLE

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Spread option calculator</CardTitle>
            <p className="text-sm text-muted-foreground">
              Prices <span className="font-mono text-foreground">max(S1 - S2 - K, 0)</span>.
              Directly applicable to the crack spread and WTI-Brent strategies - use historical vols and correlations as inputs.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S1 (leg 1)" value={params.S1}  onChange={set('S1')}  step={1} min={0.01} />
              <Num label="Spot S2 (leg 2)" value={params.S2}  onChange={set('S2')}  step={1} min={0.01} />
              <Num label="Strike K"        value={params.K}   onChange={set('K')}   step={0.5} />
              <Num label="Maturity T (yr)" value={params.T}   onChange={set('T')}   step={0.1} min={0.01} />
              <Num label="Rate r"          value={params.r}   onChange={set('r')}   step={0.001} />
              <Num label="Vol σ1"          value={params.sig1} onChange={set('sig1')} step={0.01} min={0.001} />
              <Num label="Vol σ2"          value={params.sig2} onChange={set('sig2')} step={0.01} min={0.001} />
              <Num label="Correlation ρ"  value={params.rho} onChange={set('rho')} step={0.05} min={-1} />
            </div>
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Calculating...' : 'Price Spread'}
            </Button>
            {error && <ErrorMsg msg={error} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payoff at expiry</CardTitle>
            <p className="text-sm text-muted-foreground">
              Intrinsic value <span className="font-mono text-foreground">max(S1-S2-K, 0)</span> as a function of the spread.
              The current spread S1-S2 = {currentSpread.toFixed(2)} is marked.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={payoffData} margin={{ top: 5, right: 16, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="spread" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{ value: 'Spread (S1 - S2)', position: 'insideBottom', offset: -10, fill: CHART.axisText, fontSize: 11 }} />
                <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(1)} domain={[0, 'auto']} />
                <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} labelFormatter={(v) => `Spread = ${v}`} />
                <ReferenceLine x={params.K} stroke={CHART.axisLine} strokeDasharray="2 4"
                  label={{ value: 'K', fill: CHART.axisText, fontSize: 10, position: 'top' }} />
                <ReferenceLine x={currentSpread} stroke={SERIES.violet} strokeDasharray="4 3"
                  label={{ value: 'now', fill: SERIES.violet, fontSize: 10, position: 'top' }} />
                <Line type="monotone" dataKey="payoff" name="Payoff" dot={false}
                  stroke={SERIES.blue} strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              { label: 'Margrabe (K=0)', value: result.margrabe, note: 'Exact - exchange option' },
              { label: "Kirk's approx (K>0)", value: result.kirk, note: 'Industry standard' },
              { label: 'Monte Carlo', value: result.mc, note: 'Correlated GBM, 80k paths' },
            ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
              <Card key={label}>
                <CardContent className="pt-5 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
                  <p className="text-4xl font-mono font-bold text-foreground mb-1">{value.toFixed(3)}</p>
                  <p className="text-xs text-muted-foreground">{note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">
              Kirk vs MC gap:{' '}
              <span className="font-mono text-foreground">{Math.abs(result.kirk - result.mc).toFixed(4)}</span>
              {' '}- Kirk's approximation is accurate when K is small relative to S2.
              Margrabe (K=0) gives the upper bound since removing the strike can only increase option value.
            </CardContent>
          </Card>
        </>
      )}

      <MathAccordion title="Spread option models: mathematics" sections={[
        {
          heading: 'Margrabe (1978): the exchange option',
          body: (<>
            <p>For K=0 the spread option is an exchange option: the right to receive S1 by giving up S2. Margrabe (1978) solved it in closed form by noting that r drops out - both assets grow at r under Q and cancel:</p>
            <Eq>C = S1·N(d1) − S2·N(d2)</Eq>
            <Eq>σ₁₂ = √(σ1² + σ2² − 2ρ·σ1·σ2)    d1 = [ln(S1/S2) + ½σ₁₂²T] / (σ₁₂·√T)    d2 = d1 − σ₁₂·√T</Eq>
            <p>σ₁₂ is the vol of the ratio S1/S2. Margrabe is exact for log-normal assets at K=0, giving the upper-bound price (removing the strike can only increase option value).</p>
          </>),
        },
        {
          heading: 'Kirk (1995): non-zero strike',
          body: (<>
            <p>For K&gt;0, Kirk collapses the problem by treating <F c="F2 + K" /> as a synthetic asset (where F2 = S2·exp(rT) is the S2 forward), then applies Margrabe to S1 vs that synthetic:</p>
            <Eq>a = F2 / (F2 + K)    (weight of S2 in the synthetic)</Eq>
            <Eq>σ_K = √(σ1² + a²·σ2² − 2ρ·a·σ1·σ2)</Eq>
            <p>Kirk is exact at K=0 (a=1, recovers Margrabe) and accurate when K is small relative to S2. Industry standard for crack spread caps, spark spread floors, and calendar spread options on commodity desks.</p>
          </>),
        },
        {
          heading: 'Monte Carlo and commodity applications',
          body: (<>
            <p>MC is the exact reference: simulate correlated log-normal paths via 2×2 Cholesky, discount the average payoff. Z1 = ε1, Z2 = ρ·ε1 + √(1−ρ²)·ε2 with ε ~ N(0,1).</p>
            <p className="mt-2">Direct applications in commodity markets:</p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li><span className="text-foreground">Crack spread cap:</span> max(RBOB·42 − WTI − K, 0) - refinery margin protection</li>
              <li><span className="text-foreground">Spark spread floor:</span> max(Power − HeatRate·Gas − K, 0) - power plant optionality</li>
              <li><span className="text-foreground">Calendar spread:</span> max(F_Dec − F_Jun − K, 0) - storage and seasonal plays</li>
            </ul>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Vol Surface tab ----

const T_VALUES = [0.25, 0.50, 1.00, 1.50, 2.00]
const T_LABELS = ['0.25y', '0.50y', '1.00y', '1.50y', '2.00y']
const K_LABELS = ['80%', '85%', '90%', '95%', 'ATM', '105%', '110%', '115%', '120%']
const K_MIDS   = [0.80,  0.85,  0.90,  0.95,  1.00,   1.05,   1.10,   1.15,   1.20]

type SurfaceMode = 'param' | 'heston' | 'merton'

function SurfacePanel() {
  const [mode, setMode] = useState<SurfaceMode>('param')
  const [atm, setAtm]   = useState(0.20)
  const [skew, setSkew] = useState(-0.05)
  const [conv, setConv] = useState(0.10)
  // Heston surface params
  const [hS, setHS] = useState(100), [hR, setHR] = useState(0.02)
  const [hV0, setHV0] = useState(0.04), [hKappa, setHKappa] = useState(2.0)
  const [hTheta, setHTheta] = useState(0.04), [hXi, setHXi] = useState(0.5)
  const [hRho, setHRho] = useState(-0.7)
  // Merton surface params
  const [mS, setMS] = useState(100), [mR, setMR] = useState(0.02)
  const [mSigma, setMSigma] = useState(0.15), [mLambda, setMLambda] = useState(0.5)
  const [mMuJ, setMMuJ] = useState(-0.10), [mSigmaJ, setMSigmaJ] = useState(0.15)

  const [result, setResult] = useState<SurfaceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      let data: SurfaceResult
      if (mode === 'param') {
        data = await api.pricing.surface({ sigma_atm: atm, skew, convexity: conv })
      } else if (mode === 'heston') {
        const body: HestonSurfaceRequest = { S: hS, r: hR, v0: hV0, kappa: hKappa, theta: hTheta, xi: hXi, rho_sv: hRho }
        data = await api.pricing.surfaceHeston(body)
      } else {
        const body: MertonSurfaceRequest = { S: mS, r: mR, sigma: mSigma, lambda: mLambda, muJ: mMuJ, sigmaJ: mSigmaJ }
        data = await api.pricing.surfaceMerton(body)
      }
      setResult(data)
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [mode, atm, skew, conv, hS, hR, hV0, hKappa, hTheta, hXi, hRho,
      mS, mR, mSigma, mLambda, mMuJ, mSigmaJ])

  const grid: number[][] = []
  let lo = Infinity, hi = -Infinity
  if (result) {
    for (let ti = 0; ti < 5; ti++) {
      grid[ti] = []
      for (let ki = 0; ki < 9; ki++) {
        const v = result.grid[ti * 9 + ki]?.vol ?? 0
        grid[ti][ki] = v
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
  }

  const smileData = useMemo(() => {
    if (!grid.length) return []
    return K_MIDS.map((krel, ki) => {
      const row: Record<string, number> = { k_rel: krel }
      T_VALUES.forEach((_, ti) => { row[`t${ti}`] = +(grid[ti][ki] * 100).toFixed(2) })
      return row
    })
  }, [result])  // eslint-disable-line react-hooks/exhaustive-deps

  const tooltipStyle = TOOLTIP_STYLE

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Implied volatility surface</CardTitle>
          <p className="text-sm text-muted-foreground">
            Parametric surface:{' '}
            <span className="font-mono text-foreground">
              σ(K,T) = σ_ATM + skew·(K/F-1) + conv·(K/F-1)²
            </span>{' '}
            with sqrt(T) dampening. Negative skew is the equity/commodity standard (wings are bid, puts expensive).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(['param', 'heston', 'merton'] as SurfaceMode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); setResult(null) }}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}>
                {m === 'param' ? 'Parametric' : m === 'heston' ? 'Heston' : 'Merton Jumps'}
              </button>
            ))}
          </div>
          {mode === 'param' && (
            <div className="grid grid-cols-3 gap-3 max-w-xs">
              <Num label="σ ATM" value={atm}  onChange={setAtm}  step={0.01} min={0.01} />
              <Num label="Skew"  value={skew} onChange={setSkew} step={0.01} />
              <Num label="Conv"  value={conv} onChange={setConv} step={0.01} min={0} />
            </div>
          )}
          {mode === 'heston' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Num label="Spot S" value={hS} onChange={setHS} step={1} min={0.01} />
              <Num label="Rate r" value={hR} onChange={setHR} step={0.005} />
              <Num label="v0" value={hV0} onChange={setHV0} step={0.005} min={0} />
              <Num label="κ" value={hKappa} onChange={setHKappa} step={0.5} min={0.01} />
              <Num label="θ" value={hTheta} onChange={setHTheta} step={0.005} min={0} />
              <Num label="ξ (vol-of-vol)" value={hXi} onChange={setHXi} step={0.05} min={0} />
              <Num label="ρ spot/var" value={hRho} onChange={setHRho} step={0.05} min={-1} />
            </div>
          )}
          {mode === 'merton' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Num label="Spot S" value={mS} onChange={setMS} step={1} min={0.01} />
              <Num label="Rate r" value={mR} onChange={setMR} step={0.005} />
              <Num label="Diffusion σ" value={mSigma} onChange={setMSigma} step={0.01} min={0.001} />
              <Num label="λ (jumps/yr)" value={mLambda} onChange={setMLambda} step={0.1} min={0} />
              <Num label="muJ (log jump)" value={mMuJ} onChange={setMMuJ} step={0.01} />
              <Num label="sigmaJ" value={mSigmaJ} onChange={setMSigmaJ} step={0.01} min={0.001} />
            </div>
          )}
          <Button onClick={submit} disabled={loading}>
            {loading ? (mode === 'heston' ? 'Running MC (slow)...' : 'Computing...') : 'Generate Surface'}
          </Button>
          {mode === 'heston' && <p className="text-xs text-muted-foreground">Heston surface: MC 20k paths per node × 45 nodes. Typical runtime 15-30s.</p>}
          {error && <ErrorMsg msg={error} />}
        </CardContent>
      </Card>

      {result && grid.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Vol smile by maturity</CardTitle>
              <p className="text-sm text-muted-foreground">
                Each line is one maturity. Skew tilts the smile; convexity controls curvature.
                The smile flattens at longer tenors (sqrt(T) term structure).
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={smileData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="k_rel" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                    label={{ value: 'Moneyness K/F', position: 'insideBottom', offset: -10, fill: CHART.axisText, fontSize: 11 }} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={['auto', 'auto']}
                    label={{ value: 'Implied vol', angle: -90, position: 'insideLeft', fill: CHART.axisText, fontSize: 11 }} />
                  <Tooltip {...tooltipStyle}
                    formatter={(v, name) => [`${typeof v === 'number' ? v.toFixed(2) : v}%`, name]}
                    labelFormatter={(v) => `K/F = ${(Number(v) * 100).toFixed(0)}%`} />
                  <Legend formatter={(v) => T_LABELS[parseInt(v.slice(1))]}
                    wrapperStyle={{ fontSize: 11, color: CHART.axisText }} />
                  {T_VALUES.map((_, ti) => (
                    <Line key={ti} type="monotone" dataKey={`t${ti}`} name={`t${ti}`}
                      stroke={SMILE_COLORS[ti]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Heatmap (rows = maturity, cols = moneyness K/F)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-muted-foreground py-1.5 pr-3 font-normal">T \ K/F</th>
                      {K_LABELS.map(k => (
                        <th key={k}
                          className={`text-center px-2 py-1.5 font-normal ${k === 'ATM' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row, ti) => (
                      <tr key={ti}>
                        <td className="pr-3 py-1.5 text-muted-foreground">{T_LABELS[ti]}</td>
                        {row.map((vol, ki) => {
                          const rgb = volHeatRgb(vol, lo, hi)
                          return (
                            <td key={ki} className="text-center px-2 py-1.5 rounded font-mono"
                              style={{ background: rgbCss(rgb), color: heatTextColor(rgb) }}>
                              {(vol * 100).toFixed(1)}%
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="w-28 h-2.5 rounded"
                  style={{ background: HEAT_LEGEND_GRADIENT }} />
                <span>Low vol (blue) - High vol (red) &nbsp;|&nbsp; Range: {(lo*100).toFixed(1)}% - {(hi*100).toFixed(1)}%</span>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <MathAccordion title="Implied volatility surface: theory" sections={[
        {
          heading: 'Why a surface, not a number?',
          body: (
            <p>
              Black-Scholes assumes a single constant σ, but market prices imply a <em>different</em> σ for each strike and maturity. Plotting implied vol vs (K, T) gives the <span className="text-foreground">volatility surface</span>. It encodes supply-demand for tail risk (put skew), skewness in the underlying return distribution, and the market's view on future vol regimes. Calibrating a surface from option quotes and interpolating to unlisted strikes is a core quant desk task.
            </p>
          ),
        },
        {
          heading: 'The parametric form used here',
          body: (<>
            <p>A simple 3-parameter smile in moneyness k = K/F (F = S·exp(rT)), scaled by √(0.25/T) so the smile flattens at longer tenors (variance grows linearly in T, smile scales as √T):</p>
            <Eq>σ(k, T) = [ATM + skew·(k−1) + conv·(k−1)²] · √(0.25/T)</Eq>
            <p><span className="text-foreground">ATM</span>: the at-the-money level (k=1). <span className="text-foreground">Skew</span>: slope - negative means puts are more expensive than equidistant calls (left-tail demand). <span className="text-foreground">Convexity</span>: curvature - positive means deep OTM wings are expensive relative to ATM. Equity is typically skew-dominated; energy can show positive skew (supply shocks drive upside) or high convexity (gas weather spikes).</p>
          </>),
        },
        {
          heading: 'Arbitrage-free constraints and SVI',
          body: (
            <p>
              The parametric form here is illustrative. Production use requires: no butterfly arbitrage (σ²(k) concave in k) and no calendar arbitrage (total variance σ²(k,T)·T non-decreasing in T). The SVI (Stochastic Volatility Inspired) model by Gatheral (2004) is a 5-parameter family that is near-arbitrage-free by construction and fits the term structure well. Calibration is a least-squares fit on live option quotes. SABR is another common choice, with an analytic approximation for fast calibration in rates and FX vol surfaces.
            </p>
          ),
        },
      ]} />
    </div>
  )
}

// ---- Crack Panel ----

function CrackPanel() {
  const defaultParams: CrackRequest = {
    S_WTI: 70, S_RBOB: 2.50, S_HO: 2.60,
    K: 15, T: 1.0, r: 0.03,
    sig_WTI: 0.25, sig_RBOB: 0.30, sig_HO: 0.28,
    rho_WR: 0.75, rho_WH: 0.65, rho_RH: 0.85,
    nb_paths: 100000,
  }
  const [params, setParams] = useState<CrackRequest>(defaultParams)
  const [result, setResult] = useState<CrackResult | null>(null)
  const [calib, setCalib] = useState<CrackCalibration | null>(null)
  const [loading, setLoading] = useState(false)
  const [calibLoading, setCalibLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof CrackRequest) => (v: number) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.crack(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const calibrate = useCallback(async () => {
    setCalibLoading(true); setError(null)
    try {
      const c = await api.pricing.crackCalibrate()
      setCalib(c)
      setParams(p => ({
        ...p,
        S_WTI: c.S_WTI, S_RBOB: c.S_RBOB, S_HO: c.S_HO,
        sig_WTI: c.sig_WTI, sig_RBOB: c.sig_RBOB, sig_HO: c.sig_HO,
        rho_WR: c.rho_WR, rho_WH: c.rho_WH, rho_RH: c.rho_RH,
        K: Math.round(c.crack_spot * 10) / 10,
      }))
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Calibration error') }
    finally { setCalibLoading(false) }
  }, [])

  const tooltipStyle = TOOLTIP_STYLE

  const barData = result ? [
    { name: 'Bachelier', value: result.bachelier, fill: SERIES.blue },
    { name: "Kirk's", value: result.kirk, fill: SERIES.teal },
    { name: 'Monte Carlo', value: result.mc, fill: SERIES.purple },
    { name: 'Port. Vanillas', value: result.portfolio_vanilla, fill: SERIES.salmon },
  ] : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>3:2:1 Crack Option Pricer</CardTitle>
            <p className="text-sm text-muted-foreground">
              Prices a European call on the 3:2:1 refinery margin
              (<span className="font-mono text-foreground">crack = 28·RBOB + 14·HO - WTI</span> $/bbl)
              via three models. Quantifies the correlation diversification discount vs a portfolio of vanillas.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={calibrate} disabled={calibLoading} className="w-full text-xs">
              {calibLoading ? 'Calibrating from EIA data...' : 'Auto-calibrate from EIA futures data'}
            </Button>
            {calib && (
              <p className="text-xs text-muted-foreground text-center">
                Calibrated as of {calib.as_of} | crack = ${calib.crack_spot.toFixed(2)}/bbl
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Num label="WTI ($/bbl)"  value={params.S_WTI}  onChange={set('S_WTI')}  step={1} min={0.01} />
              <Num label="RBOB ($/gal)" value={params.S_RBOB} onChange={set('S_RBOB')} step={0.01} min={0.001} />
              <Num label="HO ($/gal)"   value={params.S_HO}   onChange={set('S_HO')}   step={0.01} min={0.001} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Num label="σ WTI"  value={params.sig_WTI}  onChange={set('sig_WTI')}  step={0.01} min={0.01} />
              <Num label="σ RBOB" value={params.sig_RBOB} onChange={set('sig_RBOB')} step={0.01} min={0.01} />
              <Num label="σ HO"   value={params.sig_HO}   onChange={set('sig_HO')}   step={0.01} min={0.01} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Num label="ρ WTI/RBOB"  value={params.rho_WR} onChange={set('rho_WR')} step={0.05} min={-1} />
              <Num label="ρ WTI/HO"    value={params.rho_WH} onChange={set('rho_WH')} step={0.05} min={-1} />
              <Num label="ρ RBOB/HO"   value={params.rho_RH} onChange={set('rho_RH')} step={0.05} min={-1} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Num label="Strike K ($/bbl)" value={params.K} onChange={set('K')} step={1} />
              <Num label="Maturity T (yr)"  value={params.T} onChange={set('T')} step={0.1} min={0.01} />
              <Num label="Rate r"           value={params.r} onChange={set('r')} step={0.001} />
            </div>
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Pricing...' : 'Price Crack Option'}
            </Button>
            {error && <ErrorMsg msg={error} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model comparison</CardTitle>
            <p className="text-sm text-muted-foreground">
              All four prices for the same payoff. The gap between the crack option and
              the portfolio of vanillas is the correlation diversification discount.
            </p>
          </CardHeader>
          <CardContent>
            {result ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="name" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }} />
                  <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                    tickFormatter={(v: number) => `$${v.toFixed(1)}`} />
                  <Tooltip {...tooltipStyle}
                    formatter={(v) => [`$${(v as number).toFixed(4)}/bbl`, 'Price']}
                    labelFormatter={(l) => `${l}`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                Price the crack option to see model comparison
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {([
              { label: 'Bachelier', value: result.bachelier, note: 'Normal model' },
              { label: "Kirk's approx", value: result.kirk, note: '2-leg reduction' },
              { label: 'Monte Carlo', value: result.mc, note: `100k paths ± ${result.mc_stderr.toFixed(3)}` },
              { label: 'Portfolio of vanillas', value: result.portfolio_vanilla, note: 'Zero-corr benchmark' },
            ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
              <Card key={label}>
                <CardContent className="pt-5 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
                  <p className="text-3xl font-mono font-bold text-foreground mb-1">${value.toFixed(3)}</p>
                  <p className="text-xs text-muted-foreground">{note}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Diversification discount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Crack spot</p>
                  <p className="font-mono text-foreground">${result.crack_spot.toFixed(2)}/bbl</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Basket normal vol (corr)</p>
                  <p className="font-mono text-foreground">${result.crack_vol_n.toFixed(2)}/bbl/y</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Uncorr vol (portfolio)</p>
                  <p className="font-mono text-foreground">${result.crack_vol_n_uncorr.toFixed(2)}/bbl/y</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Discount (basis)</p>
                  <p className="font-mono text-foreground">
                    ${result.basis.toFixed(3)}/bbl
                    <span className="text-muted-foreground text-xs ml-1">
                      ({(Math.abs(result.basis) / result.portfolio_vanilla * 100).toFixed(1)}% cheaper)
                    </span>
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                The crack option is cheaper than the portfolio of vanillas because WTI, RBOB, and HO
                are positively correlated. When crude rises, products rise too - the crack is partially
                stabilized, reducing basket vol below the sum-of-variances benchmark. The discount
                represents the correlation premium a refining desk captures when buying the crack option
                instead of hedging each leg independently.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <MathAccordion title="3-leg basket option pricing: mathematics" sections={[
        {
          heading: 'The crack as a signed basket',
          body: (<>
            <p>The 3:2:1 crack converts product prices from $/gallon to $/bbl (×42) and weights by the refinery recipe:</p>
            <Eq>crack = 28·RBOB + 14·HO − 1·WTI    ($/bbl)</Eq>
            <p>Dollar weights: <F c="w_R = +28" /> (= 2/3 × 42 gal/bbl), <F c="w_H = +14" /> (= 1/3 × 42), <F c="w_W = −1" />. A European call on the crack pays <F c="max(crack(T) − K, 0)" />. This is a call on a basket with one short leg, which rules out simple Black-Scholes.</p>
          </>),
        },
        {
          heading: 'Bachelier: exact basket vol',
          body: (<>
            <p>Under log-normal dynamics, each leg's $/bbl daily change is approximately <F c="wi·Si·σi·dWi" />. Summing three correlated Brownian terms gives a normal crack innovation. The basket normal vol is:</p>
            <Eq>σ_N² = Σ_ij (wi·Si)(wj·Sj)·ρij·σi·σj    (full correlation)</Eq>
            <Eq>σ_N_uncorr² = Σ_i (wi·Si·σi)²              (ρ = 0, portfolio benchmark)</Eq>
            <p>Price as a single Bachelier call: <F c="C = exp(−rT)·[(F−K)·N(d) + σ_N·√T·φ(d)]" />. Bachelier handles negative crack regimes naturally - log-normal breaks when WTI goes negative (April 2020), Bachelier does not. Kirk and MC are lognormal approximations; Bachelier is the preferred model for negative-crack stress tests.</p>
          </>),
        },
        {
          heading: 'The diversification discount',
          body: (<>
            <p>The crack option is always cheaper than a portfolio of three separate vanilla calls (one per leg) when correlations are positive. By Jensen's inequality applied to the max() payoff:</p>
            <Eq>Basket option price  &lt;  Portfolio of vanillas</Eq>
            <p>Intuitively: when WTI rises, RBOB and HO rise too (ρ ≈ 0.75-0.85), so the crack spread is partially stabilised. A crack call gains less on upside than three independent calls, hence the basket option is cheaper. The discount equals <F c="σ_N_uncorr − σ_N" /> in vol terms and widens as correlations approach 1. Kirk (2-leg reduction via synthetic product basket P = 28·RBOB + 14·HO) and MC (3×3 Cholesky correlated GBM) both capture this; they are validated against each other - MC has no model error beyond log-normality, Kirk is the industry shortcut.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Heston Panel ----

function HestonPanel() {
  const [params, setParams] = useState<HestonRequest>({
    S: 100, K: 100, T: 1.0, r: 0.02,
    v0: 0.04, kappa: 2.0, theta: 0.04, xi: 0.5, rho_sv: -0.7,
    option_type: 'call', nb_paths: 100000, nb_steps: 252,
  })
  const [result, setResult] = useState<HestonResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof HestonRequest>(k: K) => (v: HestonRequest[K]) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.heston(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const tooltipStyle = TOOLTIP_STYLE

  // Simple CI bar chart data
  const barData = result ? [
    { name: 'CI lo', value: result.ci_lo, fill: CHART.axisLine },
    { name: 'Heston MC', value: result.price, fill: SERIES.blue },
    { name: 'CI hi', value: result.ci_hi, fill: CHART.axisLine },
    { name: 'BS (ref)', value: result.bs_ref, fill: SERIES.amber },
  ] : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Heston Stochastic Volatility (1993)</CardTitle>
            <p className="text-sm text-muted-foreground">
              MC pricer under the Heston model. Variance follows a CIR process:
              {' '}<span className="font-mono text-foreground">dv = κ(θ−v)dt + ξ√v dW_v</span>{' '}
              correlated with the spot. Full-truncation Euler.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S" value={params.S} onChange={set('S') as (v: number) => void} step={1} min={0.01} />
              <Num label="Strike K" value={params.K} onChange={set('K') as (v: number) => void} step={1} />
              <Num label="Maturity T (yr)" value={params.T} onChange={set('T') as (v: number) => void} step={0.25} min={0.01} />
              <Num label="Rate r" value={params.r} onChange={set('r') as (v: number) => void} step={0.005} />
              <Num label="v0 (init var)" value={params.v0} onChange={set('v0') as (v: number) => void} step={0.005} min={0} />
              <Num label="κ (mean rev)" value={params.kappa} onChange={set('kappa') as (v: number) => void} step={0.5} min={0.01} />
              <Num label="θ (LR var)" value={params.theta} onChange={set('theta') as (v: number) => void} step={0.005} min={0} />
              <Num label="ξ (vol-of-vol)" value={params.xi} onChange={set('xi') as (v: number) => void} step={0.05} min={0} />
              <Num label="ρ spot/var" value={params.rho_sv} onChange={set('rho_sv') as (v: number) => void} step={0.05} min={-1} />
              <Num label="MC Paths" value={params.nb_paths} onChange={v => setParams(p => ({ ...p, nb_paths: Math.round(v) }))} step={10000} min={1000} />
            </div>
            <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Running MC...' : 'Price (Heston MC)'}
            </Button>
            {error && <ErrorMsg msg={error} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Result vs Black-Scholes reference</CardTitle>
            <p className="text-sm text-muted-foreground">
              Heston MC price with 95% confidence interval. BS reference uses √((v0+θ)/2) as an
              approximate flat vol. The gap reflects smile/skew from stochastic vol.
            </p>
          </CardHeader>
          <CardContent>
            {result ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Heston MC</p>
                    <p className="text-2xl font-mono font-bold">{result.price.toFixed(4)}</p>
                  </div>
                  <div className="bg-secondary rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">95% CI</p>
                    <p className="text-sm font-mono">[{result.ci_lo.toFixed(3)},</p>
                    <p className="text-sm font-mono">{result.ci_hi.toFixed(3)}]</p>
                  </div>
                  <div className="bg-secondary rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">BS (ref)</p>
                    <p className="text-2xl font-mono font-bold">{result.bs_ref.toFixed(4)}</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="name" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 11 }} />
                    <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                      tickFormatter={(v: number) => v.toFixed(3)} domain={['auto', 'auto']} />
                    <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} />
                    <Bar dataKey="value" radius={[4,4,0,0]}>
                      {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                Run the pricer to see the Heston MC result
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <MathAccordion title="Heston model: mathematics" sections={[
        {
          heading: 'The stochastic vol SDE system',
          body: (<>
            <p>The Heston (1993) model drives the spot S and instantaneous variance v jointly:</p>
            <Eq>dS = r·S·dt + √v·S·dW_S</Eq>
            <Eq>dv = κ·(θ−v)·dt + ξ·√v·dW_v &nbsp;&nbsp; dW_S·dW_v = ρ·dt</Eq>
            <p><F c="κ" /> = mean-reversion speed (how fast vol snaps back to long-run level). <F c="θ" /> = long-run variance. <F c="ξ" /> = vol-of-vol (how much vol moves). <F c="ρ" /> = spot/vol correlation (negative in equities and energy - when prices fall, vol spikes). The <span className="text-foreground">Feller condition</span> <F c="2κθ > ξ²" /> ensures variance stays positive.</p>
          </>),
        },
        {
          heading: 'Full-truncation Euler and the simulation scheme',
          body: (<>
            <p>Direct Euler discretisation of the CIR variance process can generate negative values. The <em>full-truncation</em> scheme (Lord et al. 2010) floors variance at zero before using it in both the drift and diffusion:</p>
            <Eq>v⁺ = max(v, 0)   (floor for use in diffusion)</Eq>
            <Eq>vₜ₊₁ = vₜ + κ·(θ − v⁺)·Δt + ξ·√v⁺·ΔWᵥ</Eq>
            <Eq>ln Sₜ₊₁ = ln Sₜ + (r − ½v⁺)·Δt + √v⁺·ΔW_S</Eq>
            <p>Correlated Brownian increments are generated via: Z1, Z2 ~ N(0,1) iid; <F c="ΔW_v = Z1·√Δt" />, <F c="ΔW_S = (ρ·Z1 + √(1−ρ²)·Z2)·√Δt" />. Log-Euler for S preserves S{'>'} 0. When ξ=0 and v0=θ=σ², the model collapses to geometric Brownian motion and prices match Black-Scholes.</p>
          </>),
        },
        {
          heading: 'Economic intuition: why Heston produces a smile',
          body: (
            <p>
              Constant-vol Black-Scholes produces a flat implied vol surface. Heston produces a <span className="text-foreground">smile</span> (higher IV at wings) because vol is stochastic - there is a distribution over realized vol paths, and option prices are convex in vol (vanna, volga). Negative ρ tilts the smile into a <span className="text-foreground">left skew</span>: high-vol states coincide with falling prices, so puts are expensive and the surface slopes down to the left. This matches equity markets (the "leverage effect") and downstream energy markets that crash under supply shocks.
            </p>
          ),
        },
      ]} />
    </div>
  )
}

// ---- LSM Panel ----

function LSMPanel() {
  const [params, setParams] = useState<LSMRequest>({
    S: 100, K: 100, T: 1.0, r: 0.05, sigma: 0.20,
    option_type: 'put', nb_paths: 50000, nb_steps: 50,
  })
  const [result, setResult] = useState<LSMResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof LSMRequest>(k: K) => (v: LSMRequest[K]) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.lsm(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const earlyExercise = result ? result.lsm_price - result.eu_price : null

  const tooltipStyle = TOOLTIP_STYLE

  const barData = result ? [
    { name: 'European (BS)', value: result.eu_price,  fill: CHART.axisLine },
    { name: 'CRR (American)', value: result.crr_price, fill: SERIES.amber },
    { name: 'LSM (American)', value: result.lsm_price, fill: SERIES.blue },
  ] : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>American Option - Longstaff-Schwartz LSM</CardTitle>
            <p className="text-sm text-muted-foreground">
              Least-Squares Monte Carlo (Longstaff &amp; Schwartz, 2001). Backward regression on
              in-the-money paths estimates the continuation value at each exercise date.
              Cross-checked against the CRR binomial tree (300 steps).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S" value={params.S} onChange={set('S') as (v: number) => void} step={1} min={0.01} />
              <Num label="Strike K" value={params.K} onChange={set('K') as (v: number) => void} step={1} />
              <Num label="Maturity T (yr)" value={params.T} onChange={set('T') as (v: number) => void} step={0.25} min={0.01} />
              <Num label="Rate r" value={params.r} onChange={set('r') as (v: number) => void} step={0.005} />
              <Num label="Vol σ" value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
              <Num label="MC Paths" value={params.nb_paths} onChange={v => setParams(p => ({ ...p, nb_paths: Math.round(v) }))} step={10000} min={1000} />
            </div>
            <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Running LSM...' : 'Price American Option'}
            </Button>
            {error && <ErrorMsg msg={error} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LSM vs CRR vs European</CardTitle>
            <p className="text-sm text-muted-foreground">
              The early-exercise premium is the gap between the American and European price.
              LSM and CRR should agree closely; any remaining gap is Monte Carlo noise.
            </p>
          </CardHeader>
          <CardContent>
            {result ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {([
                    { label: 'LSM (American)', value: result.lsm_price, note: `${result.nb_paths.toLocaleString()} paths` },
                    { label: 'CRR (American)', value: result.crr_price, note: '300-step tree' },
                    { label: 'European (BS)',  value: result.eu_price,  note: 'Lower bound' },
                  ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
                    <div key={label} className="bg-secondary rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-xl font-mono font-bold">{value.toFixed(4)}</p>
                      <p className="text-xs text-muted-foreground">{note}</p>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="name" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }} />
                    <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                      tickFormatter={(v: number) => v.toFixed(3)} domain={['auto', 'auto']} />
                    <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} />
                    <Bar dataKey="value" radius={[4,4,0,0]}>
                      {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {earlyExercise !== null && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Early exercise premium:{' '}
                    <span className="font-mono text-foreground">{earlyExercise.toFixed(4)}</span>
                    {' '}| LSM vs CRR gap:{' '}
                    <span className="font-mono text-foreground">{Math.abs(result.lsm_price - result.crr_price).toFixed(4)}</span>
                  </p>
                )}
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">
                Price the option to see LSM vs CRR comparison
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <MathAccordion title="Longstaff-Schwartz LSM: mathematics" sections={[
        {
          heading: 'The American option valuation problem',
          body: (<>
            <p>An American option can be exercised at any time t ∈ [0,T]. Its price is the solution to an optimal stopping problem - at each date, compare the immediate exercise value h(Sₜ) to the continuation value C(t, Sₜ):</p>
            <Eq>{'V(t, S) = max{ h(S),  E[exp(−r·Δt)·V(t+Δt, Sₜ₊₁) | Sₜ] }'}</Eq>
            <p>The continuation value cannot be computed analytically for a GBM because there is no closed-form solution to the free-boundary PDE. CRR solves it on a lattice; LSM solves it via regression on simulated paths.</p>
          </>),
        },
        {
          heading: 'The LSM algorithm',
          body: (<>
            <p>1. Simulate M GBM paths over N time steps: <F c="S[t][i]" /> for i=1..M, t=0..N.</p>
            <p>2. At maturity, set <F c="CF[i] = exp(−rT)·h(S[N][i])" /> (discounted payoff).</p>
            <p>3. Working backward from t=N−1 to t=1:</p>
            <p className="ml-4">a. Select in-the-money paths: <F c="h(S[t][i]) > 0" />.</p>
            <p className="ml-4">b. Regress discounted future CF on a polynomial basis in S[t][i]/S0:</p>
            <Eq>E[CF | S] ≈ β₀ + β₁·s + β₂·s² + β₃·s³ &nbsp;&nbsp; (s = S/S0)</Eq>
            <p className="ml-4">c. If <F c="h(S[t][i]) > fitted continuation" />: update CF[i] = discounted immediate payoff.</p>
            <p>4. Price = mean(CF). The polynomial OLS is solved via normal equations (4×4 linear system, no external libraries).</p>
          </>),
        },
        {
          heading: 'Accuracy and convergence',
          body: (
            <p>
              LSM converges to the true American price as paths and steps increase, but from below (the regression underestimates continuation value, causing sub-optimal exercise decisions that are more conservative than optimal). The CRR binomial tree converges from above at large N. Both converge to the same limit: the true American price. The gap between them bounds the error. At 50k paths and 50 steps, the LSM price for an ATM put typically agrees with CRR(300) to within 2-4 basis points.
            </p>
          ),
        },
      ]} />
    </div>
  )
}

// ---- Digital Panel ----

function DigitalPanel() {
  const [params, setParams] = useState<DigitalRequest>({
    S: 100, K: 100, T: 1.0, r: 0.05, sigma: 0.20,
  })
  const [result, setResult] = useState<DigitalResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <F extends keyof DigitalRequest>(k: F) => (v: DigitalRequest[F]) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.digital(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const tooltipStyle = TOOLTIP_STYLE

  // Cash-or-nothing call across spot, at three maturities. As T shrinks the price
  // collapses onto the step function 1{S>K} and the delta spikes at the strike:
  // the whole reason digitals are hedged as tight call spreads, not replicated.
  const { K, r, sigma, T } = params
  const maturities = useMemo(() => [T, T / 4, T / 16], [T])
  const curveData = useMemo(() => {
    const steps = 120
    const lo = K * 0.70
    const hi = K * 1.30
    return Array.from({ length: steps + 1 }, (_, i) => {
      const S = lo + (i / steps) * (hi - lo)
      const row: Record<string, number> = { S: +S.toFixed(2) }
      maturities.forEach((t, j) => {
        const sqrtT = Math.sqrt(t)
        const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * t) / (sigma * sqrtT)
        const disc = Math.exp(-r * t)
        row[`p${j}`] = +(disc * normCDF(d2)).toFixed(5)
        row[`d${j}`] = +(disc * normPDF(d2) / (S * sigma * sqrtT)).toFixed(5)
      })
      return row
    })
  }, [K, r, sigma, maturities])

  const curveColors = [SERIES.blue, SERIES.amber, SERIES.red]
  const parityError = result ? Math.abs(result.parity_sum - result.disc) : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Digital (Binary) Options - Cash-or-Nothing</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pays 1 unit of currency if the option finishes in the money, nothing otherwise.
              Closed-form Black-Scholes: the call is simply the discounted risk-neutral
              probability of finishing above the strike.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S" value={params.S} onChange={set('S') as (v: number) => void} step={1} min={0.01} />
              <Num label="Strike K" value={params.K} onChange={set('K') as (v: number) => void} step={1} min={0.01} />
              <Num label="Maturity T (yr)" value={params.T} onChange={set('T') as (v: number) => void} step={0.25} min={0.01} />
              <Num label="Rate r" value={params.r} onChange={set('r') as (v: number) => void} step={0.005} />
              <Num label="Vol σ" value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
            </div>
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Pricing...' : 'Price Digital Options'}
            </Button>
            {error && <ErrorMsg msg={error} />}

            {result && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { label: 'Digital Call', value: result.call_price, note: 'e^(−rT)·N(d₂)' },
                    { label: 'Digital Put', value: result.put_price, note: 'e^(−rT)·N(−d₂)' },
                  ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
                    <div key={label} className="bg-secondary rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-xl font-mono font-bold">{value.toFixed(6)}</p>
                      <p className="text-xs text-muted-foreground font-mono">{note}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Call + Put</span>
                    <span className="font-mono text-foreground">{result.parity_sum.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount factor e^(−rT)</span>
                    <span className="font-mono text-foreground">{result.disc.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Parity residual</span>
                    <span className="font-mono text-primary">
                      {parityError !== null ? parityError.toExponential(1) : '-'}
                    </span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Call delta / gamma</span>
                    <span className="font-mono text-foreground">
                      {result.call_delta.toFixed(5)} / {result.call_gamma.toFixed(5)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Call vega (1pp) / theta (day)</span>
                    <span className="font-mono text-foreground">
                      {perVolPoint(result.call_vega).toFixed(5)} / {perCalendarDay(result.call_theta).toFixed(5)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approach to the Step Function</CardTitle>
            <p className="text-sm text-muted-foreground">
              Digital call price against spot at three maturities. As T shrinks the smooth curve
              collapses onto the payoff step at K, and the delta below becomes unboundedly large -
              this is pin risk.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={curveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="S" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }} />
                <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  domain={[0, 1]} tickFormatter={(v: number) => v.toFixed(1)} />
                <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={+K.toFixed(2)} stroke={CHART.axisLine} strokeDasharray="4 4" />
                {maturities.map((t, j) => (
                  <Line key={j} type="monotone" dataKey={`p${j}`} name={`T = ${t.toFixed(3)}y`}
                    stroke={curveColors[j]} strokeWidth={1.8} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={curveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="S" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }} />
                <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(5) : v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={+K.toFixed(2)} stroke={CHART.axisLine} strokeDasharray="4 4" />
                {maturities.map((t, j) => (
                  <Line key={j} type="monotone" dataKey={`d${j}`} name={`Δ, T = ${t.toFixed(3)}y`}
                    stroke={curveColors[j]} strokeWidth={1.8} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <MathAccordion title="Digital options: mathematics" sections={[
        {
          heading: 'Payoff and closed-form price',
          body: (<>
            <p>A cash-or-nothing digital call pays a fixed unit if S_T exceeds the strike:</p>
            <Eq>{'payoff = 1 if S_T > K, else 0'}</Eq>
            <p>Under the risk-neutral measure the price is the discounted probability of that event, which is exactly the second Black-Scholes term:</p>
            <Eq>C_digital = e^(−rT)·N(d₂) &nbsp;&nbsp; P_digital = e^(−rT)·N(−d₂)</Eq>
            <Eq>d₂ = [ln(S/K) + (r − σ²/2)·T] / (σ·√T)</Eq>
            <p>Because <F c="N(d₂) + N(−d₂) = 1" /> identically, the call and put must sum to the discount factor: <F c="C + P = e^(−rT)" />. The panel reports this residual, and it should be zero to machine precision - a free arithmetic check on the implementation.</p>
          </>),
        },
        {
          heading: 'Greeks and why the delta explodes',
          body: (<>
            <p>Differentiating the price with respect to spot gives</p>
            <Eq>Δ = e^(−rT)·n(d₂) / (S·σ·√T)</Eq>
            <p>where n is the standard normal density. The <F c="1/√T" /> factor means the delta grows without bound as expiry approaches with S near K. At T→0 the payoff is a discontinuous step, and no finite position in the underlying replicates a discontinuity. The gamma changes sign across the strike, so the hedge flips direction exactly where it is largest.</p>
            <p>Note also that vega changes sign: <span className="text-foreground">an in-the-money digital is short vol</span>. More vol raises the chance of falling back below the strike, which is the opposite of the vanilla intuition.</p>
          </>),
        },
        {
          heading: 'How desks actually trade them: the call-spread proxy',
          body: (<>
            <p>A digital is the limit of a tight call spread. Buying <F c="1/(2ε)" /> calls at <F c="K−ε" /> and selling the same quantity at <F c="K+ε" /> gives a payoff that ramps from 0 to 1 across the interval, converging to the step as ε→0:</p>
            <Eq>C_digital = −∂C_vanilla/∂K &nbsp;&nbsp; (the strike derivative of the vanilla call)</Eq>
            <p>Desks quote and hedge digitals as that spread with a finite ε, deliberately over-hedging: the spread is worth slightly more than the true digital, and the difference is the charge for the unhedgeable pin risk. It also handles the fact that the vanilla surface has skew, which the single-vol formula above ignores. The strike-derivative identity is why a digital price is a direct read on the <span className="text-foreground">slope of the implied vol smile</span> at K.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Asian Panel ----

function AsianPanel() {
  const [params, setParams] = useState<AsianRequest>({
    S: 100, K: 100, T: 1.0, r: 0.05, sigma: 0.20,
    option_type: 'call', n_fixings: 12, nb_paths: 100000,
  })
  const [result, setResult] = useState<AsianResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <F extends keyof AsianRequest>(k: F) => (v: AsianRequest[F]) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.asian(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const tooltipStyle = TOOLTIP_STYLE

  const { S, K, T, r, sigma, option_type } = params

  const fixingCurve = useMemo(() => {
    const euro = bsPrice(S, K, T, r, sigma, option_type)
    const ns = [1, 2, 3, 4, 6, 8, 12, 16, 24, 36, 52, 104, 252]
    return ns.map(n => ({
      n,
      ratio: euro > 0 ? +(geometricAsian(S, K, T, r, sigma, n, option_type) / euro).toFixed(4) : 0,
      volRatio: +(averagingVol(sigma, n) / sigma).toFixed(4),
    }))
  }, [S, K, T, r, sigma, option_type])

  const asymptote = useMemo(() => {
    const euro = bsPrice(S, K, T, r, sigma, option_type)
    return euro > 0 ? geometricAsian(S, K, T, r, sigma, 100000, option_type) / euro : 0
  }, [S, K, T, r, sigma, option_type])

  const effVol = averagingVol(sigma, params.n_fixings)
  const ciWidth = result ? result.ci_hi - result.ci_lo : null
  const geoBenchmark = useMemo(
    () => geometricAsian(S, K, T, r, sigma, params.n_fixings, option_type),
    [S, K, T, r, sigma, params.n_fixings, option_type],
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Asian Option - Arithmetic Average</CardTitle>
            <p className="text-sm text-muted-foreground">
              Settles against the average of the underlying over n fixing dates rather than the
              terminal price. Monte Carlo with antithetic variates; the arithmetic average of
              lognormals has no closed form.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S" value={params.S} onChange={set('S') as (v: number) => void} step={1} min={0.01} />
              <Num label="Strike K" value={params.K} onChange={set('K') as (v: number) => void} step={1} />
              <Num label="Maturity T (yr)" value={params.T} onChange={set('T') as (v: number) => void} step={0.25} min={0.01} />
              <Num label="Rate r" value={params.r} onChange={set('r') as (v: number) => void} step={0.005} />
              <Num label="Vol σ" value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
              <Num label="Fixings n" value={params.n_fixings}
                onChange={v => setParams(p => ({ ...p, n_fixings: Math.max(1, Math.round(v)) }))} step={1} min={1} />
              <Num label="MC Paths" value={params.nb_paths}
                onChange={v => setParams(p => ({ ...p, nb_paths: Math.round(v) }))} step={10000} min={1000} />
            </div>
            <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Running MC...' : 'Price Asian Option'}
            </Button>
            {error && <ErrorMsg msg={error} />}

            {result && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { label: 'Asian (MC)', value: result.asian_price, note: `${result.nb_paths.toLocaleString()} paths` },
                    { label: 'European', value: result.eu_price, note: 'Same S, K, T, σ' },
                    { label: 'Ratio', value: result.ratio, note: 'Asian / European' },
                  ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
                    <div key={label} className="bg-secondary rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-xl font-mono font-bold">{value.toFixed(4)}</p>
                      <p className="text-xs text-muted-foreground">{note}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">95% MC interval</span>
                    <span className="font-mono text-foreground">
                      [{result.ci_lo.toFixed(4)}, {result.ci_hi.toFixed(4)}]
                      {ciWidth !== null && <span className="text-muted-foreground"> (±{(ciWidth / 2).toFixed(4)})</span>}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Geometric-Asian (closed form)</span>
                    <span className="font-mono text-foreground">{geoBenchmark.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Averaging vol σ_A</span>
                    <span className="font-mono text-foreground">
                      {(effVol * 100).toFixed(2)}% ({(effVol / sigma).toFixed(3)}·σ)
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  The geometric price is a strict lower bound on the arithmetic one (AM-GM), so the
                  MC result should sit just above it. That is the cheapest available correctness
                  check on the simulation.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Averaging Discount vs Number of Fixings</CardTitle>
            <p className="text-sm text-muted-foreground">
              Closed-form geometric-Asian price as a fraction of the European, against fixing
              count. One fixing reproduces the European exactly; the discount then falls fast and
              flattens near the continuous-averaging limit.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={fixingCurve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="n" type="number" scale="log" domain={[1, 252]}
                  ticks={[1, 2, 4, 8, 16, 32, 64, 128, 252]}
                  stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  label={{ value: 'fixings n (log scale)', position: 'insideBottom', offset: -4,
                    fill: CHART.axisLine, fontSize: 10 }} />
                <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === 'number' ? v.toFixed(4) : v)}
                  labelFormatter={(l) => `n = ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={+asymptote.toFixed(4)} stroke={CHART.axisLine} strokeDasharray="4 4"
                  label={{ value: 'continuous limit', position: 'insideBottomRight',
                    fill: CHART.axisText, fontSize: 10 }} />
                <Line type="monotone" dataKey="ratio" name="Geometric Asian / European"
                  stroke={SERIES.blue} strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="volRatio" name="σ_A / σ"
                  stroke={SERIES.amber} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                {result && (
                  <ReferenceDot x={result.n_fixings} y={+result.ratio.toFixed(4)} r={5}
                    fill={SERIES.red} stroke={CHART.tooltipText} strokeWidth={1} />
                )}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-sm text-muted-foreground mt-3">
              {result
                ? <>Red marker: the arithmetic MC result at n = {result.n_fixings}, sitting just above the geometric curve as AM-GM requires.</>
                : <>Price the option to place the arithmetic Monte Carlo result on the curve.</>}
            </p>
          </CardContent>
        </Card>
      </div>

      <MathAccordion title="Asian options: mathematics" sections={[
        {
          heading: 'Why the arithmetic average has no closed form',
          body: (<>
            <p>The payoff references the average of the underlying over the fixing dates:</p>
            <Eq>{'payoff = max(A − K, 0),  A = (1/n)·Σ S(t_i)'}</Eq>
            <p>Each <F c="S(t_i)" /> is lognormal, but a <em>sum</em> of lognormals is not lognormal and has no tractable density. Black-Scholes cannot be applied directly, which is why the arithmetic case is priced by simulation (or by a moment-matching approximation such as Turnbull-Wakeman).</p>
            <p>The <em>geometric</em> average is different: <F c="ln G = (1/n)·Σ ln S(t_i)" /> is a sum of normals, therefore normal, therefore G is lognormal and a Black-Scholes-style formula exists (Kemna-Vorst 1990). That is the blue curve above, and it is the standard control variate for the arithmetic MC.</p>
          </>),
        },
        {
          heading: 'The averaging variance and the 1/√3 limit',
          body: (<>
            <p>For n equally spaced fixings the variance of the log average is</p>
            <Eq>Var[ln G] = σ²·T·(n+1)(2n+1) / (6n²)</Eq>
            <p>so the effective vol of the average is <F c="σ_A = σ·√((n+1)(2n+1)/(6n²))" />. At n=1 this is σ (a single fixing is just a European). As n grows it falls monotonically to the continuous limit:</p>
            <Eq>σ_A → σ/√3 ≈ 0.577·σ</Eq>
            <p>Averaging destroys roughly 42% of the volatility, and since an option is increasing in vol, the Asian is always cheaper than the otherwise identical European. Convergence is fast: n=12 monthly fixings already gives σ_A ≈ 0.60·σ, within 4% of the continuous limit.</p>
          </>),
        },
        {
          heading: 'Why commodity desks price almost everything as an Asian',
          body: (<>
            <p>Physical commodity contracts settle against a <span className="text-foreground">monthly average</span> of a price assessment (Platts, Argus, the exchange settlement), not a single terminal print. A refinery hedging next month's crude cost, an airline hedging jet fuel, a utility hedging TTF gas: the underlying exposure is the average, so the natural hedge is an Asian and pricing it as a European would systematically overpay.</p>
            <p>Averaging also suppresses settlement manipulation and smooths the delta profile: the hedge ratio decays as fixings drop out of the remaining average, so there is no terminal gamma spike of the kind vanilla options carry into expiry. The antithetic variates used here pair each path with its mirror image, cancelling the odd moments of the estimator and typically halving the standard error for the same path count.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Merton Jump-Diffusion Panel ----

function MertonPanel() {
  const [params, setParams] = useState<MertonRequest>({
    S: 100, K: 100, T: 1.0, r: 0.05, sigma: 0.15,
    lambda: 0.5, muJ: -0.10, sigmaJ: 0.15,
    option_type: 'call', nb_paths: 200000,
  })
  const [result, setResult] = useState<MertonResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <F extends keyof MertonRequest>(k: F) => (v: MertonRequest[F]) =>
    setParams(p => ({ ...p, [k]: v }))

  const submit = useCallback(async () => {
    setLoading(true); setError(null)
    try { setResult(await api.pricing.merton(params)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [params])

  const tooltipStyle = TOOLTIP_STYLE

  const { S, K, T, r, sigma, lambda, muJ, sigmaJ, option_type } = params
  const { rows, kHat } = useMemo(
    () => mertonSeries(S, K, T, r, sigma, lambda, muJ, sigmaJ, option_type),
    [S, K, T, r, sigma, lambda, muJ, sigmaJ, option_type],
  )
  const seriesTotal = rows.length ? rows[rows.length - 1].cumulative : 0
  const jumpPremium = result ? result.analytic - result.bs_ref : null
  // Is the MC price statistically consistent with the analytic series?
  const mcAgrees = result
    ? result.analytic >= result.ci_lo && result.analytic <= result.ci_hi
    : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Merton (1976) Jump-Diffusion</CardTitle>
            <p className="text-sm text-muted-foreground">
              Black-Scholes plus a compound Poisson jump process. Priced analytically as a
              Poisson-weighted sum of Black-Scholes prices, independently verified by Monte Carlo.
              At λ = 0 it collapses exactly to Black-Scholes.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Spot S" value={params.S} onChange={set('S') as (v: number) => void} step={1} min={0.01} />
              <Num label="Strike K" value={params.K} onChange={set('K') as (v: number) => void} step={1} />
              <Num label="Maturity T (yr)" value={params.T} onChange={set('T') as (v: number) => void} step={0.25} min={0.01} />
              <Num label="Rate r" value={params.r} onChange={set('r') as (v: number) => void} step={0.005} />
              <Num label="Diffusion σ" value={params.sigma} onChange={set('sigma') as (v: number) => void} step={0.01} min={0.001} />
              <Num label="λ (jumps/yr)" value={params.lambda} onChange={set('lambda') as (v: number) => void} step={0.1} min={0} />
              <Num label="μ_J (mean log jump)" value={params.muJ} onChange={set('muJ') as (v: number) => void} step={0.02} />
              <Num label="σ_J (log jump vol)" value={params.sigmaJ} onChange={set('sigmaJ') as (v: number) => void} step={0.01} min={0.001} />
              <Num label="MC Paths" value={params.nb_paths}
                onChange={v => setParams(p => ({ ...p, nb_paths: Math.round(v) }))} step={50000} min={10000} />
            </div>
            <TypeToggle value={params.option_type} onChange={set('option_type') as (t: OptionType) => void} />
            <Button onClick={submit} disabled={loading} className="w-full">
              {loading ? 'Pricing...' : 'Price with Jumps'}
            </Button>
            {error && <ErrorMsg msg={error} />}

            {result && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { label: 'Analytic', value: result.analytic, note: 'Poisson series' },
                    { label: 'Monte Carlo', value: result.mc, note: `± ${result.mc_stderr.toFixed(4)}` },
                    { label: 'Black-Scholes', value: result.bs_ref, note: 'No jumps' },
                  ] as { label: string; value: number; note: string }[]).map(({ label, value, note }) => (
                    <div key={label} className="bg-secondary rounded-lg p-3 text-center">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className="text-xl font-mono font-bold">{value.toFixed(4)}</p>
                      <p className="text-xs text-muted-foreground">{note}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jump premium (vs Black-Scholes)</span>
                    <span className="font-mono text-primary">
                      {jumpPremium !== null && `${jumpPremium >= 0 ? '+' : ''}${jumpPremium.toFixed(4)}`}
                      {jumpPremium !== null && result.bs_ref > 0 &&
                        ` (${(100 * jumpPremium / result.bs_ref).toFixed(1)}%)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mean jump size k̂ = E[J−1]</span>
                    <span className="font-mono text-foreground">{result.k_hat.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total vol √(σ² + λ(μ_J² + σ_J²))</span>
                    <span className="font-mono text-foreground">{(result.total_vol * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">95% MC interval</span>
                    <span className="font-mono text-foreground">
                      [{result.ci_lo.toFixed(4)}, {result.ci_hi.toFixed(4)}]
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Analytic inside MC interval</span>
                    <span className={`font-mono ${mcAgrees ? 'text-primary' : 'text-destructive'}`}>
                      {mcAgrees ? 'yes' : 'no'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decomposition of the Poisson Series</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each bar is the contribution of the "exactly n jumps occur" scenario: the Poisson
              probability of n jumps times a Black-Scholes price computed at the jump-adjusted
              drift and variance. The line is the running total.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={rows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="n" stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  label={{ value: 'number of jumps n', position: 'insideBottom', offset: -4,
                    fill: CHART.axisLine, fontSize: 10 }} />
                <YAxis stroke={CHART.axisLine} tick={{ fill: CHART.axisText, fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(1)} />
                <Tooltip {...tooltipStyle}
                  formatter={(v, name) => [typeof v === 'number' ? v.toFixed(6) : v, name]}
                  labelFormatter={(l) => `n = ${l} jumps`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="contribution" name="P(n)·BS(r_n, σ_n)" fill={SERIES.blue} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative price"
                  stroke={SERIES.amber} strokeWidth={2} dot={{ r: 2 }} />
                {result && (
                  <ReferenceLine y={+result.analytic.toFixed(4)} stroke={SERIES.red} strokeDasharray="4 4"
                    label={{ value: 'analytic', position: 'insideTopRight', fill: SERIES.red, fontSize: 10 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="text-sm text-muted-foreground mt-3 space-y-1">
              <p>
                Series truncated at n = {rows.length - 1}, total{' '}
                <span className="font-mono text-foreground">{seriesTotal.toFixed(6)}</span>
                {result && <> vs binary analytic{' '}
                  <span className="font-mono text-foreground">{result.analytic.toFixed(6)}</span></>}.
              </p>
              <p>
                k̂ = <span className="font-mono text-foreground">{kHat.toFixed(6)}</span>. The n=0 term
                is not the Black-Scholes price: its drift carries the compensator −λk̂, so a
                negative mean jump raises the no-jump drift.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <MathAccordion title="Merton jump-diffusion: mathematics" sections={[
        {
          heading: 'The process and its compensator',
          body: (<>
            <p>Merton (1976) adds a compound Poisson jump term to geometric Brownian motion:</p>
            <Eq>dS/S = (r − λ·k̂)·dt + σ·dW + (J − 1)·dq</Eq>
            <p>where <F c="dq" /> is a Poisson counter with intensity λ (expected jumps per year), and each jump multiplies the price by <F c="J ~ LogNormal(μ_J, σ_J²)" />. The expected proportional jump is</p>
            <Eq>k̂ = E[J − 1] = exp(μ_J + σ_J²/2) − 1</Eq>
            <p>The <F c="−λ·k̂" /> term in the drift is the <span className="text-foreground">compensator</span>. Jumps have non-zero expected effect, so without it the discounted price would not be a martingale and the model would admit arbitrage. With negative μ_J (crashes), k̂ {'<'} 0 and the compensator <em>raises</em> the diffusion drift to offset the expected downward jumps.</p>
          </>),
        },
        {
          heading: 'Why a sum of Black-Scholes prices solves it',
          body: (<>
            <p>Condition on the number of jumps. Given exactly n jumps before T, the product of n independent lognormal shocks is itself lognormal, so the terminal price is lognormal again - just with a shifted drift and inflated variance. Each conditional problem is therefore plain Black-Scholes:</p>
            <Eq>σ_n² = σ² + n·σ_J²/T</Eq>
            <Eq>r_n = r − λ·k̂ + n·(μ_J + σ_J²/2)/T</Eq>
            <p>Weighting by the Poisson probability of n jumps and summing gives the exact price:</p>
            <Eq>{'C = Σ_n [e^(−λ\'T)·(λ\'T)^n / n!] · BS(S, K, T, r_n, σ_n),  λ\' = λ·(1 + k̂)'}</Eq>
            <p>The chart above is literally this sum, term by term. Weights decay factorially, so a handful of terms captures essentially all the value - the C++ implementation runs to n=50 but breaks once the weight falls below 1e-15.</p>
          </>),
        },
        {
          heading: 'Smiles, incompleteness, and what this buys over Black-Scholes',
          body: (<>
            <p>Jumps generate an implied volatility <span className="text-foreground">smile</span> that a constant-vol model cannot: the mixture of lognormals is leptokurtic (fat tails) and, with μ_J {'<'} 0, left-skewed. Out-of-the-money puts price above their Black-Scholes value because the crash scenario is explicitly in the distribution. Feed the same parameters to the Vol Surface tab to see the resulting surface.</p>
            <p>The deeper point is <span className="text-foreground">market incompleteness</span>. Under Black-Scholes a continuously rebalanced delta hedge replicates the option exactly. A jump moves the price discontinuously, so no continuous hedge can keep up: jump risk cannot be hedged away with the underlying alone, and the option is genuinely risky to sell. Merton's original derivation assumed jump risk was diversifiable and therefore unpriced, which is why this is a risk-neutral formula despite the incompleteness. In energy markets the jump component is not incidental - supply outages, pipeline failures and geopolitical shocks are exactly the discontinuities this model is built for.</p>
          </>),
        },
      ]} />
    </div>
  )
}

// ---- Page ----

function PricingPage() {
  return (
    <div className="h-full overflow-y-auto bg-background">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Options Pricing</h1>
        <p className="text-muted-foreground">
          C++ pricing library (Black-Scholes, Heston stochastic vol, Longstaff-Schwartz American MC,
          CRR binomial, Bachelier, Merton jumps, spread options, 3:2:1 crack basket) exposed as
          interactive tools. Full Greeks, model-calibrated vol surfaces, and a live crack option
          pricer with EIA auto-calibration.
        </p>
      </div>

      <Tabs defaultValue="bs">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="bs">BS + Greeks</TabsTrigger>
          <TabsTrigger value="crr">CRR Convergence</TabsTrigger>
          <TabsTrigger value="heston">Heston Stoch. Vol</TabsTrigger>
          <TabsTrigger value="merton">Merton Jumps</TabsTrigger>
          <TabsTrigger value="lsm">American LSM</TabsTrigger>
          <TabsTrigger value="digital">Digital</TabsTrigger>
          <TabsTrigger value="asian">Asian</TabsTrigger>
          <TabsTrigger value="spread">Spread Options</TabsTrigger>
          <TabsTrigger value="surface">Vol Surface</TabsTrigger>
          <TabsTrigger value="crack">Crack 3:2:1</TabsTrigger>
        </TabsList>

        <TabsContent value="bs"><BSPricerPanel /></TabsContent>
        <TabsContent value="crr"><CRRPanel /></TabsContent>
        <TabsContent value="heston"><HestonPanel /></TabsContent>
        <TabsContent value="merton"><MertonPanel /></TabsContent>
        <TabsContent value="lsm"><LSMPanel /></TabsContent>
        <TabsContent value="digital"><DigitalPanel /></TabsContent>
        <TabsContent value="asian"><AsianPanel /></TabsContent>
        <TabsContent value="spread"><SpreadPanel /></TabsContent>
        <TabsContent value="surface"><SurfacePanel /></TabsContent>
        <TabsContent value="crack"><CrackPanel /></TabsContent>
      </Tabs>
    </div>
    </div>
  )
}
