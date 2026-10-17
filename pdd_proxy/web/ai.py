"""AI 服务模块 - grsai 图片生成/编辑 + 小米文本改写"""

import json
import os
import time
import re
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

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
    "white_bg": "白底商品主图",
    "scene": "产品场景摄影",
    "poster": "商品宣传海报",
    "remove_watermark": "去除图片水印",
    "style_cartoon": "卡通插画风格",
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


def _fetch_image_as_data_url(image_url: str) -> str | None:
    """下载图片并转为 base64 data URL，失败返回 None"""
    import base64
    try:
        full_url = image_url
        if image_url.startswith("/"):
            full_url = f"http://127.0.0.1:5000{image_url}"
        resp = requests.get(full_url, timeout=30, headers={"Referer": "https://mobile.yangkeduo.com/"}, verify=False)
        if resp.status_code != 200:
            return None
        ct = resp.headers.get("content-type", "image/jpeg")
        if "jpeg" in ct or "jpg" in ct:
            ct = "image/jpeg"
        elif "png" in ct:
            ct = "image/png"
        elif "webp" in ct:
            ct = "image/webp"
        else:
            ct = "image/jpeg"
        b64 = base64.b64encode(resp.content).decode()
        return f"data:{ct};base64,{b64}"
    except Exception:
        return None


def _call_grsai(prompt: str, image_url: str = None, size: str = "1024x1024") -> dict:
    """调用 grsai API 生成图片，逐行读取 SSE 流式响应"""
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

    if image_url:
        image_data_url = _fetch_image_as_data_url(image_url)
        if image_data_url:
            body["urls"] = [image_data_url]
        else:
            body["urls"] = [image_url]

    url = f"{base_url}/v1/draw/completions"

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=120, stream=True, verify=False)
        if resp.status_code != 200:
            return {"error": f"API 请求失败 (HTTP {resp.status_code}): {resp.text[:200]}"}

        final = None
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            line = line.strip()
            if line.startswith("data:"):
                data_str = line[5:].strip()
                if data_str:
                    try:
                        evt = json.loads(data_str)
                        final = evt
                        if evt.get("status") == "succeeded" and evt.get("results"):
                            resp.close()
                            break
                        if evt.get("status") == "failed":
                            resp.close()
                            break
                    except json.JSONDecodeError:
                        pass

        if not final:
            return {"error": "API 返回数据为空，请检查 API Key 和模型配置"}

        if final.get("status") == "succeeded" and final.get("results"):
            urls = [r["url"] for r in final["results"] if r.get("url")]
            return {"urls": urls, "task_id": final.get("id", "")}

        if final.get("status") == "failed" or final.get("error"):
            return {"error": f"生成失败: {final.get('error') or final.get('failure_reason', '未知错误')}"}

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

        return filepath.relative_to(DATA_DIR).as_posix()
    except Exception:
        return None


_executor = ThreadPoolExecutor(max_workers=2)


def _save_image_bg(url: str, goods_id: str, prefix: str):
    """后台下载保存图片到本地"""
    import sqlite3 as _sqlite3
    try:
        path = _download_and_save(url, goods_id, prefix)
        if path:
            db_path = DATA_DIR / "goods.db"
            conn = _sqlite3.connect(str(db_path))
            conn.execute(
                "INSERT INTO ai_images (goods_id, result_path, model) VALUES (?, ?, ?)",
                (goods_id, path, load_config().get("image_api", {}).get("model", ""))
            )
            conn.commit()
            conn.close()
    except Exception:
        pass


def generate_image(prompt: str, goods_id: str, size: str = "1024x1024") -> dict:
    """文生图 — 直接返回 API URL，后台下载到本地"""
    result = _call_grsai(prompt, size=size)
    if "error" in result:
        return result

    urls = result.get("urls", [])
    if not urls:
        return {"error": "图片生成成功但未返回图片URL"}

    for url in urls:
        _executor.submit(_save_image_bg, url, goods_id, "gen")

    return {"urls": urls, "prompt": prompt}


def edit_image(image_url: str, prompt: str, goods_id: str, size: str = "1024x1024") -> dict:
    """图片编辑 — 直接返回 API URL，后台下载到本地"""
    result = _call_grsai(prompt, image_url=image_url, size=size)
    if "error" in result:
        return result

    urls = result.get("urls", [])
    if not urls:
        return {"error": "图片编辑成功但未返回图片URL"}

    for url in urls:
        _executor.submit(_save_image_bg, url, goods_id, "edit")

    return {"urls": urls, "prompt": prompt}


