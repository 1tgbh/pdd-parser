"""
商品数据存储 - SQLite

使用新的 models.py 数据模型，与 service.py 共用同一个数据库。
"""

import json
import os
import sqlite3
import uuid
import hashlib
from typing import List, Optional
from models import GoodsInfo, SkuItem, SkuSpec
from datetime import datetime
from pathlib import Path

from paths import DB_PATH
from normalization import normalize_goods, normalize_skus, specs_dict


def get_conn() -> sqlite3.Connection:
    """获取数据库连接（Row 模式）。"""
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=15000")
    return conn


_EXPORT_TEMPLATE_PRESETS = [
    ("淘宝上架模板", ["title", "subtitle", "selling_points", "price", "original_price", "specs", "attributes"],
     {"title": "商品标题", "subtitle": "副标题", "selling_points": "卖点", "price": "价格", "original_price": "原价", "specs": "规格", "attributes": "属性"}),
    ("拼多多上架模板", ["title", "subtitle", "selling_points", "price", "min_group_price", "specs", "main_images"],
     {"title": "商品标题", "subtitle": "副标题", "selling_points": "卖点", "price": "原价", "min_group_price": "团购价", "specs": "规格", "main_images": "主图"}),
    ("抖音上架模板", ["title", "selling_points", "price", "original_price", "description"],
     {"title": "商品标题", "selling_points": "卖点", "price": "价格", "original_price": "原价", "description": "详情描述"}),
    ("通用数据模板", ["goods_id", "title", "subtitle", "price", "original_price", "min_group_price", "sales", "sold_quantity", "shop_name"],
     {"goods_id": "商品ID", "title": "标题", "subtitle": "副标题", "price": "价格", "original_price": "原价", "min_group_price": "团购价", "sales": "销量", "sold_quantity": "已拼件数", "shop_name": "店铺"}),
]


