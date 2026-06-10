"""
Web 管理后台 - Flask API 服务 + React SPA
"""

import json
import logging
import sys
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, request, jsonify, send_file, send_from_directory

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BASE_DIR))

DIST_DIR: Path = _BASE_DIR / "frontend" / "dist"
DATA_DIR: Path = _BASE_DIR / "data"
DB_PATH: Path = DATA_DIR / "goods.db"
IMAGES_DIR: Path = DATA_DIR / "images"
EXPORT_DIR: Path = DATA_DIR / "exports"

app = Flask(__name__, static_folder=None)


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
        "skus": json.loads(r["skus"] or "[]"),
        "description": r["description"] or "",
        "attributes": json.loads(r["attributes"] or "{}"),
        "source_url": r["source_url"] or "",
        "crawl_time": r["crawl_time"] or "",
    }


# ==================== React SPA ====================

@app.route("/")
@app.route("/products")
@app.route("/product/<path:_id>")
@app.route("/export")
@app.route("/settings")
def serve_spa(_id: str = "") -> Any:
    return send_from_directory(str(DIST_DIR), "index.html")


@app.route("/assets/<path:filename>")
def serve_assets(filename: str) -> Any:
    return send_from_directory(str(DIST_DIR / "assets"), filename)


@app.route("/favicon.ico")
def serve_favicon() -> Any:
    return send_from_directory(str(DIST_DIR), "favicon.ico")


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


@app.route("/api/products")
def api_products() -> dict:
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, max(1, int(request.args.get("page_size", 20))))
    keyword = request.args.get("keyword", "").strip()
    offset = (page - 1) * page_size
    conn = get_conn()
    if keyword:
        like = f"%{keyword}%"
        total = conn.execute(
            "SELECT COUNT(*) FROM goods WHERE title LIKE ? OR shop_name LIKE ?", (like, like)
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM goods WHERE title LIKE ? OR shop_name LIKE ? "
            "ORDER BY crawl_time DESC LIMIT ? OFFSET ?", (like, like, page_size, offset)
        ).fetchall()
    else:
        total = conn.execute("SELECT COUNT(*) FROM goods").fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM goods ORDER BY crawl_time DESC LIMIT ? OFFSET ?", (page_size, offset)
        ).fetchall()
    conn.close()
    return jsonify({"items": [_row_to_goods(r) for r in rows], "total": total, "page": page, "page_size": page_size})


@app.route("/api/product/<goods_id>", methods=["GET", "PUT", "DELETE"])
def api_product_detail(goods_id: str) -> Any:
    conn = get_conn()
    if request.method == "DELETE":
        conn.execute("DELETE FROM goods WHERE goods_id = ?", (goods_id,))
        conn.commit(); conn.close()
        return jsonify({"ok": True, "deleted": goods_id})
    if request.method == "PUT":
        data = request.get_json() or {}
        fields, values = [], []
        updatable = ["title","subtitle","price","original_price","sales","sold_quantity","shop_name","description"]
        json_list_fields = ["main_images","detail_images","sku_images"]
        for f in updatable:
            if f in data: fields.append(f"{f} = ?"); values.append(data[f])
        if "selling_points" in data:
            fields.append("selling_points = ?"); values.append(json.dumps(data["selling_points"], ensure_ascii=False))
        for jf in json_list_fields:
            if jf in data: fields.append(f"{jf} = ?"); values.append(json.dumps(data[jf], ensure_ascii=False))
        if not fields: conn.close(); return jsonify({"error": "没有要更新的字段"}), 400
        fields.append("updated_at = ?"); values.append(datetime.now().isoformat()); values.append(goods_id)
        conn.execute(f"UPDATE goods SET {', '.join(fields)} WHERE goods_id = ?", values)
        conn.commit()
        r = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
        conn.close()
        if not r: return jsonify({"error": "商品不存在"}), 404
        return jsonify(_row_to_goods(r))
    r = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    if not r: return jsonify({"error": "商品不存在"}), 404
    return jsonify(_row_to_goods(r))


