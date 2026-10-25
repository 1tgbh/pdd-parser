// popup.js - 扩展弹窗：状态展示 + 采集开关 + 入口
'use strict';
const BACKEND = 'http://127.0.0.1:5000';

const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const countEl = document.getElementById('count');
const toggle = document.getElementById('toggle');
const tip = document.getElementById('tip');
document.getElementById('ver').textContent =
  'v' + chrome.runtime.getManifest().version;

function render(s) {
  dot.className = 'dot ' + (s.online ? 'on' : 'off');
  statusText.textContent = s.online
    ? (s.backendEnabled === false ? '已连接（后端暂停采集）' : '已连接')
    : '未连接';
  countEl.textContent = s.today;
  toggle.checked = s.enabled;
  if (!s.online) {
    tip.innerHTML = '<span class="warn">未检测到本地服务，请先运行 start.bat 启动后端。</span>';
  } else {
    tip.textContent = '浏览商品页时自动捕获数据，无需其他操作。';
  }
}

async function refresh() {
  // 先直接探一次后端（最实时），再取 storage 里的统计
  let online = false, backendEnabled = true;
  try {
    const r = await fetch(BACKEND + '/api/capture-toggle', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      online = true;
      backendEnabled = j.enabled !== false;
    }
  } catch (e) {}
  const cfg = await chrome.storage.local.get({
    pddTodayCount: 0, pddTodayDate: '', pddCaptureEnabled: true,
  });
  const d = new Date();
  const today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  render({
    online,
    backendEnabled,
    enabled: cfg.pddCaptureEnabled !== false,
    today: cfg.pddTodayDate === today ? cfg.pddTodayCount || 0 : 0,
  });
  chrome.runtime.sendMessage({ type: 'PDD_PING' });
}

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  await chrome.storage.local.set({ pddCaptureEnabled: enabled });
  try {
    await fetch(BACKEND + '/api/capture-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  } catch (e) {}
});

refresh();
