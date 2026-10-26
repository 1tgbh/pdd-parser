"""微信小店导出模块 - 生成符合微信小店 API 格式的数据包

参考: 微信小商店 addproduct API
必填字段: title, head_imgs, cats, skus[].sale_price, brand_id, deliver_method
可选字段: short_title, desc_info, attrs, extra_service, listing, need_audit
"""

import re
import json
import zipfile
import sqlite3
import io
import tempfile
from datetime import datetime
from pathlib import Path

from exporter import (
    get_conn, _load_goods, _download_image, _safe_filename,
    DATA_DIR, EXPORT_DIR, DB_PATH,
)
from normalization import specs_dict
from paths import BASE_DIR

# ============================================================
# 微信小店导出配置
# ============================================================

_WECHAT_TITLE_BAD_CHARS = re.compile(r'[\u221a\u2162\u2163\u2165\u2166\u2167\u2168\u2169\u216a\u2605\u2606\u2660\u2663\u2665\u2666\u266a\u203b\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25bc\u25bd\u2192\u2190\u2191\u2193\u2194]+')
_WECHAT_TITLE_MAX_LEN = 60
_WECHAT_TITLE_MIN_LEN = 5
_WECHAT_SHORT_TITLE_MAX_LEN = 20
_WECHAT_HEAD_IMGS_MIN = 3
_WECHAT_HEAD_IMGS_MAX = 9
_WECHAT_DESC_MAX_LEN = 2000

_WECHAT_DEFAULTS = {
    "deliver_method": 0,
    "seven_day_return": 1,
    "freight_insurance": 0,
    "default_stock": 0,
    "brand_id": "2100000000",
    "listing": 0,
}

_CATEGORIES_DATA = None
_FORBIDDEN_DATA = None


def _load_categories():
    global _CATEGORIES_DATA
    if _CATEGORIES_DATA is None:
        cat_path = DATA_DIR / "wechat_categories.json"
        if not cat_path.exists():
            cat_path = BASE_DIR / "data" / "wechat_categories.json"
        if cat_path.exists():
            try:
                with open(cat_path, "r", encoding="utf-8") as f:
                    _CATEGORIES_DATA = json.load(f)
            except Exception:
                _CATEGORIES_DATA = {"categories": []}
        else:
            _CATEGORIES_DATA = {"categories": []}
    return _CATEGORIES_DATA


def _load_forbidden():
    global _FORBIDDEN_DATA
    if _FORBIDDEN_DATA is None:
        fw_path = DATA_DIR / "forbidden_words.json"
        if not fw_path.exists():
            fw_path = BASE_DIR / "data" / "forbidden_words.json"
        if fw_path.exists():
            try:
                with open(fw_path, "r", encoding="utf-8") as f:
                    _FORBIDDEN_DATA = json.load(f)
            except Exception:
                _FORBIDDEN_DATA = {"forbidden_words": [], "replace_rules": []}
        else:
            _FORBIDDEN_DATA = {"forbidden_words": [], "replace_rules": []}
    return _FORBIDDEN_DATA


def match_category(title: str) -> list:
    data = _load_categories()
    title_lower = title.lower()
    best_match = None
    best_score = 0
    for cat in data.get("categories", []):
        score = 0
        for kw in cat.get("keywords", []):
            if kw.lower() in title_lower:
                score += len(kw)
        if score > best_score:
            best_score = score
            best_match = cat
    if best_match and best_score > 0:
        return best_match.get("id", [])
    return []


def check_forbidden_words(title: str) -> list:
    data = _load_forbidden()
    found = []
    for word in data.get("forbidden_words", []):
        if word in title:
            found.append(word)
    return found


def auto_fix_forbidden(title: str) -> tuple:
    data = _load_forbidden()
    fixed = title
    changes = []
    for rule in data.get("replace_rules", []):
        pattern = rule.get("pattern", "")
        replacement = rule.get("replace", "")
        if pattern and replacement and re.search(pattern, fixed):
            new_text = re.sub(pattern, replacement, fixed)
            if new_text != fixed:
                changes.append(f"'{pattern}' → '{replacement}'")
                fixed = new_text
    return fixed, changes


