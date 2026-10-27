/*
 * 抽籤頁視覺效果：星空、跑馬燈、籤紙飛出與撕開、實物揭曉、票券翻轉、彩帶
 * 所有等待都透過外部傳入的 wait(ms)，讓「跳過」可以立即結束。
 */
(function () {
  'use strict';
  var h = App.h;

  /* ---------- 星空背景 ---------- */
  function initStars(canvas, reduced) {
    var c = canvas.getContext('2d');
    var stars = [];
    var w = 0, hgt = 0, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; hgt = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = hgt * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var count = Math.round((w * hgt) / 9000);
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w, y: Math.random() * hgt,
          r: Math.random() * 1.6 + 0.3,
          s: Math.random() * 0.12 + 0.03,
          p: Math.random() * Math.PI * 2,
          gold: Math.random() < 0.18
        });
      }
      if (reduced) draw(0);
    }
    function draw(t) {
      c.clearRect(0, 0, w, hgt);
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        if (!reduced) {
          st.y -= st.s;
          st.x += st.s * 0.3;
          if (st.y < -2) { st.y = hgt + 2; st.x = Math.random() * w; }
          if (st.x > w + 2) st.x = -2;
        }
        var a = reduced ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(t / 1400 + st.p));
        c.globalAlpha = a;
        c.fillStyle = st.gold ? '#FFE27A' : '#FFF4D6';
        c.beginPath();
        c.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    function loop(t) { draw(t); requestAnimationFrame(loop); }
    window.addEventListener('resize', resize);
    resize();
    if (!reduced) requestAnimationFrame(loop);
  }

  /* ---------- 跑馬燈 ---------- */
  /**
   * cells：{ 號碼: 元素 }；candidates：未抽號碼陣列
   * 回傳控制器：stopAt(target, decelMs, wait) 由快到慢停在 target；cancel() 立即停止
   */
  function createMarquee(cells, candidates) {
    var current = null;
    var running = true;
    var fastTimer = null;
    var list = candidates.slice();

    function light(n) {
      if (current !== null && cells[current]) cells[current].classList.remove('hot');
      current = n;
      if (n !== null && cells[n]) cells[n].classList.add('hot');
    }
    function randomNext() {
      if (list.length === 1) return list[0];
      var n;
      do { n = list[Math.floor(Math.random() * list.length)]; } while (n === current);
      return n;
    }
    // 結果回來前：持續快速跳動
    (function fast() {
      if (!running) return;
      light(randomNext());
      fastTimer = setTimeout(fast, 65);
    })();

    return {
      stopAt: async function (target, decelMs, wait, isSkipped) {
        running = false;
        clearTimeout(fastTimer);
        // 產生由快到慢的間隔，總長約 decelMs
        var steps = [];
        var total = 0, gap = 65;
        while (total < decelMs) {
          steps.push(gap);
          total += gap;
          gap = Math.min(gap * 1.12 + 6, 420);
        }
        for (var i = 0; i < steps.length - 1; i++) {
          if (isSkipped()) break;
          light(randomNext());
          await wait(steps[i]);
        }
        light(target);
        return target;
      },
      cancel: function () {
        running = false;
        clearTimeout(fastTimer);
        light(null);
      },
      clear: function () { light(null); }
    };
  }

  /* ---------- 籤紙 ---------- */
  /** 產生左右兩半的鋸齒撕裂線（clip-path） */
  function tearPaths() {
    var pts = [];
    var steps = 14;
    for (var i = 0; i <= steps; i++) {
      var y = (i / steps) * 100;
      var x = 50 + (i % 2 === 0 ? -1 : 1) * (2 + Math.random() * 4);
      pts.push(x.toFixed(1) + '% ' + y.toFixed(1) + '%');
    }
    var left = 'polygon(0 0, ' + pts.join(', ') + ', 0 100%)';
    var right = 'polygon(100% 0, ' + pts.join(', ') + ', 100% 100%)';
    return { left: left, right: right };
  }

  function paperFace(number) {
    return h('div', { class: 'paper-face' },
      h('div', { class: 'p-label', text: '一番賞' }),
      h('div', { class: 'p-num', text: String(number) }),
      h('div', { class: 'p-star', text: '★★★' }));
  }

  /** 號碼從格子飛到畫面中央 */
  async function flyPaper(stage, fromEl, number, ms, wait) {
    var paths = tearPaths();
    var glow = h('div', { class: 'paper-glow' });
    var left = h('div', { class: 'paper-half', style: 'clip-path:' + paths.left + ';-webkit-clip-path:' + paths.left }, paperFace(number));
    var right = h('div', { class: 'paper-half', style: 'clip-path:' + paths.right + ';-webkit-clip-path:' + paths.right }, paperFace(number));
    var paper = h('div', { class: 'paper' }, glow, left, right);
    stage.appendChild(paper);

    var to = paper.getBoundingClientRect();
    var from = fromEl ? fromEl.getBoundingClientRect() : null;
    if (from && ms > 0 && paper.animate) {
      var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
      var dy = (from.top + from.height / 2) - (to.top + to.height / 2);
      var sc = from.width / to.width;
      var anim = paper.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 0.6 },
        { transform: 'translate(0,0) scale(1.06)', opacity: 1, offset: 0.8 },
        { transform: 'translate(0,0) scale(1)', opacity: 1 }
      ], { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)' });
      await Promise.race([anim.finished, wait(ms)]);
    }
    return { paper: paper, left: left, right: right, glow: glow };
  }

  /** 撕開籤紙：steps 次逐步裂開，最後兩半飛走 */
  async function tearPaper(p, steps, stepMs, wait, isSkipped, onStep) {
    for (var k = 1; k <= steps; k++) {
      if (isSkipped()) break;
      var spread = k / steps;
      p.left.style.transform = 'translateX(' + (-spread * 2.2) + 'vh) rotate(' + (-spread * 6) + 'deg)';
      p.right.style.transform = 'translateX(' + (spread * 2.2) + 'vh) rotate(' + (spread * 6) + 'deg)';
      p.glow.style.opacity = String(0.25 + spread * 0.75);
      p.paper.classList.remove('shake');
      void p.paper.offsetWidth;
      p.paper.classList.add('shake');
      if (onStep) onStep(k);
      await wait(stepMs);
    }
    if (isSkipped()) { p.paper.remove(); return; }
    var out = Math.max(stepMs * 0.9, 200);
    p.left.style.transition = 'transform ' + out + 'ms ease-in, opacity ' + out + 'ms ease-in';
    p.right.style.transition = p.left.style.transition;
    p.left.style.transform = 'translateX(-70vw) rotate(-35deg)';
    p.right.style.transform = 'translateX(70vw) rotate(35deg)';
    p.left.style.opacity = '0';
    p.right.style.opacity = '0';
    p.glow.style.opacity = '1';
    await wait(out * 0.6);
    p.paper.remove();
  }

  /* ---------- 揭曉 ---------- */
  function revealPrize(stage, result, opts) {
    if (!opts.reduced) stage.appendChild(h('div', { class: 'rays' }));
    stage.appendChild(h('div', { class: 'flash' }));
    var box = h('div', { class: 'prize' },
      h('div', { class: 'p-tag', text: '★ 大獎 ★' }),
      h('div', { class: 'p-title', text: result.name }),
      h('div', { class: 'p-who' }, '請發給 ', h('strong', { text: String(result.seat) }), ' 號同學'),
      h('div', { class: 'p-no', text: 'No. ' + result.number }));
    stage.appendChild(box);
  }

  /* ---------- 收藏卡牌 ---------- */
  // 圖示看卡片的「圖示」代號（老師在卡片管理挑選）；色相依圖示決定，同一種圖示顏色一致
  var ICON_HUE = {
    headphones: 285, clapper: 355, handshake: 205, moneybag: 42, cool: 160, notebook: 25,
    medal: 50, teacher: 180, broom: 95, clover: 325, memo: 220, gem: 265,
    redo: 190, picnic: 120, cloud: 240, glow: 35, gift: 15
  };
  function cardArt(card) {
    var key = card.icon || '';
    if (ICON_HUE.hasOwnProperty(key)) return { icon: App.iconOf(key), hue: ICON_HUE[key] };
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360;
    return { icon: App.iconOf(key), hue: hash };
  }

  /**
   * 直式收藏卡牌（揭曉與背包共用）
   * card：{ name, description, icon }；opts.topLeft／opts.topRight：上方小字；opts.tag：外層標籤（預設 div）
   */
  function cardEl(card, opts) {
    opts = opts || {};
    var art = cardArt(card);
    var props = Object.assign({}, opts.props || {});
    props.class = 'tcard' + (props.class ? ' ' + props.class : '');
    props.style = '--h:' + art.hue + (props.style ? ';' + props.style : '');
    return h(opts.tag || 'div', props,
      h('span', { class: 'tc-inner' },
        h('span', { class: 'tc-top' },
          h('span', { text: opts.topLeft || '' }),
          h('span', { text: opts.topRight || '' })),
        h('span', { class: 'tc-art', 'aria-hidden': 'true' }, h('span', { class: 'tc-icon', text: art.icon })),
        h('span', { class: 'tc-name', text: card.name }),
        h('span', { class: 'tc-desc', text: card.description || '' }),
        h('span', { class: 'tc-foot', 'aria-hidden': 'true', text: '✦ 雲端一番賞 ✦' })),
      h('span', { class: 'tc-shine', 'aria-hidden': 'true' }),
      opts.extra || null);
  }

  function revealCard(stage, result, opts) {
    var flip = h('div', { class: 'flip', style: '--flip-ms:' + opts.flipMs + 'ms' },
      h('div', { class: 'flip-inner' },
        h('div', { class: 'flip-face flip-back' }, h('span', { text: '✦' })),
        h('div', { class: 'flip-face' },
          cardEl(result, { topLeft: 'No. ' + result.number, topRight: result.seat + ' 號' }))));
    stage.appendChild(flip);
    if (opts.flipMs <= 0) flip.classList.add('show');
    else requestAnimationFrame(function () { requestAnimationFrame(function () { flip.classList.add('show'); }); });
    return flip;
  }

  /* ---------- 彩帶 ---------- */
  function confetti(canvas, ms) {
    var c = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, hgt = window.innerHeight;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = ['#FFC53D', '#FFE27A', '#FF8A3D', '#B9B2E6', '#FFF4D6'];
    var parts = [];
    for (var i = 0; i < 180; i++) {
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3,
        y: hgt * 0.45,
        vx: (Math.random() - 0.5) * 18,
        vy: -Math.random() * 16 - 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        sz: Math.random() * 8 + 6,
        col: colors[i % colors.length]
      });
    }
    var t0 = performance.now();
    (function frame(t) {
      var el = t - t0;
      c.clearRect(0, 0, w, hgt);
      var fade = el > ms - 600 ? Math.max(0, (ms - el) / 600) : 1;
      c.globalAlpha = fade;
      parts.forEach(function (p) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.col;
        c.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2);
        c.restore();
      });
      if (el < ms) requestAnimationFrame(frame);
      else c.clearRect(0, 0, w, hgt);
    })(t0);
  }

  window.LotteryFx = {
    initStars: initStars,
    createMarquee: createMarquee,
    flyPaper: flyPaper,
    tearPaper: tearPaper,
    revealPrize: revealPrize,
    revealCard: revealCard,
    cardEl: cardEl,
    confetti: confetti
  };
})();
