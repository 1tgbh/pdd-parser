// Fixed messages only: diagnostic records never contain page text, cookies or tokens.
(function(global) {
  'use strict';
  const codes = {
    auth_required: ['需要登录', '请在平台页面检查登录状态，再明确恢复保存。'],
    verification_required: ['需要人工验证', '相关源侧操作已暂停，请人工检查后恢复。'],
    access_denied: ['访问被拒绝', '检查平台提示和权限；此记录不等于账号被封。'],
    rate_limited: ['请求频率受限', '暂停相关请求，遵守服务端冷却要求。'],
    data_incomplete: ['商品字段不完整', '检查预览中的未知字段，可补充本地导入。无需整批重采。'],
    structure_changed: ['页面结构暂不支持', '保留现有数据，检查页面是否加载完成或使用本地导入。'],
    page_changed: ['目标页面已切换', '在目标商品页重新读取并确认。'],
    preview_expired: ['预览已过期', '重新读取当前商品。过期预览不会入库。'],
    capture_paused: ['保存或同步已暂停', '人工检查后明确恢复，队列数据会继续保留。'],
    sync_unavailable: ['本地服务未连接', '启动或重启本地后端；已确认数据会保留在队列中。'],
    sync_failed: ['本地同步失败', '检查后端和字段格式，只重传已确认的数据。'],
    queue_full: ['待传队列已满', '先同步或清理已有待传数据，再确认保存。'],
  };
  function make(code, stage, context = {}) {
    const definition = codes[code];
    if (!definition) return null;
    let sourceUrl = '';
    try {
      const url = new URL(context.source_url);
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password) {
        for (const key of [...url.searchParams.keys()]) if (!['goods_id', 'goodsID', 'mall_id', 'mallID', 'search_key'].includes(key)) url.searchParams.delete(key);
        url.hash = '';
        sourceUrl = url.href.slice(0, 2000);
      }
    } catch { /* No source URL for local service errors. */ }
    return { id: crypto.randomUUID(), code, stage, message: definition[0], hint: definition[1],
      severity: code === 'data_incomplete' ? 'warning' : 'error', occurred_at: new Date().toISOString(),
      source_url: sourceUrl, goods_id: /^\d{1,30}$/.test(context.goods_id || '') ? context.goods_id : '',
      http_status: Number.isInteger(context.http_status) ? context.http_status : null, parser_version: '1.4.0',
      missing_fields: (context.missing_fields || []).filter(key => ['price', 'main_images', 'skus', 'title'].includes(key)) };
  }
  global.PddDiagnostics = Object.freeze({ make });
})(globalThis);