def _load_wechat_config() -> dict:
    """加载微信小店导出配置，合并默认值。"""
    cfg = {}
    config_path = DATA_DIR / "config.json"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                full = json.load(f)
            cfg = full.get("wechat_export", {})
        except Exception:
            pass
    merged = dict(_WECHAT_DEFAULTS)
    merged.update(cfg)
    return merged


def _clean_wechat_title(title: str) -> str:
    """清洗标题：去除特殊字符，截断至60字符。"""
    if not title:
        return ""
    cleaned = _WECHAT_TITLE_BAD_CHARS.sub("", title)
    cleaned = cleaned.strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    if len(cleaned) > _WECHAT_TITLE_MAX_LEN:
        cleaned = cleaned[:_WECHAT_TITLE_MAX_LEN]
    # 去除末尾截断产生的不完整词
    cleaned = cleaned.rstrip()
    return cleaned


def _yuan_to_fen(price_yuan) -> int:
    """元转分，四舍五入到整数。"""
    try:
        val = round(float(price_yuan) * 100)
        return max(val, 1)  # 微信小店最低1分
    except (ValueError, TypeError):
        return 1


def _convert_specs_to_sku_attrs(specs: dict) -> list:
    """将 specs 格式转为微信小店 sku_attrs 格式。
    输入: {"颜色": ["白色", "黑色"], "尺码": ["XL"]}
    输出: [{"attr_key": "颜色", "attr_value": "白色"}, ...]
    """
    attrs = []
    if not isinstance(specs, dict):
        return attrs
    for key, values in specs.items():
        if not key:
            continue
        if isinstance(values, list):
            for val in values:
                if val:
                    attrs.append({"attr_key": str(key), "attr_value": str(val)})
        elif isinstance(values, str) and values:
            attrs.append({"attr_key": str(key), "attr_value": values})
    return attrs


def _convert_skus(skus: list, default_stock: int = 0) -> list:
    """将 PDD skus 转为微信小店 skus 格式。"""
    result = []
    if not isinstance(skus, list):
        return result
    for sku in skus:
        if not isinstance(sku, dict):
            continue
        sale_price = _yuan_to_fen(sku.get("price", 0))
        stock = sku.get("stock")
        if stock is None:
            stock = default_stock
        sku_attrs = []
        specs = specs_dict(sku.get("specs", {}))
        if isinstance(specs, dict):
            for k, v in specs.items():
                if k and v:
                    sku_attrs.append({"attr_key": str(k), "attr_value": str(v)})
        thumb_img = sku.get("image", "") or ""
        result.append({
            "sale_price": sale_price,
            "stock_num": int(stock),
            "sku_attrs": sku_attrs,
            "thumb_img": thumb_img,
        })
    return result


def _convert_attributes_to_attrs(attributes: dict) -> list:
    """将 attributes dict 转为微信小店 attrs 格式。"""
    result = []
    if not isinstance(attributes, dict):
        return result
    for k, v in attributes.items():
        if k and v:
            result.append({"attr_key": str(k), "attr_value": str(v)})
    return result


def _convert_description(g: dict) -> dict:
    """将 description 转为微信小店 desc_info 格式。"""
    desc = g.get("description", "") or ""
    imgs = g.get("detail_images", []) or []
    return {"desc": desc[:_WECHAT_DESC_MAX_LEN], "imgs": imgs}


