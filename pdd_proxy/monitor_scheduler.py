import threading
import time
import sqlite3
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "data" / "goods.db"
CHECK_INTERVAL = 60  # seconds

_running = False
_thread = None


def _get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _check_and_refresh():
    """Check for due monitor items and record snapshots."""
    try:
        conn = _get_conn()
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        
        rows = conn.execute("""
            SELECT m.goods_id, m.frequency, g.price, g.sales
            FROM monitor_list m
            JOIN goods g ON m.goods_id = g.goods_id
            WHERE m.status = 'active' AND m.next_check <= ?
        """, (now_str,)).fetchall()
        
        if not rows:
            conn.close()
            return
        
        updated = 0
        for r in rows:
            try:
                stock = None
                try:
                    if "total_stock" in r.keys() and r["total_stock"]:
                        stock = int(r["total_stock"])
                    elif r["skus"]:
                        skus_data = json.loads(r["skus"])
                        if isinstance(skus_data, list):
                            stock = sum(int(s.get("stock", 0) or 0) for s in skus_data)
                except Exception:
                    pass
                freq_hours = {"daily": 24, "12h": 12, "6h": 6}.get(r["frequency"], 24)
                next_check = (now + timedelta(hours=freq_hours)).strftime("%Y-%m-%d %H:%M:%S")
                
                conn.execute(
                    "INSERT INTO monitor_history (goods_id, price, stock, sales, checked_at) VALUES (?, ?, ?, ?, ?)",
                    (r["goods_id"], r["price"], stock, r["sales"], now_str)
                )
                conn.execute(
                    "UPDATE monitor_list SET last_check = ?, next_check = ? WHERE goods_id = ?",
                    (now_str, next_check, r["goods_id"])
                )
                updated += 1
            except Exception as e:
                logger.error(f"Error refreshing monitor for {r['goods_id']}: {e}")
        
        conn.commit()
        conn.close()
        if updated > 0:
            logger.info(f"Monitor scheduler: refreshed {updated} items")
    except Exception as e:
        logger.error(f"Monitor scheduler error: {e}")


def _run_loop():
    """Background loop that periodically checks for due items."""
    logger.info("Monitor scheduler started")
    while _running:
        _check_and_refresh()
        time.sleep(CHECK_INTERVAL)
    logger.info("Monitor scheduler stopped")


def start_scheduler():
    """Start the background monitor scheduler."""
    global _running, _thread
    if _running:
        return
    _running = True
    _thread = threading.Thread(target=_run_loop, daemon=True, name="monitor-scheduler")
    _thread.start()
    logger.info("Monitor scheduler thread started")


def stop_scheduler():
    """Stop the background monitor scheduler."""
    global _running
    _running = False
