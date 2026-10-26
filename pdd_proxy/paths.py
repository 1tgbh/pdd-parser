"""Shared runtime paths. Tests and portable installs may select a separate data directory."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PDD_DATA_DIR", str(BASE_DIR / "data"))).resolve()
DB_PATH = DATA_DIR / "goods.db"


def data_path(relative: str, roots: tuple[str, ...]) -> Path:
    """Resolve a data file without accepting absolute paths or directory traversal."""
    path = (DATA_DIR / relative).resolve()
    try:
        parts = path.relative_to(DATA_DIR).parts
    except ValueError as exc:
        raise ValueError("文件路径越界") from exc
    if len(parts) < 2 or parts[0] not in roots:
        raise ValueError("不支持的文件目录")
    return path
