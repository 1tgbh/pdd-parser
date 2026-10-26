// Manual collection is reachable only from our popup. The page cannot submit goods.
'use strict';
importScripts('policy.js', 'diagnostics.js', 'inject.js');

const BACKEND = 'http://127.0.0.1:5000';
const PING_ALARM = 'pddBackendPing';
const ENDPOINTS = { goods: '/api/ingest', list: '/api/list-ingest', event: '/api/capture-event' };
const GOODS_FIELDS = ['goods_id', 'title', 'subtitle', 'description', 'price', 'original_price', 'min_group_price', 'sales', 'sold_quantity', 'shop_name', 'shop_id', 'shop_logo', 'main_images', 'detail_images', 'sku_images', 'specs', 'skus', 'attributes', 'selling_points', 'capture_source', 'skus_complete', 'field_sources', 'parser_version'];
const MAX_QUEUE = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const PREVIEW_TTL = 10 * 60 * 1000;
let token = '';
let serial = Promise.resolve();
let backendTasks = Promise.resolve();
let pingTask;
let initialization;
let flushTask;
let clearing = false;
const capturingTabs = new Set();
const confirmingPreviews = new Set();
const navigations = new Map();
const previewSession = crypto.randomUUID();
let diagnosticTask;

async function diagnose(code, stage, context) {
  const entry = PddDiagnostics.make(code, stage, context);
  if (!entry) return;
  await serialized(async () => {
    const cfg = await chrome.storage.local.get({ pddDiagnostics: [], pddDiagnosticOutbox: [] });
    // Repeated heartbeats should not flood the diagnosis center.
    const latest = cfg.pddDiagnostics[0];
    if (latest && latest.code === entry.code && latest.stage === entry.stage && latest.goods_id === entry.goods_id && Date.now() - Date.parse(latest.occurred_at) < 60000) return;
    await chrome.storage.local.set({ pddDiagnostics: [entry, ...cfg.pddDiagnostics].slice(0, 100),
      pddDiagnosticOutbox: [...cfg.pddDiagnosticOutbox, entry].slice(-100) });
  }).catch(() => {}); // Diagnostic storage failure must not invalidate an accepted preview.
}

function syncDiagnostics() {
  if (diagnosticTask) return diagnosticTask;
  diagnosticTask = (async () => {
    const { pddDiagnosticOutbox = [] } = await chrome.storage.local.get('pddDiagnosticOutbox');
    if (!pddDiagnosticOutbox.length) return;
    const batch = pddDiagnosticOutbox.slice(0, 20);
    await localRequest('/api/diagnostics/events', { events: batch });
    const ids = new Set(batch.map(e => e.id));
    await serialized(async () => {
      const { pddDiagnosticOutbox = [] } = await chrome.storage.local.get('pddDiagnosticOutbox');
      await chrome.storage.local.set({ pddDiagnosticOutbox: pddDiagnosticOutbox.filter(e => !ids.has(e.id)) });
    });
  })().finally(() => { diagnosticTask = undefined; });
  return diagnosticTask;
}

function serialized(fn) {
  const next = serial.then(fn, fn);
  serial = next.catch(() => {});
  return next;
}

function backendOperation(fn) {
  const next = backendTasks.then(fn, fn);
  backendTasks = next.catch(() => {});
  return next;
}

