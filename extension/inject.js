// Chrome serializes this function into MAIN only after the user clicks Save.
// Keep all helpers inside: no persistent globals, hooks, observers, timers or requests.
function collectCurrentProduct(expected) {
  'use strict';
  try {
    const page = new URL(location.href);
    const wanted = new URL(expected.url);
    const gid = page.searchParams.get('goods_id') || page.searchParams.get('goodsID') || '';
    if (page.origin !== wanted.origin || page.pathname !== wanted.pathname || gid !== expected.goodsId) {
      return { ok: false, error: '页面已切换，请在目标商品页重新点击保存' };
    }
    const navigationStatus = typeof performance !== 'undefined' ? performance.getEntriesByType?.('navigation')?.[0]?.responseStatus : 0;
    if ([401, 403, 429].includes(navigationStatus)) {
      return { ok: false, restriction: 'http_' + navigationStatus, pageUrl: page.href, error: '当前页面访问受限（HTTP ' + navigationStatus + '），采集已暂停' };
    }
    const visibleText = (document.body?.innerText || '').slice(0, 1200);
    if (/^(安全验证|人机验证|访问受限)(\s*[-_|]\s*拼多多)?$/.test((document.title || '').trim()) || /请完成安全验证后继续访问|请拖动下方滑块完成验证|访问过于频繁，请稍后再试/.test(visibleText)) {
      return { ok: false, restriction: 'verification', pageUrl: page.href, error: '页面要求安全验证，采集已暂停' };
    }
    if (/^(登录|登录拼多多|请先登录|账号登录|验证码登录)$/.test((document.title || '').trim()) || /请先登录后查看商品/.test(visibleText)) {
      return { ok: false, restriction: 'auth_required', code: 'auth_required', pageUrl: page.href, error: '页面要求登录，请人工登录后恢复保存' };
    }

    function amount(value, cents = false) {
      if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'object') return 0;
      const n = Number(String(value).replace(/[¥￥,\s]/g, ''));
      return Number.isFinite(n) && n >= 0 && n <= 1000000000 ? Math.round(n * (cents ? 1 : 100)) / 100 : 0;
    }
    function priceRead(data, sku = false, original = false) {
      const yuan = original ? ['normalPrice', 'linePrice'] : sku ? ['groupPrice'] : ['minGroupPrice', 'display_price', 'price_info'];
      const fen = original ? ['market_price', 'normal_price', 'original_price'] : sku ? ['skuPrice', 'group_price', 'sku_price', 'price'] : ['min_group_price', 'group_price', 'min_on_sale_group_price', 'price', 'min_normal_price'];
      for (const key of yuan) { const p = amount(data[key]); if (p > 0) return { value: p, origin: 'page_state', status: 'known', source_field: key, raw_value: scalar(data[key]) }; }
      for (const key of fen) { const p = amount(data[key], true); if (p > 0) return { value: p, origin: 'page_state', status: 'known', source_field: key + ' (fen)', raw_value: scalar(data[key]) }; }
      if (sku && !original && amount(data.normalPrice) > 0) return { value: amount(data.normalPrice), origin: 'page_state', status: 'known', source_field: 'normalPrice (fallback)', raw_value: scalar(data.normalPrice) };
      return { value: 0, origin: 'unknown', status: 'unknown', source_field: '', raw_value: null };
    }
    function price(data, sku = false, original = false) { return priceRead(data, sku, original).value; }
    function stock(data) {
      const v = data.quantity ?? data.stock;
      if (typeof v !== 'number' && typeof v !== 'string') return null;
      const n = Number(v);
      return v != null && v !== '' && Number.isSafeInteger(n) && n >= 0 && n <= 1000000000000 ? n : null;
    }
    function sales(value) {
      const m = scalar(value).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(万|亿)?/);
      return m ? Math.round(Number(m[1]) * (m[2] === '亿' ? 100000000 : m[2] === '万' ? 10000 : 1)) : 0;
    }
    function text(value, limit = 1000) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
    function scalar(value, limit = 1000) { return ['string', 'number', 'boolean'].includes(typeof value) ? String(value).slice(0, limit) : ''; }
    function title(value) {
      const s = text(value).replace(/\s*[-_|·]\s*(拼多多|Pinduoduo|PDD).*$/i, '').trim();
      return s.length >= 4 && !/^(拼多多|拼多多商城|登录|登录拼多多|请先登录|账号登录|验证码登录|安全验证|人机验证|商品详情|商品不存在|页面不存在|404 Not Found|403 Forbidden|429 Too Many Requests)$/i.test(s) && !/^拼多多(?:商城)?\s*[-_|·]/.test(s) && !/^function\b|^!function|window\./.test(s) ? s : '';
    }
    function imageUrl(value) {
      if (typeof value !== 'string' || value.length > 2000) return '';
      try {
        const u = new URL(value, page.href);
        return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : '';
      } catch { return ''; }
    }
    function images(data, names) {
      const found = new Set();
      for (const key of names) {
        if (!Array.isArray(data[key])) continue;
        for (const img of data[key].slice(0, 1000)) {
          const raw = typeof img === 'string' ? img : img && (img.url || img.src || img.image_url);
          if (raw) { const u = imageUrl(raw); if (u) found.add(u); }
        }
      }
      return [...found];
    }
    function specList(raw) {
      if (Array.isArray(raw)) return raw.filter(s => s && typeof s === 'object').map(s => ({
        key: text(s.key || s.spec_key || s.name || s.spec, 100),
        value: scalar(s.value ?? s.spec_value, 500),
      })).filter(s => s.key && s.value);
      if (raw && typeof raw === 'object') return Object.entries(raw).slice(0, 200).map(([key, value]) => ({ key: key.slice(0, 100), value: scalar(value, 500) })).filter(s => s.value);
      return [];
    }
    function goodsName(data) {
      const explicit = text(data.goods_name || data.goodsName || data.goods_title);
      if (explicit) return explicit;
      const hasDetails = [data.sku, data.skus, data.sku_list, data.gallery, data.top_gallery, data.topGallery].some(value => Array.isArray(value) && value.length);
      return hasDetails ? title(data.title) : '';
    }

    let copied = 0, limited = false;
    const copies = new WeakMap();
    function snapshot(value, depth = 0) {
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (typeof value !== 'object') return undefined;
      if (copies.has(value)) return copies.get(value);
      if (depth > 10 || ++copied > 20000) { limited = true; return undefined; }
      const copy = Array.isArray(value) ? [] : Object.create(null);
      copies.set(value, copy);
      const keys = Object.keys(value);
      if (keys.length > 5000) limited = true;
      for (const key of keys.slice(0, 5000)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        // Reading a getter can cause page-side work. Only consume existing data properties.
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
        const child = snapshot(descriptor.value, depth + 1);
        if (child !== undefined) Object.defineProperty(copy, key, { value: child, enumerable: true, configurable: true });
      }
      return copy;
    }
    let best = null, bestRoot = null, bestScore = -1, remaining = 5000;
    const seen = new WeakSet();
    function inspect(obj, root, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 8 || --remaining < 0 || seen.has(obj)) return;
      seen.add(obj);
      if (!Array.isArray(obj) && scalar(obj.goods_id || obj.goodsID) === gid) {
        const name = goodsName(obj);
        const skus = obj.sku || obj.skus || obj.sku_list;
        if (name) {
          const score = (Array.isArray(skus) ? skus.length * 2 : 0) + images(obj, ['topGallery', 'top_gallery', 'gallery']).length + images(obj, ['detailGallery', 'detail_gallery']).length;
          if (score > bestScore) { best = obj; bestRoot = root; bestScore = score; }
        }
      }
      for (const key of Object.keys(obj).slice(0, 1000)) {
        try { if (obj[key] && typeof obj[key] === 'object') inspect(obj[key], root, depth + 1); } catch { /* Unsupported page getter. */ }
      }
    }
    for (const name of ['store', '__rawData__', '__INIT_DATA__', '__INITIAL_STATE__', '__INITIAL_DATA__', '__PRELOADED_STATE__', '__APP_DATA__', '__NEXT_DATA__', '__pdd_data__', 'goodsData']) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(window, name);
        const root = descriptor && Object.hasOwn(descriptor, 'value') ? snapshot(descriptor.value) : null;
        inspect(root, root);
      } catch { /* Page state may not be available. */ }
    }
    let scriptBytes = 0;
    for (const script of [...document.querySelectorAll('script:not([src])')].slice(0, 50)) {
      const source = script.textContent || '';
      scriptBytes += source.length;
      if (source.length > 2000000 || scriptBytes > 4000000 || !/goods_id|goodsID/.test(source)) continue;
      const match = source.match(/(?:store\.initDataObj|window\.__rawData__|__INIT_DATA__)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      try { const root = snapshot(JSON.parse(match ? match[1] : source)); inspect(root, root); } catch { /* JSON only, never execute page scripts. */ }
    }

    const goods = {
      goods_id: gid, title: '', subtitle: '', description: '', price: 0, original_price: 0, min_group_price: 0,
      sales: 0, sold_quantity: 0, shop_name: '', shop_id: '', shop_logo: '',
      main_images: [], detail_images: [], sku_images: [], specs: {}, skus: [], attributes: {}, selling_points: [],
      capture_source: best ? 'api' : 'dom', skus_complete: false,
      parser_version: '1.4.0', field_sources: { fields: {}, skus: [] },
    };
    const fields = goods.field_sources.fields;
    function evidence(field, origin, sourceField, raw, known = true) {
      fields[field] = { origin: known ? origin : 'unknown', source_field: sourceField, raw_value: known ? raw : null, status: known ? 'known' : 'unknown' };
    }
    for (const field of ['goods_id', 'title', 'subtitle', 'description', 'price', 'original_price', 'min_group_price', 'sales', 'sold_quantity', 'shop_name', 'shop_id', 'shop_logo', 'main_images', 'detail_images', 'sku_images', 'specs', 'skus', 'attributes', 'selling_points']) evidence(field, 'unknown', '', null, false);
    evidence('goods_id', 'dom', 'location.goods_id', gid);
    if (best) {
      goods.title = goodsName(best);
      goods.subtitle = text(best.goods_desc || best.desc);
      goods.description = text(best.goods_desc || best.desc, 10000);
      goods.price = price(best);
      goods.original_price = price(best, false, true);
      fields.price = priceRead(best);
      fields.original_price = priceRead(best, false, true);
      const nameKey = ['goods_name', 'goodsName', 'goods_title'].find(key => text(best[key])) || 'title';
      const descriptionKey = text(best.goods_desc) ? 'goods_desc' : 'desc';
      evidence('title', 'page_state', 'goods.' + nameKey, scalar(best[nameKey]), !!goods.title);
      for (const field of ['subtitle', 'description']) evidence(field, 'page_state', 'goods.' + descriptionKey, scalar(best[descriptionKey], 2000), !!goods[field]);
      goods.sales = sales(best.sales || best.sold_quantity || best.sideSalesTip || best.side_sales_tip);
      goods.sold_quantity = sales(best.sold_quantity);
      const salesField = ['sales', 'sold_quantity', 'sideSalesTip', 'side_sales_tip'].find(key => best[key] != null);
      if (salesField) evidence('sales', 'page_state', 'goods.' + salesField, scalar(best[salesField]));
      if (best.sold_quantity != null) evidence('sold_quantity', 'page_state', 'goods.sold_quantity', scalar(best.sold_quantity));
      goods.shop_name = text(best.mall_name || best.mallName || best.shop_name);
      goods.shop_id = scalar(best.mall_id || best.mallID || best.shop_id, 128);
      goods.shop_logo = text(best.mall_logo || best.mallLogo || best.shop_logo);
      const mall = bestRoot?.store?.initDataObj?.mall || bestRoot?.initDataObj?.mall || bestRoot?.mall;
      if (mall && typeof mall === 'object') {
        goods.shop_name = text(mall.mallName || mall.mall_name) || goods.shop_name;
        goods.shop_id = scalar(mall.mallID || mall.mall_id || goods.shop_id, 128);
        goods.shop_logo = text(mall.mallLogo || mall.mall_logo) || goods.shop_logo;
      }
      const shopKeys = { shop_name: ['mallName', 'mall_name', 'shop_name'], shop_id: ['mallID', 'mall_id', 'shop_id'], shop_logo: ['mallLogo', 'mall_logo', 'shop_logo'] };
      for (const field of ['shop_name', 'shop_id', 'shop_logo']) {
        const key = shopKeys[field].find(key => scalar(mall?.[key])) || shopKeys[field].find(key => scalar(best[key]));
        const fromMall = key && scalar(mall?.[key]);
        evidence(field, 'page_state', (fromMall ? 'mall.' : 'goods.') + (key || field), key ? scalar(fromMall ? mall[key] : best[key]) : '', !!goods[field]);
      }
      goods.main_images = images(best, ['topGallery', 'top_gallery', 'gallery', 'images']);
      goods.detail_images = images(best, ['detailGallery', 'detail_gallery', 'desc_gallery', 'goods_desc_images']);
      const rawSkus = best.sku || best.skus || best.sku_list || [];
      const distinct = new Map();
      if (Array.isArray(rawSkus)) {
        for (const s of rawSkus.slice(0, 5000)) {
          if (!s || typeof s !== 'object') continue;
          const specs = specList(s.specs || s.spec);
          const id = scalar(s.sku_id || s.skuID || s.skuId, 128);
          if (!id && !specs.length) continue;
          const rawImage = s.thumb_url || s.thumbUrl || s.image || s.sku_image;
          const sku = { sku_id: id, specs, price: price(s, true), original_price: price(s, true, true), stock: stock(s), image: rawImage ? imageUrl(rawImage) : '' };
          distinct.set(id || JSON.stringify(specs), sku);
          goods.field_sources.skus.push({ sku_id: id, specs, fields: {
            price: priceRead(s, true), original_price: priceRead(s, true, true),
            stock: { origin: sku.stock == null ? 'unknown' : 'page_state', status: sku.stock == null ? 'unknown' : 'known', source_field: s.quantity != null ? 'quantity' : 'stock', raw_value: sku.stock == null ? null : (s.quantity ?? s.stock) },
            specs: { origin: 'page_state', status: specs.length ? 'known' : 'unknown', source_field: 'specs', raw_value: specs },
            image: { origin: sku.image ? 'page_state' : 'unknown', status: sku.image ? 'known' : 'unknown', source_field: ['thumb_url', 'thumbUrl', 'image', 'sku_image'].find(key => s[key]) || '', raw_value: sku.image || null },
          } });
          for (const spec of specs) {
            if (!Object.hasOwn(goods.specs, spec.key)) Object.defineProperty(goods.specs, spec.key, { value: [], enumerable: true, configurable: true });
            if (!goods.specs[spec.key].includes(spec.value)) goods.specs[spec.key].push(spec.value);
          }
        }
        goods.skus = [...distinct.values()];
        goods.skus_complete = !limited && rawSkus.length <= 5000 && rawSkus.length === goods.skus.length && goods.skus.length > 0 && goods.skus.every(s => s.sku_id);
      }
      goods.sku_images = [...new Set(goods.skus.map(s => s.image).filter(Boolean))];
      for (const key of ['goodsProperty', 'goods_property', 'goods_props', 'attributes', 'properties']) {
        if (!Array.isArray(best[key])) continue;
        for (const attr of best[key].slice(0, 200)) {
          if (!attr || typeof attr !== 'object') continue;
          const name = text(attr.key || attr.name, 100);
          const value = attr.value ?? attr.val ?? attr.values?.[0];
          if (name && scalar(value)) Object.defineProperty(goods.attributes, name, { value: scalar(value), enumerable: true, configurable: true });
        }
      }
      for (const key of ['service_tags', 'goods_service_tags', 'tags']) {
        if (!Array.isArray(best[key])) continue;
        for (const item of best[key].slice(0, 200)) {
          const value = text(typeof item === 'string' ? item : item && (item.text || item.name || item.desc));
          if (value && !goods.selling_points.includes(value)) goods.selling_points.push(value);
        }
      }
      const skuPrices = goods.skus.map(s => s.price).filter(p => p > 0);
      if (!goods.price && skuPrices.length) {
        goods.price = Math.min(...skuPrices);
        evidence('price', 'derived', 'min(skus.price)', skuPrices);
      }
      const fieldKeys = {
        main_images: ['topGallery', 'top_gallery', 'gallery', 'images'], detail_images: ['detailGallery', 'detail_gallery', 'desc_gallery', 'goods_desc_images'],
        attributes: ['goodsProperty', 'goods_property', 'goods_props', 'attributes', 'properties'], selling_points: ['service_tags', 'goods_service_tags', 'tags'],
      };
      for (const field of ['main_images', 'detail_images', 'attributes', 'selling_points']) evidence(field, 'page_state', fieldKeys[field].filter(key => Array.isArray(best[key]) && best[key].length).map(key => 'goods.' + key).join(','), goods[field], Array.isArray(goods[field]) ? goods[field].length > 0 : Object.keys(goods[field]).length > 0);
      for (const field of ['specs', 'sku_images']) evidence(field, 'derived', 'skus.' + field, goods[field], Array.isArray(goods[field]) ? goods[field].length > 0 : Object.keys(goods[field]).length > 0);
      evidence('skus', 'page_state', 'goods.' + (best.sku ? 'sku' : best.skus ? 'skus' : 'sku_list'), goods.skus.length, goods.skus.length > 0);
    }

    function meta(name) { return document.querySelector('meta[property="' + name + '"]')?.getAttribute('content') || ''; }
    if (!goods.title) {
      const named = document.querySelector('[itemprop="name"], [data-goods-name], [class*="goods-title"], [class*="goodsTitle"]');
      goods.title = title(meta('og:title')) || title(document.querySelector('h1')?.textContent) || title(named?.getAttribute('data-goods-name') || named?.textContent) || title(document.title);
      evidence('title', 'dom', meta('og:title') ? 'meta.og:title' : 'document.title_or_heading', goods.title, !!goods.title);
    }
    if (!goods.main_images.length && meta('og:image')) {
      const image = imageUrl(meta('og:image'));
      if (image) goods.main_images = [image];
      evidence('main_images', 'dom', 'meta.og:image', goods.main_images, !!image);
    }
    if (!goods.price) {
      const priceText = document.querySelector('[itemprop="price"]')?.getAttribute('content') || meta('product:price:amount') || meta('og:price:amount');
      goods.price = amount(priceText);
      if (goods.price > 0) evidence('price', 'dom', 'meta.product_price', priceText);
    }
    goods.min_group_price = goods.price;
    fields.min_group_price = { ...fields.price, origin: goods.price > 0 ? 'derived' : 'unknown', source_field: 'price' };
    if (!goods.title) return { ok: false, code: 'data_incomplete', error: '当前页没有可确认的商品标题，请等待页面显示商品信息后再预览' };
    const missing = [];
    if (!goods.price) missing.push('价格');
    if (!goods.main_images.length) missing.push('主图');
    if (!goods.skus.length) missing.push('SKU');
    else if (goods.skus.some(s => s.stock == null)) missing.push('部分库存');
    if (goods.skus.some(s => !s.price)) missing.push('部分SKU价格');
    if (limited) missing.push('部分结构化字段（页面数据过大）');
    return { ok: true, pageUrl: page.href, goods, missing };
  } catch {
    return { ok: false, code: 'structure_changed', error: '当前页面数据格式暂不支持，未保存。可以使用本地导入继续处理。' };
  }
}
