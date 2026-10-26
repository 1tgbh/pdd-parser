"""Persistent, process-wide capture stop switch, shared by every capture entry point."""

import json
import threading
from contextlib import contextmanager
from datetime import datetime
from functools import wraps

from paths import DATA_DIR

_lock = threading.RLock()
_state_path = DATA_DIR / "capture_state.json"
_state = None


class CapturePaused(ValueError):
    pass


def get_capture_state() -> dict:
    global _state
    with _lock:
        if _state is None:
            try:
                loaded = json.loads(_state_path.read_text("utf-8"))
                _state = {"enabled": loaded.get("enabled") is True,
                          "reason": str(loaded.get("reason", ""))[:200],
                          "updated_at": str(loaded.get("updated_at", ""))}
            except FileNotFoundError:
                _state = {"enabled": True, "reason": "", "updated_at": ""}
            except (ValueError, OSError, AttributeError):
                _state = {"enabled": False, "reason": "采集状态文件异常，请手动恢复", "updated_at": ""}
        return dict(_state)


def set_capture_enabled(enabled: bool, reason: str = "") -> dict:
    global _state
    if not isinstance(enabled, bool):
        raise ValueError("enabled 必须是布尔值")
    with _lock:
        new_state = {"enabled": enabled, "reason": "" if enabled else (reason or "用户暂停"),
                     "updated_at": datetime.now().isoformat()}
        _state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = _state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(new_state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_state_path)
        _state = new_state
        return dict(_state)


def get_capture_enabled() -> bool:
    return get_capture_state()["enabled"]


@contextmanager
def capture_guard():
    # A pause waits for the current transaction; no new write can start after it returns.
    with _lock:
        if not get_capture_enabled():
            raise CapturePaused(get_capture_state()["reason"])
        yield


def capturing(func):
    @wraps(func)
    def guarded(*args, **kwargs):
        with capture_guard():
            return func(*args, **kwargs)
    return guarded
