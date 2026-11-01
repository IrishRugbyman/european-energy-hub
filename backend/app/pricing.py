"""Interactive option-pricing endpoints (/api/pricing/*).

Thin wrappers around two external programs that live in sibling quant projects:

* the C++ binary ``pricer_api`` (options-pricing-and-simulation), one subprocess per request;
* ``crack-options/cli.py calibrate``, run in that project's own venv, for the live
  3:2:1 crack-spread calibration.

Endpoints are plain ``def`` so FastAPI runs them in its threadpool: a 15 s Monte Carlo never
blocks the event loop. Paths are resolved from the quant root (``QUANT_ROOT`` env override,
else the directory three levels above this file), and read at call time so tests can
monkeypatch them.
"""

from __future__ import annotations

import json
import math
import subprocess
import threading
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .project_paths import quant_project_dir

router = APIRouter(prefix="/api/pricing")

BINARY = quant_project_dir("pricing", "options-pricing-and-simulation") / "build" / "pricer_api"
_CRACK_VENV_PY = quant_project_dir("pricing", "crack-options") / ".venv" / "bin" / "python3"
_CRACK_CLI = quant_project_dir("pricing", "crack-options") / "cli.py"

BINARY_TIMEOUT_S = 15
CALIBRATE_TIMEOUT_S = 30

#: Pricer subprocesses allowed at once. The box has 8 shared vCPUs and one uvicorn
#: process serving the whole hub; a Monte Carlo request can hold a core for 15 s, and the
#: app's slowapi limiter is not wired, so this is the only thing between a public form and
#: a pegged CPU. A request that cannot get a slot within BUSY_WAIT_S gets a 503.
MAX_CONCURRENT_RUNS = 2
BUSY_WAIT_S = 5.0
_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RUNS)


def _run(*args: str) -> dict:
    """Run the C++ pricer with ``args`` and return its JSON object.

    Raises:
        HTTPException: 503 binary missing or not executable, 504 timeout, 400 the binary
            reported an input error, 500 unparseable output.
    """
    if not BINARY.exists():
        raise HTTPException(
            status_code=503,
            detail="Pricing binary not available. Build it: "
            "cd ~/quant/pricing/options-pricing-and-simulation && "
            "g++ -std=c++17 -Isrc src/*.cpp apps/pricer_api.cpp -o build/pricer_api",
        )
    if not _slots.acquire(timeout=BUSY_WAIT_S):
        raise HTTPException(status_code=503, detail="Pricer busy; try again in a few seconds.")
    try:
        result = subprocess.run(
            [str(BINARY), *args],
            capture_output=True,
            text=True,
            timeout=BINARY_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Pricer timed out after {BINARY_TIMEOUT_S} s; reduce the number of paths.",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"Pricing binary not runnable: {exc}") from exc
    finally:
        _slots.release()
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail=result.stderr or result.stdout or "Binary produced no output"
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="Binary returned a non-object payload")
    if "error" in data:
        raise HTTPException(status_code=400, detail=data["error"])
    return data


class PriceRequest(BaseModel):
    """PriceRequest API request/response schema."""

    S: float = Field(95.0, gt=0)
    K: float = Field(100.0, gt=0)
    T: float = Field(0.5, gt=0)
    r: float = Field(0.02)
    sigma: float = Field(0.20, gt=0)
    option_type: Literal["call", "put"] = "call"


class CRRRequest(BaseModel):
    """CRRRequest API request/response schema."""

    S: float = Field(95.0, gt=0)
    K: float = Field(100.0, gt=0)
    T: float = Field(0.5, gt=0)
    r: float = Field(0.02)
    sigma: float = Field(0.20, gt=0)
    option_type: Literal["call", "put"] = "call"


class SpreadRequest(BaseModel):
    """SpreadRequest API request/response schema."""

    S1: float = Field(110.0, gt=0)
    S2: float = Field(100.0, gt=0)
    K: float = Field(5.0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.03)
    sig1: float = Field(0.25, gt=0)
    sig2: float = Field(0.30, gt=0)
    rho: float = Field(0.80, ge=-1, le=1)


class SurfaceRequest(BaseModel):
    """Parametric vol surface (ATM + skew + convexity)."""

    sigma_atm: float = Field(0.20, gt=0)
    skew: float = Field(-0.05)
    convexity: float = Field(0.10, ge=0)


