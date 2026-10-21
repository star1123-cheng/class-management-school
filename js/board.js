/* 投影頁：固定 5 列，每 10 秒更新；連線失敗保留上次畫面 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };
  var SLOTS = 5;
  var POLL_MS = 10000;

  // 字級設定（以 1920×1080 的設計像素計）
  var NAME_MAX = 76, NAME_MIN = 56;
  var BIG_MAX = 130, BIG_MIN = 80;     // 缺交 1 至 10 人
  var SMALL_MAX = 96, SMALL_MIN = 64;  // 缺交 11 人以上
  var GAP_X = 8, GAP_Y = 2, PAD_X = 24;
  var CHIP_W = 1.45;                    // 卡片寬 = 字級 × 1.45

  var rows = [];
  var last = null;

  function buildRows() {
    var wrap = $('rows');
    for (var i = 0; i < SLOTS; i++) {
      var name = h('div', { class: 'board-name' }, h('div', { class: 'inner' }));
      var seats = h('div', { class: 'board-seats' });
      var row = h('section', { class: 'board-row' }, name, seats);
      wrap.appendChild(row);
      rows.push({ row: row, name: name, seats: seats });
    }
  }

  function scale() {
    return Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
  }

  function render(data) {
    var items = data.items || [];
    $('boardTitle').textContent = App.fmtMD(data.serverTime) + ' 缺交作業';
    $('emptyMsg').hidden = items.length > 0;
    rows.forEach(function (r, i) {
      var item = items[i];
      var inner = r.name.firstChild;
      inner.dataset.full = item ? item.name : '';
      r.name.title = item ? item.name : '';
      App.clear(r.seats);
      r.seats.dataset.count = item ? item.missing.length : 0;
      if (!item) return;
      // 尚未點收的作業：還不知道誰沒交，不能顯示成「全部交齊」
      if (item.recorded === false) {
        r.seats.dataset.count = 0;
        r.seats.appendChild(h('div', { class: 'board-pending', text: '尚未點收' }));
        return;
      }
      if (item.missing.length === 0) {
        r.seats.appendChild(h('div', { class: 'board-done', text: '全部交齊' }));
        return;
      }
      item.missing.forEach(function (s) {
        r.seats.appendChild(h('div', { class: 'chip', text: String(s) }));
      });
    });
    layout();
  }

  /** 依每列可用空間計算最大可用字級，保證全部座號可見 */
  function layout() {
    var s = scale();
    rows.forEach(function (r) {
      fitName(r.name);
      var n = Number(r.seats.dataset.count || 0);
      if (!n) return;
      var rect = r.seats.getBoundingClientRect();
      var W = rect.width / s - PAD_X * 2;
      var H = rect.height / s;
      var max = n <= 10 ? BIG_MAX : SMALL_MAX;
      var min = n <= 10 ? BIG_MIN : SMALL_MIN;
      var f = min;
      for (var size = max; size >= min; size -= 2) {
        var cw = size * CHIP_W;
        var perLine = Math.max(1, Math.floor((W + GAP_X) / (cw + GAP_X)));
        var lines = Math.ceil(n / perLine);
        if (lines * size + (lines - 1) * GAP_Y <= H) { f = size; break; }
      }
      r.seats.style.setProperty('--f', f);
    });
  }

  function fitName(el) {
    var size = NAME_MAX;
    el.style.setProperty('--nf', size);
    var inner = el.firstChild;
    var full = inner.dataset.full || '';
    inner.textContent = full;
    var over = function () { return inner.scrollHeight > el.clientHeight + 1; };
    while (size > NAME_MIN && over()) {
      size -= 4;
      el.style.setProperty('--nf', size);
    }
    // 最小字級仍放不下：從尾端截斷，補上「…」
    var len = full.length;
    while (len > 1 && over()) {
      len--;
      inner.textContent = full.slice(0, len) + '…';
    }
  }

  async function refresh() {
    try {
      var data = await App.api('getBoard');
      last = data;
      render(data);
      $('updatedAt').textContent = '更新於 ' + App.fmtHM(new Date());
      $('offline').hidden = true;
    } catch (e) {
      if (App.handleAuth(e)) return;
      // 保留上次畫面，只在角落顯示小字
      $('offline').hidden = false;
      if (!last) $('updatedAt').textContent = App.errorText(e);
    }
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (last) layout(); }, 150);
  });
  $('btnFull').addEventListener('click', App.toggleFullscreen);

  buildRows();
  App.requireCode().then(function (ok) {
    if (!ok) return;
    refresh();
    setInterval(refresh, POLL_MS);
  });
})();
