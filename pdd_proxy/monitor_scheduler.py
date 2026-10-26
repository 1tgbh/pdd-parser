"""Maintain local observation reminders without issuing PDD requests or inventing samples."""

import json
import logging
import threading
from datetime import datetime, timedelta

from storage import get_conn

logger = logging.getLogger(__name__)
CHECK_INTERVAL = 60
_stop = threading.Event()
_thread = None


def _check_and_refresh():
    conn = get_conn()
    updated = 0
    try:
        now = datetime.now()
        rows = conn.execute("""
            SELECT m.goods_id,m.frequency,m.next_check,g.observed_at,g.source_snapshot
            FROM monitor_list m JOIN goods g USING(goods_id) WHERE m.status='active'
        """).fetchall()
        for row in rows:
            observed = row["observed_at"]
            if observed and not conn.execute("SELECT 1 FROM monitor_history WHERE goods_id=? AND observed_at=?", (row["goods_id"], observed)).fetchone():
                source = json.loads(row["source_snapshot"] or "{}")
                if source.get("price", 0) > 0:
                    stocks = [s.get("stock") for s in source.get("skus", [])]
                    stock = sum(stocks) if stocks and all(s is not None for s in stocks) else None
                    conn.execute("INSERT INTO monitor_history(goods_id,price,stock,sales,checked_at,observed_at) VALUES(?,?,?,?,?,?)", (row["goods_id"], source["price"], stock, source.get("sales"), observed, observed))
                    conn.execute("UPDATE monitor_list SET last_check=? WHERE goods_id=?", (observed, row["goods_id"]))
                    updated += 1
            if not row["next_check"] or row["next_check"] <= now.isoformat():
                hours = {"daily": 24, "12h": 12, "6h": 6}.get(row["frequency"], 24)
                conn.execute("UPDATE monitor_list SET next_check=? WHERE goods_id=?", ((now + timedelta(hours=hours)).isoformat(), row["goods_id"]))
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        logger.exception("Unable to refresh local observation history")
        raise
    finally:
        conn.close()


def _run_loop():
    while not _stop.is_set():
        try:
            _check_and_refresh()
        except Exception:
            pass
        _stop.wait(CHECK_INTERVAL)


def start_scheduler():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_run_loop, daemon=True, name="monitor-scheduler")
    _thread.start()


def stop_scheduler():
    _stop.set()
