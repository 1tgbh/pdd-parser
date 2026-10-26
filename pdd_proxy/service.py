"""Optional mitmproxy addon: consume responses only, never fetch extra PDD APIs.

Extension mode does not import mitmproxy. Proxy mode parses structured API/SSR
responses locally and does not inject scripts or put local authentication in pages.
"""

import json
import logging
import re
from html.parser import HTMLParser

from capture_state import CapturePaused, capture_guard, get_capture_enabled, set_capture_enabled
from parser import GoodsParser
from storage import init_db, ingest_goods

logger = logging.getLogger(__name__)
PDD_DOMAINS = ("pinduoduo.com", "yangkeduo.com", "pdd.com")
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class _Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        self.active = tag == "script" and not dict(attrs).get("src")

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.scripts.append(data)


def save_goods_from_api(data, url):
    goods = GoodsParser.parse(data)
    if not goods or not goods.goods_id or not goods.title:
        return False
    normalized = goods.to_dict()
    normalized.update(source_url=url, capture_source="api", skus_complete=bool(goods.skus))
    # Only copy known catalog fields from the mall block.
    init = data.get("store", {}).get("initDataObj", data)
    mall = init.get("mall") or {}
    if isinstance(mall, dict):
        normalized["shop_name"] = mall.get("mallName") or mall.get("mall_name") or goods.shop_name
        normalized["shop_id"] = str(mall.get("mallID") or mall.get("mall_id") or goods.shop_id)
        normalized["shop_logo"] = mall.get("mallLogo") or mall.get("mall_logo") or goods.shop_logo
    with capture_guard():
        ingest_goods(normalized)
    return True


class PddInterceptor:
    def __init__(self):
        self.stats = {"total": 0, "saved": 0}

    def response(self, flow):
        if not get_capture_enabled() or not flow.response:
            return
        host = flow.request.pretty_host.lower()
        if not any(host == d or host.endswith("." + d) for d in PDD_DOMAINS):
            return
        self.stats["total"] += 1
        status = flow.response.status_code
        if status in (401, 403, 429):
            set_capture_enabled(False, f"页面访问受限（HTTP {status}）")
            return
        raw = flow.response.content or b""
        if not raw or len(raw) > MAX_RESPONSE_BYTES:
            return
        content_type = flow.response.headers.get("content-type", "")
        url = flow.request.pretty_url
        try:
            if "json" in content_type:
                self.stats["saved"] += int(save_goods_from_api(json.loads(raw), url))
            elif "html" in content_type and re.search(r"[?&]goods_id=\d+", url):
                scripts = _Scripts()
                scripts.feed(raw.decode("utf-8", errors="replace"))
                for script in scripts.scripts:
                    for pattern in (r"store\.initDataObj\s*=\s*", r"window\.__rawData__\s*=\s*", r"^\s*(?=\{)"):
                        match = re.search(pattern, script)
                        if not match:
                            continue
                        try:
                            obj, _ = json.JSONDecoder().raw_decode(script[match.end():].lstrip())
                            if save_goods_from_api(obj, url):
                                self.stats["saved"] += 1
                                return
                        except (ValueError, TypeError):
                            continue
        except CapturePaused:
            return
        except (ValueError, TypeError, AttributeError):
            logger.debug("Unsupported catalog response from %s", host)
        except Exception:
            logger.exception("Unable to save catalog response from %s", host)


addons = [PddInterceptor()]
