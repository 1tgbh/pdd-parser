"""
Web 管理后台 - Flask API 服务 + React SPA
"""

import json
import logging
import sys
import sqlite3
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from logging.handlers import RotatingFileHandler
import os as _os
from typing import Any

import re as _re
import hashlib as _hashlib
from urllib.parse import urlparse, urlencode, parse_qs, unquote

from flask import Flask, request, jsonify, send_file, send_from_directory

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BASE_DIR))
from paths import DATA_DIR as _DATA_DIR, data_path
from capture_state import CapturePaused, capturing, get_capture_state, set_capture_enabled, get_capture_enabled
from web.security import install_security
from normalization import normalize_skus, money, nonnegative_int, valid_goods_id, safe_source_url
from image_store import read_image, is_pdd_image, ImageFetchError, image_type
_DATA_DIR.mkdir(parents=True, exist_ok=True)

_log_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


class _NoiseFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        if "ConnectionResetError" in msg:
            return False
        if "CancelledError" in msg:
            return False
        if "_call_connection_lost" in msg:
            return False
        if record.name == "asyncio" and "Unhandled error" in msg:
            return False
        return True


_noise = _NoiseFilter()

_file_handler = RotatingFileHandler(_DATA_DIR / "server.log", maxBytes=5_000_000, backupCount=2, encoding="utf-8")
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(_log_fmt)
_file_handler.addFilter(_noise)

_err_handler = RotatingFileHandler(_DATA_DIR / "server_err.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")
_err_handler.setLevel(logging.WARNING)
_err_handler.setFormatter(_log_fmt)
_err_handler.addFilter(_noise)

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(_log_fmt)
_console_handler.addFilter(_noise)

_root = logging.getLogger()
_root.setLevel(logging.INFO)
_root.addHandler(_file_handler)
_root.addHandler(_err_handler)
_root.addHandler(_console_handler)

logging.getLogger("asyncio").setLevel(logging.CRITICAL)

sys.path.insert(0, str(_BASE_DIR))

from monitor_scheduler import start_scheduler

DIST_DIR: Path = _BASE_DIR / "frontend" / "dist"
DATA_DIR: Path = _DATA_DIR
DB_PATH: Path = DATA_DIR / "goods.db"
IMAGES_DIR: Path = DATA_DIR / "images"
EXPORT_DIR: Path = DATA_DIR / "exports"

_AI_IMAGE_DIRS = ("ai_images", "ai_uploads")
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_IMAGE_TARGETS = {"main", "detail"}

app = Flask(__name__, static_folder=None)
install_security(app)


@app.errorhandler(CapturePaused)
def capture_paused(error):
    return jsonify({"error": "capture_paused", **get_capture_state()}), 409


@app.errorhandler(ValueError)
def invalid_value(error):
    return jsonify({"error": str(error)}), 400


import time as _time


@app.before_request
def _log_request_start():
    request._start_time = _time.time()


@app.after_request
def _log_request_end(response):
    if getattr(request, "_start_time", None):
        elapsed = round((_time.time() - request._start_time) * 1000)
        if request.path.startswith("/api/"):
            logger.info(
                "%s %s %s %d %dms",
                request.method, request.path,
                request.remote_addr or "-",
                response.status_code, elapsed,
            )
    if response.status_code >= 400 and getattr(request, "_pdd_authorized", False):
        path = request.path
        stage = "sync" if path in {"/api/ingest", "/api/list-ingest"} else "import" if path.startswith("/api/import") else "edit" if path.startswith("/api/product/") and request.method != "GET" else None
        if stage:
            from diagnostics import record
            record("capture_paused" if response.status_code == 409 else "validation_failed" if response.status_code == 400 else "import_failed" if stage == "import" else "edit_failed" if stage == "edit" else "sync_failed", stage, http_status=response.status_code)
    if response.status_code < 400 and request.path.startswith('/api/import') and getattr(request, '_pdd_authorized', False):
        result = response.get_json(silent=True) or {}
        if isinstance(result, dict) and (result.get('error') or result.get('errors')):
            from diagnostics import record
            record('import_failed', 'import', http_status=response.status_code)
    return response


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


import io

_PDD_REFERER = "https://mobile.yangkeduo.com/"
_IMAGE_CACHE_DIR = DATA_DIR / "image_cache"
_IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _strip_thumb_params(url: str) -> str:
    """Remove thumbnail size parameters from PDD image URLs to get the original."""
    url = _re.sub(r'_\d+x\d+(\.\w+)', r'\1', url)
    parsed = urlparse(url)
    if parsed.query:
        qs = parse_qs(parsed.query)
        for key in ['imageView2', 'x-oss-process', 'w', 'h', 'width', 'height']:
            qs.pop(key, None)
        new_query = urlencode({k: v[0] for k, v in qs.items()}) if qs else ''
        url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if new_query:
            url += f"?{new_query}"
    return url


def _is_pdd_image(url: str) -> bool:
    return is_pdd_image(url)


def _hex_to_rgb(hex_color: str):
    h = hex_color.lstrip('#')
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _row_to_goods(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "goods_id": r["goods_id"],
        "title": r["title"] or "",
        "subtitle": r["subtitle"] or "",
        "selling_points": json.loads(r["selling_points"] or "[]"),
        "price": r["price"] or 0,
        "original_price": r["original_price"] or 0,
        "min_group_price": r["min_group_price"] or 0,
        "sales": r["sales"] or 0,
        "sold_quantity": r["sold_quantity"] or 0,
        "shop_name": r["shop_name"] or "",
        "shop_id": r["shop_id"] or "",
        "shop_logo": r["shop_logo"] or "",
        "main_images": json.loads(r["main_images"] or "[]"),
        "detail_images": json.loads(r["detail_images"] or "[]"),
        "sku_images": json.loads(r["sku_images"] or "[]"),
        "specs": json.loads(r["specs"] or "{}"),
        "skus": normalize_skus(json.loads(r["skus"] or "[]")),
        "description": r["description"] or "",
        "attributes": json.loads(r["attributes"] or "{}"),
        "source_url": r["source_url"] or "",
        "crawl_time": r["crawl_time"] or "",
        "observed_at": r["observed_at"] if "observed_at" in r.keys() else None,
        "updated_at": r["updated_at"] or "",
        "price_modified": r["price_modified"] if "price_modified" in r.keys() else 0,
    }


def _protect_manual_fields(conn, goods_id, fields, *, sku_prices=False):
    row = conn.execute("SELECT manual_fields FROM goods WHERE goods_id=?", (goods_id,)).fetchone()
    if row:
        protected = set(json.loads(row[0] or "[]")) | set(fields)
        conn.execute("UPDATE goods SET manual_fields=? WHERE goods_id=?", (json.dumps(sorted(protected)), goods_id))
        from provenance import mark_manual
        mark_manual(conn, goods_id, fields, datetime.now().isoformat(), sku_prices=sku_prices)


def _delete_goods(conn, ids):
    placeholders = ','.join('?' for _ in ids)
    for table in ("sku_items", "product_tags", "product_groups", "monitor_list", "monitor_history", "goods"):
        conn.execute(f"DELETE FROM {table} WHERE goods_id IN ({placeholders})", ids)


def _product_filters(args):
    clauses, params = [], []
    keyword = args.get("keyword", "").strip()
    if keyword:
        clauses.append("(g.title LIKE ? OR g.shop_name LIKE ? OR g.goods_id LIKE ?)")
        params.extend([f"%{keyword}%"] * 3)
    for key, column, operator, convert in (
        ("min_price", "price", ">=", money), ("max_price", "price", "<=", money),
        ("min_sales", "sales", ">=", nonnegative_int), ("max_sales", "sales", "<=", nonnegative_int),
    ):
        if args.get(key) not in (None, ""):
            clauses.append(f"g.{column} {operator} ?")
            params.append(convert(args[key]))
    for key, table, column in (("tag", "product_tags", "tag_id"), ("group", "product_groups", "group_id")):
        if args.get(key):
            clauses.append(f"EXISTS (SELECT 1 FROM {table} p WHERE p.goods_id=g.goods_id AND p.{column}=?)")
            params.append(nonnegative_int(args[key]))
    if args.get("shop"):
        clauses.append("g.shop_name LIKE ?")
        params.append(f"%{args['shop']}%")
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params



def _apply_markup(price: float, multiplier: float, fixed_amount: float) -> float:
    """对单个价格应用改价公式，价格<=0不改"""
    if price <= 0:
        return price
    return money(price * multiplier + fixed_amount)


def _apply_markup_to_skus(skus: list, multiplier: float, fixed_amount: float) -> list:
    """对SKU列表的所有价格应用改价公式"""
    for sku in skus:
        if isinstance(sku, dict):
            if sku.get("price", 0) > 0:
                sku["price"] = _apply_markup(sku["price"], multiplier, fixed_amount)
            if sku.get("original_price", 0) > 0:
                sku["original_price"] = _apply_markup(sku["original_price"], multiplier, fixed_amount)
    return skus


@app.route("/api/proxy-image")
def api_proxy_image():
    url = request.args.get("url", "")
    if not url or not _is_pdd_image(url):
        return jsonify({"error": "invalid url"}), 400
    try:
        data, ct = read_image(url, pdd_only=True)
        return send_file(io.BytesIO(data), mimetype=ct)
    except ImageFetchError as e:
        return jsonify({"error": str(e)}), 429 if e.status == 429 else 400
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.post("/api/ai/cache-image")
def api_cache_image():
    url = (request.get_json() or {}).get("url", "")
    content, content_type = read_image(url)
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}[content_type]
    name = "remote_" + _hashlib.sha256(content).hexdigest() + ext
    path = DATA_DIR / "ai_uploads" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(content)
    return jsonify({"ok": True, "url": "/api/ai-image/ai_uploads/" + name})


# ==================== React SPA ====================

@app.route("/compare")
@app.route("/ai-copywriting")
@app.route("/monitor")
@app.route("/")
@app.route("/products")
@app.route("/product/<path:_id>")
@app.route("/export")
@app.route("/import")
@app.route("/settings")
@app.route("/logs")
@app.route("/diagnostics")
@app.route("/ai-editor")
def serve_spa(_id: str = "") -> Any:
    return send_from_directory(str(DIST_DIR), "index.html")


@app.route("/assets/<path:filename>")
def serve_assets(filename: str) -> Any:
    return send_from_directory(str(DIST_DIR / "assets"), filename)


@app.route("/favicon.ico")
def serve_favicon() -> Any:
    return send_from_directory(str(DIST_DIR), "favicon.ico")

