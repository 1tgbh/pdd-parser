// bridge.js - ISOLATED world 内容脚本
// 作用：在页面（MAIN world 的 inject.js）与扩展（background/popup）之间传话
//   1. 监听页面 postMessage 的采集成功事件 -> 转发给 background 计数/徽标
//   2. 把采集开关状态同步给页面（chrome.storage -> window.postMessage）
(function() {
  'use strict';

  function pushToggle(enabled) {
    window.postMessage({ type: 'PDD_CAPTURE_TOGGLE', enabled: enabled }, '*');
  }

  try {
    // 初始化：把当前开关状态发给页面
    chrome.storage.local.get({ pddCaptureEnabled: true }, function(cfg) {
      pushToggle(cfg.pddCaptureEnabled !== false);
    });

    // 开关变化时同步到页面
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area === 'local' && changes.pddCaptureEnabled) {
        pushToggle(changes.pddCaptureEnabled.newValue !== false);
      }
    });

    // 页面捕获成功事件 -> background
    window.addEventListener('message', function(ev) {
      var d = ev.data;
      if (!d || d.type !== 'PDD_CAPTURED') return;
      try { chrome.runtime.sendMessage(d); } catch(e) {}
    });
  } catch(e) {}
})();
