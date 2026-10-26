"""Loopback API authentication and browser origin checks.

The extension receives a capture-only token. The management UI receives a separate
session token/cookie; neither token is embedded in third-party pages or URLs.
"""

import re
import secrets
from urllib.parse import urlsplit

from flask import jsonify, request

ADMIN_TOKEN = secrets.token_urlsafe(32)
CAPTURE_TOKEN = secrets.token_urlsafe(32)
CAPTURE_PATHS = {"/api/ingest", "/api/list-ingest", "/api/capture-toggle", "/api/capture-event", "/api/diagnostics/events"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
COOKIE = "pdd_local_session"


def origin_kind(origin: str) -> str | None:
    if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
        return "extension"
    try:
        url = urlsplit(origin)
        if (url.scheme in {"http", "https"} and url.hostname in LOCAL_HOSTS
                and not url.username and not url.password and not url.path
                and not url.query and not url.fragment
                and url.port in {3000, 5000}):
            return "local"
    except ValueError:
        pass
    return None


def install_security(app):
    app.config.update(MAX_CONTENT_LENGTH=20 * 1024 * 1024)

    @app.before_request
    def protect_local_api():
        try:
            host = urlsplit("http://" + request.host).hostname
        except ValueError:
            host = None
        if host not in LOCAL_HOSTS:
            return jsonify({"error": "invalid_host"}), 403
        if not request.path.startswith("/api/"):
            return None
        origin = request.headers.get("Origin", "")
        kind = origin_kind(origin) if origin else None
        if origin and kind is None:
            return jsonify({"error": "untrusted_origin"}), 403
        if request.headers.get("Sec-Fetch-Site") == "cross-site" and kind != "extension":
            return jsonify({"error": "cross_site_request"}), 403
        if request.method == "OPTIONS":
            return "", 204
        if request.path == "/api/session":
            # Browser pages cannot read this endpoint cross-origin. Native loopback
            # clients can bootstrap a session; DNS rebinding is rejected above.
            return None
        supplied = request.headers.get("X-PDD-Token", "")
        admin = bool(supplied) and secrets.compare_digest(supplied, ADMIN_TOKEN)
        cookie = request.cookies.get(COOKIE, "")
        admin = admin or (bool(cookie) and secrets.compare_digest(cookie, ADMIN_TOKEN))
        capture = bool(supplied) and secrets.compare_digest(supplied, CAPTURE_TOKEN)
        if not admin and not (capture and request.path in CAPTURE_PATHS):
            return jsonify({"error": "authentication_required"}), 401
        if kind == "extension" and request.path not in CAPTURE_PATHS:
            return jsonify({"error": "capture_scope_only"}), 403
        if request.is_json and not isinstance(request.get_json(), dict):
            return jsonify({"error": "JSON请求体必须是对象"}), 400
        request._pdd_authorized = True
        return None

    @app.after_request
    def local_headers(response):
        origin = request.headers.get("Origin", "")
        if origin_kind(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-PDD-Token"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/session")
    def session():
        extension = origin_kind(request.headers.get("Origin", "")) == "extension" or request.args.get("client") == "extension"
        response = jsonify({"token": CAPTURE_TOKEN if extension else ADMIN_TOKEN,
                            "scope": "capture" if extension else "admin"})
        if not extension:
            response.set_cookie(COOKIE, ADMIN_TOKEN, httponly=True, samesite="Strict", path="/api")
        return response
