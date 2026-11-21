/* 새벽의 냄새길 · 완전판 엔진 — core
   상태·저장·오디오(5버스)·캔버스 2.5D 카메라·날씨 입자·렌즈·자막/기록.
   UI 규칙: 카드 나열 금지 — 모든 조작은 장면·실루엣·반원 링·냄새길 위에만 둔다. */
(function () {
'use strict';
const CJ = window.CJ = window.CJ || {};

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => d * Math.PI / 180;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ESC = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

CJ.$ = $; CJ.$$ = $$; CJ.clamp = clamp; CJ.lerp = lerp; CJ.rad = rad;
CJ.sleep = sleep; CJ.esc = ESC;

function hexA(hex, a) {
  const h = String(hex || '#bfe6d8').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}
CJ.hexA = hexA;

/* ─────────────── 상태 ─────────────── */
const SAVE_KEY = 'cj_full_v37';
const S = CJ.S = {
  beat: null, chapter: 0, started: false,
  clues: {},        // sceneId -> [clueId]
  hyps: {},         // questionId -> hypId
  seen: {},         // 연출 1회 플래그
  log: [],
  settings: { sound: true, light: false },
  battle: null,
  unlocked: 1,
  star: 'eyes_shut',
  hypsEffects: {},  // questionId -> effect (다음 대치로 이월)
  stats: { beats: 0, battles: 0, turns: 0, skills: {}, cuts: 0, clues: 0 },
  ended: false
};

let saveTimer = null;
function save() {
  if (S.ended) { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} return; }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 3, at: Date.now(), beat: S.beat, chapter: S.chapter, started: S.started,
      clues: S.clues, hyps: S.hyps, seen: S.seen, log: S.log.slice(-24),
      settings: S.settings, unlocked: S.unlocked, star: S.star,
      hypsEffects: S.hypsEffects, stats: S.stats
    }));
  } catch (e) {}
}
CJ.save = save;
CJ.saveSoon = function () { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; save(); }, 500); };
CJ.loadSave = function () {
  try {
    const o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return o && o.v === 3 ? o : null;
  } catch (e) { return null; }
};
CJ.clearSave = function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} };

/* 장면별 단서 배열 */
CJ.cluesOf = function (scene) { return S.clues[scene] || (S.clues[scene] = []); };
CJ.hasClue = function (scene, id) { return CJ.cluesOf(scene).indexOf(id) >= 0; };
CJ.addClue = function (scene, id) {
  const a = CJ.cluesOf(scene);
  if (a.indexOf(id) < 0) { a.push(id); S.stats.clues++; save(); return true; }
  return false;
};