def init_db() -> None:
    """初始化数据库（全量表结构 + 内置导出模板）"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.execute("PRAGMA journal_mode=WAL")
    from diagnostics import init_schema
    init_schema(conn)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS goods (
            goods_id TEXT PRIMARY KEY,
            title TEXT,
            subtitle TEXT,
            selling_points TEXT,
            price REAL,
            original_price REAL,
            min_group_price REAL,
            sales INTEGER,
            sold_quantity INTEGER,
            shop_name TEXT,
            shop_id TEXT,
            shop_logo TEXT,
            main_images TEXT,
            detail_images TEXT,
            sku_images TEXT,
            specs TEXT,
            skus TEXT,
            description TEXT,
            attributes TEXT,
            source_url TEXT,
            crawl_time TEXT,
            updated_at TEXT,
            raw_data TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_goods_title ON goods(title);
        CREATE INDEX IF NOT EXISTS idx_goods_shop ON goods(shop_name);
        CREATE INDEX IF NOT EXISTS idx_goods_crawl ON goods(crawl_time);

        CREATE TABLE IF NOT EXISTS sku_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            sku_id TEXT DEFAULT '',
            specs TEXT DEFAULT '{}',
            price REAL DEFAULT 0.0,
            original_price REAL DEFAULT 0.0,
            stock INTEGER DEFAULT 0,
            image TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sku_items_goods_id ON sku_items(goods_id);

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#3b82f6'
        );
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS product_tags (
            goods_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS product_groups (
            goods_id TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, group_id)
        );
        CREATE INDEX IF NOT EXISTS idx_product_tags_goods ON product_tags(goods_id);
        CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_product_groups_goods ON product_groups(goods_id);

        CREATE TABLE IF NOT EXISTS ai_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            source_url TEXT,
            prompt TEXT,
            result_path TEXT NOT NULL,
            model TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ai_images_goods ON ai_images(goods_id);

        CREATE TABLE IF NOT EXISTS export_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            fields TEXT NOT NULL,
            column_map TEXT DEFAULT '{}',
            is_preset INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS monitor_list (
            goods_id TEXT PRIMARY KEY,
            frequency TEXT DEFAULT 'daily',
            last_check TEXT,
            next_check TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS monitor_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            price REAL,
            original_price REAL,
            stock INTEGER,
            sales INTEGER,
            checked_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_monitor_history ON monitor_history(goods_id, checked_at);

        CREATE TABLE IF NOT EXISTS browse_items (
            goods_id TEXT PRIMARY KEY,
            title TEXT,
            price REAL DEFAULT 0,
            sales INTEGER DEFAULT 0,
            image TEXT DEFAULT '',
            mall_id TEXT DEFAULT '',
            mall_name TEXT DEFAULT '',
            page_type TEXT DEFAULT '',
            source_url TEXT DEFAULT '',
            first_seen TEXT,
            last_seen TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_browse_seen ON browse_items(last_seen);
    """)
    for col_sql in [
        "ALTER TABLE goods ADD COLUMN price_min REAL DEFAULT 0.0",
        "ALTER TABLE goods ADD COLUMN price_max REAL DEFAULT 0.0",
        "ALTER TABLE goods ADD COLUMN total_stock INTEGER DEFAULT 0",
        "ALTER TABLE goods ADD COLUMN price_modified INTEGER DEFAULT 0",
        "ALTER TABLE goods ADD COLUMN manual_fields TEXT DEFAULT '[]'",
        "ALTER TABLE goods ADD COLUMN observed_at TEXT",
        "ALTER TABLE goods ADD COLUMN source_snapshot TEXT DEFAULT '{}'",
        "ALTER TABLE goods ADD COLUMN capture_source TEXT DEFAULT ''",
        "ALTER TABLE goods ADD COLUMN last_capture_id TEXT DEFAULT ''",
        "ALTER TABLE goods ADD COLUMN field_provenance TEXT DEFAULT '{}'",
        "ALTER TABLE monitor_history ADD COLUMN observed_at TEXT",
    ]:
        try:
            conn.execute(col_sql)
        except sqlite3.OperationalError as exc:
            if "duplicate column" not in str(exc).lower():
                raise
    conn.commit()

    existing = conn.execute("SELECT COUNT(*) FROM export_templates").fetchone()[0]
    if existing == 0:
        for name, fields, col_map in _EXPORT_TEMPLATE_PRESETS:
            conn.execute(
                "INSERT INTO export_templates (name, fields, column_map, is_preset) VALUES (?, ?, ?, 1)",
                (name, json.dumps(fields, ensure_ascii=False), json.dumps(col_map, ensure_ascii=False)),
            )
        conn.commit()
    conn.close()
    print(f"✅ 数据库初始化完成: {DB_PATH}")