@app.route("/logo.svg")
def serve_logo() -> Any:
    return send_from_directory(str(DIST_DIR), "logo.svg")


@app.route("/favicon.svg")
def serve_favicon_svg() -> Any:
    return send_from_directory(str(DIST_DIR), "favicon.svg")

@app.route("/icons.svg")
def serve_icons() -> Any:
    return send_from_directory(str(DIST_DIR), "icons.svg")



# ==================== API ====================

@app.route("/api/dashboard")
def api_dashboard() -> dict:
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM goods").fetchone()[0]
    today = datetime.now().strftime("%Y-%m-%d")
    today_count = conn.execute(
        "SELECT COUNT(*) FROM goods WHERE crawl_time LIKE ?", (f"{today}%",)
    ).fetchone()[0]
    recent_rows = conn.execute(
        "SELECT * FROM goods ORDER BY crawl_time DESC LIMIT 8"
    ).fetchall()
    recent = [_row_to_goods(r) for r in recent_rows]
    shop_rows = conn.execute(
        "SELECT shop_name, COUNT(*) as cnt FROM goods GROUP BY shop_name ORDER BY cnt DESC LIMIT 10"
    ).fetchall()
    shop_distribution = {(r["shop_name"] or "未知"): r["cnt"] for r in shop_rows}
    conn.close()
    return jsonify({
        "total_goods": total, "today_goods": today_count,
        "shop_count": len(shop_distribution), "recent": recent,
        "shop_distribution": shop_distribution,
    })


