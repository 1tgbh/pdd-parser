#!/usr/bin/env python3
"""
商品数据查询工具

使用方式:
    python query.py              # 列出所有商品
    python query.py 关键词       # 搜索商品
    python query.py --id 商品ID  # 查看商品详情
    python query.py --export     # 导出为 JSON
"""

import json
import os
import sqlite3
import sys

from pathlib import Path
DB_PATH = Path(__file__).resolve().parent / "data" / "goods.db"


def get_conn() -> sqlite3.Connection:
    """获取数据库连接。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def list_all(limit: int = 20) -> None:
    """列出最近采集的商品。"""
    conn = get_conn()
    rows = conn.execute("SELECT * FROM goods ORDER BY crawl_time DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    
    print(f"\n{'='*60}")
    print(f"  商品列表 (共 {len(rows)} 条)")
    print(f"{'='*60}\n")
    
    for r in rows:
        print(f"  [{r['goods_id']}] {r['goods_name'][:35]}...")
        print(f"       ¥{r['price']} | 销量:{r['sales']} | {r['shop_name']}")
        print()


def search(keyword: str) -> None:
    """按关键词搜索商品标题。"""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM goods WHERE goods_name LIKE ? ORDER BY crawl_time DESC",
        (f"%{keyword}%",)
    ).fetchall()
    conn.close()
    
    print(f"\n搜索 '{keyword}' 找到 {len(rows)} 条:\n")
    for r in rows:
        print(f"  [{r['goods_id']}] {r['goods_name'][:40]}")
        print(f"       ¥{r['price']} | 销量:{r['sales']}")
        print()


def detail(goods_id: str) -> None:
    """查看单个商品的详细信息。"""
    conn = get_conn()
    r = conn.execute("SELECT * FROM goods WHERE goods_id = ?", (goods_id,)).fetchone()
    conn.close()
    
    if not r:
        print(f"未找到商品: {goods_id}")
        return
    
    print(f"\n{'='*60}")
    print(f"  商品详情")
    print(f"{'='*60}")
    print(f"  ID: {r['goods_id']}")
    print(f"  标题: {r['goods_name']}")
    print(f"  价格: ¥{r['price']}")
    print(f"  原价: ¥{r['original_price']}")
    print(f"  拼团价: ¥{r['min_group_price']}")
    print(f"  销量: {r['sales']}")
    print(f"  库存: {r['stock']}")
    print(f"  店铺: {r['shop_name']}")
    print(f"  采集时间: {r['crawl_time']}")
    
    if r['skus']:
        skus = json.loads(r['skus'])
        print(f"\n  SKU ({len(skus)}个):")
        for s in skus[:5]:
            specs = " ".join([f"{sp['name']}:{sp['value']}" for sp in s.get('specs', [])])
            print(f"    - {specs} ¥{s.get('price', 0)}")
    
    if r['main_images']:
        imgs = json.loads(r['main_images'])
        print(f"\n  主图 ({len(imgs)}张):")
        for img in imgs[:3]:
            print(f"    - {img[:60]}...")
    print()


def export() -> None:
    """导出全部商品数据为 JSON 文件。"""
    conn = get_conn()
    rows = conn.execute("SELECT * FROM goods ORDER BY crawl_time DESC").fetchall()
    conn.close()
    
    data = []
    for r in rows:
        data.append({
            "goods_id": r["goods_id"],
            "goods_name": r["goods_name"],
            "price": r["price"],
            "original_price": r["original_price"],
            "sales": r["sales"],
            "stock": r["stock"],
            "shop_name": r["shop_name"],
            "main_images": json.loads(r["main_images"] or "[]"),
            "skus": json.loads(r["skus"] or "[]"),
            "crawl_time": r["crawl_time"],
        })
    
    export_path = Path(__file__).resolve().parent / "data" / "export.json"
    with open(export_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"已导出 {len(data)} 条商品到: {export_path}")


def main() -> None:
    """命令行入口。"""
    if not DB_PATH.exists():
        print("数据库不存在，请先启动采集服务: python run.py")
        return
    
    if len(sys.argv) < 2:
        list_all()
    elif sys.argv[1] == "--export":
        export()
    elif sys.argv[1] == "--id" and len(sys.argv) > 2:
        detail(sys.argv[2])
    else:
        search(" ".join(sys.argv[1:]))


if __name__ == "__main__":
    main()
