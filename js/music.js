/*
 * 背景音樂：YouTube IFrame API、mp3 或不播放（由 config.js 的 MUSIC_SOURCE 決定）
 * 音量 = 階段音量（level，0 至 1）× 主音量（音量滑桿）
 */
(function () {
  'use strict';

  var source = 'none';
  var videoId = '';
  var player = null;      // YouTube 播放器
  var audio = null;       // <audio>
  var ready = false;
  var failed = false;
  var started = false;    // 使用者已點「開啟聲音」
  var enabled = true;     // 「音樂」開關
  var level = 0.3;        // 目前階段音量
  var masterVol = 0.8;
  var tween = null;
  var onFail = null;
  var loadTimer = null, playCheckTimer = null;

  function init(opts) {
    source = opts.source || 'none';
    videoId = opts.videoId || '';
    onFail = opts.onFail || null;
    level = opts.level === undefined ? 0.3 : opts.level;
    if (source === 'youtube') loadYouTube();
    else if (source === 'mp3') loadMp3();
  }

  /* ---------- YouTube ---------- */
  function loadYouTube() {
    if (!videoId || location.protocol === 'file:') { fail(); return; }
    window.onYouTubeIframeAPIReady = function () {
      try {
        player = new window.YT.Player('ytPlayer', {
          width: 200,
          height: 200,
          videoId: videoId,
          playerVars: {
            autoplay: 0, controls: 0, disablekb: 1, fs: 0, loop: 1, playlist: videoId,
            modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin
          },
          events: {
            onReady: function () {
              ready = true;
              clearTimeout(loadTimer);
              apply();
              if (started && enabled) play();
            },
            onError: function () { fail(); },
            onStateChange: function (e) {
              // 循環播放
              if (e.data === window.YT.PlayerState.ENDED) { player.seekTo(0, true); player.playVideo(); }
            }
          }
        });
      } catch (err) { fail(); }
    };
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = fail;
    document.head.appendChild(s);
    loadTimer = setTimeout(function () { if (!ready) fail(); }, 15000);
  }

  /* ---------- mp3 ---------- */
  function loadMp3() {
    audio = new Audio('assets/lottery-bgm.mp3');
    audio.loop = true;
    audio.preload = 'auto';
    audio.addEventListener('error', fail);
    ready = true;
  }

  /* ---------- 控制 ---------- */
  function play() {
    if (failed || !enabled || !ready) return;
    apply();
    if (player) {
      player.playVideo();
      // 若 10 秒內還沒開始播放（例如被封鎖），視為失敗
      clearTimeout(playCheckTimer);
      playCheckTimer = setTimeout(function () {
        try {
          if (enabled && started && player.getPlayerState() !== window.YT.PlayerState.PLAYING) fail();
        } catch (e) { fail(); }
      }, 10000);
    } else if (audio) {
      var p = audio.play();
      if (p && p.catch) p.catch(fail);
    }
  }

  function pause() {
    clearTimeout(playCheckTimer);
    try {
      if (player && ready) player.pauseVideo();
      if (audio) audio.pause();
    } catch (e) { /* 忽略 */ }
  }

  function apply() {
    var v = Math.max(0, Math.min(1, level * masterVol));
    try {
      if (player && ready) player.setVolume(Math.round(v * 100));
      if (audio) audio.volume = v;
    } catch (e) { /* 忽略 */ }
  }

  /** 使用者點「開啟聲音」後呼叫（必須在點擊事件中） */
  function start() {
    started = true;
    if (source === 'none' || failed) return;
    play();
  }

  /** 平滑調整階段音量 */
  function setLevel(target, ms) {
    clearInterval(tween);
    if (!ms) { level = target; apply(); return; }
    var from = level, t0 = performance.now();
    tween = setInterval(function () {
      var p = Math.min(1, (performance.now() - t0) / ms);
      level = from + (target - from) * p;
      apply();
      if (p >= 1) clearInterval(tween);
    }, 50);
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) pause();
    else if (started) play();
  }

  function setMaster(v) { masterVol = Math.max(0, Math.min(1, v)); apply(); }

  function fail() {
    if (failed) return;
    failed = true;
    clearTimeout(loadTimer);
    clearTimeout(playCheckTimer);
    try { if (audio) audio.pause(); } catch (e) { /* 忽略 */ }
    if (onFail) onFail();
  }

  window.Music = {
    init: init,
    start: start,
    setLevel: setLevel,
    setEnabled: setEnabled,
    setMaster: setMaster,
    hasFailed: function () { return failed; },
    source: function () { return source; }
  };
})();
