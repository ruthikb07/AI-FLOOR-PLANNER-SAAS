"""Share exact fiber contours between workers in an explicitly configured cache."""
from functools import lru_cache
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import sqlite3
from contextlib import closing


@lru_cache(maxsize=1)
def _method_identity():
    root = Path(__file__).parent
    files = [root / name for name in ("worker_main.py", "section_contour_cache.py", "uv.lock")]
    packages = sorted((d.metadata["Name"], d.version) for d in importlib.metadata.distributions())
    return [platform.platform(), platform.machine(), platform.python_version(), packages,
            [hashlib.sha256(path.read_bytes()).hexdigest() for path in files]]


def exact_contour(section_key, axial_kn, points, compute):
    folder = os.environ.get("RH_SECTION_CACHE_DIR")
    if folder is None and os.environ.get("RH_LOCAL_PROJECTS_DIR"):
        folder = Path(os.environ["RH_LOCAL_PROJECTS_DIR"]) / ".structural-cache"
    if not folder:
        return compute()
    key = hashlib.sha256(json.dumps([_method_identity(), section_key, axial_kn, points],
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()
    try:
        Path(folder).mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(Path(folder) / "fiber-contours.sqlite3", timeout=1)
    except (OSError, sqlite3.Error):
        return compute()
    try:
        db.execute("CREATE TABLE IF NOT EXISTS contours (key TEXT PRIMARY KEY, body TEXT, digest TEXT)")
        row = db.execute("SELECT body, digest FROM contours WHERE key=?", (key,)).fetchone()
        if row and hashlib.sha256((key + row[0]).encode()).hexdigest() == row[1]:
            value = json.loads(row[0])
            if (len(value) == 4 and len(value[2]) == len(value[3]) == points + 1 and
                    all(math.isfinite(x) for x in [*value[:2], *value[2], *value[3]])):
                return value
    except (sqlite3.Error, ValueError, TypeError, IndexError):
        pass
    finally:
        db.close()
    result = compute()
    body = json.dumps(result, allow_nan=False, separators=(",", ":"))
    digest = hashlib.sha256((key + body).encode()).hexdigest()
    try:
        with closing(sqlite3.connect(Path(folder) / "fiber-contours.sqlite3", timeout=1)) as writer, writer:
            writer.execute("INSERT OR REPLACE INTO contours VALUES (?, ?, ?)", (key, body, digest))
            writer.execute("DELETE FROM contours WHERE rowid < (SELECT MAX(rowid) - 16384 FROM contours)")
    except sqlite3.Error:
        pass
    return result
