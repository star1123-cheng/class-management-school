/*
 * 說明頁「聯絡窗口」：把欄位送到 Google 表單（設定在 config.js 的 CONTACT_FORM）。
 * Google 表單不回傳結果給別的網站（no-cors），所以只能確認「有送出去」；
 * 欄位長度與必填由 Google 表單再驗證一次。所有訊息都用 textContent 顯示。
 */
(function () {
  var form = document.getElementById('contactForm');
  if (!form) return;
  var msg = form.querySelector('.cf-msg');
  var btn = form.querySelector('.cf-submit');
  var cfg = (window.APP_CONFIG && window.APP_CONFIG.CONTACT_FORM) || {};
  var NAMES = ['學校', '姓名', '聯絡方式', '詢問類型'];
  var MESSAGE = '想詢問的內容';
  // 選這幾類時才顯示「想詢問的內容」且必填；選「申請開班」時不顯示
  var NEED_MESSAGE = ['使用問題', '建議回饋', '其他'];
  var WAIT_KEY = 'cms_contact_sent';   // 送出後 1 分鐘內不能再送，避免重複送出
  var WAIT_MS = 60 * 1000;

  var topic = form.elements['詢問類型'];
  var box = document.getElementById('cfMessage');
  var text = form.elements[MESSAGE];
  var count = form.querySelector('.cf-count');

  var ready = /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(cfg.action || '') &&
    NAMES.concat(MESSAGE).every(function (n) { return /^entry\.\d+$/.test((cfg.fields || {})[n] || ''); });

  function say(t, kind) {
    msg.textContent = t;
    msg.className = 'cf-msg' + (kind ? ' ' + kind : '');
  }

  function needMessage() { return NEED_MESSAGE.indexOf(topic.value) !== -1; }

  function updateCount() { count.textContent = text.value.length + ' / ' + text.maxLength; }

  function updateBox() {
    box.hidden = !needMessage();
    text.required = needMessage();
  }

  topic.addEventListener('change', updateBox);
  text.addEventListener('input', updateCount);
  form.addEventListener('reset', function () { setTimeout(function () { updateBox(); updateCount(); }, 0); });
  updateBox();
  updateCount();

  if (!ready) {
    btn.disabled = true;
    say('聯絡表單尚未開放，請稍後再試。', 'warn');
    return;
  }

  function lastSent() {
    try { return Number(localStorage.getItem(WAIT_KEY)) || 0; } catch (e) { return 0; }
  }

  // 檢查一個欄位；有問題時顯示訊息並回傳 null
  function check(name) {
    var el = form.elements[name];
    var value = el.value.trim();
    if (!value) {
      say('請填寫「' + name + '」。', 'err');
      el.focus();
      return null;
    }
    if (el.maxLength > 0 && value.length > el.maxLength) {
      say('「' + name + '」最多 ' + el.maxLength + ' 個字。', 'err');
      el.focus();
      return null;
    }
    return value;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.website.value) return; // 機器人才會填到隱藏欄位

    var names = needMessage() ? NAMES.concat(MESSAGE) : NAMES;
    var data = new URLSearchParams();
    for (var i = 0; i < names.length; i++) {
      var value = check(names[i]);
      if (value === null) return;
      data.append(cfg.fields[names[i]], value);
    }

    if (Date.now() - lastSent() < WAIT_MS) {
      say('剛剛已經送出過了，請稍候 1 分鐘再試。', 'warn');
      return;
    }

    btn.disabled = true;
    say('送出中…');
    fetch(cfg.action, { method: 'POST', mode: 'no-cors', body: data })
      .then(function () {
        try { localStorage.setItem(WAIT_KEY, String(Date.now())); } catch (err) { /* 無痕模式存不了也沒關係 */ }
        form.reset();
        say('✓ 已送出，我們會盡快與您聯繫，謝謝！', 'ok');
      })
      .catch(function () {
        say('送出失敗，請確認網路連線後再試一次。', 'err');
      })
      .then(function () { btn.disabled = false; });
  });
})();
