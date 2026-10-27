/*
 * 共用模組：API 請求封裝、登入（班級代號＋存取碼）處理、錯誤訊息與小工具
 * 所有請求一律 POST，Content-Type 用 text/plain 以避免 CORS 預檢。
 * 瀏覽器儲存的鍵名一律用 cms_ 開頭：GitHub Pages 上單班版與全校版是同一個網域，
 * 用不同的鍵名才不會互相讀到對方的存取碼。
 */
(function () {
  'use strict';

  var LOGIN_KEY = 'cms_login';
  var CLASS_ID_RE = /^[0-9A-Za-z-]{1,10}$/;

  // 卡片圖示代號對照（要和 gas/Code.gs 的 ICONS 一致）；後端只存代號
  var ICONS = {
    sparkle: '✦', headphones: '🎧', clapper: '🎬', handshake: '🤝', moneybag: '💰', cool: '😎',
    notebook: '📒', medal: '🏅', teacher: '🧑‍🏫', broom: '🧹', clover: '🍀', memo: '📝',
    gem: '💎', redo: '🔄', picnic: '🧺', cloud: '☁️', glow: '🌟', gift: '🎁',
    trophy: '🏆', music: '🎵', books: '📚', pencil: '✏️', candy: '🍬', ticket: '🎟️',
    crown: '👑', rocket: '🚀', game: '🎮', ball: '⚽'
  };
  function iconOf(key) { return ICONS.hasOwnProperty(key) ? ICONS[key] : ICONS.sparkle; }

  // 卡片效果（要和 gas/Code.gs 的 EFFECTS 一致）；自動效果一律看效果，不看卡名
  var EFFECT = { NONE: '無', REDRAW: '再抽一次', CHOOSE: '自選卡片', PRIZE: '實物' };

  var ERROR_TEXT = {
    UNAUTHORIZED: '班級代號或存取碼錯誤，請重新輸入。',
    FORBIDDEN: '這台裝置登入的是班級碼，這個功能需要導師碼。',
    TOO_MANY_ATTEMPTS: '輸入錯誤太多次，請 10 分鐘後再試。',
    SAME_CODE: '導師碼和班級碼不可以相同。',
    WEAK_CODE: '代碼要 6 到 32 個字，而且不可以有空白。',
    ALREADY_EXISTS: '這個班級代號已經存在。',
    DUPLICATE_NAME: '已經有同名的卡片，請換一個名稱。',
    TOO_MANY_CARDS: '卡片數量已達上限。',
    INVALID_INPUT: '資料格式不正確，請檢查後再試一次。',
    NOT_FOUND: '找不到這筆資料，可能已被刪除，請重新整理。',
    BOARD_FULL: '投影已滿 5 項，請先關閉一項。',
    LOCKED_TIMEOUT: '系統忙碌中，請稍後再試一次。',
    NO_TICKET: '這位同學沒有抽籤券了。',
    POOL_EMPTY: '籤池已全部抽完。',
    ALREADY_USED: '這張卡已經使用過了。',
    NOT_RECYCLABLE: '實物獎品不能回收換券。',
    NOT_USED: '這張卡還沒有使用，不需要復原。',
    CANNOT_UNDO: '無法復原：這張卡送出的抽籤券或挑到的卡片已經用掉了。',
    CANCELLED: '已取消。',
    SERVER_ERROR: '伺服器發生錯誤，請稍後再試。',
    NETWORK: '網路連線失敗，請檢查網路後再試一次。',
    NO_CONFIG: '尚未設定 GAS 網址，請先編輯 config.js 的 GAS_URL。',
    NO_CODE: '尚未輸入班級代號與存取碼。',
    BAD_RESPONSE: '伺服器回應格式不正確，請確認 config.js 的 GAS 網址與部署設定。'
  };

  function ApiError(code) {
    this.name = 'ApiError';
    this.code = code;
    this.message = ERROR_TEXT[code] || ('發生錯誤（' + code + '）');
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /* ---------- localStorage（包 try/catch，無痕模式也不會壞） ---------- */
  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storeRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }
  function storeGetJSON(key, fallback) {
    var raw = storeGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function storeSetJSON(key, value) { return storeSet(key, JSON.stringify(value)); }

  /* ---------- 登入（班級代號＋存取碼） ----------
   * 「記住在這台裝置」存在 localStorage；「暫時登入」存在 sessionStorage（關閉分頁就消失）。
   * 暫時登入優先，讓導師在班級電腦上用導師碼操作時，不會把導師碼留在電腦上。
   */
  function parseLogin(raw) {
    if (!raw) return null;
    try {
      var v = JSON.parse(raw);
      return v && typeof v.classId === 'string' && typeof v.code === 'string' && v.classId && v.code ? v : null;
    } catch (e) { return null; }
  }
  function sessionGet() {
    try { return parseLogin(window.sessionStorage.getItem(LOGIN_KEY)); } catch (e) { return null; }
  }
  function sessionSet(v) {
    try { window.sessionStorage.setItem(LOGIN_KEY, JSON.stringify(v)); } catch (e) { /* 忽略 */ }
  }
  function sessionRemove() {
    try { window.sessionStorage.removeItem(LOGIN_KEY); } catch (e) { /* 忽略 */ }
  }
  function getLogin() { return sessionGet() || parseLogin(storeGet(LOGIN_KEY)); }
  function getCode() { var l = getLogin(); return l ? l.code : ''; }
  function getClassId() { var l = getLogin(); return l ? l.classId : ''; }
  function setLogin(classId, code, remember) {
    var v = { classId: classId, code: code };
    if (remember === false) {
      sessionSet(v);
    } else {
      storeSetJSON(LOGIN_KEY, v);
      sessionRemove();
    }
  }
  /** 只清除目前正在使用的那一組（暫時登入優先） */
  function clearActiveCode() {
    if (sessionGet()) sessionRemove();
    else storeRemove(LOGIN_KEY);
  }
  function clearCode() { sessionRemove(); storeRemove(LOGIN_KEY); }
  function isTempLogin() { return !!sessionGet(); }
  function isClassId(v) { return typeof v === 'string' && CLASS_ID_RE.test(v); }

  /* ---------- API ---------- */
  /** 班級 API：自動帶上班級代號與存取碼（opts.classId、opts.code 可以指定別組） */
  async function api(action, params, opts) {
    opts = opts || {};
    var login = getLogin() || {};
    var classId = opts.classId !== undefined ? opts.classId : login.classId;
    var code = opts.code !== undefined ? opts.code : login.code;
    if (!classId || !code) {
      if ((window.APP_CONFIG || {}).GAS_URL) throw new ApiError('NO_CODE');
      throw new ApiError('NO_CONFIG');
    }
    return post(Object.assign({}, params || {}, { action: action, classId: classId, code: code }), opts.timeout);
  }

  /** 管理 API：管理密碼由呼叫端傳入，這裡不儲存 */
  function adminApi(action, params, password) {
    return post(Object.assign({}, params || {}, { action: action, adminPassword: password }));
  }

  async function post(body, timeout) {
    var cfg = window.APP_CONFIG || {};
    if (!cfg.GAS_URL) throw new ApiError('NO_CONFIG');
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout || 25000) : null;
    var res;
    try {
      res = await fetch(cfg.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      throw new ApiError('NETWORK');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new ApiError('NETWORK');
    var json;
    try { json = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE'); }
    if (!json || json.ok !== true) throw new ApiError((json && json.error) || 'BAD_RESPONSE');
    return json.data;
  }

  function errorText(err) {
    if (err && err.code && ERROR_TEXT[err.code]) return ERROR_TEXT[err.code];
    if (err && err.message) return err.message;
    return '發生未知錯誤。';
  }

  /* ---------- DOM 小工具（一律用 textContent，不用 innerHTML） ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer = null;
  function toast(msg, type) {
    var el = document.getElementById('app-toast');
    if (!el) {
      el = h('div', { id: 'app-toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, type === 'error' ? 4500 : 2500);
  }

  /* ---------- 時間格式 ---------- */
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function toDate(v) { var d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d; }
  function fmtHM(v) { var d = toDate(v); return d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }
  function fmtMD(v) { var d = toDate(v); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; }
  /** yyyy-mm-dd 字串轉 M/D，不經過時區換算 */
  function ymdToMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? Number(m[2]) + '/' + Number(m[3]) : (s || '');
  }
  function todayYMD() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weekday(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return '';
    return '日一二三四五六'.charAt(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay());
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID().replace(/-/g, '');
    var a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ---------- 登入視窗 ---------- */
  var gateOpen = null;
  /**
   * 登入視窗：輸入班級代號與存取碼
   * opts.teacherOnly：這一頁需要導師碼（記錄頁、設定頁），輸入班級碼會被拒絕
   * opts.remember：「記住在這台裝置」預設是否勾選
   * opts.noStore：只回傳輸入的存取碼，不存到瀏覽器（用於單次的導師操作，班級代號沿用目前登入的班級）
   * opts.cancelable：顯示「取消」按鈕，按下後回傳 null
   */
  function codeGate(message, opts) {
    if (gateOpen) return gateOpen;
    opts = opts || {};
    gateOpen = new Promise(function (resolve) {
      function close(value) {
        wrap.remove();
        gateOpen = null;
        resolve(value);
      }
      var lockClass = !!(opts.noStore && getClassId());
      var classInput = h('input', { type: 'text', class: 'input', placeholder: '班級代號（例如 501）', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: '10', 'aria-label': '班級代號' });
      classInput.value = getClassId();
      if (lockClass) classInput.disabled = true;
      var input = h('input', { type: 'password', class: 'input', placeholder: opts.teacherOnly ? '導師碼' : '導師碼或班級碼', autocomplete: 'current-password', 'aria-label': '存取碼' });
      var remember = h('input', { type: 'checkbox' });
      remember.checked = opts.remember !== false;
      var err = h('p', { class: 'gate-error', role: 'alert' });
      var btn = h('button', { type: 'submit', class: 'btn btn-primary', text: '確認' });
      var links = opts.teacherOnly && !opts.noStore ? h('p', { class: 'gate-links' },
        '只要投影或抽籤？前往 ', h('a', { href: 'board.html', text: '投影頁' }), '、', h('a', { href: 'lottery.html', text: '抽籤頁' })) : null;
      var cancel = opts.cancelable ? h('button', { type: 'button', class: 'btn gate-cancel', text: '取消', onclick: function () { close(null); } }) : null;
      var form = h('form', { class: 'gate-box' },
        h('h2', { text: opts.teacherOnly ? '請輸入導師碼' : '請登入班級' }),
        h('p', { class: 'gate-hint', text: message || '輸入班級代號，再輸入代碼：導師的裝置輸入「導師碼」；班級電腦輸入「班級碼」。' }),
        classInput,
        input,
        opts.noStore ? null : h('label', { class: 'gate-remember' }, remember, ' 記住在這台裝置（班級電腦輸入導師碼時請不要勾選）'),
        err, btn, cancel, links);
      var wrap = h('div', { class: 'gate', role: 'dialog', 'aria-modal': 'true' }, form);
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var classId = classInput.value.trim();
        var code = input.value.trim();
        if (!isClassId(classId)) { err.textContent = '班級代號只能是 1 到 10 個英文字母、數字或「-」。'; return; }
        if (!code) { err.textContent = '請輸入存取碼。'; return; }
        btn.disabled = true;
        btn.textContent = '檢查中…';
        err.textContent = '';
        try {
          var d = await api('ping', {}, { classId: classId, code: code });
          if (opts.teacherOnly && d.role !== 'teacher') {
            err.textContent = '這是班級碼，這一頁需要導師碼。';
            btn.disabled = false;
            btn.textContent = '確認';
            return;
          }
          if (!opts.noStore) setLogin(classId, code, remember.checked);
          close(code);
        } catch (ex) {
          err.textContent = errorText(ex);
          btn.disabled = false;
          btn.textContent = '確認';
        }
      });
      document.body.appendChild(wrap);
      setTimeout(function () { (classInput.value ? input : classInput).focus(); }, 50);
    });
    return gateOpen;
  }

  /** 還沒登入時先跳出登入視窗，再執行頁面初始化 */
  async function requireCode(opts) {
    if (!(window.APP_CONFIG || {}).GAS_URL) {
      toast(ERROR_TEXT.NO_CONFIG, 'error');
      return false;
    }
    if (!getCode()) await codeGate(null, opts);
    return true;
  }

  /**
   * UNAUTHORIZED：清除目前的登入資料並要求重新輸入。
   * FORBIDDEN：這台裝置是班級碼，要求輸入導師碼（預設只暫時登入，不留在電腦上）。
   * 成功後重新整理頁面。
   */
  function handleAuth(err, opts) {
    if (err && err.code === 'UNAUTHORIZED') {
      clearActiveCode();
      codeGate('班級代號或存取碼錯誤，或代碼已被變更，請重新輸入。', opts).then(function () { location.reload(); });
      return true;
    }
    if (err && err.code === 'FORBIDDEN') {
      codeGate('這台裝置目前登入的是班級碼，只能使用投影頁與抽籤頁。要使用這一頁，請輸入導師碼。', { teacherOnly: true, remember: false })
        .then(function () { location.reload(); });
      return true;
    }
    return false;
  }

  /**
   * 呼叫只有導師碼能用的 API（例如使用卡片）。
   * 這台裝置是班級碼時，跳出導師碼視窗；導師碼只放在記憶體 3 分鐘，
   * 不存進瀏覽器，重新整理或關閉分頁就消失。使用者按「取消」時丟出 CANCELLED。
   */
  var TEACHER_TEMP_MS = 3 * 60 * 1000;
  var teacherTemp = null;
  async function teacherApi(action, params) {
    if (teacherTemp && Date.now() < teacherTemp.until) {
      try {
        return await api(action, params, { code: teacherTemp.code });
      } catch (e) {
        if (e.code !== 'UNAUTHORIZED') throw e;
        teacherTemp = null; // 導師碼已變更，重新詢問
      }
    }
    try {
      return await api(action, params);
    } catch (e) {
      if (e.code !== 'FORBIDDEN') throw e;
    }
    var code = await codeGate('這個動作需要導師碼。導師碼只用在接下來 3 分鐘，不會留在這台電腦上。', { teacherOnly: true, noStore: true, cancelable: true });
    if (!code) throw new ApiError('CANCELLED');
    teacherTemp = { code: code, until: Date.now() + TEACHER_TEMP_MS };
    return api(action, params, { code: code });
  }

  function toggleFullscreen() {
    var d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
  }

  window.App = {
    api: api,
    teacherApi: teacherApi,
    ApiError: ApiError,
    ERROR_TEXT: ERROR_TEXT,
    errorText: errorText,
    adminApi: adminApi,
    getCode: getCode,
    getClassId: getClassId,
    setLogin: setLogin,
    isClassId: isClassId,
    ICONS: ICONS,
    iconOf: iconOf,
    EFFECT: EFFECT,
    clearCode: clearCode,
    isTempLogin: isTempLogin,
    store: { get: storeGet, set: storeSet, remove: storeRemove, getJSON: storeGetJSON, setJSON: storeSetJSON },
    h: h,
    clear: clear,
    toast: toast,
    fmtHM: fmtHM,
    fmtMD: fmtMD,
    ymdToMD: ymdToMD,
    todayYMD: todayYMD,
    weekday: weekday,
    newId: newId,
    codeGate: codeGate,
    requireCode: requireCode,
    handleAuth: handleAuth,
    toggleFullscreen: toggleFullscreen
  };
})();