def remove_background(image_url: str) -> str:
    """Remove background from image using grsai API."""
    import requests
    cfg = load_config().get("image_api", {})
    api_key = cfg.get("api_key", "")
    # 与 _call_grsai 保持同一组配置；base_url 统一为不含 /v1 的主机地址
    base_url = (cfg.get("base_url") or "https://api.grsai.ai").rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]

    if not api_key:
        raise ValueError("未配置 AI API Key，请在设置中添加")

    full_url = image_url
    headers = {}
    if image_url.startswith("/"):
        full_url = f"http://127.0.0.1:5000{image_url}"
    elif "pddpic.com" in image_url or "yangkeduo.com" in image_url:
        headers["Referer"] = "https://mobile.yangkeduo.com/"
    img_resp = requests.get(full_url, headers=headers, timeout=30, verify=False)
    img_resp.raise_for_status()

    import base64, io
    from PIL import Image
    img = Image.open(io.BytesIO(img_resp.content))
    if img.mode == 'RGBA':
        img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=95)
    img_b64 = base64.b64encode(buf.getvalue()).decode()

    url = f"{base_url}/v1/images/edits"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": "gpt-image-1",
        "prompt": "Remove the background, keep only the main subject on transparent background",
        "image": f"data:image/jpeg;base64,{img_b64}",
        "n": 1,
        "size": "1024x1024",
    }

    resp = requests.post(url, headers=headers, json=body, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    images = []
    if "data" in data:
        for item in data["data"]:
            if "b64_json" in item:
                import base64 as b64
                img_bytes = b64.b64decode(item["b64_json"])
                images.append(("base64", img_bytes))
            elif "url" in item:
                images.append(("url", item["url"]))

    if not images:
        raise ValueError("AI 未返回图片")

    from pathlib import Path
    out_dir = Path(__file__).parent.parent / "data" / "ai_images"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)

    kind, payload = images[0]
    out_path = out_dir / f"bg_{ts}.png"
    if kind == "base64":
        out_path.write_bytes(payload)
    else:
        r = requests.get(payload, timeout=30)
        out_path.write_bytes(r.content)

    return f"/api/ai-image/ai_images/{out_path.name}"


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


def generate_copywriting(goods_info: dict, copy_type: str = "all", style: str = "default", custom_prompt: str = None) -> dict:
    cfg = load_config().get("text_api", {})
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "")
    model = cfg.get("model", "")
    if not api_key or not base_url:
        return {"error": "未配置文本 API，请在设置中配置"}

    styles = {
        "default": "用专业电商风格",
        "taobao": "用适合淘宝/天猫的风格，注意标题30字以内",
        "douyin": "用适合抖音电商的风格，语言活泼有吸引力",
        "pdd": "用适合拼多多的风格，突出性价比",
    }
    style_text = styles.get(style, styles["default"])

    goods_text = f"【标题】{goods_info.get('title', '')}\n"
    goods_text += f"【副标题】{goods_info.get('subtitle', '')}\n"
    sps = goods_info.get("selling_points", [])
    if isinstance(sps, list):
        goods_text += f"【卖点】{', '.join(sps)}\n"
    goods_text += f"【商品描述】{goods_info.get('description', '')[:500]}\n"
    attrs = goods_info.get("attributes", {})
    if attrs:
        goods_text += f"【属性】{json.dumps(attrs, ensure_ascii=False)[:300]}\n"

    type_instructions = {
        "title": "只生成标题，返回JSON: {\"title\": \"...\", \"subtitle\": \"...\"}",
        "selling_points": "只生成卖点，返回JSON: {\"selling_points\": [\"卖点1\", \"卖点2\", \"卖点3\", \"卖点4\", \"卖点5\"]}",
        "description": "只生成商品详情文案，返回JSON: {\"description\": \"...\"}",
        "all": "生成标题、副标题、卖点和详情，返回JSON: {\"title\": \"...\", \"subtitle\": \"...\", \"selling_points\": [...], \"description\": \"...\"}",
    }

    user_msg = f"商品信息:\n{goods_text}\n{style_text}。{type_instructions.get(copy_type, type_instructions['all'])}"
    if custom_prompt:
        user_msg += f"\n额外要求: {custom_prompt}"
    user_msg += "\n只返回纯JSON，不要任何其他文字。"

    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "你是电商文案专家，擅长撰写吸引人的商品文案。"},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.7,
                "max_tokens": 2000,
            },
            timeout=60,
            verify=False,
        )
    except requests.exceptions.ConnectionError:
        return {"error": f"无法连接到文本 API ({base_url})，请检查网络"}
    except Exception as e:
        return {"error": f"请求失败: {str(e)}"}

    if resp.status_code != 200:
        return {"error": f"API 请求失败: HTTP {resp.status_code}"}

    content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\n?", "", content)
        content = re.sub(r"\n?```$", "", content)

    try:
        result = json.loads(content)
        return result
    except json.JSONDecodeError:
        return {"error": "AI 返回格式异常", "raw": content}