@app.route("/api/dashboard/price-distribution", methods=["GET"])
def api_price_distribution():
    try:
        conn = get_conn()
        ranges = [
            ("0-10", 0, 10),
            ("10-30", 10, 30),
            ("30-50", 30, 50),
            ("50-100", 50, 100),
            ("100-200", 100, 200),
            ("200-500", 200, 500),
            ("500+", 500, 999999),
        ]
        result = []
        for label, low, high in ranges:
            count = conn.execute(
                "SELECT COUNT(*) FROM goods WHERE price >= ? AND price < ?",
                (low, high)
            ).fetchone()[0]
            result.append({"range": label, "count": count})
        conn.close()
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/dashboard/top-sales", methods=["GET"])
def api_top_sales():
    try:
        conn = get_conn()
        rows = conn.execute(
            "SELECT goods_id, title, sales, price FROM goods ORDER BY sales DESC LIMIT 10"
        ).fetchall()
        conn.close()
        return jsonify([{
            "goods_id": r["goods_id"],
            "title": r["title"] or "",
            "sales": r["sales"] or 0,
            "price": r["price"] or 0,
        } for r in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/dashboard/tag-stats", methods=["GET"])
def api_tag_stats():
    try:
        conn = get_conn()
        rows = conn.execute("""
            SELECT t.id, t.name, t.color, COUNT(pt.goods_id) as cnt
            FROM tags t
            LEFT JOIN product_tags pt ON t.id = pt.tag_id
            GROUP BY t.id
            ORDER BY cnt DESC
        """).fetchall()
        conn.close()
        return jsonify([{
            "id": r["id"],
            "name": r["name"],
            "color": r["color"],
            "count": r["cnt"],
        } for r in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/dashboard/price-alerts", methods=["GET"])
def api_price_alerts():
    try:
        conn = get_conn()
        rows = conn.execute("""
            SELECT 
                m.goods_id,
                g.title,
                g.main_images,
                h1.price as current_price,
                h2.price as prev_price,
                h1.checked_at
            FROM monitor_list m
            JOIN goods g ON m.goods_id = g.goods_id
            JOIN monitor_history h1 ON m.goods_id = h1.goods_id
            JOIN monitor_history h2 ON m.goods_id = h2.goods_id
            WHERE h1.id = (
                SELECT id FROM monitor_history WHERE goods_id = m.goods_id AND observed_at IS NOT NULL ORDER BY observed_at DESC, id DESC LIMIT 1
            )
            AND h2.id = (
                SELECT id FROM monitor_history WHERE goods_id = m.goods_id AND observed_at IS NOT NULL ORDER BY observed_at DESC, id DESC LIMIT 1 OFFSET 1
            )
            AND h1.price < h2.price
            AND h2.price > 0
            ORDER BY (h2.price - h1.price) / h2.price DESC
        """).fetchall()
        conn.close()
        result = []
        for r in rows:
            current = r["current_price"] or 0
            prev = r["prev_price"] or 1
            drop_pct = round((prev - current) / prev * 100, 1) if prev > 0 else 0
            try:
                images = json.loads(r["main_images"] or "[]")
            except (json.JSONDecodeError, TypeError):
                images = []
            result.append({
                "goods_id": r["goods_id"],
                "title": r["title"] or "",
                "image": images[0] if images else "",
                "current_price": current,
                "prev_price": prev,
                "drop_percent": drop_pct,
                "checked_at": r["checked_at"],
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/products")
def api_products() -> dict:
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, max(1, int(request.args.get("page_size", 20))))
    offset = (page - 1) * page_size
    where, params = _product_filters(request.args)
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM goods g" + where, params).fetchone()[0]
    rows = conn.execute("SELECT g.* FROM goods g" + where + " ORDER BY g.crawl_time DESC LIMIT ? OFFSET ?", params + [page_size, offset]).fetchall()
    conn.close()
    items = []
    for r in rows:
        item = _row_to_goods(r)
        item["price_min"] = r["price_min"] if "price_min" in r.keys() else r["price"]
        item["price_max"] = r["price_max"] if "price_max" in r.keys() else r["price"]
        item["total_stock"] = r["total_stock"] if "total_stock" in r.keys() else 0
        items.append(item)
    return jsonify({"items": items, "total": total, "page": page, "page_size": page_size})


@app.route("/api/shops", methods=["GET"])
def api_shops():
    conn = get_conn()
    rows = conn.execute(
        "SELECT DISTINCT shop_name FROM goods WHERE shop_name IS NOT NULL AND shop_name != '' ORDER BY shop_name"
    ).fetchall()
    conn.close()
    return jsonify({"shops": [r["shop_name"] for r in rows]})


@app.route("/api/capture-toggle", methods=["GET", "POST"])
def api_capture_toggle():
    if request.method == "POST":
        data = request.get_json() or {}
        set_capture_enabled(data.get("enabled"))
    return jsonify(get_capture_state())


@app.post("/api/capture-event")
def api_capture_event():
    data = request.get_json() or {}
    reasons = {"auth_required": "页面要求登录", "http_401": "登录状态失效", "http_403": "页面访问受限（HTTP 403）",
               "http_429": "页面请求频率受限（HTTP 429）", "verification": "页面要求安全验证"}
    reason = reasons.get(data.get("kind"))
    if not reason:
        raise ValueError("不支持的采集事件")
    result = set_capture_enabled(False, reason)
    from diagnostics import record
    code = {"auth_required": "auth_required", "http_401": "auth_required", "http_403": "access_denied", "http_429": "rate_limited", "verification": "verification_required"}[data["kind"]]
    record(code, "page_read", source_url=data.get("source_url", ""), http_status=int(data["kind"][5:]) if data["kind"].startswith("http_") else None)
    return jsonify(result)


@app.post("/api/diagnostics/events")
def api_diagnostic_events():
    from diagnostics import write_events
    events = (request.get_json() or {}).get("events")
    if not isinstance(events, list) or not 1 <= len(events) <= 20:
        raise ValueError("诊断事件必须是1到20项的数组")
    conn = get_conn()
    try:
        write_events(conn, events)
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.get("/api/diagnostics")
def api_diagnostics():
    from diagnostics import public, CODES, STAGES
    clauses, params = [], []
    for field, choices in (("code", CODES), ("stage", STAGES)):
        value = request.args.get(field)
        if value:
            if value not in choices:
                raise ValueError("诊断筛选无效")
            clauses.append(field + "=?")
            params.append(value)
    if request.args.get("unread") == "true":
        clauses.append("acknowledged=0")
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    page = max(1, int(request.args.get("page", 1)))
    conn = get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) FROM diagnostics" + where, params).fetchone()[0]
        rows = conn.execute("SELECT * FROM diagnostics" + where + " ORDER BY occurred_at DESC,id DESC LIMIT 30 OFFSET ?", params + [(page - 1) * 30]).fetchall()
        return jsonify({"items": [public(r) for r in rows], "total": total, "page": page, "page_size": 30, "capture_state": get_capture_state()})
    finally:
        conn.close()


@app.post("/api/diagnostics/<event_id>/acknowledge")
def api_acknowledge_diagnostic(event_id):
    conn = get_conn()
    try:
        if not conn.execute("SELECT 1 FROM diagnostics WHERE id=?", (event_id,)).fetchone():
            return jsonify({"error": "诊断记录不存在"}), 404
        conn.execute("UPDATE diagnostics SET acknowledged=1 WHERE id=?", (event_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()

@app.route("/api/product-ids")
def api_product_ids() -> dict:
    where, params = _product_filters(request.args)
    conn = get_conn()
    rows = conn.execute("SELECT g.goods_id FROM goods g" + where, params).fetchall()
    conn.close()
    ids = [r["goods_id"] for r in rows]
    return jsonify({"ids": ids, "total": len(ids)})

@app.route("/api/product/<goods_id>", methods=["GET", "PUT", "DELETE"])
def api_product_detail(goods_id: str) -> Any:
    conn = get_conn()
    if request.method == "DELETE":
        _delete_goods(conn, [goods_id])
        conn.commit(); conn.close()
        return jsonify({"ok": True, "deleted": goods_id})
    if request.method == "PUT":
        data = request.get_json() or {}
        for key in ("price", "original_price"):
            if key in data:
                data[key] = money(data[key])
        for key in ("sales", "sold_quantity"):
            if key in data:
                data[key] = nonnegative_int(data[key])
        fields, values = [], []
        updatable = ["title","subtitle","price","original_price","sales","sold_quantity","shop_name","description"]
        json_list_fields = ["main_images","detail_images","sku_images"]
        for field in json_list_fields + ["selling_points"]:
            if field in data and (not isinstance(data[field], list) or any(not isinstance(v, str) for v in data[field])):
                conn.close()
                raise ValueError(field + "必须是字符串数组")
        for f in updatable:
            if f in data: fields.append(f"{f} = ?"); values.append(data[f])
        if "selling_points" in data:
            fields.append("selling_points = ?"); values.append(json.dumps(data["selling_points"], ensure_ascii=False))
        for jf in json_list_fields:
            if jf in data: fields.append(f"{jf} = ?"); values.append(json.dumps(data[jf], ensure_ascii=False))
        if not fields: conn.close(); return jsonify({"error": "没有要更新的字段"}), 400
        fields.append("updated_at = ?"); values.append(datetime.now().isoformat()); values.append(goods_id)
        conn.execute(f"UPDATE goods SET {', '.join(fields)} WHERE goods_id = ?", values)
        _protect_manual_fields(conn, goods_id, set(data) & set(updatable + json_list_fields + ["selling_points"]))
        if "price" in data or "original_price" in data:
            conn.execute("UPDATE goods SET price_modified=1 WHERE goods_id=?", (goods_id,))
        conn.commit()
        r = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
        conn.close()
        if not r: return jsonify({"error": "商品不存在"}), 404
        return jsonify(_row_to_goods(r))
    r = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    if not r: return jsonify({"error": "商品不存在"}), 404
    resp = _row_to_goods(r)
    sku_items = get_sku_items(goods_id)
    resp["sku_items"] = sku_items
    resp["price_min"] = r["price_min"] if "price_min" in r.keys() else r["price"]
    resp["price_max"] = r["price_max"] if "price_max" in r.keys() else r["price"]
    resp["total_stock"] = r["total_stock"] if "total_stock" in r.keys() else 0
    return jsonify(resp)


@app.get("/api/product/<goods_id>/provenance")
def api_product_provenance(goods_id):
    from provenance import describe
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM goods WHERE goods_id=?", (goods_id,)).fetchone()
        if not row:
            return jsonify({"error": "商品不存在"}), 404
        return jsonify(describe(row))
    finally:
        conn.close()


@app.route("/api/export", methods=["POST"])
def api_export() -> Any:
    from export_jobs import submit_export
    data = _export_payload(request.get_json() or {})
    return jsonify(submit_export("export", data, _create_export_file)), 202


def _export_payload(data):
    ids = data.get("ids") or []
    if not isinstance(ids, list) or len(ids) > 500:
        raise ValueError("单个导出任务最多500件商品")
    data["ids"] = sorted({valid_goods_id(gid) for gid in ids})
    if not data["ids"]:
        conn = get_conn()
        try:
            rows = conn.execute("SELECT goods_id FROM goods ORDER BY goods_id LIMIT 501").fetchall()
        finally:
            conn.close()
        if len(rows) > 500:
            raise ValueError("全部商品超过500件，请分批选择导出")
        data["ids"] = [r[0] for r in rows]
        if not data["ids"]:
            raise ValueError("没有可导出的商品")
    return data


@app.get("/api/jobs/<job_id>")
def api_export_job(job_id):
    from export_jobs import get_export_job, public_job
    job = get_export_job(job_id)
    if not job:
        return jsonify({"error": "导出任务不存在或已过期"}), 404
    return jsonify(public_job(job))


@app.get("/api/jobs/<job_id>/download")
def api_export_job_download(job_id):
    from export_jobs import get_export_job
    job = get_export_job(job_id)
    if not job or job["status"] != "completed":
        return jsonify({"error": "导出文件尚未就绪"}), 409
    return send_file(job["path"], as_attachment=True, download_name=job["filename"])


def _create_export_file(data):
    format_type = data.get("format", "json")
    goods_ids = data.get("ids", [])
    template_id = data.get("template_id")
    try:
        if format_type == "excel" and template_id:
            conn = get_conn()
            tpl = conn.execute("SELECT * FROM export_templates WHERE id = ?", (template_id,)).fetchone()
            if not tpl:
                conn.close()
                raise ValueError("模板不存在")
            fields = json.loads(tpl["fields"])
            column_map = json.loads(tpl["column_map"])
            if goods_ids:
                placeholders = ",".join("?" * len(goods_ids))
                rows = conn.execute(f"SELECT * FROM goods WHERE goods_id IN ({placeholders})", goods_ids).fetchall()
            else:
                rows = conn.execute("SELECT * FROM goods ORDER BY crawl_time DESC").fetchall()
            conn.close()
            goods_list = [_row_to_goods(r) for r in rows]
            filepath, _ = export_with_template(goods_list, fields, column_map)
            return filepath
        func_map = {"json": export_json, "csv": export_csv, "excel": export_excel, "taobao": export_for_taobao, "txt": export_txt, "wechat": export_for_wechat}
        if format_type in ("dawang", "dawang_wechat", "dawang_pdd"):
            tpl = {"dawang": "universal", "dawang_wechat": "wechat", "dawang_pdd": "pdd"}[format_type]
            filepath = export_dawang(goods_ids if goods_ids else None, template=tpl)
            return filepath
        if format_type == "dawang_raw":
            filepath = export_dawang_raw(goods_ids if goods_ids else None)
            if not filepath:
                raise ValueError("没有可导出的原始数据")
            return filepath
        func = func_map.get(format_type)
        if not func: raise ValueError(f"不支持的格式: {format_type}")
        filepath = func(goods_ids if goods_ids else None)
        return filepath
    except Exception as e:
        raise ValueError(f"导出失败: {e}") from e


@app.route("/api/package", methods=["POST"])
def api_package() -> Any:
    from export_jobs import submit_export
    data = _export_payload(request.get_json() or {})
    return jsonify(submit_export("package", data, _create_package_file)), 202


def _create_package_file(data):
    goods_ids = data.get("ids", [])
    include_images = data.get("include_images", True)
    try:
        conn = get_conn()
        if goods_ids:
            placeholders = ",".join("?" * len(goods_ids))
            rows = conn.execute(f"SELECT * FROM goods WHERE goods_id IN ({placeholders})", goods_ids).fetchall()
        else:
            rows = conn.execute("SELECT * FROM goods").fetchall()
        conn.close()
        if not rows: raise ValueError("没有可打包的商品")
        goods_list = [_row_to_goods(r) for r in rows]
        if include_images and sum(len(g["main_images"]) + len(g["detail_images"]) + len(g["sku_images"]) for g in goods_list) > 5000:
            raise ValueError("单个图文包最多5000张图片")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        if len(goods_list) == 1 and goods_list[0].get("title"):
            _t = goods_list[0]["title"][:40]
            for ch in '/:*?"<>|': _t = _t.replace(ch, "_")
            zip_name = f"{_safe_filename(_t)}_{timestamp}.zip"
        else:
            zip_name = f"商品采集_{timestamp}.zip"
        zip_path = EXPORT_DIR / zip_name
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("数据/goods.json", json.dumps(goods_list, ensure_ascii=False, indent=2))
            if include_images:
                from exporter import _download_image
                missing = []
                for g in goods_list:
                    gid = valid_goods_id(g["goods_id"])
                    safe_title = _safe_filename(g.get("title", ""), 30)
                    img_dir = f"图片/{safe_title}_{gid}"
                    all_imgs = list(dict.fromkeys(g["main_images"] + g["detail_images"] + g["sku_images"]))
                    for idx, url in enumerate(all_imgs):
                        fname, content = _download_image((f"{img_dir}/图片_{idx+1}.jpg", url))
                        if content:
                            zf.writestr(fname, content)
                        else:
                            missing.append(fname)
                    if all_imgs:
                        zf.writestr(f"{img_dir}/图片URL索引.txt", "\n".join(all_imgs))
                if missing:
                    zf.writestr("下载未完成.txt", "以下图片未下载成功，访问受限时已停止重试：\n" + "\n".join(missing))
            # 包含 AI 生成图片
            ai_conn = get_conn()
            for g in goods_list:
                gid = g["goods_id"]
                safe_title = _safe_filename(g.get("title", ""), 30)
                img_dir = f"图片/{safe_title}_{gid}"
                ai_rows = ai_conn.execute(
                    "SELECT result_path, prompt FROM ai_images WHERE goods_id = ?", (gid,)
                ).fetchall()
                for ai_idx, ai_row in enumerate(ai_rows, 1):
                    ai_path = data_path(ai_row[0], _AI_IMAGE_DIRS)
                    if ai_path.exists():
                        ext = ai_path.suffix or ".png"
                        arcname = f"{img_dir}/AI图片_{ai_idx}{ext}"
                        zf.write(str(ai_path), arcname)
            ai_conn.close()

            # 为每个商品生成商品信息.txt
            for g in goods_list:
                gid = g["goods_id"]
                safe_title = _safe_filename(g.get("title", ""), 30)
                txt_content = generate_goods_txt(g)
                zf.writestr(f"图片/{safe_title}_{gid}/商品信息.txt", txt_content.encode("utf-8-sig"))
            readme = f"商品采集数据包\n{'='*20}\n\n采集时间: {timestamp}\n商品数量: {len(goods_list)}\n包含图片: {'是' if include_images else '否'}\n"
            zf.writestr("README.txt", readme)
        return zip_path
    except Exception as e:
        raise ValueError(f"打包失败: {e}") from e


@app.route("/api/import/preview", methods=["POST"])
def api_import_preview() -> Any:
    if "file" not in request.files:
        return jsonify({"error": "请上传文件"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "文件名为空"}), 400
    suffix = Path(f.filename).suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xls"):
        return jsonify({"error": "仅支持 CSV 和 XLSX 格式"}), 400
    tmp_dir = DATA_DIR / "imports"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"preview_{int(time.time() * 1000)}{suffix}"
    f.save(str(tmp_path))
    try:
        result = preview_file(str(tmp_path))
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


@app.route("/api/import", methods=["POST"])
def api_import() -> Any:
    if "file" not in request.files:
        return jsonify({"error": "请上传文件"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "文件名为空"}), 400
    suffix = Path(f.filename).suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xls", ".json"):
        return jsonify({"error": "仅支持 CSV、XLSX 和 JSON 格式"}), 400
    tmp_dir = DATA_DIR / "imports"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"import_{int(time.time() * 1000)}{suffix}"
    f.save(str(tmp_path))
    # JSON 格式走专门的导入函数
    if suffix == ".json":
        try:
            result = import_goods_json(str(tmp_path))
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        finally:
            try:
                tmp_path.unlink()
            except Exception:
                pass
    column_mapping = None
    mapping_raw = request.form.get("column_mapping")
    if mapping_raw:
        try:
            column_mapping = json.loads(mapping_raw)
        except Exception:
            pass
    try:
        result = import_file(str(tmp_path), column_mapping=column_mapping)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


@app.route("/api/products/delete", methods=["POST"])
def api_products_delete() -> Any:
    data = request.get_json() or {}
    ids = data.get("ids", [])
    if not ids: return jsonify({"error": "请选择要删除的商品"}), 400
    conn = get_conn()
    placeholders = ",".join("?" * len(ids))
    _delete_goods(conn, ids)
    conn.commit(); conn.close()
    return jsonify({"ok": True, "deleted_count": len(ids)})


@app.route("/api/import-raw-json", methods=["POST"])
def api_import_raw_json() -> Any:
    """导入大王解析原始JSON文件"""
    # 支持文件上传和目录导入两种方式
    dir_path = request.form.get("directory", "").strip()
    if dir_path:
        try:
            result = import_raw_json_directory(dir_path)
            return jsonify(result)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    
    if "files" not in request.files:
        return jsonify({"error": "请上传文件或指定目录"}), 400
    
    files = request.files.getlist("files")
    tmp_dir = DATA_DIR / "imports"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    
    file_paths = []
    for i, f in enumerate(files):
        if not f.filename:
            continue
        suffix = Path(f.filename).suffix.lower() or ".json"
        tmp_path = tmp_dir / f"import_{int(time.time() * 1000)}_{i}{suffix}"
        f.save(str(tmp_path))
        file_paths.append(str(tmp_path))
    
    if not file_paths:
        return jsonify({"error": "没有有效文件"}), 400
    
    try:
        result = import_raw_json_files(file_paths)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        for fp in file_paths:
            try:
                Path(fp).unlink()
            except:
                pass

@app.route("/api/ingest", methods=["POST", "OPTIONS"])
@capturing
def api_ingest() -> Any:
    from storage import ingest_goods
    return jsonify(ingest_goods(request.get_json()))


# ==================== 浏览列表采集（店铺/搜索/推荐列表被动记录） ====================

@app.route("/api/list-ingest", methods=["POST", "OPTIONS"])
@capturing
def api_list_ingest() -> Any:
    """接收页面渲染过的商品列表卡（整店/搜索/推荐），被动记录，不发额外请求。"""
    if request.method == "OPTIONS": return "", 204
    data = request.get_json() or {}
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        return jsonify({"error": "missing items"}), 400
    source_url = safe_source_url(data.get("source_url"))
    page_type = str(data.get("page_type") or "")[:30]
    conn = get_conn()
    now = datetime.now().isoformat()
    saved = 0
    try:
        for it in items[:500]:
            if not isinstance(it, dict):
                continue
            gid = str(it.get("goods_id") or "").strip()
            if not gid or not gid.isdigit():
                continue
            title = str(it.get("title") or "")[:500]
            price = money(it.get("price"))
            sales = nonnegative_int(it.get("sales"))
            image = str(it.get("image") or "")[:1000]
            mall_id = str(it.get("mall_id") or "")[:50]
            mall_name = str(it.get("mall_name") or "")[:200]
            conn.execute("""
                INSERT INTO browse_items
                (goods_id, title, price, sales, image, mall_id, mall_name, page_type, source_url, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(goods_id) DO UPDATE SET
                    title = CASE WHEN length(excluded.title) > length(browse_items.title) THEN excluded.title ELSE browse_items.title END,
                    price = CASE WHEN excluded.price > 0 THEN excluded.price ELSE browse_items.price END,
                    sales = CASE WHEN excluded.sales > browse_items.sales THEN excluded.sales ELSE browse_items.sales END,
                    image = CASE WHEN excluded.image != '' THEN excluded.image ELSE browse_items.image END,
                    mall_id = CASE WHEN excluded.mall_id != '' THEN excluded.mall_id ELSE browse_items.mall_id END,
                    mall_name = CASE WHEN excluded.mall_name != '' THEN excluded.mall_name ELSE browse_items.mall_name END,
                    page_type = excluded.page_type,
                    source_url = excluded.source_url,
                    last_seen = excluded.last_seen
            """, (gid, title, price, sales, image, mall_id, mall_name, page_type, source_url, now, now))
            saved += 1
        conn.commit()
        return jsonify({"ok": True, "saved": saved})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/browse", methods=["GET"])
def api_browse() -> Any:
    """浏览列表：按最近见到排序，标注是否已完整采集。"""
    q = (request.args.get("q") or "").strip()
    page_type = (request.args.get("type") or "").strip()
    try:
        limit = min(int(request.args.get("limit") or 500), 2000)
    except ValueError:
        limit = 500
    try:
        offset = max(int(request.args.get("offset") or 0), 0)
    except ValueError:
        offset = 0
    where, params = [], []
    if q:
        where.append("(b.title LIKE ? OR b.goods_id LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if page_type:
        where.append("b.page_type = ?")
        params.append(page_type)
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""
    conn = get_conn()
    try:
        rows = conn.execute(f"""
            SELECT b.*, EXISTS(SELECT 1 FROM goods g WHERE g.goods_id = b.goods_id) AS captured
            FROM browse_items b {sql_where}
            ORDER BY b.last_seen DESC LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()
        total = conn.execute(f"SELECT COUNT(*) FROM browse_items b {sql_where}", params).fetchone()[0]
        items = [{
            "goods_id": r["goods_id"], "title": r["title"] or "", "price": r["price"] or 0,
            "sales": r["sales"] or 0, "image": r["image"] or "", "mall_id": r["mall_id"] or "",
            "mall_name": r["mall_name"] or "", "page_type": r["page_type"] or "",
            "source_url": r["source_url"] or "", "first_seen": r["first_seen"] or "",
            "last_seen": r["last_seen"] or "", "captured": bool(r["captured"]),
        } for r in rows]
        return jsonify({"items": items, "total": total})
    finally:
        conn.close()


@app.route("/api/browse/clear", methods=["POST"])
def api_browse_clear() -> Any:
    conn = get_conn()
    try:
        conn.execute("DELETE FROM browse_items")
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/browse")
def serve_browse_page() -> Any:
    return send_from_directory(str(_BASE_DIR / "web"), "browse.html")

import os
import time
import uuid
import base64
import requests as _requests
from storage import get_sku_items, upsert_sku_items, update_goods_price_range
from exporter import export_json, export_csv, export_excel, export_for_taobao, export_txt, export_with_template, export_dawang, export_dawang_raw, generate_goods_txt, _safe_filename
from importer import preview_file, import_file, import_raw_json_files, import_raw_json_directory, import_goods_json
from wechat_export import export_for_wechat, match_category, check_forbidden_words, auto_fix_forbidden, _load_categories
from web.ai import load_config, save_config, generate_image, edit_image, rewrite_text, generate_copywriting, remove_background, PRESET_PROMPTS


# ==================== 设置 ====================

@app.route("/api/settings", methods=["GET", "PUT"])
def api_settings():
    if request.method == "GET":
        cfg = load_config()
        # 隐藏 API Key 中间部分
        safe = json.loads(json.dumps(cfg))
        for section in ["image_api", "text_api"]:
            if section in safe and "api_key" in safe[section]:
                key = safe[section]["api_key"]
                if len(key) > 8:
                    safe[section]["api_key_masked"] = key[:4] + "****" + key[-4:]
                    safe[section]["api_key_set"] = True
                else:
                    safe[section]["api_key_masked"] = ""
                    safe[section]["api_key_set"] = False
                del safe[section]["api_key"]
        risk_monitor = cfg.get("risk_monitor", {"enabled": False, "interval": 30})
        safe["risk_monitor"] = risk_monitor
        safe["price_markup"] = cfg.get("price_markup", {"enabled": False, "multiplier": 1.5, "fixed_amount": 3.0})
        return jsonify(safe)
    
    data = request.get_json() or {}
    cfg = load_config()
    
    for section in ["image_api", "text_api"]:
        if section in data:
            if section not in cfg:
                cfg[section] = {}
            for key in ["api_key", "base_url", "model"]:
                if key in data[section] and data[section][key]:
                    cfg[section][key] = data[section][key]
    
    # 代理地址
    if "proxy_url" in data:
        cfg["proxy_url"] = data["proxy_url"]
    
    # 微信小店导出配置
    if "wechat_export" in data:
        if "wechat_export" not in cfg:
            cfg["wechat_export"] = {}
        wechat_keys = ["deliver_method", "seven_day_return", "freight_insurance",
                       "default_stock", "brand_id", "listing", "release_mode"]
        for key in wechat_keys:
            if key in data["wechat_export"]:
                cfg["wechat_export"][key] = data["wechat_export"][key]

    if "risk_monitor" in data:
        cfg["risk_monitor"] = data["risk_monitor"]

    if "price_markup" in data:
        cfg["price_markup"] = data["price_markup"]

    save_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/settings/test", methods=["POST"])
def api_settings_test():
    """测试 API 连通性"""
    data = request.get_json() or {}
    api_type = data.get("type", "text")
    cfg = load_config()

    if api_type == "text":
        section = cfg.get("text_api", {})
        api_key = data.get("api_key") or section.get("api_key", "")
        base_url = data.get("base_url") or section.get("base_url", "")
        model = data.get("model") or section.get("model", "")
        if not api_key:
            return jsonify({"ok": False, "error": "未配置文本 API Key"})
        if not base_url:
            return jsonify({"ok": False, "error": "未配置文本 Base URL"})
        try:
            resp = _requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 5},
                timeout=15
            )
            if resp.status_code == 200:
                return jsonify({"ok": True, "model": model})
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:100]}"})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})
    else:
        section = cfg.get("image_api", {})
        api_key = data.get("api_key") or section.get("api_key", "")
        base_url = (data.get("base_url") or section.get("base_url", "https://grsai.dakka.com.cn")).rstrip("/")
        model = data.get("model") or section.get("model", "gpt-image-2")
        if not api_key:
            return jsonify({"ok": False, "error": "未配置图片 API Key"})
        if not base_url:
            return jsonify({"ok": False, "error": "未配置图片 Base URL"})
        try:
            resp = _requests.post(
                f"{base_url}/v1/draw/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "prompt": "test connection", "size": "512x512"},
                timeout=90, stream=True
            )
            if resp.status_code == 200:
                return jsonify({"ok": True, "model": model})
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:150]}"})
        except _requests.exceptions.ConnectionError:
            return jsonify({"ok": False, "error": f"无法连接到 {base_url}，请检查地址"})
        except _requests.exceptions.Timeout:
            return jsonify({"ok": False, "error": "连接超时，请检查网络"})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})


# ==================== 风控扫描 ====================

@app.route("/api/risk-check", methods=["GET"])
def api_risk_check():
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT goods_id, title, price, main_images FROM goods
               WHERE skus IS NULL OR skus = '[]' OR skus = '[] '
               ORDER BY updated_at DESC LIMIT 50"""
        ).fetchall()
        goods = []
        for r in rows:
            imgs = json.loads(r["main_images"] or "[]")
            goods.append({
                "goods_id": r["goods_id"],
                "title": r["title"] or "",
                "price": r["price"] or 0,
                "image": imgs[0] if imgs else "",
            })
        return jsonify({"goods": goods})
    finally:
        conn.close()


@app.route("/api/risk-check/dismiss", methods=["POST"])
def api_risk_check_dismiss():
    return jsonify({"ok": True})


# ==================== 系统日志 ====================

_LOG_FILES = {
    "server": DATA_DIR / "server.log",
    "server_err": DATA_DIR / "server_err.log",
}


@app.route("/api/logs/info", methods=["GET"])
def api_logs_info():
    """获取日志文件信息"""
    result = {}
    for key, path in _LOG_FILES.items():
        if path.exists():
            stat = path.stat()
            result[key] = {
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "exists": True,
            }
        else:
            result[key] = {"size": 0, "modified": None, "exists": False}
    return jsonify(result)


@app.route("/api/logs", methods=["GET"])
def api_logs():
    """获取日志内容"""
    log_type = request.args.get("type", "server")
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(500, max(50, int(request.args.get("page_size", 200))))

    path = _LOG_FILES.get(log_type)
    if not path or not path.exists():
        return jsonify({"lines": [], "total": 0, "file": log_type})

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        total = len(all_lines)
        start = max(0, total - page * page_size)
        end = total - (page - 1) * page_size
        lines = [line.rstrip("\n") for line in all_lines[start:end]]
        lines.reverse()
        return jsonify({"lines": lines, "total": total, "file": log_type})
    except Exception as e:
        return jsonify({"error": str(e), "lines": [], "total": 0, "file": log_type}), 500


@app.route("/api/logs/export", methods=["GET"])
def api_logs_export():
    """导出日志文件"""
    log_type = request.args.get("type", "server")
    path = _LOG_FILES.get(log_type)
    if not path or not path.exists():
        return jsonify({"error": "日志文件不存在"}), 404
    return send_file(
        str(path),
        as_attachment=True,
        download_name=f"{log_type}.log",
        mimetype="text/plain; charset=utf-8",
    )


# ==================== 标签 ====================

@app.route("/api/tags", methods=["GET", "POST"])
def api_tags():
    conn = get_conn()
    if request.method == "GET":
        rows = conn.execute("SELECT * FROM tags ORDER BY name").fetchall()
        conn.close()
        return jsonify([{"id": r["id"], "name": r["name"], "color": r["color"]} for r in rows])
    
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    color = data.get("color", "#3b82f6")
    if not name:
        conn.close()
        return jsonify({"error": "标签名不能为空"}), 400
    try:
        cur = conn.execute("INSERT INTO tags (name, color) VALUES (?, ?)", (name, color))
        conn.commit()
        tag_id = cur.lastrowid
        conn.close()
        return jsonify({"ok": True, "id": tag_id, "name": name, "color": color})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "标签已存在"}), 409


@app.route("/api/tags/<int:tag_id>", methods=["PUT", "DELETE"])
def api_tag_detail(tag_id):
    conn = get_conn()
    if request.method == "DELETE":
        conn.execute("DELETE FROM product_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    data = request.get_json() or {}
    fields, vals = [], []
    if "name" in data:
        fields.append("name = ?"); vals.append(data["name"])
    if "color" in data:
        fields.append("color = ?"); vals.append(data["color"])
    if fields:
        vals.append(tag_id)
        conn.execute(f"UPDATE tags SET {', '.join(fields)} WHERE id = ?", vals)
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/product/<goods_id>/tags", methods=["GET", "POST", "DELETE"])
def api_product_tags(goods_id):
    conn = get_conn()
    if request.method == "GET":
        rows = conn.execute("""
            SELECT t.* FROM tags t JOIN product_tags pt ON t.id = pt.tag_id
            WHERE pt.goods_id = ? ORDER BY t.name
        """, (goods_id,)).fetchall()
        conn.close()
        return jsonify([{"id": r["id"], "name": r["name"], "color": r["color"]} for r in rows])
    
    data = request.get_json() or {}
    tag_ids = data.get("tag_ids", [])
    
    if request.method == "POST":
        for tid in tag_ids:
            try:
                conn.execute("INSERT OR IGNORE INTO product_tags (goods_id, tag_id) VALUES (?, ?)", (goods_id, tid))
            except Exception:
                pass
        conn.commit()
    else:  # DELETE
        for tid in tag_ids:
            conn.execute("DELETE FROM product_tags WHERE goods_id = ? AND tag_id = ?", (goods_id, tid))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ==================== 分组 ====================

@app.route("/api/groups", methods=["GET", "POST"])
def api_groups():
    conn = get_conn()
    if request.method == "GET":
        rows = conn.execute("SELECT * FROM groups ORDER BY sort_order, name").fetchall()
        conn.close()
        return jsonify([{"id": r["id"], "name": r["name"], "parent_id": r["parent_id"], "sort_order": r["sort_order"]} for r in rows])
    
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        conn.close()
        return jsonify({"error": "分组名不能为空"}), 400
    parent_id = data.get("parent_id")
    sort_order = data.get("sort_order", 0)
    cur = conn.execute("INSERT INTO groups (name, parent_id, sort_order) VALUES (?, ?, ?)", (name, parent_id, sort_order))
    conn.commit()
    gid = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": gid})


@app.route("/api/groups/<int:group_id>", methods=["PUT", "DELETE"])
def api_group_detail(group_id):
    conn = get_conn()
    if request.method == "DELETE":
        conn.execute("DELETE FROM product_groups WHERE group_id = ?", (group_id,))
        conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    data = request.get_json() or {}
    fields, vals = [], []
    if "name" in data:
        fields.append("name = ?"); vals.append(data["name"])
    if "parent_id" in data:
        fields.append("parent_id = ?"); vals.append(data["parent_id"])
    if "sort_order" in data:
        fields.append("sort_order = ?"); vals.append(data["sort_order"])
    if fields:
        vals.append(group_id)
        conn.execute(f"UPDATE groups SET {', '.join(fields)} WHERE id = ?", vals)
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/product/<goods_id>/groups", methods=["GET", "POST", "DELETE"])
def api_product_groups(goods_id):
    conn = get_conn()
    if request.method == "GET":
        rows = conn.execute("""
            SELECT g.* FROM groups g JOIN product_groups pg ON g.id = pg.group_id
            WHERE pg.goods_id = ?
        """, (goods_id,)).fetchall()
        conn.close()
        return jsonify([{"id": r["id"], "name": r["name"], "parent_id": r["parent_id"]} for r in rows])
    
    data = request.get_json() or {}
    group_ids = data.get("group_ids", [])
    if request.method == "POST":
        for gid in group_ids:
            try:
                conn.execute("INSERT OR IGNORE INTO product_groups (goods_id, group_id) VALUES (?, ?)", (goods_id, gid))
            except Exception:
                pass
        conn.commit()
    else:
        for gid in group_ids:
            conn.execute("DELETE FROM product_groups WHERE goods_id = ? AND group_id = ?", (goods_id, gid))
        conn.commit()
    conn.close()
    return jsonify({"ok": True})




@app.route("/api/product/<goods_id>/batch-price", methods=["POST"])
def api_batch_price_single(goods_id: str):
    """对单个商品永久批量改价（写入DB），更新所有价格字段+SKU"""
    data = request.get_json() or {}
    multiplier = float(data.get("multiplier", 1.5))
    fixed_amount = float(data.get("fixed_amount", 3.0))

    conn = get_conn()
    row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "商品不存在"}), 404

    now = datetime.now().isoformat()

    # 主价格字段
    price = _apply_markup(row["price"] or 0, multiplier, fixed_amount)
    original_price = _apply_markup(row["original_price"] or 0, multiplier, fixed_amount)
    min_group_price = _apply_markup(row["min_group_price"] or 0, multiplier, fixed_amount)

    # goods.skus JSON
    skus = json.loads(row["skus"] or "[]")
    _apply_markup_to_skus(skus, multiplier, fixed_amount)

    # 重算 price_min / price_max
    all_prices = [s.get("price", 0) for s in skus if isinstance(s, dict) and s.get("price", 0) > 0]
    if not all_prices and price > 0:
        all_prices = [price]
    price_min = min(all_prices) if all_prices else 0
    price_max = max(all_prices) if all_prices else 0

    conn.execute(
        "UPDATE goods SET price=?, original_price=?, min_group_price=?, skus=?, price_min=?, price_max=?, price_modified=1, updated_at=? WHERE goods_id=?",
        (price, original_price, min_group_price, json.dumps(skus, ensure_ascii=False), price_min, price_max, now, goods_id)
    )

    # sku_items 表
    sku_rows = conn.execute("SELECT id, price, original_price FROM sku_items WHERE goods_id=?", (goods_id,)).fetchall()
    for sr in sku_rows:
        new_p = _apply_markup(sr["price"] or 0, multiplier, fixed_amount)
        new_op = _apply_markup(sr["original_price"] or 0, multiplier, fixed_amount)
        conn.execute("UPDATE sku_items SET price=?, original_price=?, updated_at=? WHERE id=?",
                     (new_p, new_op, now, sr["id"]))

    _protect_manual_fields(conn, goods_id, ["price", "original_price", "min_group_price", "price_min", "price_max"], sku_prices=True)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "price": price, "skus_count": len(skus)})

# ==================== 批量操作 ====================

@app.route("/api/products/batch-update", methods=["POST"])
def api_batch_update():
    data = request.get_json() or {}
    ids = data.get("ids", [])
    updates = data.get("updates", {})
    if not ids:
        return jsonify({"error": "请选择商品"}), 400
    
    conn = get_conn()
    placeholders = ",".join(["?"] * len(ids))
    
    # 批量改价（全量：主价格+SKU+sku_items，跳过已改价商品）
    if "price_multiply" in updates or "price_add" in updates:
        multiply = float(updates.get("price_multiply", 1.0))
        add = float(updates.get("price_add", 0))
        skip_modified = updates.get("price_modified_check", True)
        skipped = 0
        now = datetime.now().isoformat()
        for gid in ids:
            row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (gid,)).fetchone()
            if not row:
                continue
            if skip_modified and (row["price_modified"] if "price_modified" in row.keys() else 0):
                skipped += 1
                continue
            # 主价格
            new_price = _apply_markup(row["price"] or 0, multiply, add)
            new_original = _apply_markup(row["original_price"] or 0, multiply, add)
            new_group = _apply_markup(row["min_group_price"] or 0, multiply, add)
            # skus JSON
            skus = json.loads(row["skus"] or "[]")
            _apply_markup_to_skus(skus, multiply, add)
            # price_min / price_max
            all_p = [s.get("price", 0) for s in skus if isinstance(s, dict) and s.get("price", 0) > 0]
            if not all_p and new_price > 0:
                all_p = [new_price]
            pmin = min(all_p) if all_p else 0
            pmax = max(all_p) if all_p else 0
            conn.execute(
                "UPDATE goods SET price=?, original_price=?, min_group_price=?, skus=?, price_min=?, price_max=?, price_modified=1, updated_at=? WHERE goods_id=?",
                (new_price, new_original, new_group, json.dumps(skus, ensure_ascii=False), pmin, pmax, now, gid))
            # sku_items
            for sr in conn.execute("SELECT id, price, original_price FROM sku_items WHERE goods_id=?", (gid,)).fetchall():
                conn.execute("UPDATE sku_items SET price=?, original_price=?, updated_at=? WHERE id=?",
                             (_apply_markup(sr["price"] or 0, multiply, add),
                               _apply_markup(sr["original_price"] or 0, multiply, add), now, sr["id"]))
            _protect_manual_fields(conn, gid, ["price", "original_price", "min_group_price", "price_min", "price_max"], sku_prices=True)
        conn.commit()
    
    # 批量打标签
    if "tags_add" in updates:
        for gid in ids:
            for tid in updates["tags_add"]:
                try:
                    conn.execute("INSERT OR IGNORE INTO product_tags (goods_id, tag_id) VALUES (?, ?)", (gid, tid))
                except Exception:
                    pass
        conn.commit()
    
    if "tags_remove" in updates:
        for gid in ids:
            for tid in updates["tags_remove"]:
                conn.execute("DELETE FROM product_tags WHERE goods_id = ? AND tag_id = ?", (gid, tid))
        conn.commit()
    
    # 批量分组
    if "group_id" in updates:
        gid_val = updates["group_id"]
        for gid in ids:
            try:
                conn.execute("INSERT OR IGNORE INTO product_groups (goods_id, group_id) VALUES (?, ?)", (gid, gid_val))
            except Exception:
                pass
        conn.commit()
    
    conn.close()
    return jsonify({"ok": True, "updated": len(ids) - skipped if "price_multiply" in updates or "price_add" in updates else len(ids), "skipped": skipped if "price_multiply" in updates or "price_add" in updates else 0})


@app.route("/api/products/batch-delete", methods=["POST"])
def api_products_batch_delete():
    try:
        data = request.get_json() or {}
        goods_ids = data.get("goods_ids", [])
        if not goods_ids:
            return jsonify({"error": "未选择商品"}), 400
        conn = get_conn()
        placeholders = ",".join("?" * len(goods_ids))
        _delete_goods(conn, goods_ids)
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "deleted": len(goods_ids)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/products/batch-tag", methods=["POST"])
def api_products_batch_tag():
    try:
        data = request.get_json() or {}
        goods_ids = data.get("goods_ids", [])
        tag_id = data.get("tag_id")
        remove = data.get("remove", False)
        if not goods_ids or not tag_id:
            return jsonify({"error": "参数不完整"}), 400
        conn = get_conn()
        for gid in goods_ids:
            if remove:
                conn.execute("DELETE FROM product_tags WHERE goods_id = ? AND tag_id = ?", (gid, tag_id))
            else:
                existing = conn.execute("SELECT 1 FROM product_tags WHERE goods_id = ? AND tag_id = ?", (gid, tag_id)).fetchone()
                if not existing:
                    conn.execute("INSERT INTO product_tags (goods_id, tag_id) VALUES (?, ?)", (gid, tag_id))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==================== AI 图片 ====================

@app.route("/api/ai/presets", methods=["GET"])
def api_ai_presets():
    return jsonify(PRESET_PROMPTS)


@app.route("/api/ai/generate-image", methods=["POST"])
def api_ai_generate():
    data = request.get_json() or {}
    prompt = data.get("prompt", "").strip()
    goods_id = data.get("goods_id", "")
    size = data.get("size", "1024x1024")
    if not prompt:
        return jsonify({"error": "请输入提示词"}), 400
    if not goods_id:
        goods_id = f"_temp_{int(time.time()*1000)}"
    result = generate_image(prompt, goods_id, size=size)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/ai/edit-image", methods=["POST"])
def api_ai_edit():
    data = request.get_json() or {}
    image_url = data.get("image_url", "")
    prompt = data.get("prompt", "").strip()
    goods_id = data.get("goods_id", "")
    preset = data.get("preset", "")
    size = data.get("size", "1024x1024")
    
    if preset and preset in PRESET_PROMPTS:
        preset_text = PRESET_PROMPTS[preset]
        prompt = f"{preset_text}\n{prompt}" if prompt else preset_text
    if not prompt:
        return jsonify({"error": "请输入提示词或选择预设"}), 400
    if not image_url or not goods_id:
        return jsonify({"error": "缺少图片URL或商品ID"}), 400
    
    result = edit_image(image_url, prompt, goods_id, size=size)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/ai/use-image", methods=["POST"])
def api_ai_use_image():
    """将 AI 生成的图片添加到商品图片列表"""
    data = request.get_json() or {}
    goods_id = data.get("goods_id", "")
    image_path = data.get("image_path", "")
    target = data.get("target", "main")  # main or detail

    if target not in _IMAGE_TARGETS:
        return jsonify({"error": "target 只能是 main 或 detail"}), 400
    if not goods_id or not image_path:
        return jsonify({"error": "缺少参数"}), 400
    
    if image_path.startswith(("http://", "https://")):
        from web.ai import _download_and_save
        image_path = _download_and_save(image_path, valid_goods_id(goods_id))
        if not image_path:
            raise ValueError("AI图片尚未成功保存")
    image_path = image_path.removeprefix("/api/ai-image/")
    path = data_path(image_path, _AI_IMAGE_DIRS)
    if not path.is_file() or path.suffix.lower() not in _IMAGE_EXTENSIONS:
        raise ValueError("AI图片不存在")
    # 构建可访问的 URL
    image_url = f"/api/ai-image/{image_path}"
    
    conn = get_conn()
    row = conn.execute(f"SELECT {target}_images FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "商品不存在"}), 404
    
    images = json.loads(row[0] or "[]")
    images.append(image_url)
    conn.execute(f"UPDATE goods SET {target}_images = ?, updated_at = ? WHERE goods_id = ?",
                (json.dumps(images), datetime.now().isoformat(), goods_id))
    _protect_manual_fields(conn, goods_id, [f"{target}_images"])
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "images": images})


