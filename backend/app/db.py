"""Read-only access to energy_hub.duckdb.

The refresh job (scripts/refresh.py) is the sole writer. It writes to a
temp file then atomically renames it over energy_hub.duckdb, then bumps a
sidecar timestamp file (energy_hub.duckdb.ts).  The API uses thread-local
DuckDB connections (warm buffer pool, ~4x faster than per-request opens).
Before each query we check the sidecar mtime; if it changed since this
thread last connected, we reopen to pick up the new snapshot.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import duckdb
import pandas as pd

from .project_paths import energy_db_path

_local = threading.local()


def _ts_mtime(path: Path) -> float:
    """Return mtime of the sidecar .ts file, or 0.0 if absent."""
    ts_path = path.parent / (path.name + ".ts")
    try:
        return ts_path.stat().st_mtime
    except FileNotFoundError:
        return 0.0


def _get_conn(path: Path) -> duckdb.DuckDBPyConnection:
    conn: duckdb.DuckDBPyConnection | None = getattr(_local, "conn", None)
    conn_path: Path | None = getattr(_local, "conn_path", None)
    conn_mtime: float = getattr(_local, "conn_mtime", 0.0)
    current_mtime = _ts_mtime(path)
    if conn is None or conn_path != path or current_mtime > conn_mtime:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        _local.conn = duckdb.connect(str(path), read_only=True)
        _local.conn_path = path
        _local.conn_mtime = current_mtime
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
    _local.conn_mtime = 0.0


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
