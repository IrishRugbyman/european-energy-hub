"""Tests for the /api/pricing router.

Validation and failure paths run everywhere. Value checks run the real C++ binary and compare
against closed forms computed here (Black-Scholes, Margrabe, Kirk, digital), so they are
skipped when the binary has not been built.
"""

from __future__ import annotations

import math
import subprocess

import pytest
from app import pricing

BINARY_PRESENT = pricing.BINARY.exists()
needs_binary = pytest.mark.skipif(not BINARY_PRESENT, reason="pricer_api binary not built")


def _n(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _phi(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bs(s, k, t, r, sig, kind):
    d1 = (math.log(s / k) + (r + 0.5 * sig**2) * t) / (sig * math.sqrt(t))
    d2 = d1 - sig * math.sqrt(t)
    disc = math.exp(-r * t)
    if kind == "call":
        return s * _n(d1) - k * disc * _n(d2)
    return k * disc * _n(-d2) - s * _n(-d1)


def _d1d2(s, k, t, r, sig):
    d1 = (math.log(s / k) + (r + 0.5 * sig**2) * t) / (sig * math.sqrt(t))
    return d1, d1 - sig * math.sqrt(t)


# ---------------------------------------------------------------- validation (no binary needed)

BAD_BODIES = [
    ("/api/pricing/price", {"T": 0}),
    ("/api/pricing/price", {"sigma": -0.1}),
    ("/api/pricing/price", {"S": -5}),
    ("/api/pricing/price", {"K": 0}),
    ("/api/pricing/price", {"option_type": "straddle"}),
    ("/api/pricing/price", {"S": "abc"}),
    ("/api/pricing/crr", {"T": -1}),
    ("/api/pricing/spread", {"rho": 1.5}),
    ("/api/pricing/spread", {"S1": 0}),
    ("/api/pricing/spread", {"sig2": 0}),
    ("/api/pricing/surface", {"sigma_atm": 0}),
    ("/api/pricing/surface", {"convexity": -1}),
    ("/api/pricing/surface/heston", {"rho_sv": -1.2}),
    ("/api/pricing/surface/merton", {"lambda": -1}),
    ("/api/pricing/heston", {"nb_paths": 500001}),
    ("/api/pricing/heston", {"nb_steps": 0}),
    ("/api/pricing/lsm", {"nb_steps": 501}),
    ("/api/pricing/digital", {"K": 0}),
    ("/api/pricing/asian", {"n_fixings": 0}),
    ("/api/pricing/merton", {"nb_paths": 0}),
    ("/api/pricing/crack", {"rho_WR": 2}),
    ("/api/pricing/crack", {"nb_paths": 1000001}),
    ("/api/pricing/crack", {"calib_window": 5}),
]


@pytest.mark.parametrize(("path", "body"), BAD_BODIES)
def test_pricing_bad_input_returns_422(client, path, body):
    assert client.post(path, json=body).status_code == 422


def test_pricing_post_endpoint_rejects_get_with_405(client):
    assert client.get("/api/pricing/price").status_code == 405


@pytest.mark.parametrize("window", [5, 10, 5001])
def test_pricing_crack_calibrate_bad_window_returns_422(client, window):
    assert client.get("/api/pricing/crack/calibrate", params={"window": window}).status_code == 422


# ---------------------------------------------------------------- failure paths


def test_pricing_binary_missing_returns_503(client, monkeypatch, tmp_path):
    monkeypatch.setattr(pricing, "BINARY", tmp_path / "does_not_exist")
    r = client.post("/api/pricing/price", json={})
    assert r.status_code == 503
    assert "not available" in r.json()["detail"]


def test_pricing_binary_not_executable_returns_503(client, monkeypatch, tmp_path):
    fake = tmp_path / "pricer_api"
    fake.write_text("#!/nonexistent/interpreter\n")
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    assert client.post("/api/pricing/price", json={}).status_code == 503


def test_pricing_timeout_returns_504(client, monkeypatch, tmp_path):
    fake = tmp_path / "pricer_api"
    fake.write_text("#!/bin/sh\nsleep 5\n")
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    monkeypatch.setattr(pricing, "BINARY_TIMEOUT_S", 0.2)
    r = client.post("/api/pricing/heston", json={})
    assert r.status_code == 504
    assert "timed out" in r.json()["detail"]


def test_pricing_binary_error_json_returns_400(client, monkeypatch, tmp_path):
    fake = tmp_path / "pricer_api"
    fake.write_text('#!/bin/sh\necho \'{"error":"bad thing"}\'\n')
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    r = client.post("/api/pricing/price", json={})
    assert r.status_code == 400
    assert r.json()["detail"] == "bad thing"


def test_pricing_binary_garbage_output_returns_500(client, monkeypatch, tmp_path):
    fake = tmp_path / "pricer_api"
    fake.write_text("#!/bin/sh\necho 'not json'\n")
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    assert client.post("/api/pricing/price", json={}).status_code == 500


def test_pricing_binary_non_object_json_returns_500(client, monkeypatch, tmp_path):
    fake = tmp_path / "pricer_api"
    fake.write_text("#!/bin/sh\necho '[1,2]'\n")
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    assert client.post("/api/pricing/price", json={}).status_code == 500


def test_pricing_arguments_reach_binary_in_order(client, monkeypatch, tmp_path):
    """The fake binary echoes its argv, proving the positional contract with pricer_api."""
    fake = tmp_path / "pricer_api"
    fake.write_text('#!/bin/sh\nprintf \'{"argv":"%s"}\' "$*"\n')
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    body = {"S": 90, "K": 95, "T": 0.25, "r": 0.01, "sigma": 0.3, "option_type": "put"}
    assert (
        client.post("/api/pricing/price", json=body).json()["argv"]
        == "bs 90.0 95.0 0.25 0.01 0.3 put"
    )
    merton = {"lambda": 0.7, "nb_paths": 1000}
    argv = client.post("/api/pricing/merton", json=merton).json()["argv"].split()
    assert argv[0] == "merton" and argv[6] == "0.7" and argv[-1] == "1000"


def test_pricing_crack_calibrate_failure_returns_500(client, monkeypatch, tmp_path):
    cli = tmp_path / "cli.py"
    cli.write_text("import sys; sys.stderr.write('boom'); sys.exit(2)\n")
    monkeypatch.setattr(pricing, "_CRACK_CLI", cli)
    monkeypatch.setattr(pricing, "_CRACK_VENV_PY", tmp_path / "nopython")
    r = client.get("/api/pricing/crack/calibrate")
    assert r.status_code == 500
    assert "boom" in r.json()["detail"]


def test_pricing_crack_calibrate_timeout_returns_504(client, monkeypatch, tmp_path):
    cli = tmp_path / "cli.py"
    cli.write_text("import time; time.sleep(5)\n")
    monkeypatch.setattr(pricing, "_CRACK_CLI", cli)
    monkeypatch.setattr(pricing, "_CRACK_VENV_PY", tmp_path / "nopython")
    monkeypatch.setattr(pricing, "CALIBRATE_TIMEOUT_S", 0.3)
    assert client.get("/api/pricing/crack/calibrate").status_code == 504


def test_pricing_crack_calibrate_missing_cli_returns_503(client, monkeypatch, tmp_path):
    monkeypatch.setattr(pricing, "_CRACK_CLI", tmp_path / "absent.py")
    assert client.get("/api/pricing/crack/calibrate").status_code == 503


def test_pricing_crack_with_calibrate_uses_calibrated_inputs(client, monkeypatch, tmp_path):
    calib = {
        "as_of": "2026-01-02", "crack_spot": 36.4, "S_WTI": 61.0, "S_RBOB": 1.9, "S_HO": 2.2,
        "sig_WTI": 0.3, "sig_RBOB": 0.35, "sig_HO": 0.33,
        "rho_WR": 0.7, "rho_WH": 0.6, "rho_RH": 0.8,
    }  # fmt: skip
    monkeypatch.setattr(pricing, "_calibrate_crack", lambda window=252: calib)
    fake = tmp_path / "pricer_api"
    fake.write_text('#!/bin/sh\nprintf \'{"argv":"%s"}\' "$*"\n')
    fake.chmod(0o755)
    monkeypatch.setattr(pricing, "BINARY", fake)
    out = client.post("/api/pricing/crack", json={"calibrate": True, "K": 12}).json()
    assert out["argv"].startswith("crack 61.0 1.9 2.2 12.0 ")
    assert out["as_of"] == "2026-01-02"
    assert out["crack_spot_calib"] == 36.4


def test_pricing_subprocess_uses_timeout_kwarg(monkeypatch, tmp_path):
    seen = {}

    def fake_run(cmd, **kw):
        seen.update(kw)
        return subprocess.CompletedProcess(cmd, 0, stdout='{"ok":1}', stderr="")

    fake = tmp_path / "pricer_api"
    fake.write_text("")
    monkeypatch.setattr(pricing, "BINARY", fake)
    monkeypatch.setattr(pricing.subprocess, "run", fake_run)
    assert pricing._run("bs") == {"ok": 1}
    assert seen["timeout"] == pricing.BINARY_TIMEOUT_S


# ---------------------------------------------------------------- values vs closed forms


@needs_binary
@pytest.mark.parametrize("kind", ["call", "put"])
def test_pricing_price_matches_black_scholes_closed_form(client, kind):
    s, k, t, r, sig = 95.0, 100.0, 0.5, 0.02, 0.20
    out = client.post(
        "/api/pricing/price",
        json={"S": s, "K": k, "T": t, "r": r, "sigma": sig, "option_type": kind},
    ).json()
    d1, d2 = _d1d2(s, k, t, r, sig)
    disc = math.exp(-r * t)
    sign = 1 if kind == "call" else -1
    assert out["price"] == pytest.approx(_bs(s, k, t, r, sig, kind), abs=1e-5)
    assert out["delta"] == pytest.approx(_n(d1) if kind == "call" else _n(d1) - 1, abs=1e-5)
    assert out["gamma"] == pytest.approx(_phi(d1) / (s * sig * math.sqrt(t)), abs=1e-5)
    assert out["vega"] == pytest.approx(s * _phi(d1) * math.sqrt(t), abs=1e-4)
    assert out["rho"] == pytest.approx(sign * k * t * disc * _n(sign * d2), abs=1e-4)
    theta = -s * _phi(d1) * sig / (2 * math.sqrt(t)) - sign * r * k * disc * _n(sign * d2)
    assert out["theta"] == pytest.approx(theta, abs=1e-4)


@needs_binary
def test_pricing_price_put_call_parity(client):
    s, k, t, r, sig = 120.0, 100.0, 0.75, 0.03, 0.35
    base = {"S": s, "K": k, "T": t, "r": r, "sigma": sig}
    c = client.post("/api/pricing/price", json={**base, "option_type": "call"}).json()["price"]
    p = client.post("/api/pricing/price", json={**base, "option_type": "put"}).json()["price"]
    assert c - p == pytest.approx(s - k * math.exp(-r * t), abs=1e-5)


@needs_binary
def test_pricing_spread_zero_strike_equals_margrabe_closed_form(client):
    s1, s2, t, r, v1, v2, rho = 110.0, 100.0, 1.0, 0.03, 0.25, 0.30, 0.80
    out = client.post(
        "/api/pricing/spread",
        json={"S1": s1, "S2": s2, "K": 0, "T": t, "r": r, "sig1": v1, "sig2": v2, "rho": rho},
    ).json()
    v = math.sqrt(v1**2 + v2**2 - 2 * rho * v1 * v2)
    d1 = (math.log(s1 / s2) + 0.5 * v * v * t) / (v * math.sqrt(t))
    margrabe = s1 * _n(d1) - s2 * _n(d1 - v * math.sqrt(t))
    assert out["margrabe"] == pytest.approx(margrabe, abs=1e-3)
    assert out["kirk"] == pytest.approx(margrabe, abs=1e-3)
    assert out["mc"] == pytest.approx(margrabe, rel=0.03)


@needs_binary
def test_pricing_spread_kirk_matches_closed_form(client):
    s1, s2, k, t, r, v1, v2, rho = 110.0, 100.0, 5.0, 1.0, 0.03, 0.25, 0.30, 0.80
    out = client.post(
        "/api/pricing/spread",
        json={"S1": s1, "S2": s2, "K": k, "T": t, "r": r, "sig1": v1, "sig2": v2, "rho": rho},
    ).json()
    f1, f2 = s1 * math.exp(r * t), s2 * math.exp(r * t)
    w = f2 / (f2 + k)
    vk = math.sqrt(v1**2 - 2 * rho * v1 * v2 * w + (v2 * w) ** 2)
    d1 = (math.log(f1 / (f2 + k)) + 0.5 * vk * vk * t) / (vk * math.sqrt(t))
    kirk = math.exp(-r * t) * (f1 * _n(d1) - (f2 + k) * _n(d1 - vk * math.sqrt(t)))
    assert out["kirk"] == pytest.approx(kirk, abs=1e-3)
    assert out["mc"] == pytest.approx(kirk, rel=0.03)


@needs_binary
def test_pricing_digital_matches_closed_form_and_parity(client):
    s, k, t, r, sig = 100.0, 110.0, 1.0, 0.05, 0.20
    out = client.post(
        "/api/pricing/digital", json={"S": s, "K": k, "T": t, "r": r, "sigma": sig}
    ).json()
    d1, d2 = _d1d2(s, k, t, r, sig)
    disc = math.exp(-r * t)
    assert out["call_price"] == pytest.approx(disc * _n(d2), abs=1e-5)
    assert out["put_price"] == pytest.approx(disc * _n(-d2), abs=1e-5)
    assert out["call_price"] + out["put_price"] == pytest.approx(disc, abs=1e-5)
    assert out["call_delta"] == pytest.approx(disc * _phi(d2) / (s * sig * math.sqrt(t)), abs=1e-5)


@needs_binary
def test_pricing_crr_reference_and_convergence(client):
    s, k, t, r, sig = 95.0, 100.0, 0.5, 0.02, 0.20
    out = client.post(
        "/api/pricing/crr",
        json={"S": s, "K": k, "T": t, "r": r, "sigma": sig, "option_type": "call"},
    ).json()
    bs = _bs(s, k, t, r, sig, "call")
    assert out["bs_price"] == pytest.approx(bs, abs=1e-5)
    # No dividends: an American call is worth its European value; the tree must approach it.
    assert out["steps"][-1]["price"] == pytest.approx(bs, abs=0.02)
    assert out["steps"][0]["price"] > out["steps"][4]["price"] - 0.2


@needs_binary
def test_pricing_merton_without_jumps_collapses_to_black_scholes(client):
    out = client.post(
        "/api/pricing/merton",
        json={"S": 100, "K": 100, "T": 1.0, "r": 0.05, "sigma": 0.15, "lambda": 0.0,
              "nb_paths": 50000},
    ).json()  # fmt: skip
    bs = _bs(100.0, 100.0, 1.0, 0.05, 0.15, "call")
    assert out["analytic"] == pytest.approx(bs, abs=1e-4)
    assert out["mc"] == pytest.approx(bs, abs=4 * out["mc_stderr"])


@needs_binary
def test_pricing_heston_without_vol_of_vol_collapses_to_black_scholes(client):
    out = client.post(
        "/api/pricing/heston",
        json={"S": 100, "K": 100, "T": 1.0, "r": 0.02, "v0": 0.04, "kappa": 2.0,
              "theta": 0.04, "xi": 0.0, "rho_sv": -0.7, "nb_paths": 50000, "nb_steps": 100},
    ).json()  # fmt: skip
    bs = _bs(100.0, 100.0, 1.0, 0.02, 0.2, "call")  # sqrt(0.04) = 0.2
    assert out["bs_ref"] == pytest.approx(bs, abs=1e-4)
    half_width = (out["ci_hi"] - out["ci_lo"]) / 2
    assert out["price"] == pytest.approx(bs, abs=2 * half_width)


@needs_binary
def test_pricing_lsm_brackets_european_put_and_matches_tree(client):
    s, k, t, r, sig = 100.0, 100.0, 1.0, 0.02, 0.20
    out = client.post(
        "/api/pricing/lsm",
        json={"S": s, "K": k, "T": t, "r": r, "sigma": sig, "option_type": "put",
              "nb_paths": 50000, "nb_steps": 50},
    ).json()  # fmt: skip
    eu = _bs(s, k, t, r, sig, "put")
    assert out["eu_price"] == pytest.approx(eu, rel=0.03)
    assert out["lsm_price"] > eu  # early-exercise premium is positive for this put
    assert out["lsm_price"] == pytest.approx(out["crr_price"], rel=0.03)


@needs_binary
def test_pricing_asian_is_below_vanilla_and_vanilla_matches_closed_form(client):
    s, k, t, r, sig = 100.0, 100.0, 1.0, 0.05, 0.20
    out = client.post(
        "/api/pricing/asian",
        json={"S": s, "K": k, "T": t, "r": r, "sigma": sig, "option_type": "call",
              "n_fixings": 12, "nb_paths": 50000},
    ).json()  # fmt: skip
    assert out["eu_price"] == pytest.approx(_bs(s, k, t, r, sig, "call"), rel=0.03)
    assert 0 < out["asian_price"] < out["eu_price"]
    assert out["ratio"] == pytest.approx(out["asian_price"] / out["eu_price"], abs=1e-3)


@needs_binary
def test_pricing_surface_param_atm_equals_input_vol(client):
    out = client.post(
        "/api/pricing/surface", json={"sigma_atm": 0.25, "skew": -0.05, "convexity": 0.1}
    ).json()
    assert len(out["grid"]) == 45
    atm = [n["vol"] for n in out["grid"] if n["k_rel"] == pytest.approx(1.0)]
    assert atm and all(v == pytest.approx(0.25, abs=1e-3) for v in atm)


@needs_binary
def test_pricing_surface_merton_and_heston_return_full_grid(client):
    m = client.post("/api/pricing/surface/merton", json={}).json()
    h = client.post("/api/pricing/surface/heston", json={}).json()
    for out in (m, h):
        assert len(out["grid"]) == 45
        assert all(0 < n["vol"] < 2 for n in out["grid"])


@needs_binary
def test_pricing_crack_manual_inputs_price_is_consistent(client):
    out = client.post("/api/pricing/crack", json={"nb_paths": 50000}).json()
    # 3:2:1 crack = (2 * RBOB + HO) * 42 / 3 - WTI at the default spots (2.50, 2.60, 70)
    assert out["crack_spot"] == pytest.approx((2 * 2.50 * 42 + 2.60 * 42) / 3 - 70.0, abs=1e-3)
    assert out["mc"] == pytest.approx(out["kirk"], rel=0.1)
    assert out["mc"] >= 0


# ---- digital Greeks: closed forms checked against the binary's own prices ---------------
# The oracle is a central finite difference of the C++ pricer's digital PRICE (correct, and
# independent of `digital_greeks`). The binary prints 6 decimals, so the steps are chosen
# for rounding error well under the tolerances. Two points, neither where a Greek is zero
# by construction (d1 = 0 would zero gamma and vega).

_DIGITAL_POINTS = [(100.0, 100.0, 1.0, 0.05, 0.20), (110.0, 100.0, 0.5, 0.03, 0.25)]


def _digital_prices(S, K, T, r, sigma):
    out = pricing._run("digital", str(S), str(K), str(T), str(r), str(sigma))
    return out["call_price"], out["put_price"]


@pytest.mark.skipif(not pricing.BINARY.exists(), reason="pricer binary not built")
@pytest.mark.parametrize("point", _DIGITAL_POINTS)
@pytest.mark.parametrize("leg", [0, 1], ids=["call", "put"])
def test_digital_greeks_match_finite_differences_of_the_binary_price(point, leg):
    S, K, T, r, sigma = point
    name = "call" if leg == 0 else "put"
    g = pricing.digital_greeks(S, K, T, r, sigma)

    def price(**kw):
        p = {"S": S, "K": K, "T": T, "r": r, "sigma": sigma} | kw
        return _digital_prices(p["S"], p["K"], p["T"], p["r"], p["sigma"])[leg]

    hs, hv, ht = 1.0, 0.01, 0.01
    v0 = price()
    fd_delta = (price(S=S + hs) - price(S=S - hs)) / (2 * hs)
    fd_gamma = (price(S=S + hs) - 2 * v0 + price(S=S - hs)) / hs**2
    fd_vega = (price(sigma=sigma + hv) - price(sigma=sigma - hv)) / (2 * hv)
    fd_theta = -(price(T=T + ht) - price(T=T - ht)) / (2 * ht)
    assert g[f"{name}_delta"] == pytest.approx(fd_delta, abs=2e-5)
    assert g[f"{name}_gamma"] == pytest.approx(fd_gamma, abs=2e-5)
    assert g[f"{name}_vega"] == pytest.approx(fd_vega, abs=2e-3)
    assert g[f"{name}_theta"] == pytest.approx(fd_theta, abs=2e-3)


def test_digital_greeks_put_call_relations():
    g = pricing.digital_greeks(95.0, 100.0, 0.75, 0.04, 0.3)
    disc = math.exp(-0.04 * 0.75)
    assert g["put_delta"] == -g["call_delta"]
    assert g["put_gamma"] == -g["call_gamma"]
    assert g["put_vega"] == -g["call_vega"]
    # P = D - C, so theta_P = -dP/dT = r D + dC/dT = r D - theta_C
    assert g["put_theta"] == pytest.approx(0.04 * disc - g["call_theta"], abs=1e-12)


# ---- the concurrency cap ----------------------------------------------------------------


def test_pricer_returns_503_when_every_slot_is_taken(monkeypatch):
    monkeypatch.setattr(pricing, "BUSY_WAIT_S", 0.01)
    taken = 0
    try:
        while pricing._slots.acquire(blocking=False):
            taken += 1
        assert taken == pricing.MAX_CONCURRENT_RUNS
        if not pricing.BINARY.exists():
            pytest.skip("pricer binary not built")
        with pytest.raises(pricing.HTTPException) as info:
            pricing._run("digital", "100", "100", "1", "0.05", "0.2")
        assert info.value.status_code == 503
    finally:
        for _ in range(taken):
            pricing._slots.release()
    assert pricing._run("digital", "100", "100", "1", "0.05", "0.2")["call_price"] > 0
