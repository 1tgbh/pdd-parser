const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const directory = path.resolve(__dirname, '..');
const DETAIL = 'https://mobile.yangkeduo.com/goods.html?goods_id=123456';
const LIST = 'https://mobile.yangkeduo.com/search_result.html?search_key=test';
const extensionId = 'a'.repeat(32);
const popupSender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const pageSender = (url = DETAIL) => ({ id: extensionId, tab: { id: 1, active: true }, frameId: 0, url });
const source = name => fs.readFileSync(path.join(directory, name), 'utf8');
const collectorDefinition = vm.createContext({});
vm.runInContext(source('inject.js'), collectorDefinition);
const collectorCode = collectorDefinition.collectCurrentProduct.toString();

const rawGoods = price => ({ goods_id: '123456', goods_name: '离线测试商品', min_group_price: price,
  top_gallery: ['https://img.pddpic.com/main.jpg'],
  sku: [{ sku_id: 'sku-1', group_price: price, quantity: 0, specs: [{ spec_key: '颜色', spec_value: '红色' }] }],
});

function page(options = {}) {
  const calls = { fetch: 0, xhr: 0, timers: 0, observers: 0, clicks: 0 };
  const metas = options.metas || {};
  const document = {
    title: options.title || '', body: { innerText: options.text || '' },
    querySelector(selector) {
      const match = selector.match(/^meta\[property="(.+)"\]$/);
      if (match && metas[match[1]]) return { getAttribute: () => metas[match[1]] };
      return null;
    },
    querySelectorAll: () => (options.scripts || []).map(textContent => ({ textContent })),
    createElement() { calls.clicks++; throw new Error('DOM writes forbidden'); },
  };
  const sandbox = {
    URL, document, location: { href: options.url || DETAIL },
    store: options.store || (options.goods ? { initDataObj: { goods: options.goods } } : undefined),
    fetch() { calls.fetch++; throw new Error('network forbidden'); },
    XMLHttpRequest: class { constructor() { calls.xhr++; } },
    setTimeout() { calls.timers++; },
    MutationObserver: class { constructor() { calls.observers++; } },
    history: { pushState() {}, replaceState() {} },
    performance: { getEntriesByType: () => [{ responseStatus: options.status || 200 }] },
    ...(options.globals || {}),
  };
  const context = vm.createContext(sandbox);
  vm.runInContext('window = globalThis', context);
  const before = vm.runInContext('({ keys: Object.keys(window).sort().join(), parse: JSON.parse, fetch: fetch, xhr: XMLHttpRequest, push: history.pushState })', context);
  function run(expected = { goodsId: '123456', url: DETAIL }, fnCode = collectorCode) {
    context.__expected = expected;
    const result = vm.runInContext(`(${fnCode})(__expected)`, context);
    delete context.__expected;
    return JSON.parse(JSON.stringify(result));
  }
  function assertReadonly() {
    const after = vm.runInContext('({ keys: Object.keys(window).sort().join(), parse: JSON.parse, fetch: fetch, xhr: XMLHttpRequest, push: history.pushState })', context);
    for (const key of Object.keys(before)) assert.equal(after[key], before[key], key);
    assert.deepEqual(calls, { fetch: 0, xhr: 0, timers: 0, observers: 0, clicks: 0 });
  }
  return { run, assertReadonly, context, calls };
}

test('manual collector converts known fen fields and preserves zero stock', () => {
  for (const [input, expected] of [[99, .99], ['1299', 12.99], [1299, 12.99]]) {
    const p = page({ goods: rawGoods(input) });
    const result = p.run();
    assert.equal(result.ok, true);
    assert.equal(result.goods.price, expected);
    assert.equal(result.goods.skus[0].price, expected);
    assert.equal(result.goods.skus[0].stock, 0);
    assert.deepEqual(result.goods.skus[0].specs, [{ key: '颜色', value: '红色' }]);
    assert.equal(result.goods.field_sources.fields.title.source_field, 'goods.goods_name');
    assert.equal(result.goods.field_sources.fields.price.raw_value, String(input));
    assert.equal(result.goods.field_sources.skus[0].fields.stock.raw_value, 0);
    p.assertReadonly();
  }
});