@app.route("/api/export", methods=["POST"])
def api_export() -> Any:
    data = request.get_json() or {}
    format_type = data.get("format", "json")
    goods_ids = data.get("ids", [])
    try:
        func_map = {"json": export_json, "csv": export_csv, "excel": export_excel, "taobao": export_for_taobao, "txt": export_txt}
        func = func_map.get(format_type)
        if not func: return jsonify({"error": f"不支持的格式: {format_type}"}), 400
        filepath = func(goods_ids if goods_ids else None)
        return send_file(str(filepath), as_attachment=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/package", methods=["POST"])
def api_package() -> Any:
    data = request.get_json() or {}
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
        if not rows: return jsonify({"error": "没有可打包的商品"}), 400
        goods_list = [_row_to_goods(r) for r in rows]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if len(goods_list) == 1 and goods_list[0].get("title"):
            _t = goods_list[0]["title"][:40]
            for ch in '/:*?"<>|': _t = _t.replace(ch, "_")
            zip_name = f"{_t}.zip"
        else:
            zip_name = f"商品采集_{timestamp}.zip"
        zip_path = EXPORT_DIR / zip_name
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("数据/goods.json", json.dumps(goods_list, ensure_ascii=False, indent=2))
            if include_images:
                import requests as _req
                _dl_headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.pinduoduo.com/"}
                for g in goods_list:
                    gid = g["goods_id"]
                    safe_title = _safe_filename(g.get("title", ""), 30)
                    img_dir = f"图片/{safe_title}_{gid}"
                    all_imgs = g["main_images"] + g["detail_images"]
                    for idx, url in enumerate(all_imgs):
                        if not url or not url.startswith("http"): continue
                        try:
                            resp = _req.get(url, headers=_dl_headers, timeout=15, verify=False)
                            if resp.status_code == 200 and len(resp.content) > 100:
                                fname = f"主图_{idx+1}.jpg" if idx < len(g["main_images"]) else f"详情图_{idx-len(g['main_images'])+1}.jpg"
                                zf.writestr(f"{img_dir}/{fname}", resp.content)
                        except Exception: pass
                    if all_imgs:
                        zf.writestr(f"{img_dir}/图片URL索引.txt", "\n".join(all_imgs))
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
                    ai_path = DATA_DIR / ai_row[0]
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
        return send_file(str(zip_path), as_attachment=True, download_name=zip_name)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/products/delete", methods=["POST"])
def api_products_delete() -> Any:
    data = request.get_json() or {}
    ids = data.get("ids", [])
    if not ids: return jsonify({"error": "请选择要删除的商品"}), 400
    conn = get_conn()
    placeholders = ",".join("?" * len(ids))
    conn.execute(f"DELETE FROM goods WHERE goods_id IN ({placeholders})", ids)
    conn.commit(); conn.close()
    return jsonify({"ok": True, "deleted_count": len(ids)})


@app.route("/api/ingest", methods=["POST", "OPTIONS"])
def api_ingest() -> Any:
    if request.method == "OPTIONS": return "", 204
    data = request.get_json() or {}
    goods_id = str(data.get("goods_id", "")).strip()
    if not goods_id: return jsonify({"error": "missing goods_id"}), 400
    title = data.get("title", "").strip()
    images = data.get("main_images", [])
    if not title and not images: return jsonify({"error": "no title or images"}), 400
    conn = get_conn()
    now = datetime.now().isoformat()
    try:
        conn.execute("""
            INSERT OR REPLACE INTO goods
            (goods_id, title, subtitle, selling_points, price, original_price, min_group_price,
             sales, sold_quantity, shop_name, shop_id, shop_logo,
             main_images, detail_images, sku_images, specs, skus,
             description, attributes, source_url, crawl_time, updated_at, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            goods_id, data.get("title",""), data.get("subtitle",""),
            json.dumps(data.get("selling_points",[]), ensure_ascii=False),
            data.get("price",0), data.get("original_price",0), data.get("min_group_price",0),
            data.get("sales",0), data.get("sold_quantity",0),
            data.get("shop_name",""), data.get("shop_id",""), data.get("shop_logo",""),
            json.dumps(data.get("main_images",[]), ensure_ascii=False),
            json.dumps(data.get("detail_images",[]), ensure_ascii=False),
            json.dumps(data.get("sku_images",[]), ensure_ascii=False),
            json.dumps(data.get("specs",{}), ensure_ascii=False),
            json.dumps(data.get("skus",[]), ensure_ascii=False),
            data.get("description",""),
            json.dumps(data.get("attributes",{}), ensure_ascii=False),
            data.get("source_url",""), now, now,
            json.dumps(data, ensure_ascii=False),
        ))
        conn.commit()
        return jsonify({"ok": True, "goods_id": goods_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

import os
import time
import uuid
import base64
import requests as _requests
from exporter import export_json, export_csv, export_excel, export_for_taobao, export_txt, generate_goods_txt, _safe_filename
from web.ai import load_config, save_config, generate_image, edit_image, rewrite_text, PRESET_PROMPTS


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
        if not section.get("api_key"):
            return jsonify({"ok": False, "error": "未配置文本 API Key"})
        try:
            resp = _requests.post(
                f"{section['base_url']}/chat/completions",
                headers={"Authorization": f"Bearer {section['api_key']}", "Content-Type": "application/json"},
                json={"model": section["model"], "messages": [{"role": "user", "content": "hi"}], "max_tokens": 5},
                timeout=15, verify=False
            )
            if resp.status_code == 200:
                return jsonify({"ok": True, "model": section["model"]})
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:100]}"})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})
    else:
        section = cfg.get("image_api", {})
        if not section.get("api_key"):
            return jsonify({"ok": False, "error": "未配置图片 API Key"})
        base = section.get("base_url", "https://grsai.dakka.com.cn").rstrip("/")
        try:
            resp = _requests.post(
                f"{base}/v1/draw/completions",
                headers={"Authorization": f"Bearer {section['api_key']}", "Content-Type": "application/json"},
                json={"model": section.get("model", "gpt-image-2"), "prompt": "test connection", "size": "512x512"},
                timeout=90, stream=True, verify=False
            )
            if resp.status_code == 200:
                return jsonify({"ok": True, "model": section.get("model", "gpt-image-2")})
            return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:150]}"})
        except _requests.exceptions.ConnectionError:
            return jsonify({"ok": False, "error": f"无法连接到 {base}，请检查地址"})
        except _requests.exceptions.Timeout:
            return jsonify({"ok": False, "error": "连接超时，请检查网络"})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})


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
    
    # 批量改价
    if "price_multiply" in updates or "price_add" in updates:
        multiply = float(updates.get("price_multiply", 1.0))
        add = float(updates.get("price_add", 0))
        for gid in ids:
            row = conn.execute("SELECT price FROM goods WHERE goods_id = ?", (gid,)).fetchone()
            if row:
                new_price = round(row["price"] * multiply + add, 2)
                conn.execute("UPDATE goods SET price = ?, updated_at = ? WHERE goods_id = ?",
                           (new_price, datetime.now().isoformat(), gid))
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
    return jsonify({"ok": True, "updated": len(ids)})


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
        return jsonify({"error": "缺少商品ID"}), 400
    result = generate_image(prompt, goods_id, size=size)
    if "error" in result:
        return jsonify(result), 400
    
    # 保存到 ai_images 表
    conn = get_conn()
    for path in result.get("paths", []):
        conn.execute(
            "INSERT INTO ai_images (goods_id, prompt, result_path, model) VALUES (?, ?, ?, ?)",
            (goods_id, prompt, path, load_config().get("image_api", {}).get("model", ""))
        )
    conn.commit()
    conn.close()
    return jsonify(result)


@app.route("/api/ai/edit-image", methods=["POST"])
def api_ai_edit():
    data = request.get_json() or {}
    image_url = data.get("image_url", "")
    prompt = data.get("prompt", "").strip()
    goods_id = data.get("goods_id", "")
    preset = data.get("preset", "")
    
    if preset and preset in PRESET_PROMPTS:
        prompt = PRESET_PROMPTS[preset]
    if not prompt:
        return jsonify({"error": "请输入提示词或选择预设"}), 400
    if not image_url or not goods_id:
        return jsonify({"error": "缺少图片URL或商品ID"}), 400
    
    result = edit_image(image_url, prompt, goods_id)
    if "error" in result:
        return jsonify(result), 400
    
    conn = get_conn()
    for path in result.get("paths", []):
        conn.execute(
            "INSERT INTO ai_images (goods_id, source_url, prompt, result_path, model) VALUES (?, ?, ?, ?, ?)",
            (goods_id, image_url, prompt, path, load_config().get("image_api", {}).get("model", ""))
        )
    conn.commit()
    conn.close()
    return jsonify(result)


@app.route("/api/ai/use-image", methods=["POST"])
def api_ai_use_image():
    """将 AI 生成的图片添加到商品图片列表"""
    data = request.get_json() or {}
    goods_id = data.get("goods_id", "")
    image_path = data.get("image_path", "")
    target = data.get("target", "main")  # main or detail
    
    if not goods_id or not image_path:
        return jsonify({"error": "缺少参数"}), 400
    
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
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "images": images})


@app.route("/api/ai-image/<path:filepath>")
def serve_ai_image(filepath):
    """提供 AI 生成图片的访问"""
    full_path = DATA_DIR / filepath
    if not full_path.exists():
        return "Not found", 404
    return send_file(str(full_path))


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
    if "file" not in request.files:
        return jsonify({"error": "没有文件"}), 400
    
    file = request.files["file"]
    target = request.form.get("target", "main")
    
    # 保存文件
    img_dir = DATA_DIR / "images" / goods_id
    img_dir.mkdir(parents=True, exist_ok=True)
    
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    filename = f"upload_{int(time.time() * 1000)}.{ext}"
    filepath = img_dir / filename
    file.save(str(filepath))
    
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
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "url": image_url, "images": images})


@app.route("/api/local-image/<goods_id>/<filename>")
def serve_local_image(goods_id, filename):
    """提供本地上传图片的访问"""
    path = DATA_DIR / "images" / goods_id / filename
    if not path.exists():
        return "Not found", 404
    return send_file(str(path))


@app.route("/api/product/<goods_id>/images/reorder", methods=["PUT"])
def api_reorder_images(goods_id):
    """图片排序"""
    data = request.get_json() or {}
    target = data.get("target", "main")
    new_order = data.get("order", [])
    
    conn = get_conn()
    conn.execute(f"UPDATE goods SET {target}_images = ?, updated_at = ? WHERE goods_id = ?",
                (json.dumps(new_order), datetime.now().isoformat(), goods_id))
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


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)





