"""Offline integration regressions. All runtime files live in a temporary directory."""

import importlib
import json
import io
import logging
import os
import sys
import tempfile
import time
import zipfile
import unittest
from pathlib import Path
from unittest.mock import patch

_runtime = tempfile.TemporaryDirectory(prefix="pdd-tests-", dir=os.environ.get("PDD_TEST_TMP"), ignore_cleanup_errors=True)
os.environ["PDD_DATA_DIR"] = _runtime.name
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import capture_state
import storage
from normalization import normalize_skus, pdd_price
from parser import GoodsParser
from web.security import ADMIN_TOKEN, CAPTURE_TOKEN

web = importlib.import_module("web.app")
logging.disable(logging.CRITICAL)


def goods(gid="123456", price=12.99, stock=5):
    return {"goods_id": gid, "title": "测试商品标题", "price": price,
            "capture_source": "api", "skus_complete": True,
            "skus": [{"sku_id": "sku-a", "price": price, "stock": stock,
                      "specs": [{"key": "颜色", "value": "红色"}]}]}


class ApiRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.init_db()
        web.app.config["TESTING"] = True

    def setUp(self):
        self.network = patch("socket.socket.connect", side_effect=AssertionError("Network forbidden in tests"))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.client = web.app.test_client()
        capture_state.set_capture_enabled(True)
        conn = storage.get_conn()
        for table in ("goods", "sku_items", "browse_items", "monitor_list", "monitor_history", "product_tags", "product_groups"):
            conn.execute(f"DELETE FROM {table}")
        conn.commit()
        conn.close()

    def request(self, method, url, **kwargs):
        kwargs.setdefault("headers", {"X-PDD-Token": ADMIN_TOKEN})
        return self.client.open(url, method=method, **kwargs)

    def ingest(self, data):
        result = self.request("POST", "/api/ingest", json=data)
        self.assertEqual(result.status_code, 200, result.get_data(as_text=True))
        return result

    def test_authentication_and_origin_scope(self):
        self.assertEqual(self.client.get("/api/products").status_code, 401)
        self.assertEqual(self.client.get("/api/session", headers={"Origin": "https://untrusted.example"}).status_code, 403)
        self.assertEqual(self.client.get("/api/session", headers={"Host": "untrusted.example"}).status_code, 403)
        denied = self.request("POST", "/api/ingest", json=goods(), headers={"Origin": "https://mobile.yangkeduo.com", "X-PDD-Token": CAPTURE_TOKEN})
        self.assertEqual(denied.status_code, 403)
        denied = self.request("PUT", "/api/settings", json={}, headers={"X-PDD-Token": CAPTURE_TOKEN})
        self.assertEqual(denied.status_code, 401)
        allowed = self.request("POST", "/api/ingest", json=goods(), headers={"X-PDD-Token": CAPTURE_TOKEN})
        self.assertEqual(allowed.status_code, 200)

    def test_pausing_blocks_both_capture_routes_and_survives_reload(self):
        self.assertEqual(self.request("POST", "/api/capture-toggle", json={"enabled": False}).status_code, 200)
        self.assertEqual(self.request("POST", "/api/ingest", json=goods()).status_code, 409)
        self.assertEqual(self.request("POST", "/api/list-ingest", json={"items": [{"goods_id": "1"}]}).status_code, 409)
        capture_state._state = None
        self.assertFalse(capture_state.get_capture_enabled())
        self.assertEqual(storage.count_goods(), 0)
        self.assertEqual(self.request("POST", "/api/capture-toggle", json={"enabled": "false"}).status_code, 400)

    def test_restriction_event_stops_capture(self):
        r = self.request("POST", "/api/capture-event", json={"kind": "http_429"})
        self.assertFalse(r.get_json()["enabled"])
        self.assertEqual(self.request("POST", "/api/ingest", json=goods()).status_code, 409)

    def test_sku_update_is_consistent_and_zero_stock_survives(self):
        self.ingest(goods(price=20))
        self.ingest(goods(price=10, stock=0))
        product = self.request("GET", "/api/product/123456").get_json()
        self.assertEqual(product["price"], 10)
        self.assertEqual(product["skus"][0]["price"], 10)
        self.assertEqual(product["sku_items"][0]["price"], 10)
        self.assertEqual(product["sku_items"][0]["specs"], {"颜色": "红色"})
        self.assertEqual(product["total_stock"], 0)

    def test_manual_price_survives_recapture(self):
        self.ingest(goods(price=10))
        r = self.request("POST", "/api/product/123456/batch-price", json={"multiplier": 2, "fixed_amount": 0})
        self.assertEqual(r.status_code, 200)
        self.ingest(goods(price=12, stock=0))
        product = self.request("GET", "/api/product/123456").get_json()
        self.assertEqual(product["price"], 20)
        self.assertEqual(product["skus"][0]["price"], 20)
        self.assertEqual(product["sku_items"][0]["price"], 20)
        self.assertEqual(product["total_stock"], 0)

    def test_invalid_sku_rolls_back_entire_product(self):
        data = goods(stock=-1)
        self.assertEqual(self.request("POST", "/api/ingest", json=data).status_code, 400)
        self.assertEqual(storage.count_goods(), 0)
        self.assertEqual(self.request("POST", "/api/ingest", json=goods(gid="../escape")).status_code, 400)

    def test_invalid_list_values_are_not_reported_as_retryable_server_errors(self):
        response = self.request("POST", "/api/list-ingest", json={"items": [{"goods_id": "123456", "price": "not-a-price"}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.request("GET", "/api/browse").get_json()["total"], 0)

    def test_raw_credentials_are_not_stored(self):
        data = goods()
        data["raw_init_data"] = {"cookie": "synthetic-secret", "user": {"token": "synthetic-secret"}}
        self.ingest(data)
        conn = storage.get_conn()
        raw = conn.execute("SELECT raw_data FROM goods").fetchone()[0]
        conn.close()
        self.assertNotIn("synthetic-secret", raw)

    def test_manual_title_and_images_survive_recapture(self):
        self.ingest(goods())
        response = self.request("PUT", "/api/product/123456", json={"title": "人工标题", "main_images": ["/api/local-image/123456/example.png"]})
        self.assertEqual(response.status_code, 200)
        self.ingest(goods())
        product = self.request("GET", "/api/product/123456").get_json()
        self.assertEqual(product["title"], "人工标题")
        self.assertEqual(product["main_images"], ["/api/local-image/123456/example.png"])

    def test_filters_and_ids_use_the_same_predicate(self):
        self.ingest(goods("1", price=5))
        self.ingest(goods("2", price=20))
        self.assertEqual(self.request("GET", "/api/products?min_price=10").get_json()["total"], 1)
        self.assertEqual(self.request("GET", "/api/product-ids?min_price=10").get_json()["ids"], ["2"])
        self.assertEqual(self.request("GET", "/api/products?tag=99999").get_json()["total"], 0)

    def test_refresh_does_not_fabricate_monitor_observations(self):
        self.ingest({**goods(), "capture_id": "event-one", "captured_at": "2020-01-01T01:00:00"})
        self.assertEqual(self.request("POST", "/api/monitor", json={"goods_id": "123456"}).status_code, 200)
        history = self.request("GET", "/api/monitor/123456/history").get_json()
        self.assertEqual(len(history), 1)
        self.assertTrue(history[0]["checked_at"].startswith("2020"))
        self.request("POST", "/api/monitor/refresh", json={})
        self.assertEqual(self.request("GET", "/api/monitor/123456/history").get_json(), history)
        self.ingest({**goods(price=11), "capture_id": "event-two"})
        self.ingest({**goods(price=11), "capture_id": "event-two"})
        history = self.request("GET", "/api/monitor/123456/history").get_json()
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["price"], 11)

    def test_json_export_job_returns_a_real_download(self):
        self.ingest(goods())
        response = self.request("POST", "/api/export", json={"ids": ["123456"], "format": "json"})
        self.assertEqual(response.status_code, 202)
        jid = response.get_json()["job_id"]
        for _ in range(100):
            state = self.request("GET", f"/api/jobs/{jid}").get_json()
            if state["status"] in {"completed", "failed"}:
                break
            time.sleep(.01)
        self.assertEqual(state["status"], "completed", state)
        response = self.request("GET", f"/api/jobs/{jid}/download")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.get_data())[0]["goods_id"], "123456")
        response.close()

    def test_image_upload_cache_and_apply_use_local_urls(self):
        from PIL import Image
        image = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(image, format="PNG")
        raw = image.getvalue()
        image.seek(0)
        response = self.request("POST", "/api/ai/upload-image", data={"file": (image, "test.png")})
        self.assertEqual(response.status_code, 200)
        url = response.get_json()["url"]
        downloaded = self.request("GET", url)
        self.assertEqual(downloaded.data, raw)
        downloaded.close()
        cached = self.request("POST", "/api/ai/cache-image", json={"url": url})
        self.assertEqual(cached.status_code, 200)
        self.ingest(goods())
        result = self.request("POST", "/api/ai/use-image", json={"goods_id": "123456", "image_path": cached.get_json()["url"]})
        self.assertEqual(result.status_code, 200, result.get_data(as_text=True))
        self.assertEqual(result.get_json()["images"], [cached.get_json()["url"]])
        self.assertEqual(self.request("POST", "/api/ai/cache-image", json={"url": "/api/ai-image/../config.json"}).status_code, 400)

    def test_ai_results_are_saved_before_they_are_returned(self):
        from web import ai
        path = Path(_runtime.name) / "ai_images" / "test" / "generated.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"synthetic-image")
        with patch.object(ai, "_call_grsai", return_value={"urls": ["https://images.example/generated.png"]}), patch.object(ai, "_download_and_save", return_value="ai_images/test/generated.png"):
            result = ai.generate_image("测试提示词", "test")
        self.assertEqual(result["urls"], ["/api/ai-image/ai_images/test/generated.png"])
        self.assertEqual(self.request("GET", "/api/ai/history").get_json()["items"][0]["prompt"], "测试提示词")

    def test_image_exports_include_sku_images_and_failed_download_list(self):
        import exporter
        import wechat_export
        data = goods()
        data.update(main_images=["https://img.pddpic.com/main.png"], sku_images=["https://img.pddpic.com/sku.png"])
        self.ingest(data)
        with patch.object(exporter, "_download_image", side_effect=lambda task: (task[0], b"test-image" if "main.png" in task[1] else None)):
            path = exporter.export_txt(["123456"])
        with zipfile.ZipFile(path) as archive:
            self.assertIn("下载未完成.txt", archive.namelist())
            self.assertTrue(any("SKU" in name for name in archive.read("下载未完成.txt").decode().splitlines()))
        with patch.object(wechat_export, "_download_image", side_effect=lambda task: (task[0], b"test-image")):
            path = wechat_export.export_for_wechat(["123456"])
        with zipfile.ZipFile(path) as archive:
            self.assertTrue(any("SKU图" in name for name in archive.namelist()))


