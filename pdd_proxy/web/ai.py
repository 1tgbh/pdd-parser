"""AI 服务模块 - grsai 图片生成/编辑 + 小米文本改写"""

import json
import os
import time
import re
import requests
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_PATH = DATA_DIR / "config.json"
IMAGES_DIR = DATA_DIR / "ai_images"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_config(cfg: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ============ grsai 图片生成 (SSE 流式) ============

PRESET_PROMPTS = {
    "white_bg": "Remove the background and replace with pure white background. Keep the product clear and centered. E-commerce main image style.",
    "scene": "Place this product on a beautiful lifestyle scene, such as a wooden table or marble countertop with natural soft lighting. Product photography style.",
    "poster": "Create a beautiful marketing poster with this product as the main subject. Add elegant background, decorative elements and soft lighting.",
    "remove_watermark": "Remove all watermarks, text overlays, promotional labels and stickers from this image. Keep the product image clean and clear.",
    "style_cartoon": "Convert this product image to a cute cartoon illustration style while keeping the product features recognizable.",
}


def _parse_sse_events(raw_text: str) -> list:
    """解析 SSE 流式响应，提取所有 data 事件"""
    events = []
    for line in raw_text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            data_str = line[5:].strip()
            if data_str:
                try:
                    events.append(json.loads(data_str))
                except json.JSONDecodeError:
                    pass
    return events


def _call_grsai(prompt: str, image_url: str = None, size: str = "1024x1024") -> dict:
    """调用 grsai API 生成图片，返回最终结果"""
    cfg = load_config().get("image_api", {})
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "https://grsai.dakka.com.cn").rstrip("/")
    model = cfg.get("model", "gpt-image-2")

    if not api_key:
        return {"error": "未配置图片 API Key，请在【设置】页面配置"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    body = {
        "model": model,
        "prompt": prompt,
        "aspectRatio": size,
    }

    # 如果有参考图，用 urls 参数传入（支持多张）
    if image_url:
        body["urls"] = [image_url]

    url = f"{base_url}/v1/draw/completions"

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=120, stream=True, verify=False)
        if resp.status_code != 200:
            return {"error": f"API 请求失败 (HTTP {resp.status_code}): {resp.text[:200]}"}

        # 读取 SSE 流
        full_text = resp.text
        events = _parse_sse_events(full_text)

        if not events:
            return {"error": "API 返回数据为空，请检查 API Key 和模型配置"}

        # 取最后一个事件（最终结果）
        final = events[-1]

        if final.get("status") == "succeeded" and final.get("results"):
            urls = [r["url"] for r in final["results"] if r.get("url")]
            return {"urls": urls, "task_id": final.get("id", "")}

        if final.get("status") == "failed" or final.get("error"):
            return {"error": f"生成失败: {final.get('error') or final.get('failure_reason', '未知错误')}"}

        # 如果流式结束但没成功
        return {"error": f"生成未完成，状态: {final.get('status', '未知')}"}

    except requests.exceptions.Timeout:
        return {"error": "请求超时（120秒），图片生成时间较长，请稍后重试"}
    except requests.exceptions.ConnectionError:
        return {"error": f"无法连接到 {base_url}，请检查网络或代理设置"}
    except Exception as e:
        return {"error": f"请求异常: {str(e)}"}


def _download_and_save(url: str, goods_id: str, prefix: str = "ai") -> str | None:
    """下载图片并保存到本地，返回相对路径"""
    try:
        resp = requests.get(url, timeout=30, verify=False)
        if resp.status_code != 200:
            return None

        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        goods_dir = IMAGES_DIR / goods_id
        goods_dir.mkdir(parents=True, exist_ok=True)

        ts = int(time.time() * 1000)
        filename = f"{prefix}_{ts}.png"
        filepath = goods_dir / filename
        filepath.write_bytes(resp.content)

        return str(filepath.relative_to(DATA_DIR))
    except Exception:
        return None


def generate_image(prompt: str, goods_id: str, size: str = "1024x1024") -> dict:
    """文生图"""
    result = _call_grsai(prompt, size=size)
    if "error" in result:
        return result

    # 下载并保存
    saved = []
    for url in result.get("urls", []):
        path = _download_and_save(url, goods_id, "gen")
        if path:
            saved.append(path)

    if not saved:
        return {"error": "图片生成成功但下载失败，请重试"}

    return {"paths": saved, "prompt": prompt}


def edit_image(image_url: str, prompt: str, goods_id: str) -> dict:
    """图片编辑（基于原图 + 提示词）"""
    # 直接用用户提示词，grsai 会自动参考 urls 中的图片
    result = _call_grsai(prompt, image_url=image_url)
    if "error" in result:
        return result

    saved = []
    for url in result.get("urls", []):
        path = _download_and_save(url, goods_id, "edit")
        if path:
            saved.append(path)

    if not saved:
        return {"error": "图片编辑成功但下载失败，请重试"}

    return {"paths": saved, "prompt": prompt}


# ============ 小米文本改写 ============

REWRITE_SYSTEM = """你是专业电商文案专家。改写商品信息用于不同平台上架。
要求：保留核心卖点，避免与原文重复，语言自然流畅，标题30字以内。
返回纯JSON格式，只包含要求改写的字段。"""

REWRITE_STYLES = {
    "default": "改写以下商品信息，保持专业电商风格",
    "taobao": "改写为适合淘宝/天猫的风格，注意标题字数限制",
    "douyin": "改写为适合抖音电商的风格，语言活泼有吸引力",
    "pdd": "改写为适合拼多多的风格，突出性价比",
}


def rewrite_text(goods_info: dict, targets: list = None, style: str = "default", custom_prompt: str = None) -> dict:
    """改写商品文案"""
    cfg = load_config().get("text_api", {})
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "https://token-plan-cn.xiaomimimo.com/v1").rstrip("/")
    model = cfg.get("model", "mimo-v2.5")

    if not api_key:
        return {"error": "未配置文本 API Key，请在【设置】页面配置"}

    if targets is None:
        targets = ["title", "subtitle", "selling_points", "description"]

    instruction = custom_prompt or REWRITE_STYLES.get(style, REWRITE_STYLES["default"])

    user_parts = [instruction, ""]
    for field in targets:
        val = goods_info.get(field, "")
        if isinstance(val, list):
            val = "、".join(val)
        if val:
            user_parts.append(f"【{field}】{val}")

    user_parts.append("")
    user_parts.append(f"请返回JSON，字段：{json.dumps(targets, ensure_ascii=False)}")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": REWRITE_SYSTEM},
            {"role": "user", "content": "\n".join(user_parts)},
        ],
        "temperature": 0.8,
        "max_tokens": 1000,
    }

    try:
        resp = requests.post(f"{base_url}/chat/completions", headers=headers, json=body, timeout=60, verify=False)
        if resp.status_code != 200:
            return {"error": f"文本 API 错误 (HTTP {resp.status_code}): {resp.text[:200]}"}
        content = resp.json()["choices"][0]["message"]["content"]
    except requests.exceptions.ConnectionError:
        return {"error": f"无法连接到文本 API ({base_url})，请检查网络"}
    except Exception as e:
        return {"error": f"请求失败: {str(e)}"}

    # 解析 JSON
    try:
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        result = json.loads(content.strip())
        return {"result": result}
    except json.JSONDecodeError:
        return {"result": {"text": content}}