class HestonSurfaceRequest(BaseModel):
    """Heston-model calibrated implied vol surface."""

    S: float = Field(100.0, gt=0)
    r: float = Field(0.02)
    v0: float = Field(0.04, gt=0)
    kappa: float = Field(2.0, gt=0)
    theta: float = Field(0.04, gt=0)
    xi: float = Field(0.5, ge=0)
    rho_sv: float = Field(-0.7, ge=-1.0, le=1.0)


class MertonSurfaceRequest(BaseModel):
    """Merton jump-diffusion implied vol surface."""

    S: float = Field(100.0, gt=0)
    r: float = Field(0.02)
    sigma: float = Field(0.15, gt=0)
    lambda_: float = Field(0.5, ge=0, alias="lambda")
    muJ: float = Field(-0.10)
    sigmaJ: float = Field(0.15, gt=0)

    model_config = {"populate_by_name": True}


class HestonRequest(BaseModel):
    """Heston stochastic-vol MC pricer."""

    S: float = Field(100.0, gt=0)
    K: float = Field(100.0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.02)
    v0: float = Field(0.04, gt=0)
    kappa: float = Field(2.0, gt=0)
    theta: float = Field(0.04, gt=0)
    xi: float = Field(0.5, ge=0)
    rho_sv: float = Field(-0.7, ge=-1.0, le=1.0)
    option_type: Literal["call", "put"] = "call"
    nb_paths: int = Field(100000, gt=0, le=500000)
    nb_steps: int = Field(252, gt=0, le=1000)


class LSMRequest(BaseModel):
    """Longstaff-Schwartz American MC pricer."""

    S: float = Field(100.0, gt=0)
    K: float = Field(100.0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.02)
    sigma: float = Field(0.20, gt=0)
    option_type: Literal["call", "put"] = "put"
    nb_paths: int = Field(50000, gt=0, le=500000)
    nb_steps: int = Field(50, gt=0, le=500)


class DigitalRequest(BaseModel):
    """Cash-or-nothing digital (binary) option, Black-Scholes closed form."""

    S: float = Field(100.0, gt=0)
    K: float = Field(100.0, gt=0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.05)
    sigma: float = Field(0.20, gt=0)


class AsianRequest(BaseModel):
    """Arithmetic-average Asian option, MC with antithetic variates."""

    S: float = Field(100.0, gt=0)
    K: float = Field(100.0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.05)
    sigma: float = Field(0.20, gt=0)
    option_type: Literal["call", "put"] = "call"
    n_fixings: int = Field(12, gt=0, le=1000)
    nb_paths: int = Field(100000, gt=0, le=500000)


class MertonRequest(BaseModel):
    """Merton (1976) jump-diffusion European pricer."""

    S: float = Field(100.0, gt=0)
    K: float = Field(100.0)
    T: float = Field(1.0, gt=0)
    r: float = Field(0.05)
    sigma: float = Field(0.15, gt=0)
    lambda_: float = Field(0.5, ge=0, alias="lambda")
    muJ: float = Field(-0.10)
    sigmaJ: float = Field(0.15, gt=0)
    option_type: Literal["call", "put"] = "call"
    nb_paths: int = Field(200000, gt=0, le=500000)

    model_config = {"populate_by_name": True}


@router.post("/price")
def price(req: PriceRequest):
    """Price a European option using Black-Scholes."""
    return _run(
        "bs", str(req.S), str(req.K), str(req.T), str(req.r), str(req.sigma), req.option_type
    )


@router.post("/crr")
def crr(req: CRRRequest):
    """Price an American option using the CRR binomial tree."""
    return _run(
        "crr", str(req.S), str(req.K), str(req.T), str(req.r), str(req.sigma), req.option_type
    )


@router.post("/spread")
def spread(req: SpreadRequest):
    """Price a European spread option using Kirk/Margrabe approximation."""
    return _run(
        "spread",
        str(req.S1),
        str(req.S2),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.sig1),
        str(req.sig2),
        str(req.rho),
    )


@router.post("/surface")
def surface(req: SurfaceRequest):
    """Parametric implied vol surface (ATM + skew + convexity)."""
    return _run("surface", "param", str(req.sigma_atm), str(req.skew), str(req.convexity))


