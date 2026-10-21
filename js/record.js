/*
 * 記錄頁：選作業、點「有交」的座號、按儲存才送出
 * 尚未點收的作業：點的是有交的人；第一次按「儲存」時，沒點到的人一律記為缺交，作業標為已點收。
 * 已點收的作業：綠色＝有交、紅色＝缺交，點一下可以修正；補交模式下點紅色會改成「已補交」。
 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };
  var LAST_KEY = 'cms_last_assignment';
  var MAX_BOARD = 5;

  var state = {
    roster: [],
    assignments: [],
    missing: {},      // { 作業ID: { 座號: '缺交' | '已補交' } }
    currentId: null,
    pending: {},      // { 座號: '缺交' | '已補交' | '正常' }，尚未儲存的變更
    makeup: false,
    busy: false
  };

  /* ---------- 狀態計算 ---------- */
  function activeSeats() {
    return state.roster.filter(function (r) { return r.active; }).map(function (r) { return r.seat; });
  }
  function isRecorded() {
    var a = current();
    // 舊版後端不會回傳 recorded，視為已點收（沿用舊的「點缺交」行為）
    return !!(a && a.recorded !== false);
  }
  /** 伺服器上的狀態；尚未點收的作業一律是「未點」 */
  function serverStatus(seat) {
    if (!isRecorded()) return '未點';
    var m = state.missing[state.currentId];
    return (m && m[seat]) || '正常';
  }
  function statusOf(seat) {
    return Object.prototype.hasOwnProperty.call(state.pending, seat) ? state.pending[seat] : serverStatus(seat);
  }
  function hasPending() { return Object.keys(state.pending).length > 0; }
  function current() {
    return state.assignments.find(function (a) { return a.id === state.currentId; }) || null;
  }
  function sortedAssignments() {
    return state.assignments.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }
  function boardList() {
    return state.assignments.filter(function (a) { return a.onBoard; })
      .sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
  }

  /* ---------- 載入 ---------- */
  async function load(preferId) {
    try {
      var d = await App.api('getState');
      state.roster = d.roster;
      state.assignments = d.assignments;
      state.missing = {};
      d.missing.forEach(function (m) {
        (state.missing[m.assignmentId] = state.missing[m.assignmentId] || {})[m.seat] = m.status;
      });
      var ids = state.assignments.map(function (a) { return a.id; });
      var want = preferId || state.currentId || App.store.get(LAST_KEY);
      if (!want || ids.indexOf(want) === -1) {
        var first = sortedAssignments()[0];
        want = first ? first.id : null;
      }
      setCurrent(want);
      render();
    } catch (e) {
      if (App.handleAuth(e, { teacherOnly: true })) return;
      $('curName').textContent = '載入失敗';
      App.toast(App.errorText(e), 'error');
    }
  }

  function setCurrent(id) {
    state.currentId = id;
    if (id) App.store.set(LAST_KEY, id);
  }

  /* ---------- 畫面 ---------- */
  function render() {
    renderCurrent();
    renderGrid();
    renderCount();
    renderSave();
    renderList();
  }

  function renderCurrent() {
    var a = current();
    var sel = $('assignSelect');
    App.clear(sel);
    if (!a) {
      $('curDate').textContent = '';
      $('curName').textContent = '尚未建立作業，請按「新增作業」';
      sel.disabled = true;
      return;
    }
    $('curDate').textContent = App.ymdToMD(a.date) + '（' + App.weekday(a.date) + '）' + (a.onBoard ? '・投影第 ' + a.order + ' 項' : '');
    $('curName').textContent = a.name;
    sel.disabled = false;
    sortedAssignments().forEach(function (x) {
      sel.appendChild(h('option', { value: x.id, text: App.ymdToMD(x.date) + '  ' + x.name + (x.onBoard ? '（投影）' : '') }));
    });
    sel.value = a.id;
  }

  function renderGrid() {
    var grid = $('seatGrid');
    App.clear(grid);
    var seats = activeSeats();
    if (seats.length === 0) {
      grid.appendChild(h('div', { class: 'empty-hint', style: 'grid-column:1/-1' },
        '尚未匯入名單，請到 ', h('a', { href: 'settings.html', text: '設定頁' }), ' 匯入 CSV。'));
      return;
    }
    var disabled = !state.currentId;
    var hint = $('gridHint');
    hint.textContent = !state.currentId ? ''
      : isRecorded() ? '綠色＝有交、紅色＝缺交，點一下可以修正。學生補交請開「補交模式」。'
      : '請點「有交」的座號；按「儲存」後，沒點到的人會記為缺交。';
    seats.forEach(function (seat) {
      var st = statusOf(seat);
      var changed = Object.prototype.hasOwnProperty.call(state.pending, seat);
      var cls = 'seat' + (st === '缺交' ? ' missing' : '') + (st === '正常' || st === '已補交' ? ' done' : '')
        + (st === '已補交' ? ' madeup' : '') + (changed ? ' changed' : '');
      var label = seat + ' 號，' + ({ '缺交': '缺交', '已補交': '已補交', '正常': '有交', '未點': '還沒點' })[st] + (changed ? '（未儲存）' : '');
      grid.appendChild(h('button', {
        type: 'button', class: cls, 'aria-label': label, disabled: disabled,
        onclick: function () { tap(seat); }
      }, String(seat)));
    });
  }

  /** 尚未點收時，沒點到（之後會記為缺交）的座號 */
  function unmarkedSeats() {
    return activeSeats().filter(function (s) { return statusOf(s) === '未點'; });
  }

  function renderCount() {
    var el = $('missingCount');
    if (state.currentId && !isRecorded()) {
      var seats = activeSeats();
      el.textContent = '有交 ' + (seats.length - unmarkedSeats().length) + '／' + seats.length;
      el.className = 'missing-count pending';
      return;
    }
    var n = activeSeats().filter(function (s) { return statusOf(s) === '缺交'; }).length;
    el.textContent = '缺交 ' + n + ' 人';
    el.className = 'missing-count' + (n === 0 ? ' zero' : '');
  }

  function renderSave() {
    var btn = $('btnSave');
    if (state.currentId && !isRecorded()) {
      // 尚未點收：沒有點任何人也可以儲存（代表全班都沒交）
      btn.disabled = state.busy || activeSeats().length === 0;
      btn.textContent = state.busy ? '儲存中…' : '儲存點收';
      return;
    }
    var n = Object.keys(state.pending).length;
    btn.disabled = n === 0 || state.busy;
    btn.textContent = state.busy ? '儲存中…' : (n ? '儲存（' + n + '）' : '儲存');
  }

  function renderList() {
    var ul = $('assignList');
    App.clear(ul);
    var board = boardList();
    var others = sortedAssignments().filter(function (a) { return !a.onBoard; });
    var list = board.concat(others);
    if (list.length === 0) {
      ul.appendChild(h('li', { class: 'muted', text: '還沒有作業。' }));
      return;
    }
    list.forEach(function (a) {
      var bi = board.indexOf(a);
      var sw = h('input', { type: 'checkbox', 'aria-label': '上投影：' + a.name });
      sw.checked = a.onBoard;
      sw.disabled = state.busy;
      sw.addEventListener('change', function () { toggleBoard(a, sw); });
      ul.appendChild(h('li', { class: 'assign-item' + (a.id === state.currentId ? ' current' : '') },
        h('div', { class: 'a-main', onclick: function () { switchTo(a.id); } },
          h('div', { class: 'a-date' }, App.ymdToMD(a.date), a.onBoard ? h('span', { class: 'badge-board', text: '投影 ' + a.order }) : null),
          h('div', { class: 'a-name', text: a.name })),
        h('div', { class: 'a-tools' },
          h('label', { class: 'switch', title: '上投影' }, sw, h('span', { class: 'track' }), h('span', { text: '上投影' })),
          h('button', { type: 'button', class: 'btn btn-icon btn-small', 'aria-label': '投影順序往上', text: '↑',
            disabled: !a.onBoard || bi <= 0 || state.busy, onclick: function () { move(a.id, -1); } }),
          h('button', { type: 'button', class: 'btn btn-icon btn-small', 'aria-label': '投影順序往下', text: '↓',
            disabled: !a.onBoard || bi === -1 || bi >= board.length - 1 || state.busy, onclick: function () { move(a.id, 1); } })),
        h('div', { class: 'a-extra' },
          h('button', { type: 'button', class: 'btn btn-small', text: '修改', disabled: state.busy, onclick: function () { edit(a); } }),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', text: '刪除', disabled: state.busy, onclick: function () { remove(a); } }))));
    });
  }

  /* ---------- 點座號 ---------- */
  function tap(seat) {
    if (!state.currentId) return;
    var cur = statusOf(seat);
    var server = serverStatus(seat);
    var next;
    if (!isRecorded()) {
      // 尚未點收：點一下標記有交，再點一下取消
      if (state.makeup) { App.toast('這份作業還沒點收，請先關閉補交模式，點有交的座號後儲存'); return; }
      next = cur === '正常' ? '未點' : '正常';
    } else if (state.makeup) {
      if (cur !== '缺交') { App.toast('補交模式只能點紅色（缺交）座號'); return; }
      next = '已補交';
    } else if (cur === '缺交') {
      // 改成有交：原本是已補交就回已補交，否則為準時交（正常）
      next = server === '已補交' ? '已補交' : '正常';
    } else {
      next = '缺交';
    }
    if (next === server) delete state.pending[seat];
    else state.pending[seat] = next;
    renderGrid();
    renderCount();
    renderSave();
  }

  /* ---------- 儲存 ---------- */
  async function save() {
    if (state.busy || !state.currentId) return;
    var first = !isRecorded();
    var changes;
    if (first) {
      // 第一次點收：有點到的是有交，沒點到的一律記為缺交
      var miss = unmarkedSeats();
      if (miss.length && !confirm('沒點到的 ' + miss.length + ' 人會記為缺交：\n' + miss.join('、') + ' 號\n\n確定要儲存嗎？')) return;
      changes = activeSeats().map(function (s) { return { seat: s, status: statusOf(s) === '正常' ? '正常' : '缺交' }; });
      if (!changes.length) return;
    } else {
      if (!hasPending()) return;
      changes = Object.keys(state.pending).map(function (s) { return { seat: Number(s), status: state.pending[s] }; });
    }
    state.busy = true;
    renderSave();
    try {
      await App.api('saveMissing', { assignmentId: state.currentId, changes: changes, markRecorded: first || undefined });
      state.pending = {};
      if (first) {
        var nMiss = changes.filter(function (c) { return c.status === '缺交'; }).length;
        App.toast('已點收：有交 ' + (changes.length - nMiss) + ' 人、缺交 ' + nMiss + ' 人');
      } else {
        App.toast('已儲存 ' + changes.length + ' 筆變更');
      }
      await load(state.currentId);
    } catch (e) {
      if (App.handleAuth(e, { teacherOnly: true })) return;
      App.toast('儲存失敗：' + App.errorText(e) + '（變更仍保留，可再按一次儲存）', 'error');
    } finally {
      state.busy = false;
      renderSave();
      renderList();
    }
  }

  function confirmDiscard() {
    if (!hasPending()) return true;
    if (!confirm('目前有 ' + Object.keys(state.pending).length + ' 筆變更尚未儲存，確定要放棄這些變更嗎？')) return false;
    state.pending = {};
    return true;
  }

  function switchTo(id) {
    if (id === state.currentId) return;
    if (!confirmDiscard()) { $('assignSelect').value = state.currentId; return; }
    setCurrent(id);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 作業管理 ---------- */
  async function run(fn) {
    if (state.busy) return;
    state.busy = true;
    renderList();
    try {
      await fn();
    } catch (e) {
      if (App.handleAuth(e, { teacherOnly: true })) return;
      App.toast(e.code === 'BOARD_FULL' ? '請先關閉一項' : App.errorText(e), 'error');
    } finally {
      state.busy = false;
    }
    await load(state.currentId);
  }

  function toggleBoard(a, sw) {
    var on = sw.checked;
    if (on && boardList().length >= MAX_BOARD) {
      sw.checked = false;
      App.toast('投影已滿 5 項，請先關閉一項', 'error');
      return;
    }
    run(async function () {
      await App.api('setBoard', { assignmentId: a.id, on: on });
      App.toast(on ? '已上投影' : '已取消投影');
    });
  }

  function move(id, dir) {
    var ids = boardList().map(function (a) { return a.id; });
    var i = ids.indexOf(id), j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    ids[i] = ids[j];
    ids[j] = id;
    run(async function () { await App.api('reorderBoard', { ids: ids }); });
  }

  function edit(a) {
    var name = prompt('作業名稱', a.name);
    if (name === null) return;
    name = name.trim();
    if (!name) { App.toast('作業名稱不可空白', 'error'); return; }
    var date = prompt('日期（格式 yyyy-mm-dd）', a.date);
    if (date === null) return;
    date = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { App.toast('日期格式要像 2026-10-19', 'error'); return; }
    run(async function () {
      await App.api('updateAssignment', { id: a.id, name: name, date: date });
      App.toast('已修改');
    });
  }

  function remove(a) {
    if (!confirm('確定要刪除「' + a.name + '」嗎？這份作業的缺交紀錄也會一起刪除，無法復原。')) return;
    if (a.id === state.currentId) state.pending = {};
    run(async function () {
      await App.api('deleteAssignment', { id: a.id });
      if (a.id === state.currentId) state.currentId = null;
      App.toast('已刪除');
    });
  }

  /* ---------- 新增作業 ---------- */
  $('btnShowNew').addEventListener('click', function () {
    $('newForm').hidden = false;
    this.hidden = true;
    $('newDate').value = App.todayYMD();
    $('newName').focus();
  });
  $('btnCancelNew').addEventListener('click', function () {
    $('newForm').hidden = true;
    $('btnShowNew').hidden = false;
    $('newName').value = '';
  });
  $('newForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('newName').value.trim();
    var date = $('newDate').value || App.todayYMD();
    if (!name) { App.toast('請輸入作業名稱', 'error'); return; }
    if (!confirmDiscard()) return;
    var btn = this.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      var a = await App.api('createAssignment', { name: name, date: date });
      App.toast(a.onBoard ? '已建立並上投影' : '已建立（投影已滿 5 項，未自動上投影）');
      $('btnCancelNew').click();
      await load(a.id);
    } catch (ex) {
      if (App.handleAuth(ex, { teacherOnly: true })) return;
      App.toast('建立失敗：' + App.errorText(ex), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- 其他事件 ---------- */
  $('assignSelect').addEventListener('change', function () { switchTo(this.value); });
  $('btnSave').addEventListener('click', save);
  $('btnMakeup').addEventListener('click', function () {
    state.makeup = !state.makeup;
    this.setAttribute('aria-pressed', state.makeup ? 'true' : 'false');
    this.textContent = state.makeup ? '補交模式：開' : '補交模式';
    document.body.classList.toggle('makeup', state.makeup);
  });
  window.addEventListener('beforeunload', function (e) {
    if (hasPending()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // 回到前景時重新載入（沒有未儲存變更時才更新，避免覆蓋）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !hasPending() && !state.busy && App.getCode()) load(state.currentId);
  });

  /* ---------- 啟動 ---------- */
  App.requireCode({ teacherOnly: true }).then(function (ok) { if (ok) load(); });
})();