/* ─────────────── 오디오 ─────────────── */
const AU = CJ.AU = {
  ac: null, master: null, buses: {}, buf: new Map(), pending: new Map(),
  ambSrc: null, ambNode: null, ambName: '', ambEl: null,
  sched: null, schedKind: '', ready: false,
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.92;
    this.master.connect(this.ac.destination);
    const mk = v => { const g = this.ac.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.buses = { vo: mk(1.0), bgm: mk(0.24), amb: mk(0.18), sfx: mk(0.5), sense: mk(0.3) };
    this.ready = true;
  },
  resume() { if (this.ac && this.ac.state !== 'running') this.ac.resume(); },
  suspend() { if (this.ac && this.ac.state === 'running') this.ac.suspend(); },

  load(url) {
    if (!url) return Promise.reject(new Error('no-url'));
    if (this.buf.has(url)) return Promise.resolve(this.buf.get(url));
    if (this.pending.has(url)) return this.pending.get(url);
    const p = fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.arrayBuffer();
    }).then(ab => new Promise((res, rej) => this.ac.decodeAudioData(ab, res, rej)))
      .then(b => { this.buf.set(url, b); this.pending.delete(url); return b; })
      .catch(e => { this.pending.delete(url); CJ.note('audio-miss', url); throw e; });
    this.pending.set(url, p);
    return p;
  },
  preload(urls) {
    if (!this.ac) return Promise.resolve();
    const list = (urls || []).filter(Boolean);
    return Promise.all(list.slice(0, 14).map(u => this.load(u).catch(() => null)));
  },
  play(bus, url, gain, opt) {
    if (!this.ac || !url) return Promise.resolve(null);
    opt = opt || {};
    return this.load(url).then(b => {
      if (!this.ac || this.ac.state !== 'running') return null;
      const src = this.ac.createBufferSource();
      src.buffer = b;
      if (opt.rate) src.playbackRate.value = opt.rate;
      const g = this.ac.createGain();
      g.gain.value = gain == null ? 1 : gain;
      src.connect(g); g.connect(this.buses[bus] || this.master);
      src.start(0, opt.offset || 0);
      if (opt.duck) this.duck(b.duration);
      return src;
    }).catch(() => null);
  },
  duck(dur) {
    const b = this.buses.bgm, a = this.buses.amb;
    if (!b || !a) return;
    const t = this.ac.currentTime;
    b.gain.cancelScheduledValues(t); a.gain.cancelScheduledValues(t);
    b.gain.setTargetAtTime(0.24 * 0.4, t, 0.05);
    a.gain.setTargetAtTime(0.18 * 0.65, t, 0.08);
    b.gain.setTargetAtTime(0.24, t + Math.max(0.8, dur), 0.5);
    a.gain.setTargetAtTime(0.18, t + Math.max(0.8, dur), 0.6);
  },
  amb(url) {
    if (!this.ac || !url || this.ambName === url) return;
    this.stopAmb();
    this.ambName = url;
    this.load(url).then(b => {
      if (!this.ac || this.ambName !== url) return;
      const src = this.ac.createBufferSource();
      src.buffer = b; src.loop = true;
      const g = this.ac.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(this.buses.amb);
      src.start();
      g.gain.setTargetAtTime(1, this.ac.currentTime, 1.4);
      this.ambSrc = src; this.ambNode = g;
    }).catch(() => {});
  },
  stopAmb() {
    if (this.ambSrc) { try { this.ambSrc.stop(); } catch (e) {} this.ambSrc = null; }
    this.ambName = '';
  },
  fadeAmb(v, sec) {
    if (this.ambNode) this.ambNode.gain.setTargetAtTime(v, this.ac.currentTime, sec || 0.6);
  },
  piano(f, when, dur, gain) {
    if (!this.ac) return;
    const t = when || this.ac.currentTime;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.15, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, t + (dur || 2.6));
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2500; lp.Q.value = 0.4;
    g.connect(lp); lp.connect(this.buses.bgm);
    [1, 2.005, 3.01, 4.02].forEach((h, i) => {
      const o = this.ac.createOscillator(); o.type = 'sine';
      o.frequency.value = f * h * (1 + (i % 2 ? 0.0008 : 0));
      const hg = this.ac.createGain(); hg.gain.value = [1, 0.4, 0.19, 0.08][i];
      o.connect(hg); hg.connect(g); o.start(t); o.stop(t + (dur || 2.6) + 0.1);
    });
  },
  pluck(f, when, gain) {
    if (!this.ac) return;
    const t = when || this.ac.currentTime;
    const o = this.ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = this.ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.001;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.09, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    o.connect(g); o2.connect(g); g.connect(lp); lp.connect(this.buses.bgm);
    o.start(t); o.stop(t + 1); o2.start(t); o2.stop(t + 1);
  },
  senseSwell(freq, pan) {
    if (!this.ac) return;
    const t = this.ac.currentTime, d = 1.0;
    const len = Math.floor(this.ac.sampleRate * d);
    const b = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = this.ac.createBufferSource(); src.buffer = b;
    const bp = this.ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.4;
    bp.frequency.setValueAtTime((freq || 500) * 0.6, t);
    bp.frequency.linearRampToValueAtTime((freq || 500) * 1.6, t + d * 0.7);
    const g = this.ac.createGain(); g.gain.value = 0.45;
    const p = this.ac.createStereoPanner ? this.ac.createStereoPanner() : null;
    src.connect(bp); bp.connect(g);
    if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(this.buses.sense); }
    else g.connect(this.buses.sense);
    src.start(t);
  },
  bell(f, g) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    [[f, 1], [f * 1.5, 0.5], [f * 2.02, 0.24]].forEach(([hf, hg]) => {
      const o = this.ac.createOscillator(); o.type = 'sine'; o.frequency.value = hf;
      const gg = this.ac.createGain();
      gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime((g || 0.11) * hg, t + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0004, t + 1.6);
      o.connect(gg); gg.connect(this.buses.sense); o.start(t); o.stop(t + 1.7);
    });
  },
  startBgm(kind) {
    if (!this.ac || !kind) return;
    if (this.sched) { if (this.schedKind === kind) return; this.stopBgm(); }
    let step = 0;
    const seqs = {
      piano_sparse: { every: 1600, notes: [220, 261.63, 329.63, 392, 440, 523.25], low: [110, 130.81] },
      guitar_tense: { every: 470, notes: [146.83, 164.81, 220, 246.94, 293.66], low: [73.42] },
      forest: { every: 1900, notes: [196, 246.94, 293.66, 329.63, 392], low: [98, 110] },
      dawn: { every: 2200, notes: [261.63, 329.63, 392, 523.25], low: [130.81] }
    };
    const cfg = seqs[kind] || seqs.piano_sparse;
    const tick = () => {
      if (!this.ac) return;
      const t = this.ac.currentTime + 0.06;
      if (kind === 'guitar_tense') {
        this.pluck(cfg.notes[step % cfg.notes.length] * (step % 8 < 4 ? 1 : 0.5), t, 0.05);
        if (step % 8 === 0) this.pluck(cfg.low[0], t, 0.065);
      } else if (kind === 'forest' || kind === 'dawn') {
        if (step % 3 === 0) this.piano(cfg.low[step % 2], t, 3.6, 0.06);
        this.piano(cfg.notes[Math.floor(Math.random() * cfg.notes.length)], t, 3.2, 0.04);
      } else {
        if (step % 3 === 0) this.piano(cfg.low[step % 2], t, 3.4, 0.07);
        this.piano(cfg.notes[Math.floor(Math.random() * cfg.notes.length)], t, 3.0, 0.045);
      }
      step++;
    };
    tick();
    this.sched = setInterval(tick, cfg.every);
    this.schedKind = kind;
  },
  stopBgm() { if (this.sched) { clearInterval(this.sched); this.sched = null; this.schedKind = ''; } },
  stopAll() { this.stopBgm(); this.stopAmb(); }
};

