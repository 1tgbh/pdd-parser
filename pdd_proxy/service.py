
"""
PDD goods collection service - mitmproxy addon
Injects a JS extraction script into goods.html responses.
"""

import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from mitmproxy import http, ctx

DATA_DIR = Path(__file__).resolve().parent / "data"
IMAGES_DIR = DATA_DIR / "images"
DATA_DIR.mkdir(parents=True, exist_ok=True)
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "goods.db"

PDD_DOMAINS = ["pinduoduo.com", "yangkeduo.com", "pdd.com"]

_INJECT_JS_PATH = Path(__file__).resolve().parent / "inject.js"
_INJECT_JS = _INJECT_JS_PATH.read_text(encoding="utf-8") if _INJECT_JS_PATH.exists() else ""
_INJECT_TAG = "<script>" + _INJECT_JS + "</script>"


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
    """)
    conn.commit()
    conn.close()





def save_goods_from_api(goods_data, url):
    """Update price for EXISTING goods only. Never creates title-less entries."""
    goods_id = str(goods_data.get("goods_id", ""))
    if not goods_id:
        return False
    conn = sqlite3.connect(DB_PATH)
    now = datetime.now().isoformat()
    try:
        price = float(goods_data.get("price_info", goods_data.get("display_price", 0)))
        cur = conn.execute(
            "UPDATE goods SET price = ?, min_group_price = ?, updated_at = ? WHERE goods_id = ? AND (title IS NOT NULL AND length(title) > 0)",
            (price, price, now, goods_id)
        )
        conn.commit()
        if cur.rowcount > 0:
            ctx.log.info("[Price API] Updated price for " + str(goods_id) + " = " + str(price))
            return True
        ctx.log.info("[Price API] Skipped price-only " + str(goods_id))
        return False
    except Exception as e:
        ctx.log.warn("[DB] save_goods_from_api failed: " + str(e))
        return False
    finally:
        conn.close()


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

class PddInterceptor:
    def __init__(self):
        self.stats = {"total": 0, "injected": 0, "price_api": 0}

    def response(self, flow):
        host = flow.request.pretty_host
        if not any(d in host for d in PDD_DOMAINS):
            return

        self.stats["total"] += 1
        url = flow.request.pretty_url
        url_lower = url.lower()
        content_type = flow.response.headers.get("content-type", "") if flow.response else ""

        # Inject JS into goods.html
        if "goods.html" in url_lower and "text/html" in content_type:
            if flow.response and flow.response.content and _INJECT_JS:
                html = flow.response.content.decode("utf-8", errors="replace")
                if "<head>" in html and "[PDD]" not in html:
                    proxy_info = extract_title_from_html(html, url)
                    proxy_tag = '<script>window.__PDD_PROXY_DATA = ' + json.dumps(proxy_info, ensure_ascii=False) + ';</script>\n'
                    html = html.replace("<head>", "<head>\n" + proxy_tag + _INJECT_TAG, 1)
                    flow.response.content = html.encode("utf-8")
                    self.stats["injected"] += 1
                    ctx.log.info("[JS Inject] Injected, proxy=" + str(proxy_info))

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
            except Exception as e:
                ctx.log.warn("[Price API] Parse error: " + str(e))

        # Broad scan: log any API response containing goods_name
        if flow.response and flow.response.content and "goods.html" not in url_lower:
            try:
                raw = flow.response.content
                if b"goods_name" in raw or b"goodsName" in raw:
                    text = raw.decode("utf-8", errors="replace")
                    data = json.loads(text)
                    gn = None
                    gid = None
                    if isinstance(data, dict):
                        gn = data.get("goods_name") or data.get("goodsName")
                        gid = data.get("goods_id")
                        if not gn and isinstance(data.get("data"), dict):
                            gn = data["data"].get("goods_name") or data["data"].get("goodsName")
                            gid = gid or data["data"].get("goods_id")
                    if gn:
                        ctx.log.info("[GoodsName API] " + str(gid) + " -> " + str(gn)[:60] + " url=" + url[:80])
            except:
                pass


addons = [PddInterceptor()]

