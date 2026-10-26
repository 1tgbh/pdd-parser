"""
拼多多商品请求拦截脚本
用于 mitmproxy 捕获拼多多 APP/网页的商品 API 请求

使用方式:
    mitmdump -s pdd_intercept.py -p 8080
    
然后手机/电脑设置代理指向本机:8080，安装 mitmproxy 的 CA 证书
"""

import json
import re
import logging
from datetime import datetime
from pathlib import Path
from paths import DATA_DIR
from normalization import safe_source_url
from parser import GoodsParser

logger = logging.getLogger(__name__)

# 拼多多相关域名
PDD_DOMAINS = [
    "pinduoduo.com",
    "yangkeduo.com",
    "pdd.com",
    "pddpic.com",
]

# 商品相关 API 路径关键词
GOODS_API_KEYWORDS = [
    "goods",
    "detail",
    "product",
    "item",
    "goods_detail",
    "goods_info",
    "mall_goods",
    "search",
    "recommend",
]

# 存储目录
OUTPUT_DIR = DATA_DIR / "capture"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 统计
stats = {"total_pdd": 0, "goods_api": 0}


def is_pdd_request(host: str) -> bool:
    return any(host == domain or host.endswith("." + domain) for domain in PDD_DOMAINS)


def is_goods_api(url: str) -> bool:
    url_lower = url.lower()
    return any(kw in url_lower for kw in GOODS_API_KEYWORDS)


def save_json(data: dict, prefix: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filepath = OUTPUT_DIR / f"{prefix}_{ts}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return filepath


def try_parse_json(content: bytes):
    try:
        text = content.decode("utf-8")
        # 处理 JSONP: callback({...})
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            return json.loads(match.group())
        return json.loads(text)
    except Exception:
        return None


def request(flow) -> None:
    host = flow.request.pretty_host
    if not is_pdd_request(host):
        return

    stats["total_pdd"] += 1
    url = flow.request.pretty_url

    if not is_goods_api(url):
        logger.debug("[PDD] %s %s", flow.request.method, host)
        return

    stats["goods_api"] += 1
    logger.info("[PDD 商品API] %s %s", flow.request.method, host)

    req_data = {
        "type": "request",
        "timestamp": datetime.now().isoformat(),
        "method": flow.request.method,
        "url": safe_source_url(url),
        "host": host,
        "headers": {k: v for k, v in flow.request.headers.items() if k.lower() in {"content-type", "accept"}},
        "query_params": {k: v for k, v in flow.request.query.items() if k in {"goods_id", "mall_id", "page", "page_size"}},
    }

    if flow.request.content:
        body = try_parse_json(flow.request.content)
        if isinstance(body, dict):
            req_data["body"] = {k: v for k, v in body.items() if k in {"goods_id", "mall_id", "page", "page_size"} and isinstance(v, (str, int))}

    filepath = save_json(req_data, "req")
    logger.info("  -> 已保存脱敏请求: %s", filepath.name)


def response(flow) -> None:
    host = flow.request.pretty_host
    if not is_pdd_request(host):
        return

    url = flow.request.pretty_url
    if not is_goods_api(url):
        return

    status = flow.response.status_code
    logger.info("[PDD 响应] %s %s", status, host)

    resp_data = {
        "type": "response",
        "timestamp": datetime.now().isoformat(),
        "request_url": safe_source_url(url),
        "method": flow.request.method,
        "status_code": status,
        "content_type": flow.response.headers.get("content-type", ""),
        "content_length": len(flow.response.content) if flow.response.content else 0,
    }

    if flow.response.content and len(flow.response.content) <= 4 * 1024 * 1024:
        body = try_parse_json(flow.response.content)
        try:
            parsed = GoodsParser.parse(body)
            if parsed:
                resp_data["body"] = parsed.to_dict()
                resp_data["body_type"] = "catalog_fields"
        except (ValueError, TypeError, AttributeError):
            pass

    filepath = save_json(resp_data, "resp")
    logger.info("  -> 已保存商品字段: %s", filepath.name)


def done():
    """脚本结束时打印统计"""
    logger.info("抓包统计: 拼多多请求=%s 商品API=%s", stats['total_pdd'], stats['goods_api'])