/* ─────────────── 캔버스 / 2.5D 카메라 ─────────────── */
const MOTION = {
  pan_lr: p => ({ z: 1.12, x: lerp(-1, 1, p), y: 0 }),
  pan_rl: p => ({ z: 1.12, x: lerp(1, -1, p), y: 0 }),
  tilt_down: p => ({ z: 1.10, x: 0, y: lerp(-1, 0.35, p) }),
  tilt_up: p => ({ z: 1.10, x: 0, y: lerp(0.35, -1, p) }),
  push_in: p => ({ z: lerp(1.0, 1.18, p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2), x: 0, y: 0 }),
  push_fast: p => ({ z: lerp(1.02, 1.26, Math.pow(p, 0.65)), x: 0, y: 0 }),
  pull_out: p => ({ z: lerp(1.2, 1.0, p), x: 0, y: 0 }),
  static: p => ({ z: 1.04, x: 0, y: 0 })
};

const Sc = CJ.Sc = {
  cv: null, ctx: null, W: 390, H: 844, band: 292, dpr: 1, bandMode: 'scene',
  img: null, imgSrc: '', pendingSrc: null,
  ox: 0, oy: 0, iw: 0, ih: 0, base: 1,
  t: 0, dt: 0, motion: 'static', motionT: 0, motionDur: 8,
  ripples: [], motes: [], flakes: [], flash: 0,
  weather: 'night', lens: 'oneeye', knots: [], knotPulse: 0,
  dim: 1, letterbox: 0, glyph: 0,
  init() {
    this.cv = $('#scene');
    this.ctx = this.cv.getContext('2d');
    this.resize();
  },
  resize() {
    const col = $('#column');
    const vw = window.innerWidth, vh = window.innerHeight;
    this.W = Math.max(300, Math.round(col.offsetWidth || vw));
    this.H = Math.max(300, Math.round(col.offsetHeight || vh));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    const landscape = this.W > this.H * 1.15;
    const bs = this.bandMode === 'battle' ? 0.34 : 0.56;
    const bw = this.bandMode === 'battle' ? 0.82 : 1.28;
    this.band = landscape ? this.H : Math.round(Math.min(this.H * bs, this.W * bw));
    const rs = document.documentElement.style;
    rs.setProperty('--sceneH', this.band + 'px');
    rs.setProperty('--subTop', (this.band + 40) + 'px');
    rs.setProperty('--hintTop', (this.band + 10) + 'px');
    rs.setProperty('--panelTop', (this.band + 96) + 'px');
    this.fit();
  },
  setBandMode(m) { if (this.bandMode !== m) { this.bandMode = m; this.resize(); } },
  fit() {
    if (!this.img) return;
    this.base = Math.max(this.W / 1280, this.band / 720);
    this.iw = 1280 * this.base; this.ih = 720 * this.base;
    this.ox = (this.W - this.iw) / 2; this.oy = (this.band - this.ih) / 2;
  },
  setStill(src, cb) {
    if (!src) { if (cb) cb(); return; }
    if (this.imgSrc === src && this.img) { if (cb) cb(); return; }
    this.pendingSrc = src;
    const im = new Image();
    im.onload = () => {
      this.img = im; this.imgSrc = src; this.pendingSrc = null; this.fit();
      if (cb) cb();
    };
    im.onerror = () => { CJ.note('img-miss', src); this.pendingSrc = null; if (cb) cb(); };
    im.src = src;
  },
  setMotion(m, dur) {
    this.motion = MOTION[m] ? m : 'static';
    this.motionT = 0;
    this.motionDur = dur || 9;
  },
  proj(nx, ny) {
    const v = this._view;
    if (!v) return { x: nx * this.W, y: ny * this.band };
    return { x: v.cx + nx * v.iw, y: v.cy + ny * v.ih };
  },
  unproj(x, y) {
    const v = this._view || { cx: this.ox, cy: this.oy, iw: this.iw, ih: this.ih };
    return { nx: (x - v.cx) / v.iw, ny: (y - v.cy) / v.ih };
  },
  ripple(x, y, color) { this.ripples.push({ x, y, t: 0, life: 1.0, r0: 5, r1: 46, color: color || '#bfe6d8' }); },
  start() {
    const loop = ts => {
      const dt = Math.min(0.05, (ts - (this.t || ts)) / 1000);
      this.t = ts; this.dt = dt;
      this.motionT += dt;
      this.knotPulse += dt;
      this.draw(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  cam() {
    const p = clamp(this.motionT / this.motionDur, 0, 1);
    const f = MOTION[this.motion] || MOTION.static;
    return f(p);
  },
  draw(dt) {
    const c = this.ctx, W = this.W, H = this.H, band = this.band;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#04070b'; c.fillRect(0, 0, W, H);
    if (!this.img) { this.drawWeather(c, dt, band); return; }
    const mode = CJ.mode || 'title';
    const full = (mode === 'title' || mode === 'ending' || mode === 'intermission');
    const bh = full ? H : band;
    const cam = this.cam();
    const s = Math.max(W / 1280, bh / 720) * (full ? 1 : 1) * cam.z;
    const iw = 1280 * s, ih = 720 * s;
    const cx = (W - iw) / 2 + cam.x * W * 0.045;
    const cy = (bh - ih) / 2 + cam.y * bh * 0.05;
    this._view = { cx, cy, iw, ih, bh };
    c.save();
    c.beginPath(); c.rect(0, 0, W, bh); c.clip();
    c.drawImage(this.img, cx, cy, iw, ih);
    // 색 보정 그레이드
    c.globalCompositeOperation = 'overlay';
    const gd = c.createLinearGradient(0, 0, W, bh);
    gd.addColorStop(0, 'rgba(28,44,60,.20)');
    gd.addColorStop(1, 'rgba(10,6,4,.26)');
    c.fillStyle = gd; c.fillRect(0, 0, W, bh);
    c.globalCompositeOperation = 'source-over';
    // 필름 그레인
    c.globalAlpha = 0.05;
    for (let i = 0; i < 22; i++) {
      c.fillStyle = i % 2 ? '#ffffff' : '#000000';
      c.fillRect(Math.random() * W, Math.random() * bh, 1.4, 1.4);
    }
    c.globalAlpha = 1;
    // 비네트
    const vg = c.createRadialGradient(W / 2, bh * 0.46, Math.min(W, bh) * 0.22, W / 2, bh * 0.5, Math.max(W, bh) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = vg; c.fillRect(0, 0, W, bh);
    this.drawLens(c, dt, W, bh);
    this.drawKnots(c);
    this.drawWeather(c, dt, bh);
    // 리플
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]; r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { this.ripples.splice(i, 1); continue; }
      c.beginPath(); c.arc(r.x, r.y, r.r0 + k * r.r1, 0, Math.PI * 2);
      c.strokeStyle = hexA(r.color, 1 - k); c.lineWidth = 1 + (1 - k) * 2; c.stroke();
    }
    c.restore();
    if (!full) {
      const g = c.createLinearGradient(0, band * 0.56, 0, band + 40);
      g.addColorStop(0, 'rgba(4,7,11,0)');
      g.addColorStop(1, '#04070b');
      c.fillStyle = g; c.fillRect(0, band * 0.56, W, band * 0.44 + 40);
      this.drawBelow(c, dt);
    }
  },

  /* 장면 창 아래 — 바닥에 잠긴 냄새 입자와 아주 옅은 지평선 */
  drawBelow(c, dt) {
    const W = this.W, H = this.H, tt = this.t / 1000;
    const top = this.band + 40;
    if (!this.motes || this.motes.length !== 18) {
      this.motes = Array.from({ length: 18 }, () => ({
        x: Math.random() * W, y: top + Math.random() * (H - top),
        vx: (Math.random() - .5) * 6, vy: -3 - Math.random() * 7,
        r: .6 + Math.random() * 1.4, a: .03 + Math.random() * .08
      }));
    }
    this.motes.forEach(p => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < top) { p.y = H; p.x = Math.random() * W; }
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      c.fillStyle = 'rgba(191,230,216,' + p.a + ')';
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    });
    const g2 = c.createRadialGradient(W * 0.5, H * 0.72, 10, W * 0.5, H * 0.72, W * 0.9);
    g2.addColorStop(0, 'rgba(90,130,150,.045)');
    g2.addColorStop(1, 'rgba(90,130,150,0)');
    c.fillStyle = g2; c.fillRect(0, top, W, H - top);
  },

  drawLens(c, dt, W, H) {
    const tt = this.t / 1000;
    const lens = this.lens;
    if (lens === 'oneeye') {
      const g = c.createLinearGradient(0, 0, W * 0.54, 0);
      g.addColorStop(0, 'rgba(2,3,6,.90)');
      g.addColorStop(0.52, 'rgba(2,3,6,.36)');
      g.addColorStop(1, 'rgba(2,3,6,0)');
      c.fillStyle = g; c.fillRect(0, 0, W * 0.56, H);
      c.strokeStyle = 'rgba(230,240,245,.055)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(W * 0.33, 0);
      for (let y = 0; y <= H; y += 28) c.lineTo(W * 0.33 + Math.sin(y * 0.04 + tt) * 6, y);
      c.stroke();
    } else if (lens === 'strand') {
      c.save(); c.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const y = H * (0.34 + i * 0.16);
        c.beginPath();
        for (let x = 0; x <= W; x += 10) {
          const yy = y + Math.sin(x * 0.014 + tt * 0.8 + i) * 4;
          x ? c.lineTo(x, yy) : c.moveTo(x, yy);
        }
        c.strokeStyle = 'rgba(191,230,216,' + (0.05 + i * 0.012) + ')';
        c.lineWidth = 1.1; c.stroke();
      }
      c.restore();
    } else if (lens === 'high') {
      const g = c.createLinearGradient(0, 0, 0, H * 0.3);
      g.addColorStop(0, 'rgba(2,4,8,.55)'); g.addColorStop(1, 'rgba(2,4,8,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H * 0.3);
      // 꼬리 표시 — 위험의 언어
      c.save(); c.translate(W * 0.86, H * 0.86);
      c.strokeStyle = 'rgba(201,180,138,.5)'; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath();
      const amp = Math.sin(tt * 2) * 0.5;
      c.moveTo(-26, 10); c.bezierCurveTo(-12, 10, -6, -6 + amp * 8, 4, -2);
      c.bezierCurveTo(14, 2, 20, 10, 26, -4 + amp * 6);
      c.stroke(); c.restore();
    } else if (lens === 'aerial') {
      c.strokeStyle = 'rgba(180,210,225,.06)'; c.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        c.beginPath(); c.moveTo(0, H * i / 7); c.lineTo(W, H * i / 7); c.stroke();
      }
      for (let i = 1; i < 5; i++) {
        c.beginPath(); c.moveTo(W * i / 5, 0); c.lineTo(W * i / 5, H); c.stroke();
      }
      c.fillStyle = 'rgba(10,14,18,.34)';
      for (let i = 0; i < 3; i++) {
        const x = W * (0.2 + i * 0.26), y = H * (0.62 + i * 0.07);
        c.beginPath(); c.ellipse(x, y, 16, 7, 0.3, 0, Math.PI * 2); c.fill();
      }
    } else if (lens === 'text') {
      c.strokeStyle = 'rgba(232,226,200,.05)'; c.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = H * (0.2 + i * 0.12);
        c.beginPath(); c.moveTo(W * 0.12, y); c.lineTo(W * 0.12 + W * 0.5 * (0.6 + (i % 3) * 0.14), y); c.stroke();
      }
    }
  },

  drawKnots(c) {
    if (!this.knots || !this.knots.length) return;
    const tt = this.t / 1000;
    this.knots.forEach((k, i) => {
      const p = this.proj(k.nx, k.ny);
      const got = k.got;
      const a = got ? 0.5 : (k.hidden && !k.revealed ? 0.22 : 0.55);
      if (got) {
        c.beginPath(); c.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
        c.fillStyle = hexA(k.tone, .55); c.fill();
        c.beginPath(); c.arc(p.x, p.y, 8, 0, Math.PI * 2);
        c.strokeStyle = hexA(k.tone, .3); c.lineWidth = 1; c.stroke();
        return;
      }
      const pulse = 0.7 + 0.3 * Math.sin(tt * 2.2 + i * 1.7);
      c.beginPath(); c.arc(p.x, p.y, 10 + pulse * 3, 0, Math.PI * 2);
      c.strokeStyle = hexA(k.tone, a * .8); c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      c.fillStyle = hexA(k.tone, a); c.fill();
      if (k.hidden && !k.revealed) {
        c.beginPath(); c.arc(p.x, p.y, 15, 0.4, 2.4);
        c.strokeStyle = hexA(k.tone, .35); c.lineWidth = 1; c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
      }
    });
  },

  drawWeather(c, dt, H) {
    const w = this.weather, W = this.W, tt = performance.now() / 1000;
    if (w === 'rain' || w === 'storm') {
      const n = w === 'storm' ? 70 : 40;
      if (!this.flakes || this.flakes.length !== n) {
        this.flakes = Array.from({ length: n }, () => ({
          x: Math.random() * W, y: Math.random() * H,
          l: 8 + Math.random() * 18, s: (w === 'storm' ? 260 : 150) + Math.random() * 160,
          a: 0.05 + Math.random() * 0.1
        }));
      }
      c.strokeStyle = 'rgba(200,225,240,.11)'; c.lineWidth = 1;
      this.flakes.forEach(r => {
        r.y += r.s * dt; r.x -= r.s * 0.16 * dt;
        if (r.y > H) { r.y = -14; r.x = Math.random() * W; }
        if (r.x < 0) r.x = W;
        c.beginPath(); c.moveTo(r.x, r.y); c.lineTo(r.x + 1.6, r.y + r.l); c.stroke();
      });
      if (w === 'storm') {
        this.flash = Math.max(0, this.flash - dt * 2.6);
        if (Math.random() < 0.0016) this.flash = 0.5;
        if (this.flash > 0.01) { c.fillStyle = 'rgba(190,210,235,' + (this.flash * 0.35) + ')'; c.fillRect(0, 0, W, H); }
      }
    } else if (w === 'fog') {
      if (!this.flakes || this.flakes.length !== 7) {
        this.flakes = Array.from({ length: 7 }, (_, i) => ({ x: Math.random() * W, y: H * (0.3 + i * 0.1), r: 90 + Math.random() * 120, s: 6 + Math.random() * 12 }));
      }
      c.globalCompositeOperation = 'lighter';
      this.flakes.forEach(f => {
        f.x += f.s * dt; if (f.x > W + f.r) f.x = -f.r;
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, 'rgba(190,205,215,.045)');
        g.addColorStop(1, 'rgba(190,205,215,0)');
        c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
      });
      c.globalCompositeOperation = 'source-over';
    } else if (w === 'dust') {
      if (!this.flakes || this.flakes.length !== 26) {
        this.flakes = Array.from({ length: 26 }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * 14, vy: -6 - Math.random() * 12, r: .8 + Math.random() * 1.8, a: .06 + Math.random() * .18 }));
      }
      this.flakes.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
        if (p.x < -6) p.x = W + 6; if (p.x > W + 6) p.x = -6;
        c.fillStyle = 'rgba(226,214,190,' + p.a + ')';
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      });
    } else if (w === 'dawn') {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(240,190,140,.05)');
      g.addColorStop(0.6, 'rgba(240,190,140,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const x = W * (0.2 + i * 0.3) + Math.sin(tt * 0.2 + i) * 14;
        const gg = c.createLinearGradient(x, 0, x + 40, H * 0.7);
        gg.addColorStop(0, 'rgba(255,225,180,.035)');
        gg.addColorStop(1, 'rgba(255,225,180,0)');
        c.fillStyle = gg; c.beginPath();
        c.moveTo(x, 0); c.lineTo(x + 46, 0); c.lineTo(x + 120, H * 0.7); c.lineTo(x + 40, H * 0.7);
        c.closePath(); c.fill();
      }
      c.restore();
    } else if (w === 'overcast') {
      c.fillStyle = 'rgba(150,160,168,.06)'; c.fillRect(0, 0, W, H);
    }
  }
};

