// Shared by the worker and ISOLATED content script; never installed in page MAIN world.
(function(global) {
  'use strict';
  function pageUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password) return null;
      if (!['yangkeduo.com', 'pinduoduo.com'].some(d => u.hostname === d || u.hostname.endsWith('.' + d))) return null;
      return u;
    } catch { return null; }
  }
  function detail(raw) {
    const u = pageUrl(raw);
    if (!u || !/\/(goods|goods_detail)\.html$/.test(u.pathname)) return null;
    const goodsId = u.searchParams.get('goods_id') || u.searchParams.get('goodsID') || '';
    if (!/^\d{1,30}$/.test(goodsId)) return null;
    return { goodsId, url: u.href, key: u.origin + u.pathname + '?goods_id=' + goodsId };
  }
  function list(raw) {
    const u = pageUrl(raw);
    if (!u) return null;
    const source = new URL(u.href);
    for (const key of [...source.searchParams.keys()]) if (!['mall_id', 'mallID', 'search_key'].includes(key)) source.searchParams.delete(key);
    source.hash = '';
    if (/\/(mall_page|pdd_mall)\.html$/.test(u.pathname) || /^\/mall\/[^/]+\/?$/.test(u.pathname)) return { type: 'mall', url: u.href, sourceUrl: source.href };
    if (/\/(search_result|search)\.html$/.test(u.pathname) || u.pathname === '/search') return { type: 'search', url: u.href, sourceUrl: source.href };
    return null;
  }
  const defaults = Object.freeze({ pddCaptureEnabled: true, pddBackendEnabled: true, pddListCaptureEnabled: false, pddRestricted: false });
  function sendable(item, cfg) {
    if (!item || !['goods', 'list', 'event'].includes(item.kind) || item.failed) return false;
    if (item.kind === 'event') return true;
    if (cfg.pddCaptureEnabled !== true || cfg.pddBackendEnabled !== true || cfg.pddRestricted === true) return false;
    if ((item.mode === 'manual' && item.preview_confirmed === true) || item.approved === true) return true;
    return item.kind === 'list' && item.mode === 'list' && cfg.pddListCaptureEnabled === true;
  }
  global.PddPolicy = Object.freeze({ version: 2, defaults, detail, list, sendable });
})(globalThis);
