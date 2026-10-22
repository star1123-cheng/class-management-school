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
  var WAIT_KEY = 'cms_contact_sent';   // 送出後 1 分鐘內不能再送，避免重複送出
  var WAIT_MS = 60 * 1000;

  var ready = /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(cfg.action || '') &&
    NAMES.every(function (n) { return /^entry\.\d+$/.test((cfg.fields || {})[n] || ''); });

  function say(text, kind) {
    msg.textContent = text;
    msg.className = 'cf-msg' + (kind ? ' ' + kind : '');
  }

  if (!ready) {
    btn.disabled = true;
    say('聯絡表單尚未開放，請稍後再試。', 'warn');
    return;
  }

  function lastSent() {
    try { return Number(localStorage.getItem(WAIT_KEY)) || 0; } catch (e) { return 0; }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.website.value) return; // 機器人才會填到隱藏欄位

    var data = new URLSearchParams();
    for (var i = 0; i < NAMES.length; i++) {
      var el = form.elements[NAMES[i]];
      var value = el.value.trim();
      if (!value) {
        say('請填寫「' + NAMES[i] + '」。', 'err');
        el.focus();
        return;
      }
      if (el.maxLength > 0 && value.length > el.maxLength) {
        say('「' + NAMES[i] + '」最多 ' + el.maxLength + ' 個字。', 'err');
        el.focus();
        return;
      }
      data.append(cfg.fields[NAMES[i]], value);
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