/* ─────────────── 자막 · 기록 · 토스트 ─────────────── */
const SPNAME = {
  narrator: '내레이션', nuri: '누리', kkamang: '까망', captain: '캡틴', otbit: '잿빛',
  somi: '소미', kim: '김반장', park: '박여사', deer: '들무리 리더',
  nuri_owner: '누리의 주인', shop: '생선가게 주인', driver: '운전자',
  poacher: '포획업자', poacher2: '포획꾼', star: '별', etc: ''
};
CJ.SPNAME = SPNAME;
function spClass(sp) {
  if (sp === 'kkamang') return 'kkamang';
  if (sp === 'nuri') return 'nuri';
  if (sp === 'captain' || sp === 'narrator') return 'cap';
  if (sp === 'otbit') return 'otbit';
  if (sp === 'somi') return 'somi';
  if (sp === 'kim' || sp === 'park') return 'human';
  return '';
}
CJ.spClass = spClass;

let subTimer = null, CURSAY = null;
function subtitle(text, sp, opts) {
  opts = opts || {};
  const el = $('#subtitle');
  $('.sp', el).textContent = opts.spText != null ? opts.spText : (SPNAME[sp] || '');
  $('.sp', el).className = 'sp ' + spClass(sp);
  $('.tx', el).textContent = text;
  el.classList.add('on');
  el.classList.toggle('late', !!opts.late);
  if (opts.hideAfter) { clearTimeout(subTimer); subTimer = setTimeout(() => el.classList.remove('on'), opts.hideAfter); }
  requestAnimationFrame(() => CJ.layoutStack());
}
CJ.subtitle = subtitle;
CJ.hideSubtitle = function () { $('#subtitle').classList.remove('on'); requestAnimationFrame(() => CJ.layoutStack()); };