# ============ AI 提示词生成（多模态） ============

def suggest_prompt(image_url: str) -> dict:
    """根据商品图片生成 AI 生图提示词"""
    cfg = load_config().get("text_api", {})
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "").rstrip("/")
    model = cfg.get("model", "")

    if not api_key or not base_url:
        return {"error": "请先在设置中配置文本模型 API"}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    is_external = "pddpic.com" in image_url or "yangkeduo.com" in image_url
    if is_external:
        image_input = image_url
    else:
        data_url = _fetch_image_as_data_url(image_url)
        if not data_url:
            return {"error": "无法读取图片，请检查图片路径"}
        image_input = data_url

    describe_body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "用一句话描述这张商品图片中的商品是什么，包括类型、颜色、材质。例如：浅棕色真皮斜挎包、白色陶瓷咖啡杯带木盖。只输出商品描述，不要其他内容。"},
                    {"type": "image_url", "image_url": {"url": image_input}},
                ],
            }
        ],
        "max_tokens": 2000,
    }

    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=describe_body,
            timeout=60,
            verify=False,
        )
        if resp.status_code != 200:
            return {"error": f"图片理解失败: {resp.text[:200]}"}
        data = resp.json()
        msg = data.get("choices", [{}])[0].get("message", {})
        description = msg.get("content", "") or msg.get("reasoning_content", "")
        if not description:
            return {"error": "模型未能理解图片内容"}
    except Exception as e:
        return {"error": f"图片理解请求失败: {str(e)}"}

    prompt_body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是电商商品 AI 生图提示词专家。根据商品图片描述，生成一段简洁的中文提示词。\n\n"
                    "核心规则：\n"
                    "- 提示词控制在 30-80 字，越简洁越好\n"
                    "- 语序权重：主体商品 > 背景场景 > 光线 > 风格 > 约束\n"
                    "- 第一句必须写清楚是什么商品（如：白色陶瓷马克杯、真皮手提包）\n"
                    "- 背景用简洁描述（白底、浅灰渐变背景、原木桌面）\n"
                    "- 光线用具体词（柔光棚拍、自然光、侧逆光）\n"
                    "- 风格用成熟关键词（商业产品摄影、极简 ins 风、日系清新）\n"
                    "- 末尾加约束：无文字、无水印、无杂物\n"
                    "- 不要用逗号分隔的关键词堆砌，用自然流畅的中文短句\n\n"
                    "好的示例：\n"
                    "白色陶瓷马克杯，摆放在原木桌面上，浅米色背景，柔光棚拍，极简风格，无文字无水印\n"
                    "真皮手提包正面展示，白色背景，柔和阴影，商业产品摄影，高清细节，无杂物"
                ),
            },
            {"role": "user", "content": description},
        ],
        "max_tokens": 16000,
    }

    try:
        resp2 = requests.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=prompt_body,
            timeout=60,
            verify=False,
        )
        if resp2.status_code != 200:
            return {"error": f"提示词生成失败: {resp2.text[:200]}"}
        data2 = resp2.json()
        msg2 = data2.get("choices", [{}])[0].get("message", {})
        prompt = (msg2.get("content", "") or "").strip()
        prompt = re.sub(r"^```.*?\n?", "", prompt)
        prompt = re.sub(r"\n?```$", "", prompt)
        prompt = prompt.strip('"').strip("'").strip()
        if not prompt:
            return {"error": "提示词生成为空"}
        return {"prompt": prompt}
    except Exception as e:
        return {"error": f"提示词生成请求失败: {str(e)}"}



