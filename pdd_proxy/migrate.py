"""数据库迁移脚本 - 添加标签/分组/AI图片支持"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "goods.db"


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 标签表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#3b82f6',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 分组表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (parent_id) REFERENCES groups(id) ON DELETE SET NULL
        )
    """)

    # 商品-标签关联表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS product_tags (
            goods_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, tag_id),
            FOREIGN KEY (goods_id) REFERENCES goods(goods_id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    """)

    # 商品-分组关联表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS product_groups (
            goods_id TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, group_id),
            FOREIGN KEY (goods_id) REFERENCES goods(goods_id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        )
    """)

    # AI生成图片表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            source_url TEXT,
            prompt TEXT,
            result_path TEXT NOT NULL,
            model TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (goods_id) REFERENCES goods(goods_id) ON DELETE CASCADE
        )
    """)

    # 索引
    cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tags_goods ON product_tags(goods_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_product_groups_goods ON product_groups(goods_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ai_images_goods ON ai_images(goods_id)")

    conn.commit()
    conn.close()
    print("Migration completed")


if __name__ == "__main__":
    migrate()
