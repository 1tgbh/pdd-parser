// background.js - MV3 service worker
// 职责：采集计数与徽标、后端服务心跳检测、向 popup 提供状态
'use strict';

const BACKEND = 'http://127.0.0.1:5000';
const PING_ALARM = 'pddBackendPing';

// ---- 初始化 ----
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (cfg) => {
    const init = {};
    if (cfg.pddCaptureEnabled === undefined) init.pddCaptureEnabled = true;
    if (cfg.pddTodayCount === undefined) init.pddTodayCount = 0;
    if (cfg.pddTodayDate === undefined) init.pddTodayDate = '';
    if (Object.keys(init).length) chrome.storage.local.set(init);
  });
  chrome.alarms.create(PING_ALARM, { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PING_ALARM, { periodInMinutes: 0.5 });
  pingBackend();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === PING_ALARM) pingBackend();
});

// ---- 后端心跳 ----
async function pingBackend() {
  let online = false;
  let enabled = true;
  try {
    const r = await fetch(BACKEND + '/api/capture-toggle', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      online = true;
      enabled = j.enabled !== false;
    }
  } catch (e) {}
  await chrome.storage.local.set({
    pddBackendOnline: online,
    pddBackendEnabled: enabled,
  });
  updateBadge();
}

// ---- 采集计数 ----
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

async function bumpCount() {
  const cfg = await chrome.storage.local.get({ pddTodayCount: 0, pddTodayDate: '' });
  const today = todayKey();
  const count = cfg.pddTodayDate === today ? (cfg.pddTodayCount || 0) + 1 : 1;
  await chrome.storage.local.set({ pddTodayCount: count, pddTodayDate: today });
}

// ---- 徽标 ----
async function updateBadge() {
  const cfg = await chrome.storage.local.get({
    pddTodayCount: 0,
    pddTodayDate: '',
    pddCaptureEnabled: true,
    pddBackendOnline: false,
  });
  const today = todayKey();
  const count = cfg.pddTodayDate === today ? cfg.pddTodayCount || 0 : 0;
  const enabled = cfg.pddCaptureEnabled !== false;

  let text = count > 0 ? String(count) : '';
  if (count > 999) text = '999+';
  chrome.action.setBadgeText({ text });
  if (!cfg.pddBackendOnline) {
    chrome.action.setBadgeBackgroundColor({ color: '#9e9e9e' });
    if (!text) chrome.action.setBadgeText({ text: '!' });
  } else if (!enabled) {
    chrome.action.setBadgeBackgroundColor({ color: '#f57f17' });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#e02e24' });
  }
}

// ---- 消息 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PDD_CAPTURED') {
    bumpCount().then(updateBadge);
  } else if (msg && msg.type === 'PDD_PING') {
    pingBackend().then(() => sendResponse({ ok: true }));
    return true; // async sendResponse
  } else if (msg && msg.type === 'PDD_GET_STATUS') {
    (async () => {
      const cfg = await chrome.storage.local.get({
        pddTodayCount: 0,
        pddTodayDate: '',
        pddCaptureEnabled: true,
        pddBackendOnline: false,
        pddBackendEnabled: true,
      });
      sendResponse({
        online: cfg.pddBackendOnline,
        backendEnabled: cfg.pddBackendEnabled,
        enabled: cfg.pddCaptureEnabled !== false,
        today: cfg.pddTodayDate === todayKey() ? cfg.pddTodayCount || 0 : 0,
      });
    })();
    return true;
  }
  return false;
});

// 启动时先自检一次
pingBackend();
updateBadge();
