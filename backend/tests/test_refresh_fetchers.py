"""Guards on refresh.py's INGEST_FETCHERS list.

This list is a set of bare strings passed to a subprocess, so a name that does not
correspond to a working `ingest.py` command fails only at runtime, as a WARNING line
buried in the journal, while the affected dashboard silently goes stale.

That is exactly what happened twice:
  - `smard-imbalance-de` stayed in the list after being disabled, so every refresh
    raised and /imbalance froze for 11 days.
  - `entso-e-hydro` was never added, so the hydro tables froze for 7 weeks while the
    UI presented mid-June reservoir levels as current.

These tests turn both failure modes into a red test instead of a log line.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from refresh import DEFAULT_INGEST_TIMEOUT, INGEST_FETCHERS, INGEST_TIMEOUTS  # noqa: E402

MARKET_DATA_DIR = Path(__file__).resolve().parents[3] / "shared" / "market-data"
MARKET_DATA_VENV = MARKET_DATA_DIR / ".venv" / "bin" / "python"

# Fetchers that exist as CLI commands but must never be called: they raise on invocation.
DISABLED_FETCHERS = {"smard-imbalance-de"}


def _cli_commands() -> set[str]:
    """Return the command names `ingest.py --help` advertises."""
    result = subprocess.run(
        [str(MARKET_DATA_VENV), "ingest.py", "--help"],
        cwd=str(MARKET_DATA_DIR),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"ingest.py --help failed: {result.stderr[:500]}"
    # Click lists commands as two-space-indented "  name  description".
    return set(re.findall(r"^\s{2}([a-z0-9][a-z0-9-]*)\s{2,}", result.stdout, re.MULTILINE))


needs_market_data = pytest.mark.skipif(
    not MARKET_DATA_VENV.exists(),
    reason="market-data venv not present; CLI name check needs the sibling repo",
)


def test_ingest_fetchers_has_no_duplicates():
    assert len(INGEST_FETCHERS) == len(set(INGEST_FETCHERS))


def test_ingest_fetchers_excludes_disabled_fetchers():
    listed = DISABLED_FETCHERS & set(INGEST_FETCHERS)
    assert not listed, (
        f"{sorted(listed)} raise on invocation and must not be in INGEST_FETCHERS. "
        "reBAP comes from `rebap-de` (Netztransparenz), not SMARD."
    )


def test_imbalance_and_hydro_sources_are_ingested():
    """The series that silently froze (or would silently go stale next to one that doesn't)
    must stay wired up. nrv-saldo-de writes the same table as rebap-de (imbalance_prices_de)
    and feeds compute_rebap_signal's nrv_dev_lag1 feature - if it drops out of the list while
    rebap-de stays in, nrv_mean_mw goes stale silently next to columns that keep updating.
    """
    for fetcher in ("rebap-de", "nrv-saldo-de", "entso-e-hydro"):
        assert fetcher in INGEST_FETCHERS, (
            f"{fetcher} missing: its table stops updating while the UI still labels it current"
        )


def test_ingest_timeout_keys_are_all_ingested_fetchers():
    """A timeout override for a fetcher that is not run is a leftover, not a setting."""
    unknown = set(INGEST_TIMEOUTS) - set(INGEST_FETCHERS)
    assert not unknown, f"INGEST_TIMEOUTS has entries for non-ingested fetchers: {sorted(unknown)}"


def test_ingest_timeouts_are_positive_and_at_least_the_default():
    for fetcher, timeout in INGEST_TIMEOUTS.items():
        assert timeout >= DEFAULT_INGEST_TIMEOUT, (
            f"{fetcher} override ({timeout}s) is below the {DEFAULT_INGEST_TIMEOUT}s default; "
            "an override exists to give a slow fetcher more room, not less"
        )


@needs_market_data
def test_every_ingest_fetcher_is_a_real_cli_command():
    commands = _cli_commands()
    assert commands, "parsed no commands from ingest.py --help; the parser needs updating"
    missing = [f for f in INGEST_FETCHERS if f not in commands]
    assert not missing, f"not valid `ingest.py` commands: {missing}"
