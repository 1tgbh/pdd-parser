import sqlite3, json
conn = sqlite3.connect('data/goods.db')
conn.row_factory = sqlite3.Row
# Compare: system-captured vs imported
rows = conn.execute("SELECT goods_id, skus, detail_images, sku_images, attributes, description FROM goods").fetchall()
for r in rows:
    skus = json.loads(r['skus'] or '[]')
    detail = json.loads(r['detail_images'] or '[]')
    sku_imgs = json.loads(r['sku_images'] or '[]')
    attrs = json.loads(r['attributes'] or '{}')
    desc = r['description'] or ''
    sku_has_stock = any(s.get('stock', 0) > 0 for s in skus)
    sku_has_image = any(s.get('image', '') for s in skus)
    sku_has_id = any(s.get('sku_id', '') for s in skus)
    print(r['goods_id'], '| skus:', len(skus), '| stock>', 0 if sku_has_stock else 0, '| sku_img:', sku_has_image, '| sku_id:', sku_has_id, '| detail:', len(detail), '| sku_imgs:', len(sku_imgs), '| attrs:', len(attrs), '| desc:', len(desc))