def _safe_data_path(base: Path, *parts: str) -> Path | None:
    """将相对路径解析到 base 目录下，拒绝目录穿越。"""
    try:
        full = base.joinpath(*parts).resolve()
        full.relative_to(base.resolve())
    except (ValueError, OSError):
        return None
    return full


@app.route("/api/ai-image/<path:filepath>")
def serve_ai_image(filepath):
    """提供 AI 生成图片的访问（仅限 ai_images/ai_uploads 目录下的图片）"""
    full_path = _safe_data_path(DATA_DIR, filepath)
    if full_path is None:
        return "Not found", 404
    rel = full_path.relative_to(DATA_DIR.resolve())
    if (len(rel.parts) < 2 or rel.parts[0] not in _AI_IMAGE_DIRS
            or full_path.suffix.lower() not in _IMAGE_EXTENSIONS):
        return "Not found", 404
    if not full_path.is_file():
        return "Not found", 404
    return send_file(str(full_path))


@app.route("/api/ai/batch-generate", methods=["POST"])
def api_ai_batch_generate():
    """AI 批量作图"""
    data = request.get_json() or {}
    images = data.get("images", [])
    preset = data.get("preset", "")
    if not images:
        return jsonify({"error": "未提供图片"}), 400
    if not preset or preset not in PRESET_PROMPTS:
        return jsonify({"error": "未选择模板"}), 400

    prompt = PRESET_PROMPTS[preset]
    results = {}
    for image_url in images:
        try:
            result = edit_image(image_url, prompt, '_batch')
            if "error" in result:
                results[image_url] = {"urls": [], "error": result["error"]}
            else:
                results[image_url] = {"urls": result.get("urls", [])}
        except Exception as e:
            results[image_url] = {"urls": [], "error": str(e)}
    return jsonify({"results": results})