function initialize() {
  if (!initialization) initialization = serialized(async () => {
    const cfg = await chrome.storage.local.get({ pddCapturePolicyVersion: 0, pddBackendEnabled: true, pddPauseReason: '', pddQueue: [] });
    if (cfg.pddCapturePolicyVersion !== PddPolicy.version) {
      // Old queue entries have no mode and stay held until explicit user approval.
      const migrated = { pddCapturePolicyVersion: PddPolicy.version, pddListCaptureEnabled: false,
        pddPreview: null, pddQueue: cfg.pddQueue.map(item => item.kind === 'goods' && item.preview_confirmed !== true ? { ...item, mode: 'legacy', approved: false } : item) };
      if (cfg.pddBackendEnabled === false && /受限|验证|登录|HTTP (401|403|429)/.test(cfg.pddPauseReason)) {
        Object.assign(migrated, { pddRestricted: true, pddRestrictionReason: cfg.pddPauseReason, pddRestrictionId: crypto.randomUUID(), pddRestrictionKind: /登录/.test(cfg.pddPauseReason) ? 'auth_required' : 'verification' });
      }
      await chrome.storage.local.set(migrated);
    }
  }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}

function fromPopup(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
}

function fromListPage(sender) {
  return sender.id === chrome.runtime.id && sender.tab && sender.tab.active && sender.frameId === 0 && PddPolicy.list(sender.url);
}

async function localRequest(path, body, refresh = true) {
  if (!token) {
    const r = await fetch(BACKEND + '/api/session?client=extension', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('本地服务认证失败，请重启后端');
    token = (await r.json()).token;
  }
  const r = await fetch(BACKEND + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-PDD-Token': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (r.status === 401 && refresh) { token = ''; return localRequest(path, body, false); }
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.error || '本地服务请求失败');
    error.status = r.status;
    error.data = data;
    throw error;
  }
  return data;
}

function todayKey() { return new Date().toLocaleDateString('sv-SE'); }

async function updateBadge() {
  const s = await chrome.storage.local.get({ ...PddPolicy.defaults, pddTodayCount: 0, pddTodayDate: '', pddBackendOnline: false });
  const count = s.pddTodayDate === todayKey() ? s.pddTodayCount : 0;
  await chrome.action.setBadgeText({ text: count ? (count > 999 ? '999+' : String(count)) : (s.pddBackendOnline ? '' : '!') });
  await chrome.action.setBadgeBackgroundColor({ color: !s.pddBackendOnline ? '#9e9e9e' : (!s.pddCaptureEnabled || !s.pddBackendEnabled || s.pddRestricted) ? '#f57f17' : '#e02e24' });
}

function pingBackend() {
  if (!pingTask) pingTask = backendOperation(readBackendState).finally(() => { pingTask = undefined; });
  return pingTask;
}

async function readBackendState() {
  await initialize();
  try {
    let state = await localRequest('/api/capture-toggle');
    const local = await chrome.storage.local.get({ pddRestricted: false, pddRestrictionKind: 'verification' });
    if (local.pddRestricted && state.enabled) {
      const kind = ['verification', 'auth_required', 'http_401', 'http_403', 'http_429'].includes(local.pddRestrictionKind) ? local.pddRestrictionKind : 'verification';
      state = await localRequest('/api/capture-event', { kind });
    }
    await chrome.storage.local.set({ pddBackendOnline: true, pddBackendEnabled: state.enabled, pddPauseReason: state.reason || '' });
    flushQueue().catch(() => {});
    syncDiagnostics().catch(() => {});
  } catch {
    await chrome.storage.local.set({ pddBackendOnline: false });
    await diagnose('sync_unavailable', 'sync');
  }
  await updateBadge();
}

function payloadFor(kind, input, sourceUrl) {
  const fields = kind === 'goods' ? GOODS_FIELDS : kind === 'list' ? ['items', 'page_type'] : ['kind'];
  const payload = Object.fromEntries(fields.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
  payload.source_url = sourceUrl;
  for (const key of ['capture_id', 'captured_at']) if (typeof input[key] === 'string') payload[key] = input[key];
  return payload;
}

async function enqueue(kind, input, sourceUrl, mode, previewId) {
  await initialize();
  if (!Object.hasOwn(ENDPOINTS, kind) || !input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '无效采集数据' };
  const payload = payloadFor(kind, input, sourceUrl);
  const text = JSON.stringify(payload);
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return { ok: false, error: '采集数据超过2MB，请使用本地导入' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(kind + mode + text));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const id = kind === 'event' ? hash + '-' + crypto.randomUUID() : hash;
  const result = await serialized(async () => {
    const cfg = await chrome.storage.local.get({ ...PddPolicy.defaults, pddQueue: [], pddPreview: null });
    if (previewId && cfg.pddPreview?.id !== previewId) return { ok: false, error: '预览已取消或替换，请重新读取' };
    if (previewId && cfg.pddPreview.session === previewSession && (navigations.get(cfg.pddPreview.tab_id) || 0) !== cfg.pddPreview.navigation) return { ok: false, error: '页面已刷新或切换，请重新读取' };
    if (clearing) return { ok: false, error: '待传队列正在清理，请稍后重试' };
    if (kind !== 'event' && (cfg.pddCaptureEnabled !== true || cfg.pddBackendEnabled !== true || cfg.pddRestricted === true)) return { ok: false, paused: true, error: '采集已暂停，请人工检查后恢复' };
    if (mode === 'list' && cfg.pddListCaptureEnabled !== true) return { ok: false, error: '列表自动记录未开启' };
    if (cfg.pddQueue.some(item => item.id === id && !item.failed)) return { ok: true, queued: true };
    if (kind !== 'event' && (cfg.pddQueue.length >= MAX_QUEUE || new TextEncoder().encode(JSON.stringify(cfg.pddQueue) + text).byteLength > 6 * 1024 * 1024)) {
      return { ok: false, error: '待传队列已满，请先同步或清理历史待传数据' };
    }
    const created = Date.now();
    const item = { id, mode, kind, preview_confirmed: !!previewId,
      payload: { ...payload, capture_id: payload.capture_id || id + '-' + created, captured_at: payload.captured_at || new Date(created).toISOString() }, created };
    // Coalesce restriction signals, keeping space for one even when the data queue is full.
    const queue = cfg.pddQueue.filter(old => old.id !== id && (kind !== 'event' || old.kind !== 'event'));
    queue.push(item);
    await chrome.storage.local.set({ pddQueue: queue, pddLastError: '', ...(previewId ? { pddPreview: null } : {}) });
    return { ok: true, queued: true };
  });
  if (result.ok) flushQueue().catch(() => {});
  return result;
}

function flushQueue() {
  if (flushTask) return flushTask;
  flushTask = drainQueue().finally(() => { flushTask = undefined; updateBadge().catch(() => {}); });
  return flushTask;
}

async function drainQueue() {
  await initialize();
  for (;;) {
    if (clearing) return;
    const cfg = await chrome.storage.local.get({ ...PddPolicy.defaults, pddQueue: [] });
    const eligible = cfg.pddQueue.filter(item => PddPolicy.sendable(item, cfg));
    const item = eligible.find(i => i.kind === 'event') || eligible[0];
    if (!item) return;
    try {
      const body = payloadFor(item.kind, item.payload, item.payload.source_url);
      const result = await localRequest(ENDPOINTS[item.kind], body);
      if (item.kind === 'event') await chrome.storage.local.set({ pddBackendEnabled: false, pddPauseReason: result.reason });
    } catch (e) {
      if (e.status === 409 && e.data?.error === 'capture_paused') {
        await chrome.storage.local.set({ pddBackendEnabled: false, pddPauseReason: e.data.reason });
        return;
      }
      await diagnose(!e.status ? 'sync_unavailable' : 'sync_failed', 'sync', { goods_id: item.payload.goods_id, source_url: item.payload.source_url, http_status: e.status });
      if (!e.status || e.status >= 500 || e.status === 429 || e.status === 401) return;
      await serialized(async () => {
        const { pddQueue = [] } = await chrome.storage.local.get('pddQueue');
        await chrome.storage.local.set({ pddLastError: e.message, pddQueue: pddQueue.map(i => i.id === item.id ? { ...i, failed: true } : i) });
      });
      continue;
    }
    await serialized(async () => {
      const cfg = await chrome.storage.local.get({ pddQueue: [], pddTodayIds: [], pddTodayDate: '' });
      const ids = cfg.pddTodayDate === todayKey() ? cfg.pddTodayIds : [];
      if (item.kind === 'goods' && !ids.includes(item.payload.goods_id)) ids.push(item.payload.goods_id);
      await chrome.storage.local.set({ pddQueue: cfg.pddQueue.filter(i => i.id !== item.id), pddTodayIds: ids.slice(-5000), pddTodayCount: ids.length, pddTodayDate: todayKey() });
    });
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureCurrent() {
  const tab = await activeTab();
  const target = PddPolicy.detail(tab?.url);
  if (!target || !Number.isInteger(tab.id)) return { ok: false, error: '请先手动打开拼多多商品详情页，再点击保存' };
  const cfg = await chrome.storage.local.get(PddPolicy.defaults);
  if (cfg.pddCaptureEnabled !== true || cfg.pddBackendEnabled !== true || cfg.pddRestricted === true) return { ok: false, paused: true, error: '采集已暂停，请人工检查后恢复' };
  if (capturingTabs.has(tab.id)) return { ok: false, error: '当前商品正在保存，请稍候' };
  capturingTabs.add(tab.id);
  const navigation = navigations.get(tab.id) || 0;
  try {
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN', func: collectCurrentProduct, args: [target] });
    const result = frames.find(frame => frame.frameId === 0)?.result;
    const current = await chrome.tabs.get(tab.id);
    if ((navigations.get(tab.id) || 0) !== navigation || PddPolicy.detail(current.url)?.key !== target.key || (result?.pageUrl && PddPolicy.detail(result.pageUrl)?.key !== target.key)) {
      await diagnose('page_changed', 'page_read', { goods_id: target.goodsId, source_url: target.key });
      return { ok: false, error: '页面已切换，本次未保存，请重新点击' };
    }
    if (['verification', 'auth_required', 'http_401', 'http_403', 'http_429'].includes(result?.restriction)) {
      await chrome.storage.local.set({ pddBackendEnabled: false, pddPauseReason: result.error, pddRestricted: true,
        pddRestrictionReason: result.error, pddRestrictionId: crypto.randomUUID(), pddRestrictionKind: result.restriction });
      await enqueue('event', { kind: result.restriction }, target.key, 'manual');
      await diagnose(({ verification: 'verification_required', auth_required: 'auth_required', http_401: 'auth_required', http_403: 'access_denied', http_429: 'rate_limited' })[result.restriction], 'page_read',
        { goods_id: target.goodsId, source_url: target.key, http_status: Number(result.restriction.slice(5)) || null });
      return { ok: false, paused: true, error: result.error };
    }
    if (!result?.ok) {
      await diagnose(result?.code === 'auth_required' ? 'auth_required' : result?.code === 'data_incomplete' ? 'data_incomplete' : 'structure_changed', 'page_read', { goods_id: target.goodsId, source_url: target.key });
      return { ok: false, error: result?.error || '当前页面没有返回可保存的商品数据' };
    }
    if (result.goods?.goods_id !== target.goodsId) return { ok: false, error: '商品标识不匹配，本次未保存' };
    const latest = await activeTab();
    if (latest?.id !== tab.id || PddPolicy.detail(latest.url)?.key !== target.key) return { ok: false, error: '当前标签页已切换，请重新读取' };
    const goods = payloadFor('goods', result.goods, target.key);
    if (new TextEncoder().encode(JSON.stringify(goods)).byteLength > MAX_BYTES) return { ok: false, error: '商品数据过大，请使用本地导入' };
    const preview = { id: crypto.randomUUID(), tab_id: tab.id, page_key: target.key, created: Date.now(),
      captured_at: new Date().toISOString(), goods, missing: result.missing || [], version: '1.4.0', session: previewSession, navigation };
    await serialized(async () => {
      if ((navigations.get(tab.id) || 0) !== navigation) throw new Error('页面已刷新');
      await chrome.storage.local.set({ pddPreview: preview });
    });
    if (preview.missing.length) await diagnose('data_incomplete', 'preview', { goods_id: target.goodsId, source_url: target.key,
      missing_fields: preview.missing.map(label => ({ 价格: 'price', 主图: 'main_images', SKU: 'skus' })[label]).filter(Boolean) });
    return { ok: true, preview };
  } catch {
    await diagnose('structure_changed', 'page_read', { goods_id: target.goodsId, source_url: target.key });
    return { ok: false, error: '无法读取当前商品页，请重新打开扩展弹窗后再试' };
  } finally { capturingTabs.delete(tab.id); }
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'loading' && !change.url) return;
  navigations.set(tabId, (navigations.get(tabId) || 0) + 1);
  serialized(async () => {
    const { pddPreview } = await chrome.storage.local.get('pddPreview');
    if (pddPreview?.tab_id === tabId) await chrome.storage.local.set({ pddPreview: null });
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  navigations.delete(tabId);
  serialized(async () => {
    const { pddPreview } = await chrome.storage.local.get('pddPreview');
    if (pddPreview?.tab_id === tabId) await chrome.storage.local.set({ pddPreview: null });
  }).catch(() => {});
});

async function confirmPreview(id) {
  if (typeof id !== 'string' || confirmingPreviews.has(id)) return { ok: false, error: '预览正在确认，请稍候' };
  confirmingPreviews.add(id);
  try {
    const { pddPreview: preview } = await chrome.storage.local.get('pddPreview');
    if (!preview || preview.id !== id) return { ok: false, error: '预览不存在或已替换，请重新读取' };
    if (Date.now() - preview.created > PREVIEW_TTL) {
      await diagnose('preview_expired', 'preview', { goods_id: preview.goods.goods_id, source_url: preview.page_key });
      return { ok: false, error: '预览超过10分钟，请重新读取后确认' };
    }
    const tab = await activeTab();
    if (tab?.id !== preview.tab_id || PddPolicy.detail(tab.url)?.key !== preview.page_key) {
      await diagnose('page_changed', 'preview', { goods_id: preview.goods.goods_id, source_url: preview.page_key });
      return { ok: false, error: '目标页面已切换，本次未保存' };
    }
    const result = await enqueue('goods', { ...preview.goods, capture_id: id, captured_at: preview.captured_at }, preview.page_key, 'manual', id);
    if (!result.ok) await diagnose(result.paused ? 'capture_paused' : 'queue_full', 'preview', { goods_id: preview.goods.goods_id, source_url: preview.page_key });
    return { ...result, title: preview.goods.title, missing: preview.missing };
  } finally { confirmingPreviews.delete(id); }
}

async function setToggle(enabled) {
  if (typeof enabled !== 'boolean') return { ok: false, error: '无效开关状态' };
  if (!enabled) await chrome.storage.local.set({ pddCaptureEnabled: false });
  return backendOperation(() => applyToggle(enabled));
}

async function applyToggle(enabled) {
  const { pddQueue = [], pddRestrictionId = '' } = await chrome.storage.local.get({ pddQueue: [], pddRestrictionId: '' });
  const oldEvents = new Set(pddQueue.filter(i => i.kind === 'event').map(i => i.id));
  await flushQueue();
  if (enabled && (await chrome.storage.local.get({ pddRestrictionId: '' })).pddRestrictionId !== pddRestrictionId) {
    return { ok: false, error: '出现了新的访问限制，请检查后再恢复' };
  }
  let state;
  try { state = await localRequest('/api/capture-toggle', { enabled }); }
  catch (error) {
    if (!enabled) return { ok: true, localOnly: true };
    throw error;
  }
  const resumed = await serialized(async () => {
    const cfg = await chrome.storage.local.get({ pddQueue: [], pddRestrictionId: '' });
    const cleared = enabled && cfg.pddRestrictionId === pddRestrictionId;
    await chrome.storage.local.set({ pddCaptureEnabled: enabled, pddBackendEnabled: state.enabled, pddPauseReason: state.reason || '',
      ...(cleared ? { pddRestricted: false, pddRestrictionReason: '' } : {}),
      pddQueue: enabled ? cfg.pddQueue.filter(i => !oldEvents.has(i.id)) : cfg.pddQueue });
    return !enabled || cleared;
  });
  return resumed ? { ok: true } : { ok: false, error: '出现了新的访问限制，请检查后再恢复' };
}

async function status(cached = false) {
  if (!cached) await pingBackend();
  const s = await chrome.storage.local.get({ ...PddPolicy.defaults, pddTodayCount: 0, pddTodayDate: '', pddBackendOnline: false, pddQueue: [], pddPauseReason: '', pddLastError: '', pddRestrictionReason: '', pddPreview: null, pddDiagnostics: [] });
  const tab = await activeTab();
  return { mode: 'manual', online: s.pddBackendOnline, enabled: s.pddCaptureEnabled, backendEnabled: s.pddBackendEnabled && !s.pddRestricted,
    listEnabled: s.pddListCaptureEnabled, canCapture: !!PddPolicy.detail(tab?.url), capturing: capturingTabs.has(tab?.id),
    today: s.pddTodayDate === todayKey() ? s.pddTodayCount : 0, queued: s.pddQueue.length,
    held: s.pddQueue.filter(i => !PddPolicy.sendable(i, s)).length, failed: s.pddQueue.filter(i => i.failed).length,
    reason: s.pddRestricted ? s.pddRestrictionReason : s.pddPauseReason, error: s.pddLastError,
    preview: s.pddPreview?.tab_id === tab?.id && s.pddPreview?.page_key === PddPolicy.detail(tab?.url)?.key ? s.pddPreview : null,
    previewExpired: !!s.pddPreview && Date.now() - s.pddPreview.created > PREVIEW_TTL,
    diagnostics: s.pddDiagnostics.slice(0, 8) };
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg) return false;
  let action;
  if (msg.type === 'PDD_LIST_CAPTURE' && fromListPage(sender)) action = async () => {
    const route = PddPolicy.list(sender.url);
    if (msg.pageUrl !== sender.url) return { ok: false, error: '列表页面已切换，本次未记录' };
    if (!Array.isArray(msg.items) || !msg.items.length || msg.items.length > 100) return { ok: false, error: '无效列表数据' };
    const result = await enqueue('list', { items: msg.items, page_type: route.type }, route.sourceUrl, 'list');
    if (!result.ok && result.error) await chrome.storage.local.set({ pddLastError: result.error });
    return result;
  };
  else if (fromPopup(sender)) {
    if (msg.type === 'PDD_GET_STATUS') action = () => status(msg.cached === true);
    else if (msg.type === 'PDD_PREVIEW_CURRENT' || msg.type === 'PDD_CAPTURE_CURRENT') action = captureCurrent;
    else if (msg.type === 'PDD_CONFIRM_PREVIEW') action = () => confirmPreview(msg.id);
    else if (msg.type === 'PDD_CANCEL_PREVIEW') action = () => serialized(async () => {
      const { pddPreview } = await chrome.storage.local.get('pddPreview');
      if (pddPreview?.id === msg.id && !confirmingPreviews.has(msg.id)) await chrome.storage.local.set({ pddPreview: null });
      return { ok: true };
    });
    else if (msg.type === 'PDD_SET_TOGGLE') action = () => setToggle(msg.enabled);
    else if (msg.type === 'PDD_SET_LIST_CAPTURE') action = async () => {
      if (typeof msg.enabled !== 'boolean') return { ok: false, error: '无效列表开关' };
      await chrome.storage.local.set({ pddListCaptureEnabled: msg.enabled, pddLastError: '' });
      let refreshNeeded = false;
      const tab = msg.enabled ? await activeTab() : null;
      if (tab && PddPolicy.list(tab.url)) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', files: ['policy.js', 'bridge.js'] });
        } catch { refreshNeeded = true; }
      }
      flushQueue().catch(() => {});
      return { ok: true, refreshNeeded };
    };
    else if (msg.type === 'PDD_SYNC_PENDING') action = async () => {
      await serialized(async () => {
        const { pddQueue = [] } = await chrome.storage.local.get('pddQueue');
        await chrome.storage.local.set({ pddQueue: pddQueue.map(i => ({ ...i, approved: true, failed: false })) });
      });
      flushQueue().catch(() => {});
      return { ok: true };
    };
    else if (msg.type === 'PDD_CLEAR_PENDING') action = async () => {
      clearing = true;
      try {
        if (flushTask) await flushTask;
        await serialized(() => chrome.storage.local.set({ pddQueue: [], pddLastError: '' }));
      } finally { clearing = false; }
      return { ok: true };
    };
  }
  if (!action) return false;
  initialize().then(action).then(respond, e => respond({ ok: false, error: e.message }));
  return true;
});

function start() {
  chrome.alarms.create(PING_ALARM, { periodInMinutes: 0.5 });
  pingBackend().catch(() => {});
}
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(() => {
  serialized(() => chrome.storage.local.set({ pddPreview: null })).then(start, () => {});
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === PING_ALARM) pingBackend().catch(() => {}); });
start();
