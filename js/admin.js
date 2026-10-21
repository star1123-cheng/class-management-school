/* 管理者開班頁：登入管理密碼、班級列表、開班、重設代碼、停用、刪除班級 */
(function () {
  'use strict';
  var h = App.h;
  var $ = function (id) { return document.getElementById(id); };

  // 管理密碼只放在這個變數裡，不存進瀏覽器
  var password = '';
  var classes = [];

  function setStatus(el, msg, ok) {
    el.textContent = msg;
    el.className = 'status-line' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
  }

  async function call(action, params) {
    try {
      return await App.adminApi(action, params, password);
    } catch (e) {
      if (e.code === 'UNAUTHORIZED') logout('管理密碼錯誤或已被變更，請重新登入。');
      throw e;
    }
  }

  /* ============ 登入／登出 ============ */
  $('adminForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var pw = $('adminPassword').value;
    if (!pw) { setStatus($('adminStatus'), '請輸入管理密碼。', false); return; }
    $('btnAdminLogin').disabled = true;
    setStatus($('adminStatus'), '檢查中…');
    try {
      await App.adminApi('adminPing', {}, pw);
      password = pw;
      $('adminPassword').value = '';
      $('adminPassword').hidden = true;
      $('btnAdminLogin').hidden = true;
      $('btnAdminLogout').hidden = false;
      $('adminArea').hidden = false;
      setStatus($('adminStatus'), '已登入管理者。', true);
      loadClasses();
    } catch (ex) {
      setStatus($('adminStatus'), '登入失敗：' + (ex.code === 'UNAUTHORIZED' ? '管理密碼錯誤。' : App.errorText(ex)), false);
    } finally {
      $('btnAdminLogin').disabled = false;
    }
  });

  $('btnAdminLogout').addEventListener('click', function () { logout('已登出。'); });

  function logout(msg) {
    password = '';
    classes = [];
    $('adminPassword').hidden = false;
    $('btnAdminLogin').hidden = false;
    $('btnAdminLogout').hidden = true;
    $('adminArea').hidden = true;
    App.clear($('classBody'));
    App.clear($('classPanel'));
    setStatus($('adminStatus'), msg, msg === '已登出。' ? null : false);
  }

  /* ============ 班級列表 ============ */
  async function loadClasses() {
    try {
      var d = await call('adminListClasses');
      classes = d.classes;
      renderClasses();
    } catch (e) {
      setStatus($('classStatus'), '載入失敗：' + App.errorText(e), false);
    }
  }

  function renderClasses() {
    var body = $('classBody');
    App.clear(body);
    if (classes.length === 0) {
      body.appendChild(h('tr', {}, h('td', { colspan: '5', class: 'muted', text: '還沒有任何班級，請在下方開班。' })));
      return;
    }
    classes.forEach(function (c) {
      body.appendChild(h('tr', {},
        h('td', { text: c.classId }),
        h('td', { text: c.name }),
        h('td', { text: c.active ? '啟用' : '停用' }),
        h('td', { text: App.fmtMD(c.createdAt) }),
        h('td', {},
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-small', text: '重設代碼', onclick: function () { showResetPanel(c); } }),
            h('button', { type: 'button', class: 'btn btn-small', text: c.active ? '停用' : '啟用', onclick: function () { toggleActive(c); } }),
            h('button', { type: 'button', class: 'btn btn-small btn-danger', text: '刪除', onclick: function () { showDeletePanel(c); } })))));
    });
  }

  async function toggleActive(c) {
    var next = !c.active;
    var msg = next ? '要啟用「' + c.classId + '」嗎？' : '要停用「' + c.classId + '」嗎？停用後這個班級的導師碼與班級碼都無法登入，資料會保留。';
    if (!confirm(msg)) return;
    try {
      await call('adminSetActive', { classId: c.classId, active: next });
      setStatus($('classStatus'), c.classId + ' 已' + (next ? '啟用' : '停用') + '。', true);
      loadClasses();
    } catch (e) {
      setStatus($('classStatus'), App.errorText(e), false);
    }
  }

  /* ---------- 重設代碼 ---------- */
  function showResetPanel(c) {
    var panel = $('classPanel');
    App.clear(panel);
    var teacher = h('input', { type: 'text', class: 'input', maxlength: '32', autocomplete: 'off', spellcheck: 'false', placeholder: '不改請留空' });
    var display = h('input', { type: 'text', class: 'input', maxlength: '32', autocomplete: 'off', spellcheck: 'false', placeholder: '不改請留空' });
    var status = h('p', { class: 'status-line' });
    var form = h('form', { class: 'card', style: 'margin-top:12px' },
      h('h3', { text: '重設「' + c.classId + '」的代碼' }),
      h('p', { class: 'muted', text: '只填要改的那一組。重設後舊代碼立刻失效，已登入的裝置要重新輸入。' }),
      h('label', { class: 'field' }, '新的導師碼', teacher),
      h('label', { class: 'field' }, '新的班級碼', display),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: '產生隨機代碼', onclick: function () {
          teacher.value = randomCode(12);
          display.value = randomCode(8);
        } }),
        h('button', { type: 'submit', class: 'btn btn-primary', text: '確認重設' }),
        h('button', { type: 'button', class: 'btn', text: '取消', onclick: function () { App.clear(panel); } })),
      status);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var params = { classId: c.classId };
      if (teacher.value) params.teacherCode = teacher.value;
      if (display.value) params.classCode = display.value;
      if (!params.teacherCode && !params.classCode) { setStatus(status, '請至少填一組新代碼。', false); return; }
      setStatus(status, '重設中…');
      try {
        await call('adminSetCodes', params);
        setStatus(status, '已重設。請把新代碼抄給導師，離開這一頁後就看不到了。', true);
        teacher.readOnly = true;
        display.readOnly = true;
      } catch (ex) {
        setStatus(status, App.errorText(ex), false);
      }
    });
    panel.appendChild(form);
    teacher.focus();
  }

  /* ---------- 刪除班級 ---------- */
  function showDeletePanel(c) {
    var panel = $('classPanel');
    App.clear(panel);
    var confirmInput = h('input', { type: 'text', class: 'input', autocomplete: 'off', placeholder: c.classId });
    var btn = h('button', { type: 'submit', class: 'btn btn-danger', text: '永久刪除', disabled: true });
    var status = h('p', { class: 'status-line' });
    confirmInput.addEventListener('input', function () { btn.disabled = confirmInput.value.trim() !== c.classId; });
    var form = h('form', { class: 'card', style: 'margin-top:12px' },
      h('h3', { text: '刪除「' + c.classId + '」' }),
      h('p', { class: 'muted', text: '會刪除這個班級的名單、作業、缺交、抽籤券、籤池、卡片、抽籤紀錄與背包，無法復原。學期末或畢業後清除資料時使用；只是暫時不用請改按「停用」。' }),
      h('label', { class: 'field' }, '請輸入班級代號「' + c.classId + '」確認', confirmInput),
      h('div', { class: 'row' }, btn,
        h('button', { type: 'button', class: 'btn', text: '取消', onclick: function () { App.clear(panel); } })),
      status);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (confirmInput.value.trim() !== c.classId) return;
      btn.disabled = true;
      setStatus(status, '刪除中…');
      try {
        await call('adminDeleteClass', { classId: c.classId, confirm: c.classId });
        App.clear(panel);
        setStatus($('classStatus'), c.classId + ' 已刪除。', true);
        loadClasses();
      } catch (ex) {
        setStatus(status, App.errorText(ex), false);
        btn.disabled = false;
      }
    });
    panel.appendChild(form);
    confirmInput.focus();
  }

  /* ============ 開班 ============ */
  // 隨機代碼：去掉容易看錯的 0、O、1、l、I
  var CODE_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randomCode(len) {
    var a = new Uint32Array(len);
    window.crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < len; i++) s += CODE_CHARS.charAt(a[i] % CODE_CHARS.length);
    return s;
  }

  $('btnGenCodes').addEventListener('click', function () {
    $('newTeacherCode').value = randomCode(12);
    $('newClassCode').value = randomCode(8);
  });

  $('createForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var classId = $('newClassId').value.trim();
    var name = $('newClassName').value.trim();
    var teacherCode = $('newTeacherCode').value;
    var classCode = $('newClassCode').value;
    var st = $('createStatus');
    if (!App.isClassId(classId)) { setStatus(st, '班級代號只能是 1 到 10 個英文字母、數字或「-」。', false); return; }
    if (!name || name.length > 20) { setStatus(st, '請輸入班級名稱（最多 20 字）。', false); return; }
    if (teacherCode.length < 6 || classCode.length < 6 || /\s/.test(teacherCode + classCode)) { setStatus(st, App.ERROR_TEXT.WEAK_CODE, false); return; }
    if (teacherCode === classCode) { setStatus(st, App.ERROR_TEXT.SAME_CODE, false); return; }
    $('btnCreate').disabled = true;
    setStatus(st, '開班中…（會建立籤池與預設卡片，需要幾秒鐘）');
    try {
      var d = await call('adminCreateClass', { classId: classId, name: name, teacherCode: teacherCode, classCode: classCode });
      setStatus(st, '已開班：' + d.classId + '（' + d.name + '）。請把班級代號、導師碼、班級碼抄給導師，按「清空表單」後就看不到了。', true);
      $('createForm').querySelectorAll('input').forEach(function (el) { el.readOnly = true; });
      $('btnCreate').textContent = '清空表單';
      $('btnCreate').disabled = false;
      $('btnCreate').dataset.done = '1';
      loadClasses();
    } catch (ex) {
      setStatus(st, '開班失敗：' + App.errorText(ex), false);
      $('btnCreate').disabled = false;
    }
  });

  // 開班成功後，「開班」按鈕變成「清空表單」
  $('btnCreate').addEventListener('click', function (e) {
    if (this.dataset.done !== '1') return;
    e.preventDefault();
    $('createForm').querySelectorAll('input').forEach(function (el) { el.readOnly = false; el.value = ''; });
    delete this.dataset.done;
    this.textContent = '開班';
    setStatus($('createStatus'), '');
  });

  if (!(window.APP_CONFIG || {}).GAS_URL) setStatus($('adminStatus'), App.ERROR_TEXT.NO_CONFIG, false);
})();
