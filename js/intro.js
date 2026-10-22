/*
 * 系統介紹頁的動畫影片播放器。
 * 影片不是影片檔，而是 7 個網頁場景依時間輪流出現；每個場景的動畫寫在 css/intro.css。
 * 畫面只用假座號，不含任何學生資料。所有文字都用 textContent 放入，不使用 innerHTML。
 */
(function () {
  // 場景時間表：start 為開始秒數，cap 為字幕
  var SCENES = [
    { start: 0,  name: '片頭',     cap: '全校導師共用的班級管理網頁' },
    { start: 6,  name: '記錄缺交', cap: '手機點座號，缺交馬上記下來' },
    { start: 16, name: '投影看板', cap: '教室電腦投影，缺交座號全班都看得到' },
    { start: 25, name: '抽籤',     cap: '用抽籤券抽號碼，翻開卡片拿獎勵' },
    { start: 36, name: '卡片背包', cap: '3 張沒用過的卡，可以回收換 1 張抽籤券' },
    { start: 45, name: '全校共用', cap: '每班獨立驗證，只看得到自己班的資料' },
    { start: 54, name: '片尾',     cap: '' }
  ];
  var TOTAL = 60;

  var vp = document.getElementById('video');
  if (!vp) return;
  var screen = vp.querySelector('.vp-screen');
  var stage = vp.querySelector('.stage');
  var scenes = stage.querySelectorAll('.scene');
  var caption = stage.querySelector('.caption');
  var chapterTag = stage.querySelector('.chapter-tag');
  var live = document.querySelector('.caption-live');
  var poster = vp.querySelector('.vp-poster');
  var posterText = poster.querySelector('.poster-text');
  var toggleBtn = vp.querySelector('[data-act="toggle"]');
  var fsBtn = vp.querySelector('[data-act="fullscreen"]');
  var track = vp.querySelector('.vp-track');
  var fill = vp.querySelector('.vp-fill');
  var marks = vp.querySelector('.vp-marks');
  var timeEl = vp.querySelector('.vp-time');
  var chapterBox = vp.querySelector('.vp-chapters');

  var t = 0;            // 目前秒數
  var playing = false;
  var current = -1;     // 目前場景
  var lastTs = 0;

  /* ---------- 產生場景裡重複的小元素 ---------- */
  // 記錄頁的座號格：30 個座號，其中 5、12、23 號會依序被點成缺交
  var HITS = { 5: '1.6s', 12: '2.6s', 23: '3.6s' };
  var grid = document.getElementById('seatGrid');
  for (var n = 1; n <= 30; n++) {
    var seat = document.createElement('div');
    seat.className = 'seat' + (HITS[n] ? ' hit' : '');
    if (HITS[n]) seat.style.setProperty('--d', HITS[n]);
    seat.textContent = n;
    grid.appendChild(seat);
  }

  // 抽卡時噴出的彩紙
  var COLORS = ['#FFC53D', '#FF8A3D', '#FFE27A', '#B9B2E6', '#FF6B8A', '#7FD1AE'];
  var burst = document.getElementById('burst');
  for (var i = 0; i < 22; i++) {
    var p = document.createElement('i');
    var angle = (i / 22) * Math.PI * 2;
    var dist = 120 + (i % 4) * 30;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty('--x', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--y', Math.round(Math.sin(angle) * dist) + 'px');
    burst.appendChild(p);
  }

  /* ---------- 進度條刻度與章節按鈕 ---------- */
  var chapterBtns = [];
  SCENES.forEach(function (s, idx) {
    if (idx > 0) {
      var m = document.createElement('span');
      m.style.left = (s.start / TOTAL * 100) + '%';
      marks.appendChild(m);
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name;
    b.addEventListener('click', function () { seek(idx); play(); });
    chapterBox.appendChild(b);
    chapterBtns.push(b);
  });

  /* ---------- 舞台依外框寬度等比例縮放 ---------- */
  function fit() {
    stage.style.transform = 'scale(' + (screen.clientWidth / 960) + ')';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(screen);
  else window.addEventListener('resize', fit);
  fit();

  /* ---------- 播放控制 ---------- */
  function sceneAt(sec) {
    for (var k = SCENES.length - 1; k >= 0; k--) if (sec >= SCENES[k].start) return k;
    return 0;
  }

  function activate(idx) {
    current = idx;
    for (var k = 0; k < scenes.length; k++) scenes[k].classList.remove('on');
    void stage.offsetWidth; // 強制重新排版，讓同一場景的動畫可以從頭播放
    scenes[idx].classList.add('on');
    stage.setAttribute('data-on', idx);

    var s = SCENES[idx];
    caption.textContent = s.cap;
    caption.classList.remove('pop');
    void caption.offsetWidth;
    if (s.cap) caption.classList.add('pop');
    chapterTag.textContent = (idx > 0 && idx < SCENES.length - 1) ? ('0' + idx + '・' + s.name) : '';
    if (live) live.textContent = s.name + (s.cap ? '：' + s.cap : '');
    chapterBtns.forEach(function (b, k) { b.classList.toggle('on', k === idx); });
  }

  function render() {
    fill.style.width = (t / TOTAL * 100) + '%';
    track.setAttribute('aria-valuenow', Math.floor(t));
    timeEl.textContent = fmt(t) + ' / ' + fmt(TOTAL);
  }

  function fmt(sec) {
    sec = Math.floor(sec);
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  function tick(ts) {
    if (!playing) return;
    t += Math.min((ts - lastTs) / 1000, 0.25);
    lastTs = ts;
    if (t >= TOTAL) {
      t = TOTAL;
      render();
      end();
      return;
    }
    var idx = sceneAt(t);
    if (idx !== current) activate(idx);
    render();
    requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    if (t >= TOTAL) seek(0);
    if (current < 0) activate(sceneAt(t));
    poster.hidden = true;
    playing = true;
    vp.classList.remove('paused');
    toggleBtn.textContent = '❚❚';
    toggleBtn.setAttribute('aria-label', '暫停');
    lastTs = performance.now();
    requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    vp.classList.add('paused');
    toggleBtn.textContent = '▶';
    toggleBtn.setAttribute('aria-label', '播放');
  }

  function end() {
    pause();
    posterText.textContent = '重新播放';
    poster.hidden = false;
  }

  // 跳到某個章節的開頭（場景動畫只能從頭播，所以以章節為單位跳轉）
  function seek(idx) {
    t = SCENES[idx].start;
    activate(idx);
    render();
  }

  poster.addEventListener('click', function () { if (t >= TOTAL) seek(0); play(); });
  toggleBtn.addEventListener('click', function () { playing ? pause() : play(); });

  track.addEventListener('click', function (e) {
    var rect = track.getBoundingClientRect();
    var ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    seek(sceneAt(ratio * TOTAL));
    play();
  });
  track.addEventListener('keydown', function (e) {
    var idx = current < 0 ? 0 : current;
    if (e.key === 'ArrowRight' && idx < SCENES.length - 1) { seek(idx + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { seek(Math.max(idx - 1, 0)); e.preventDefault(); }
  });

  vp.addEventListener('keydown', function (e) {
    if (e.key === ' ' && (e.target === vp || e.target === track)) {
      e.preventDefault();
      playing ? pause() : play();
    }
  });

  fsBtn.addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (vp.requestFullscreen) vp.requestFullscreen();
  });

  // 切到別的分頁時自動暫停，回來再按播放
  document.addEventListener('visibilitychange', function () { if (document.hidden && playing) pause(); });

  // 初始畫面：停在片頭，等使用者按播放
  vp.classList.add('paused');
  activate(0);
  render();
})();