@app.route("/api/ai/remove-bg", methods=["POST"])
def api_ai_remove_bg():
    try:
        data = request.get_json() or {}
        image_url = data.get("image_url", "")
        if not image_url:
            return jsonify({"error": "请提供图片"}), 400
        result_url = remove_background(image_url)
        return jsonify({"url": result_url})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/fill-background", methods=["POST"])
def api_fill_background():
    import io as _io
    from PIL import Image as _PILImage, ImageDraw as _PILImageDraw

    data = request.get_json(force=True, silent=True) or {}
    image_url = data.get("image_url", "")
    fill_color = data.get("fill_color", "#ffffff")
    fill_type = data.get("fill_type", "solid")
    gradient_end = data.get("gradient_end", "#e0e0e0")

    if not image_url:
        return jsonify({"error": "image_url is required"}), 400

    try:
        image_bytes, _ = read_image(image_url)
        img = _PILImage.open(_io.BytesIO(image_bytes)).convert("RGBA")
        w, h = img.size

        bg = _PILImage.new("RGBA", (w, h), (0, 0, 0, 0))

        if fill_type == "gradient_top_bottom":
            r1, g1, b1 = _hex_to_rgb(fill_color)
            r2, g2, b2 = _hex_to_rgb(gradient_end)
            draw = _PILImageDraw.Draw(bg)
            for y in range(h):
                ratio = y / h
                r = int(r1 + (r2 - r1) * ratio)
                g = int(g1 + (g2 - g1) * ratio)
                b = int(b1 + (b2 - b1) * ratio)
                draw.line([(0, y), (w, y)], fill=(r, g, b, 255))
        else:
            r, g, b = _hex_to_rgb(fill_color)
            draw = _PILImageDraw.Draw(bg)
            draw.rectangle([0, 0, w, h], fill=(r, g, b, 255))

        bg.paste(img, mask=img.split()[3])

        out_path = DATA_DIR / "ai_uploads" / f"filled_{int(time.time() * 1000)}.png"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        bg.save(str(out_path), "PNG")

        return jsonify({
            "ok": True,
            "url": f"/api/ai-image/ai_uploads/{out_path.name}",
        })
    except Exception as e:
        return jsonify({"error": f"Fill background failed: {e}"}), 500