test('manual SSR capture preserves yuan fields and missing stock', () => {
  const p = page({ goods: { goodsID: '123456', goodsName: '测试商品名称', minGroupPrice: '1299',
    skus: [{ skuID: 'a', groupPrice: '12.99', normalPrice: '20', specs: { 尺码: 'XL' } }] } });
  const result = p.run();
  assert.equal(result.goods.price, 1299);
  assert.equal(result.goods.skus[0].price, 12.99);
  assert.equal(result.goods.skus[0].original_price, 20);
  assert.equal(result.goods.skus[0].stock, null);
  assert.ok(result.missing.includes('部分库存'));
  const mixed = page({ goods: { ...rawGoods(1299), sku: [{ sku_id: 'a', skuPrice: 1299, normalPrice: '19.99' }] } }).run();
  assert.equal(mixed.goods.skus[0].price, 12.99);
  assert.equal(mixed.goods.skus[0].original_price, 19.99);
});

test('collector selects only the goods ID from the current detail URL', () => {
  const other = { ...rawGoods(9900), goods_id: '888888' };
  const p = page({ store: { recommended: [other], initDataObj: { goods: rawGoods(99) } } });
  assert.equal(p.run().goods.price, .99);
  assert.equal(page({ goods: other }).run().ok, false);
  for (const name of ['帽子', '拼多多-运营教程']) {
    assert.equal(page({ goods: { ...rawGoods(99), goods_name: name } }).run().goods.title, name);
  }
});

test('DOM fallback reports missing fields instead of guessing a coupon price or SKUs', () => {
  const p = page({ metas: { 'og:title': '测试商品标题', 'og:image': 'https://img.pddpic.com/a.png' }, text: '优惠券 ¥100 推荐商品 ¥2' });
  const result = p.run();
  assert.equal(result.ok, true);
  assert.equal(result.goods.price, 0);
  assert.deepEqual(result.goods.skus, []);
  assert.ok(result.missing.includes('价格'));
  assert.ok(result.missing.includes('SKU'));
  p.assertReadonly();
});

test('collector does not invoke page getters or persist full page state', () => {
  let invoked = 0;
  const goods = rawGoods(99);
  Object.defineProperty(goods, 'lazy', { enumerable: true, get() { invoked++; return 'secret'; } });
  const store = { initDataObj: { goods, user: { cookie: 'synthetic-secret' } } };
  store.circular = store;
  const p = page({ store });
  const result = p.run();
  assert.equal(result.ok, true);
  assert.equal(invoked, 0);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  p.assertReadonly();
});

test('embedded JSON is parsed without evaluating script code', () => {
  const embedded = 'store.initDataObj = ' + JSON.stringify({ goods: rawGoods(99) }) + ';';
  assert.equal(page({ scripts: [embedded] }).run().goods.price, .99);
  const p = page({ scripts: [embedded + ' fetch("https://example.invalid/");'] });
  assert.equal(p.run().ok, false);
  p.assertReadonly();
});

test('restricted or changed pages do not produce goods', () => {
  assert.equal(page({ title: '安全验证' }).run().restriction, 'verification');
  for (const status of [401, 403, 429]) assert.equal(page({ status }).run().restriction, 'http_' + status);
  assert.equal(page({ title: '403 Forbidden' }).run().ok, false);
  assert.equal(page({ title: '登录拼多多' }).run().restriction, 'auth_required');
  assert.equal(page({ goods: rawGoods(99), url: DETAIL.replace('123456', '999999') }).run().ok, false);
});

test('login-page diagnostics do not invent an HTTP status', async () => {
  const w = await worker({ page: page({ title: '登录拼多多' }) });
  assert.equal((await w.send({ type: 'PDD_PREVIEW_CURRENT' })).paused, true);
  const diagnostic = w.state.pddDiagnostics[0];
  assert.equal(diagnostic.code, 'auth_required');
  assert.equal(diagnostic.http_status, null);
  assert.equal(w.posts().length, 0);
});