@router.post("/surface/heston")
def surface_heston(req: HestonSurfaceRequest):
    """Heston-model calibrated implied vol surface (MC + IV inversion, 45 nodes)."""
    return _run(
        "surface",
        "heston",
        str(req.S),
        str(req.r),
        str(req.v0),
        str(req.kappa),
        str(req.theta),
        str(req.xi),
        str(req.rho_sv),
    )


@router.post("/surface/merton")
def surface_merton(req: MertonSurfaceRequest):
    """Merton jump-diffusion implied vol surface (analytic, 45 nodes)."""
    return _run(
        "surface",
        "merton",
        str(req.S),
        str(req.r),
        str(req.sigma),
        str(req.lambda_),
        str(req.muJ),
        str(req.sigmaJ),
    )


@router.post("/heston")
def heston(req: HestonRequest):
    """Price a European option under the Heston stochastic-vol model (MC)."""
    return _run(
        "heston",
        str(req.S),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.v0),
        str(req.kappa),
        str(req.theta),
        str(req.xi),
        str(req.rho_sv),
        req.option_type,
        str(req.nb_paths),
        str(req.nb_steps),
    )


@router.post("/lsm")
def lsm(req: LSMRequest):
    """Price an American option via Longstaff-Schwartz LSM Monte Carlo."""
    return _run(
        "lsm",
        str(req.S),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.sigma),
        req.option_type,
        str(req.nb_paths),
        str(req.nb_steps),
    )


def digital_greeks(S: float, K: float, T: float, r: float, sigma: float) -> dict[str, float]:
    """Black-Scholes Greeks of cash-or-nothing digitals paying 1, no dividend.

    The C++ binary returns the vanilla option's Greeks for these fields (its gamma equals
    its delta at S=K, its vega is the vanilla S*phi(d1)*sqrt(T)), so they are recomputed
    here; its prices are right and kept. Units match the vanilla pricer: vega per unit of
    sigma, theta per year (dV/dt = -dV/dT).

    With D = exp(-rT), d2 = (ln(S/K) + (r - sigma^2/2)T) / (sigma sqrt T), d1 = d2 + sigma sqrt T:
    C = D N(d2), P = D N(-d2); dC/dS = D phi(d2) / (S sigma sqrt T);
    d2C/dS2 = -D phi(d2) d1 / (S^2 sigma^2 T); dC/dsigma = -D phi(d2) d1 / sigma;
    dC/dT = -r C + D phi(d2) dd2/dT with dd2/dT = -ln(S/K) / (2 sigma T^1.5) + (r - sigma^2/2) / (2 sigma sqrt T).
    The put's Greeks follow from P = D - C.
    """
    sq = math.sqrt(T)
    d2 = (math.log(S / K) + (r - 0.5 * sigma**2) * T) / (sigma * sq)
    d1 = d2 + sigma * sq
    disc = math.exp(-r * T)
    pdf = math.exp(-0.5 * d2 * d2) / math.sqrt(2 * math.pi)
    cdf = 0.5 * (1 + math.erf(d2 / math.sqrt(2)))
    call = disc * cdf
    delta = disc * pdf / (S * sigma * sq)
    gamma = -disc * pdf * d1 / (S**2 * sigma**2 * T)
    vega = -disc * pdf * d1 / sigma
    dd2_dT = -math.log(S / K) / (2 * sigma * T**1.5) + (r - 0.5 * sigma**2) / (2 * sigma * sq)
    dC_dT = -r * call + disc * pdf * dd2_dT
    dP_dT = -r * disc - dC_dT  # P = D - C, dD/dT = -r D
    return {
        "call_delta": delta,
        "call_gamma": gamma,
        "call_vega": vega,
        "call_theta": -dC_dT,
        "put_delta": -delta,
        "put_gamma": -gamma,
        "put_vega": -vega,
        "put_theta": -dP_dT,
    }


@router.post("/digital")
def digital(req: DigitalRequest):
    """Price cash-or-nothing digital call and put options (Black-Scholes closed form)."""
    out = _run("digital", str(req.S), str(req.K), str(req.T), str(req.r), str(req.sigma))
    out.update(digital_greeks(req.S, req.K, req.T, req.r, req.sigma))
    return out


@router.post("/asian")
def asian(req: AsianRequest):
    """Price an arithmetic-average Asian option via MC with antithetic variates."""
    return _run(
        "asian",
        str(req.S),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.sigma),
        req.option_type,
        str(req.n_fixings),
        str(req.nb_paths),
    )


