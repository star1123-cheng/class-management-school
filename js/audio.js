/*
 * 合成音效：全部用 Web Audio API 即時產生，不使用外部音檔。
 * 鼓點（可加速）、心跳、籤紙落地、撕紙、翻卡、號角（實物）、叮（一般卡）
 */
(function () {
  'use strict';

  var ctx = null, master = null, noiseBuf = null;
  var enabled = true, volume = 0.8;
  var rollTimer = null, heartTimer = null;

  function unlock() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
      applyGain();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 1.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function applyGain() {
    if (!master) return;
    master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.03);
  }

  function ok() { return ctx && enabled && ctx.state !== 'closed'; }

  /** 指數包絡：從幾乎 0 → peak → 幾乎 0 */
  function envelope(param, t, attack, peak, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(type, freq, t, attack, peak, decay, freqEnd) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    envelope(g.gain, t, attack, peak, decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
    return o;
  }

  function noise(t, dur, peak, filterType, f1, f2, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.setValueAtTime(f1 || 1000, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    f.Q.value = q || 1;
    var g = ctx.createGain();
    envelope(g.gain, t, Math.min(0.01, dur / 4), peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /* ---------- 單一音效 ---------- */
  function drum() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.005;
    tone('sine', 150, t, 0.003, 0.9, 0.16, 48);
    noise(t, 0.05, 0.25, 'highpass', 3000);
  }

  function heartbeatOnce() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.005;
    tone('sine', 62, t, 0.01, 0.95, 0.14, 40);
    tone('sine', 54, t + 0.17, 0.01, 0.7, 0.12, 36);
  }

  function land() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.005;
    tone('sine', 110, t, 0.005, 0.6, 0.18, 55);
    noise(t, 0.14, 0.35, 'lowpass', 900);
  }

  function tear() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.005;
    // 幾個極短的爆裂聲疊成撕紙的「嘶啦」
    for (var i = 0; i < 6; i++) {
      noise(t + i * 0.035 + Math.random() * 0.015, 0.05 + Math.random() * 0.04, 0.35 + Math.random() * 0.25, 'bandpass', 2600 + Math.random() * 1800, 1300, 0.9);
    }
    noise(t, 0.28, 0.18, 'highpass', 1800);
  }

  function flip() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.005;
    noise(t, 0.32, 0.45, 'bandpass', 500, 3200, 1.4);
  }

  function ding() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.01;
    tone('sine', 1318.5, t, 0.005, 0.5, 1.3);
    tone('sine', 2637, t, 0.005, 0.16, 0.8);
    tone('triangle', 1975.5, t + 0.12, 0.005, 0.22, 1.0);
  }

  function fanfare() {
    if (!ok()) return;
    var t = ctx.currentTime + 0.02;
    var notes = [[523.25, 0], [659.25, 0.14], [783.99, 0.28], [1046.5, 0.44]];
    notes.forEach(function (n) { brass(n[0], t + n[1], 0.18); });
    // 最後的和弦延長
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { brass(f, t + 0.62, 1.2, 0.16); });
  }

  function brass(freq, t, dur, peak) {
    var o = ctx.createOscillator();
    var o2 = ctx.createOscillator();
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    o2.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o2.frequency.setValueAtTime(freq * 1.003, t);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(3200, t + 0.08);
    f.frequency.linearRampToValueAtTime(1800, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak || 0.22, t + 0.04);
    g.gain.setValueAtTime(peak || 0.22, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(master);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  /* ---------- 連續音效 ---------- */
  /** 鼓點由 fromBpm 加速到 toBpm（durationMs 內），之後維持 toBpm 直到 stopRoll() */
  function startRoll(durationMs, fromBpm, toBpm) {
    stopRoll();
    var start = performance.now();
    (function beat() {
      drum();
      var p = Math.min(1, (performance.now() - start) / durationMs);
      var bpm = fromBpm + (toBpm - fromBpm) * p;
      rollTimer = setTimeout(beat, 60000 / bpm);
    })();
  }
  function stopRoll() { clearTimeout(rollTimer); rollTimer = null; }

  /** 心跳由 fromBpm 加速到 toBpm */
  function startHeart(durationMs, fromBpm, toBpm) {
    stopHeart();
    var start = performance.now();
    (function beat() {
      heartbeatOnce();
      var p = Math.min(1, (performance.now() - start) / durationMs);
      var bpm = fromBpm + (toBpm - fromBpm) * p;
      heartTimer = setTimeout(beat, 60000 / bpm);
    })();
  }
  function stopHeart() { clearTimeout(heartTimer); heartTimer = null; }

  function stopAll() { stopRoll(); stopHeart(); }

  window.Sfx = {
    unlock: unlock,
    isUnlocked: function () { return !!ctx; },
    setEnabled: function (v) { enabled = !!v; applyGain(); if (!enabled) stopAll(); },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, v)); applyGain(); },
    drum: drum, land: land, tear: tear, flip: flip, ding: ding, fanfare: fanfare,
    startRoll: startRoll, stopRoll: stopRoll,
    startHeart: startHeart, stopHeart: stopHeart,
    stopAll: stopAll
  };
})();
