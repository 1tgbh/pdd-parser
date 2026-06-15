import json
with open(r'D:\jiexi\pdd_parser (2)\大王解析数据\商品详情 (11)\402454732544.txt', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Show the top-level structure
print('Top keys:', list(data.keys())[:10])
store = data.get('store', {})
init = store.get('initDataObj', store.get('init_data_obj', {}))
goods = init.get('goods', {})
mall = init.get('mall', {})
print('Goods keys:', list(goods.keys())[:20])
print('Mall keys:', list(mall.keys())[:10] if mall else 'None')
print()
print('Goods has skus:', 'skus' in goods or 'sku' in goods)
print('Goods has topGallery:', 'topGallery' in goods or 'top_gallery' in goods)
print('Goods has detailGallery:', 'detailGallery' in goods or 'detail_gallery' in goods)
print('Goods has goodsProperty:', 'goodsProperty' in goods or 'goods_property' in goods)
print('Goods has servicePromise:', 'servicePromise' in goods or 'service_promise' in goods)
