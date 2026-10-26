"""Preview-era evidence contracts: field truthfulness and stage-scoped diagnostics."""

import json
import unittest
from unittest.mock import patch

import test_regressions
import capture_state
import diagnostics
import storage
from web.security import ADMIN_TOKEN, CAPTURE_TOKEN


def observed(price=.99, stock=0):
    data = test_regressions.goods(price=price, stock=stock)
    data.update(parser_version="1.4.0", source_url="https://mobile.yangkeduo.com/goods.html?goods_id=123456&token=secret",
                field_sources={"fields": {"price": {"origin": "page_state", "status": "known", "source_field": "min_group_price (fen)", "raw_value": str(round(price * 100))}},
                               "skus": [{"sku_id": "sku-a", "fields": {"price": {"origin": "page_state", "status": "known", "source_field": "group_price (fen)", "raw_value": str(round(price * 100))},
                                                                                 "stock": {"origin": "page_state", "status": "known", "source_field": "quantity", "raw_value": stock}}}]})
    return data


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.init_db()
        test_regressions.web.app.config["TESTING"] = True

    def setUp(self):
        self.client = test_regressions.web.app.test_client()
        capture_state.set_capture_enabled(True)
        self.network = patch('socket.socket.connect', side_effect=AssertionError('Unexpected network'))
        self.network.start()
        self.addCleanup(self.network.stop)
        conn = storage.get_conn()
        for table in ('goods', 'sku_items', 'diagnostics', 'monitor_list', 'monitor_history'):
            conn.execute('DELETE FROM ' + table)
        conn.commit()
        conn.close()

    def request(self, method, url, **kwargs):
        kwargs.setdefault('headers', {'X-PDD-Token': ADMIN_TOKEN})
        return self.client.open(url, method=method, **kwargs)

    def ingest(self, data):
        response = self.request('POST', '/api/ingest', json=data)
        self.assertEqual(response.status_code, 200, response.data)

    def provenance(self):
        response = self.request('GET', '/api/product/123456/provenance')
        self.assertEqual(response.status_code, 200, response.data)
        return response.get_json()

    def test_raw_fen_normalized_yuan_and_observation_time_are_separate(self):
        self.ingest({**observed(), 'captured_at': '2020-01-01T01:00:00', 'capture_id': 'snapshot-one'})
        evidence = self.provenance()
        price = next(f for f in evidence['fields'] if f['field'] == 'price')
        self.assertEqual(price['raw_value'], '99')
        self.assertEqual(price['normalized_value'], .99)
        self.assertEqual(price['current_value'], .99)
        self.assertEqual(price['origin'], 'page_state')
        self.assertTrue(price['observed_at'].startswith('2020'))
        self.assertFalse(evidence['updated_at'].startswith('2020'))
        self.assertNotIn('token=', json.dumps(evidence))

    def test_manual_price_keeps_its_origin_and_exposes_latest_source_value(self):
        self.ingest(observed(price=10))
        result = self.request('POST', '/api/product/123456/batch-price', json={'multiplier': 2, 'fixed_amount': 0})
        self.assertEqual(result.status_code, 200)
        self.ingest(observed(price=12))
        evidence = self.provenance()
        price = next(f for f in evidence['fields'] if f['field'] == 'price')
        self.assertEqual(price['current_value'], 20)
        self.assertEqual(price['origin'], 'manual')
        self.assertTrue(price['protected'])
        self.assertEqual(price['latest_observation']['normalized_value'], 12)
        self.assertEqual(price['latest_observation']['raw_value'], '1200')
        sku_price = next(f for f in evidence['skus'][0]['fields'] if f['field'] == 'price')
        self.assertEqual(sku_price['origin'], 'manual')
        self.assertEqual(sku_price['current_value'], 20)
        self.assertEqual(sku_price['latest_observation']['normalized_value'], 12)

    def test_unknown_sku_values_do_not_erase_known_values_or_evidence(self):
        self.ingest(observed())
        new = observed(price=0, stock=None)
        self.ingest(new)
        evidence = self.provenance()
        fields = {f['field']: f for f in evidence['skus'][0]['fields']}
        self.assertEqual(fields['stock']['current_value'], 0)
        self.assertEqual(fields['stock']['status'], 'known')
        self.assertEqual(fields['stock']['latest_observation']['status'], 'unknown')
        self.assertEqual(fields['price']['current_value'], .99)
        self.assertEqual(fields['price']['latest_observation']['status'], 'unknown')

    def test_manual_title_and_blank_image_edits_are_truthfully_labeled(self):
        self.ingest(observed())
        response = self.request('PUT', '/api/product/123456', json={'title': '人工标题', 'main_images': []})
        self.assertEqual(response.status_code, 200)
        self.ingest(observed())
        evidence = {f['field']: f for f in self.provenance()['fields']}
        self.assertEqual(evidence['title']['origin'], 'manual')
        self.assertEqual(evidence['title']['current_value'], '人工标题')
        self.assertEqual(evidence['main_images']['origin'], 'manual')
        self.assertEqual(evidence['main_images']['current_value'], [])

    def test_old_records_are_not_given_invented_field_origins(self):
        self.ingest(observed())
        conn = storage.get_conn()
        conn.execute("UPDATE goods SET field_provenance='{}', source_snapshot='{}'")
        conn.commit()
        conn.close()
        evidence = self.provenance()
        price = next(f for f in evidence['fields'] if f['field'] == 'price')
        self.assertEqual(price['origin'], 'legacy')
        self.assertIsNone(price['observed_at'])

    def test_specs_without_skus_keep_their_source_and_price_range_uses_main_price(self):
        data = observed()
        data['skus'] = []
        data['specs'] = {'颜色': ['红色']}
        self.ingest(data)
        fields = {field['field']: field for field in self.provenance()['fields']}
        self.assertEqual(fields['specs']['origin'], 'provided')
        self.assertEqual(fields['specs']['current_value'], {'颜色': ['红色']})
        self.assertEqual(fields['price_min']['source_field'], 'price')

    def test_incoming_raw_page_objects_are_not_accepted_as_field_evidence(self):
        data = observed()
        data['field_sources']['fields']['price']['raw_value'] = {'cookie': 'synthetic-secret'}
        self.ingest(data)
        self.assertNotIn('synthetic-secret', json.dumps(self.provenance()))
        data['field_sources']['fields']['price'].update(origin={}, status=[])
        self.ingest(data)
        self.assertEqual(next(f for f in self.provenance()['fields'] if f['field'] == 'price')['origin'], 'provided')

    def test_missing_sales_are_distinct_from_observed_zero(self):
        self.ingest({**observed(), 'sales': 10})
        self.ingest(observed())
        evidence = next(f for f in self.provenance()['fields'] if f['field'] == 'sales')
        self.assertEqual(evidence['current_value'], 10)
        self.assertEqual(evidence['latest_observation']['status'], 'unknown')
        self.ingest({**observed(), 'sales': 0})
        evidence = next(f for f in self.provenance()['fields'] if f['field'] == 'sales')
        self.assertEqual(evidence['current_value'], 0)
        self.assertEqual(evidence['status'], 'known')
        data = {**observed(), 'sales': 20000}
        data['field_sources']['fields']['sales'] = {'origin': 'page_state', 'status': 'known', 'source_field': 'sideSalesTip', 'raw_value': '已拼2万件'}
        self.ingest(data)
        evidence = next(f for f in self.provenance()['fields'] if f['field'] == 'sales')
        self.assertEqual(evidence['raw_value'], '已拼2万件')
        self.assertEqual(evidence['normalized_value'], 20000)

    def test_imported_values_have_import_origin_not_inherited_page_origin(self):
        from importer import import_goods_json
        from pathlib import Path
        self.ingest(observed())
        file = Path(test_regressions._runtime.name) / 'import-evidence.json'
        file.write_text(json.dumps([{**observed(price=15), 'title': '导入标题'}], ensure_ascii=False), encoding='utf-8')
        result = import_goods_json(file)
        self.assertEqual(result['updated'], 1, result)
        evidence = next(f for f in self.provenance()['fields'] if f['field'] == 'price')
        self.assertEqual(evidence['origin'], 'import')
        self.assertEqual(evidence['current_value'], 15)

    def test_diagnostic_upload_is_idempotent_filtered_and_scope_limited(self):
        event = {'id': 'diagnostic-one', 'code': 'data_incomplete', 'stage': 'preview', 'goods_id': '123456',
                 'source_url': 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&token=synthetic-secret', 'message': 'synthetic-secret'}
        for _ in range(2):
            response = self.request('POST', '/api/diagnostics/events', json={'events': [event]}, headers={'X-PDD-Token': CAPTURE_TOKEN})
            self.assertEqual(response.status_code, 200, response.data)
        items = self.request('GET', '/api/diagnostics?stage=preview&unread=true').get_json()
        self.assertEqual(items['total'], 1)
        self.assertNotIn('synthetic-secret', json.dumps(items))
        self.assertEqual(self.request('GET', '/api/diagnostics', headers={'X-PDD-Token': CAPTURE_TOKEN}).status_code, 401)
        capture_state.set_capture_enabled(False, '页面要求安全验证')
        self.assertEqual(self.request('POST', '/api/diagnostics/diagnostic-one/acknowledge', json={}).status_code, 200)
        self.assertFalse(capture_state.get_capture_enabled())
        self.assertEqual(self.request('GET', '/api/diagnostics?unread=true').get_json()['total'], 0)

    def test_invalid_diagnostic_batch_is_atomic_and_retention_is_bounded(self):
        good = {'id': 'event-good', 'code': 'image_failed', 'stage': 'image'}
        response = self.request('POST', '/api/diagnostics/events', json={'events': [good, {'code': 'made-up', 'stage': 'image'}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.request('GET', '/api/diagnostics').get_json()['total'], 0)
        conn = storage.get_conn()
        diagnostics.write_events(conn, [{**good, 'id': 'image-' + str(i)} for i in range(510)])
        conn.commit()
        conn.close()
        self.assertEqual(self.request('GET', '/api/diagnostics').get_json()['total'], 500)

    def test_image_diagnostics_do_not_pause_product_capture(self):
        import image_store
        with patch.object(image_store, '_read_image', side_effect=image_store.ImageFetchError('blocked', 403)):
            with self.assertRaises(image_store.ImageFetchError):
                image_store.read_image('https://img.pddpic.com/test.png?token=synthetic-secret')
        items = self.request('GET', '/api/diagnostics?stage=image').get_json()
        self.assertEqual(items['items'][0]['code'], 'access_denied')
        self.assertEqual(items['items'][0]['http_status'], 403)
        self.assertNotIn('synthetic-secret', json.dumps(items))
        self.assertTrue(capture_state.get_capture_enabled())

    def test_local_image_cooldown_has_no_invented_http_status(self):
        import image_store
        with patch.object(image_store, '_read_image', side_effect=image_store.ImageFetchError('cooldown', retry_after=120, code='image_cooldown')):
            with self.assertRaises(image_store.ImageFetchError):
                image_store.read_image('https://img.pddpic.com/test.png')
        event = self.request('GET', '/api/diagnostics?stage=image').get_json()['items'][0]
        self.assertEqual(event['code'], 'image_cooldown')
        self.assertIsNone(event['http_status'])
        self.assertIsNotNone(event['retry_at'])

    def test_login_page_event_has_no_invented_http_status(self):
        response = self.request('POST', '/api/capture-event', json={'kind': 'auth_required'})
        self.assertEqual(response.status_code, 200)
        event = self.request('GET', '/api/diagnostics?stage=page_read').get_json()['items'][0]
        self.assertEqual(event['code'], 'auth_required')
        self.assertIsNone(event['http_status'])
        self.assertFalse(capture_state.get_capture_enabled())


if __name__ == '__main__':
    unittest.main()
