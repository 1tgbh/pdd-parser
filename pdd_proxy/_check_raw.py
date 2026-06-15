import sqlite3, json
conn = sqlite3.connect('data/goods.db')
conn.row_factory = sqlite3.Row
r = conn.execute("SELECT raw_data FROM goods WHERE goods_id='609361652377'").fetchone()
raw = json.loads(r['raw_data'])
print('Keys in raw_data:', list(raw.keys()))
print('Has initDataObj:', 'initDataObj' in raw)
print('Has store:', 'store' in raw)
print('mall_info:', raw.get('mall_info'))