/* 자막 높이에 맞춰 아래 패널을 내린다 — 긴 대사가 패널과 겹치지 않게 */
CJ.layoutStack = function () {
  const sub = $('#subtitle'), panel = $('#panel');
  if (!panel) return;
  let top = Sc.band + 96;
  if (sub && sub.classList.contains('on')) {
    const r = sub.getBoundingClientRect();
    top = Math.max(top, Math.round(r.bottom) + 16);
  }
  const maxTop = Math.max(Sc.band + 96, Sc.H - 330);
  top = Math.min(top, maxTop);
  document.documentElement.style.setProperty('--panelTop', top + 'px');
};
CJ.hud = function (on) {
  const h = $('#hudTop');
  if (h) h.style.display = on ? '' : 'none';
};

CJ.log = function (rec) {
  S.log.push(rec);
  if (S.log.length > 90) S.log.shift();
  CJ.renderLog();
  CJ.saveSoon();
};
CJ.renderLog = function () {
  const box = $('#logList'); if (!box) return;
  box.innerHTML = '';
  S.log.slice().reverse().forEach(l => {
    const row = document.createElement('div');
    row.className = 'logRow' + (l.late ? ' late' : '');
    row.innerHTML = '<span class="sp"></span><span class="tx"></span><button class="play"></button>';
    $('.sp', row).textContent = SPNAME[l.sp] || l.sp || '';
    $('.tx', row).textContent = l.text || '';
    const btn = $('.play', row);
    btn.textContent = l.file ? (l.late ? '다시' : '재생') : '—';
    if (!l.file) btn.disabled = true;
    btn.onclick = () => { if (l.file) AU.play('vo', l.file, 1, { duck: true }); };
    box.appendChild(row);
  });
};
CJ.openLog = function () { $('#logSheet').classList.add('on'); CJ.renderLog(); };
CJ.closeLog = function () { $('#logSheet').classList.remove('on'); };

