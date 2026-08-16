import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"

_DEFAULT_ENERGY_DB = DATA_DIR / "energy_hub.duckdb"


def energy_db_path() -> Path:
    """Path to energy_hub.duckdb, overridable with the ENERGY_DB env var."""
    return Path(os.environ.get("ENERGY_DB", str(_DEFAULT_ENERGY_DB)))