async function settle() { for (let i = 0; i < 16; i++) await new Promise(resolve => setImmediate(resolve)); }

async function worker(options = {}) {
  const state = options.state || {};
  let listener, context;
  let online = options.online !== false;
  let ingestStatus = options.ingestStatus || 200;
  let backendEnabled = options.backendEnabled !== false;
  let tab = { id: 1, active: true, url: DETAIL };
  let currentPage = options.page || page({ goods: rawGoods(99) });
  let scriptGate = null;
  let navigationListener;
  const calls = { requests: [], scripts: [] };
  const chrome = {
    runtime: { id: extensionId, getURL: name => `chrome-extension://${extensionId}/${name}`, onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    storage: { local: {
      async get(query) {
        if (typeof query === 'string') return { [query]: structuredClone(state[query]) };
        return structuredClone({ ...(query || {}), ...state });
      },
      async set(values) {
        if (options.failDiagnosticStorage && Object.hasOwn(values, 'pddDiagnostics')) throw new Error('diagnostic storage quota');
        Object.assign(state, structuredClone(values));
      },
    } },
    tabs: { async query() { return [{ ...tab }]; }, async get() { return { ...tab }; },
      onUpdated: { addListener(fn) { navigationListener = fn; } }, onRemoved: { addListener() {} } },
    scripting: { async executeScript(options) {
      calls.scripts.push(options);
      if (options.files) return [{ frameId: 0, result: null }];
      if (scriptGate) await scriptGate;
      return [{ frameId: 0, documentId: 'document-one', result: currentPage.run(options.args[0], options.func.toString()) }];
    } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  };
  const fetch = async (url, options = {}) => {
    calls.requests.push({ url, options });
    if (!online) throw new Error('offline');
    let body = { enabled: backendEnabled, reason: backendEnabled ? '' : '已暂停' }, code = 200;
    if (url.includes('/api/session')) body = { token: 'local-test-token', scope: 'capture' };
    if (url.endsWith('/api/capture-toggle') && options.method === 'POST') {
      backendEnabled = JSON.parse(options.body).enabled;
      body = { enabled: backendEnabled, reason: backendEnabled ? '' : '用户暂停' };
      if (options.method === 'POST' && options.body.includes('true')) {
        // Tests may inject a newer restriction while an explicit resume is in flight.
        if (sandbox.onResume) sandbox.onResume(state);
      }
    }
    if (url.endsWith('/api/capture-event')) { backendEnabled = false; body = { enabled: false, reason: '访问受限' }; }
    if (/\/api\/(ingest|list-ingest)$/.test(url)) {
      code = backendEnabled ? ingestStatus : 409;
      body = code === 200 ? { ok: true } : { error: code === 409 ? 'capture_paused' : 'temporary_failure', reason: '已暂停' };
    }
    return { ok: code >= 200 && code < 300, status: code, json: async () => body };
  };
  const sandbox = { chrome, fetch, URL, AbortSignal, TextEncoder, crypto: webcrypto, console, onResume: options.onResume,
    importScripts(...names) { for (const name of names) vm.runInContext(source(name), context); },
  };
  context = vm.createContext(sandbox);
  vm.runInContext(source('background.js'), context);
  await settle();
  return {
    state, calls, setOnline(value) { online = value; }, setStatus(value) { ingestStatus = value; },
    setTab(value) { tab = { ...tab, ...value }; }, async navigate(value = {}) { tab = { ...tab, ...value }; navigationListener(tab.id, { status: 'loading', ...value }); await settle(); },
    setPage(value) { currentPage = value; }, gate(value) { scriptGate = value; },
    async send(msg, sender = popupSender) {
      return new Promise(resolve => { if (!listener(msg, sender, resolve)) resolve(null); });
    },
    posts() { return calls.requests.filter(c => /\/api\/(ingest|list-ingest)$/.test(c.url)); },
  };
}

test('new install is idle, list recording is off, and the manifest has no MAIN content script', async () => {
  const w = await worker();
  const s = await w.send({ type: 'PDD_GET_STATUS' });
  assert.equal(s.mode, 'manual');
  assert.equal(s.listEnabled, false);
  assert.equal(w.calls.scripts.length, 0);
  assert.equal(w.posts().length, 0);
  const manifest = JSON.parse(source('manifest.json'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.content_scripts.every(script => script.world === 'ISOLATED' && !script.js.includes('inject.js')));
  assert.ok(manifest.content_scripts.every(script => script.matches.every(pattern => !/^https:\/\/[^/]+\/\*$/.test(pattern))));
});

test('a read only creates a preview; explicit confirmation persists exactly that snapshot', async () => {
  const w = await worker();
  const result = await w.send({ type: 'PDD_CAPTURE_CURRENT' });
  await settle();
  assert.equal(result.ok, true);
  assert.equal(w.calls.scripts.length, 1);
  assert.equal(w.calls.scripts[0].world, 'MAIN');
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls.scripts[0].target)), { tabId: 1, frameIds: [0] });
  assert.equal(w.posts().length, 0);
  assert.equal(w.state.pddQueue?.length || 0, 0);
  assert.ok(result.preview);
  w.setPage(page({ goods: rawGoods(9900) })); // Confirmation must not rerun extraction.
  const confirmation = await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: result.preview.id, goods: { price: 999 } });
  await settle();
  assert.equal(confirmation.ok, true);
  assert.equal(w.posts().length, 1);
  assert.equal(w.calls.scripts.length, 1);
  const payload = JSON.parse(w.posts()[0].options.body);
  assert.equal(payload.goods_id, '123456');
  assert.equal(payload.price, .99);
  assert.equal(payload.captured_at, result.preview.captured_at);
  assert.equal(payload.field_sources.fields.price.raw_value, '99');
  assert.equal(w.state.pddTodayCount, 1);
  assert.ok(w.calls.requests.every(c => c.url.startsWith('http://127.0.0.1:5000/api/')));
  assert.equal(JSON.stringify(w.calls.scripts[0].args).includes('local-test-token'), false);
});