/* 대사 한 줄: 자막 먼저, 300ms 안에 디코딩되면 재생, 늦으면 자막만 */
CJ.say = function (line, opt) {
  opt = opt || {};
  return new Promise(resolve => {
    if (!line) return resolve({ played: false });
    subtitle(line.text, line.speaker, { late: false });
    const rec = { sp: line.speaker, text: line.text, file: line.file, wid: line.wid, late: false };
    CURSAY = rec;
    CJ.log({ sp: line.speaker, text: line.text, file: line.file, wid: line.wid, late: false });
    let settled = false;
    const finish = (played, late) => {
      if (settled) return; settled = true;
      rec.late = !!late; rec.played = played;
      if (late && CURSAY === rec) { const el = $('#subtitle'); if (el) el.classList.add('late'); }
      CJ.renderLog();
      const wait = (CJ.fast || opt.wait === false) ? 0 : Math.max(opt.min || 0, (line.dur || 2.2) * 1000);
      if (wait <= 0) resolve({ played, late });
      else setTimeout(() => resolve({ played, late }), wait);
    };
    if (!AU.ac || !line.file) return finish(false, true);
    const t0 = performance.now();
    const guard = setTimeout(() => { if (!settled && !rec.ready) finish(false, true); }, 300);
    AU.load(line.file).then(() => {
      rec.ready = true;
      const dt = performance.now() - t0;
      clearTimeout(guard);
      if (dt <= 300 && AU.ac.state === 'running') {
        AU.play('vo', line.file, 1, { duck: true });
        CJ.note('vo', line.wid);
        finish(true, false);
      } else finish(false, true);   // 늦게 도착 — 자동재생 금지
    }).catch(() => { clearTimeout(guard); finish(false, true); });
  });
};