def save_goods(goods: GoodsInfo) -> bool:
    """保存商品信息"""
    conn = get_conn()
    now = datetime.now().isoformat()
    data = goods.to_dict()

    try:
        conn.execute("""
            INSERT OR REPLACE INTO goods
            (goods_id, title, subtitle, selling_points, price, original_price, min_group_price,
             sales, sold_quantity, shop_name, shop_id, shop_logo,
             main_images, detail_images, sku_images, specs, skus,
             description, attributes, source_url, crawl_time, updated_at, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data["goods_id"],
            data["title"],
            data["subtitle"],
            json.dumps(data["selling_points"], ensure_ascii=False),
            data["price"],
            data["original_price"],
            data["min_group_price"],
            data["sales"],
            data["sold_quantity"],
            data["shop_name"],
            data["shop_id"],
            goods.shop_logo,
            json.dumps(data["main_images"], ensure_ascii=False),
            json.dumps(data["detail_images"], ensure_ascii=False),
            json.dumps(data["sku_images"], ensure_ascii=False),
            json.dumps(data["specs"], ensure_ascii=False),
            json.dumps(data["skus"], ensure_ascii=False),
            data["description"],
            json.dumps(data["attributes"], ensure_ascii=False),
            data["source_url"],
            data["crawl_time"],
            now,
            json.dumps(goods.raw_data, ensure_ascii=False) if goods.raw_data else None,
        ))
        conn.commit()
        return True
    except Exception as e:
        print(f"❌ 保存失败: {e}")
        return False
    finally:
        conn.close()


def get_goods(goods_id: str) -> Optional[GoodsInfo]:
    """根据商品ID查询"""
    conn = get_conn()
    row = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    return _row_to_goods(row) if row else None


def search_goods(keyword: str, limit: int = 20) -> List[GoodsInfo]:
    """关键词搜索商品"""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM goods WHERE title LIKE ? ORDER BY crawl_time DESC LIMIT ?",
        (f"%{keyword}%", limit)
    ).fetchall()
    conn.close()
    return [_row_to_goods(r) for r in rows]


def list_all_goods(limit: int = 100) -> List[GoodsInfo]:
    """列出所有商品"""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM goods ORDER BY crawl_time DESC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    return [_row_to_goods(r) for r in rows]


def count_goods() -> int:
    """统计商品数量"""
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM goods").fetchone()[0]
    conn.close()
    return count


def _row_to_goods(row) -> GoodsInfo:
    """数据库行转商品对象"""
    skus = []
    try:
        for s in json.loads(row["skus"] or "[]"):
            if not isinstance(s, dict):
                continue
            raw_specs = s.get("specs", {})
            specs = []
            if isinstance(raw_specs, dict):
                specs = [SkuSpec(name=k, value=v) for k, v in raw_specs.items()]
            elif isinstance(raw_specs, list):
                specs = [
                    SkuSpec(
                        name=sp.get("name", sp.get("spec_key", sp.get("key", ""))),
                        value=sp.get("value", sp.get("spec_value", "")),
                    )
                    for sp in raw_specs if isinstance(sp, dict)
                ]
            skus.append(SkuItem(
                sku_id=s.get("sku_id", ""),
                specs=specs,
                price=s.get("price", 0),
                original_price=s.get("original_price", 0),
                stock=s.get("stock", 0),
                image=s.get("image", ""),
            ))
    except Exception:
        pass

    return GoodsInfo(
        goods_id=row["goods_id"],
        title=row["title"] or "",
        subtitle=row["subtitle"] or "",
        selling_points=json.loads(row["selling_points"] or "[]"),
        price=row["price"] or 0,
        original_price=row["original_price"] or 0,
        min_group_price=row["min_group_price"] or 0,
        sales=row["sales"] or 0,
        sold_quantity=row["sold_quantity"] or 0,
        shop_name=row["shop_name"] or "",
        shop_id=row["shop_id"] or "",
        main_images=json.loads(row["main_images"] or "[]"),
        detail_images=json.loads(row["detail_images"] or "[]"),
        sku_images=json.loads(row["sku_images"] or "[]"),
        specs=json.loads(row["specs"] or "{}"),
        skus=skus,
        description=row["description"] or "",
        attributes=json.loads(row["attributes"] or "{}"),
        source_url=row["source_url"] or "",
        crawl_time=row["crawl_time"] or datetime.now().isoformat(),
    )


def upsert_sku_items(goods_id: str, sku_list: list) -> None:
    """Upsert SKU items for a given goods_id."""
    conn = get_conn()
    now = datetime.now().isoformat()
    try:
        sync_skus(conn, goods_id, normalize_skus(sku_list), now)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_goods_price_range(goods_id: str, price_min: float, price_max: float, total_stock: int) -> None:
    """Update price range and total stock for a goods row."""
    conn = get_conn()
    now = datetime.now().isoformat()
    try:
        conn.execute(
            """UPDATE goods SET
               price_min = ?, price_max = ?, total_stock = ?, updated_at = ?
               WHERE goods_id = ?""",
            (price_min, price_max, total_stock, now, goods_id),
        )
        conn.commit()
    except Exception as e:
        print(f"❌ 更新价格区间失败: {e}")
    finally:
        conn.close()


def get_sku_items(goods_id: str) -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM sku_items WHERE goods_id = ? ORDER BY id", (goods_id,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "goods_id": r["goods_id"],
            "sku_id": r["sku_id"] or "",
            "specs": json.loads(r["specs"] or "{}"),
            "price": r["price"] or 0,
            "original_price": r["original_price"] or 0,
            "stock": r["stock"],
            "image": r["image"] or "",
            "created_at": r["created_at"] or "",
            "updated_at": r["updated_at"] or "",
        })
    return result


def sync_skus(conn, goods_id: str, skus: list, now: str):
    """The JSON view and normalized table are written in the caller's transaction."""
    conn.execute("DELETE FROM sku_items WHERE goods_id=?", (goods_id,))
    conn.executemany(
        "INSERT INTO sku_items (goods_id,sku_id,specs,price,original_price,stock,image,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [(goods_id, s["sku_id"], json.dumps(specs_dict(s["specs"]), ensure_ascii=False), s["price"], s["original_price"], s["stock"], s["image"], now, now) for s in skus],
    )


def _sku_key(sku):
    return sku["sku_id"] or json.dumps(specs_dict(sku["specs"]), sort_keys=True, ensure_ascii=False)


def merge_skus(old, new, *, complete=False, price_locked=False):
    old_map = {_sku_key(s): s for s in old}
    merged = {} if complete else dict(old_map)
    for sku in new:
        key = _sku_key(sku)
        prior = old_map.get(key, {})
        value = dict(prior)
        value.update({k: v for k, v in sku.items() if v not in (None, "", []) and not (k in {"price", "original_price"} and v <= 0 and prior.get(k, 0) > 0)})
        for field in ("sku_id", "specs", "price", "original_price", "stock", "image"):
            value.setdefault(field, sku[field])
        if price_locked:
            for field in ("price", "original_price"):
                value[field] = prior.get(field, 0)
        merged[key] = value
    return list(merged.values())


def ingest_goods(payload: dict) -> dict:
    data = normalize_goods(payload)
    gid = data["goods_id"]
    now = datetime.now().isoformat()
    event_id = str(payload.get("capture_id") or uuid.uuid4().hex)[:128]
    observed = now
    if payload.get("captured_at"):
        stamp = datetime.fromisoformat(str(payload["captured_at"]).replace("Z", "+00:00"))
        stamp = stamp.astimezone().replace(tzinfo=None) if stamp.tzinfo else stamp
        if stamp.timestamp() > datetime.now().timestamp() + 300:
            raise ValueError("采集时间超出范围")
        observed = stamp.isoformat()
    json_fields = ("main_images", "detail_images", "sku_images", "skus", "specs", "attributes", "selling_points")
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM goods WHERE goods_id=?", (gid,)).fetchone()
        if row and row["last_capture_id"] == event_id:
            return {"ok": True, "goods_id": gid, "observed_at": row["observed_at"]}
        if row and row["observed_at"] and observed < row["observed_at"]:
            return {"ok": True, "goods_id": gid, "ignored": "older_observation", "observed_at": row["observed_at"]}
        authoritative = True
        accepted = set()
        locked = False
        new_skus = data["skus"]
        if row:
            merged = dict(row)
            for key in json_fields:
                merged[key] = json.loads(row[key] or ("{}" if key in {"specs", "attributes"} else "[]"))
            manual = set(json.loads(row["manual_fields"] or "[]"))
            locked = bool(row["price_modified"])
            rank = {"dom": 1, "": 2, "api": 3, "import": 3}
            authoritative = rank[data["capture_source"]] >= rank.get(row["capture_source"], 2)
            for key, value in data.items():
                if key in {"skus", "skus_complete"} or key in manual:
                    continue
                if locked and key in {"price", "original_price", "min_group_price"}:
                    continue
                known_zero = key in {"sales", "sold_quantity"} and value == 0 and data["field_sources"]["fields"][key]["status"] == "known"
                if (value not in (None, "", [], {}, 0) or known_zero) and (authoritative or not merged.get(key)):
                    merged[key] = value
                    accepted.add(key)
            old_skus = normalize_skus(merged["skus"])
            new_skus = data["skus"]
            # A late DOM fallback cannot replace identified API SKUs with guesses.
            if not authoritative:
                new_skus = [s for s in new_skus if s["sku_id"] and not any(o["sku_id"] == s["sku_id"] for o in old_skus)]
            merged["skus"] = merge_skus(old_skus, new_skus, complete=data["skus_complete"] and authoritative, price_locked=locked)
        else:
            merged = dict(data, crawl_time=now, price_modified=0, manual_fields="[]")
        prices = [s["price"] for s in merged["skus"] if s["price"] > 0]
        prices = prices or ([merged["price"]] if merged["price"] > 0 else [])
        merged["price_min"] = min(prices) if prices else 0
        merged["price_max"] = max(prices) if prices else 0
        stocks = [s["stock"] for s in merged["skus"]]
        merged["total_stock"] = sum(stocks) if stocks and all(s is not None for s in stocks) else None
        if merged["skus"]:
            specs = {}
            for sku in merged["skus"]:
                for key, value in specs_dict(sku["specs"]).items():
                    if value not in specs.setdefault(key, []):
                        specs[key].append(value)
            if specs:
                merged["specs"] = specs
        # Store only validated product fields, never full page state or request headers.
        source = json.dumps(data, ensure_ascii=False, sort_keys=True)
        observed_at = observed if authoritative else row["observed_at"]
        source = source if authoritative else row["source_snapshot"]
        merged.update(updated_at=now, observed_at=observed_at, source_snapshot=source, raw_data=source, last_capture_id=event_id)
        from provenance import update_current, sku_key
        merged["field_provenance"] = json.dumps(update_current(row, data, merged, observed, accepted, locked, {sku_key(s) for s in new_skus}), ensure_ascii=False)
        fields = ["goods_id", "title", "subtitle", "price", "original_price", "min_group_price", "sales", "sold_quantity", "shop_name", "shop_id", "shop_logo", *json_fields, "description", "source_url", "crawl_time", "updated_at", "raw_data", "price_min", "price_max", "total_stock", "price_modified", "manual_fields", "observed_at", "source_snapshot", "capture_source", "last_capture_id", "field_provenance"]
        values = [json.dumps(merged[k], ensure_ascii=False) if k in json_fields else merged.get(k) for k in fields]
        updates = ",".join(f"{k}=excluded.{k}" for k in fields if k != "goods_id")
        conn.execute(f"INSERT INTO goods ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)}) ON CONFLICT(goods_id) DO UPDATE SET {updates}", values)
        sync_skus(conn, gid, merged["skus"], now)
        missing = [field for field in ('price', 'main_images', 'skus') if not data[field]]
        if missing:
            from diagnostics import write_events
            write_events(conn, [{"id": "incomplete-" + hashlib.sha256(event_id.encode()).hexdigest()[:32],
                                 "code": "data_incomplete", "stage": "sync", "goods_id": gid,
                                 "source_url": data["source_url"], "parser_version": data["parser_version"],
                                 "occurred_at": now, "missing_fields": missing}])
        # History records are observations, not copies of the local edited selling price.
        if authoritative and data["price"] > 0 and conn.execute("SELECT 1 FROM monitor_list WHERE goods_id=?", (gid,)).fetchone():
            source_stocks = [s["stock"] for s in data["skus"]]
            stock = sum(source_stocks) if source_stocks and all(s is not None for s in source_stocks) else None
            conn.execute("INSERT INTO monitor_history (goods_id,price,stock,sales,checked_at,observed_at) VALUES (?,?,?,?,?,?)", (gid, data["price"], stock, data["sales"], observed_at, observed_at))
            conn.execute("UPDATE monitor_list SET last_check=? WHERE goods_id=?", (observed_at, gid))
        conn.commit()
        return {"ok": True, "goods_id": gid, "observed_at": observed_at}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"当前商品数: {count_goods()}")
