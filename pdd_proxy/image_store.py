"""Bounded image downloads with public-IP pinning, TLS checks and shared caching."""

import hashlib
import http.client
import ipaddress
import math
import socket
import ssl
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit, urljoin

from paths import DATA_DIR, data_path

MAX_IMAGE_BYTES = 20 * 1024 * 1024
PDD_IMAGE_HOSTS = ("pddpic.com", "yangkeduo.com")
_slots = threading.BoundedSemaphore(2)
_locks = [threading.Lock() for _ in range(64)]
_host_lock = threading.Lock()
_next_request = {}
_cooldown = {}
CACHE_DIR = DATA_DIR / "image_cache"


class ImageFetchError(ValueError):
    def __init__(self, message, status=None, retry_after=0, code=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.code = code


def is_pdd_image(url: str) -> bool:
    try:
        u = urlsplit(url)
        return (u.scheme in {"http", "https"} and not u.username and not u.password
                and any(u.hostname == h or (u.hostname or "").endswith("." + h) for h in PDD_IMAGE_HOSTS))
    except ValueError:
        return False


def image_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    raise ImageFetchError("返回内容不是支持的图片")


def retry_after_seconds(value) -> float:
    try:
        seconds = float(value)
        if not math.isfinite(seconds):
            raise ValueError('Non-finite Retry-After')
        return max(0, seconds)
    except (ValueError, TypeError):
        try:
            dt = parsedate_to_datetime(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0, (dt - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 60


def _public_target(url: str):
    try:
        u = urlsplit(url)
        port = u.port or (443 if u.scheme == "https" else 80)
        if (u.scheme not in {"http", "https"} or not u.hostname or u.username or u.password
                or port not in {80, 443} or any(ord(c) < 32 for c in url)):
            raise ImageFetchError("仅支持公共 HTTP/HTTPS 图片地址")
        addresses = socket.getaddrinfo(u.hostname, port, type=socket.SOCK_STREAM)
        ips = list(dict.fromkeys(a[4][0] for a in addresses))
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ImageFetchError("不允许访问本机、内网或保留地址")
        return u, port, ips[0]
    except (ValueError, socket.gaierror) as exc:
        raise ImageFetchError("图片地址无效或无法解析") from exc


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, port, ip):
        super().__init__(host, port, timeout=15, context=ssl.create_default_context())
        self.public_ip = ip

    def connect(self):
        sock = socket.create_connection((self.public_ip, self.port), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host, port, ip):
        super().__init__(host, port, timeout=15)
        self.public_ip = ip

    def connect(self):
        self.sock = socket.create_connection((self.public_ip, self.port), timeout=self.timeout)


def _connection(u, port, ip):
    return (_PinnedHTTPS if u.scheme == "https" else _PinnedHTTP)(u.hostname, port, ip)


def _fetch(url, pdd_only=False):
    for _ in range(4):
        if is_pdd_image(url):
            from capture_state import get_capture_state
            state = get_capture_state()
            if not state["enabled"] and state["reason"] != "用户暂停":
                raise ImageFetchError("采集访问受限，已停止拼多多图片下载", code='capture_paused')
        if pdd_only and not is_pdd_image(url):
            raise ImageFetchError("图片重定向到未允许的域名")
        u, port, ip = _public_target(url)
        with _host_lock:
            now = time.monotonic()
            if _cooldown.get(u.hostname, 0) > now:
                raise ImageFetchError("图片主机处于冷却期", retry_after=_cooldown[u.hostname] - now, code='image_cooldown')
            delay = max(0, _next_request.get(u.hostname, 0) - now)
            _next_request[u.hostname] = now + delay + 0.5
        if delay:
            time.sleep(delay)
        conn = _connection(u, port, ip)
        try:
            headers = {"User-Agent": "PDD-Parser/1.4", "Accept": "image/png,image/jpeg,image/webp,image/gif"}
            if is_pdd_image(url):
                headers["Referer"] = "https://mobile.yangkeduo.com/"
            conn.request("GET", (u.path or "/") + ("?" + u.query if u.query else ""), headers=headers)
            response = conn.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                target = response.getheader("Location")
                if not target:
                    raise ImageFetchError("图片重定向缺少地址")
                url = urljoin(url, target)
                continue
            if response.status in {401, 403, 429}:
                seconds = max(60, retry_after_seconds(response.getheader("Retry-After")))
                with _host_lock:
                    _cooldown[u.hostname] = time.monotonic() + seconds
                raise ImageFetchError(f"图片访问受限（HTTP {response.status}），已暂停该主机下载", response.status, seconds)
            if response.status != 200:
                raise ImageFetchError(f"图片请求失败（HTTP {response.status}）", response.status)
            length = response.getheader("Content-Length")
            if length and int(length) > MAX_IMAGE_BYTES:
                raise ImageFetchError("图片超过20MB限制")
            chunks, size = [], 0
            deadline = time.monotonic() + 45
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_IMAGE_BYTES or time.monotonic() > deadline:
                    raise ImageFetchError("图片大小或下载时间超过限制")
                chunks.append(chunk)
            data = b"".join(chunks)
            return data, image_type(data)
        finally:
            conn.close()
    raise ImageFetchError("图片重定向次数过多")


def read_image(url: str, *, pdd_only=False) -> tuple[bytes, str]:
    try:
        return _read_image(url, pdd_only=pdd_only)
    except (ValueError, OSError, TimeoutError) as error:
        from diagnostics import record
        status = getattr(error, 'status', None)
        code = getattr(error, 'code', None) or ('rate_limited' if status == 429 else 'access_denied' if status in {401, 403} else 'image_failed')
        record(code, 'image', source_url=url, http_status=status, retry_after=getattr(error, 'retry_after', 0))
        raise


def _read_image(url: str, *, pdd_only=False) -> tuple[bytes, str]:
    if not isinstance(url, str) or len(url) > 8000:
        raise ImageFetchError("图片地址格式错误")
    for prefix, roots in (("/api/ai-image/", ("ai_images", "ai_uploads")), ("/api/local-image/", ("images",))):
        if url.startswith(prefix) and not pdd_only:
            relative = url[len(prefix):]
            if roots == ("images",):
                relative = "images/" + relative
            path = data_path(relative, roots)
            if not path.is_file() or path.stat().st_size > MAX_IMAGE_BYTES:
                raise ImageFetchError("本地图片不存在或过大")
            data = path.read_bytes()
            return data, image_type(data)
    if pdd_only and not is_pdd_image(url):
        raise ImageFetchError("不支持的拼多多图片地址")
    key = hashlib.sha256(url.encode()).hexdigest()
    with _locks[int(key[:2], 16) % len(_locks)]:
        path = CACHE_DIR / (key + ".img")
        if path.is_file() and path.stat().st_size <= MAX_IMAGE_BYTES:
            data = path.read_bytes()
            try:
                return data, image_type(data)
            except ImageFetchError:
                path.unlink(missing_ok=True)
        with _slots:
            data, content_type = _fetch(url, pdd_only)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        return data, content_type