/* 안내 · 로딩 · 노트 */
let hintT = null;
CJ.hint = function (text, ms) {
  const el = $('#sceneHint'); if (!el) return;
  el.textContent = text || '';
  el.classList.remove('hide');
  clearTimeout(hintT);
  hintT = setTimeout(() => el.classList.add('hide'), ms || 5200);
};
CJ.toast = function (text, ms) { CJ.hint(text, ms || 2600); };
CJ.loader = function (on, text) {
  const el = $('#loader'); if (!el) return;
  el.classList.toggle('on', !!on);
  if (text) $('#loaderText').textContent = text;
};
CJ.note = function (kind, detail) {
  const n = (window.__cjNotes = window.__cjNotes || []);
  if (n.length < 2000) n.push([kind, String(detail)]);
  const c = (window.__cjKinds = window.__cjKinds || {});
  c[kind] = (c[kind] || 0) + 1;
};

/* 화면 조각 */
CJ.panel = function (title, sub) {
  const t = $('#panelTitle');
  t.innerHTML = '<b></b>' + (sub ? ' <span class="dim">· ' + ESC(sub) + '</span>' : '');
  $('b', t).textContent = title;
};
CJ.panelShow = function (on) { $('#panel').style.display = on ? '' : 'none'; };
CJ.rings = function () { return $('#ringLayer'); };
CJ.clearRings = function () { const r = $('#ringLayer'); if (r) r.innerHTML = ''; };
CJ.clearPanelBody = function () { $('#panelBody').innerHTML = ''; };

