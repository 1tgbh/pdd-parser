import io
import socket
import ssl
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

# Establish the same isolated runtime before importing application modules.
import test_regressions
import capture_state
import image_store
from export_jobs import get_export_job, submit_export

PNG = bytes.fromhex('89504e470d0a1a0a') + b'synthetic-image'


class Response:
    def __init__(self, status=200, headers=None, body=PNG):
        self.status = status
        self.headers = headers or {}
        self.body = io.BytesIO(body)

    def getheader(self, key):
        return self.headers.get(key)

    def read(self, size):
        return self.body.read(size)


def address(host, port, **kwargs):
    ip = '127.0.0.1' if host == '127.0.0.1' else '93.184.216.34'
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, port))]


class ImageSecurityTests(unittest.TestCase):
    def test_invalid_nonfinite_retry_after_does_not_create_an_infinite_cooldown(self):
        for value in ('Infinity', 'nan', '-Infinity'):
            self.assertEqual(image_store.retry_after_seconds(value), 60)

    def setUp(self):
        capture_state.set_capture_enabled(True)
        image_store._cooldown.clear()
        image_store._next_request.clear()
        self.forbid = patch('socket.socket.connect', side_effect=AssertionError('No network in tests'))
        self.forbid.start()
        self.addCleanup(self.forbid.stop)

    def test_domain_matching_uses_hostname(self):
        for url in ('http://127.0.0.1:9/?pddpic.com', 'https://pddpic.com.untrusted.example/x.jpg', 'https://pddpic.com@untrusted.example/x.jpg'):
            self.assertFalse(image_store.is_pdd_image(url))
        self.assertTrue(image_store.is_pdd_image('https://img.pddpic.com/a.png'))

    def test_private_ip_and_private_redirect_are_rejected(self):
        with patch('socket.getaddrinfo', side_effect=address), patch.object(image_store, '_connection') as connection:
            with self.assertRaises(image_store.ImageFetchError):
                image_store.read_image('http://127.0.0.1/private')
            connection.assert_not_called()
            conn = Mock()
            conn.getresponse.return_value = Response(302, {'Location': 'http://127.0.0.1/private'})
            connection.return_value = conn
            with self.assertRaises(image_store.ImageFetchError):
                image_store._fetch('https://public.example/image')
            self.assertEqual(connection.call_count, 1)
            conn.close.assert_called_once()

    def test_rate_limit_and_forbidden_responses_are_not_retried(self):
        for status in (403, 429):
            with self.subTest(status=status):
                image_store._cooldown.clear()
                image_store._next_request.clear()
                conn = Mock()
                conn.getresponse.return_value = Response(status, {'Retry-After': '120'})
                with patch('socket.getaddrinfo', side_effect=address), patch.object(image_store, '_connection', return_value=conn) as connect:
                    with self.assertRaises(image_store.ImageFetchError) as error:
                        image_store._fetch('https://img.pddpic.com/limited')
                    self.assertEqual(error.exception.status, status)
                    self.assertGreaterEqual(error.exception.retry_after, 120)
                    with self.assertRaises(image_store.ImageFetchError):
                        image_store._fetch('https://img.pddpic.com/another-image')
                    self.assertEqual(connect.call_count, 1)

    def test_cache_coalesces_downloads_and_rejects_html(self):
        url = 'https://img.pddpic.com/cache-test.png'
        with patch.object(image_store, '_fetch', return_value=(PNG, 'image/png')) as fetch:
            self.assertEqual(image_store.read_image(url)[0], PNG)
            self.assertEqual(image_store.read_image(url)[0], PNG)
            self.assertEqual(fetch.call_count, 1)
        with self.assertRaises(image_store.ImageFetchError):
            image_store.image_type(b'<html>not an image</html>')

    def test_oversize_response_stops_before_body_read(self):
        response = Response(200, {'Content-Length': str(image_store.MAX_IMAGE_BYTES + 1)})
        conn = Mock()
        conn.getresponse.return_value = response
        with patch('socket.getaddrinfo', side_effect=address), patch.object(image_store, '_connection', return_value=conn):
            with self.assertRaises(image_store.ImageFetchError):
                image_store._fetch('https://images.example/large')
        self.assertEqual(response.body.tell(), 0)

    def test_tls_keeps_hostname_validation_and_uses_pinned_ip(self):
        context = ssl.create_default_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        context_mock = Mock()
        with patch('ssl.create_default_context', return_value=context_mock), patch('socket.create_connection') as connect:
            conn = image_store._PinnedHTTPS('images.example', 443, '93.184.216.34')
            conn.connect()
            self.assertEqual(connect.call_args.args[0], ('93.184.216.34', 443))
            self.assertEqual(context_mock.wrap_socket.call_args.kwargs['server_hostname'], 'images.example')

    def test_capture_restriction_blocks_new_pdd_downloads(self):
        capture_state.set_capture_enabled(False, '页面要求安全验证')
        with patch('socket.getaddrinfo') as dns:
            with self.assertRaises(image_store.ImageFetchError):
                image_store._fetch('https://img.pddpic.com/restricted')
            dns.assert_not_called()


class ExportQueueTests(unittest.TestCase):
    def test_duplicate_running_exports_share_one_job(self):
        gate = threading.Event()
        calls = []
        out = Path(test_regressions._runtime.name) / 'job-test.txt'
        out.write_text('test', encoding='utf-8')

        def run(payload):
            calls.append(payload)
            gate.wait(2)
            return out

        first = submit_export('test', {'ids': ['1']}, run)
        try:
            second = submit_export('test', {'ids': ['1']}, run)
            self.assertEqual(first['job_id'], second['job_id'])
        finally:
            gate.set()
        for _ in range(100):
            if get_export_job(first['job_id'])['status'] == 'completed':
                break
            time.sleep(.01)
        self.assertEqual(len(calls), 1)
        self.assertEqual(get_export_job(first['job_id'])['status'], 'completed')


if __name__ == '__main__':
    unittest.main()
