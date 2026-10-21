/* 註冊 Service Worker，讓教師端（記錄頁、設定頁）可以安裝成「班級管理」App */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  // 只在 https 或 localhost 才能使用（GitHub Pages 是 https）
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 註冊失敗不影響網頁使用 */ });
  });
})();
