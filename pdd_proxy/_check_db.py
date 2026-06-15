import sqlite3, json
conn = sqlite3.connect('data/goods.db')
conn.row_factory = sqlite3.Row
r = conn.execute("SELECT goods_id, skus, raw_data, detail_images, sku_images, description, attributes, selling_points FROM goods WHERE goods_id='609361652377'").fetchone()
if r:
    skus = json.loads(r['skus'] or '[]')
    raw = r['raw_data'] or ''
    print('=== DB record for 609361652377 ===')
    print('skus count:', len(skus))
    if skus:
        print('first sku:', json.dumps(skus[0], ensure_ascii=False)[:200])
    print('detail_images:', r['detail_images'][:100])
    print('sku_images:', r['sku_images'][:100])
    print('description:', (r['description'] or '')[:100])
    print('attributes:', r['attributes'][:100])
    print('selling_points:', r['selling_points'][:100])
    print('raw_data len:', len(raw))
    print('raw_data[:300]:', raw[:300])
