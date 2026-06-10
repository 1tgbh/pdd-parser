"""微信小店导出模块 - 生成符合微信小店 API 格式的数据包"""

import re
import json
import zipfile
import sqlite3
import io
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from exporter import (
    get_conn, _load_goods, _download_image, _safe_filename,
    DATA_DIR, EXPORT_DIR, DB_PATH,
)

# ============================================================
# 微信小店导出配置
# ============================================================

_WECHAT_TITLE_BAD_CHARS = re.compile(r'[\u221a\u2162\u2163\u2165\u2166\u2167\u2168\u2169\u216a\u2605\u2606\u2660\u2663\u2665\u2666\u266a\u203b\u25cf\u25cb\u25c6\u25c7\u25a0\u25a1\u25b2\u25b3\u25bc\u25bd\u2192\u2190\u2191\u2193\u2194]+')
_WECHAT_TITLE_MAX_LEN = 60
_WECHAT_SHORT_TITLE_MAX_LEN = 20

_WECHAT_DEFAULTS = {
    "deliver_method": 0,
    "seven_day_return": 1,
    "freight_insurance": 0,
    "default_stock": 999,
    "brand_id": "2100000000",
    "listing": 0,
    "release_mode": 1,
}


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
    """清洗标题：去除特殊字符，截断至60字符，确保至少5个有效字符。"""
    if not title:
        return ""
    cleaned = _WECHAT_TITLE_BAD_CHARS.sub("", title)
    cleaned = cleaned.strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    if len(cleaned) > _WECHAT_TITLE_MAX_LEN:
        cleaned = cleaned[:_WECHAT_TITLE_MAX_LEN]
    return cleaned


def _yuan_to_fen(price_yuan) -> int:
    """元转分，四舍五入到整数。"""
    try:
        return round(float(price_yuan) * 100)
    except (ValueError, TypeError):
        return 0


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


def _convert_skus(skus: list, default_stock: int = 999) -> list:
    """将 PDD skus 转为微信小店 skus 格式。"""
    result = []
    if not isinstance(skus, list):
        return result
    for sku in skus:
        if not isinstance(sku, dict):
            continue
        sale_price = _yuan_to_fen(sku.get("price", 0))
        stock = sku.get("stock", 0)
        if not stock or stock <= 0:
            stock = default_stock
        sku_attrs = []
        specs = sku.get("specs", {})
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
    return {"desc": desc[:2000], "imgs": imgs}


def _build_wechat_goods(g: dict, cfg: dict) -> dict:
    """将单个商品转为微信小店 API 格式。"""
    title = _clean_wechat_title(g.get("title", ""))
    short_title = title[:_WECHAT_SHORT_TITLE_MAX_LEN] if title else ""
    price_yuan = g.get("price", 0) or 0
    main_images = g.get("main_images", []) or []
    skus_raw = g.get("skus", []) or []
    attributes = g.get("attributes", {}) or {}
    specs = g.get("specs", {}) or {}

    wechat = {
        "title": title,
        "short_title": short_title,
        "head_imgs": main_images[:9],
        "deliver_method": cfg.get("deliver_method", 0),
        "extra_service": {
            "seven_day_return": cfg.get("seven_day_return", 1),
            "freight_insurance": cfg.get("freight_insurance", 0),
        },
        "desc_info": _convert_description(g),
        "cats": [],
        "attrs": _convert_attributes_to_attrs(attributes),
        "skus": [],
        "brand_id": cfg.get("brand_id", "2100000000"),
        "listing": cfg.get("listing", 0),
        "release_mode": cfg.get("release_mode", 1),
        "_meta": {
            "source_goods_id": g.get("goods_id", ""),
            "source_url": g.get("source_url", ""),
            "original_price_yuan": price_yuan,
            "crawl_time": g.get("crawl_time", ""),
        },
    }

    converted_skus = _convert_skus(skus_raw, cfg.get("default_stock", 999))
    if converted_skus:
        wechat["skus"] = converted_skus
    else:
        wechat["skus"] = [{
            "sale_price": _yuan_to_fen(price_yuan),
            "stock_num": cfg.get("default_stock", 999),
            "sku_attrs": _convert_specs_to_sku_attrs(specs),
            "thumb_img": "",
        }]

    return wechat


