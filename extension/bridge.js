// Optional ISOLATED-world list recording. Defaults to idle; no MAIN-world hooks.
(function() {
  'use strict';
  if (globalThis.__PDD_LIST_BRIDGE_LOADED) return;
  globalThis.__PDD_LIST_BRIDGE_LOADED = true;
  let enabled = false;
  let observer = null;
  let timer = null;
  let inFlight = false;
  let dirty = false;
  let policyRead = 0;
  let lastUrl = location.href;
  const seen = new Map();

  function stop() {
    enabled = false;
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = null;
    window.removeEventListener('scroll', schedule, true);
    document.removeEventListener('visibilitychange', schedule);
  }

  async function applyPolicy() {
    const read = ++policyRead;
    const cfg = await chrome.storage.local.get({ ...PddPolicy.defaults, pddCapturePolicyVersion: 0 });
    if (read !== policyRead) return;
    stop();
    if (cfg.pddCapturePolicyVersion !== PddPolicy.version || cfg.pddListCaptureEnabled !== true || cfg.pddCaptureEnabled !== true || cfg.pddBackendEnabled !== true || cfg.pddRestricted === true) return;
    const root = document.documentElement;
    if (!root) { document.addEventListener('DOMContentLoaded', applyPolicy, { once: true }); return; }
    enabled = true;
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['href', 'src', 'srcset', 'data-goods-id', 'data-goodsid', 'data-title'] });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    document.addEventListener('visibilitychange', schedule);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!enabled || document.visibilityState !== 'visible' || !PddPolicy.list(location.href)) return;
    timer = setTimeout(scan, 350);
  }

  function readVisibleCards() {
    const items = new Map();
    const nodes = document.querySelectorAll('a[href*="goods_id="], a[href*="goodsID="], [data-goods-id], [data-goodsid]');
    for (const node of [...nodes].slice(0, 2000)) {
      const card = node.closest('[data-goods-id], [data-goodsid], article, li') || node;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue;
      const linked = PddPolicy.detail(node.href);
      const gid = linked?.goodsId || card.getAttribute('data-goods-id') || card.getAttribute('data-goodsid') || '';
      if (!/^\d{1,30}$/.test(gid)) continue;
      const img = card.querySelector('img');
      const text = (card.innerText || '').trim().slice(0, 3000);
      const title = (card.getAttribute('data-title') || img?.alt || card.getAttribute('title') || text.split('\n').find(s => s.trim().length >= 4 && !/^[¥￥\d]/.test(s.trim())) || '').trim().slice(0, 500);
      let image = img?.currentSrc || img?.src || '';
      if (image && !/^https?:\/\//.test(image)) image = '';
      if (!title && !image) continue;
      const price = text.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
      const sold = text.match(/(?:已拼|已售|销量)\s*(\d+(?:\.\d+)?)\s*(万|亿)?/);
      items.set(gid, { goods_id: gid, title, image, price: price ? Number(price[1]) : 0,
        sales: sold ? Math.round(Number(sold[1]) * (sold[2] === '亿' ? 100000000 : sold[2] === '万' ? 10000 : 1)) : 0 });
      if (items.size >= 100) break;
    }
    return [...items.values()];
  }

  async function scan() {
    timer = null;
    if (!enabled || document.visibilityState !== 'visible' || !PddPolicy.list(location.href)) return;
    if (inFlight) { dirty = true; return; }
    const url = location.href;
    if (lastUrl !== url) { seen.clear(); lastUrl = url; }
    inFlight = true;
    try {
      const items = readVisibleCards().filter(item => seen.get(item.goods_id) !== JSON.stringify(item));
      if (!items.length) return;
      const result = await chrome.runtime.sendMessage({ type: 'PDD_LIST_CAPTURE', pageUrl: url, items });
      if (result?.ok && url === location.href) {
        for (const item of items) seen.set(item.goods_id, JSON.stringify(item));
        while (seen.size > 500) seen.delete(seen.keys().next().value);
      }
    } catch { /* No retry that visits the site; future user scrolling may read it again. */ }
    finally {
      inFlight = false;
      if (dirty) { dirty = false; schedule(); }
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['pddCapturePolicyVersion', 'pddListCaptureEnabled', 'pddCaptureEnabled', 'pddBackendEnabled', 'pddRestricted'].some(key => changes[key])) {
      applyPolicy().catch(stop);
    }
  });
  applyPolicy().catch(stop);
})();
