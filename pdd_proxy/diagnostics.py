"""Bounded, idempotent diagnostic events with fixed messages and no raw credentials."""

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timedelta

from paths import DB_PATH
from normalization import safe_source_url, valid_goods_id
from provenance import version, FIELDS

logger = logging.getLogger(__name__)
CODES = {
    "auth_required": ("需要登录或授权", "请在对应来源确认登录或授权后恢复。"),
    "verification_required": ("需要人工验证", "相关源侧操作已暂停，人工检查后明确恢复。"),
    "access_denied": ("访问被拒绝", "检查来源权限和平台提示，此记录不等于账号被封。"),
    "rate_limited": ("请求频率受限", "停止重复请求并遵守冷却时间。"),
    "data_incomplete": ("商品字段不完整", "检查缺失字段或补充本地导入，不据此判断账号状态。"),
    "structure_changed": ("页面结构暂不支持", "等待页面加载完成或使用本地导入，保留已保存的数据。"),
    "page_changed": ("目标页面已切换", "请在目标商品页重新读取并确认。"),
    "preview_expired": ("预览已过期", "重新读取当前商品，过期预览不会入库。"),
    "capture_paused": ("采集保存已暂停", "人工检查后明确恢复，待传数据会保留。"),
    "sync_unavailable": ("本地服务未连接", "启动或重启后端，仅重传已确认的本地数据。"),
    "sync_failed": ("本地同步失败", "检查后端和字段格式，仅恢复同步阶段。"),
    "queue_full": ("待传队列已满", "先同步或清理已有待传数据。"),
    "validation_failed": ("字段格式错误", "修正本地输入，此错误不代表平台账号异常。"),
    "image_failed": ("图片读取失败", "使用已有缓存或上传图片，仅恢复图片阶段。"),
    "image_cooldown": ("图片主机处于本地冷却期", "使用已有缓存或等待冷却结束，本次没有向源站发出图片请求。"),
    "export_failed": ("导出任务失败", "检查本地数据和任务记录，不重新采集源商品。"),
    "import_failed": ("数据导入失败", "检查本地文件格式和列映射。"),
    "edit_failed": ("本地编辑失败", "检查商品是否存在和输入格式，不需要重新访问源商品。"),
}
STAGES = {"page_read", "preview", "sync", "image", "export", "import", "edit"}


def init_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS diagnostics (
            id TEXT PRIMARY KEY, code TEXT NOT NULL, stage TEXT NOT NULL,
            severity TEXT NOT NULL, occurred_at TEXT NOT NULL, goods_id TEXT DEFAULT '',
            source_url TEXT DEFAULT '', http_status INTEGER, retry_at TEXT,
            parser_version TEXT DEFAULT 'unknown', acknowledged INTEGER DEFAULT 0, missing_fields TEXT DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_diagnostic_time ON diagnostics(occurred_at);
    """)
    try:
        conn.execute("ALTER TABLE diagnostics ADD COLUMN missing_fields TEXT DEFAULT '[]'")
    except sqlite3.OperationalError as error:
        if 'duplicate column' not in str(error).lower():
            raise


def _stamp(value, *, future=False):
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        stamp = stamp.astimezone().replace(tzinfo=None) if stamp.tzinfo else stamp
        if not future and stamp > datetime.now() + timedelta(minutes=5):
            raise ValueError("诊断时间超出范围")
        return stamp.isoformat()
    except (ValueError, TypeError):
        raise ValueError("诊断时间格式错误")


def validate(event):
    if not isinstance(event, dict) or not isinstance(event.get("code"), str) or event["code"] not in CODES or not isinstance(event.get("stage"), str) or event["stage"] not in STAGES:
        raise ValueError("诊断类别或阶段无效")
    identifier = str(event.get("id") or uuid.uuid4().hex)
    if len(identifier) > 128 or not all(c.isalnum() or c in "-_" for c in identifier):
        raise ValueError("诊断ID无效")
    gid = valid_goods_id(event["goods_id"]) if event.get("goods_id") else ""
    http_status = event.get("http_status")
    if http_status is not None and (not isinstance(http_status, int) or not 100 <= http_status <= 599):
        raise ValueError("HTTP状态码无效")
    missing = event.get("missing_fields") or []
    if not isinstance(missing, list) or len(missing) > 30 or any(not isinstance(field, str) or field not in FIELDS for field in missing):
        raise ValueError("缺失字段记录无效")
    return {"id": identifier, "code": event["code"], "stage": event["stage"],
            "severity": "warning" if event["code"] == "data_incomplete" else "error",
            "occurred_at": _stamp(event.get("occurred_at") or datetime.now().isoformat()),
            "goods_id": gid, "source_url": safe_source_url(event.get("source_url")), "http_status": http_status,
            "retry_at": _stamp(event["retry_at"], future=True) if event.get("retry_at") else None, "parser_version": version(event.get("parser_version")),
            "missing_fields": json.dumps(sorted(set(missing)))}


def write_events(conn, events):
    validated = [validate(event) for event in events]
    fields = ("id", "code", "stage", "severity", "occurred_at", "goods_id", "source_url", "http_status", "retry_at", "parser_version", "missing_fields")
    conn.executemany(f"INSERT OR IGNORE INTO diagnostics ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})", [tuple(e[k] for k in fields) for e in validated])
    conn.execute("DELETE FROM diagnostics WHERE id IN (SELECT id FROM diagnostics ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET 500)")


def record(code, stage, *, goods_id="", source_url="", http_status=None, retry_after=0, parser_version="unknown", event_id=None):
    """Diagnostics must never replace the original operation's outcome."""
    conn = None
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=2)
        init_schema(conn)
        retry_at = (datetime.now() + timedelta(seconds=max(0, min(float(retry_after), 31_536_000)))).isoformat() if retry_after else None
        write_events(conn, [{"id": event_id, "code": code, "stage": stage, "goods_id": goods_id, "source_url": source_url,
                             "http_status": http_status, "retry_at": retry_at, "parser_version": parser_version}])
        conn.commit()
    except Exception:
        logger.debug("Diagnostic record could not be saved", exc_info=True)
    finally:
        if conn:
            conn.close()


def public(row):
    item = dict(row)
    item["message"], item["hint"] = CODES[item["code"]]
    item["acknowledged"] = bool(item["acknowledged"])
    item["missing_fields"] = json.loads(item["missing_fields"] or "[]")
    return item