@router.post("/merton")
def merton(req: MertonRequest):
    """Price a European option under the Merton (1976) jump-diffusion model."""
    return _run(
        "merton",
        str(req.S),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.sigma),
        str(req.lambda_),
        str(req.muJ),
        str(req.sigmaJ),
        req.option_type,
        str(req.nb_paths),
    )


# ---- crack command ----


class CrackRequest(BaseModel):
    """CrackRequest API request/response schema."""

    S_WTI: float = Field(70.0, gt=0, description="WTI spot $/bbl")
    S_RBOB: float = Field(2.50, gt=0, description="RBOB spot $/gal")
    S_HO: float = Field(2.60, gt=0, description="HO spot $/gal")
    K: float = Field(15.0, description="Strike on crack $/bbl")
    T: float = Field(1.0, gt=0, description="Time to expiry (years)")
    r: float = Field(0.03, description="Risk-free rate")
    sig_WTI: float = Field(0.25, gt=0, description="WTI lognormal vol")
    sig_RBOB: float = Field(0.30, gt=0, description="RBOB lognormal vol")
    sig_HO: float = Field(0.28, gt=0, description="HO lognormal vol")
    rho_WR: float = Field(0.75, ge=-1, le=1, description="WTI/RBOB correlation")
    rho_WH: float = Field(0.65, ge=-1, le=1, description="WTI/HO correlation")
    rho_RH: float = Field(0.85, ge=-1, le=1, description="RBOB/HO correlation")
    nb_paths: int = Field(100000, gt=0, le=1000000, description="MC paths")

    # Optional: if calibrate=True, ignore spot/vol/corr fields and pull from duckdb.
    calibrate: bool = Field(False, description="Auto-calibrate from EIA data")
    calib_window: int = Field(252, gt=10, description="Calibration window (trading days)")


def _calibrate_crack(window: int = 252) -> dict:
    """Shell out to crack-options cli.py calibrate to get JSON params."""
    if not _CRACK_CLI.exists():
        raise HTTPException(status_code=503, detail="crack-options calibration is not available")
    py = str(_CRACK_VENV_PY) if _CRACK_VENV_PY.exists() else "python3"
    if not _slots.acquire(timeout=BUSY_WAIT_S):
        raise HTTPException(status_code=503, detail="Pricer busy; try again in a few seconds.")
    try:
        result = subprocess.run(
            [py, str(_CRACK_CLI), "calibrate", "--window", str(window)],
            capture_output=True,
            text=True,
            timeout=CALIBRATE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=504, detail=f"Calibration timed out after {CALIBRATE_TIMEOUT_S} s"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"Calibration not runnable: {exc}") from exc
    finally:
        _slots.release()
    if result.returncode != 0:
        raise HTTPException(
            status_code=500, detail=f"Calibration failed: {result.stderr or result.stdout}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Calibration JSON parse error: {exc}") from exc


@router.get("/crack/calibrate")
def crack_calibrate(window: int = Query(252, gt=10, le=5000)):
    """Return live-calibrated inputs from EIA data."""
    return _calibrate_crack(window)


@router.post("/crack")
def crack(req: CrackRequest):
    """Price a European call on the 3:2:1 crack spread."""
    if req.calibrate:
        calib = _calibrate_crack(req.calib_window)
        return _run(
            "crack",
            str(calib["S_WTI"]),
            str(calib["S_RBOB"]),
            str(calib["S_HO"]),
            str(req.K),
            str(req.T),
            str(req.r),
            str(calib["sig_WTI"]),
            str(calib["sig_RBOB"]),
            str(calib["sig_HO"]),
            str(calib["rho_WR"]),
            str(calib["rho_WH"]),
            str(calib["rho_RH"]),
            str(req.nb_paths),
        ) | {"as_of": calib.get("as_of"), "crack_spot_calib": calib.get("crack_spot")}
    return _run(
        "crack",
        str(req.S_WTI),
        str(req.S_RBOB),
        str(req.S_HO),
        str(req.K),
        str(req.T),
        str(req.r),
        str(req.sig_WTI),
        str(req.sig_RBOB),
        str(req.sig_HO),
        str(req.rho_WR),
        str(req.rho_WH),
        str(req.rho_RH),
        str(req.nb_paths),
    )
