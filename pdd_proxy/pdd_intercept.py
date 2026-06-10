"""
拼多多商品请求拦截脚本
用于 mitmproxy 捕获拼多多 APP/网页的商品 API 请求

使用方式:
    mitmdump -s pdd_intercept.py -p 8080
    
然后手机/电脑设置代理指向本机:8080，安装 mitmproxy 的 CA 证书
"""

import json
import os
import re
from datetime import datetime
from mitmproxy import http, ctx

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
OUTPUT_DIR = Path(__file__).resolve().parent / "capture"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 统计
stats = {"total_pdd": 0, "goods_api": 0}


def is_pdd_request(host: str) -> bool:
    return any(domain in host for domain in PDD_DOMAINS)


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


def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if not is_pdd_request(host):
        return

    stats["total_pdd"] += 1
    url = flow.request.pretty_url

    if not is_goods_api(url):
        ctx.log.debug(f"[PDD] {flow.request.method} {url}")
        return

    stats["goods_api"] += 1
    ctx.log.info(f"[PDD 商品API] {flow.request.method} {url}")

    req_data = {
        "type": "request",
        "timestamp": datetime.now().isoformat(),
        "method": flow.request.method,
        "url": url,
        "host": host,
        "path": flow.request.path,
        "headers": dict(flow.request.headers),
        "query_params": dict(flow.request.query),
    }

    if flow.request.content:
        body = try_parse_json(flow.request.content)
        if body:
            req_data["body"] = body
        else:
            req_data["body_raw"] = flow.request.content.decode("utf-8", errors="replace")[:3000]

    filepath = save_json(req_data, "req")
    ctx.log.info(f"  -> 已保存: {filepath}")


def response(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if not is_pdd_request(host):
        return

    url = flow.request.pretty_url
    if not is_goods_api(url):
        return

    status = flow.response.status_code
    ctx.log.info(f"[PDD 响应] {status} {url}")

    resp_data = {
        "type": "response",
        "timestamp": datetime.now().isoformat(),
        "request_url": url,
        "method": flow.request.method,
        "status_code": status,
        "content_type": flow.response.headers.get("content-type", ""),
        "content_length": len(flow.response.content) if flow.response.content else 0,
    }

    if flow.response.content:
        body = try_parse_json(flow.response.content)
        if body:
            resp_data["body"] = body
            resp_data["body_type"] = "json"
        else:
            resp_data["body_raw"] = flow.response.content[:5000].decode("utf-8", errors="replace")
            resp_data["body_type"] = "raw"

    filepath = save_json(resp_data, "resp")
    ctx.log.info(f"  -> 已保存: {filepath}")


def done():
    """脚本结束时打印统计"""
    ctx.log.info(f"\n=== 抓包统计 ===")
    ctx.log.info(f"拼多多请求总数: {stats['total_pdd']}")
    ctx.log.info(f"商品API数量: {stats['goods_api']}")
    ctx.log.info(f"数据保存目录: {OUTPUT_DIR}")