test('page messages cannot authorize manual or old automatic detail capture', async () => {
  const w = await worker();
  assert.equal(await w.send({ type: 'PDD_CAPTURE_CURRENT' }, pageSender()), null);
  assert.equal(await w.send({ type: 'PDD_CAPTURE_REQUEST', kind: 'goods', payload: rawGoods(99) }, pageSender()), null);
  assert.equal(await w.send({ type: 'PDD_SET_LIST_CAPTURE', enabled: true }, pageSender()), null);
  assert.equal(w.calls.scripts.length, 0);
  assert.equal(w.posts().length, 0);
});

test('manual capture rejects unrelated, order, and search pages', async () => {
  const w = await worker();
  for (const url of ['https://untrusted.example/goods.html?goods_id=123456', 'https://mobile.yangkeduo.com/order.html?goods_id=123456', LIST]) {
    w.setTab({ url });
    assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).ok, false);
  }
  assert.equal(w.calls.scripts.length, 0);
});

test('paused capture performs no page read', async () => {
  const w = await worker({ backendEnabled: false });
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
  assert.equal(w.calls.scripts.length, 0);
});

test('double clicks coalesce and navigation during collection cancels the save', async () => {
  const w = await worker();
  let release;
  w.gate(new Promise(resolve => { release = resolve; }));
  const pending = w.send({ type: 'PDD_CAPTURE_CURRENT' });
  await settle();
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).ok, false);
  w.setTab({ url: DETAIL.replace('123456', '999999') });
  release();
  assert.equal((await pending).ok, false);
  assert.equal(w.calls.scripts.length, 1);
  assert.equal(w.posts().length, 0);
});

test('manual offline queue survives worker restart without another page read', async () => {
  const state = {};
  const offline = await worker({ state, online: false });
  const { preview } = await offline.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal((await offline.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id })).queued, true);
  await settle();
  assert.equal(state.pddQueue.length, 1);
  assert.equal(state.pddQueue[0].mode, 'manual');
  const restarted = await worker({ state });
  assert.equal(state.pddQueue.length, 0);
  assert.equal(state.pddTodayCount, 1);
  assert.equal(restarted.calls.scripts.length, 0);
});