@app.route("/api/compare", methods=["POST"])
def api_compare():
    try:
        data = request.get_json() or {}
        goods_ids = data.get("goods_ids", [])
        if not goods_ids or len(goods_ids) < 2:
            return jsonify({"error": "请选择至少 2 个商品"}), 400
        goods_ids = goods_ids[:4]
        conn = get_conn()
        results = []
        for gid in goods_ids:
            row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (gid,)).fetchone()
            if row:
                results.append(_row_to_goods(row))
            else:
                results.append({"goods_id": gid, "title": f"商品 {gid} 不存在", "_error": True})
        conn.close()
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/suggest-prompt", methods=["POST"])
def api_ai_suggest_prompt():
    from .ai import suggest_prompt
    data = request.get_json() or {}
    image_url = data.get("image_url", "")
    if not image_url:
        return jsonify({"error": "请提供图片"}), 400
    result = suggest_prompt(image_url)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/ai/copywriting", methods=["POST"])
def api_ai_copywriting():
    data = request.get_json() or {}
    goods_id = data.get("goods_id", "")
    copy_type = data.get("copy_type", "all")
    style = data.get("style", "default")
    custom_prompt = data.get("custom_prompt", "")
    if not goods_id:
        return jsonify({"error": "请选择商品"}), 400
    conn = get_conn()
    row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "商品不存在"}), 404
    goods_info = {
        "title": row["title"] or "",
        "subtitle": row["subtitle"] or "",
        "selling_points": json.loads(row["selling_points"] or "[]"),
        "description": row["description"] or "",
        "attributes": json.loads(row["attributes"] or "{}"),
    }
    result = generate_copywriting(goods_info, copy_type, style, custom_prompt)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/product/<goods_id>/copywriting", methods=["POST"])
