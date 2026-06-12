"""Read-only access to energy_hub.duckdb.

The refresh job (scripts/refresh.py) is the sole writer. The API opens the DB
read-only with lock-retry so a refresh run in progress never causes 500s.
"""

from __future__ import annotations

import time
from pathlib import Path

import duckdb
import pandas as pd

from .project_paths import energy_db_path


def query(sql: str, params: list | None = None, retries: int = 20, db: Path | None = None) -> pd.DataFrame:
    path = db if db is not None else energy_db_path()
    if not path.exists():
        return pd.DataFrame()
    for attempt in range(retries):
        try:
            conn = duckdb.connect(str(path), read_only=True)
            try:
                return conn.execute(sql, params or []).df()
            finally:
                conn.close()
        except duckdb.CatalogException:
            return pd.DataFrame()
        except duckdb.IOException:
            if attempt == retries - 1:
                return pd.DataFrame()
            time.sleep(0.2)
    return pd.DataFrame()


def scalar(sql: str, params: list | None = None, default=None):
    df = query(sql, params)
    if df.empty:
        return default
    v = df.iloc[0, 0]
    return default if pd.isna(v) else v