test('upgrade holds old queue and disables old list opt-in until explicit approval', async () => {
  const state = { pddListCaptureEnabled: true, pddQueue: [{ id: 'old', kind: 'goods', payload: { goods_id: '123456', title: '旧版商品', source_url: DETAIL, raw_init_data: { cookie: 'synthetic-secret' } } }] };
  const w = await worker({ state });
  const s = await w.send({ type: 'PDD_GET_STATUS' });
  assert.equal(s.held, 1);
  assert.equal(s.listEnabled, false);
  assert.equal(w.posts().length, 0);
  await w.send({ type: 'PDD_SYNC_PENDING' });
  await settle();
  assert.equal(w.posts().length, 1);
  assert.equal(w.calls.scripts.length, 0);
  assert.equal(w.posts()[0].options.body.includes('synthetic-secret'), false);
});

test('list collection requires explicit opt-in, a list page, and the active top frame', async () => {
  const w = await worker();
  const message = { type: 'PDD_LIST_CAPTURE', pageUrl: LIST, items: [{ goods_id: '123456', title: '测试列表商品', price: 1 }] };
  assert.equal((await w.send(message, pageSender(LIST))).ok, false);
  await w.send({ type: 'PDD_SET_LIST_CAPTURE', enabled: true });
  assert.equal((await w.send({ ...message, pageUrl: LIST + '&page=2' }, pageSender(LIST))).ok, false);
  assert.equal(await w.send(message, pageSender(DETAIL)), null);
  assert.equal(await w.send(message, { ...pageSender(LIST), frameId: 1 }), null);
  assert.equal(await w.send(message, { ...pageSender(LIST), tab: { id: 1, active: false } }), null);
  assert.equal((await w.send(message, pageSender(LIST))).ok, true);
  await settle();
  assert.equal(w.posts().length, 1);
  assert.equal(w.calls.scripts.length, 0);
});

test('enabling lists injects an isolated bridge only for the current list page', async () => {
  const w = await worker();
  w.setTab({ url: LIST });
  const result = await w.send({ type: 'PDD_SET_LIST_CAPTURE', enabled: true });
  assert.equal(result.ok, true);
  assert.equal(w.calls.scripts.length, 1);
  assert.equal(w.calls.scripts[0].world, 'ISOLATED');
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls.scripts[0].files)), ['policy.js', 'bridge.js']);
  assert.equal(w.posts().length, 0);
});

test('pause remains effective locally while the backend is offline', async () => {
  const w = await worker({ online: false });
  const result = await w.send({ type: 'PDD_SET_TOGGLE', enabled: false });
  assert.equal(result.ok, true);
  assert.equal(result.localOnly, true);
  assert.equal(w.state.pddCaptureEnabled, false);
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
  assert.equal(w.calls.scripts.length, 0);
});

test('turning list recording off holds queued list data, which can be explicitly synced', async () => {
  const w = await worker({ ingestStatus: 500 });
  await w.send({ type: 'PDD_SET_LIST_CAPTURE', enabled: true });
  await w.send({ type: 'PDD_LIST_CAPTURE', pageUrl: LIST, items: [{ goods_id: '123456', title: '列表商品' }] }, pageSender(LIST));
  await settle();
  await w.send({ type: 'PDD_SET_LIST_CAPTURE', enabled: false });
  const before = w.posts().length;
  w.setStatus(200);
  const s = await w.send({ type: 'PDD_GET_STATUS' });
  assert.equal(s.held, 1);
  assert.equal(w.posts().length, before);
  await w.send({ type: 'PDD_SYNC_PENDING' });
  await settle();
  assert.equal(w.posts().length, before + 1);
  assert.equal(w.state.pddListCaptureEnabled, false);
});

