"""One bounded export worker shared by all clients; duplicate active jobs coalesce."""

import hashlib
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="export")
_lock = threading.Lock()
_jobs = {}


def submit_export(kind, payload, run):
    key = hashlib.sha256((kind + json.dumps(payload, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()
    with _lock:
        now = time.monotonic()
        for jid, job in list(_jobs.items()):
            if job["status"] in {"completed", "failed"} and now - job.get("finished", job["created"]) > 3600:
                del _jobs[jid]
        for job in _jobs.values():
            if job["key"] == key and job["status"] in {"queued", "running"}:
                return public_job(job)
        if sum(j["status"] in {"queued", "running"} for j in _jobs.values()) >= 10:
            raise ValueError("导出队列已满，请等待现有任务完成")
        job = {"job_id": uuid.uuid4().hex, "key": key, "status": "queued", "created": now}
        _jobs[job["job_id"]] = job
    _worker.submit(_run, job, run, payload)
    return public_job(job)


def _run(job, run, payload):
    with _lock:
        job["status"] = "running"
    try:
        path = run(payload)
        if not path or not Path(path).is_file():
            raise ValueError("未生成导出文件")
        with _lock:
            job.update(status="completed", path=str(path), filename=Path(path).name, finished=time.monotonic())
    except Exception as exc:
        with _lock:
            job.update(status="failed", error=str(exc), finished=time.monotonic())
        from diagnostics import record
        record("export_failed", "export", event_id="export-" + job["job_id"])


def public_job(job):
    return {k: job[k] for k in ("job_id", "status", "filename", "error") if k in job}


def get_export_job(job_id):
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