def api_product_apply_copywriting(goods_id: str):
    data = request.get_json() or {}
    fields = data.get("fields", {})
    if not fields:
        return jsonify({"error": "无有效字段"}), 400
    conn = get_conn()
    updates = []
    params = []
    if "title" in fields:
        updates.append("title = ?")
        params.append(fields["title"])
    if "subtitle" in fields:
        updates.append("subtitle = ?")
        params.append(fields["subtitle"])
    if "selling_points" in fields:
        updates.append("selling_points = ?")
        params.append(json.dumps(fields["selling_points"], ensure_ascii=False))
    if "description" in fields:
        updates.append("description = ?")
        params.append(fields["description"])
    if not updates:
        conn.close()
        return jsonify({"error": "无有效字段"}), 400
    updates.append("updated_at = ?")
    params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    params.append(goods_id)
    conn.execute(f"UPDATE goods SET {', '.join(updates)} WHERE goods_id = ?", params)
    _protect_manual_fields(conn, goods_id, set(fields) & {"title", "subtitle", "selling_points", "description"})
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/export-templates", methods=["GET"])
def api_get_export_templates():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM export_templates ORDER BY is_preset DESC, id").fetchall()
    conn.close()
    return jsonify([{
        "id": r["id"], "name": r["name"],
        "fields": json.loads(r["fields"]),
        "column_map": json.loads(r["column_map"]),
        "is_preset": bool(r["is_preset"]),
    } for r in rows])


@app.route("/api/export-templates", methods=["POST"])
def api_create_export_template():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    fields = data.get("fields", [])
    column_map = data.get("column_map", {})
    if not name or not fields:
        return jsonify({"error": "名称和字段不能为空"}), 400
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO export_templates (name, fields, column_map) VALUES (?, ?, ?)",
        (name, json.dumps(fields, ensure_ascii=False), json.dumps(column_map, ensure_ascii=False))
    )
    conn.commit()
    tid = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": tid})


@app.route("/api/export-templates/<int:tid>", methods=["PUT"])
def api_update_export_template(tid: int):
    data = request.get_json() or {}
    conn = get_conn()
    row = conn.execute("SELECT * FROM export_templates WHERE id = ?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "模板不存在"}), 404
    if row["is_preset"]:
        conn.close()
        return jsonify({"error": "预设模板不可修改"}), 400
    name = data.get("name", row["name"])
    fields = json.dumps(data.get("fields", json.loads(row["fields"])), ensure_ascii=False)
    column_map = json.dumps(data.get("column_map", json.loads(row["column_map"])), ensure_ascii=False)
    conn.execute("UPDATE export_templates SET name=?, fields=?, column_map=? WHERE id=?", (name, fields, column_map, tid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/export-templates/<int:tid>", methods=["DELETE"])
def api_delete_export_template(tid: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM export_templates WHERE id = ?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "模板不存在"}), 404
    if row["is_preset"]:
        conn.close()
        return jsonify({"error": "预设模板不可删除"}), 400
    conn.execute("DELETE FROM export_templates WHERE id = ?", (tid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ==================== 商品监控 ====================

@app.route("/api/monitor", methods=["GET"])
def api_monitor_list():
    try:
        conn = get_conn()
        rows = conn.execute("""
            SELECT m.*, g.title, g.main_images
            FROM monitor_list m
            JOIN goods g ON m.goods_id = g.goods_id
            WHERE m.status = 'active'
            ORDER BY m.created_at DESC
        """).fetchall()
        result = []
        for r in rows:
            latest = conn.execute(
                "SELECT price, stock, sales, observed_at FROM monitor_history WHERE goods_id = ? AND observed_at IS NOT NULL ORDER BY observed_at DESC, id DESC LIMIT 1",
                (r["goods_id"],)
            ).fetchone()
            prev = conn.execute(
                "SELECT price, stock, sales FROM monitor_history WHERE goods_id = ? AND observed_at IS NOT NULL ORDER BY observed_at DESC, id DESC LIMIT 1 OFFSET 1",
                (r["goods_id"],)
            ).fetchone()
            price_change = None
            stock_change = None
            sales_change = None
            if latest and prev:
                if prev["price"] and latest["price"]:
                    price_change = round(latest["price"] - prev["price"], 2)
                if prev["stock"] is not None and latest["stock"] is not None:
                    stock_change = latest["stock"] - prev["stock"]
                if prev["sales"] and latest["sales"]:
                    sales_change = latest["sales"] - prev["sales"]
            elif latest:
                price_change = 0
                stock_change = 0
                sales_change = 0
            try:
                images = json.loads(r["main_images"] or "[]")
            except (json.JSONDecodeError, TypeError):
                images = []
            result.append({
                "goods_id": r["goods_id"],
                "title": r["title"] or "",
                "main_images": images,
                "frequency": r["frequency"],
                "last_check": latest["observed_at"] if latest else None,
                "next_check": r["next_check"],
                "status": r["status"],
                "latest_price": latest["price"] if latest else None,
                "latest_stock": latest["stock"] if latest else None,
                "latest_sales": latest["sales"] if latest else None,
                "price_change": price_change,
                "stock_change": stock_change,
                "sales_change": sales_change,
            })
        conn.close()
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/monitor", methods=["POST"])
def api_monitor_add():
    try:
        data = request.get_json() or {}
        goods_id = data.get("goods_id", "")
        frequency = data.get("frequency", "daily")
        if not goods_id:
            return jsonify({"error": "请选择商品"}), 400
        conn = get_conn()
        if not conn.execute("SELECT 1 FROM goods WHERE goods_id=?", (goods_id,)).fetchone():
            conn.close()
            return jsonify({"error": "商品不存在"}), 404
        existing = conn.execute("SELECT goods_id FROM monitor_list WHERE goods_id = ?", (goods_id,)).fetchone()
        if existing:
            conn.close()
            return jsonify({"error": "已在监控列表中"}), 400
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        freq_hours = {"daily": 24, "12h": 12, "6h": 6}.get(frequency, 24)
        next_check = (datetime.now() + timedelta(hours=freq_hours)).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO monitor_list (goods_id, frequency, next_check) VALUES (?, ?, ?)",
            (goods_id, frequency, next_check)
        )
        conn.commit()
        conn.close()
        from monitor_scheduler import _check_and_refresh
        _check_and_refresh()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/monitor/<goods_id>", methods=["DELETE"])
def api_monitor_remove(goods_id: str):
    try:
        conn = get_conn()
        conn.execute("DELETE FROM monitor_list WHERE goods_id = ?", (goods_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/monitor/<goods_id>/frequency", methods=["PUT"])
def api_monitor_update_frequency(goods_id: str):
    try:
        data = request.get_json() or {}
        frequency = data.get("frequency", "daily")
        freq_hours = {"daily": 24, "12h": 12, "6h": 6}.get(frequency, 24)
        next_check = (datetime.now() + timedelta(hours=freq_hours)).strftime("%Y-%m-%d %H:%M:%S")
        conn = get_conn()
        conn.execute("UPDATE monitor_list SET frequency = ?, next_check = ? WHERE goods_id = ?",
                     (frequency, next_check, goods_id))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/monitor/<goods_id>/history", methods=["GET"])
def api_monitor_history(goods_id: str):
    try:
        limit = min(100, max(1, int(request.args.get("limit", 30))))
        conn = get_conn()
        rows = conn.execute(
            "SELECT price, stock, sales, observed_at AS checked_at FROM monitor_history WHERE goods_id = ? AND observed_at IS NOT NULL ORDER BY observed_at DESC, id DESC LIMIT ?",
            (goods_id, limit)
        ).fetchall()
        conn.close()
        return jsonify([{
            "checked_at": r["checked_at"],
            "price": r["price"],
            "stock": r["stock"],
            "sales": r["sales"],
        } for r in rows])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/monitor/refresh", methods=["POST"])
def api_monitor_refresh():
    from monitor_scheduler import _check_and_refresh
    return jsonify({"ok": True, "updated": _check_and_refresh(), "mode": "observations_only"})


@app.route("/api/ai/upload-image", methods=["POST"])
def api_ai_upload_image():
    """AI 编辑器独立上传图片"""
    if "file" not in request.files:
        return jsonify({"error": "没有文件"}), 400
    file = request.files["file"]
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _IMAGE_EXTENSIONS:
        return jsonify({"error": "仅支持 jpg/png/webp/gif 图片"}), 400
    upload_dir = DATA_DIR / "ai_uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"upload_{int(time.time() * 1000)}{ext}"
    filepath = upload_dir / filename
    content = file.read()
    image_type(content)
    from PIL import Image
    with Image.open(io.BytesIO(content)) as image:
        image.verify()
    filepath.write_bytes(content)
    return jsonify({"ok": True, "url": f"/api/ai-image/ai_uploads/{filename}"})


@app.route("/api/products/search")
def api_products_search():
    """搜索商品（AI 编辑器使用）"""
    keyword = request.args.get("keyword", "").strip()
    tag_id = request.args.get("tag", "").strip()
    group_id = request.args.get("group", "").strip()
    min_price = request.args.get("min_price", "").strip()
    max_price = request.args.get("max_price", "").strip()
    min_sales = request.args.get("min_sales", "").strip()
    max_sales = request.args.get("max_sales", "").strip()
    shop = request.args.get("shop", "").strip()
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(50, max(1, int(request.args.get("page_size", 30))))
    offset = (page - 1) * page_size
    conn = get_conn()

    where_parts = []
    params = []

    if keyword:
        like = f"%{keyword}%"
        where_parts.append("(g.title LIKE ? OR g.shop_name LIKE ?)")
        params.extend([like, like])

    if tag_id:
        where_parts.append("g.goods_id IN (SELECT goods_id FROM product_tags WHERE tag_id = ?)")
        params.append(int(tag_id))

    if group_id:
        where_parts.append("g.goods_id IN (SELECT goods_id FROM product_groups WHERE group_id = ?)")
        params.append(int(group_id))

    if min_price:
        where_parts.append("g.price >= ?")
        params.append(float(min_price))

    if max_price:
        where_parts.append("g.price <= ?")
        params.append(float(max_price))

    if min_sales:
        where_parts.append("g.sales >= ?")
        params.append(int(min_sales))

    if max_sales:
        where_parts.append("g.sales <= ?")
        params.append(int(max_sales))

    if shop:
        where_parts.append("g.shop_name LIKE ?")
        params.append(f"%{shop}%")

    where_sql = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

    count_row = conn.execute(f"SELECT COUNT(*) FROM goods g{where_sql}", params).fetchone()
    total = count_row[0] if count_row else 0

    rows = conn.execute(
        f"SELECT g.goods_id, g.title, g.main_images, g.detail_images, g.sku_images "
        f"FROM goods g{where_sql} ORDER BY g.crawl_time DESC LIMIT ? OFFSET ?",
        params + [page_size, offset]
    ).fetchall()
    conn.close()

    return jsonify({
        "items": [{
            "goods_id": r["goods_id"],
            "title": r["title"] or "",
            "main_images": json.loads(r["main_images"] or "[]"),
            "detail_images": json.loads(r["detail_images"] or "[]"),
            "sku_images": json.loads(r["sku_images"] or "[]"),
        } for r in rows],
        "total": total,
    })


@app.route("/api/ai/history")
def api_ai_history():
    """AI 生成历史"""
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(50, max(1, int(request.args.get("page_size", 20))))
    offset = (page - 1) * page_size
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM ai_images").fetchone()[0]
    rows = conn.execute(
        "SELECT * FROM ai_images ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (page_size, offset)
    ).fetchall()
    conn.close()
    return jsonify({
        "items": [{
            "id": r["id"], "goods_id": r["goods_id"], "source_url": r["source_url"],
            "prompt": r["prompt"], "result_path": r["result_path"],
            "model": r["model"], "created_at": r["created_at"],
        } for r in rows],
        "total": total,
    })


@app.route("/api/ai/history", methods=["DELETE"])
def api_ai_history_delete():
    data = request.get_json() or {}
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "请提供要删除的ID列表"}), 400
    conn = get_conn()
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT id, result_path FROM ai_images WHERE id IN ({placeholders})", ids).fetchall()
    for r in rows:
        if r["result_path"]:
            file_path = data_path(r["result_path"], _AI_IMAGE_DIRS)
            if file_path.exists():
                file_path.unlink()
    conn.execute(f"DELETE FROM ai_images WHERE id IN ({placeholders})", ids)
    deleted_count = len(rows)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "deleted_count": deleted_count})


@app.route("/api/product/<goods_id>/ai-images", methods=["GET"])
def api_product_ai_images(goods_id):
    """获取商品的 AI 生成图片列表"""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM ai_images WHERE goods_id = ? ORDER BY created_at DESC", (goods_id,)
    ).fetchall()
    conn.close()
    return jsonify([{
        "id": r["id"], "source_url": r["source_url"], "prompt": r["prompt"],
        "result_path": r["result_path"], "model": r["model"], "created_at": r["created_at"]
    } for r in rows])