/* 반원 링 배치 — 엄지 반경. 최대 4개. */
CJ.ringButtons = function (list, opt) {
  opt = opt || {};
  const layer = $('#ringLayer');
  layer.innerHTML = '';
  const W = Sc.W, H = Sc.H;
  const cx = W / 2, cy = H - (opt.lift == null ? 56 : opt.lift);
  const Rx = Math.min(W * 0.42, opt.Rx || 150), Ry = opt.Ry || 58;
  const n = list.length;
  const a0 = 198, a1 = 342;
  list.forEach((c, i) => {
    const a = rad(n === 1 ? 270 : a0 + (a1 - a0) * i / (n - 1));
    const x = cx + Math.cos(a) * Rx, y = cy + Math.sin(a) * Ry;
    const b = document.createElement('button');
    b.className = 'ringBtn' + (c.cls ? ' ' + c.cls : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.dataset.id = c.id || '';
    b.innerHTML = (c.label || '').replace(/\n/g, '<br>') + (c.sub ? '<small>' + ESC(c.sub) + '</small>' : '');
    if (c.disabled) b.disabled = true;
    b.onclick = ev => { ev.stopPropagation(); c.onTap && c.onTap(c); };
    layer.appendChild(b);
  });
  return layer;
};

/* 배경 선반입 */
CJ.prefetchStills = function (paths) {
  (paths || []).filter(Boolean).slice(0, 6).forEach(p => { const i = new Image(); i.src = p; });
};
})();