test('visible verification produces a stop event and no goods, then manual resume works', async () => {
  const w = await worker({ page: page({ title: '安全验证' }) });
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
  await settle();
  assert.equal(w.posts().length, 0);
  assert.equal(w.state.pddBackendEnabled, false);
  await w.send({ type: 'PDD_SET_TOGGLE', enabled: true });
  w.setPage(page({ goods: rawGoods(99) }));
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).ok, true);
});

test('clearing the queue, backend recovery and worker restart cannot clear a local restriction', async () => {
  const state = {};
  const w = await worker({ state, online: false, page: page({ title: '安全验证' }) });
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
  await w.send({ type: 'PDD_CLEAR_PENDING' });
  assert.equal(state.pddQueue.length, 0);
  assert.equal(state.pddRestricted, true);
  const restarted = await worker({ state });
  const s = await restarted.send({ type: 'PDD_GET_STATUS' });
  assert.equal(s.backendEnabled, false);
  assert.equal((await restarted.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
  assert.equal(restarted.calls.scripts.length, 0);
  await restarted.send({ type: 'PDD_SET_TOGGLE', enabled: true });
  assert.equal((await restarted.send({ type: 'PDD_CAPTURE_CURRENT' })).ok, true);
});

test('a newer verification signal cannot be cleared by an older resume operation', async () => {
  const state = { pddCapturePolicyVersion: 1, pddRestricted: true, pddRestrictionId: 'old', pddRestrictionReason: '验证' };
  const w = await worker({ state, onResume(s) { Object.assign(s, { pddRestricted: true, pddRestrictionId: 'new', pddRestrictionReason: '新的验证' }); } });
  assert.equal((await w.send({ type: 'PDD_SET_TOGGLE', enabled: true })).ok, false);
  assert.equal(state.pddRestricted, true);
  assert.equal((await w.send({ type: 'PDD_CAPTURE_CURRENT' })).paused, true);
});

test('bad data remains visible as failed pending data and clear requires a popup message', async () => {
  const w = await worker({ ingestStatus: 400 });
  const { preview } = await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id });
  await settle();
  assert.equal(w.state.pddQueue[0].failed, true);
  assert.equal(await w.send({ type: 'PDD_CLEAR_PENDING' }, pageSender()), null);
  await w.send({ type: 'PDD_CLEAR_PENDING' });
  assert.equal(w.state.pddQueue.length, 0);
});

test('canceling and reopening an unconfirmed preview never queues a product', async () => {
  const state = {};
  const w = await worker({ state });
  const { preview } = await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal(w.posts().length, 0);
  const reopened = await worker({ state });
  assert.equal((await reopened.send({ type: 'PDD_GET_STATUS' })).preview.id, preview.id);
  assert.equal(reopened.posts().length, 0);
  await reopened.send({ type: 'PDD_CANCEL_PREVIEW', id: preview.id });
  assert.equal((await reopened.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id })).ok, false);
  assert.equal(reopened.posts().length, 0);
});

test('diagnostic storage failure does not prevent preview confirmation or discard goods', async () => {
  const w = await worker({ failDiagnosticStorage: true, page: page({ title: '测试商品标题' }) });
  const result = await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal(result.ok, true);
  assert.ok(result.preview);
  assert.equal((await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: result.preview.id })).ok, true);
  await settle();
  assert.equal(w.posts().length, 1);
});

test('expired previews and refreshed documents cannot be confirmed', async () => {
  const w = await worker();
  let { preview } = await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  w.state.pddPreview.created -= 11 * 60 * 1000;
  assert.equal((await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id })).ok, false);
  ({ preview } = await w.send({ type: 'PDD_PREVIEW_CURRENT' }));
  await w.navigate();
  assert.equal((await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id })).ok, false);
  assert.equal(w.posts().length, 0);
});

test('a newer preview and paused capture block older confirmation', async () => {
  const w = await worker();
  const first = (await w.send({ type: 'PDD_PREVIEW_CURRENT' })).preview;
  const latest = (await w.send({ type: 'PDD_PREVIEW_CURRENT' })).preview;
  assert.equal((await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: first.id })).ok, false);
  await w.send({ type: 'PDD_SET_TOGGLE', enabled: false });
  assert.equal((await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: latest.id })).paused, true);
  assert.equal(w.posts().length, 0);
});

