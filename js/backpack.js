/*
 * 抽籤頁：卡片背包
 * 打開背包 → 選座號 → 看卡片 → 點卡片放大 → 「使用這張卡」（需要導師碼）。
 * 再抽一次：使用後自動送 1 張抽籤券。
 * 幸運女神：使用前先從其他卡片挑一張，挑到的卡放進同一位同學的背包。
 * 回收換券：勾選 3 張未使用的卡（卡名可以相同）→ 換 1 張抽籤券（需要導師碼）。
 * 「復原」只在設定頁提供（導師專用）。
 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };

  var CARD_REDRAW = '再抽一次';
  var CARD_LUCKY = '幸運女神';
  var RECYCLED = '已回收';
  var RECYCLE_COUNT = 3;  // 和後端 RECYCLE_COUNT 一致

  var hooks = null;   // 由 lottery.js 提供：getSeats、getSelected、getBagCounts、isIdle、onUsed、onRecycled、onChanged、sfx
  var st = { seat: null, cards: [], choices: [], counts: {}, busy: false, loadSeq: 0 };

  function init(opts) {
    hooks = opts;
    $('btnBag').addEventListener('click', function () { open(hooks.getSelected()); });
    $('btnBagClose').addEventListener('click', close);
    $('bagOverlay').addEventListener('click', function (e) { if (e.target === this) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('bagOverlay').hidden && !document.querySelector('.gate')) close();
    });
  }

  function isOpen() { return !$('bagOverlay').hidden; }

  function open(seat) {
    if (!hooks.isIdle()) return;
    var seats = hooks.getSeats();
    if (!seats.length) { App.toast('尚未匯入名單。', 'error'); return; }
    st.seat = seats.indexOf(seat) !== -1 ? seat : null;
    st.counts = Object.assign({}, hooks.getBagCounts());
    $('bagOverlay').hidden = false;
    renderSeats();
    if (st.seat === null) {
      showMessage('請先點上方的座號，查看那位同學的卡片。');
    } else {
      load();
    }
    setTimeout(function () { $('btnBagClose').focus(); }, 50);
  }

  function close() {
    if (st.busy) return;
    $('bagOverlay').hidden = true;
    App.clear($('bagBody'));
    hooks.onChanged();
  }

  /* ============ 資料 ============ */
  async function load() {
    var seq = ++st.loadSeq;
    showMessage('讀取中…');
    try {
      var d = await App.api('getBackpack', { seat: st.seat });
      if (seq !== st.loadSeq) return; // 已切換到別的座號
      st.cards = d.cards;
      st.choices = d.choices;
      st.counts = d.counts || {};
      renderSeats();
      renderList();
    } catch (e) {
      if (seq !== st.loadSeq) return;
      showMessage('讀取失敗：' + App.errorText(e));
    }
  }

  /* ============ 畫面 ============ */
  function renderSeats() {
    var box = $('bagSeats');
    App.clear(box);
    hooks.getSeats().forEach(function (s) {
      var n = st.counts[s] || 0;
      box.appendChild(h('button', {
        type: 'button',
        class: 'bag-seat' + (s === st.seat ? ' selected' : ''),
        'aria-pressed': s === st.seat ? 'true' : 'false',
        'aria-label': s + ' 號，' + n + ' 張未使用的卡片',
        disabled: st.busy,
        onclick: function () { st.seat = s; renderSeats(); load(); }
      }, String(s), n ? h('i', { text: String(n) }) : null));
    });
  }

  function showMessage(text) {
    var body = $('bagBody');
    App.clear(body);
    body.appendChild(h('p', { class: 'bag-empty', text: text }));
  }

  /** 收藏卡牌造型的卡片（和揭曉時同一種）；opts.big 放大顯示、opts.onclick 可點擊 */
  function ticket(card, opts) {
    opts = opts || {};
    var recycled = card.status === RECYCLED;
    var used = card.status === '已使用' || recycled;
    var mark = recycled ? '已回收' : '已使用';
    var meta = opts.meta !== undefined ? opts.meta
      : used ? App.fmtMD(card.usedAt) + (recycled ? ' 回收' : ' 使用')
      : card.gotAt ? App.fmtMD(card.gotAt) + ' 取得' : '';
    var from = !used && card.source === CARD_LUCKY ? '🍀 幸運女神' : '';
    return LotteryFx.cardEl(card, {
      tag: opts.onclick ? 'button' : 'div',
      topLeft: meta,
      topRight: from,
      props: {
        type: opts.onclick ? 'button' : null,
        class: 'mini' + (opts.big ? ' big' : '') + (used ? ' used' : '') + (opts.cls ? ' ' + opts.cls : ''),
        onclick: opts.onclick || null,
        'aria-label': card.name + (used ? '，' + mark : '')
      },
      extra: used ? h('span', { class: 'stamp', 'aria-hidden': 'true', text: mark }) : null
    });
  }

  function renderList() {
    var body = $('bagBody');
    App.clear(body);
    var unused = st.cards.filter(function (c) { return c.status === '未使用'; });
    var used = st.cards.filter(function (c) { return c.status === '已使用'; });
    var recycled = st.cards.filter(function (c) { return c.status === RECYCLED; });
    body.appendChild(h('p', { class: 'bag-summary' },
      h('strong', { text: st.seat + ' 號' }), '　未使用 ', h('b', { text: String(unused.length) }), ' 張　・　已使用 ' + used.length + ' 張'
        + (recycled.length ? '　・　已回收 ' + recycled.length + ' 張' : '')));
    if (!st.cards.length) {
      body.appendChild(h('p', { class: 'bag-empty', text: '背包還是空的，抽到卡片後會自動放進來。' }));
      return;
    }
    var canRecycle = unused.length >= RECYCLE_COUNT;
    body.appendChild(h('div', { class: 'bag-actions' },
      h('button', { type: 'button', class: 'btn btn-recycle', disabled: !canRecycle, onclick: renderRecycle,
        text: '♻️ 回收 ' + RECYCLE_COUNT + ' 張換 1 張抽籤券' }),
      canRecycle ? null : h('span', { class: 'bag-hint', text: '（未使用的卡滿 ' + RECYCLE_COUNT + ' 張才能回收）' })));
    // 已使用與已回收混在一起，依時間新到舊（後端已排好）
    var done = st.cards.filter(function (c) { return c.status !== '未使用'; });
    var grid = h('div', { class: 'bag-grid' });
    unused.concat(done).forEach(function (c) {
      grid.appendChild(ticket(c, { onclick: function () { renderDetail(c); } }));
    });
    body.appendChild(grid);
  }

  function renderDetail(card) {
    var body = $('bagBody');
    App.clear(body);
    var used = card.status !== '未使用';
    var hint = card.status === RECYCLED ? '這張卡在 ' + App.fmtMD(card.usedAt) + ' ' + App.fmtHM(card.usedAt) + ' 回收換券了。'
      : used ? '這張卡在 ' + App.fmtMD(card.usedAt) + ' ' + App.fmtHM(card.usedAt) + ' 使用過了。'
      : card.name === CARD_REDRAW ? '使用後會自動送 ' + card.seat + ' 號 1 張抽籤券。'
      : card.name === CARD_LUCKY ? '使用時可以從其他卡片中挑一張，放進 ' + card.seat + ' 號的背包。'
      : '使用後請老師現場執行卡片內容。';
    body.appendChild(h('div', { class: 'bag-detail' },
      ticket(card, { big: true }),
      h('p', { class: 'bag-hint', text: hint }),
      h('div', { class: 'bag-actions' },
        h('button', { type: 'button', class: 'btn', text: '← 回到背包', onclick: renderList }),
        used ? null : h('button', {
          type: 'button', class: 'btn btn-use', text: card.name === CARD_LUCKY ? '使用：挑一張卡' : '使用這張卡',
          onclick: function () { card.name === CARD_LUCKY ? renderLucky(card) : useCard(card, null, this); }
        }))));
  }

  /** 幸運女神：列出可以挑的卡片 */
  function renderLucky(card) {
    var body = $('bagBody');
    App.clear(body);
    var picked = null;
    var confirmBtn = h('button', { type: 'button', class: 'btn btn-use', text: '確定選這張', disabled: true,
      onclick: function () { if (picked) useCard(card, picked.name, this); } });
    var grid = h('div', { class: 'bag-grid lucky' });
    st.choices.forEach(function (c) {
      var el = ticket({ name: c.name, description: c.description, status: '未使用' }, {
        meta: '',
        onclick: function () {
          picked = c;
          Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove('picked'); x.setAttribute('aria-pressed', 'false'); });
          el.classList.add('picked');
          el.setAttribute('aria-pressed', 'true');
          confirmBtn.disabled = false;
          confirmBtn.textContent = '確定選「' + c.name + '」';
        }
      });
      el.setAttribute('aria-pressed', 'false');
      grid.appendChild(el);
    });
    body.appendChild(h('p', { class: 'bag-summary' }, '🍀 幸運女神：請 ', h('strong', { text: card.seat + ' 號' }), ' 挑一張卡'));
    body.appendChild(grid);
    body.appendChild(h('div', { class: 'bag-actions sticky' },
      h('button', { type: 'button', class: 'btn', text: '← 返回', onclick: function () { renderDetail(card); } }),
      confirmBtn));
  }

  /* ============ 使用 ============ */
  async function useCard(card, choice, btn) {
    if (st.busy) return;
    st.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }
    try {
      var d = await App.teacherApi('useCard', { cardId: card.id, choice: choice || undefined });
      st.busy = false;
      // 先在本機更新卡片數：用掉 1 張；幸運女神會多 1 張挑到的卡
      st.counts[card.seat] = Math.max(0, (st.counts[card.seat] || 0) - 1 + (d.chosen ? 1 : 0));
      renderSeats();
      renderDone(d);
      hooks.onUsed(d);
    } catch (e) {
      st.busy = false;
      if (e.code === 'CANCELLED') {
        if (btn) { btn.disabled = false; btn.textContent = choice ? '確定選「' + choice + '」' : '使用這張卡'; }
        return;
      }
      App.toast(App.errorText(e), 'error');
      if (e.code === 'ALREADY_USED' || e.code === 'NOT_FOUND') { load(); return; }
      if (btn) { btn.disabled = false; btn.textContent = choice ? '確定選「' + choice + '」' : '使用這張卡'; }
    }
  }

  /** 使用成功：蓋上「已使用」印章，並顯示自動效果的結果 */
  function renderDone(d) {
    var body = $('bagBody');
    App.clear(body);
    var card = d.card;
    var t = ticket(card, { big: true, cls: 'stamping' });
    var info = [];
    if (d.granted) info.push(h('p', { class: 'bag-result' }, '🎟️ 已送 ', h('strong', { text: card.seat + ' 號' }), ' 1 張抽籤券，目前 ', h('strong', { text: String(d.balance) }), ' 張'));
    if (d.chosen) {
      info.push(h('p', { class: 'bag-result' }, '🍀 已把「', h('strong', { text: d.chosen.name }), '」放進 ' + card.seat + ' 號的背包'));
      info.push(ticket(d.chosen, { cls: 'pop-in' }));
    }
    if (!info.length) info.push(h('p', { class: 'bag-result', text: '請老師現場執行卡片內容。' }));
    body.appendChild(h('div', { class: 'bag-detail' }, t, info,
      h('div', { class: 'bag-actions' }, h('button', { type: 'button', class: 'btn btn-use', text: '回到背包', onclick: function () { load(); } }))));
    if (hooks.sfx) hooks.sfx(d.granted || d.chosen ? 'fanfare' : 'ding');
  }

  /* ============ 回收換券 ============ */
  /** 勾選要回收的卡：剛好 3 張才能確認；同名的卡可以一起選 */
  function renderRecycle() {
    var body = $('bagBody');
    App.clear(body);
    var unused = st.cards.filter(function (c) { return c.status === '未使用'; });
    var picked = [];
    var counter = h('b', { text: '0' });
    var confirmBtn = h('button', { type: 'button', class: 'btn btn-use', text: '確定回收', disabled: true,
      onclick: function () { if (picked.length === RECYCLE_COUNT) recycle(picked, this); } });
    var grid = h('div', { class: 'bag-grid' });
    unused.forEach(function (c) {
      var el = ticket(c, {
        onclick: function () {
          var i = picked.indexOf(c);
          if (i !== -1) picked.splice(i, 1);
          else if (picked.length < RECYCLE_COUNT) picked.push(c);
          else { App.toast('最多選 ' + RECYCLE_COUNT + ' 張，請先取消其中一張。', 'error'); return; }
          el.classList.toggle('picked', i === -1);
          el.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
          counter.textContent = String(picked.length);
          confirmBtn.disabled = picked.length !== RECYCLE_COUNT;
        }
      });
      el.setAttribute('aria-pressed', 'false');
      grid.appendChild(el);
    });
    body.appendChild(h('p', { class: 'bag-summary' }, '♻️ 請 ', h('strong', { text: st.seat + ' 號' }),
      ' 選 ' + RECYCLE_COUNT + ' 張不要的卡，換 1 張抽籤券　已選 ', counter, ' / ' + RECYCLE_COUNT));
    body.appendChild(grid);
    body.appendChild(h('div', { class: 'bag-actions sticky' },
      h('button', { type: 'button', class: 'btn', text: '← 返回', onclick: renderList }),
      confirmBtn));
  }

  async function recycle(cards, btn) {
    if (st.busy) return;
    var names = cards.map(function (c) { return '「' + c.name + '」'; }).join('、');
    if (!confirm('要回收 ' + cards[0].seat + ' 號的 ' + names + '，換 1 張抽籤券嗎？')) return;
    st.busy = true;
    btn.disabled = true;
    btn.textContent = '處理中…';
    try {
      var d = await App.teacherApi('recycleCards', { cardIds: cards.map(function (c) { return c.id; }) });
      st.busy = false;
      st.counts[d.seat] = Math.max(0, (st.counts[d.seat] || 0) - d.cards.length);
      renderSeats();
      renderRecycled(d);
      hooks.onRecycled(d);
    } catch (e) {
      st.busy = false;
      btn.textContent = '確定回收';
      if (e.code === 'CANCELLED') { btn.disabled = false; return; }
      App.toast(App.errorText(e), 'error');
      if (e.code === 'ALREADY_USED' || e.code === 'NOT_FOUND') { load(); return; }
      btn.disabled = false;
    }
  }

  /** 回收成功：3 張卡蓋上「已回收」印章，並顯示目前的券數 */
  function renderRecycled(d) {
    var body = $('bagBody');
    App.clear(body);
    var grid = h('div', { class: 'bag-grid' });
    d.cards.forEach(function (c) { grid.appendChild(ticket(c, { cls: 'stamping' })); });
    body.appendChild(h('div', { class: 'bag-detail' },
      h('p', { class: 'bag-result' }, '♻️ 已回收 ' + d.cards.length + ' 張，送 ', h('strong', { text: d.seat + ' 號' }),
        ' 1 張抽籤券，目前 ', h('strong', { text: String(d.balance) }), ' 張'),
      grid,
      h('div', { class: 'bag-actions' }, h('button', { type: 'button', class: 'btn btn-use', text: '回到背包', onclick: function () { load(); } }))));
    if (hooks.sfx) hooks.sfx('fanfare');
  }

  window.Backpack = { init: init, open: open, isOpen: isOpen };
})();
