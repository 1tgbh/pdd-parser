(function() {
  'use strict';
  var INGEST_URL = 'http://127.0.0.1:5000/api/ingest';
  var sent = {};
  var capturedRaw = null;
  var priceMap = {}; // goods_id -> price (yuan) from consult_goods_price API

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
    var t = (data.title || '').trim();
    // If already posted with a good title, skip
    if (sent[gid] && isValidTitle(sent[gid])) return;
    // Reject entries without valid title
    if (!t || !isValidTitle(t)) {
      console.log('[PDD] Rejected bad/missing title: ' + gid + ' title=' + (t||'').substring(0, 50));
      return;
    }
    sent[gid] = t;  // Store title for re-post check
    data.goods_id = gid;
    data.source_url = location.href;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', INGEST_URL, true);
      xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      xhr.send(JSON.stringify(data));
      console.log('[PDD] Posted: ' + gid + ' title=' + (data.title||'').substring(0,30) + ' price=' + data.price + ' imgs=' + (data.main_images||[]).length);
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

  function extractPriceCents(gd) {
    var candidates = [
      gd.min_group_price, gd.group_price, gd.price,
      gd.min_on_sale_group_price, gd.min_normal_price,
      gd.group_price_info && gd.group_price_info.price,
      gd.price_info && typeof gd.price_info === 'object' && gd.price_info.price
    ];
    for (var i = 0; i < candidates.length; i++) {
      var p = toFloat(candidates[i]);
      if (p > 0) return p;
    }
    // Check price_info as string (yuan)
    if (gd.price_info && typeof gd.price_info === 'string') {
      var pp = parseFloat(gd.price_info);
      if (pp > 0) return pp;
    }
    // Check display_price as string (yuan)
    if (gd.display_price && typeof gd.display_price === 'string') {
      var dp = parseFloat(gd.display_price);
      if (dp > 0) return dp;
    }
    // Check SKUs for minimum price
    var skuList = gd.sku || gd.skus || [];
    if (Array.isArray(skuList) && skuList.length > 0) {
      var minPrice = Infinity;
      for (var s = 0; s < skuList.length; s++) {
        var sk = skuList[s];
        if (!sk) continue;
        var sp = toFloat(sk.group_price || sk.price || 0);
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

    var priceRaw = extractPriceCents(gd);
    var price = priceRaw > 100 ? priceRaw / 100 : priceRaw;
    var origRaw = toFloat(gd.market_price || gd.normal_price || gd.original_price || 0);
    var origPrice = origRaw > 100 ? origRaw / 100 : origRaw;

    var data = {
      goods_id: gid,
      title: gd.goods_name || gd.goodsName || gd.goods_title || gd.title || '',
      subtitle: gd.goods_desc || gd.desc || '',
      price: price,
      original_price: origPrice,
      min_group_price: price,
      sales: toInt(gd.sales || gd.sold_quantity || (gd.side_ext && gd.side_ext.sold_quantity)),
      sold_quantity: toInt(gd.sold_quantity || gd.sales),
      shop_name: gd.mall_name || gd.mall_name_text || gd.shop_name || '',
      shop_id: String(gd.mall_id || gd.shop_id || ''),
      shop_logo: gd.mall_logo || gd.shop_logo || '',
      main_images: extractImages(gd, ['top_gallery','topGallery','gallery','images']),
      detail_images: extractImages(gd, ['detail_gallery','desc_gallery','goods_desc_images']),
      sku_images: [],
      specs: {},
      skus: [],
      description: gd.goods_desc || gd.desc || '',
      attributes: {},
      selling_points: [],
      source_url: location.href
    };

    // SKUs
    var skuList = gd.sku || gd.skus || [];
    if (Array.isArray(skuList)) {
      for (var s = 0; s < skuList.length; s++) {
        var sk = skuList[s];
        if (!sk || typeof sk !== 'object') continue;
        var sp = toFloat(sk.group_price || sk.price || 0);
        if (sp > 100) sp = sp / 100;
        var sop = toFloat(sk.normal_price || sk.original_price || 0);
        if (sop > 100) sop = sop / 100;
        data.skus.push({
          sku_id: String(sk.sku_id || sk.skuId || ''),
          price: sp, original_price: sop,
          stock: toInt(sk.quantity || sk.stock),
          image: sk.thumb_url || sk.image || ''
        });
        var simg = sk.thumb_url || sk.image || sk.sku_image;
        if (simg && simg.indexOf('http') === 0 && data.sku_images.indexOf(simg) < 0) data.sku_images.push(simg);
        var specs = sk.specs || sk.spec || [];
        if (Array.isArray(specs)) {
          for (var si = 0; si < specs.length; si++) {
            var spec = specs[si];
            if (spec && (spec.spec_key || spec.spec) && (spec.spec_value || spec.value)) {
              var skName = spec.spec_key || spec.spec;
              var skVal = spec.spec_value || spec.value;
              if (!data.specs[skName]) data.specs[skName] = [];
              if (data.specs[skName].indexOf(skVal) < 0) data.specs[skName].push(skVal);
            }
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
      if (!p && entry.min_on_sale_group_price) p = entry.min_on_sale_group_price > 100 ? entry.min_on_sale_group_price / 100 : entry.min_on_sale_group_price;
      if (p > 0) {
        priceMap[String(entry.goods_id || gid)] = p;
        console.log('[PDD] PriceMap: ' + gid + ' = ' + p);
      }
    }
  }

  // ======== DOM scraping helpers ========
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

  function domGetPrice() {
    var main = (document.body || document.documentElement);
    if (!main) return 0;
    var text = main.innerText || '';
    // Match \xA5=¥ or \uFFE5=￥
    var m = text.match(/[\xA5\uFFE5]\s*(\d+\.?\d*)/);
    if (m) return parseFloat(m[1]);
    // Match bare price with 元 suffix
    m = text.match(/(\d+\.\d{1,2})\s*元/);
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
    if (!gid || sent[gid]) return;

    var title = domGetTitle();
    var price = domGetPrice();
    var sales = domGetSales();
    var shop = domGetShop();
    var images = domGetImages();

    if (!title && !price && images.length === 0) return;

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
      source_url: location.href
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
      if (!data.price) {
        var rp = extractPriceCents(capturedRaw);
        data.price = rp > 100 ? rp / 100 : rp;
        data.min_group_price = data.price;
      }
      if (!data.original_price) {
        var orp = toFloat(capturedRaw.market_price || capturedRaw.normal_price || 0);
        data.original_price = orp > 100 ? orp / 100 : orp;
      }
      if (!data.sales) data.sales = toInt(capturedRaw.sales || capturedRaw.sold_quantity);
      if (!data.shop_name) data.shop_name = capturedRaw.mall_name || capturedRaw.shop_name || '';
      if (!data.shop_id) data.shop_id = String(capturedRaw.mall_id || capturedRaw.shop_id || '');
      if (data.main_images.length === 0) {
        data.main_images = extractImages(capturedRaw, ['top_gallery','topGallery','gallery','images']);
      }
      // Merge skus
      if (capturedRaw.sku || capturedRaw.skus) {
        var skuList = capturedRaw.sku || capturedRaw.skus || [];
        if (Array.isArray(skuList)) {
          for (var s = 0; s < skuList.length; s++) {
            var sk = skuList[s];
            if (!sk || typeof sk !== 'object') continue;
            var sp = toFloat(sk.group_price || sk.price || 0);
            if (sp > 100) sp = sp / 100;
            var sop = toFloat(sk.normal_price || sk.original_price || 0);
            if (sop > 100) sop = sop / 100;
            data.skus.push({
              sku_id: String(sk.sku_id || ''), price: sp, original_price: sop,
              stock: toInt(sk.quantity || sk.stock), image: sk.thumb_url || sk.image || ''
            });
          }
        }
      }
    }

    // Final price fallback: priceMap -> original_price
    if (!data.price) {
      if (priceMap[gid]) {
        data.price = priceMap[gid];
        data.min_group_price = data.price;
        console.log('[PDD] Price from priceMap: ' + data.price);
      } else if (data.original_price > 0) {
        data.price = data.original_price;
        data.min_group_price = data.price;
        console.log('[PDD] Price fallback to original_price: ' + data.price);
      }
    }
    if (!data.original_price && data.price > 0) {
      data.original_price = data.price;
    }

    console.log('[PDD] DOM scraped ' + gid + ': title=' + data.title.substring(0,30) + ' price=' + data.price + ' sales=' + data.sales + ' imgs=' + data.main_images.length);
    postGoods(data);
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
        }
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
              if (gd) { console.log('[PDD] fetch intercepted'); capturedRaw = gd; }
            } catch(e) {}
          }).catch(function(){});
        }
        return resp;
      });
    };
  }

  // Run DOM scraping at intervals (more retries, longer window)
  var retryDelays = [2000, 4000, 6000, 9000, 13000, 18000, 25000, 35000];
  for (var ri = 0; ri < retryDelays.length; ri++) {
    (function(d) { setTimeout(scrapeDOMAndPost, d); })(retryDelays[ri]);
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

  console.log('[PDD] Goods extraction v4 loaded');
})();
