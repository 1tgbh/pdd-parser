'use strict';
const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const countEl = document.getElementById('count');
const toggle = document.getElementById('toggle');
const listToggle = document.getElementById('listToggle');
const capture = document.getElementById('capture');
const syncPending = document.getElementById('syncPending');
const clearPending = document.getElementById('clearPending');
const feedback = document.getElementById('feedback');
const tip = document.getElementById('tip');
const pageHint = document.getElementById('pageHint');
const confirmPreview = document.getElementById('confirmPreview');
const cancelPreview = document.getElementById('cancelPreview');
let state;
let busy = false;
let refreshSequence = 0;
document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;

function render(s) {
  state = s;
  dot.className = 'dot ' + (s.online ? 'on' : 'off');
  statusText.textContent = s.online ? (s.backendEnabled ? '已连接' : '后端已暂停') : '未连接';
  countEl.textContent = s.today;
  toggle.checked = s.enabled && s.backendEnabled;
  listToggle.checked = s.listEnabled;
  const allowed = s.enabled && s.backendEnabled;
  toggle.disabled = busy;
  listToggle.disabled = busy;
  capture.disabled = busy || s.capturing || !s.canCapture || !allowed;
  syncPending.disabled = busy || !s.queued || !allowed;
  clearPending.disabled = busy || !s.queued || s.capturing;
  pageHint.textContent = s.canCapture ? '先读取并核对字段，点击“确认保存”后才同步入库。' : '请手动打开拼多多商品详情页，再打开此弹窗。';
  document.getElementById('queueStatus').textContent = `待同步：${s.queued} 条（待确认 / 暂停 ${s.held}，失败 ${s.failed}）`;
  tip.textContent = !s.enabled ? '保存和同步已在扩展中暂停。' : s.reason || s.error || (s.online ? '已入库数量见“今日已保存详情”。' : '后端离线时，可先保存到扩展待传队列；启动后端后自动重传已确认的数据。');
  renderPreview(s.preview, allowed && !s.previewExpired);
  const diagnostics = document.getElementById('diagnosticItems');
  diagnostics.replaceChildren();
  if (!s.diagnostics?.length) diagnostics.textContent = '暂无异常记录';
  for (const item of s.diagnostics || []) {
    const row = document.createElement('div');
    row.className = 'diagnostic-item';
    const stages = { page_read: '页面读取', preview: '预览确认', sync: '本地同步' };
    row.textContent = `${new Date(item.occurred_at).toLocaleString()} · ${stages[item.stage] || item.stage} · ${item.message}。${item.hint}`;
    diagnostics.appendChild(row);
  }
}

function renderPreview(preview, allowed) {
  document.getElementById('previewCard').hidden = !preview;
  confirmPreview.disabled = busy || !preview || !allowed;
  cancelPreview.disabled = busy || !preview;
  if (!preview) return;
  const goods = preview.goods;
  document.getElementById('previewTitle').textContent = goods.title;
  document.getElementById('previewMeta').textContent = `商品 ${goods.goods_id} · 实际读取 ${new Date(preview.captured_at).toLocaleString()}`;
  document.getElementById('previewUrl').textContent = preview.page_key;
  const table = document.getElementById('previewFields');
  table.replaceChildren();
  const origins = { page_state: '页面结构化字段', dom: '页面 DOM', derived: '由已读字段计算', unknown: '未获取' };
  for (const [field, label, value] of [
    ['price', '商品价格', goods.price > 0 ? `¥${goods.price.toFixed(2)}` : '未知'],
    ['original_price', '原价', goods.original_price > 0 ? `¥${goods.original_price.toFixed(2)}` : '未知'],
    ['main_images', '主图', `${goods.main_images?.length || 0} 张`],
    ['skus', 'SKU', `${goods.skus?.length || 0} 个（全量覆盖${goods.skus_complete ? '按页面数据确认' : '未确认'}）`],
  ]) {
    const row = document.createElement('tr');
    for (const text of [label, value, origins[goods.field_sources?.fields?.[field]?.origin] || '来源未验证']) {
      const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
    }
    table.appendChild(row);
  }
  const skus = document.getElementById('previewSkus');
  skus.replaceChildren();
  for (const sku of (goods.skus || []).slice(0, 50)) {
    const row = document.createElement('div');
    row.textContent = `${sku.sku_id || '未识别ID'} · ${(sku.specs || []).map(s => `${s.key}:${s.value}`).join(' / ')} · ${sku.price > 0 ? '¥' + sku.price.toFixed(2) : '价格未知'} · 库存${sku.stock ?? '未知'}`;
    skus.appendChild(row);
  }
  document.getElementById('previewMissing').textContent = state.previewExpired ? '预览已过期，请重新读取。' : preview.missing?.length ? '未读到或未确认：' + preview.missing.join('、') : '本次读取的字段已展示，请核对后保存。';
}

async function refresh(cached = false) {
  const sequence = ++refreshSequence;
  const s = await chrome.runtime.sendMessage({ type: 'PDD_GET_STATUS', cached });
  if (sequence !== refreshSequence) return;
  if (!s || s.ok === false) throw new Error(s?.error || '扩展后台不可用');
  render(s);
}

async function run(message, success) {
  if (busy) return;
  busy = true;
  if (state) render(state);
  feedback.textContent = '处理中…';
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '操作未完成');
    feedback.textContent = success(result);
  } catch (error) {
    feedback.textContent = error.message || '操作失败，请重试';
  } finally {
    busy = false;
    try { await refresh(); } catch (error) { tip.textContent = error.message; if (state) render(state); }
  }
}

capture.addEventListener('click', () => run({ type: 'PDD_PREVIEW_CURRENT' }, () => '预览已读取，尚未入库，请核对后确认。'));
confirmPreview.addEventListener('click', () => {
  if (state?.preview) run({ type: 'PDD_CONFIRM_PREVIEW', id: state.preview.id }, result => '已确认保存到同步队列：' + result.title);
});
cancelPreview.addEventListener('click', () => {
  if (state?.preview) run({ type: 'PDD_CANCEL_PREVIEW', id: state.preview.id }, () => '已取消预览，商品未入库。');
});
toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  run({ type: 'PDD_SET_TOGGLE', enabled }, result => enabled ? '已恢复，详情仍需点击保存。' : result.localOnly ? '已在扩展中暂停，后端状态暂未同步。' : '已暂停保存和同步。');
});
listToggle.addEventListener('change', () => {
  const enabled = listToggle.checked;
  run({ type: 'PDD_SET_LIST_CAPTURE', enabled }, result => enabled ? (result.refreshNeeded ? '列表开关已开启，请刷新店铺 / 搜索页。' : '已开启可见列表记录；详情仍需手动保存。') : '已关闭列表自动记录，待传列表数据暂停同步。');
});
syncPending.addEventListener('click', () => run({ type: 'PDD_SYNC_PENDING' }, () => '已确认同步已有数据，未重新访问商品页面。'));
clearPending.addEventListener('click', () => {
  if (state?.queued && confirm(`清理 ${state.queued} 条待传数据？已入库商品不受影响。`)) {
    run({ type: 'PDD_CLEAR_PENDING' }, () => '待传队列已清理。');
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['pddQueue', 'pddTodayCount', 'pddCaptureEnabled', 'pddBackendEnabled', 'pddRestricted', 'pddListCaptureEnabled', 'pddPreview', 'pddDiagnostics'].some(key => changes[key])) {
    refresh(true).catch(() => {});
  }
});
refresh().catch(error => { statusText.textContent = '不可用'; tip.textContent = error.message; });
