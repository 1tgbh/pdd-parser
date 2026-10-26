"""Boundary validation and explicit PDD/API price-unit conversion."""

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode


def money(value, *, cents=False) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, bool):
        raise ValueError("价格必须是有限的非负数")
    try:
        number = Decimal(str(value).replace("¥", "").replace("￥", "").replace(",", "").strip())
        if not number.is_finite() or number < 0 or number > Decimal("1000000000"):
            raise ValueError("价格超出范围")
        if cents:
            number /= 100
        return float(number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("价格格式错误") from exc


def pdd_price(data: dict, *, sku=False, original=False) -> float:
    # CamelCase SSR display prices are yuan; raw API price fields are fen.
    yuan_fields = ("normalPrice", "linePrice") if original else (("groupPrice",) if sku else ("minGroupPrice", "display_price", "price_info"))
    fen_fields = ("market_price", "normal_price", "original_price") if original else (("skuPrice", "group_price", "sku_price", "price") if sku else ("min_group_price", "group_price", "min_on_sale_group_price", "price", "min_normal_price"))
    for fields, cents in ((yuan_fields, False), (fen_fields, True)):
        for name in fields:
            value = data.get(name)
            if value not in (None, "", 0, "0") and not isinstance(value, (dict, list)):
                return money(value, cents=cents)
    return money(data.get("normalPrice")) if sku and not original else 0.0


def nonnegative_int(value, default=0):
    if value is None or value == "":
        return default
    try:
        n = Decimal(str(value))
        if not n.is_finite() or n < 0 or n != n.to_integral_value() or n > 10**12:
            raise ValueError("数量必须是非负整数")
        return int(n)
    except InvalidOperation as exc:
        raise ValueError("数量格式错误") from exc


def valid_goods_id(value) -> str:
    gid = str(value or "").strip()
    if not re.fullmatch(r"[\w-]{1,128}", gid):
        raise ValueError("商品ID格式错误")
    return gid


def specs_dict(value) -> dict:
    if isinstance(value, dict):
        return {str(k)[:100]: str(v)[:500] for k, v in value.items() if k}
    result = {}
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict):
                continue
            key = item.get("key") or item.get("spec_key") or item.get("name") or item.get("spec")
            val = item.get("value", item.get("spec_value", ""))
            if key and val is not None:
                result[str(key)[:100]] = str(val)[:500]
    return result


def normalize_skus(value, *, from_pdd=False) -> list:
    if not isinstance(value, list) or len(value) > 5000:
        raise ValueError("SKU必须是最多5000项的数组")
    result = {}
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("SKU项必须是对象")
        specs = specs_dict(item.get("specs", item.get("spec", {})))
        sid = str(item.get("sku_id") or item.get("skuID") or item.get("skuId") or "")[:128]
        stock = item.get("quantity", item.get("stock")) if from_pdd else item.get("stock", item.get("quantity"))
        sku = {
            "sku_id": sid,
            "specs": [{"key": k, "value": v} for k, v in specs.items()],
            "price": pdd_price(item, sku=True) if from_pdd else money(item.get("price")),
            "original_price": pdd_price(item, sku=True, original=True) if from_pdd else money(item.get("original_price")),
            "stock": nonnegative_int(stock, None),
            "image": str(item.get("image") or item.get("thumb_url") or item.get("thumbUrl") or "")[:2000],
        }
        key = sid or json.dumps(specs, ensure_ascii=False, sort_keys=True)
        if sid or specs:
            result[key] = sku
    return list(result.values())


def safe_source_url(value) -> str:
    try:
        url = urlsplit(str(value or ""))
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
            return ""
        query = urlencode([(k, v) for k, v in parse_qsl(url.query) if k in {"goods_id", "goodsID", "mall_id", "mallID", "search_key"}])
        return urlunsplit((url.scheme, url.netloc, url.path, query, ""))[:2000]
    except ValueError:
        return ""


def normalize_goods(data: dict, *, allow_empty=False) -> dict:
    if not isinstance(data, dict):
        raise ValueError("商品数据必须是对象")
    result = {"goods_id": valid_goods_id(data.get("goods_id"))}
    for key in ("title", "subtitle", "description", "shop_name", "shop_id", "shop_logo"):
        result[key] = str(data.get(key) or "")[:10000 if key == "description" else 1000]
    for key in ("main_images", "detail_images", "sku_images", "selling_points"):
        values = data.get(key) or []
        if not isinstance(values, list) or len(values) > 1000 or any(not isinstance(v, str) for v in values):
            raise ValueError(key + "必须是字符串数组")
        result[key] = list(dict.fromkeys(v[:2000] for v in values if v))
    if not allow_empty and not result["title"] and not result["main_images"]:
        raise ValueError("商品缺少标题和图片")
    for key in ("price", "original_price", "min_group_price"):
        result[key] = money(data.get(key))
    for key in ("sales", "sold_quantity"):
        result[key] = nonnegative_int(data.get(key))
    for key in ("specs", "attributes"):
        value = data.get(key) or {}
        if not isinstance(value, dict) or len(value) > 200:
            raise ValueError(key + "必须是对象")
        if key == "specs":
            result[key] = {str(k)[:100]: [str(v)[:500] for v in (vals if isinstance(vals, list) else [vals])][:100] for k, vals in value.items()}
        else:
            result[key] = {str(k)[:100]: str(v)[:1000] for k, v in value.items()}
    result["skus"] = normalize_skus(data.get("skus") or [])
    result["source_url"] = safe_source_url(data.get("source_url"))
    source = data.get("capture_source")
    result["capture_source"] = source if isinstance(source, str) and source in {"api", "dom", "import"} else "api"
    result["skus_complete"] = data.get("skus_complete") is True and bool(result["skus"]) and all(s["sku_id"] for s in result["skus"])
    from provenance import normalize_sources, version
    result["parser_version"] = version(data.get("parser_version"))
    result["field_sources"] = normalize_sources(data.get("field_sources"), result, supplied_fields=set(data))
    return result
