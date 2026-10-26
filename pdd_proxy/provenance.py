"""Catalog field evidence, kept separate from edits and the latest source observation."""

import hashlib
import json
import math
import re
import sqlite3

FIELDS = ("goods_id", "title", "subtitle", "description", "price", "original_price", "min_group_price",
          "sales", "sold_quantity", "shop_name", "shop_id", "shop_logo", "main_images", "detail_images",
          "sku_images", "specs", "skus", "attributes", "selling_points")
SKU_FIELDS = ("price", "original_price", "stock", "specs", "image")
ORIGINS = {"page_state", "dom", "derived", "import", "manual", "unknown", "legacy", "provided"}


def version(value):
    return str(value) if re.fullmatch(r"[\w.\-]{1,40}", str(value or "")) else "unknown"


def sku_key(sku):
    from normalization import specs_dict
    return sku["sku_id"] or "specs-" + hashlib.sha256(json.dumps(specs_dict(sku["specs"]), sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]


def known(field, value):
    if field in {"price", "original_price", "min_group_price"}:
        return isinstance(value, (float, int)) and value > 0
    if field in {"stock", "sales", "sold_quantity"}:
        return value is not None
    return value not in (None, "", [], {})


def _raw(value, fallback, field):
    # Evidence is catalog-only. Never accept arbitrary nested raw page objects.
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and not math.isfinite(value):
            return fallback
        if field in {"price", "original_price", "min_group_price", "stock", "sales", "sold_quantity"} and isinstance(value, str):
            from normalization import money
            try:
                money(value)
            except ValueError:
                if field not in {'sales', 'sold_quantity'} or not re.fullmatch(r'[\d,.\s万亿件人+已拼售销月量]{1,50}', value) or not re.search(r'\d', value):
                    return fallback
        return value[:2000] if isinstance(value, str) else value
    if isinstance(value, list):
        if field in {'price', 'original_price', 'min_group_price'}:
            from normalization import money
            numeric = []
            for item in value[:1000]:
                if not isinstance(item, (str, int, float)):
                    continue
                try:
                    money(item)
                    numeric.append(item)
                except ValueError:
                    continue
            return numeric
        if field in {"main_images", "detail_images", "sku_images", "selling_points", "price", "original_price", "min_group_price"}:
            return [v[:2000] if isinstance(v, str) else v for v in value[:1000] if isinstance(v, (str, int, float)) and not (isinstance(v, float) and not math.isfinite(v))]
        if field == "specs":
            return [{"key": str(v.get("key", ""))[:100], "value": str(v.get("value", ""))[:500]} for v in value[:100] if isinstance(v, dict)]
    if isinstance(value, dict) and isinstance(fallback, dict) and field in {"specs", "attributes"}:
        return {key: fallback[key] for key in fallback if key in value}
    if field == "skus":
        return len(fallback) if isinstance(fallback, list) else fallback
    return fallback


def normalize_sources(raw, data, supplied_fields=None):
    raw = raw if isinstance(raw, dict) else {}
    supplied = raw.get("fields") if isinstance(raw.get("fields"), dict) else {}

    def clean(field, value, entry):
        entry = entry if isinstance(entry, dict) else {}
        origin = entry.get("origin")
        origin = origin if isinstance(origin, str) and origin in ORIGINS - {"manual", "legacy"} else ("import" if data["capture_source"] == "import" else "provided")
        status = entry.get("status")
        status = status if isinstance(status, str) and status in {"known", "unknown", "partial"} else ("known" if known(field, value) else "unknown")
        if field in {"price", "original_price", "min_group_price", "stock"} and not known(field, value):
            status = "unknown"
        if status == "unknown":
            origin = "unknown"
        source = entry.get("source_field", "normalized_payload." + field)
        source = source if isinstance(source, str) and re.fullmatch(r"[\w ,.():\[\]\-]{0,160}", source) else ""
        return {"origin": origin, "status": status, "source_field": source,
                "raw_value": _raw(entry.get("raw_value", value), value, field) if status != "unknown" else None}

    fields = {field: clean(field, data.get(field), supplied.get(field)) for field in FIELDS}
    if supplied_fields is not None:
        for field in FIELDS:
            if field not in supplied_fields:
                fields[field].update(origin='unknown', status='unknown', raw_value=None)
    sku_sources = raw.get("skus") if isinstance(raw.get("skus"), list) else []
    supplied_skus = raw.get("skus") if isinstance(raw.get("skus"), dict) else {}
    for item in sku_sources[:5000]:
        if isinstance(item, dict):
            supplied_skus[sku_key({"sku_id": str(item.get("sku_id") or "")[:128], "specs": item.get("specs") or []})] = item.get("fields") or {}
    skus = {}
    for sku in data["skus"]:
        key = sku_key(sku)
        meta = supplied_skus.get(key, {})
        skus[key] = {field: clean(field, sku.get(field), meta.get(field) if isinstance(meta, dict) else None) for field in SKU_FIELDS}
    return {"fields": fields, "skus": skus}


def observation(data, observed_at):
    sources = data.get("field_sources") or normalize_sources({}, data)

    def build(field, value, meta):
        return {**meta, "normalized_value": value, "observed_at": observed_at,
                "source_url": data.get("source_url", ""), "parser_version": version(data.get("parser_version"))}

    return {"fields": {field: build(field, data.get(field), sources["fields"][field]) for field in FIELDS},
            "skus": {sku_key(s): {field: build(field, s.get(field), sources["skus"][sku_key(s)][field]) for field in SKU_FIELDS} for s in data["skus"]}}


def row_data(row):
    result = dict(row)
    for field in ("main_images", "detail_images", "sku_images", "specs", "skus", "attributes", "selling_points"):
        result[field] = json.loads(row[field] or ("{}" if field in {"specs", "attributes"} else "[]"))
    return result


def legacy(row):
    from normalization import normalize_skus
    data = row_data(row)
    return {"fields": {field: {"origin": "legacy", "status": "legacy", "raw_value": None, "normalized_value": data.get(field),
                              "source_field": "", "source_url": "", "observed_at": None, "parser_version": "unknown"} for field in FIELDS},
            "skus": {sku_key(s): {field: {"origin": "legacy", "status": "legacy", "raw_value": None,
                                         "normalized_value": s.get(field), "source_field": "", "source_url": "", "observed_at": None,
                                         "parser_version": "unknown"} for field in SKU_FIELDS} for s in normalize_skus(data["skus"])}}


def update_current(row, data, merged, observed_at, accepted, price_locked, accepted_skus):
    incoming = observation(data, observed_at)
    current = json.loads(row["field_provenance"] or "{}") if row else {}
    current = current if current.get("fields") else (legacy(row) if row else {"fields": {}, "skus": {}})
    for field in FIELDS:
        if not row or field in accepted:
            current["fields"][field] = incoming["fields"][field]
    old_skus = current.get("skus", {})
    current["skus"] = {}
    for sku in merged["skus"]:
        key = sku_key(sku)
        current["skus"][key] = dict(old_skus.get(key, {}))
        for field in SKU_FIELDS:
            fresh = incoming["skus"].get(key, {}).get(field)
            if key in accepted_skus and fresh and fresh["status"] != "unknown" and not (price_locked and field in {"price", "original_price"}) and sku.get(field) == fresh["normalized_value"]:
                current["skus"][key][field] = fresh
            if field not in current["skus"][key]:
                current["skus"][key][field] = {"origin": "unknown", "status": "unknown", "raw_value": None, "normalized_value": sku.get(field),
                                              "source_field": "", "source_url": data["source_url"], "observed_at": observed_at, "parser_version": version(data.get("parser_version"))}
    # Fields assembled across SKU observations are marked computed, not falsely all fresh.
    for field in ("specs", "skus", "price_min", "price_max", "total_stock"):
        if field == 'specs' and not merged['skus']:
            continue
        if price_locked and field in {"price_min", "price_max"} and current["fields"].get(field, {}).get("origin") == "manual":
            continue
        source_field = 'price' if field in {'price_min', 'price_max'} and not any(s['price'] > 0 for s in merged['skus']) else 'stored_skus'
        current["fields"][field] = {"origin": "derived", "status": "known" if known(field, merged.get(field)) else "unknown",
                                    "raw_value": None, "normalized_value": merged.get(field), "source_field": source_field,
                                    "source_url": "", "observed_at": None, "parser_version": version(data.get("parser_version"))}
    return current


def mark_manual(conn, goods_id, fields, now, *, sku_prices=False):
    row = conn.execute("SELECT * FROM goods WHERE goods_id=?", (goods_id,)).fetchone()
    if not row:
        return
    data = row_data(row)
    current = json.loads(row["field_provenance"] or "{}")
    current = current if current.get("fields") else legacy(row)

    def entry(value):
        return {"origin": "manual", "status": "known", "raw_value": value, "normalized_value": value,
                "source_field": "manual_edit", "source_url": "", "observed_at": None, "modified_at": now, "parser_version": "manual"}

    for field in fields:
        if field in FIELDS or field in {"price_min", "price_max"}:
            current["fields"][field] = entry(data.get(field))
    if sku_prices:
        from normalization import normalize_skus
        for sku in normalize_skus(data["skus"]):
            meta = current.setdefault("skus", {}).setdefault(sku_key(sku), {})
            for field in ("price", "original_price"):
                meta[field] = entry(sku[field])
    conn.execute("UPDATE goods SET field_provenance=? WHERE goods_id=?", (json.dumps(current, ensure_ascii=False), goods_id))


def describe(row):
    data = row_data(row)
    current = json.loads(row["field_provenance"] or "{}")
    current = current if current.get("fields") else legacy(row)
    source = json.loads(row["source_snapshot"] or "{}")
    latest = observation(source, row["observed_at"]) if source.get("field_sources") else {"fields": {}, "skus": {}}
    manual = set(json.loads(row["manual_fields"] or "[]"))
    fields = []
    for field in (*FIELDS, "price_min", "price_max", "total_stock"):
        meta = current["fields"].get(field, {"origin": "legacy", "status": "legacy"})
        fields.append({"field": field, **meta, "current_value": data.get(field), "protected": field in manual or (bool(row["price_modified"]) and field in {"price", "original_price", "min_group_price", "price_min", "price_max"}),
                       "latest_observation": latest["fields"].get(field)})
    from normalization import normalize_skus
    skus = []
    for sku in normalize_skus(data["skus"]):
        key = sku_key(sku)
        skus.append({"sku_id": sku["sku_id"], "key": key, "specs": sku["specs"],
                     "fields": [{"field": field, **current.get("skus", {}).get(key, {}).get(field, {"origin": "legacy", "status": "legacy"}),
                                 "current_value": sku.get(field), "protected": bool(row["price_modified"]) and field in {"price", "original_price"},
                                 "latest_observation": latest["skus"].get(key, {}).get(field)} for field in SKU_FIELDS]})
    return {"goods_id": row["goods_id"], "source_url": row["source_url"], "observed_at": row["observed_at"], "updated_at": row["updated_at"],
            "fields": fields, "skus": skus, "manual_fields": sorted(manual)}


def mark_import(conn, goods_id, now, supplied_fields=None):
    previous_factory = conn.row_factory
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM goods WHERE goods_id=?", (goods_id,)).fetchone()
        from normalization import normalize_goods
        imported = row_data(row)
        source_fields = {}
        for field in FIELDS:
            present = field in supplied_fields if supplied_fields is not None else known(field, imported.get(field)) and not (field in {'sales', 'sold_quantity'} and imported.get(field) == 0)
            source_fields[field] = {"origin": "import", "status": "known" if present else "unknown", "source_field": "import.normalized." + field, "raw_value": imported.get(field)}
        data = normalize_goods({**imported, "capture_source": "import", "parser_version": "import-v1", "field_sources": {"fields": source_fields}}, allow_empty=True)
        current = observation(data, now)
        conn.execute("UPDATE goods SET field_provenance=?,source_snapshot=?,observed_at=?,capture_source='import' WHERE goods_id=?",
                     (json.dumps(current, ensure_ascii=False), json.dumps(data, ensure_ascii=False), now, goods_id))
    finally:
        conn.row_factory = previous_factory
