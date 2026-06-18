"""Read-only access to energy_hub.duckdb.

The refresh job (scripts/refresh.py) is the sole writer. The API uses
thread-local DuckDB connections so each worker thread keeps its own warm
buffer pool - eliminating the 200-300ms cold-start I/O overhead that
occurred when opening a new connection per request.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import duckdb
import pandas as pd

from .project_paths import energy_db_path

_local = threading.local()


def _get_conn(path: Path) -> duckdb.DuckDBPyConnection:
    conn: duckdb.DuckDBPyConnection | None = getattr(_local, "conn", None)
    conn_path: Path | None = getattr(_local, "conn_path", None)
    if conn is None or conn_path != path:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        _local.conn = duckdb.connect(str(path), read_only=True)
        _local.conn_path = path
    return _local.conn


def _reset_local_conn() -> None:
    conn: duckdb.DuckDBPyConnection | None = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
    _local.conn = None
    _local.conn_path = None


def query(sql: str, params: list | None = None, retries: int = 20, db: Path | None = None) -> pd.DataFrame:
    path = db if db is not None else energy_db_path()
    if not path.exists():
        return pd.DataFrame()
    for attempt in range(retries):
        try:
            conn = _get_conn(path)
            return conn.execute(sql, params or []).df()
        except duckdb.CatalogException:
            return pd.DataFrame()
        except duckdb.IOException:
            # Refresh may be replacing the file - drop the stale connection and retry.
            _reset_local_conn()
            if attempt == retries - 1:
                return pd.DataFrame()
            time.sleep(0.2)
        except Exception:
            _reset_local_conn()
            if attempt == retries - 1:
                return pd.DataFrame()
            time.sleep(0.1)
    return pd.DataFrame()


def scalar(sql: str, params: list | None = None, default=None):
    df = query(sql, params)
    if df.empty:
        return default
    v = df.iloc[0, 0]
    return default if pd.isna(v) else v