class PriceRegressionTests(unittest.TestCase):
    def test_explicit_raw_price_units(self):
        for value, expected in ((99, .99), ("1299", 12.99), (1299, 12.99)):
            with self.subTest(value=value):
                self.assertEqual(pdd_price({"min_group_price": value}), expected)
                self.assertEqual(GoodsParser.parse({"goods_id": "1", "min_group_price": value}).price, expected)
        self.assertEqual(pdd_price({"minGroupPrice": "1299"}), 1299)
        self.assertEqual(pdd_price({"skuPrice": 1299, "normalPrice": "19.99"}, sku=True), 12.99)

    def test_raw_sku_aliases_and_unknown_stock(self):
        skus = normalize_skus([{"sku_id": "a", "group_price": 99, "quantity": 0, "specs": [{"spec_key": "颜色", "spec_value": "红色"}]}], from_pdd=True)
        self.assertEqual(skus[0]["price"], .99)
        self.assertEqual(skus[0]["stock"], 0)
        self.assertEqual(skus[0]["specs"], [{"key": "颜色", "value": "红色"}])
        self.assertIsNone(normalize_skus([{"sku_id": "a", "price": 1}])[0]["stock"])

    def test_import_and_wechat_export_preserve_zero_stock(self):
        from importer import _parse_skus, _extract_goods_from_raw_json
        from wechat_export import _convert_skus
        skus = _parse_skus([{"sku_id": "a", "price": 1, "stock": 0, "specs": {"颜色": "红"}}])
        self.assertEqual(skus[0]["stock"], 0)
        self.assertEqual(_parse_skus("红色/10/0", price_fallback=10)[0]["stock"], 0)
        self.assertEqual(_convert_skus(skus, default_stock=999)[0]["stock_num"], 0)
        parsed = _extract_goods_from_raw_json({"goods_id": "1", "goods_name": "测试商品", "min_group_price": "99", "sku": [{"sku_id": "a", "group_price": 99, "quantity": 0}]})
        self.assertEqual(parsed["price"], .99)
        self.assertEqual(parsed["skus"][0]["price"], .99)

    def test_raw_export_roundtrip_keeps_skus_but_not_credentials(self):
        from exporter import _normalize_to_dawang_format
        from importer import _extract_goods_from_raw_json
        raw = _normalize_to_dawang_format({**goods(), "cookie": "synthetic-secret"})
        self.assertNotIn("synthetic-secret", json.dumps(raw))
        parsed = _extract_goods_from_raw_json(raw)
        self.assertEqual(parsed["skus"][0]["price"], 12.99)
        self.assertEqual(parsed["skus"][0]["specs"], [{"key": "颜色", "value": "红色"}])


if __name__ == "__main__":
    unittest.main()
