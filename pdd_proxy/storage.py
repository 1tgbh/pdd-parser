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


def init_db() -> None:
    """初始化数据库"""
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
    """)
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
            specs = [SkuSpec(name=sp.get("name", sp.get("spec_key", "")), value=sp.get("value", sp.get("spec_value", ""))) for sp in s.get("specs", {})]
            if isinstance(s.get("specs"), dict):
                specs = [SkuSpec(name=k, value=v) for k, v in s["specs"].items()]
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


if __name__ == "__main__":
    init_db()
    print(f"当前商品数: {count_goods()}")
