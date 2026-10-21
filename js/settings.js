/* 設定頁：班級登入、名單匯入、在籍狀態、發券、籤池、卡片管理、卡片背包、抽籤紀錄 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };

  var state = { roster: [], lottery: null, bag: null, cards: null, preview: null, amount: 1, busy: false };

  /* ============ 班級登入 ============ */
  function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = 'status-line' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
  }

  var ROLE_NAME = { teacher: '導師碼', display: '班級碼' };

  /** 顯示目前登入狀態：哪一組存取碼、是否只暫時登入 */
  async function refreshCodeHint() {
    $('classIdInput').value = App.getClassId();
    if (!App.getCode()) { setStatus($('codeStatus'), '這台裝置尚未登入班級。'); return; }
    var where = App.isTempLogin() ? '（只在這個分頁暫時登入）' : '（已記住在這台裝置）';
    try {
      var d = await App.api('ping');
      setStatus($('codeStatus'), '目前登入：' + classLabel(d) + '・' + (ROLE_NAME[d.role] || '存取碼') + where + '。', true);
    } catch (e) {
      setStatus($('codeStatus'), '目前的存取碼無法使用：' + App.errorText(e), false);
    }
  }

  function classLabel(d) { return d.classId + (d.className ? '（' + d.className + '）' : ''); }

  $('btnSaveCode').addEventListener('click', async function () {
    var classId = $('classIdInput').value.trim();
    var code = $('codeInput').value.trim();
    var remember = $('codeRemember').checked;
    if (!App.isClassId(classId)) { setStatus($('codeStatus'), '班級代號只能是 1 到 10 個英文字母、數字或「-」。', false); return; }
    if (!code) { setStatus($('codeStatus'), '請先輸入存取碼。', false); return; }
    setStatus($('codeStatus'), '測試連線中…');
    try {
      var d = await App.api('ping', {}, { classId: classId, code: code });
      App.setLogin(classId, code, remember);
      $('codeInput').value = '';
      var where = remember ? '已記住在這台裝置' : '只在這個分頁暫時登入，關閉分頁後就會登出';
      if (d.role === 'display') {
        setStatus($('codeStatus'), '連線成功：' + classLabel(d) + '・班級碼（' + where + '）。這台裝置可以使用投影頁與抽籤頁，記錄頁與設定頁需要導師碼。', true);
      } else {
        setStatus($('codeStatus'), '連線成功：' + classLabel(d) + '・導師碼（' + where + '）。', true);
      }
      loadAll();
    } catch (e) {
      setStatus($('codeStatus'), '連線失敗：' + App.errorText(e), false);
    }
  });

  $('btnTestCode').addEventListener('click', async function () {
    if (!App.getCode()) { setStatus($('codeStatus'), '這台裝置尚未登入班級。', false); return; }
    setStatus($('codeStatus'), '測試連線中…');
    try {
      var d = await App.api('ping');
      setStatus($('codeStatus'), '連線成功：' + classLabel(d) + '・' + (ROLE_NAME[d.role] || '存取碼') + '（伺服器時間 ' + App.fmtMD(d.serverTime) + ' ' + App.fmtHM(d.serverTime) + '）。', true);
    } catch (e) {
      setStatus($('codeStatus'), '連線失敗：' + App.errorText(e), false);
    }
  });

  $('btnClearCode').addEventListener('click', function () {
    if (!confirm('確定要登出這台裝置（包含暫時登入）嗎？之後需要重新輸入班級代號與存取碼。')) return;
    App.clearCode();
    refreshCodeHint();
  });

  /* ============ 載入資料 ============ */
  async function loadAll() {
    if (!App.getCode()) return;
    try {
      var results = await Promise.all([App.api('getState'), App.api('getLottery', { limit: 20 }), loadBagData(), App.api('getCards')]);
      state.roster = results[0].roster;
      state.lottery = results[1];
      state.bag = results[2];
      state.cards = results[3];
      renderRoster();
      renderTickets();
      renderPool();
      renderCards();
      renderBag();
      renderDraws();
    } catch (e) {
      if (e.code === 'UNAUTHORIZED' || e.code === 'FORBIDDEN') {
        // 設定頁上方就是登入欄，不另外跳出視窗
        if (e.code === 'FORBIDDEN') setStatus($('codeStatus'), '目前登入的是班級碼，設定頁的資料需要導師碼。請在上方輸入導師碼（班級電腦請取消「記住在這台裝置」）。', false);
        else setStatus($('codeStatus'), App.errorText(e), false);
        return;
      }
      App.toast('載入失敗：' + App.errorText(e), 'error');
    }
  }

  /* ============ 名單 ============ */
  function renderRoster() {
    var active = state.roster.filter(function (r) { return r.active; });
    $('activeCount').textContent = active.length;
    var grid = $('rosterGrid');
    App.clear(grid);
    if (state.roster.length === 0) {
      grid.appendChild(h('p', { class: 'muted', style: 'grid-column:1/-1', text: '尚未匯入名單。' }));
      return;
    }
    state.roster.forEach(function (r) {
      grid.appendChild(h('button', {
        type: 'button',
        class: 'mini' + (r.active ? '' : ' off'),
        'aria-pressed': r.active ? 'true' : 'false',
        title: r.active ? '在籍，點一下設為不在籍' : '不在籍，點一下設為在籍',
        onclick: function () { toggleActive(r); }
      }, String(r.seat), h('small', { text: r.active ? '在籍' : '不在籍' })));
    });
  }

  async function toggleActive(r) {
    var next = !r.active;
    var msg = next ? '要把 ' + r.seat + ' 號設為「在籍」嗎？' : '要把 ' + r.seat + ' 號設為「不在籍」嗎？（資料不會刪除）';
    if (!confirm(msg)) return;
    try {
      await App.api('setRosterActive', { seat: r.seat, active: next });
      App.toast(r.seat + ' 號已設為' + (next ? '在籍' : '不在籍'));
      loadAll();
    } catch (e) {
      App.toast(App.errorText(e), 'error');
    }
  }

  /* ---------- CSV 解析 ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    var rows = [], row = [], field = '', inQuote = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
        } else field += c;
        continue;
      }
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* 略過 */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toHalfWidth(s) {
    return s.replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); });
  }

  var SEAT_KEYS = ['座號', 'seat', 'no'];
  var CLASS_KEYS = ['班級代號', 'class'];

  /**
   * 解析並檢查 CSV。只取出座號與班級代號兩欄，其他欄位（例如姓名）讀到就丟棄。
   * 回傳 { rows: [{line, classCode, seat, errors}], error }
   */
  function analyze(text) {
    var all = parseCSV(text);
    var isBlank = function (r) { return r.every(function (c) { return c.trim() === ''; }); };
    // 去掉結尾空白列（Excel 常見）
    while (all.length && isBlank(all[all.length - 1])) all.pop();
    var headIndex = -1;
    for (var i = 0; i < all.length; i++) { if (!isBlank(all[i])) { headIndex = i; break; } }
    if (headIndex === -1) return { error: '檔案是空的。' };

    var header = all[headIndex].map(function (c) { return c.trim().toLowerCase(); });
    var seatCol = header.findIndex(function (c) { return SEAT_KEYS.indexOf(c) !== -1; });
    var classCol = header.findIndex(function (c) { return CLASS_KEYS.indexOf(c) !== -1; });
    if (seatCol === -1) return { error: '找不到「座號」欄位（可用標題：座號、seat、no）。' };

    var out = [];
    var firstLine = {};
    for (var j = headIndex + 1; j < all.length; j++) {
      var raw = all[j];
      var line = j + 1;
      var seatText = toHalfWidth((raw[seatCol] || '').trim());
      var classText = classCol === -1 ? '' : toHalfWidth((raw[classCol] || '').trim());
      var blank = isBlank(raw);
      raw = null; // 其他欄位到此丟棄，不保存、不顯示
      var item = { line: line, classCode: classText, seat: null, seatText: seatText, errors: [] };
      if (blank) item.errors.push('空白列');
      else if (seatText === '') item.errors.push('座號空白');
      else if (!/^\d+$/.test(seatText)) item.errors.push('座號不是整數');
      else {
        var n = parseInt(seatText, 10);
        if (n < 1 || n > 99) item.errors.push('座號超出 1 至 99');
        else {
          item.seat = n;
          if (firstLine[n]) {
            item.errors.push('座號重複（與第 ' + firstLine[n].line + ' 列）');
            if (firstLine[n].errors.indexOf('座號重複') === -1) firstLine[n].errors.push('座號重複');
          } else firstLine[n] = item;
        }
      }
      if (!/^[0-9A-Za-z-]{0,10}$/.test(classText)) {
        item.errors.push('班級代號格式錯誤（只能是 10 個以內的英數字）');
        item.classInvalid = true;
      } else if (classText && classText !== App.getClassId()) {
        // 後端只接受目前登入的班級，先在這裡擋下
        item.errors.push('不是目前登入的班級（' + App.getClassId() + '）');
      }
      out.push(item);
    }
    if (out.length === 0) return { error: '檔案只有標題列，沒有資料。' };
    return { rows: out };
  }

  $('csvFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) { App.toast('檔案太大，請確認是名單 CSV。', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function () { showPreview(analyze(String(reader.result || ''))); };
    reader.onerror = function () { App.toast('讀取檔案失敗。', 'error'); };
    reader.readAsText(file, 'utf-8');
  });

  function showPreview(result) {
    state.preview = result;
    var body = $('previewBody');
    App.clear(body);
    $('previewBox').hidden = false;
    var summary = $('previewSummary');
    if (result.error) {
      summary.textContent = result.error;
      summary.className = 'preview-summary bad';
      $('btnImport').disabled = true;
      return;
    }
    var bad = result.rows.filter(function (r) { return r.errors.length; });
    result.rows.forEach(function (r) {
      body.appendChild(h('tr', { class: r.errors.length ? 'row-error' : '' },
        h('td', { text: '第 ' + r.line + ' 列' }),
        h('td', { text: r.classInvalid ? '（格式錯誤，不顯示）' : (r.classCode || '—') }),
        h('td', { text: r.seat !== null ? String(r.seat) : (r.errors.indexOf('空白列') !== -1 ? '' : '（無效）') }),
        h('td', { class: r.errors.length ? 'err' : '', text: r.errors.length ? r.errors.join('、') : '可匯入' })));
    });
    if (bad.length) {
      summary.textContent = '共 ' + result.rows.length + ' 列，其中 ' + bad.length + ' 列有錯誤（紅色），請修正 CSV 後重新選擇檔案。';
      summary.className = 'preview-summary bad';
    } else {
      summary.textContent = '共 ' + result.rows.length + ' 列，檢查通過，可以匯入。';
      summary.className = 'preview-summary';
    }
    $('btnImport').disabled = bad.length > 0;
  }

  $('btnCancelImport').addEventListener('click', function () {
    state.preview = null;
    $('previewBox').hidden = true;
    $('csvFile').value = '';
  });

  $('btnImport').addEventListener('click', async function () {
    var p = state.preview;
    if (!p || p.error || p.rows.some(function (r) { return r.errors.length; })) return;
    var mode = document.querySelector('input[name="importMode"]:checked').value;
    var msg = mode === 'replace'
      ? '確定要用這份名單「取代整份名單」嗎？\n名單外的座號會設為「不在籍」（不會刪除資料）。'
      : '確定要「只新增缺少的座號」嗎？\n已存在的座號不會變動。';
    if (!confirm(msg)) return;
    // 只送出班級代號與座號
    var rows = p.rows.map(function (r) { return { classCode: r.classCode, seat: r.seat }; });
    this.disabled = true;
    try {
      var d = await App.api('importRoster', { mode: mode, rows: rows });
      App.toast('匯入完成：新增 ' + d.added + ' 人' + (mode === 'replace' ? '，設為不在籍 ' + d.deactivated + ' 人' : ''));
      $('btnCancelImport').click();
      loadAll();
    } catch (e) {
      App.toast('匯入失敗：' + App.errorText(e), 'error');
      this.disabled = false;
    }
  });

  /* ============ 發券 ============ */
  function renderTickets() {
    var lot = state.lottery;
    var sel = $('ticketSeat');
    var prev = sel.value;
    App.clear(sel);
    lot.seats.forEach(function (s) {
      sel.appendChild(h('option', { value: String(s), text: s + ' 號（' + (lot.balances[s] || 0) + ' 張）' }));
    });
    if (prev && lot.seats.indexOf(Number(prev)) !== -1) sel.value = prev;

    var grid = $('balanceGrid');
    App.clear(grid);
    if (lot.seats.length === 0) {
      grid.appendChild(h('p', { class: 'muted', style: 'grid-column:1/-1', text: '尚未匯入名單。' }));
    }
    lot.seats.forEach(function (s) {
      var n = lot.balances[s] || 0;
      grid.appendChild(h('div', { class: 'mini static' + (n > 0 ? ' has' : '') }, s + ' 號', h('small', { text: n + ' 張' })));
    });
  }

  function renderAmount() {
    $('ticketAmount').textContent = String(state.amount);
  }
  $('btnMinus').addEventListener('click', function () {
    var min = $('ticketReason').value === '發放' ? 1 : -20;
    state.amount = Math.max(min, state.amount - 1);
    if (state.amount === 0) state.amount = -1;
    renderAmount();
  });
  $('btnPlus').addEventListener('click', function () {
    state.amount = Math.min(20, state.amount + 1);
    if (state.amount === 0) state.amount = 1;
    renderAmount();
  });
  $('ticketReason').addEventListener('change', function () {
    if (this.value === '發放' && state.amount < 1) { state.amount = 1; renderAmount(); }
  });

  $('btnGrant').addEventListener('click', async function () {
    var seat = Number($('ticketSeat').value);
    var reason = $('ticketReason').value;
    var amount = state.amount;
    if (!seat) { setStatus($('ticketStatus'), '請先選擇座號。', false); return; }
    if (reason === '發放' && amount < 1) { setStatus($('ticketStatus'), '「發放」張數需為正數。', false); return; }
    var text = seat + ' 號 ' + (amount > 0 ? '發 ' + amount : '扣 ' + (-amount)) + ' 張（' + reason + '）';
    if (!confirm('確定要' + text + '嗎？')) return;
    this.disabled = true;
    setStatus($('ticketStatus'), '送出中…');
    try {
      var d = await App.api('grantTickets', { seat: seat, amount: amount, reason: reason });
      setStatus($('ticketStatus'), '完成：' + text + '，目前餘額 ' + d.balance + ' 張。', true);
      state.amount = 1;
      $('ticketReason').value = '發放';
      renderAmount();
      loadAll();
    } catch (e) {
      var msg = e.code === 'INVALID_INPUT' ? '餘額不足或資料不正確（餘額不可低於 0）。' : App.errorText(e);
      setStatus($('ticketStatus'), '失敗：' + msg, false);
    } finally {
      this.disabled = false;
    }
  });

  /* ============ 籤池 ============ */
  function renderPool() {
    $('poolDrawn').textContent = state.lottery.drawnCount;
    $('poolTotal').textContent = state.lottery.total;
  }
  $('resetInput').addEventListener('input', function () {
    $('btnReset').disabled = this.value.trim() !== '重設';
  });
  $('btnReset').addEventListener('click', async function () {
    if ($('resetInput').value.trim() !== '重設') return;
    if (!confirm('確定要重設籤池嗎？所有號碼會重新變成可抽。')) return;
    this.disabled = true;
    try {
      await App.api('resetPool', { confirm: '重設' });
      $('resetInput').value = '';
      setStatus($('poolStatus'), '籤池已重設，40 個號碼都可以抽了。', true);
      loadAll();
    } catch (e) {
      setStatus($('poolStatus'), '重設失敗：' + App.errorText(e), false);
      this.disabled = false;
    }
  });

  /* ============ 卡片管理 ============ */
  // 卡名、說明是老師自訂的文字，一律用 textContent 顯示（App.h 的 text 屬性）
  function renderCards() {
    var d = state.cards;
    if (!d) return;
    var body = $('cardBody');
    App.clear(body);
    if (!d.cards.length) body.appendChild(h('tr', {}, h('td', { colspan: '5', class: 'muted', text: '還沒有卡片，請按「新增卡片」。' })));
    d.cards.forEach(function (c) {
      body.appendChild(h('tr', { class: c.enabled ? '' : 'muted' },
        h('td', { title: c.description },
          h('span', { 'aria-hidden': 'true', text: App.iconOf(c.icon) + ' ' }), c.name, c.enabled ? null : h('small', { text: '（停用）' })),
        h('td', { text: c.effect }),
        h('td', { text: String(c.weight) }),
        h('td', { text: c.enabled ? c.percent + '%' : '—' }),
        h('td', {}, h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-small', text: '編輯', onclick: function () { showCardForm(c); } }),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', text: '刪除', onclick: function () { deleteCard(c, this); } })))));
    });
    $('cardCount').textContent = '共 ' + d.cards.length + ' 張（上限 ' + d.maxCards + ' 張）';
    $('btnNewCard').disabled = d.cards.length >= d.maxCards;
  }

  $('btnNewCard').addEventListener('click', function () { showCardForm(null); });

  /** 新增（card 為 null）或編輯卡片的表單；圖示與效果只能從清單挑選 */
  function showCardForm(card) {
    var d = state.cards;
    var panel = $('cardPanel');
    App.clear(panel);
    var c = card || { name: '', icon: d.icons[0].key, description: '', weight: 1, effect: d.effects[0], enabled: true };
    var icon = c.icon;

    var name = h('input', { type: 'text', class: 'input', maxlength: '20', autocomplete: 'off' });
    name.value = c.name;
    var desc = h('input', { type: 'text', class: 'input', maxlength: '60', autocomplete: 'off' });
    desc.value = c.description;
    var weight = h('input', { type: 'number', class: 'input', min: '0.01', max: '100', step: '0.01', inputmode: 'decimal' });
    weight.value = String(c.weight);
    var effect = h('select', { class: 'input' });
    d.effects.forEach(function (e) { effect.appendChild(h('option', { value: e, text: e })); });
    effect.value = c.effect;
    var enabled = h('input', { type: 'checkbox' });
    enabled.checked = c.enabled;

    var iconGrid = h('div', { class: 'icon-grid', role: 'radiogroup', 'aria-label': '圖示' });
    d.icons.forEach(function (it) {
      var b = h('button', { type: 'button', class: 'icon-pick', role: 'radio', 'aria-label': it.key, text: it.emoji,
        onclick: function () {
          icon = it.key;
          Array.prototype.forEach.call(iconGrid.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
        } });
      b.setAttribute('aria-checked', String(it.key === icon));
      iconGrid.appendChild(b);
    });

    var status = h('p', { class: 'status-line' });
    var saveBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: card ? '儲存修改' : '新增' });
    var form = h('form', { class: 'card', style: 'margin-top:12px' },
      h('h3', { text: card ? '編輯「' + card.name + '」' : '新增卡片' }),
      h('label', { class: 'field' }, '卡名（最多 20 字）', name),
      h('div', { class: 'field' }, '圖示', iconGrid),
      h('label', { class: 'field' }, '說明（最多 60 字，可留空）', desc),
      h('div', { class: 'row' },
        h('label', { class: 'field', style: 'flex:1;min-width:120px' }, '權重（0.01～100）', weight),
        h('label', { class: 'field', style: 'flex:1;min-width:140px' }, '效果', effect)),
      h('label', { class: 'gate-remember', style: 'margin-bottom:10px' }, enabled, ' 啟用（停用的卡抽不到，也不能被自選）'),
      h('div', { class: 'row' }, saveBtn,
        h('button', { type: 'button', class: 'btn', text: '取消', onclick: function () { App.clear(panel); } })),
      status);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var params = {
        name: name.value.trim(),
        icon: icon,
        description: desc.value.trim(),
        weight: Number(weight.value),
        effect: effect.value,
        enabled: enabled.checked
      };
      if (card) params.id = card.id;
      // 前端先檢查一次，後端還會再驗證
      if (!params.name || params.name.length > 20) { setStatus(status, '請輸入卡名（最多 20 字）。', false); return; }
      if (params.description.length > 60) { setStatus(status, '說明最多 60 字。', false); return; }
      if (!isFinite(params.weight) || params.weight <= 0 || params.weight > 100) { setStatus(status, '權重要介於 0.01 到 100 之間。', false); return; }
      saveBtn.disabled = true;
      setStatus(status, '儲存中…');
      try {
        await App.api('saveCard', params);
        App.clear(panel);
        setStatus($('cardStatus'), '已' + (card ? '儲存' : '新增') + '「' + params.name + '」。', true);
        await reloadCards();
      } catch (ex) {
        setStatus(status, App.errorText(ex), false);
        saveBtn.disabled = false;
      }
    });
    panel.appendChild(form);
    name.focus();
  }

  async function deleteCard(card, btn) {
    if (!confirm('要刪除「' + card.name + '」嗎？已經在學生背包裡的這張卡不會受影響。\n只是暫時不想讓學生抽到，可以改成「停用」。')) return;
    btn.disabled = true;
    try {
      await App.api('deleteCard', { id: card.id });
      App.clear($('cardPanel'));
      setStatus($('cardStatus'), '已刪除「' + card.name + '」。', true);
      await reloadCards();
    } catch (e) {
      setStatus($('cardStatus'), '刪除失敗：' + App.errorText(e), false);
      btn.disabled = false;
    }
  }

  async function reloadCards() {
    try {
      state.cards = await App.api('getCards');
      renderCards();
      // 自選卡片可以挑的卡會跟著變，背包資料一起更新
      reloadBag();
    } catch (e) {
      setStatus($('cardStatus'), '讀取卡片失敗：' + App.errorText(e), false);
    }
  }

  /* ============ 卡片背包 ============ */
  var EFFECT = App.EFFECT;
  var RECYCLED = '已回收';

  function loadBagData() {
    var seat = $('bagSeat').value;
    return App.api('getBackpack', seat ? { seat: Number(seat) } : {});
  }

  async function reloadBag() {
    try {
      state.bag = await loadBagData();
      renderBag();
    } catch (e) {
      setStatus($('bagStatus'), '讀取背包失敗：' + App.errorText(e), false);
    }
  }

  function renderBag() {
    var bag = state.bag;
    if (!bag) return;

    // 座號選單：全班＋各座號（附未使用張數）
    var sel = $('bagSeat');
    var prev = sel.value;
    App.clear(sel);
    sel.appendChild(h('option', { value: '', text: '全班' }));
    state.lottery.seats.forEach(function (s) {
      var n = bag.counts[s] || 0;
      sel.appendChild(h('option', { value: String(s), text: s + ' 號' + (n ? '（' + n + ' 張未使用）' : '') }));
    });
    sel.value = prev;

    var unused = bag.cards.filter(function (c) { return c.status === '未使用'; })
      .sort(function (a, b) { return a.seat - b.seat || (a.gotAt < b.gotAt ? -1 : 1); });
    var used = bag.cards.filter(function (c) { return c.status === '已使用' || c.status === RECYCLED; });
    $('bagUnusedCount').textContent = unused.length;

    var ub = $('bagUnusedBody');
    App.clear(ub);
    if (!unused.length) ub.appendChild(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: '沒有未使用的卡片。' })));
    unused.forEach(function (c) {
      var cell = h('td', {});
      cell.appendChild(h('button', { type: 'button', class: 'btn btn-small', text: '使用', onclick: function () { startUse(c, cell); } }));
      ub.appendChild(h('tr', {},
        h('td', { text: c.seat + ' 號' }),
        h('td', { title: c.description, text: c.name }),
        h('td', { text: App.fmtMD(c.gotAt) + (c.source === EFFECT.CHOOSE ? '（自選）' : '') }),
        cell));
    });

    var bb = $('bagUsedBody');
    App.clear(bb);
    if (!used.length) bb.appendChild(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: '還沒有使用過的卡片。' })));
    used.forEach(function (c) {
      var recycled = c.status === RECYCLED;
      bb.appendChild(h('tr', {},
        h('td', { text: App.fmtMD(c.usedAt) + ' ' + App.fmtHM(c.usedAt) }),
        h('td', { text: c.seat + ' 號' }),
        h('td', { text: c.name + (recycled ? '（已回收）' : '') }),
        h('td', {}, h('button', { type: 'button', class: 'btn btn-small', text: '復原',
          onclick: function () { recycled ? undoRecycle(c, this) : undoUse(c, this); } }))));
    });
  }

  $('bagSeat').addEventListener('change', reloadBag);

  /** 按「使用」：自選卡片先在同一格顯示選卡選單 */
  function startUse(card, cell) {
    if (card.effect !== EFFECT.CHOOSE) { useCard(card, null, cell.querySelector('button')); return; }
    App.clear(cell);
    var pick = h('select', { class: 'input', 'aria-label': '自選卡片要選的卡片', style: 'min-height:36px;width:auto' },
      h('option', { value: '', text: '選一張卡…' }));
    state.bag.choices.forEach(function (c) { pick.appendChild(h('option', { value: c.id, text: c.name })); });
    var ok = h('button', { type: 'button', class: 'btn btn-small btn-primary', text: '確定', onclick: function () {
      var choice = state.bag.choices.filter(function (c) { return c.id === pick.value; })[0];
      if (!choice) { App.toast('請先選一張卡。', 'error'); return; }
      useCard(card, choice, ok);
    } });
    cell.appendChild(h('div', { class: 'row' }, pick, ok,
      h('button', { type: 'button', class: 'btn btn-small', text: '取消', onclick: renderBag })));
  }

  async function useCard(card, choice, btn) {
    var msg = choice
      ? '要使用 ' + card.seat + ' 號的「' + card.name + '」，並把「' + choice.name + '」放進背包嗎？'
      : '要使用 ' + card.seat + ' 號的「' + card.name + '」嗎？' + (card.effect === EFFECT.REDRAW ? '\n（會自動送 1 張抽籤券）' : '');
    if (!confirm(msg)) return;
    if (btn) btn.disabled = true;
    try {
      var d = await App.api('useCard', { cardId: card.id, choiceId: choice ? choice.id : undefined });
      var text = card.seat + ' 號已使用「' + card.name + '」';
      if (d.granted) text += '，已送 1 張券（目前 ' + d.balance + ' 張）';
      if (d.chosen) text += '，「' + d.chosen.name + '」已放進背包';
      setStatus($('bagStatus'), text + '。', true);
      loadAll();
    } catch (e) {
      setStatus($('bagStatus'), '使用失敗：' + App.errorText(e), false);
      if (btn) btn.disabled = false;
      if (e.code === 'ALREADY_USED') reloadBag();
    }
  }

  async function undoUse(card, btn) {
    var extra = card.effect === EFFECT.REDRAW ? '\n（會收回送出的 1 張券）' : card.effect === EFFECT.CHOOSE ? '\n（會收回當時選的那張卡）' : '';
    if (!confirm('要復原 ' + card.seat + ' 號的「' + card.name + '」，改回未使用嗎？' + extra)) return;
    btn.disabled = true;
    try {
      await App.api('undoUseCard', { cardId: card.id });
      setStatus($('bagStatus'), card.seat + ' 號的「' + card.name + '」已改回未使用。', true);
      loadAll();
    } catch (e) {
      setStatus($('bagStatus'), '復原失敗：' + App.errorText(e), false);
      btn.disabled = false;
    }
  }

  /** 復原回收：同一次回收的卡一起改回未使用，並收回換到的 1 張券 */
  async function undoRecycle(card, btn) {
    var group = state.bag.cards.filter(function (c) { return c.recycleId && c.recycleId === card.recycleId; });
    var names = group.map(function (c) { return '「' + c.name + '」'; }).join('、') || '「' + card.name + '」';
    if (!confirm('要復原 ' + card.seat + ' 號這次的回收嗎？\n' + names + ' 會一起改回未使用，並收回換到的 1 張券。')) return;
    btn.disabled = true;
    try {
      var d = await App.api('undoRecycle', { recycleId: card.recycleId });
      setStatus($('bagStatus'), card.seat + ' 號回收的 ' + d.restored + ' 張卡已改回未使用，收回 1 張券（目前 ' + d.balance + ' 張）。', true);
      loadAll();
    } catch (e) {
      var text = e.code === 'CANNOT_UNDO' ? '換到的抽籤券已經拿去抽了。' : App.errorText(e);
      setStatus($('bagStatus'), '復原失敗：' + text, false);
      btn.disabled = false;
      if (e.code === 'NOT_FOUND') reloadBag();
    }
  }

  $('bagClearInput').addEventListener('input', function () {
    $('btnBagClear').disabled = this.value.trim() !== '清除';
  });
  $('btnBagClear').addEventListener('click', async function () {
    if ($('bagClearInput').value.trim() !== '清除') return;
    if (!confirm('確定要刪除所有「已使用」與「已回收」的卡片紀錄嗎？這個動作無法復原。')) return;
    this.disabled = true;
    try {
      var d = await App.api('clearUsedCards', { confirm: '清除' });
      $('bagClearInput').value = '';
      setStatus($('bagStatus'), '已清除 ' + d.removed + ' 筆已使用的卡片紀錄。', true);
      reloadBag();
    } catch (e) {
      setStatus($('bagStatus'), '清除失敗：' + App.errorText(e), false);
      this.disabled = false;
    }
  });

  /* ============ 抽籤紀錄 ============ */
  function renderDraws() {
    var body = $('drawBody');
    App.clear(body);
    var list = state.lottery.recent;
    if (!list.length) {
      body.appendChild(h('tr', {}, h('td', { colspan: '5', class: 'muted', text: '尚無抽籤紀錄。' })));
      return;
    }
    list.forEach(function (r) {
      body.appendChild(h('tr', {},
        h('td', { text: App.fmtMD(r.time) + ' ' + App.fmtHM(r.time) }),
        h('td', { text: r.seat + ' 號' }),
        h('td', { text: String(r.number) }),
        h('td', { text: r.type }),
        h('td', { text: r.name })));
    });
  }

  /* ============ 啟動 ============ */
  renderAmount();
  if (!(window.APP_CONFIG || {}).GAS_URL) {
    setStatus($('codeStatus'), App.ERROR_TEXT.NO_CONFIG, false);
  } else {
    refreshCodeHint().then(loadAll);
  }
})();
