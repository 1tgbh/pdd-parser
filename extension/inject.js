(function() {
  'use strict';
  var INGEST_URL = 'http://127.0.0.1:5000/api/ingest';
  var sent = {};
  var sentPrice = {};
  var sentDetail = {};
  var sentScore = {};

  function dataScore(d) {
    var s = 0;
    if (d.title) s += 2;
    if ((d.main_images || []).length > 0) s += 2;
    if ((d.detail_images || []).length > 0) s += 4;
    if ((d.sku_images || []).length > 0) s += 3;
    if (Object.keys(d.specs || {}).length > 0) s += 2;
    var skus = d.skus || [];
    if (skus.length > 0) s += 2;
    for (var i = 0; i < skus.length; i++) {
      if (skus[i] && skus[i].sku_id) s += 2;
      if (skus[i] && skus[i].stock > 0) s += 2;
      if (skus[i] && skus[i].image) s += 1;
    }
    if (Object.keys(d.attributes || {}).length > 0) s += 3;
    if ((d.selling_points || []).length > 0) s += 2;
    if (d.description) s += 2;
    if (d.shop_id) s += 1;
    return s;
  }
  var capturedRaw = null;
  var capturedMall = null;
  var capturedRawInitData = null;
  var priceMap = {};
  var skuPriceMap = {};

  // ======== 采集开关（由扩展 bridge.js 通过 postMessage 下发） ========
  if (typeof window.__PDD_CAPTURE_ENABLED === 'undefined') window.__PDD_CAPTURE_ENABLED = true;
  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (d && d.type === 'PDD_CAPTURE_TOGGLE') window.__PDD_CAPTURE_ENABLED = !!d.enabled;
  });

  // ======== 页面内采集成功浮窗提示 ========
  var _toastEl = null;
  function showToast(gid, title) {
    try {
      if (!_toastEl || !_toastEl.parentNode) {
        _toastEl = document.createElement('div');
        _toastEl.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:rgba(20,20,40,.92);color:#fff;padding:8px 14px;border-radius:8px;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;transition:opacity .4s;max-width:300px;';
        (document.documentElement || document.body || document).appendChild(_toastEl);
      }
      var s = (title || String(gid) || '');
      if (s.length > 22) s = s.substring(0, 22) + '…';
      _toastEl.textContent = '✓ 已采集 ' + s;
      _toastEl.style.opacity = '1';
      clearTimeout(_toastEl._tm);
      _toastEl._tm = setTimeout(function() { if (_toastEl) _toastEl.style.opacity = '0'; }, 2500);
    } catch(e) {}
  }

  function toSkuSpecsArray(obj) {
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === 'object') {
      var arr = []; var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) arr.push({ key: keys[i], value: String(obj[keys[i]]) });
      return arr;
    }
    return [];
  }

  function getGoodsId() {
    var m = location.search.match(/[?&]goods_id=(\d+)/i);
    if (m) return m[1];
    m = location.search.match(/[?&]goodsID=(\d+)/i);
    if (m) return m[1];
    return '';
  }

  function toFloat(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { v = v.replace(/[^\d.]/g, ''); return parseFloat(v) || 0; }
    return 0;
  }
  function toInt(v) { return parseInt(v) || 0; }
  function parseSalesTip(tip) {
    if (!tip || typeof tip !== 'string') return 0;
    var m = tip.match(/(\d+)/);
    return m ? parseInt(m[1]) || 0 : 0;
  }
  function centsToYuan(v) {
    if (typeof v === 'number') {
      if (v <= 0) return 0;
      if (v >= 100) return v / 100;
      return v;
    }
    if (typeof v === 'string') {
      var cleaned = v.replace(/[^\d.]/g, '');
      var n = parseFloat(cleaned);
      if (n <= 0) return 0;
      if (cleaned.indexOf('.') !== -1) return n;
      if (n >= 10000) return n / 100;
      return n;
    }
    return 0;
  }

  function safeSkuPrice(sku) {
    if (!sku || typeof sku !== 'object') return 0;
    if (sku.groupPrice) { var p1 = parseFloat(sku.groupPrice); if (p1 > 0) return p1; }
    if (sku.normalPrice) { var p2 = parseFloat(sku.normalPrice); if (p2 > 0) return p2; }
    if (sku.skuPrice) return centsToYuan(sku.skuPrice);
    if (sku.price) return centsToYuan(sku.price);
    return 0;
  }

  function safeGoodsPrice(gd) {
    if (!gd || typeof gd !== 'object') return 0;
    if (gd.minGroupPrice) { var p1 = parseFloat(gd.minGroupPrice); if (p1 > 0) return p1; }
    if (gd.group_price) return centsToYuan(gd.group_price);
    if (gd.min_on_sale_group_price) return centsToYuan(gd.min_on_sale_group_price);
    if (gd.price) return centsToYuan(gd.price);
    return 0;
  }

  function isValidTitle(t) {
    if (!t || t.length < 4) return false;
    // Reject JS code
    if (/^!function|^function[\s(]|var\s+\w+\s*=|=>\s*{|\.__pft|new\s+Date|window\./.test(t)) return false;
    // Reject site name
    if (/^\u62fc\u591a\u591a\u5546\u57ce$|^Pinduoduo$/i.test(t.trim())) return false;
    // Reject browser/player messages
    if (/\u6d4f\u89c8\u5668.*\u4e0d\u652f\u6301|\u4e0d\u652f\u6301.*\u64ad\u653e|\u89c6\u9891\u64ad\u653e|\u60a8\u7684\u6d4f\u89c8\u5668/.test(t)) return false;
    // Reject promo badges
    if (/^\u5df2\u4f18\u60e0\d|^\u9650\u65f6|^\u7279\u4ef7|^\u9886\u5238/.test(t)) return false;
    // Reject long descriptions (>150 chars with multiple periods)
    if (t.length > 150 && (t.match(/[\u3002.]/g) || []).length > 3) return false;
    // Must have at least 4 Chinese characters
    var cc = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cc < 4) return false;
    return true;
  }

  function postGoods(data) {
    var gid = String(data.goods_id || '');
    if (!gid) return;
    if (window.__PDD_CAPTURE_ENABLED === false) return;
    var t = (data.title || '').trim();
    if (!t || !isValidTitle(t)) {
      console.log('[PDD] Rejected bad/missing title: ' + gid + ' title=' + (t||'').substring(0, 50));
      return;
    }
    var newScore = dataScore(data);
    var prevScore = sentScore[gid] || 0;
    if (sent[gid] && isValidTitle(sent[gid]) && newScore <= prevScore) {
      console.log('[PDD] Skip post (score ' + newScore + '<=' + prevScore + '): ' + gid);
      return;
    }
    sent[gid] = t;
    sentPrice[gid] = data.price || 0;
    sentScore[gid] = newScore;
    data.goods_id = gid;
    data.source_url = location.href;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', INGEST_URL, true);
      xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          showToast(gid, t);
          try {
            window.postMessage({type:'PDD_CAPTURED', goods_id: gid, title: t,
              price: data.price || 0, skus: (data.skus || []).length,
              images: (data.main_images || []).length}, '*');
          } catch(e) {}
        }
      };
      var postData = Object.assign({}, data);
      delete postData.skuImageMap;
      if (capturedRawInitData) {
        postData.raw_init_data = capturedRawInitData;
      } else if (capturedRaw) {
        var rawObj = {goods: capturedRaw};
        if (capturedMall) rawObj.mall = capturedMall;
        postData.raw_init_data = rawObj;
      }
      xhr.send(JSON.stringify(postData));
      console.log('[PDD] Posted: ' + gid + ' title=' + (data.title||'').substring(0,30) + ' price=' + data.price + ' imgs=' + (data.main_images||[]).length + ' skus=' + (data.skus||[]).length);
    } catch(e) {}
  }

  function isGoodsData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var hasId = !!(obj.goods_id || obj.goodsID);
    // Must have title/desc/gallery - NOT just price (price-only entries come from consult_goods_price)
    var hasInfo = !!(obj.goods_name || obj.goodsName || obj.goods_desc ||
      obj.gallery || obj.top_gallery || obj.topGallery ||
      obj.min_group_price || obj.group_price || obj.min_normal_price);
    return hasId && hasInfo;
  }

  function findGoodsData(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (isGoodsData(obj)) return obj;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) {
          for (var j = 0; j < Math.min(v.length, 50); j++) {
            var f = findGoodsData(v[j], depth + 1);
            if (f) return f;
          }
        } else {
          var f2 = findGoodsData(v, depth + 1);
          if (f2) return f2;
        }
      }
    }
    return null;
  }

  function findMallData(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    if (obj.mallName || obj.mallID || obj.mall_name || obj.mall_id) return obj;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) {
          for (var j = 0; j < Math.min(v.length, 50); j++) {
            var f = findMallData(v[j], depth + 1);
            if (f) return f;
          }
        } else {
          var f2 = findMallData(v, depth + 1);
          if (f2) return f2;
        }
      }
    }
    return null;
  }

  function extractPriceYuan(gd) {
    var gp = safeGoodsPrice(gd);
    if (gp > 0) return gp;

    var numFields = [gd.min_group_price, gd.group_price, gd.price,
      gd.min_on_sale_group_price, gd.min_normal_price];
    for (var i = 0; i < numFields.length; i++) {
      var p = centsToYuan(numFields[i]);
      if (p > 0) return p;
    }
    if (gd.group_price_info && typeof gd.group_price_info === 'object') {
      var gp2 = centsToYuan(gd.group_price_info.price);
      if (gp2 > 0) return gp2;
    }
    if (gd.price_info && typeof gd.price_info === 'object') {
      var pp2 = centsToYuan(gd.price_info.price);
      if (pp2 > 0) return pp2;
    }
    if (gd.price_info && typeof gd.price_info === 'string') {
      var pp = parseFloat(gd.price_info);
      if (pp > 0) return pp;
    }
    if (gd.display_price && typeof gd.display_price === 'string') {
      var dp = parseFloat(gd.display_price);
      if (dp > 0) return dp;
    }
    var skuList = gd.sku || gd.skus || [];
    if (Array.isArray(skuList) && skuList.length > 0) {
      var minPrice = Infinity;
      for (var s = 0; s < skuList.length; s++) {
        var sk = skuList[s];
        if (!sk) continue;
        var sp = safeSkuPrice(sk);
        if (sp > 0 && sp < minPrice) minPrice = sp;
      }
      if (minPrice < Infinity) return minPrice;
    }
    return 0;
  }

  function extractImages(gd, keys) {
    var imgs = [];
    for (var k = 0; k < keys.length; k++) {
      var arr = gd[keys[k]];
      if (!Array.isArray(arr)) continue;
      for (var m = 0; m < arr.length; m++) {
        var img = arr[m];
        var url = typeof img === 'string' ? img : (img && (img.url || img.src || ''));
        if (url && url.indexOf('http') === 0 && imgs.indexOf(url) < 0) imgs.push(url);
      }
    }
    return imgs;
  }

  function extractAndPost(gd) {
    var gid = String(gd.goods_id || gd.goodsID || getGoodsId());
    if (!gid) return;

    var price = extractPriceYuan(gd);
    var origPrice = centsToYuan(gd.market_price || gd.normal_price || gd.original_price || 0);

    var data = {
      goods_id: gid,
      title: gd.goods_name || gd.goodsName || gd.goods_title || gd.title || '',
      subtitle: gd.goods_desc || gd.desc || '',
      price: price,
      original_price: origPrice,
      min_group_price: price,
      sales: toInt(gd.sales || gd.sold_quantity || (gd.side_ext && gd.side_ext.sold_quantity) || (gd.sideExt && gd.sideExt.soldQuantity)) || parseSalesTip(gd.sideSalesTip || gd.side_sales_tip),
      sold_quantity: toInt(gd.sold_quantity || gd.sales),
      shop_name: gd.mall_name || gd.mall_name_text || gd.shop_name || '',
      shop_id: String(gd.mall_id || gd.shop_id || ''),
      shop_logo: gd.mall_logo || gd.shop_logo || '',
      main_images: extractImages(gd, ['top_gallery','topGallery','gallery','images']),
      detail_images: extractImages(gd, ['detail_gallery','detailGallery','desc_gallery','goods_desc_images']),
      sku_images: [],
      specs: {},
      skus: [],
      description: gd.goods_desc || gd.desc || '',
      attributes: {},
      selling_points: [],
      source_url: location.href
    };

    if (!data.sales) {
      var skuList2 = gd.sku || gd.skus || [];
      if (Array.isArray(skuList2)) {
        var totalSold = 0;
        for (var si = 0; si < skuList2.length; si++) {
          totalSold += toInt(skuList2[si].soldQuantity || skuList2[si].sold_quantity || 0);
        }
        if (totalSold > 0) data.sales = totalSold;
        if (totalSold > 0 && !data.sold_quantity) data.sold_quantity = totalSold;
      }
    }

    // SKUs
    var skuList = gd.sku || gd.skus || [];
    if (Array.isArray(skuList)) {
      for (var s = 0; s < skuList.length; s++) {
        var sk = skuList[s];
        if (!sk || typeof sk !== 'object') continue;
        var sp = safeSkuPrice(sk);
        var sop = centsToYuan(sk.normal_price || sk.original_price || sk.normalPrice || 0);
        data.skus.push({
          sku_id: String(sk.sku_id || sk.skuId || sk.skuID || ''),
          price: sp, original_price: sop,
          stock: toInt(sk.quantity || sk.stock),
          image: sk.thumb_url || sk.thumbUrl || sk.image || '',
          specs: []
        });
        var simg = sk.thumb_url || sk.thumbUrl || sk.image || sk.sku_image;
        if (simg && simg.indexOf('http') === 0 && data.sku_images.indexOf(simg) < 0) data.sku_images.push(simg);
        var specs = sk.specs || sk.spec || [];
        var lastSku = data.skus[data.skus.length - 1];
        if (Array.isArray(specs)) {
          for (var si = 0; si < specs.length; si++) {
            var spec = specs[si];
            if (spec && (spec.spec_key || spec.key || spec.spec || spec.name) && (spec.spec_value || spec.value)) {
              var skName = spec.spec_key || spec.key || spec.spec || spec.name;
              var skVal = spec.spec_value || spec.value || '';
              if (skName && skVal) {
                if (lastSku) lastSku.specs.push({key: skName, value: skVal});
                if (!data.specs[skName]) data.specs[skName] = [];
                if (data.specs[skName].indexOf(skVal) < 0) data.specs[skName].push(skVal);
              }
            }
          }
        } else if (specs && typeof specs === 'object') {
          var specObjKeys = Object.keys(specs);
          for (var ski = 0; ski < specObjKeys.length; ski++) {
            var skName2 = specObjKeys[ski];
            var skVal2 = String(specs[skName2] || '');
            if (!skName2 || !skVal2) continue;
            if (!data.specs[skName2]) data.specs[skName2] = [];
            if (data.specs[skName2].indexOf(skVal2) < 0) data.specs[skName2].push(skVal2);
          }
        }
      }
    }

    // Attributes
    var attrKeys = ['goods_props','attributes','properties','spec_list'];
    for (var a = 0; a < attrKeys.length; a++) {
      var props = gd[attrKeys[a]];
      if (Array.isArray(props)) {
        for (var p = 0; p < props.length; p++) {
          var pr = props[p];
          if (pr && (pr.key || pr.name) && (pr.value || pr.val)) {
            data.attributes[pr.key || pr.name] = pr.value || pr.val;
          }
        }
      }
    }

    var gpArr = gd.goodsProperty || gd.goods_property || [];
    if (Array.isArray(gpArr)) {
      for (var gp = 0; gp < gpArr.length; gp++) {
        var gpItem = gpArr[gp];
        if (gpItem && gpItem.key && gpItem.values && gpItem.values.length > 0) {
          data.attributes[gpItem.key] = gpItem.values[0];
        }
      }
    }

    // Selling points
    var tags = gd.service_tags || gd.goods_service_tags || gd.tags || [];
    if (Array.isArray(tags)) {
      for (var t = 0; t < tags.length; t++) {
        var tag = tags[t];
        var txt = typeof tag === 'string' ? tag : (tag && (tag.text || tag.name || tag.desc || ''));
        if (txt && data.selling_points.indexOf(txt) < 0) data.selling_points.push(txt);
      }
    }

    // Promotions
    var promos = gd.promotions || gd.promotion || [];
    if (Array.isArray(promos)) {
      for (var pr2 = 0; pr2 < promos.length; pr2++) {
        var pp = promos[pr2];
        var pt = typeof pp === 'string' ? pp : (pp && (pp.text || pp.desc || ''));
        if (pt && data.selling_points.indexOf(pt) < 0) data.selling_points.push(pt);
      }
    }

    if (capturedMall) data.mall_info = capturedMall;

    postGoods(data);
  }

  // ======== Parse consult_goods_price response and store prices ========
  function capturePriceMap(data) {
    var gpm = data.goods_price_map;
    if (!gpm || typeof gpm !== 'object') return;
    var keys = Object.keys(gpm);
    for (var i = 0; i < keys.length; i++) {
      var gid = keys[i];
      var entry = gpm[gid];
      if (!entry || typeof entry !== 'object') continue;
      var p = 0;
      if (entry.display_price) p = parseFloat(entry.display_price);
      if (!p && entry.price_info && typeof entry.price_info === 'string') p = parseFloat(entry.price_info);
      if (!p && entry.min_on_sale_group_price) p = centsToYuan(entry.min_on_sale_group_price);
      if (p > 0) {
        priceMap[String(entry.goods_id || gid)] = p;
        console.log('[PDD] PriceMap: ' + gid + ' = ' + p);
      }
      var skuPrices = entry.sku_price_list || entry.sku_list || entry.multi_price || [];
      if (Array.isArray(skuPrices)) {
        for (var j = 0; j < skuPrices.length; j++) {
          var sp = skuPrices[j];
          if (!sp || typeof sp !== 'object') continue;
          var spp = centsToYuan(sp.price || sp.group_price || 0);
          if (spp <= 0) continue;
          var specs = sp.specs || sp.spec || {};
          if (typeof specs === 'object' && !Array.isArray(specs)) {
            var specVals = Object.values(specs);
            for (var sv = 0; sv < specVals.length; sv++) {
              if (specVals[sv]) skuPriceMap[String(specVals[sv])] = spp;
            }
          } else if (Array.isArray(specs)) {
            for (var sv2 = 0; sv2 < specs.length; sv2++) {
              var svItem = specs[sv2];
              if (svItem && (svItem.spec_value || svItem.value)) {
                skuPriceMap[String(svItem.spec_value || svItem.value)] = spp;
              }
            }
          }
        }
        if (skuPrices.length > 0) {
          console.log('[PDD] SKU prices captured: ' + skuPrices.length + ' for ' + gid);
        }
      }
    }
  }

  function deepExtractSkuData(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    var hasSkus = false;
    if (Array.isArray(obj)) {
      for (var i = 0; i < Math.min(obj.length, 20); i++) {
        var item = obj[i];
        if (item && typeof item === 'object' && (item.sku_id || item.skuId || item.specs || item.spec)) {
          hasSkus = true;
          break;
        }
      }
    }
    if (hasSkus) return obj;
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var v = obj[keys[k]];
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) {
          for (var j = 0; j < Math.min(v.length, 30); j++) {
            if (v[j] && typeof v[j] === 'object' && (v[j].sku_id || v[j].skuId || v[j].group_price || v[j].multi_price || v[j].sku_price_list)) {
              return v;
            }
            var found = deepExtractSkuData(v[j], depth + 1);
            if (found) return found;
          }
        } else {
          if (v.sku || v.skus || v.sku_list || v.skuPriceList || v.multi_price || v.sku_price_list) {
            return v.sku || v.skus || v.sku_list || v.skuPriceList || v.multi_price || v.sku_price_list;
          }
          if (v.goods_id && (v.min_group_price || v.group_price)) return v;
          var found2 = deepExtractSkuData(v, depth + 1);
          if (found2) return found2;
        }
      }
    }
    return null;
  }

  function extractSkuPricesFromReactFiber() {
    try {
      var rootEl = document.getElementById('root') || document.getElementById('app');
      if (!rootEl) return null;
      var fiberKey = Object.keys(rootEl).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
      if (!fiberKey) return null;
      var fiber = rootEl[fiberKey];
      var node = fiber;
      for (var depth = 0; depth < 80 && node; depth++) {
        var props = node.memoizedProps || {};
        var state = node.memoizedState || {};
        var stateQueue = state;
        while (stateQueue) {
          var qVal = stateQueue.memoizedState;
          if (qVal && typeof qVal === 'object') {
            if (qVal.current && typeof qVal.current === 'object') {
              var inner = qVal.current;
              if (inner.goods || inner.skuList || inner.sku_list || inner.goodsData) {
                var data = inner.goods || inner.skuList || inner.sku_list || inner.goodsData;
                if (Array.isArray(data) && data.length > 0 && data[0] && data[0].sku_id) return data;
                if (data && typeof data === 'object') {
                  var skuArr = data.sku || data.skus || data.sku_list;
                  if (Array.isArray(skuArr) && skuArr.length > 0) return skuArr;
                }
              }
            }
            var deepResult = deepExtractSkuData(qVal, 0);
            if (deepResult) return deepResult;
          }
          stateQueue = stateQueue.next;
        }
        var propKeys = Object.keys(props);
        for (var pk = 0; pk < propKeys.length; pk++) {
          var pv = props[propKeys[pk]];
          if (pv && typeof pv === 'object') {
            if (pv.sku && Array.isArray(pv.sku) && pv.sku.length > 0) return pv.sku;
            if (pv.skus && Array.isArray(pv.skus) && pv.skus.length > 0) return pv.skus;
            if (pv.skuList && Array.isArray(pv.skuList) && pv.skuList.length > 0) return pv.skuList;
            if (pv.multi_price && typeof pv.multi_price === 'object') return pv.multi_price;
            if (pv.sku_price_list && Array.isArray(pv.sku_price_list)) return pv.sku_price_list;
            var propResult = deepExtractSkuData(pv, 0);
            if (propResult) return propResult;
          }
        }
        node = node.return;
      }
    } catch(e) {}
    return null;
  }

  function extractSkuPricesFromGlobalState() {
    try {
      var storeKeys = ['__REDUX_STATE__', '__NEXT_DATA__', '__APP_DATA__', '__INITIAL_DATA__', '__PRELOADED_STATE__', '__pdd_data__', 'window.__rawData__', '__INITIAL_STATE__'];
      for (var i = 0; i < storeKeys.length; i++) {
        var store = window[storeKeys[i]];
        if (!store || typeof store !== 'object') continue;
        var result = deepExtractSkuData(store, 0);
        if (result) return result;
      }
    } catch(e) {}
    return null;
  }

  function extractFullSkuDataFromScripts() {
    var result = { skus: [], priceMap: {}, skuImageMap: {} };
    try {
      var scripts = document.querySelectorAll('script');
      for (var s = 0; s < scripts.length; s++) {
        var txt = scripts[s].textContent || '';
        if (txt.length < 200 || txt.length > 1000000) continue;
        var skuPatterns = [
          /["']sku["']\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/,
          /["']skus["']\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/,
          /["']sku_list["']\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/,
          /["']skuList["']\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/,
          /["']multi_price["']\s*:\s*(\[[\s\S]{100,50000}?\])\s*[,}]/
        ];
        for (var p = 0; p < skuPatterns.length; p++) {
          var match = txt.match(skuPatterns[p]);
          if (match) {
            try {
              var skuArr = JSON.parse(match[1]);
              if (Array.isArray(skuArr) && skuArr.length > 0 && skuArr[0] && (skuArr[0].sku_id || skuArr[0].group_price || skuArr[0].price)) {
                console.log('[PDD] Found SKU array in script tag: ' + skuArr.length + ' items');
                result.skus = skuArr;
                for (var k = 0; k < skuArr.length; k++) {
                  var sku = skuArr[k];
                  if (!sku) continue;
                  var price = centsToYuan(sku.group_price || sku.price || sku.sku_price || 0);
                  var specs = sku.specs || sku.spec || sku.specifications || {};
                  if (typeof specs === 'object' && !Array.isArray(specs)) {
                    var vals = Object.values(specs);
                    for (var v = 0; v < vals.length; v++) {
                      if (vals[v] && price > 0) result.priceMap[String(vals[v])] = price;
                    }
                  } else if (Array.isArray(specs)) {
                    for (var vi = 0; vi < specs.length; vi++) {
                      var specVal = specs[vi].spec_value || specs[vi].value || specs[vi];
                      if (specVal && price > 0) result.priceMap[String(specVal)] = price;
                    }
                  }
                  var thumb = sku.thumb_url || sku.image || sku.sku_image || sku.thumbUrl || '';
                  if (thumb && typeof specs === 'object' && !Array.isArray(specs)) {
                    var specVals2 = Object.values(specs);
                    for (var v2 = 0; v2 < specVals2.length; v2++) {
                      if (specVals2[v2]) result.skuImageMap[String(specVals2[v2])] = thumb;
                    }
                  }
                }
                return result;
              }
            } catch(e2) {}
          }
        }
        var pricePatterns = [
          /["']min_group_price["']\s*:\s*(\d+\.?\d*)/,
          /["']group_price["']\s*:\s*(\d+\.?\d*)/,
          /["']min_price["']\s*:\s*(\d+\.?\d*)/,
          /["']price["']\s*:\s*(\d+\.?\d*)/
        ];
        for (var pp = 0; pp < pricePatterns.length; pp++) {
          var pm = txt.match(pricePatterns[pp]);
          if (pm) {
            var foundPrice = centsToYuan(pm[1]);
            if (foundPrice > 0 && foundPrice < 1000) {
              console.log('[PDD] Found price pattern in script: ' + foundPrice);
            }
          }
        }
      }
    } catch(e) {}
    return result;
  }

  function domGetTitle() {
    // Strategy 1: Try to get title from React fiber tree
    try {
      var rootEl = document.getElementById('root') || document.getElementById('app') || document.querySelector('[id]');
      if (rootEl) {
        var fiberKey = Object.keys(rootEl).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
        if (fiberKey) {
          var fiber = rootEl[fiberKey];
          // Walk up the fiber tree looking for goods_name/title in props or state
          var node = fiber;
          for (var depth = 0; depth < 50 && node; depth++) {
            var props = node.memoizedProps || node.pendingProps || {};
            var state = node.memoizedState || {};
            // Check props for title
            if (props.goods_name && typeof props.goods_name === 'string' && props.goods_name.length > 2) return props.goods_name;
            if (props.title && typeof props.title === 'string' && props.title.length > 5 && props.title.length < 300 && /[\u4e00-\u9fff]/.test(props.title)) return props.title;
            if (props.goodsName && typeof props.goodsName === 'string' && props.goodsName.length > 2) return props.goodsName;
            // Check state
            if (state.memoizedState && typeof state.memoizedState === 'object') {
              var sm = state.memoizedState;
              if (sm.goods_name && typeof sm.goods_name === 'string' && sm.goods_name.length > 2) return sm.goods_name;
            }
            // Check for nested data
            if (props.data && typeof props.data === 'object') {
              if (props.data.goods_name && typeof props.data.goods_name === 'string' && props.data.goods_name.length > 2) return props.data.goods_name;
              if (props.data.title && typeof props.data.title === 'string' && props.data.title.length > 5) return props.data.title;
            }
            if (props.goods && typeof props.goods === 'object') {
              if (props.goods.goods_name && typeof props.goods.goods_name === 'string' && props.goods.goods_name.length > 2) return props.goods.goods_name;
            }
            node = node.return;
          }
        }
      }
    } catch(e) {}

    // Strategy 2: Try common global variables
    try {
      var globals = ['__INITIAL_DATA__', '__PRELOADED_STATE__', '__APP_DATA__', 'goodsData', 'goods_data', '__pdd_data__', '__NEXT_DATA__'];
      for (var gi = 0; gi < globals.length; gi++) {
        var g = window[globals[gi]];
        if (g && typeof g === 'object') {
          var gn = g.goods_name || g.goodsName || (g.data && (g.data.goods_name || g.data.goodsName));
          if (gn && typeof gn === 'string' && gn.length > 2) return gn;
        }
      }
    } catch(e) {}

    // Strategy 3: document.title (strip site name)
    var dt = document.title || '';
    var cleaned = dt.replace(/[\s]*[-_\|\u00b7]\s*(拼多多|拼多商城|Pinduoduo|PDD).*$/i, '').trim();
    if (cleaned.length > 5 && /[\u4e00-\u9fff]/.test(cleaned) && !/拼多多商城/.test(cleaned)) return cleaned;

    // Strategy 4: og:title
    var og = document.querySelector('meta[property="og:title"]');
    if (og) {
      var ot = (og.getAttribute('content') || '').trim();
      ot = ot.replace(/[\s]*[-_\|\u00b7]\s*(拼多多|拼多商城|Pinduoduo|PDD).*$/i, '').trim();
      if (ot.length > 5 && /[\u4e00-\u9fff]/.test(ot) && !/拼多多商城/.test(ot)) return ot;
    }

    // Strategy 5: DOM scan with strict blacklist (last resort)
    var root = document.body || document.documentElement;
    if (!root) return '';
    var blacklist = /浏览器|不支持|视频|播放|已拼|销量|评价|店铺|进店|客服|原拼|立即|购买|加入|收藏|分享|举报|投诉|规格|参数|详情|推荐|相似|原价|现价|到手|限时|选择|配送|数量|服务|保障|退货|换货|运费|发货|收货|地址|订单|支付|确认|拼单价|拼多多商城|Pinduoduo|function|var |let |const |=>|__pft|new Date|error|Error|undefined|null|loading|加载|刷新|重试|网络|版本|更新|下载|安装|1\/\d+/;
    var priceEl = null;
    var spans = root.querySelectorAll('span, div, em');
    for (var pi = 0; pi < spans.length; pi++) {
      if (/[¥￥]\s*\d/.test(spans[pi].textContent || '') && (spans[pi].textContent || '').length < 30) {
        priceEl = spans[pi]; break;
      }
    }
    var allEls = root.querySelectorAll('div, span, p, h1, h2, h3, a, li');
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE') continue;
      if (priceEl && priceEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
      var directText = '';
      for (var ci = 0; ci < el.childNodes.length; ci++) {
        if (el.childNodes[ci].nodeType === 3) directText += el.childNodes[ci].textContent;
      }
      var txt = directText.trim();
      if (txt.length < 10 || txt.length > 300) continue;
      if (!/[\u4e00-\u9fff]/.test(txt)) continue;
      var cc = (txt.match(/[\u4e00-\u9fff]/g) || []).length;
      if (cc < 8) continue;
      if (blacklist.test(txt)) continue;
      if (/[¥￥]\s*\d/.test(txt)) continue;
      return txt;
    }
    return '';
  }

  function domGetPopupPrice() {
    try {
      var containers = document.querySelectorAll('div,section');
      for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        if (!c || c.offsetHeight === 0 || c.offsetWidth === 0) continue;
        var cs = window.getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
        var zIndex = parseInt(cs.zIndex) || 0;
        var pos = cs.position;
        if (zIndex < 100 && pos !== 'fixed' && pos !== 'absolute') continue;
        var text = c.innerText || '';
        if (text.length > 500 || text.length < 3) continue;
        if (/\u53e3\u5473|\u5957\u9910|\u5df2\u9009/.test(text) && text.length < 300) {
          var m = text.match(/[\xA5\uFFE5]\s*(\d+\.?\d*)/);
          if (m) {
            var p = parseFloat(m[1]);
            if (p > 0) return p;
          }
        }
      }
    } catch(e) {}
    return 0;
  }

  function domGetPrice() {
    var main = (document.body || document.documentElement);
    if (!main) return 0;
    var popupPrice = domGetPopupPrice();
    if (popupPrice > 0) return popupPrice;
    var text = main.innerText || '';
    var m = text.match(/[\xA5\uFFE5]\s*(\d+\.?\d*)/);
    if (m) return parseFloat(m[1]);
    m = text.match(/(\d+\.\d{1,2})\s*\u5143/);
    if (m) return parseFloat(m[1]);
    return 0;
  }

  function domGetSales() {
    var main = (document.body || document.documentElement);
    if (!main) return 0;
    var text = main.innerText || '';
    var m = text.match(/已拼([\d,.万]+)件/);
    if (!m) m = text.match(/([\d,.万]+)人已拼/);
    if (!m) m = text.match(/月销([\d,.万]+)/);
    if (m) {
      var s = m[1].replace(/,/g, '');
      if (s.indexOf('万') > -1) return Math.round(parseFloat(s) * 10000);
      return parseInt(s) || 0;
    }
    return 0;
  }

  function domGetShop() {
    var main = (document.body || document.documentElement);
    if (!main) return '';
    var text = main.innerText || '';
    var m = text.match(/([^\s]{2,20}(?:旗舰店|专卖店|专营店|官方|自营))/);
    if (m) return m[1];
    m = text.match(/([^\s\n]{2,20})\s*进店/);
    if (m) return m[1];
    return '';
  }

  function domGetImages() {
    var main = (document.body || document.documentElement);
    if (!main) return [];
    var imgs = [];
    var seen = {};
    var allImgs = main.querySelectorAll('img');
    for (var i = 0; i < allImgs.length; i++) {
      var src = allImgs[i].src || allImgs[i].getAttribute('data-src') || '';
      if (src && src.indexOf('http') === 0 && !seen[src] &&
          (src.indexOf('pddpic') > -1 || src.indexOf('yangkeduo') > -1)) {
        var w = allImgs[i].naturalWidth || allImgs[i].width || 0;
        if (w === 0 || w > 100) {
          seen[src] = true;
          imgs.push(src);
        }
      }
    }
    return imgs;
  }

  function scrapeDOMAndPost() {
    var gid = getGoodsId();
    if (!gid) return;

    var title = domGetTitle();
    var price = domGetPrice();
    var sales = domGetSales();
    var shop = domGetShop();
    var images = domGetImages();

    if (!title && !price && images.length === 0) return;

    // Score-based dedup: allow re-post if data is richer
    if (sent[gid]) {
      var prevPrice = sentPrice[gid] || 0;
      if (price > 0 && prevPrice > 0 && Math.abs(price - prevPrice) / prevPrice > 0.3) {
        delete sent[gid];
        delete sentScore[gid];
      }
      // Don't block here - let postGoods() handle score-based dedup after data is built
    }

    var data = {
      goods_id: gid,
      title: title,
      subtitle: '',
      price: price,
      original_price: 0,
      min_group_price: price,
      sales: sales,
      sold_quantity: sales,
      shop_name: shop,
      shop_id: '',
      shop_logo: '',
      main_images: images,
      detail_images: [],
      sku_images: [],
      specs: {},
      skus: [],
      description: '',
      attributes: {},
      selling_points: [],
      source_url: location.href,
      mall_info: capturedMall || null
    };

    // Check for proxy-extracted data from mitmproxy
    try {
      var proxyData = window.__PDD_PROXY_DATA;
      if (proxyData && proxyData.goods_id === gid && proxyData.title && isValidTitle(proxyData.title)) {
        data.title = proxyData.title;
        console.log('[PDD] Title from proxy: ' + proxyData.title.substring(0, 40));
      }
    } catch(e) {}

    // Merge with captured raw data from JSON.parse - prefer API title over DOM
    if (capturedRaw && String(capturedRaw.goods_id || capturedRaw.goodsID) === gid) {
      var apiTitle = capturedRaw.goods_name || capturedRaw.goodsName || capturedRaw.goods_title || capturedRaw.title || '';
      if (apiTitle && apiTitle.length > 2) {
        data.title = apiTitle;
        console.log('[PDD] Title from API intercept: ' + apiTitle.substring(0, 40));
      } else if (!data.title && capturedRaw.goods_name) {
        data.title = capturedRaw.goods_name;
      }
      var rp = extractPriceYuan(capturedRaw);
      if (rp > 0) {
        data.price = rp;
        data.min_group_price = data.price;
      }
      if (!data.original_price) {
        data.original_price = centsToYuan(capturedRaw.market_price || capturedRaw.normal_price || 0);
      }
      if (!data.sales) data.sales = toInt(capturedRaw.sales || capturedRaw.sold_quantity);
      if (!data.shop_name) data.shop_name = capturedRaw.mall_name || capturedRaw.shop_name || '';
      if (!data.shop_id) data.shop_id = String(capturedRaw.mall_id || capturedRaw.shop_id || '');
      if (data.main_images.length === 0) {
        data.main_images = extractImages(capturedRaw, ['top_gallery','topGallery','gallery','images']);
      }
      if (capturedRaw.sku || capturedRaw.skus) {
        var skuList = capturedRaw.sku || capturedRaw.skus || [];
        if (Array.isArray(skuList)) {
          for (var s = 0; s < skuList.length; s++) {
            var sk = skuList[s];
            if (!sk || typeof sk !== 'object') continue;
            var sp = centsToYuan(sk.group_price || sk.price || 0);
            var sop = centsToYuan(sk.normal_price || sk.original_price || 0);
            var skSpecs = toSkuSpecsArray(sk.specs || sk.spec || {});
            var skuSpecArr = [];
            if (Array.isArray(skSpecs)) {
              for (var _si = 0; _si < skSpecs.length; _si++) {
                var _sp = skSpecs[_si];
                if (_sp && (_sp.spec_key || _sp.key || _sp.name) && (_sp.spec_value || _sp.value)) {
                  skuSpecArr.push({key: _sp.spec_key || _sp.key || _sp.name, value: _sp.spec_value || _sp.value});
                }
              }
            }
            data.skus.push({
              sku_id: String(sk.sku_id || sk.skuId || sk.skuID || ''),
              specs: skuSpecArr,
              price: sp, original_price: sop,
              stock: toInt(sk.quantity || sk.stock), image: sk.thumb_url || sk.thumbUrl || sk.image || ''
            });
            if (sp > 0 && Array.isArray(skSpecs)) {
              for (var si = 0; si < skSpecs.length; si++) {
                if (skSpecs[si] && skSpecs[si].value) {
                  skuPriceMap[skSpecs[si].value] = sp;
                }
              }
            }
          }
        }
      }
      // Also extract detail_images, sku_images, attributes, selling_points from capturedRaw
      if (data.detail_images.length === 0) {
        data.detail_images = extractImages(capturedRaw, ['detail_gallery','detailGallery','desc_gallery','goods_desc_images']);
      }
      if (data.sku_images.length === 0) {
        // Collect SKU images from skus
        var skuList2 = capturedRaw.sku || capturedRaw.skus || [];
        if (Array.isArray(skuList2)) {
          for (var si2 = 0; si2 < skuList2.length; si2++) {
            var simg = skuList2[si2] && (skuList2[si2].thumb_url || skuList2[si2].image || skuList2[si2].sku_image);
            if (simg && simg.indexOf('http') === 0 && data.sku_images.indexOf(simg) < 0) data.sku_images.push(simg);
          }
        }
      }
      if (Object.keys(data.attributes).length === 0) {
        var attrKeys = ['goods_props','attributes','properties','spec_list'];
        for (var ai = 0; ai < attrKeys.length; ai++) {
          var props = capturedRaw[attrKeys[ai]];
          if (Array.isArray(props)) {
            for (var pi = 0; pi < props.length; pi++) {
              var pr = props[pi];
              if (pr && (pr.key || pr.name) && (pr.value || pr.val)) {
                data.attributes[pr.key || pr.name] = pr.value || pr.val;
              }
            }
          }
        }
        var gpArr = capturedRaw.goodsProperty || capturedRaw.goods_property || [];
        if (Array.isArray(gpArr)) {
          for (var gp = 0; gp < gpArr.length; gp++) {
            var gpItem = gpArr[gp];
            if (gpItem && gpItem.key && gpItem.values && gpItem.values.length > 0) {
              data.attributes[gpItem.key] = gpItem.values[0];
            }
          }
        }
      }
      if (data.selling_points.length === 0) {
        var tagKeys = ['service_tags', 'goods_service_tags', 'tags'];
        for (var tk = 0; tk < tagKeys.length; tk++) {
          var tags = capturedRaw[tagKeys[tk]];
          if (Array.isArray(tags)) {
            for (var ti = 0; ti < tags.length; ti++) {
              var tag = tags[ti];
              var txt = typeof tag === 'string' ? tag : (tag && (tag.text || tag.name || tag.desc || ''));
              if (txt && data.selling_points.indexOf(txt) < 0) data.selling_points.push(txt);
            }
          }
        }
      }
      if (!data.description) data.description = capturedRaw.goods_desc || capturedRaw.desc || '';
    }

    if (priceMap[gid] && priceMap[gid] > 0) {
      if (!data.price || priceMap[gid] < data.price) {
        data.price = priceMap[gid];
        data.min_group_price = data.price;
      }
    }
    if (!data.original_price && data.price > 0) {
      data.original_price = data.price;
    }

    // ======== DOM spec scraping ========
    if (Object.keys(data.specs).length === 0) {
      try {
        var SPEC_LABELS = /^(颜色|颜色分类|款式|尺码|规格|型号|容量|材质|尺寸|重量|口味|香味|套餐|版本|套装|组合|花色|图案|风格|厚薄|季节|已选|选择)$/;
        var SPEC_EXCLUDE = /^(产地|品牌|厂名|厂址|包装方式|生产日期|保质期|功效|净含量|商品编号)$/;
        var NOISE_EXACT = /^(即将卖完|热销|推荐|新品|限量)$/;
        var main = document.body || document.documentElement;
        if (main) {
          var allEls = main.querySelectorAll('div, span, p, section, h3, h4, label');
          for (var dei = 0; dei < allEls.length; dei++) {
            var del = allEls[dei];
            var directTxt = '';
            for (var dei2 = 0; dei2 < del.childNodes.length; dei2++) {
              if (del.childNodes[dei2].nodeType === 3) directTxt += del.childNodes[dei2].textContent;
            }
            directTxt = directTxt.trim();
            if (!directTxt || directTxt.length > 6 || !SPEC_LABELS.test(directTxt)) continue;
            if (SPEC_EXCLUDE.test(directTxt)) continue;
            var container = del.parentElement;
            if (!container) continue;
            var searchArea = container.parentElement || container;
            var optEls = searchArea.querySelectorAll('div, span, button, a, li, label');
            var optValues = [];
            for (var oi = 0; oi < optEls.length; oi++) {
              var optEl = optEls[oi];
              if (optEl === del || optEl.contains(del) || del.contains(optEl)) continue;
              if (!container.contains(optEl) && optEl !== container) continue;
              var optText = (optEl.textContent || '').trim();
              if (optText.length <= 1 || optText.length > 20 || optText === directTxt) continue;
              if (SPEC_LABELS.test(optText) || SPEC_EXCLUDE.test(optText)) continue;
              if (NOISE_EXACT.test(optText)) continue;
              if (/^[¥￥]/.test(optText)) continue;
              if (/已拼|销量|评价|店铺|进店|客服|购买|加入|收藏|即将卖完|热销|推荐/.test(optText)) continue;
              if (optValues.indexOf(optText) >= 0) continue;
              optValues.push(optText);
            }
            if (optValues.length < 2 || optValues.length > 10) continue;
            data.specs[directTxt] = optValues;
            console.log('[PDD] DOM scraped spec: ' + directTxt + ' = ' + optValues.join(', '));
          }
        }
      } catch(e) { console.log('[PDD] DOM spec scrape error: ' + e.message); }
    }

    // ======== Extract SKU prices from React fiber tree ========
    if (data.skus.length === 0 || Object.keys(skuPriceMap).length === 0) {
      try {
        var reactSkus = extractSkuPricesFromReactFiber();
        if (reactSkus && Array.isArray(reactSkus) && reactSkus.length > 0) {
          console.log('[PDD] Found SKU data from React fiber: ' + reactSkus.length + ' items');
          for (var ri = 0; ri < reactSkus.length; ri++) {
            var rsk = reactSkus[ri];
            if (!rsk || typeof rsk !== 'object') continue;
            var rsp = centsToYuan(rsk.group_price || rsk.price || rsk.sku_price || 0);
            var rsop = centsToYuan(rsk.normal_price || rsk.original_price || 0);
            if (rsp > 0) {
              var rspecs = rsk.specs || rsk.spec || rsk.attributes || [];
              if (Array.isArray(rspecs)) {
                for (var rsi = 0; rsi < rspecs.length; rsi++) {
                  var rspec = rspecs[rsi];
                  if (rspec && rspec.spec_value) skuPriceMap[rspec.spec_value] = rsp;
                  else if (rspec && rspec.value) skuPriceMap[rspec.value] = rsp;
                }
              } else if (typeof rspecs === 'object') {
                var rspecVals = Object.values(rspecs);
                for (var rsv = 0; rsv < rspecVals.length; rsv++) {
                  if (rspecVals[rsv]) skuPriceMap[String(rspecVals[rsv])] = rsp;
                }
              }
              var rName = rsk.spec_name || rsk.name || '';
              if (rName && rsp > 0) skuPriceMap[rName] = rsp;
              data.skus.push({
                sku_id: String(rsk.sku_id || rsk.skuId || ''),
                specs: toSkuSpecsArray(rsk.specs || rsk.spec || {}),
                price: rsp,
                original_price: rsop,
                stock: toInt(rsk.quantity || rsk.stock),
                image: rsk.thumb_url || rsk.image || rsk.sku_image || ''
              });
            }
          }
        }
      } catch(e) { console.log('[PDD] React fiber SKU extraction error: ' + e.message); }
    }

    // ======== Extract SKU prices from global state ========
    if (data.skus.length === 0 || Object.keys(skuPriceMap).length === 0) {
      try {
        var globalSkus = extractSkuPricesFromGlobalState();
        if (globalSkus && Array.isArray(globalSkus) && globalSkus.length > 0) {
          console.log('[PDD] Found SKU data from global state: ' + globalSkus.length + ' items');
          for (var gi2 = 0; gi2 < globalSkus.length; gi2++) {
            var gsk = globalSkus[gi2];
            if (!gsk || typeof gsk !== 'object') continue;
            var gsp = centsToYuan(gsk.group_price || gsk.price || gsk.sku_price || 0);
            var gsop = centsToYuan(gsk.normal_price || gsk.original_price || 0);
            if (gsp > 0) {
              var gspecs = gsk.specs || gsk.spec || gsk.attributes || [];
              if (Array.isArray(gspecs)) {
                for (var gsi = 0; gsi < gspecs.length; gsi++) {
                  var gspec = gspecs[gsi];
                  if (gspec && gspec.spec_value) skuPriceMap[gspec.spec_value] = gsp;
                  else if (gspec && gspec.value) skuPriceMap[gspec.value] = gsp;
                }
              } else if (typeof gspecs === 'object') {
                var gspecVals = Object.values(gspecs);
                for (var gsv = 0; gsv < gspecVals.length; gsv++) {
                  if (gspecVals[gsv]) skuPriceMap[String(gspecVals[gsv])] = gsp;
                }
              }
              data.skus.push({
                sku_id: String(gsk.sku_id || gsk.skuId || ''),
                specs: toSkuSpecsArray(gsk.specs || gsk.spec || {}),
                price: gsp,
                original_price: gsop,
                stock: toInt(gsk.quantity || gsk.stock || 0),
                image: gsk.thumb_url || gsk.image || gsk.sku_image || ''
              });
            }
          }
        }
      } catch(e) { console.log('[PDD] Global state SKU extraction error: ' + e.message); }
    }

    // ======== Extract full SKU data from script tags ========
    if (data.skus.length === 0 || Object.keys(skuPriceMap).length === 0) {
      try {
        var scriptData = extractFullSkuDataFromScripts();
        if (scriptData && scriptData.skus && scriptData.skus.length > 0) {
          console.log('[PDD] Found full SKU data from script tags: ' + scriptData.skus.length + ' items');
          var scriptSkuImageMap = scriptData.skuImageMap || {};
          for (var sci = 0; sci < scriptData.skus.length; sci++) {
            var scSku = scriptData.skus[sci];
            if (!scSku || typeof scSku !== 'object') continue;
            var scPrice = centsToYuan(scSku.group_price || scSku.price || scSku.sku_price || 0);
            var scOrigPrice = centsToYuan(scSku.normal_price || scSku.original_price || scSku.market_price || 0);
            var scStock = parseInt(scSku.quantity || scSku.stock || scSku.inventory || 0) || 0;
            var scImage = scSku.thumb_url || scSku.image || scSku.sku_image || scSku.thumbUrl || '';
            var scSpecs = scSku.specs || scSku.spec || scSku.specifications || {};
            var scSpecArray = [];
            if (typeof scSpecs === 'object' && !Array.isArray(scSpecs)) {
              var scSpecKeys = Object.keys(scSpecs);
              for (var sci2 = 0; sci2 < scSpecKeys.length; sci2++) {
                scSpecArray.push({ key: scSpecKeys[sci2], value: String(scSpecs[scSpecKeys[sci2]]) });
                var sv = String(scSpecs[scSpecKeys[sci2]]);
                if (scPrice > 0) skuPriceMap[sv] = scPrice;
                if (scImage) scriptSkuImageMap[sv] = scImage;
              }
            } else if (Array.isArray(scSpecs)) {
              for (var sci3 = 0; sci3 < scSpecs.length; sci3++) {
                var spItem = scSpecs[sci3];
                if (spItem) {
                  var spKey = spItem.spec_key || spItem.key || spItem.name || '';
                  var spVal = spItem.spec_value || spItem.value || '';
                  if (spKey && spVal) {
                    scSpecArray.push({ key: spKey, value: spVal });
                    if (scPrice > 0) skuPriceMap[spVal] = scPrice;
                    if (scImage) scriptSkuImageMap[spVal] = scImage;
                  }
                }
              }
            }
            if (scPrice > 0 || scStock > 0) {
              data.skus.push({
                sku_id: String(scSku.sku_id || scSku.skuId || scSku.id || ''),
                specs: scSpecArray,
                price: scPrice || data.price,
                original_price: scOrigPrice || data.original_price,
                stock: scStock,
                image: scImage
              });
            }
          }
          if (!data.skuImageMap) data.skuImageMap = {};
          Object.assign(data.skuImageMap, scriptSkuImageMap);
        }
      } catch(e) { console.log('[PDD] Script tag SKU extraction error: ' + e.message); }
    }

    // ======== Generate SKUs from specs if none exist ========
    if (data.skus.length === 0 && Object.keys(data.specs).length > 0) {
      var specNames = Object.keys(data.specs);
      var combinations = [{}];
      for (var si = 0; si < specNames.length; si++) {
        var specName = specNames[si];
        var specValues = data.specs[specName];
        var newCombinations = [];
        for (var gi = 0; gi < combinations.length; gi++) {
          for (var svi = 0; svi < specValues.length; svi++) {
            var newCombo = {};
            var existingKeys = Object.keys(combinations[gi]);
            for (var ek = 0; ek < existingKeys.length; ek++) newCombo[existingKeys[ek]] = combinations[gi][existingKeys[ek]];
            newCombo[specName] = specValues[svi];
            newCombinations.push(newCombo);
          }
        }
        combinations = newCombinations;
      }
      var globalSkuImageMap = (data.skuImageMap || {});
      for (var gi = 0; gi < combinations.length; gi++) {
        var combo = combinations[gi];
        var comboPrice = data.price;
        var comboOrigPrice = data.original_price;
        var comboImage = '';
        var comboKeys = Object.keys(combo);
        for (var ck = 0; ck < comboKeys.length; ck++) {
          var val = combo[comboKeys[ck]];
          if (skuPriceMap[val] && skuPriceMap[val] > 0) {
            comboPrice = skuPriceMap[val];
          }
          if (!comboImage && globalSkuImageMap[val]) {
            comboImage = globalSkuImageMap[val];
          }
        }
        data.skus.push({
          sku_id: '',
          specs: toSkuSpecsArray(combo),
          price: comboPrice,
          original_price: comboOrigPrice,
          stock: 0,
          image: comboImage
        });
      }
      console.log('[PDD] Generated ' + data.skus.length + ' SKUs from ' + specNames.length + ' spec dimensions, skuPriceMap keys=' + Object.keys(skuPriceMap).length + ', imageMap keys=' + Object.keys(globalSkuImageMap).length);
    }

    // ======== Price range from SKUs ========
    if (data.skus.length > 0) {
      var prices = data.skus.map(function(s) { return s.price; }).filter(function(p) { return p > 0; });
      if (prices.length > 0) {
        data.price = Math.min.apply(null, prices);
        data.price_max = Math.max.apply(null, prices);
      }
    }

    console.log('[PDD] DOM scraped ' + gid + ': title=' + data.title.substring(0,30) + ' price=' + data.price + ' imgs=' + data.main_images.length + ' skus=' + data.skus.length + ' specKeys=' + JSON.stringify(Object.keys(data.specs)));
    postGoods(data);
  }

  // ======== Script tag scanning for SSR embedded data ========
  function scanScriptTagsForGoods() {
    try {
      var scripts = document.querySelectorAll('script:not([src])');
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || '';
        if (text.length < 100) continue;
        // Look for goods-related keywords
        if (text.indexOf('initDataObj') < 0 && text.indexOf('goodsID') < 0 && text.indexOf('goods_id') < 0 && text.indexOf('goods_name') < 0 && text.indexOf('goodsName') < 0) continue;

        // Method 1: Find "store.initDataObj = {...}" or "initDataObj: {...}"
        var patterns = [
          /store\.initDataObj\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
          /initDataObj\s*[:=]\s*(\{[\s\S]*\})\s*;?\s*$/,
          /window\.__rawData__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
          /__INIT_DATA__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
          /(?:=\s*|:\s*)(\{[\s\S]*\})\s*;?\s*$/
        ];
        for (var pi = 0; pi < patterns.length; pi++) {
          var jsonMatch = text.match(patterns[pi]);
          if (jsonMatch) {
            try {
              var parsed = JSON.parse(jsonMatch[1]);
              var gd = findGoodsData(parsed, 0);
              if (gd) {
                var newGid = String(gd.goods_id || gd.goodsID || '');
                var curGid = capturedRaw ? String(capturedRaw.goods_id || capturedRaw.goodsID || '') : '';
                // Update if no capturedRaw OR if same goods (to get richer data)
                if (!capturedRaw || newGid === curGid) {
                  var oldScore = capturedRaw ? dataScore(buildExtractData(capturedRaw)) : 0;
                  var newScore = dataScore(buildExtractData(gd));
                  if (newScore > oldScore || !capturedRaw) {
                    console.log('[PDD] Script tag scan (pattern ' + pi + ') found goods: ' + newGid + ' score=' + newScore + ' > ' + oldScore);
                    capturedRaw = gd;
                    var md = findMallData(parsed, 0);
                    if (md) capturedMall = md;
                    if (parsed.store && parsed.store.initDataObj) capturedRawInitData = parsed.store.initDataObj;
                    else capturedRawInitData = parsed;
                    extractAndPost(gd);
                  }
                }
                break;
              }
            } catch(e2) {}
          }
        }

        // Method 2: Try direct JSON parse of the whole content
        try {
          var directParsed = JSON.parse(text);
          var gd2 = findGoodsData(directParsed, 0);
          if (gd2) {
            var newGid2 = String(gd2.goods_id || gd2.goodsID || '');
            var curGid2 = capturedRaw ? String(capturedRaw.goods_id || capturedRaw.goodsID || '') : '';
            if (!capturedRaw || newGid2 === curGid2) {
              var oldScore2 = capturedRaw ? dataScore(buildExtractData(capturedRaw)) : 0;
              var newScore2 = dataScore(buildExtractData(gd2));
              if (newScore2 > oldScore2 || !capturedRaw) {
                console.log('[PDD] Script tag direct parse found goods: ' + newGid2 + ' score=' + newScore2);
                capturedRaw = gd2;
                var md2 = findMallData(directParsed, 0);
                if (md2) capturedMall = md2;
                if (directParsed.store && directParsed.store.initDataObj) capturedRawInitData = directParsed.store.initDataObj;
                else capturedRawInitData = directParsed;
                extractAndPost(gd2);
              }
            }
          }
        } catch(e3) {}
      }
    } catch(e) { console.log('[PDD] Script tag scan error: ' + e.message); }
  }

  // Helper to build a minimal data object for scoring
  function buildExtractData(gd) {
    if (!gd) return {};
    return {
      title: gd.goods_name || gd.goodsName || gd.goods_title || gd.title || '',
      main_images: extractImages(gd, ['top_gallery','topGallery','gallery','images']),
      detail_images: extractImages(gd, ['detail_gallery','detailGallery','desc_gallery','goods_desc_images']),
      sku_images: [],
      specs: {},
      skus: (gd.sku || gd.skus || []),
      description: gd.goods_desc || gd.desc || '',
      attributes: {},
      selling_points: [],
      shop_id: String(gd.mall_id || gd.shop_id || ''),
    };
  }

  // Also check window-level globals for embedded goods data
  function scanWindowGlobals() {
    try {
      // FIRST: Check window.store.initDataObj (PDD's primary SSR data container)
      var storeData = null;
      if (window.store && window.store.initDataObj) {
        storeData = window.store.initDataObj;
        console.log('[PDD] Found window.store.initDataObj, keys: ' + (storeData ? Object.keys(storeData).join(',') : 'null'));
      }
      if (storeData) {
        var gd = findGoodsData(storeData, 0);
        if (gd) {
          var newGid = String(gd.goods_id || gd.goodsID || '');
          var curGid = capturedRaw ? String(capturedRaw.goods_id || capturedRaw.goodsID || '') : '';
          if (!capturedRaw || newGid === curGid) {
            var oldScore = capturedRaw ? dataScore(buildExtractData(capturedRaw)) : 0;
            var newScore = dataScore(buildExtractData(gd));
            if (newScore > oldScore || !capturedRaw) {
              console.log('[PDD] store.initDataObj has richer goods data: ' + newGid + ' score=' + newScore + ' > ' + oldScore);
              capturedRaw = gd;
              capturedRawInitData = storeData;
              var md = findMallData(storeData, 0);
              if (md) capturedMall = md;
              extractAndPost(gd);
            }
          }
        }
      }

      // Check window.store directly as well
      if (window.store && typeof window.store === 'object') {
        var gd2 = findGoodsData(window.store, 0);
        if (gd2) {
          var newGid2 = String(gd2.goods_id || gd2.goodsID || '');
          var curGid2 = capturedRaw ? String(capturedRaw.goods_id || capturedRaw.goodsID || '') : '';
          if (!capturedRaw || newGid2 === curGid2) {
            var oldScore2 = capturedRaw ? dataScore(buildExtractData(capturedRaw)) : 0;
            var newScore2 = dataScore(buildExtractData(gd2));
            if (newScore2 > oldScore2 || !capturedRaw) {
              console.log('[PDD] window.store has richer goods data: ' + newGid2 + ' score=' + newScore2);
              capturedRaw = gd2;
              capturedRawInitData = window.store;
              extractAndPost(gd2);
            }
          }
        }
      }

      // THEN: Check other common globals
      var globalKeys = ['__rawData__', '__INIT_DATA__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APP_DATA__', '__NEXT_DATA__', '__REDUX_STATE__', '__pdd_data__', 'rawData', '__goods_data__'];
      for (var i = 0; i < globalKeys.length; i++) {
        var val = window[globalKeys[i]];
        if (val && typeof val === 'object') {
          var gd3 = findGoodsData(val, 0);
          if (gd3) {
            var newGid3 = String(gd3.goods_id || gd3.goodsID || '');
            var curGid3 = capturedRaw ? String(capturedRaw.goods_id || capturedRaw.goodsID || '') : '';
            if (!capturedRaw || newGid3 === curGid3) {
              var oldScore3 = capturedRaw ? dataScore(buildExtractData(capturedRaw)) : 0;
              var newScore3 = dataScore(buildExtractData(gd3));
              if (newScore3 > oldScore3 || !capturedRaw) {
                console.log('[PDD] Window global ' + globalKeys[i] + ' has richer goods: ' + newGid3 + ' score=' + newScore3);
                capturedRaw = gd3;
                var md3 = findMallData(val, 0);
                if (md3) capturedMall = md3;
                if (val.store && val.store.initDataObj) capturedRawInitData = val.store.initDataObj;
                extractAndPost(gd3);
              }
            }
          }
        }
      }
    } catch(e) { console.log('[PDD] scanWindowGlobals error: ' + e.message); }
  }

  // ======== Hooks ========
  var _parse = JSON.parse;
  JSON.parse = function() {
    var result = _parse.apply(this, arguments);
    try {
      // Check for consult_goods_price response - only store in priceMap
      if (result && result.goods_price_map) {
        capturePriceMap(result);
      } else {
        var gd = findGoodsData(result, 0);
        if (gd) {
          console.log('[PDD] JSON.parse intercepted goods_id=' + (gd.goods_id || gd.goodsID));
          capturedRaw = gd;
          setTimeout(function() { extractAndPost(gd); }, 300);
        }
        var md = findMallData(result, 0);
        if (md) capturedMall = md;
        if (result && result.store && result.store.initDataObj) capturedRawInitData = result.store.initDataObj;
      }
    } catch(e) {}
    return result;
  };

  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, url) { this._pddUrl = url; return _xhrOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function() {
    var self = this;
    this.addEventListener('load', function() {
      try {
        var url = self._pddUrl || '';
        if (url.indexOf('yangkeduo') < 0 && url.indexOf('pinduoduo') < 0) return;
        var text = self.responseText || '';
        if (text.length < 50) return;
        var data = _parse(text);
        // Capture price map from consult_goods_price - only store in priceMap, don't set capturedRaw
        if (data && data.goods_price_map) {
          capturePriceMap(data);
          console.log('[PDD] PriceMap captured from XHR: ' + url.substring(0,60));
          return; // Don't search for goods data in price-only responses
        }
        var gd = findGoodsData(data, 0);
        if (gd) {
          console.log('[PDD] XHR intercepted: ' + url.substring(0,60));
          capturedRaw = gd;
          setTimeout(function() { extractAndPost(gd); }, 300);
        }
      } catch(e) {}
    });
    return _xhrSend.apply(this, arguments);
  };

  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url || '');
      return _fetch.apply(this, arguments).then(function(resp) {
        if (url.indexOf('yangkeduo') > -1 || url.indexOf('pinduoduo') > -1) {
          resp.clone().text().then(function(text) {
            try {
              if (text.length < 50) return;
              var data = _parse(text);
              if (data && data.goods_price_map) {
                capturePriceMap(data);
                console.log('[PDD] PriceMap captured from fetch');
                return;
              }
              var gd = findGoodsData(data, 0);
              if (gd) { console.log('[PDD] fetch intercepted'); capturedRaw = gd; setTimeout(function() { extractAndPost(gd); }, 300); }
            } catch(e) {}
          }).catch(function(){});
        }
        return resp;
      });
    };
  }

  // Early script tag and window global scanning
  setTimeout(scanScriptTagsForGoods, 100);
  setTimeout(scanWindowGlobals, 200);
  setTimeout(scanScriptTagsForGoods, 500);
  setTimeout(scanWindowGlobals, 800);
  setTimeout(scanScriptTagsForGoods, 1500);
  setTimeout(scanWindowGlobals, 1800);

  // Run DOM scraping and window scanning at intervals
  var retryDelays = [2000, 4000, 6000, 9000, 13000, 18000, 25000, 35000];
  for (var ri = 0; ri < retryDelays.length; ri++) {
    (function(d) { setTimeout(scrapeDOMAndPost, d); })(retryDelays[ri]);
    (function(d) { setTimeout(scanWindowGlobals, d + 200); })(retryDelays[ri]);
    (function(d) { setTimeout(scanScriptTagsForGoods, d + 400); })(retryDelays[ri]);
  }

  // MutationObserver: scrape when DOM changes significantly
  if (window.MutationObserver && document.body) {
    var _debounce = null;
    var _mo = new MutationObserver(function() {
      if (_debounce) clearTimeout(_debounce);
      _debounce = setTimeout(scrapeDOMAndPost, 1500);
    });
    _mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { _mo.disconnect(); }, 45000);
  }

  // ======== SPA 路由切换：重置捕获状态并重新扫描 ========
  function onNav() {
    capturedRaw = null;
    capturedMall = null;
    capturedRawInitData = null;
    setTimeout(scanWindowGlobals, 300);
    setTimeout(scanScriptTagsForGoods, 600);
    setTimeout(scrapeDOMAndPost, 1500);
  }
  try {
    ['pushState', 'replaceState'].forEach(function(m) {
      var orig = history[m];
      history[m] = function() {
        var r = orig.apply(this, arguments);
        setTimeout(onNav, 0);
        return r;
      };
    });
    window.addEventListener('popstate', onNav);
  } catch(e) {}

  console.log('[PDD] Goods extraction v11 loaded - score-based dedup, early script scanning, SPA nav, toggle support');
})();
