import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"

_DEFAULT_ENERGY_DB = DATA_DIR / "energy_hub.duckdb"


def energy_db_path() -> Path:
    """Path to energy_hub.duckdb, overridable with the ENERGY_DB env var."""
    return Path(os.environ.get("ENERGY_DB", str(_DEFAULT_ENERGY_DB)))


# Root of the quant tree (~/quant). The energy checkout sits directly under it, so
# backend/app/project_paths.py is three levels below. QUANT_ROOT overrides for odd layouts.
QUANT_ROOT = Path(os.environ.get("QUANT_ROOT", str(Path(__file__).resolve().parents[3])))


def quant_project_dir(category: str, slug: str) -> Path:
    """Directory of a sibling quant project, e.g. ``("pricing", "crack-options")``."""
    return QUANT_ROOT / category / slug