def _build_wechat_goods(g: dict, cfg: dict) -> dict:
    """将单个商品转为微信小店 API 格式。

    返回值:
      product: 符合 addproduct API 的商品对象（不含 _meta）
      meta: 采集来源信息（单独存放）
      warnings: 校验警告列表
    """
    warnings = []
    title = _clean_wechat_title(g.get("title", ""))
    forbidden = check_forbidden_words(title)
    if forbidden:
        warnings.append(f"标题含违规词: {', '.join(forbidden)}")
        title_fixed, _ = auto_fix_forbidden(title)
        title = _clean_wechat_title(title_fixed)
    if len(title) < _WECHAT_TITLE_MIN_LEN:
        warnings.append(f"标题不足{_WECHAT_TITLE_MIN_LEN}字符: '{title}'")

    short_title = title[:_WECHAT_SHORT_TITLE_MAX_LEN] if title else ""
    price_yuan = g.get("price", 0) or 0
    main_images = g.get("main_images", []) or []
    skus_raw = g.get("skus", []) or []
    attributes = g.get("attributes", {}) or {}
    specs = g.get("specs", {}) or {}

    # 校验头图数量
    head_imgs = main_images[:_WECHAT_HEAD_IMGS_MAX]
    if len(head_imgs) < _WECHAT_HEAD_IMGS_MIN:
        warnings.append(f"头图不足{_WECHAT_HEAD_IMGS_MIN}张: 仅{len(head_imgs)}张")

    product = {
        "title": title,
        "short_title": short_title,
        "head_imgs": head_imgs,
        "deliver_method": cfg.get("deliver_method", 0),
        "extra_service": {
            "seven_day_return": cfg.get("seven_day_return", 1),
            "freight_insurance": cfg.get("freight_insurance", 0),
        },
        "desc_info": _convert_description(g),
        "cats": match_category(g.get("title", "")),
        "attrs": _convert_attributes_to_attrs(attributes),
        "skus": [],
        "brand_id": str(cfg.get("brand_id", "2100000000")),
        "listing": cfg.get("listing", 0),
    }

    converted_skus = _convert_skus(skus_raw, cfg.get("default_stock", 0))
    if converted_skus:
        product["skus"] = converted_skus
    else:
        product["skus"] = [{
            "sale_price": _yuan_to_fen(price_yuan),
            "stock_num": cfg.get("default_stock", 0),
            "sku_attrs": _convert_specs_to_sku_attrs(specs),
            "thumb_img": "",
        }]

    # 采集来源信息（不混入商品对象）
    meta = {
        "source_goods_id": g.get("goods_id", ""),
        "source_url": g.get("source_url", ""),
        "original_price_yuan": price_yuan,
        "crawl_time": g.get("crawl_time", ""),
    }

    # 额外校验
    if not product["cats"]:
        warnings.append("类目(cats)未配置，需手动填入3个类目ID")
    for i, sku in enumerate(product["skus"]):
        if sku["sale_price"] <= 0:
            warnings.append(f"SKU[{i}] 价格异常: {sku['sale_price']}分")

    return {"product": product, "meta": meta, "warnings": warnings}