def export_for_wechat(goods_ids: list = None) -> str:
    """导出微信小店专用数据包（ZIP）。
    
    包含:
    - wechat_goods.json: 符合微信小店 API 格式的商品数据
    - 商品对照表.xlsx: 方便人工核对的 Excel 表格
    - 使用说明.txt: 导入步骤说明
    - 图片/: 按商品分组的图片文件夹
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

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = "微信小店数据包_" + timestamp + ".zip"
    zip_path = EXPORT_DIR / zip_name

    wechat_goods = []
    for g in goods_list:
        wechat_goods.append(_build_wechat_goods(g, cfg))

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
    total_imgs = len(all_img_tasks)
    if total_imgs > 0:
        workers = min(8, total_imgs)
        print("正在下载 " + str(total_imgs) + " 张图片（" + str(workers) + " 线程）...")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_download_image, task): task for task in all_img_tasks}
            for future in as_completed(futures):
                arcname, data = future.result()
                if data:
                    img_results[arcname] = data
        print("图片下载完成: " + str(len(img_results)) + "/" + str(total_imgs))

    # 生成 Excel 对照表
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "商品对照表"
    headers = [
        "序号", "商品ID", "标题(已清洗)", "价格(元)", "价格(分)",
        "主图数量", "详情图数量", "SKU数量", "规格", "属性",
        "发货方式", "七天无理由", "品牌ID", "状态"
    ]
    ws.append(headers)
    for idx, g in enumerate(goods_list):
        wg = wechat_goods[idx]
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
            g.get("goods_id", ""),
            wg.get("title", ""),
            g.get("price", 0),
            _yuan_to_fen(g.get("price", 0)),
            len(g.get("main_images", []) or []),
            len(g.get("detail_images", []) or []),
            len(wg.get("skus", [])),
            specs_str,
            attrs_str,
            "快递发货" if wg.get("deliver_method") == 0 else "无需快递",
            "是" if wg.get("extra_service", {}).get("seven_day_return") == 1 else "否",
            wg.get("brand_id", ""),
            "待配置类目" if not wg.get("cats") else "就绪",
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
    readme_lines = [
        "微信小店数据包 - 使用说明",
        "=" * 50,
        "",
        "导出时间: " + timestamp,
        "商品数量: " + str(len(goods_list)),
        "",
        "=" * 50,
        "文件说明:",
        "=" * 50,
        "",
        "1. wechat_goods.json",
        "   符合微信小店 addproduct API 格式的商品数据。",
        "   可用于调用微信小店 API 批量添加商品。",
        "",
        "2. 商品对照表.xlsx",
        "   便于人工核对的商品信息表格。",
        "   状态列为\"待配置类目\"的商品需要手动选择类目。",
        "",
        "3. 图片/  文件夹",
        "   按商品分组的图片文件夹（主图、详情图、SKU图）。",
        "   需要手动上传到微信小店后台，获取微信图片URL后",
        "   替换 wechat_goods.json 中的 head_imgs 和 desc_info.imgs。",
        "",
        "=" * 50,
        "使用步骤:",
        "=" * 50,
        "",
        "1. 打开\"商品对照表.xlsx\"核对商品信息",
        "2. 对于\"状态\"为\"待配置类目\"的商品，需要在微信小店后台",
        "   确定目标类目（一/二/三级），填入 wechat_goods.json 的 cats 字段",
        "3. 将\"图片\"文件夹中的图片上传到微信小店后台",
        "4. 用上传后获取的微信图片URL替换 JSON 中的图片地址",
        "5. 调用微信小店 API (addproduct) 批量添加商品",
        "6. 添加成功后调用上架接口提交审核",
        "",
        "=" * 50,
        "注意事项:",
        "=" * 50,
        "",
        "- head_imgs 最少 3 张（食品饮料和生鲜最少 4 张），最多 9 张",
        "- title 至少 5 个有效字符，最多 60 字符",
        "- sale_price 单位为\"分\"（已自动转换）",
        "- cats 必须恰好 3 个元素（一/二/三级类目ID）",
        "- 图片必须上传到微信服务器，不接受外部URL",
        "- 添加商品后需调用上架接口并审核通过才正式生效",
    ]
    readme = "\n".join(readme_lines)

    # 打包 ZIP
    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        json_content = json.dumps({
            "goods_list": wechat_goods,
            "config": {
                "export_time": timestamp,
                "total_goods": len(wechat_goods),
                "defaults": cfg,
                "note": "图片需要手动上传到微信小店后台，head_imgs字段需要替换为上传后的微信URL。cats字段需要手动填写类目ID。",
            }
        }, ensure_ascii=False, indent=2)
        zf.writestr("wechat_goods.json", json_content.encode("utf-8"))

        xlsx_buffer = io.BytesIO()
        wb.save(xlsx_buffer)
        zf.writestr("商品对照表.xlsx", xlsx_buffer.getvalue())

        zf.writestr("使用说明.txt", readme.encode("utf-8-sig"))

        for arcname, data in img_results.items():
            zf.writestr(arcname, data)

    downloaded = len(img_results)
    failed = total_imgs - downloaded
    print("")
    print("微信小店数据包导出完成: " + str(zip_path))
    print("  商品: " + str(len(goods_list)) + " 个")
    print("  图片: " + str(downloaded) + " 成功, " + str(failed) + " 失败")
    return zip_path