test('page messages cannot confirm or cancel a preview', async () => {
  const w = await worker();
  const { preview } = await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal(await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id }, pageSender()), null);
  assert.equal(await w.send({ type: 'PDD_CANCEL_PREVIEW', id: preview.id }, pageSender()), null);
  assert.equal(w.state.pddPreview.id, preview.id);
  await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id });
  await w.send({ type: 'PDD_CONFIRM_PREVIEW', id: preview.id });
  await settle();
  assert.equal(w.posts().length, 1);
});

test('missing fields and verification have different persistent diagnostic codes', async () => {
  const w = await worker({ page: page({ title: '测试商品标题' }) });
  await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal(w.state.pddDiagnostics[0].code, 'data_incomplete');
  assert.equal(w.state.pddRestricted || false, false);
  w.setPage(page({ title: '安全验证' }));
  await w.send({ type: 'PDD_PREVIEW_CURRENT' });
  assert.equal(w.state.pddDiagnostics[0].code, 'verification_required');
  assert.equal(w.state.pddRestricted, true);
  assert.equal(w.posts().length, 0);
});

function card(id, top = 10) {
  const img = { alt: '测试列表商品' + id, currentSrc: 'https://img.pddpic.com/' + id + '.png' };
  const node = { href: 'https://mobile.yangkeduo.com/goods.html?goods_id=' + id, innerText: '测试商品\n¥12.99\n已拼2万件',
    closest() { return node; }, querySelector() { return img; }, getAttribute() { return null; },
    getBoundingClientRect() { return { top, bottom: top + 50, left: 0, right: 100, width: 100, height: 50 }; },
  };
  return node;
}

async function listBridge(initial = {}, url = LIST) {
  const state = { pddCapturePolicyVersion: 2, ...initial };
  const timers = new Map(), changes = [], events = {}, messages = [], observers = [];
  let seq = 0, scans = 0;
  const document = {
    documentElement: {}, visibilityState: 'visible',
    querySelectorAll() { scans++; return [card('1'), card('2', 900)]; },
    addEventListener(type, fn) { events[type] = fn; }, removeEventListener(type) { delete events[type]; },
  };
  const context = vm.createContext({ URL, document, location: { href: url }, innerHeight: 800, innerWidth: 1200,
    setTimeout(fn) { const id = ++seq; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { events[type] = fn; }, removeEventListener(type) { delete events[type]; },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } },
    chrome: { storage: { local: { async get(defaults) { return { ...defaults, ...state }; } }, onChanged: { addListener(fn) { changes.push(fn); } } },
      runtime: { async sendMessage(msg) { messages.push(msg); return { ok: true, queued: true }; } } },
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(source('policy.js'), context);
  vm.runInContext(source('bridge.js'), context);
  await settle();
  return { messages, observers, document, events, get scans() { return scans; },
    async set(values) { Object.assign(state, values); for (const fn of changes) fn(Object.fromEntries(Object.keys(values).map(k => [k, { newValue: values[k] }])), 'local'); await settle(); },
    async tick() { const due = [...timers.values()]; timers.clear(); for (const fn of due) await fn(); await settle(); },
    async reload() { vm.runInContext(source('bridge.js'), context); await settle(); },
  };
}

test('isolated bridge is idle by default and during pre-migration initialization', async () => {
  for (const cfg of [{}, { pddCapturePolicyVersion: 0, pddListCaptureEnabled: true }]) {
    const b = await listBridge(cfg);
    await b.tick();
    assert.equal(b.scans, 0);
    assert.equal(b.observers.length, 0);
    assert.equal(b.messages.length, 0);
  }
});

test('opt-in list observer records visible cards only and stops immediately on disable', async () => {
  const b = await listBridge();
  await b.set({ pddListCaptureEnabled: true });
  await b.tick();
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].items.length, 1);
  assert.equal(b.messages[0].items[0].goods_id, '1');
  assert.equal(b.messages[0].items[0].price, 12.99);
  await b.reload();
  assert.equal(b.observers.length, 1);
  b.events.scroll();
  await b.set({ pddListCaptureEnabled: false });
  await b.tick();
  assert.equal(b.scans, 1);
  assert.ok(b.observers.every(o => !o.active));
});

