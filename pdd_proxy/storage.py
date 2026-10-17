"""
商品数据存储 - SQLite

使用新的 models.py 数据模型，与 service.py 共用同一个数据库。
"""

import json
import os
import sqlite3
from typing import List, Optional
from models import GoodsInfo, SkuItem, SkuSpec
from datetime import datetime
from pathlib import Path

DB_PATH: Path = Path(__file__).resolve().parent / "data" / "goods.db"


def get_conn() -> sqlite3.Connection:
    """获取数据库连接（Row 模式）。"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
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
    """)
    for col_sql in [
        "ALTER TABLE goods ADD COLUMN price_min REAL DEFAULT 0.0",
        "ALTER TABLE goods ADD COLUMN price_max REAL DEFAULT 0.0",
        "ALTER TABLE goods ADD COLUMN total_stock INTEGER DEFAULT 0",
        "ALTER TABLE goods ADD COLUMN price_modified INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(col_sql)
        except Exception:
            pass
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
        conn.execute("DELETE FROM sku_items WHERE goods_id = ?", (goods_id,))
        for s in sku_list:
            if not isinstance(s, dict):
                continue
            sku_id = str(s.get("sku_id", s.get("id", "")))
            specs = s.get("specs", s.get("spec", {}))
            if isinstance(specs, list):
                specs_dict = {}
                for sp in specs:
                    if isinstance(sp, dict):
                        k = sp.get("spec_key", sp.get("name", sp.get("spec", "")))
                        v = sp.get("spec_value", sp.get("value", ""))
                        if k:
                            specs_dict[k] = v
                specs = specs_dict
            price = float(s.get("price", 0) or 0)
            original_price = float(s.get("original_price", s.get("normal_price", 0)) or 0)
            stock = int(s.get("stock", s.get("quantity", 0)) or 0)
            image = s.get("image", s.get("thumb_url", ""))
            conn.execute(
                """INSERT INTO sku_items
                   (goods_id, sku_id, specs, price, original_price, stock, image, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (goods_id, sku_id, json.dumps(specs, ensure_ascii=False),
                 price, original_price, stock, image, now, now),
            )
        conn.commit()
    except Exception as e:
        print(f"❌ SKU upsert 失败: {e}")
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
            "stock": r["stock"] or 0,
            "image": r["image"] or "",
            "created_at": r["created_at"] or "",
            "updated_at": r["updated_at"] or "",
        })
    return result


if __name__ == "__main__":
    init_db()
    print(f"当前商品数: {count_goods()}")