# ==================== AI 文案改写 ====================

@app.route("/api/ai/rewrite", methods=["POST"])
def api_ai_rewrite():
    data = request.get_json() or {}
    goods_id = data.get("goods_id", "")
    targets = data.get("targets", ["title", "subtitle", "selling_points", "description"])
    style = data.get("style", "default")
    custom_prompt = data.get("custom_prompt")
    
    if not goods_id:
        return jsonify({"error": "缺少商品ID"}), 400
    
    conn = get_conn()
    row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "商品不存在"}), 404
    
    goods_info = {
        "title": row["title"] or "",
        "subtitle": row["subtitle"] or "",
        "description": row["description"] or "",
        "selling_points": json.loads(row["selling_points"] or "[]"),
    }
    
    result = rewrite_text(goods_info, targets, style, custom_prompt)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


# ==================== 图片管理 ====================

@app.route("/api/product/<goods_id>/images/upload", methods=["POST"])
def api_upload_image(goods_id):
    """上传图片到商品"""
    goods_id = valid_goods_id(goods_id)
    conn = get_conn()
    exists = conn.execute("SELECT 1 FROM goods WHERE goods_id=?", (goods_id,)).fetchone()
    conn.close()
    if not exists:
        return jsonify({"error": "商品不存在"}), 404
    if "file" not in request.files:
        return jsonify({"error": "没有文件"}), 400
    
    file = request.files["file"]
    target = request.form.get("target", "main")
    if target not in _IMAGE_TARGETS:
        return jsonify({"error": "target 只能是 main 或 detail"}), 400
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _IMAGE_EXTENSIONS:
        return jsonify({"error": "仅支持 jpg/png/webp/gif 图片"}), 400

    # 保存文件
    img_dir = DATA_DIR / "images" / goods_id
    img_dir.mkdir(parents=True, exist_ok=True)

    filename = f"upload_{int(time.time() * 1000)}{ext}"
    filepath = img_dir / filename
    content = file.read()
    image_type(content)
    from PIL import Image
    with Image.open(io.BytesIO(content)) as image:
        image.verify()
    filepath.write_bytes(content)
    
    image_url = f"/api/local-image/{goods_id}/{filename}"
    
    # 更新数据库
    conn = get_conn()
    row = conn.execute(f"SELECT {target}_images FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "商品不存在"}), 404
    
    images = json.loads(row[0] or "[]")
    images.append(image_url)
    conn.execute(f"UPDATE goods SET {target}_images = ?, updated_at = ? WHERE goods_id = ?",
                (json.dumps(images), datetime.now().isoformat(), goods_id))
    _protect_manual_fields(conn, goods_id, [f"{target}_images"])
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "url": image_url, "images": images})


@app.route("/api/local-image/<goods_id>/<filename>")
def serve_local_image(goods_id, filename):
    """提供本地上传图片的访问"""
    images_root = DATA_DIR / "images"
    path = _safe_data_path(images_root, goods_id, filename)
    if (path is None or not path.is_file()
            or path.suffix.lower() not in _IMAGE_EXTENSIONS):
        return "Not found", 404
    return send_file(str(path))


@app.route("/api/product/<goods_id>/images/reorder", methods=["PUT"])
def api_reorder_images(goods_id):
    """图片排序"""
    data = request.get_json() or {}
    target = data.get("target", "main")
    new_order = data.get("order", [])
    if target not in _IMAGE_TARGETS:
        return jsonify({"error": "target 只能是 main 或 detail"}), 400
    if not isinstance(new_order, list):
        return jsonify({"error": "order 必须是数组"}), 400

    conn = get_conn()
    conn.execute(f"UPDATE goods SET {target}_images = ?, updated_at = ? WHERE goods_id = ?",
                (json.dumps(new_order), datetime.now().isoformat(), goods_id))
    _protect_manual_fields(conn, goods_id, [f"{target}_images"])
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ==================== 去重检测 ====================

@app.route("/api/products/duplicates", methods=["GET"])
def api_duplicates():
    """检测重复商品"""
    conn = get_conn()
    rows = conn.execute("SELECT goods_id, title FROM goods ORDER BY crawl_time DESC").fetchall()
    conn.close()
    
    goods_list = [{"goods_id": r["goods_id"], "title": r["title"] or ""} for r in rows]
    
    # 精确 goods_id 重复
    id_groups = {}
    for g in goods_list:
        gid = g["goods_id"]
        if gid not in id_groups:
            id_groups[gid] = []
        id_groups[gid].append(g)
    
    duplicates = []
    for gid, group in id_groups.items():
        if len(group) > 1:
            duplicates.append({"type": "exact_id", "goods_id": gid, "items": group})
    
    # 标题相似度（简单：完全相同或前20字相同）
    title_groups = {}
    for g in goods_list:
        key = g["title"][:20] if len(g["title"]) > 10 else g["title"]
        if key:
            if key not in title_groups:
                title_groups[key] = []
            title_groups[key].append(g)
    
    for key, group in title_groups.items():
        if len(group) > 1:
            ids_in_group = set(g["goods_id"] for g in group)
            # 避免与精确ID重复的重复报告
            already_reported = any(
                d["goods_id"] in ids_in_group for d in duplicates if d["type"] == "exact_id"
            )
            if not already_reported:
                duplicates.append({"type": "similar_title", "title_prefix": key, "items": group})
    
    return jsonify({"duplicates": duplicates, "total_groups": len(duplicates)})


@app.route("/api/wechat-categories", methods=["GET"])
def api_wechat_categories() -> Any:
    data = _load_categories()
    return jsonify(data.get("categories", []))


@app.route("/api/wechat-check-compliance", methods=["POST"])
def api_wechat_check_compliance() -> Any:
    data = request.get_json() or {}
    title = data.get("title", "")
    if not title:
        return jsonify({"error": "请提供标题"}), 400
    forbidden = check_forbidden_words(title)
    category = match_category(title)
    fixed_title, changes = auto_fix_forbidden(title)
    return jsonify({
        "forbidden_words": forbidden,
        "has_violation": len(forbidden) > 0,
        "suggested_category": category,
        "original_title": title,
        "fixed_title": fixed_title,
        "fix_changes": changes,
    })


@app.route("/api/products/<goods_id>/skus")
def api_product_skus(goods_id):
    sku_items = get_sku_items(goods_id)
    return jsonify({"goods_id": goods_id, "skus": sku_items})


if __name__ == "__main__":
    from storage import init_db
    init_db()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    start_scheduler()
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)





