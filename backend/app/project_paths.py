from pathlib import Path
import os

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"

_DEFAULT_ENERGY_DB = DATA_DIR / "energy_hub.duckdb"


def energy_db_path() -> Path:
    return Path(os.environ.get("ENERGY_DB", str(_DEFAULT_ENERGY_DB)))