test('list bridge does not read detail, order, login, or hidden pages', async () => {
  for (const url of [DETAIL, 'https://mobile.yangkeduo.com/order.html', 'https://mobile.yangkeduo.com/login.html']) {
    const b = await listBridge({ pddListCaptureEnabled: true }, url);
    await b.tick();
    assert.equal(b.scans, 0);
  }
  const b = await listBridge({ pddListCaptureEnabled: true });
  b.document.visibilityState = 'hidden';
  await b.tick();
  assert.equal(b.scans, 0);
  await b.set({ pddBackendEnabled: false });
  assert.ok(b.observers.every(o => !o.active));
});

async function popup(initial) {
  function element() { return { checked: false, disabled: false, textContent: '', children: [], handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; }, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } }; }
  const elements = Object.fromEntries([...source('popup.html').matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const messages = [];
  let state = { online: true, enabled: true, backendEnabled: true, listEnabled: false, canCapture: true, capturing: false,
    today: 0, queued: 0, held: 0, failed: 0, reason: '', error: '', ...initial };
  const context = vm.createContext({ document: { createElement: element, getElementById(id) { assert.ok(elements[id], id); return elements[id]; } }, confirm: () => true,
    chrome: { storage: { onChanged: { addListener() {} } }, runtime: { getManifest: () => ({ version: '1.3.0' }), async sendMessage(msg) {
      messages.push(msg);
      if (msg.type === 'PDD_GET_STATUS') return state;
      if (msg.type === 'PDD_SET_TOGGLE') state = { ...state, enabled: msg.enabled, backendEnabled: msg.enabled };
      if (msg.type === 'PDD_PREVIEW_CURRENT') state = { ...state, preview: { id: 'preview-test', captured_at: new Date().toISOString(), page_key: DETAIL, goods: page({ goods: rawGoods(99) }).run().goods, missing: ['SKU'] } };
      if (msg.type === 'PDD_CONFIRM_PREVIEW' || msg.type === 'PDD_CANCEL_PREVIEW') state = { ...state, preview: null };
      return { ok: true, queued: true, title: '测试商品', missing: ['SKU'] };
    } } },
  });
  vm.runInContext(source('popup.js'), context);
  await settle();
  return { elements, messages, async trigger(id, event) { await elements[id].handlers[event](); await settle(); } };
}

test('popup reading presents a preview and requires the separate confirmation button', async () => {
  const p = await popup();
  assert.equal(p.messages.some(m => m.type === 'PDD_CAPTURE_CURRENT'), false);
  assert.equal(p.elements.capture.disabled, false);
  await p.trigger('capture', 'click');
  assert.equal(p.messages.filter(m => m.type === 'PDD_PREVIEW_CURRENT').length, 1);
  assert.equal(p.messages.filter(m => m.type === 'PDD_CONFIRM_PREVIEW').length, 0);
  assert.match(p.elements.previewMissing.textContent, /SKU/);
  await p.trigger('confirmPreview', 'click');
  assert.equal(p.messages.filter(m => m.type === 'PDD_CONFIRM_PREVIEW').length, 1);
});

test('backend pause renders an off switch that can be resumed with one user action', async () => {
  const p = await popup({ backendEnabled: false, reason: '访问受限' });
  assert.equal(p.elements.toggle.checked, false);
  assert.equal(p.elements.capture.disabled, true);
  p.elements.toggle.checked = true;
  await p.trigger('toggle', 'change');
  assert.equal(p.messages.filter(m => m.type === 'PDD_SET_TOGGLE').length, 1);
  assert.equal(p.messages.find(m => m.type === 'PDD_SET_TOGGLE').enabled, true);
  assert.equal(p.elements.capture.disabled, false);
});
