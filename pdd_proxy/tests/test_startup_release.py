import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import test_regressions
import capture_state
import service
import start
import storage


class StartupTests(unittest.TestCase):
    def test_default_start_opens_only_local_admin(self):
        async def stop_after_ready(seconds):
            if seconds == 3600:
                raise asyncio.CancelledError()

        with patch.object(start, '_check_frontend_dist'), patch.object(storage, 'init_db'), \
                patch.object(start, '_start_web_thread'), patch.object(start.asyncio, 'sleep', side_effect=stop_after_ready), \
                patch.object(start, 'set_system_proxy') as proxy, patch.object(start, 'open_browser') as browser:
            asyncio.run(start.run_server())
        browser.assert_called_once_with('http://127.0.0.1:5000')
        proxy.assert_not_called()

    def test_port_conflict_does_not_open_the_browser(self):
        with patch.object(start, '_check_frontend_dist'), patch.object(storage, 'init_db'), \
                patch('werkzeug.serving.make_server', side_effect=OSError('port in use')), \
                patch.object(start, 'open_browser') as browser:
            with self.assertRaises(OSError):
                asyncio.run(start.run_server())
            browser.assert_not_called()

    def test_windows_proxy_restores_original_values(self):
        values = {'ProxyEnable': (1, 4), 'ProxyServer': ('original-proxy:3128', 1)}
        original = dict(values)
        registry = SimpleNamespace(
            HKEY_CURRENT_USER=0, KEY_SET_VALUE=2, KEY_READ=1, REG_DWORD=4, REG_SZ=1,
            OpenKey=lambda *args: object(), CloseKey=lambda key: None,
            QueryValueEx=lambda key, name: values[name],
            SetValueEx=lambda key, name, _, kind, value: values.update({name: (value, kind)}),
        )
        with patch.dict(sys.modules, {'winreg': registry}), patch.object(start, 'get_os', return_value='Windows'):
            self.assertTrue(start.set_system_proxy(8080))
            self.assertEqual(values['ProxyServer'][0], '127.0.0.1:8080')
            start.restore_system_proxy()
        self.assertEqual(values, original)

    def test_proxy_adapter_handles_sku_arrays_without_extra_http_requests(self):
        storage.init_db()
        capture_state.set_capture_enabled(True)
        flow = SimpleNamespace(
            request=SimpleNamespace(pretty_host='mobile.yangkeduo.com', pretty_url='https://mobile.yangkeduo.com/api/goods/detail'),
            response=SimpleNamespace(status_code=200, headers={'content-type': 'application/json'}, content=json.dumps({
                'goods_id': 'proxy-test', 'goods_name': '测试商品', 'min_group_price': 99,
                'sku': [{'sku_id': 'a', 'group_price': 99, 'quantity': 0, 'specs': [{'spec_key': '颜色', 'spec_value': '红'}]}],
            }).encode()),
        )
        with patch('socket.socket.connect', side_effect=AssertionError('unexpected network')):
            interceptor = service.PddInterceptor()
            interceptor.response(flow)
        self.assertEqual(interceptor.stats['saved'], 1)
        self.assertEqual(storage.get_sku_items('proxy-test')[0]['price'], .99)
        self.assertEqual(storage.get_sku_items('proxy-test')[0]['specs'], {'颜色': '红'})


class ReleaseTests(unittest.TestCase):
    def test_diagnostic_capture_does_not_save_credentials(self):
        import pdd_intercept
        flow = SimpleNamespace(request=SimpleNamespace(
            pretty_host='mobile.yangkeduo.com', pretty_url='https://mobile.yangkeduo.com/api/goods/detail?goods_id=1&token=synthetic-secret',
            method='POST', headers={'Cookie': 'synthetic-secret', 'Authorization': 'synthetic-secret', 'Content-Type': 'application/json'},
            query={'goods_id': '1', 'token': 'synthetic-secret'},
            content=json.dumps({'goods_id': '1', 'password': 'synthetic-secret'}).encode(),
        ))
        with patch.object(pdd_intercept, 'save_json', return_value=Path('redacted.json')) as save:
            pdd_intercept.request(flow)
        captured = save.call_args.args[0]
        self.assertNotIn('synthetic-secret', json.dumps(captured))
        self.assertEqual(captured['body'], {'goods_id': '1'})

    def test_release_allowlist_excludes_runtime_files(self):
        root = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location('package_release', root / 'tools' / 'package_release.py')
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)
        names = {p.relative_to(root).as_posix() for p in package.release_files(root)}
        self.assertIn('extension/background.js', names)
        self.assertIn('extension/diagnostics.js', names)
        self.assertIn('pdd_proxy/provenance.py', names)
        self.assertIn('pdd_proxy/diagnostics.py', names)
        self.assertIn('frontend/src/pages/Diagnostics.tsx', names)
        self.assertIn('pdd_proxy/web/security.py', names)
        self.assertIn('pdd_proxy/data/wechat_categories.json', names)
        self.assertIn('tools/package_release.py', names)
        data = {name for name in names if name.startswith('pdd_proxy/data/')}
        self.assertEqual(data, {'pdd_proxy/data/wechat_categories.json', 'pdd_proxy/data/forbidden_words.json'})
        self.assertFalse(any(name.endswith(('.db', '.log', '.pem', '.key')) or 'node_modules/' in name or '/certs/' in name for name in names))


if __name__ == '__main__':
    unittest.main()
