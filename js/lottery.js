/*
 * 抽籤頁邏輯與狀態機
 * 狀態：idle（待機）→ spinning（跑馬燈，等待後端結果）→ reveal（停定、撕紙、揭曉）→ idle
 *        任何錯誤 → error（可用同一個 requestId 重試）
 * 隨機結果一律由後端決定，前端只播動畫。
 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.APP_CONFIG || {};

  var PENDING_KEY = 'cms_pending_draw';
  var PREF_KEY = 'cms_lottery_prefs';
  var POLL_MS = 10000;
  var reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  var prefs = Object.assign({ music: true, sfx: true, volume: 80, short: false }, App.store.getJSON(PREF_KEY, {}));
  var data = null;
  var selected = null;
  var phase = 'idle';
  var cells = {};
  var resumeChecked = false;

  /* ---------- 跳過機制 ---------- */
  var skipped = false, skipResolve = null, skipPromise = Promise.resolve();
  function resetSkip() {
    skipped = false;
    skipPromise = new Promise(function (r) { skipResolve = r; });
  }
  function skip() {
    if (skipped || phase === 'idle' || phase === 'error') return;
    skipped = true;
    if (skipResolve) skipResolve();
  }
  function isSkipped() { return skipped; }
  function wait(ms) {
    if (skipped || ms <= 0) return Promise.resolve();
    return Promise.race([new Promise(function (r) { setTimeout(r, ms); }), skipPromise]);
  }

  function isShort() { return prefs.short || reducedMQ.matches; }
  function timing() {
    return isShort()
      ? { minFast: 250, decel: 700, pause: 200, fly: 300, tearSteps: 3, tearStep: 220, flip: 450, confetti: 2000 }
      : { minFast: 600, decel: 2600, pause: 500, fly: 650, tearSteps: 5, tearStep: 560, flip: 900, confetti: 3400 };
  }

  function savePrefs() { App.store.setJSON(PREF_KEY, prefs); }
  function balanceOf(seat) { return data && data.balances ? (data.balances[seat] || 0) : 0; }

  /* ============ 畫面 ============ */
  var RECENT_MAX = 10;   // 「最近抽中」最多顯示筆數（後端 getLottery 預設也回 10 筆）

  function renderAll() {
    renderNumbers();
    renderSeats();
    renderSelection();
    renderRecent();
    renderDrawButton();
  }

  function renderNumbers() {
    var grid = $('numGrid');
    if (grid.childElementCount !== data.pool.length) {
      App.clear(grid);
      cells = {};
      data.pool.forEach(function (p, i) {
        var el = h('div', { class: 'num', style: '--i:' + i, role: 'img' }, String(p.number));
        cells[p.number] = el;
        grid.appendChild(el);
      });
    }
    // 只顯示是否已抽，不標示實物或抽卡
    data.pool.forEach(function (p) {
      var el = cells[p.number];
      el.classList.toggle('drawn', p.drawn);
      el.setAttribute('aria-label', p.number + ' 號' + (p.drawn ? '，已抽' : ''));
    });
    $('poolStatus').textContent = data.remainingCount === 0
      ? '40 個號碼已全部抽完'
      : '剩下 ' + data.remainingCount + ' ／ ' + data.total + ' 個號碼';
  }

  function renderSeats() {
    var grid = $('seatGrid');
    App.clear(grid);
    if (!data.seats.length) {
      grid.appendChild(h('p', { style: 'grid-column:1/-1;color:var(--text-2)', text: '尚未匯入名單。' }));
    }
    if (selected !== null && (data.seats.indexOf(selected) === -1 || balanceOf(selected) < 1)) selected = null;
    var bag = data.bagCounts || {};
    data.seats.forEach(function (s) {
      var n = balanceOf(s);
      var cards = bag[s] || 0;
      grid.appendChild(h('button', {
        type: 'button',
        class: 'seat' + (s === selected ? ' selected' : ''),
        disabled: n < 1 || phase !== 'idle',
        'aria-pressed': s === selected ? 'true' : 'false',
        'aria-label': s + ' 號，' + n + ' 張券' + (cards ? '，背包 ' + cards + ' 張卡' : ''),
        onclick: function () { selected = s; renderSeats(); renderSelection(); renderDrawButton(); }
      }, h('b', { text: String(s) }), h('small', { text: n + ' 張' }),
        cards ? h('i', { class: 'bag-dot', title: '背包有 ' + cards + ' 張未使用的卡', text: String(cards) }) : null));
    });
  }

  function renderSelection() {
    var el = $('selInfo');
    App.clear(el);
    if (selected === null) {
      el.appendChild(document.createTextNode('請先選擇座號'));
      return;
    }
    el.appendChild(h('div', {}, '已選 ', h('strong', { text: String(selected) }), ' 號'));
    el.appendChild(h('div', {}, '剩 ', h('strong', { text: String(balanceOf(selected)) }), ' 張券'));
  }

  function renderRecent() {
    var ol = $('recent');
    App.clear(ol);
    var list = (data.recent || []).slice(0, RECENT_MAX);
    if (!list.length) {
      ol.appendChild(h('li', { class: 'empty', text: '還沒有人抽籤' }));
      return;
    }
    list.forEach(function (r) {
      ol.appendChild(h('li', {},
        h('span', { text: r.seat + ' 號' }),
        h('span', { class: 'r-no', text: 'No.' + r.number }),
        h('span', { class: 'r-name', text: r.name })));
    });
    // 螢幕較矮時放不下 10 筆：從最舊的開始拿掉，不壓縮行距、不切到半行
    var panel = ol.parentNode;
    while (ol.childElementCount > 1 && panel.scrollHeight > panel.clientHeight + 1) {
      ol.removeChild(ol.lastChild);
    }
  }

  function renderDrawButton() {
    var btn = $('btnDraw');
    var empty = data && data.remainingCount === 0;
    btn.classList.toggle('empty', !!empty);
    btn.textContent = empty ? '已全部抽完' : '抽';
    btn.disabled = !data || empty || phase !== 'idle' || selected === null || balanceOf(selected) < 1;
  }

  /* ============ 資料 ============ */
  async function refresh() {
    if (phase !== 'idle') return;   // 動畫播放中暫停輪詢
    try {
      var d = await App.api('getLottery', { limit: 10 });
      if (phase !== 'idle') return;
      data = d;
      renderAll();
      $('netMsg').hidden = true;
      if (!resumeChecked) { resumeChecked = true; checkResume(); }
    } catch (e) {
      if (App.handleAuth(e)) return;
      $('netMsg').hidden = false;
      if (!data) App.toast(App.errorText(e), 'error');
    }
  }

  /* ============ 抽籤流程 ============ */
  function startDraw() {
    if (phase !== 'idle' || !data || selected === null || balanceOf(selected) < 1 || data.remainingCount === 0) return;
    var requestId = App.newId();
    // 先記下 requestId：若動畫途中重新整理，可用同一個編號查回結果，不會重複扣券
    App.store.setJSON(PENDING_KEY, { classId: App.getClassId(), requestId: requestId, seat: selected, at: Date.now() });
    runDraw(requestId, selected);
  }

  async function runDraw(requestId, seat) {
    phase = 'spinning';
    resetSkip();
    renderSeats();
    renderDrawButton();
    var T = timing();
    $('btnSkipSpin').hidden = false;

    Music.setLevel(1.0, 3000);
    Sfx.startRoll(T.minFast + T.decel, 90, 180);

    var candidates = data.pool.filter(function (p) { return !p.drawn; }).map(function (p) { return p.number; });
    if (!candidates.length) candidates = data.pool.map(function (p) { return p.number; });
    var marquee = LotteryFx.createMarquee(cells, candidates);
    var t0 = performance.now();

    var outcome;
    try {
      outcome = { ok: true, r: await App.api('draw', { seat: seat, requestId: requestId }) };
    } catch (e) {
      outcome = { ok: false, e: e };
    }

    if (!outcome.ok) {
      marquee.cancel();
      Sfx.stopAll();
      Music.setLevel(0.3, 800);
      $('btnSkipSpin').hidden = true;
      if (App.handleAuth(outcome.e)) return;
      showError(outcome.e, requestId, seat);
      return;
    }
    var r = outcome.r;

    // 跑馬燈：由快到慢，停在抽中號碼
    await wait(Math.max(0, T.minFast - (performance.now() - t0)));
    await marquee.stopAt(r.number, T.decel, wait, isSkipped);
    Sfx.stopRoll();
    $('btnSkipSpin').hidden = true;
    phase = 'reveal';

    // 停定：停頓約 0.5 秒，音效靜音、音樂降到 10%
    var cell = cells[r.number];
    if (cell) cell.classList.add('picked');
    Music.setLevel(0.1, 250);
    await wait(T.pause);

    // 籤紙飛到中央並撕開
    openOverlay();
    var stage = $('stageArea');
    var paper = await LotteryFx.flyPaper(stage, cell, r.number, isSkipped() ? 0 : T.fly, wait);
    if (!isSkipped()) {
      Sfx.land();
      Sfx.startHeart(T.tearSteps * T.tearStep, 72, 150);
    }
    await LotteryFx.tearPaper(paper, T.tearSteps, T.tearStep, wait, isSkipped, function () { Sfx.tear(); });
    Sfx.stopHeart();
    marquee.clear();
    if (cell) cell.classList.remove('picked');

    reveal(r);
  }

  function reveal(r) {
    var T = timing();
    var instant = skipped;
    var stage = $('stageArea');
    App.clear(stage);
    $('btnSkip').hidden = true;
    $('btnNext').hidden = false;
    Music.setLevel(1.0, 400);

    if (r.type === '實物') {
      LotteryFx.revealPrize(stage, r, { reduced: reducedMQ.matches });
      Sfx.fanfare();
      if (!reducedMQ.matches) LotteryFx.confetti($('confetti'), T.confetti);
      stage.appendChild(h('p', { class: 'bag-note', text: '🎒 已放進 ' + r.seat + ' 號的卡片背包' }));
    } else {
      var flipMs = instant ? 0 : T.flip;
      LotteryFx.revealCard(stage, r, { flipMs: flipMs });
      Sfx.flip();
      setTimeout(function () { Sfx.ding(); }, flipMs * 0.6);
      stage.appendChild(h('p', { class: 'bag-note', style: '--delay:' + flipMs + 'ms', text: '🎒 已放進 ' + r.seat + ' 號的卡片背包' }));
    }
    // 抽到卡片或實物都會放進背包
    if (!r.replay) {
      data.bagCounts = data.bagCounts || {};
      data.bagCounts[r.seat] = (data.bagCounts[r.seat] || 0) + 1;
    }

    // 先在本機更新畫面資料，按「下一位」後再向後端同步
    var p = data.pool.find(function (x) { return x.number === r.number; });
    if (p) p.drawn = true;
    data.balances[r.seat] = r.balance;
    data.remainingCount = r.remainingCount;
    data.drawnCount = data.total - r.remainingCount;
    if (!r.replay) data.recent.unshift({ seat: r.seat, number: r.number, type: r.type, name: r.name, time: new Date().toISOString() });
    setTimeout(function () { $('btnNext').focus(); }, 50);
  }

  function next() {
    closeOverlay();
    App.store.remove(PENDING_KEY);
    phase = 'idle';
    Music.setLevel(0.3, 800);
    renderAll();
    refresh();
  }

  /* ============ 覆蓋層與訊息 ============ */
  function openOverlay() {
    App.clear($('stageArea'));
    $('overlay').hidden = false;
    $('btnSkip').hidden = false;
    $('btnNext').hidden = true;
  }
  function closeOverlay() {
    $('overlay').hidden = true;
    $('btnNext').hidden = true;
    App.clear($('stageArea'));
  }

  function messageBox(title, text, buttons) {
    openOverlay();
    $('btnSkip').hidden = true;
    var row = h('div', { class: 'row' });
    buttons.forEach(function (b) {
      row.appendChild(h('button', { type: 'button', class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: b.onclick }));
    });
    $('stageArea').appendChild(h('div', { class: 'msg-box', role: 'alertdialog' },
      h('h2', { text: title }), h('p', { text: text }), row));
    var first = row.querySelector('button');
    if (first) setTimeout(function () { first.focus(); }, 50);
  }

  function showError(err, requestId, seat) {
    phase = 'error';
    var code = err && err.code;
    var final = { NO_TICKET: '這位同學沒有抽籤券了，請先到設定頁發券。', POOL_EMPTY: '籤池已全部抽完，請到設定頁重設籤池。', INVALID_INPUT: '這個座號目前無法抽籤（可能不在籍），請重新選擇。' };
    if (final[code]) {
      messageBox('無法抽籤', final[code], [{ label: '關閉', primary: true, onclick: cancelPending }]);
      return;
    }
    messageBox('抽籤沒有完成', App.errorText(err) + '\n可以按「重試」，會使用同一筆抽籤編號，不會重複扣券。', [
      { label: '重試', primary: true, onclick: function () { closeOverlay(); phase = 'idle'; runDraw(requestId, seat); } },
      { label: '取消', onclick: cancelPending }
    ]);
  }

  function cancelPending() {
    App.store.remove(PENDING_KEY);
    closeOverlay();
    phase = 'idle';
    Music.setLevel(0.3, 800);
    renderAll();
    refresh();
  }

  /** 重新整理頁面後，若有未完成的抽籤，提示用同一個 requestId 查回結果 */
  function checkResume() {
    var p = App.store.getJSON(PENDING_KEY, null);
    if (!p || typeof p.requestId !== 'string' || typeof p.seat !== 'number') return;
    // 換了班級登入時，上一班的未完成抽籤不能用這一班查詢
    if (p.classId !== App.getClassId()) { App.store.remove(PENDING_KEY); return; }
    phase = 'error';
    renderDrawButton();
    messageBox('上次的抽籤還沒顯示結果', p.seat + ' 號的抽籤在動畫途中被中斷了。按「顯示結果」會用同一筆抽籤編號查詢，不會重複扣券。', [
      { label: '顯示結果', primary: true, onclick: function () { closeOverlay(); phase = 'idle'; runDraw(p.requestId, p.seat); } },
      { label: '略過', onclick: cancelPending }
    ]);
  }

  /* ============ 聲音與控制列 ============ */
  function initControls() {
    $('tglMusic').checked = prefs.music;
    $('tglSfx').checked = prefs.sfx;
    $('volume').value = prefs.volume;
    $('tglShort').checked = isShort();
    if (reducedMQ.matches) {
      $('tglShort').disabled = true;
      $('tglShort').parentNode.title = '系統已開啟「減少動態效果」，自動使用縮短動畫';
    }

    Sfx.setEnabled(prefs.sfx);
    Sfx.setVolume(prefs.volume / 100);
    var src = ['youtube', 'mp3', 'none'].indexOf(cfg.MUSIC_SOURCE) === -1 ? 'none' : cfg.MUSIC_SOURCE;
    Music.init({
      source: src,
      videoId: cfg.YOUTUBE_VIDEO_ID,
      level: 0.3,
      onFail: function () { $('musicMsg').hidden = false; }
    });
    Music.setEnabled(prefs.music);
    Music.setMaster(prefs.volume / 100);

    $('btnSoundOn').addEventListener('click', function () {
      Sfx.unlock();
      Music.start();
      Sfx.ding();
      this.hidden = true;
    });
    $('tglMusic').addEventListener('change', function () {
      prefs.music = this.checked; savePrefs();
      Music.setEnabled(prefs.music);
    });
    $('tglSfx').addEventListener('change', function () {
      prefs.sfx = this.checked; savePrefs();
      Sfx.setEnabled(prefs.sfx);
    });
    $('volume').addEventListener('input', function () {
      prefs.volume = Number(this.value); savePrefs();
      Sfx.setVolume(prefs.volume / 100);
      Music.setMaster(prefs.volume / 100);
    });
    $('tglShort').addEventListener('change', function () {
      prefs.short = this.checked; savePrefs();
    });
    $('btnFull').addEventListener('click', App.toggleFullscreen);
    $('btnDraw').addEventListener('click', startDraw);
    $('btnSkip').addEventListener('click', skip);
    $('btnSkipSpin').addEventListener('click', skip);
    $('btnNext').addEventListener('click', next);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') skip();
    });
  }

  /* ============ 卡片背包 ============ */
  function initBackpack() {
    Backpack.init({
      getSeats: function () { return data ? data.seats : []; },
      getSelected: function () { return selected; },
      getBagCounts: function () { return (data && data.bagCounts) || {}; },
      isIdle: function () { return phase === 'idle' && !!data; },
      onUsed: function (d) {
        // 先在本機更新，關閉背包時再向後端同步
        if (d.granted && data) data.balances[d.card.seat] = d.balance;
        if (data) {
          data.bagCounts = data.bagCounts || {};
          data.bagCounts[d.card.seat] = Math.max(0, (data.bagCounts[d.card.seat] || 0) - 1 + (d.chosen ? 1 : 0));
          renderSeats(); renderSelection(); renderDrawButton();
        }
      },
      onRecycled: function (d) {
        // 回收換券：券數改成後端回傳的餘額，未使用卡片數扣掉回收的張數
        if (!data) return;
        data.balances[d.seat] = d.balance;
        data.bagCounts = data.bagCounts || {};
        data.bagCounts[d.seat] = Math.max(0, (data.bagCounts[d.seat] || 0) - d.cards.length);
        renderSeats(); renderSelection(); renderDrawButton();
      },
      onChanged: refresh,
      sfx: function (name) { if (typeof Sfx[name] === 'function') Sfx[name](); }
    });
  }

  /* ============ 啟動 ============ */
  LotteryFx.initStars($('stars'), reducedMQ.matches);
  initControls();
  initBackpack();
  // 視窗大小改變（例如按全螢幕）時，重新計算「最近抽中」放得下幾筆
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (data) renderRecent(); }, 150);
  });
  App.requireCode().then(function (ok) {
    if (!ok) return;
    refresh();
    setInterval(refresh, POLL_MS);
  });
})();