def export_for_wechat(goods_ids: list = None) -> str:
    """导出微信小店专用数据包（ZIP）。

    包含:
    - wechat_goods.json: 符合微信小店 addproduct API 格式的商品数据
    - 商品对照表.xlsx: 方便人工核对的 Excel 表格
    - 使用说明.txt: 导入步骤说明
    - 图片/: 按商品分组的图片文件夹
    - warnings.json: 校验警告汇总
    """
    try:
        import openpyxl
    except ImportError:
        print("需要安装 openpyxl: pip install openpyxl")
        return None

    cfg = _load_wechat_config()

    conn = get_conn()
    if goods_ids:
        placeholders = ",".join(["?"] * len(goods_ids))
        rows = conn.execute(
            f"SELECT * FROM goods WHERE goods_id IN ({placeholders})", goods_ids
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM goods ORDER BY crawl_time DESC").fetchall()
    conn.close()

    goods_list = _load_goods(rows)
    if not goods_list:
        print("没有可导出的商品")
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    zip_name = "微信小店数据包_" + timestamp + ".zip"
    zip_path = EXPORT_DIR / zip_name

    # 转换所有商品
    converted = []
    all_warnings = []
    for idx, g in enumerate(goods_list):
        result = _build_wechat_goods(g, cfg)
        converted.append(result)
        if result["warnings"]:
            gid = g.get("goods_id", "unknown")
            for w in result["warnings"]:
                all_warnings.append(f"[{gid}] {w}")

    wechat_products = [c["product"] for c in converted]
    wechat_metas = [c["meta"] for c in converted]

    # 准备图片下载任务
    all_img_tasks = []
    for i, g in enumerate(goods_list):
        gid = g.get("goods_id", "unknown_" + str(i))
        safe_title = _safe_filename(g.get("title", ""), 20)
        base_dir = "图片/" + safe_title + "_" + gid
        for j, url in enumerate(g.get("main_images", []) or []):
            if url and url.startswith("http"):
                arcname = base_dir + "/主图/主图_" + str(j + 1) + ".jpg"
                all_img_tasks.append((arcname, url))
        for j, url in enumerate(g.get("detail_images", []) or []):
            if url and url.startswith("http"):
                arcname = base_dir + "/详情图/详情图_" + str(j + 1) + ".jpg"
                all_img_tasks.append((arcname, url))
        for j, url in enumerate(g.get("sku_images", []) or []):
            if url and url.startswith("http"):
                arcname = base_dir + "/SKU图/SKU图_" + str(j + 1) + ".jpg"
                all_img_tasks.append((arcname, url))

    # 下载图片
    img_results = {}
    scratch = tempfile.TemporaryDirectory(prefix="wechat_images_", dir=EXPORT_DIR)
    total_imgs = len(all_img_tasks)
    if total_imgs > 5000:
        raise ValueError("单个图文包最多5000张图片")
    if total_imgs > 0:
        print("正在下载 " + str(total_imgs) + " 张图片...")
        for index, task in enumerate(all_img_tasks):
            arcname, data = _download_image(task)
            if data:
                local = Path(scratch.name) / f"{index}.img"
                local.write_bytes(data)
                img_results[arcname] = local
        print("图片下载完成: " + str(len(img_results)) + "/" + str(total_imgs))

    # 生成 Excel 对照表
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "商品对照表"
    headers = [
        "序号", "商品ID", "标题(已清洗)", "标题长度", "价格(元)", "价格(分)",
        "头图数量", "详情图数量", "SKU数量", "规格", "属性",
        "发货方式", "七天无理由", "品牌ID", "类目状态", "校验警告"
    ]
    ws.append(headers)
    for idx, g in enumerate(goods_list):
        wg = wechat_products[idx]
        meta = wechat_metas[idx]
        warns = converted[idx]["warnings"]

        specs_items = (g.get("specs") or {}).items()
        specs_parts = []
        for k, v in specs_items:
            if isinstance(v, list):
                specs_parts.append(k + ":" + ",".join(v))
            else:
                specs_parts.append(k + ":" + str(v))
        specs_str = "; ".join(specs_parts)

        attrs_parts = []
        for a in wg.get("attrs", []):
            attrs_parts.append(a["attr_key"] + ":" + a["attr_value"])
        attrs_str = "; ".join(attrs_parts)

        ws.append([
            idx + 1,
            meta.get("source_goods_id", ""),
            wg.get("title", ""),
            len(wg.get("title", "")),
            g.get("price", 0),
            _yuan_to_fen(g.get("price", 0)),
            len(wg.get("head_imgs", [])),
            len(g.get("detail_images", []) or []),
            len(wg.get("skus", [])),
            specs_str,
            attrs_str,
            "快递发货" if wg.get("deliver_method") == 0 else "无需快递",
            "是" if wg.get("extra_service", {}).get("seven_day_return") == 1 else "否",
            wg.get("brand_id", ""),
            "待配置类目" if not wg.get("cats") else "就绪",
            "; ".join(warns) if warns else "通过",
        ])
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            try:
                cell_len = len(str(cell.value))
                if cell_len > max_len:
                    max_len = cell_len
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max_len + 2, 40)

    # 生成使用说明
    warn_summary = ""
    if all_warnings:
        warn_summary = "\n".join(["  - " + w for w in all_warnings[:20]])
        if len(all_warnings) > 20:
            warn_summary += "\n  ... 共 " + str(len(all_warnings)) + " 条警告，详见 warnings.json"

    readme_lines = [
        "微信小店数据包 - 使用说明",
        "=" * 50,
        "",
        "导出时间: " + timestamp,
        "商品数量: " + str(len(goods_list)),
        "校验警告: " + str(len(all_warnings)) + " 条",
        "",
        "=" * 50,
        "文件说明:",
        "=" * 50,
        "",
        "1. wechat_goods.json",
        "   符合微信小店 addproduct API 格式的商品数据。",
        "   每个商品包含 product（API字段）和 meta（采集来源）。",
        "",
        "2. 商品对照表.xlsx",
        "   便于人工核对的商品信息表格。",
        "   类目状态为\"待配置类目\"的商品需手动填入类目ID。",
        "   校验警告列显示需要人工处理的问题。",
        "",
        "3. warnings.json",
        "   校验警告汇总（标题过短、头图不足、价格异常等）。",
        "",
        "4. 图片/  文件夹",
        "   按商品分组的图片文件夹（主图、详情图、SKU图）。",
        "   需要手动上传到微信小店后台，获取微信图片URL后",
        "   替换 wechat_goods.json 中的 head_imgs 和 desc_info.imgs。",
        "",
    ]
    if warn_summary:
        readme_lines.extend([
            "=" * 50,
            "校验警告:",
            "=" * 50,
            warn_summary,
            "",
        ])
    readme_lines.extend([
        "=" * 50,
        "使用步骤:",
        "=" * 50,
        "",
        "1. 打开\"商品对照表.xlsx\"核对商品信息和校验警告",
        "2. 对于\"类目状态\"为\"待配置类目\"的商品，填入 cats 字段",
        "   cats 格式: [一级类目ID, 二级类目ID, 三级类目ID]",
        "3. 将\"图片\"文件夹中的图片上传到微信小店后台",
        "4. 用上传后获取的微信图片URL替换 JSON 中的图片地址",
        "5. 从 wechat_goods.json 中提取 product 对象调用 API",
        "6. 调用微信小店 addproduct API 批量添加商品",
        "7. 添加成功后调用上架接口提交审核",
        "",
        "=" * 50,
        "API 字段说明:",
        "=" * 50,
        "",
        "- title: 商品标题 (5-60字符)",
        "- head_imgs: 头图URL列表 (3-9张，需为微信CDN地址)",
        "- sale_price: 售价，单位为分 (最低1分)",
        "- cats: 类目 [一级, 二级, 三级] (必填3个)",
        "- brand_id: 品牌ID (2100000000=其他品牌)",
        "- deliver_method: 发货方式 (0=快递, 1=无需快递)",
        "- listing: 上架状态 (0=仓库, 1=上架)",
        "- desc_info: 商品详情 (desc文字 + imgs图片列表)",
        "- skus: SKU列表 (每项含 sale_price, stock_num, sku_attrs)",
        "- attrs: 商品属性 [{attr_key, attr_value}, ...]",
        "- extra_service: 附加服务 {seven_day_return, freight_insurance}",
    ])
    readme = "\n".join(readme_lines)

    # 打包 ZIP
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        # wechat_goods.json: product 和 meta 分开存储
        json_content = json.dumps({
            "goods_list": [
                {"product": c["product"], "meta": c["meta"]}
                for c in converted
            ],
            "config": {
                "export_time": timestamp,
                "total_goods": len(wechat_products),
                "total_warnings": len(all_warnings),
                "defaults": cfg,
                "note": (
                    "图片需要手动上传到微信小店后台获取微信URL后替换 head_imgs 和 desc_info.imgs。"
                    "cats 字段需要手动填写 [一级类目ID, 二级类目ID, 三级类目ID]。"
                    "调用 API 时请使用 goods_list[].product 对象。"
                ),
            }
        }, ensure_ascii=False, indent=2)
        zf.writestr("wechat_goods.json", json_content.encode("utf-8"))

        # warnings.json
        if all_warnings:
            zf.writestr("warnings.json", json.dumps(all_warnings, ensure_ascii=False, indent=2).encode("utf-8"))

        xlsx_buffer = io.BytesIO()
        wb.save(xlsx_buffer)
        zf.writestr("商品对照表.xlsx", xlsx_buffer.getvalue())

        zf.writestr("使用说明.txt", readme.encode("utf-8-sig"))

        for arcname, local in img_results.items():
            zf.write(local, arcname)
        missing = [name for name, _ in all_img_tasks if name not in img_results]
        if missing:
            zf.writestr("下载未完成.txt", "以下图片未下载成功，访问受限时已停止重试：\n" + "\n".join(missing))

    downloaded = len(img_results)
    failed = total_imgs - downloaded
    print("")
    print("微信小店数据包导出完成: " + str(zip_path))
    print("  商品: " + str(len(goods_list)) + " 个")
    print("  图片: " + str(downloaded) + " 成功, " + str(failed) + " 失败")
    print("  警告: " + str(len(all_warnings)) + " 条")
    if all_warnings:
        for w in all_warnings[:5]:
            print("    - " + w)
        if len(all_warnings) > 5:
            print("    ... 共 " + str(len(all_warnings)) + " 条，详见 warnings.json")
    scratch.cleanup()
    return zip_path
