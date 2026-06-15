
"""
PDD goods collection service - mitmproxy addon
Injects a JS extraction script into goods.html responses.
"""

import json
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from mitmproxy import http, ctx
from storage import get_conn, upsert_sku_items, update_goods_price_range


def _cents_to_yuan(v):
    """Convert price from cents (分) to yuan (元)."""
    try:
        n = float(v)
        return n / 100 if n > 0 else 0.0
    except (ValueError, TypeError):
        return 0.0


DATA_DIR = Path(__file__).resolve().parent / "data"
IMAGES_DIR = DATA_DIR / "images"
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "goods.db"

PDD_DOMAINS = ["pinduoduo.com", "yangkeduo.com", "pdd.com"]

_INJECT_JS_PATH = Path(__file__).resolve().parent / "inject.js"


def _get_inject_tag():
    try:
        js_content = _INJECT_JS_PATH.read_text(encoding="utf-8")
        return "<script>" + js_content + "</script>"
    except Exception:
        return ""


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS goods (
            goods_id TEXT PRIMARY KEY,
            title TEXT, subtitle TEXT, selling_points TEXT,
            price REAL, original_price REAL, min_group_price REAL,
            sales INTEGER, sold_quantity INTEGER,
            shop_name TEXT, shop_id TEXT, shop_logo TEXT,
            main_images TEXT, detail_images TEXT, sku_images TEXT,
            specs TEXT, skus TEXT, description TEXT, attributes TEXT,
            source_url TEXT, crawl_time TEXT, updated_at TEXT, raw_data TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_goods_title ON goods(title);
        CREATE INDEX IF NOT EXISTS idx_goods_shop ON goods(shop_name);
        CREATE INDEX IF NOT EXISTS idx_goods_crawl ON goods(crawl_time);

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#3b82f6'
        );
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS product_tags (
            goods_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS product_groups (
            goods_id TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            PRIMARY KEY (goods_id, group_id)
        );
        CREATE TABLE IF NOT EXISTS ai_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            source_url TEXT,
            prompt TEXT,
            result_path TEXT NOT NULL,
            model TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_product_tags_goods ON product_tags(goods_id);
        CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_product_groups_goods ON product_groups(goods_id);
        CREATE INDEX IF NOT EXISTS idx_ai_images_goods ON ai_images(goods_id);

        CREATE TABLE IF NOT EXISTS export_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            fields TEXT NOT NULL,
            column_map TEXT DEFAULT '{}',
            is_preset INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS monitor_list (
            goods_id TEXT PRIMARY KEY,
            frequency TEXT DEFAULT 'daily',
            last_check TEXT,
            next_check TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS monitor_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            goods_id TEXT NOT NULL,
            price REAL,
            original_price REAL,
            stock INTEGER,
            sales INTEGER,
            checked_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_monitor_history ON monitor_history(goods_id, checked_at);
    """)
    conn.commit()
    existing = conn.execute("SELECT COUNT(*) FROM export_templates").fetchone()[0]
    if existing == 0:
        presets = [
            ("淘宝上架模板", json.dumps(["title","subtitle","selling_points","price","original_price","specs","attributes"]), json.dumps({"title":"商品标题","subtitle":"副标题","selling_points":"卖点","price":"价格","original_price":"原价","specs":"规格","attributes":"属性"})),
            ("拼多多上架模板", json.dumps(["title","subtitle","selling_points","price","min_group_price","specs","main_images"]), json.dumps({"title":"商品标题","subtitle":"副标题","selling_points":"卖点","price":"原价","min_group_price":"团购价","specs":"规格","main_images":"主图"})),
            ("抖音上架模板", json.dumps(["title","selling_points","price","original_price","description"]), json.dumps({"title":"商品标题","selling_points":"卖点","price":"价格","original_price":"原价","description":"详情描述"})),
            ("通用数据模板", json.dumps(["goods_id","title","subtitle","price","original_price","min_group_price","sales","sold_quantity","shop_name"]), json.dumps({"goods_id":"商品ID","title":"标题","subtitle":"副标题","price":"价格","original_price":"原价","min_group_price":"团购价","sales":"销量","sold_quantity":"已拼件数","shop_name":"店铺"})),
        ]
        for name, fields, col_map in presets:
            conn.execute("INSERT INTO export_templates (name, fields, column_map, is_preset) VALUES (?, ?, ?, 1)", (name, fields, col_map))
        conn.commit()
    conn.close()





def save_goods_from_api(goods_data, url):
    """Update goods with full SKU data."""
    if not goods_data:
        return
    goods_id = str(goods_data.get("goods_id", goods_data.get("goodsID", "")))
    title = goods_data.get("title", "")
    if not goods_id:
        return
    if not title:
        return
    conn = get_conn()
    now_str = datetime.now().isoformat()
    price = float(goods_data.get("price", 0) or 0)
    min_group_price = float(goods_data.get("min_group_price", 0) or 0)

    conn.execute(
        """UPDATE goods SET
           price = CASE WHEN ? > 0 THEN ? ELSE price END,
           min_group_price = CASE WHEN ? > 0 THEN ? ELSE min_group_price END,
           updated_at = ?
           WHERE goods_id = ? AND (title IS NOT NULL AND length(title) > 0)""",
        (price, price, min_group_price, min_group_price, now_str, goods_id),
    )
    conn.commit()
    conn.close()

    # Save SKU items to sku_items table
    sku_list = goods_data.get("skus", [])
    if isinstance(sku_list, list) and len(sku_list) > 0:
        upsert_sku_items(goods_id, sku_list)

    # Update price range and total stock
    price_min = float(goods_data.get("price_min", 0) or 0)
    price_max = float(goods_data.get("price_max", 0) or 0)
    total_stock = int(goods_data.get("total_stock", 0) or 0)

    # If price_min/max not provided, calculate from SKUs
    if (price_min <= 0 or price_max <= 0) and isinstance(sku_list, list) and len(sku_list) > 0:
        prices = []
        stock_sum = 0
        for s in sku_list:
            p = float(s.get("price", 0) or 0)
            if p > 0:
                prices.append(p)
            stock_sum += int(s.get("stock", 0) or 0)
        if prices:
            price_min = min(prices)
            price_max = max(prices)
        if stock_sum > 0:
            total_stock = stock_sum

    if price_min > 0 or price_max > 0 or total_stock > 0:
        update_goods_price_range(goods_id, price_min, price_max, total_stock)

    # Also update the skus JSON field in goods table for backward compatibility
    if isinstance(sku_list, list) and len(sku_list) > 0:
        try:
            conn2 = get_conn()
            conn2.execute(
                "UPDATE goods SET skus = ?, updated_at = ? WHERE goods_id = ?",
                (json.dumps(sku_list, ensure_ascii=False), now_str, goods_id),
            )
            conn2.commit()
            conn2.close()
        except Exception:
            pass

    mall_info = goods_data.get("mall_info") or {}
    if isinstance(mall_info, dict) and mall_info:
        mall_name = mall_info.get("mallName") or mall_info.get("mall_name") or ""
        mall_logo = mall_info.get("mallLogo") or mall_info.get("mall_logo") or ""
        if mall_name:
            try:
                c = get_conn()
                row = c.execute("SELECT shop_name, shop_logo FROM goods WHERE goods_id=?",
                                (goods_id,)).fetchone()
                if row and (not row["shop_name"] or row["shop_name"] == "Unknown"):
                    c.execute("UPDATE goods SET shop_name=?, shop_logo=? WHERE goods_id=?",
                              mall_name, mall_logo, goods_id)
                    c.commit()
                elif row and mall_logo and not row["shop_logo"]:
                    c.execute("UPDATE goods SET shop_logo=? WHERE goods_id=?",
                              mall_logo, goods_id)
                    c.commit()
                c.close()
            except Exception:
                pass

    raw_init_data = goods_data.get("raw_init_data")
    if raw_init_data and isinstance(raw_init_data, dict):
        raw_json = json.dumps(raw_init_data, ensure_ascii=False)
        try:
            c = get_conn()
            c.execute("UPDATE goods SET raw_data=? WHERE goods_id=?",
                      raw_json, goods_id)
            c.commit()
            c.close()
        except Exception:
            pass


def extract_title_from_html(html, url):
    """Extract goods title and ID from the HTML before JS injection."""
    info = {}
    m = re.search(r"[?&]goods_id=(\d+)", url)
    if m:
        info["goods_id"] = m.group(1)
    # og:title
    for pat in [
        r"""<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)""",
        r"""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title""",
    ]:
        m = re.search(pat, html, re.I)
        if m:
            t = m.group(1).strip()
            if t and "拼多多商城" not in t:
                info["title"] = t
                break
    # Embedded JSON goods_name
    if "title" not in info:
        for pat in [
            r'"goods_name"\s*:\s*"([^"]{3,200})"',
            r'"goodsName"\s*:\s*"([^"]{3,200})"',
        ]:
            m = re.search(pat, html)
            if m:
                info["title"] = m.group(1).strip()
                break
    # <title> tag (last resort)
    if "title" not in info:
        m = re.search(r"<title>([^<]+)</title>", html, re.I)
        if m:
            t = m.group(1).strip()
            t = re.sub(r"\s*[-_|]\s*(拼多多|PDD).*$", "", t).strip()
            if t and len(t) > 3:
                info["title"] = t
    return info


def _fetch_goods_detail(goods_id, page_url):
    """Fetch full goods detail from PDD API when a goods page is detected."""
    import requests as _req
    try:
        ctx.log.info("[DetailFetch] Fetching detail for " + goods_id)
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": page_url,
            "Accept": "application/json, text/plain, */*",
        }
        api_urls = [
            "https://mobile.yangkeduo.com/proxy/api/goods/detail?goods_id=" + goods_id,
            "https://mobile.yangkeduo.com/api/goods/detail?goods_id=" + goods_id,
        ]
        for api_url in api_urls:
            try:
                resp = _req.get(api_url, headers=headers, timeout=10, verify=False)
                if resp.status_code == 200:
                    data = resp.json()
                    goods = data
                    if isinstance(data, dict):
                        for k in ["data", "goods", "result"]:
                            if isinstance(data.get(k), dict) and (data[k].get("goods_name") or data[k].get("goodsName")):
                                goods = data[k]
                                break
                    if isinstance(goods, dict) and (goods.get("goods_name") or goods.get("goodsName")):
                        _process_api_goods(goods, api_url)
                        return
            except Exception:
                continue
    except Exception as e:
        ctx.log.warn("[DetailFetch] Error for " + goods_id + ": " + str(e))


def _process_api_goods(goods_data, source_url):
    """Process goods data from PDD API and send to ingest."""
    import requests as _req
    try:
        gid = str(goods_data.get("goods_id") or goods_data.get("goodsID", ""))
        if not gid:
            return
        gn = goods_data.get("goods_name") or goods_data.get("goodsName") or ""
        
        gallery = goods_data.get("gallery") or goods_data.get("top_gallery") or goods_data.get("topGallery") or []
        main_imgs = []
        if isinstance(gallery, list):
            for img in gallery:
                u = img if isinstance(img, str) else (img.get("url", "") if isinstance(img, dict) else "")
                if u and u.startswith("http"):
                    main_imgs.append(u)
        
        detail_gallery = goods_data.get("detail_gallery") or goods_data.get("detailGallery") or goods_data.get("desc_gallery") or []
        detail_imgs = []
        if isinstance(detail_gallery, list):
            for img in detail_gallery:
                u = img if isinstance(img, str) else (img.get("url", "") if isinstance(img, dict) else "")
                if u and u.startswith("http"):
                    detail_imgs.append(u)
        
        price = 0
        for pf in ["min_group_price", "group_price", "min_on_sale_group_price", "price"]:
            pv = goods_data.get(pf)
            if pv:
                try:
                    price = float(pv)
                    if price >= 1000: price = price / 100
                    if price > 0: break
                except Exception: pass
        
        sku_list = goods_data.get("sku") or goods_data.get("skus") or []
        norm_skus = []
        sku_imgs = []
        specs_dict = {}
        if isinstance(sku_list, list):
            for sk in sku_list:
                if not isinstance(sk, dict): continue
                sp = 0
                for skf in ["group_price", "price", "sku_price"]:
                    spv = sk.get(skf)
                    if spv:
                        try:
                            sp = float(spv)
                            if sp >= 1000: sp = sp / 100
                            if sp > 0: break
                        except Exception: pass
                sop = 0
                for sopf in ["normal_price", "original_price", "market_price"]:
                    sopv = sk.get(sopf)
                    if sopv:
                        try:
                            sop = float(sopv)
                            if sop >= 1000: sop = sop / 100
                            if sop > 0: break
                        except Exception: pass
                sk_img = sk.get("thumb_url") or sk.get("thumbUrl") or sk.get("image") or sk.get("sku_image") or ""
                if sk_img and sk_img.startswith("http") and sk_img not in sku_imgs:
                    sku_imgs.append(sk_img)
                sk_specs = sk.get("specs") or sk.get("spec") or []
                spec_arr = []
                if isinstance(sk_specs, list):
                    for sp_item in sk_specs:
                        if isinstance(sp_item, dict):
                            k = sp_item.get("spec_key") or sp_item.get("key") or sp_item.get("spec") or sp_item.get("name") or ""
                            v = sp_item.get("spec_value") or sp_item.get("value") or sp_item.get("val") or ""
                            if k and v:
                                spec_arr.append({"key": k, "value": v})
                                if k not in specs_dict: specs_dict[k] = []
                                if v not in specs_dict[k]: specs_dict[k].append(v)
                elif isinstance(sk_specs, dict):
                    for sk_k, sk_v in sk_specs.items():
                        spec_arr.append({"key": sk_k, "value": str(sk_v)})
                        if sk_k not in specs_dict: specs_dict[sk_k] = []
                        if str(sk_v) not in specs_dict[sk_k]: specs_dict[sk_k].append(str(sk_v))
                norm_skus.append({
                    "sku_id": str(sk.get("sku_id") or sk.get("skuId") or sk.get("skuID") or ""),
                    "specs": spec_arr, "price": sp, "original_price": sop,
                    "stock": int(sk.get("quantity") or sk.get("stock") or 0),
                    "image": sk_img,
                })
        
        attributes = {}
        for attr_key in ["goods_props", "attributes", "properties", "spec_list"]:
            props = goods_data.get(attr_key)
            if isinstance(props, list):
                for pr in props:
                    if isinstance(pr, dict) and (pr.get("key") or pr.get("name")):
                        attributes[pr.get("key") or pr.get("name")] = pr.get("value") or pr.get("val") or ""
        
        selling_points = []
        for tag_key in ["service_tags", "goods_service_tags", "tags"]:
            tags = goods_data.get(tag_key)
            if isinstance(tags, list):
                for tag in tags:
                    txt = tag if isinstance(tag, str) else (tag.get("text") or tag.get("name") or "")
                    if txt and txt not in selling_points:
                        selling_points.append(txt)
        
        ingest_data = {
            "goods_id": gid, "title": gn,
            "subtitle": goods_data.get("goods_desc") or goods_data.get("desc") or "",
            "price": price, "original_price": price, "min_group_price": price,
            "sales": int(goods_data.get("sales") or 0),
            "sold_quantity": int(goods_data.get("sold_quantity") or 0),
            "shop_name": goods_data.get("mall_name") or goods_data.get("mallName") or "",
            "shop_id": str(goods_data.get("mall_id") or ""),
            "shop_logo": goods_data.get("mall_logo") or "",
            "main_images": main_imgs, "detail_images": detail_imgs, "sku_images": sku_imgs,
            "specs": specs_dict, "skus": norm_skus,
            "description": goods_data.get("goods_desc") or "",
            "attributes": attributes, "selling_points": selling_points,
            "source_url": source_url, "raw_init_data": goods_data,
        }
        resp = _req.post("http://127.0.0.1:5000/api/ingest", json=ingest_data, timeout=5)
        ctx.log.info("[DetailFetch] Ingested " + gid + " status=" + str(resp.status_code) + " skus=" + str(len(norm_skus)) + " detail_imgs=" + str(len(detail_imgs)) + " attrs=" + str(len(attributes)))
    except Exception as e:
        ctx.log.warn("[DetailFetch] Process error: " + str(e))



# ========== 采集开关 ==========
_capture_enabled = True

def set_capture_enabled(enabled: bool):
    global _capture_enabled
    _capture_enabled = enabled

def get_capture_enabled() -> bool:
    return _capture_enabled

class PddInterceptor:
    def __init__(self):
        self.stats = {"total": 0, "injected": 0, "price_api": 0}

    def response(self, flow):
        if not _capture_enabled:
            return

        host = flow.request.pretty_host
        if not any(d in host for d in PDD_DOMAINS):
            return

        self.stats["total"] += 1
        url = flow.request.pretty_url
        url_lower = url.lower()
        content_type = flow.response.headers.get("content-type", "") if flow.response else ""

        # Inject JS into goods.html
        if "goods.html" in url_lower and "text/html" in content_type:
            if flow.response and flow.response.content:
                html = flow.response.content.decode("utf-8", errors="replace")
                if "<head>" in html and "[PDD]" not in html:
                    proxy_info = extract_title_from_html(html, url)
                    proxy_tag = '<script>window.__PDD_PROXY_DATA = ' + json.dumps(proxy_info, ensure_ascii=False) + ';</script>\n'
                    inject_tag = _get_inject_tag()
                    if inject_tag:
                        html = html.replace("<head>", "<head>\n" + proxy_tag + inject_tag, 1)
                        flow.response.content = html.encode("utf-8")
                        self.stats["injected"] += 1
                        ctx.log.info("[JS Inject] Injected, proxy=" + str(proxy_info))
                        
                        # Server-side: fetch full goods detail from PDD API
                        goods_id_from_url = proxy_info.get("goods_id", "")
                        if goods_id_from_url:
                            threading.Thread(target=_fetch_goods_detail, args=(goods_id_from_url, url), daemon=True).start()

        # Intercept consult_goods_price (unencrypted)
        if "consult_goods_price" in url_lower and flow.response and flow.response.content:
            try:
                text = flow.response.content.decode("utf-8", errors="replace")
                data = json.loads(text)
                price_map = data.get("goods_price_map", {})
                if isinstance(price_map, dict):
                    for gid, gdata in price_map.items():
                        if isinstance(gdata, dict) and gdata.get("goods_id"):
                            if save_goods_from_api(gdata, url):
                                self.stats["price_api"] += 1
                                ctx.log.info("[Price API] Saved price for " + str(gid))
                # Extract SKU-level prices from consult_goods_price
                try:
                    sku_price_map = price_map
                    if isinstance(sku_price_map, dict):
                        for gid, pdata in sku_price_map.items():
                            if not isinstance(pdata, dict):
                                continue
                            sku_prices = pdata.get("sku_price_list", pdata.get("sku_list", pdata.get("multi_price", [])))
                            if isinstance(sku_prices, list) and sku_prices:
                                existing_skus = []
                                for sp in sku_prices:
                                    if isinstance(sp, dict):
                                        existing_skus.append({
                                            "sku_id": sp.get("sku_id", sp.get("id", "")),
                                            "specs": sp.get("specs", sp.get("spec", {})),
                                            "price": _cents_to_yuan(sp.get("price", sp.get("group_price", 0)) or 0),
                                            "original_price": _cents_to_yuan(sp.get("normal_price", sp.get("original_price", 0)) or 0),
                                            "stock": int(sp.get("quantity", sp.get("stock", 0)) or 0),
                                            "image": sp.get("thumb_url", sp.get("image", "")),
                                        })
                                if existing_skus:
                                    upsert_sku_items(gid, existing_skus)
                except Exception:
                    pass
            except Exception as e:
                ctx.log.warn("[Price API] Parse error: " + str(e))

        # Broad scan: extract full goods data from any API response containing goods_name
        if flow.response and flow.response.content and "goods.html" not in url_lower:
            try:
                raw = flow.response.content
                if b"goods_name" in raw or b"goodsName" in raw or b"goods_id" in raw:
                    text = raw.decode("utf-8", errors="replace")
                    data = json.loads(text)
                    goods_data = None
                    if isinstance(data, dict):
                        # Direct goods data
                        if data.get("goods_name") or data.get("goodsName"):
                            goods_data = data
                        # Nested in "data" key
                        elif isinstance(data.get("data"), dict):
                            d = data["data"]
                            if d.get("goods_name") or d.get("goodsName"):
                                goods_data = d
                        # Nested in "result" key
                        elif isinstance(data.get("result"), dict):
                            r = data["result"]
                            if r.get("goods_name") or r.get("goodsName"):
                                goods_data = r
                        # Search deeper for goods data
                        if not goods_data:
                            for key in data:
                                val = data[key]
                                if isinstance(val, dict) and (val.get("goods_name") or val.get("goodsName")):
                                    goods_data = val
                                    break
                    
                    if goods_data and (goods_data.get("goods_id") or goods_data.get("goodsID")):
                        gid = str(goods_data.get("goods_id") or goods_data.get("goodsID"))
                        gn = goods_data.get("goods_name") or goods_data.get("goodsName") or ""
                        ctx.log.info("[GoodsName API] Extracting " + gid + " -> " + gn[:60] + " url=" + url[:80])
                        
                        # Build normalized data for ingest
                        from storage import get_conn as _gc
                        
                        gallery = goods_data.get("gallery") or goods_data.get("top_gallery") or goods_data.get("topGallery") or []
                        main_imgs = []
                        if isinstance(gallery, list):
                            for img in gallery:
                                url_str = img if isinstance(img, str) else (img.get("url", "") if isinstance(img, dict) else "")
                                if url_str and url_str.startswith("http"):
                                    main_imgs.append(url_str)
                        
                        detail_gallery = goods_data.get("detail_gallery") or goods_data.get("detailGallery") or goods_data.get("desc_gallery") or []
                        detail_imgs = []
                        if isinstance(detail_gallery, list):
                            for img in detail_gallery:
                                url_str = img if isinstance(img, str) else (img.get("url", "") if isinstance(img, dict) else "")
                                if url_str and url_str.startswith("http"):
                                    detail_imgs.append(url_str)
                        
                        # Extract price
                        price = 0
                        for pf in ["min_group_price", "group_price", "min_on_sale_group_price", "price"]:
                            pv = goods_data.get(pf)
                            if pv:
                                try:
                                    price = float(pv)
                                    if price >= 1000: price = price / 100
                                    if price > 0: break
                                except: pass
                        
                        # Extract SKUs
                        sku_list = goods_data.get("sku") or goods_data.get("skus") or goods_data.get("sku_list") or []
                        norm_skus = []
                        sku_imgs = []
                        specs_dict = {}
                        if isinstance(sku_list, list):
                            for sk in sku_list:
                                if not isinstance(sk, dict): continue
                                sp = 0
                                for skf in ["group_price", "price", "sku_price"]:
                                    spv = sk.get(skf)
                                    if spv:
                                        try:
                                            sp = float(spv)
                                            if sp >= 1000: sp = sp / 100
                                            if sp > 0: break
                                        except: pass
                                sop = 0
                                for sopf in ["normal_price", "original_price", "market_price"]:
                                    sopv = sk.get(sopf)
                                    if sopv:
                                        try:
                                            sop = float(sopv)
                                            if sop >= 1000: sop = sop / 100
                                            if sop > 0: break
                                        except: pass
                                sk_img = sk.get("thumb_url") or sk.get("image") or sk.get("sku_image") or ""
                                if sk_img and sk_img.startswith("http") and sk_img not in sku_imgs:
                                    sku_imgs.append(sk_img)
                                
                                sk_specs = sk.get("specs") or sk.get("spec") or []
                                spec_arr = []
                                if isinstance(sk_specs, list):
                                    for sp_item in sk_specs:
                                        if isinstance(sp_item, dict):
                                            sk = sp_item.get("spec_key") or sp_item.get("key") or sp_item.get("name") or ""
                                            sv = sp_item.get("spec_value") or sp_item.get("value") or ""
                                            if sk and sv:
                                                spec_arr.append({"key": sk, "value": sv})
                                                if sk not in specs_dict: specs_dict[sk] = []
                                                if sv not in specs_dict[sk]: specs_dict[sk].append(sv)
                                elif isinstance(sk_specs, dict):
                                    for sk_k, sk_v in sk_specs.items():
                                        spec_arr.append({"key": sk_k, "value": str(sk_v)})
                                        if sk_k not in specs_dict: specs_dict[sk_k] = []
                                        if str(sk_v) not in specs_dict[sk_k]: specs_dict[sk_k].append(str(sk_v))
                                
                                norm_skus.append({
                                    "sku_id": str(sk.get("sku_id") or sk.get("skuId") or sk.get("skuID") or sk.get("id") or ""),
                                    "specs": spec_arr,
                                    "price": sp,
                                    "original_price": sop,
                                    "stock": int(sk.get("quantity") or sk.get("stock") or sk.get("inventory") or 0),
                                    "image": sk_img,
                                })
                        
                        # Extract attributes
                        attributes = {}
                        for attr_key in ["goods_props", "attributes", "properties", "spec_list"]:
                            props = goods_data.get(attr_key)
                            if isinstance(props, list):
                                for pr in props:
                                    if isinstance(pr, dict) and (pr.get("key") or pr.get("name")) and (pr.get("value") or pr.get("val")):
                                        attributes[pr.get("key") or pr.get("name")] = pr.get("value") or pr.get("val")
                        
                        # Extract selling points
                        selling_points = []
                        for tag_key in ["service_tags", "goods_service_tags", "tags"]:
                            tags = goods_data.get(tag_key)
                            if isinstance(tags, list):
                                for tag in tags:
                                    txt = tag if isinstance(tag, str) else (tag.get("text") or tag.get("name") or tag.get("desc") or "")
                                    if txt and txt not in selling_points:
                                        selling_points.append(txt)
                        
                        ingest_data = {
                            "goods_id": gid,
                            "title": gn,
                            "subtitle": goods_data.get("goods_desc") or goods_data.get("desc") or "",
                            "price": price,
                            "original_price": price,
                            "min_group_price": price,
                            "sales": int(goods_data.get("sales") or goods_data.get("sold_quantity") or 0),
                            "sold_quantity": int(goods_data.get("sold_quantity") or goods_data.get("sales") or 0),
                            "shop_name": goods_data.get("mall_name") or goods_data.get("mallName") or "",
                            "shop_id": str(goods_data.get("mall_id") or goods_data.get("mallID") or ""),
                            "shop_logo": goods_data.get("mall_logo") or goods_data.get("mallLogo") or "",
                            "main_images": main_imgs,
                            "detail_images": detail_imgs,
                            "sku_images": sku_imgs,
                            "specs": specs_dict,
                            "skus": norm_skus,
                            "description": goods_data.get("goods_desc") or goods_data.get("desc") or "",
                            "attributes": attributes,
                            "selling_points": selling_points,
                            "source_url": url,
                            "raw_init_data": data,
                        }
                        
                        # Extract mall info
                        mall_info = {}
                        for mall_key in ["mall", "mall_info", "mallInfo"]:
                            m = data.get(mall_key)
                            if isinstance(m, dict) and (m.get("mallName") or m.get("mall_name")):
                                mall_info = m
                                break
                        if mall_info:
                            ingest_data["mall_info"] = mall_info
                        
                        # Send to ingest endpoint
                        try:
                            import requests as _req
                            resp = _req.post("http://127.0.0.1:5000/api/ingest",
                                           json=ingest_data, timeout=5)
                            ctx.log.info("[GoodsName API] Ingested " + gid + " status=" + str(resp.status_code)
                                        + " skus=" + str(len(norm_skus))
                                        + " detail_imgs=" + str(len(detail_imgs))
                                        + " attrs=" + str(len(attributes)))
                        except Exception as ie:
                            ctx.log.warn("[GoodsName API] Ingest error: " + str(ie))
            except:
                pass


addons = [PddInterceptor()]

