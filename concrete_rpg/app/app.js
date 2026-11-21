/* 새벽의 냄새길 · 슬라이스 A
   v3.6 마스터본(105분)에서 절출한 스틸·결과컷·13역 음성·효과음을 그대로 연결한 웹앱.
   설계: 클로드 교차 검증안(원칙 1~5, Z 플립6 배치, 300ms 대사 마감, 비트 이어보기). */
(function () {
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => d * Math.PI / 180;

/* ───────────────────────── 상태 ───────────────────────── */
const SAVE_KEY = 'cj_sliceA_v36';
const S = {
  beat: 'B00-01',
  clues: [], tied: [], hyp: null, conf: 0,
  scent: { grip: 0, integrity: 1, held: false, torn: false, attempts: 0 },
  n02: { pressure: 2, jeong: 0, hold: 3, turn: 0, done: false, choices: [] },
  log: [],
  settings: { sound: true },
  started: false,
  seen: {}
};

let CUE = null;                 // data/cuesheet/slice_a.json
const LINES = {};               // wid -> line (절대 t, 파일)
const CLUES = {};               // clue id -> {label, kind, tone}
const BEATS = {};               // beat_id -> beat

/* ───────────────────────── 오디오 ───────────────────────── */
const AU = {
  ac: null, master: null, buses: {},
  buf: new Map(), pending: new Map(),
  ambSrc: null, ambNode: null, ambName: '',
  synth: null, sched: null,
  ready: false,
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ac = new AC();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ac.destination);
    const mk = v => { const g = this.ac.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.buses = { vo: mk(1.0), bgm: mk(0.26), amb: mk(0.2), sfx: mk(0.5), sense: mk(0.3) };
    this.ready = true;
  },
  resume() { if (this.ac && this.ac.state !== 'running') this.ac.resume(); },
  suspend() { if (this.ac && this.ac.state === 'running') this.ac.suspend(); },
  load(url) {
    if (this.buf.has(url)) return Promise.resolve(this.buf.get(url));
    if (this.pending.has(url)) return this.pending.get(url);
    const p = fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.arrayBuffer();
    }).then(ab => new Promise((res, rej) => this.ac.decodeAudioData(ab, res, rej)))
      .then(b => { this.buf.set(url, b); this.pending.delete(url); return b; });
    this.pending.set(url, p);
    return p;
  },
  play(bus, url, gain, opt) {
    if (!this.ac) return null;
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
    }).catch(e => { note('audio-miss', url); return null; });
  },
  duck(dur) {
    const b = this.buses.bgm, a = this.buses.amb;
    if (!b || !a) return;
    const t = this.ac.currentTime;
    b.gain.cancelScheduledValues(t); a.gain.cancelScheduledValues(t);
    b.gain.setTargetAtTime(0.26 * 0.42, t, 0.05);
    a.gain.setTargetAtTime(0.2 * 0.7, t, 0.08);
    b.gain.setTargetAtTime(0.26, t + Math.max(0.8, dur), 0.5);
    a.gain.setTargetAtTime(0.2, t + Math.max(0.8, dur), 0.6);
  },
  amb(url) {
    if (!this.ac || this.ambName === url) return;
    this.stopAmb();
    this.ambName = url;
    this.load(url).then(b => {
      if (!this.ac || this.ambName !== url) return;
      const src = this.ac.createBufferSource();
      src.buffer = b; src.loop = true;
      const g = this.ac.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(this.buses.amb);
      src.start();
      g.gain.setTargetAtTime(1, this.ac.currentTime, 1.2);
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
  /* 자작 합성 — 피아노 단음/기타 리듬/냄새 음 */
  piano(f, when, dur, gain) {
    if (!this.ac) return;
    const t = when || this.ac.currentTime;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, t + (dur || 2.6));
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.4;
    g.connect(lp); lp.connect(this.buses.bgm);
    [1, 2.005, 3.01, 4.02].forEach((h, i) => {
      const o = this.ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * h * (1 + (i % 2 ? 0.0008 : 0));
      const hg = this.ac.createGain(); hg.gain.value = [1, 0.42, 0.2, 0.09][i];
      o.connect(hg); hg.connect(g);
      o.start(t); o.stop(t + (dur || 2.6) + 0.1);
    });
  },
  pluck(f, when, gain) {
    if (!this.ac) return;
    const t = when || this.ac.currentTime;
    const o = this.ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = this.ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.001;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.1, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.7);
    o.connect(g); o2.connect(g); g.connect(lp); lp.connect(this.buses.bgm);
    o.start(t); o.stop(t + 1); o2.start(t); o2.stop(t + 1);
  },
  senseSwell(freq, pan) {
    if (!this.ac) return;
    const t = this.ac.currentTime, d = 1.1;
    const len = Math.floor(this.ac.sampleRate * d);
    const b = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = this.ac.createBufferSource(); src.buffer = b;
    const bp = this.ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(freq * 0.6, t);
    bp.frequency.linearRampToValueAtTime(freq * 1.6, t + d * 0.7);
    const g = this.ac.createGain(); g.gain.value = 0.5;
    const p = this.ac.createStereoPanner(); p.pan.value = pan || 0;
    src.connect(bp); bp.connect(g); g.connect(p); p.connect(this.buses.sense);
    src.start(t);
  },
  bell(f, g) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    [[f, 1], [f * 1.5, 0.5], [f * 2.02, 0.25]].forEach(([hf, hg]) => {
      const o = this.ac.createOscillator(); o.type = 'sine'; o.frequency.value = hf;
      const gg = this.ac.createGain();
      gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime((g || 0.12) * hg, t + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0004, t + 1.6);
      o.connect(gg); gg.connect(this.buses.sense); o.start(t); o.stop(t + 1.7);
    });
  },
  startBgm(kind) {
    if (!this.ac) return;
    if (this.sched) {
      if (this.schedKind === kind) return;
      this.stopBgm();
    }
    const bus = this.buses.bgm;
    let step = 0;
    const seqs = {
      piano_sparse: { every: 1500, notes: [220, 261.63, 329.63, 392, 440, 523.25], low: [110, 130.81] },
      guitar_tense: { every: 460, notes: [146.83, 164.81, 220, 246.94, 293.66], low: [73.42] }
    };
    const cfg = seqs[kind] || seqs.piano_sparse;
    const tick = () => {
      if (!this.ac) return;
      const t = this.ac.currentTime + 0.06;
      if (kind === 'guitar_tense') {
        this.pluck(cfg.notes[step % cfg.notes.length] * (step % 8 < 4 ? 1 : 0.5), t, 0.055);
        if (step % 8 === 0) this.pluck(cfg.low[0], t, 0.07);
      } else {
        if (step % 3 === 0) this.piano(cfg.low[step % 2], t, 3.4, 0.075);
        this.piano(cfg.notes[Math.floor(Math.random() * cfg.notes.length)], t, 3.0, 0.05);
      }
      step++;
    };
    tick();
    this.sched = setInterval(tick, cfg.every);
    this.schedKind = kind;
  },
  stopBgm() {
    if (this.sched) { clearInterval(this.sched); this.sched = null; }
  }
};

/* ───────────────────────── 화면/캔버스 ───────────────────────── */
const Sc = {
  cv: null, ctx: null, W: 390, H: 844, dpr: 1, band: 292,
  img: null, imgSrc: '', next: null,
  t: 0, layers: [], ripples: [], motes: [], cam: 0,
  init() {
    this.cv = $('#scene');
    this.ctx = this.cv.getContext('2d');
    this.resize();
  },
  resize() {
    const col = $('#column');
    const vw = window.innerWidth, vh = window.innerHeight;
    const landscape = vw > vh;
    document.documentElement.style.setProperty('--fit', String(Math.min(vw / 390, vh / 844, 1)));
    this.W = Math.max(320, Math.round(col.offsetWidth || vw));
    this.H = Math.max(320, Math.round(col.offsetHeight || vh));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.band = Math.round(Math.min(this.H * 0.46, this.W * 0.75));
    const rs = document.documentElement.style;
    rs.setProperty('--sceneH', this.band + 'px');
    rs.setProperty('--subTop', (this.band + 46) + 'px');
    rs.setProperty('--hintTop', (this.band + 14) + 'px');
    rs.setProperty('--gaugeTop', '96px');
    this.fit();
  },
  fit() {
    // 이미지 → 밴드 cover 배율
    if (!this.img) return;
    const s = Math.max(this.W / 1280, this.band / 720);
    this.sc = s;
    this.iw = 1280 * s; this.ih = 720 * s;
    this.ox = (this.W - this.iw) / 2;
    this.oy = (this.band - this.ih) / 2;
  },
  setImage(src, cb) {
    if (!src || this.imgSrc === src) { if (cb) cb(); return; }
    const im = new Image();
    im.onload = () => {
      this.img = im; this.imgSrc = src; this.fit();
      if (cb) cb();
    };
    im.onerror = () => { note('img-miss', src); if (cb) cb(); };
    im.src = src;
  },
  proj(nx, ny) {
    return { x: this.ox + nx * this.iw, y: this.oy + ny * this.ih };
  },
  unproj(x, y) {
    return { nx: (x - this.ox) / this.iw, ny: (y - this.oy) / this.ih };
  },
  frame(ts) {
    const dt = Math.min(0.05, (ts - (this.t || ts)) / 1000);
    this.t = ts;
    this.draw(dt);
    requestAnimationFrame(t => this.frame(t));
  },
  draw(dt) {
    const c = this.ctx, W = this.W, H = this.H;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#04070b'; c.fillRect(0, 0, W, H);
    if (this.img && (MODE === 'title' || MODE === 'ending')) {
      const s2 = Math.max(W / 1280, H / 720);
      c.drawImage(this.img, (W - 1280 * s2) / 2, (H - 720 * s2) / 2, 1280 * s2, 720 * s2);
      const g2 = c.createLinearGradient(0, H * 0.3, 0, H);
      g2.addColorStop(0, 'rgba(4,7,11,.35)'); g2.addColorStop(1, 'rgba(4,7,11,.96)');
      c.fillStyle = g2; c.fillRect(0, 0, W, H);
    } else if (this.img) {
      // 장면 밴드
      c.save();
      c.beginPath(); c.rect(0, 0, W, this.band); c.clip();
      c.drawImage(this.img, this.ox, this.oy, this.iw, this.ih);
      c.restore();
      // 밴드 아래로 스며드는 잔상
      const g = c.createLinearGradient(0, this.band * 0.55, 0, this.band + 42);
      g.addColorStop(0, 'rgba(4,7,11,0)');
      g.addColorStop(1, '#04070b');
      c.fillStyle = g; c.fillRect(0, this.band * 0.55, W, this.band * 0.45 + 42);
    }
    if (MODE === 'explore00') this.drawSmell(c, dt);
    if (MODE === 'explore01') this.drawStrand(c, dt);
    if (MODE === 'confront') this.drawRain(c, dt);
    // 리플/입자
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]; r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { this.ripples.splice(i, 1); continue; }
      c.beginPath();
      c.arc(r.x, r.y, r.r0 + k * r.r1, 0, Math.PI * 2);
      c.strokeStyle = r.color + Math.round((1 - k) * 200).toString(16).padStart(2, '0');
      c.lineWidth = 1 + (1 - k) * 2;
      c.stroke();
    }
  },
  ripple(x, y, color) { this.ripples.push({ x, y, t: 0, life: 1.1, r0: 6, r1: 54, color: color || '#bfe6d8' }); },

  /* [00] 캡틴 — 냄새 층 */
  drawSmell(c, dt) {
    const W = this.W, band = this.band;
    // 한쪽 눈: 왼쪽 시야 어둠
    const g = c.createLinearGradient(0, 0, W * 0.52, 0);
    g.addColorStop(0, 'rgba(2,3,6,.86)');
    g.addColorStop(0.55, 'rgba(2,3,6,.34)');
    g.addColorStop(1, 'rgba(2,3,6,0)');
    c.fillStyle = g; c.fillRect(0, 0, W * 0.55, band);
    c.strokeStyle = 'rgba(230,240,245,.05)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(W * 0.33, 0); c.lineTo(W * 0.31, band); c.stroke();

    const sep = sniff * 1;
    const tt = performance.now() / 1000;
    SMELL.forEach((L, i) => {
      const base = this.proj(0, L.ny);
      const y = base.y + (L.off || 0) * sep * 16;
      const found = S.clues.indexOf(L.id) >= 0;
      const alpha = found ? 0.16 : (L.hidden && sep < 0.4 ? 0 : 0.1 + sep * 0.14);
      if (alpha <= 0.005) return;
      c.save();
      c.beginPath();
      const amp = (L.amp || 5) * (0.5 + sep * 0.6);
      c.moveTo(0, y + Math.sin(tt * 0.9 + i) * amp);
      for (let x = 0; x <= W; x += 8) {
        c.lineTo(x, y + Math.sin(x * 0.017 + tt * 1.1 + i * 1.7) * amp + Math.sin(x * 0.006 - tt * 0.6) * amp * 0.7);
      }
      c.strokeStyle = hexA(L.color, alpha);
      c.lineWidth = L.thin ? 1.2 : 12 + sep * 6;
      c.lineCap = 'round';
      c.stroke();
      if (L.thin) {
        c.strokeStyle = hexA(L.color, 0.24 + sep * 0.4);
        c.lineWidth = 0.8; c.stroke();
      }
      c.restore();
    });
    // 매듭
    SMELL.forEach(L => {
      const got = S.clues.indexOf(L.id) >= 0;
      if (got) {
        const p0 = this.proj(L.nx, L.ny);
        c.beginPath(); c.arc(p0.x, p0.y, 4.2, 0, Math.PI * 2);
        c.fillStyle = hexA(L.color, 0.5); c.fill();
        c.beginPath(); c.arc(p0.x, p0.y, 8, 0, Math.PI * 2);
        c.strokeStyle = hexA(L.color, 0.28); c.lineWidth = 1; c.stroke();
        return;
      }
      if (L.hidden && sep < 0.45) return;
      const p = this.proj(L.nx, L.ny);
      const y = p.y + (L.off || 0) * sep * 16;
      const a = L.hidden ? sep : 0.35 + sep * 0.65;
      const pulse = 0.7 + 0.3 * Math.sin(tt * 2.2 + L.nx * 9);
      c.beginPath(); c.arc(p.x, y, 11 + pulse * 2, 0, Math.PI * 2);
      c.strokeStyle = hexA(L.color, a * 0.75); c.lineWidth = 1.4; c.stroke();
      c.beginPath(); c.arc(p.x, y, 3.4, 0, Math.PI * 2);
      c.fillStyle = hexA(L.color, a); c.fill();
      if (sep > 0.6) {
        c.font = '9px -apple-system,"Noto Sans KR",sans-serif';
        c.fillStyle = hexA(L.color, 0.85); c.textAlign = 'center';
        c.fillText(L.label, clamp(p.x, 34, W - 34), y - 18);
      }
    });
    // 관찰 표식 (눈)
    OBSS.forEach(O => {
      if (S.clues.indexOf(O.id) >= 0) return;
      const p = this.proj(O.nx, O.ny);
      const a = 0.42 + 0.22 * Math.sin(tt * 1.6 + O.nx * 7);
      c.beginPath(); c.ellipse(p.x, p.y, 9, 5.5, 0, 0, Math.PI * 2);
      c.strokeStyle = hexA('#dfe9ef', a); c.lineWidth = 1; c.stroke();
      c.beginPath(); c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      c.fillStyle = hexA('#dfe9ef', a + 0.15); c.fill();
    });

  },

  /* [01] 누리 — 붙잡는 코 */
  drawStrand(c, dt) {
    const st = S.scent;
    const integ = st.integrity;
    const tt = performance.now() / 1000;
    const pts = PATH.map(p => this.proj(p[0], p[1]));
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 그림자 실
    c.beginPath();
    pts.forEach((p, i) => {
      const w = Math.sin(tt * 1.4 + i * 0.9) * (6 - 4 * integ);
      i ? c.lineTo(p.x, p.y + w) : c.moveTo(p.x, p.y + w);
    });
    c.strokeStyle = 'rgba(232,240,244,' + (0.08 + integ * 0.1) + ')';
    c.lineWidth = 10 + 6 * integ; c.stroke();
    // 본 실 — 얇아지면 끊긴 결
    const seg = Math.max(1, Math.ceil(pts.length * (st.grip || 0.05)));
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const y = p.y + Math.sin(tt * 1.2 + i * 1.3) * (5 - 3 * integ);
      if (i === 0) c.moveTo(p.x, y);
      else {
        const broken = integ < 0.35 && i > seg && (i % 3 === 0);
        if (broken) c.moveTo(p.x, y); else c.lineTo(p.x, y);
      }
    }
    c.strokeStyle = 'rgba(226,238,244,' + (0.24 + integ * 0.6) + ')';
    c.lineWidth = 0.9 + integ * 3.4; c.stroke();
    // 붙잡은 구간
    if (st.grip > 0) {
      c.beginPath();
      const n = Math.max(1, Math.floor(pts.length * st.grip));
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const y = p.y + Math.sin(tt * 1.2 + i * 1.3) * (5 - 3 * integ);
        i ? c.lineTo(p.x, y) : c.moveTo(p.x, y);
      }
      c.strokeStyle = 'rgba(191,230,216,' + (0.5 + 0.4 * integ) + ')';
      c.lineWidth = 2 + integ * 3; c.stroke();
    }
    // 손가락
    if (finger) {
      c.beginPath(); c.arc(finger.x, finger.y, 16, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(191,230,216,.35)'; c.lineWidth = 1; c.stroke();
    }
    c.restore();
  },

  /* [N02] 비 */
  drawRain(c, dt) {
    const W = this.W, band = this.band;
    if (!this.rain || this.rain.length !== 40) {
      this.rain = Array.from({ length: 40 }, () => ({
        x: Math.random() * W, y: Math.random() * band,
        l: 8 + Math.random() * 16, s: 90 + Math.random() * 160, a: 0.05 + Math.random() * 0.1
      }));
    }
    c.strokeStyle = 'rgba(200,225,240,.10)'; c.lineWidth = 1;
    this.rain.forEach(r => {
      r.y += r.s * dt; r.x -= r.s * 0.14 * dt;
      if (r.y > band) { r.y = -12; r.x = Math.random() * W; }
      if (r.x < 0) r.x = W;
      c.beginPath(); c.moveTo(r.x, r.y); c.lineTo(r.x + 1.4, r.y + r.l); c.stroke();
    });
  }
};

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

/* [00] 냄새 층 — 대본에 나온 네 가지 + 눈으로 본 두 가지 */
const SMELL = [
  { id: 'SM_SOUR', label: '시큼한 국물', nx: 0.22, ny: 0.70, color: '#b08a45', off: -1.0, amp: 7 },
  { id: 'SM_OIL', label: '기름때', nx: 0.15, ny: 0.58, color: '#8a6a3c', off: -0.5, amp: 5 },
  { id: 'SM_WET', label: '젖은 콘크리트', nx: 0.72, ny: 0.82, color: '#6d879c', off: 0.8, amp: 6 },
  { id: 'SM_SOAP', label: '비누', nx: 0.45, ny: 0.90, color: '#bfe6d8', off: 1.6, amp: 3, thin: true, hidden: true }
];
const OBSS = [
  { id: 'OB_TAIL', label: '리듬 있는 꼬리', nx: 0.585, ny: 0.795 },
  { id: 'OB_POSTURE', label: '기다리는 자세', nx: 0.50, ny: 0.70 }
];
/* [01] 주인 냄새 결 — c01_1 아스팔트 위 흰 자국을 따라간다 */
const PATH = [[0.14, 0.96], [0.22, 0.92], [0.31, 0.88], [0.40, 0.845], [0.49, 0.815],
              [0.58, 0.80], [0.67, 0.785], [0.76, 0.765], [0.85, 0.745]];

/* ───────────────────────── 장면 상태 ───────────────────────── */
let MODE = 'title';
let TOKEN = 0;
const alive = t => t === TOKEN;
let sniff = 0, sniffOn = false, sniffTimer = null;
let finger = null, drag = null;
let cut = { el: null, on: false, meta: null };
let paused = false;
let logPinned = false;

/* ───────────────────────── 저장/복원 ───────────────────────── */
function save() {
  if (S.beat === 'END') { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} return; }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, at: Date.now(), beat: S.beat, clues: S.clues, tied: S.tied, hyp: S.hyp, conf: S.conf,
      scent: S.scent, n02: S.n02, log: S.log.slice(-20), settings: S.settings, seen: S.seen, started: S.started
    }));
  } catch (e) {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.v === 1 ? o : null;
  } catch (e) { return null; }
}
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 500);
}

/* ───────────────────────── 자막 · 대사 기록 ───────────────────────── */
const SPNAME = {
  narrator: '내레이션', nuri: '누리', kkamang: '까망', captain: '캡틴',
  nuri_owner: '누리의 주인', somi: '소미', kim: '김반장', etc: ''
};
function spClass(sp) {
  if (sp === 'kkamang') return 'kkamang';
  if (sp === 'nuri') return 'nuri';
  if (sp === 'narrator' || sp === 'captain') return 'cap';
  return '';
}
let subTimer = null;
let CURSAY = null;
function subtitle(text, sp, opts) {
  opts = opts || {};
  const el = $('#subtitle');
  $('.sp', el).textContent = opts.spText != null ? opts.spText : (SPNAME[sp] || '');
  $('.sp', el).className = 'sp ' + spClass(sp);
  $('.tx', el).textContent = text;
  el.classList.add('on');
  el.classList.toggle('late', !!opts.late);
  if (opts.hideAfter) {
    clearTimeout(subTimer);
    subTimer = setTimeout(() => el.classList.remove('on'), opts.hideAfter);
  }
}
function hideSubtitle() { $('#subtitle').classList.remove('on'); }
function addLog(line, late) {
  S.log.push({ sp: line.speaker, text: line.text, file: line.file, late: !!late, wid: line.wid });
  if (S.log.length > 80) S.log.shift();
  renderLog();
  saveSoon();
}
function renderLog() {
  const box = $('#logList');
  box.innerHTML = '';
  S.log.slice().reverse().forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'logRow' + (l.late ? ' late' : '');
    row.innerHTML = '<span class="sp">' + (SPNAME[l.sp] || l.sp) + '</span>' +
      '<span class="tx"></span>' +
      '<button class="play">' + (l.file ? (l.late ? '다시' : '재생') : '—') + '</button>';
    $('.tx', row).textContent = l.text;
    const btn = $('.play', row);
    if (!l.file) btn.disabled = true;
    btn.onclick = () => { if (l.file) AU.play('vo', l.file, 1, { duck: true }); };
    box.appendChild(row);
  });
}
function openLog() { $('#logSheet').classList.add('on'); renderLog(); }
function closeLog() { $('#logSheet').classList.remove('on'); }

/* 대사 한 줄: 자막을 먼저 띄우고, 300ms 안에 디코딩되면 재생, 늦으면 자막만 */
function say(line, opt) {
  opt = opt || {};
  return new Promise(resolve => {
    if (!line) return resolve({ played: false });
    subtitle(line.text, line.speaker, { late: false });
    const rec = { speaker: line.speaker, text: line.text, file: line.file, wid: line.wid, late: false };
    CURSAY = rec;
    S.log.push(rec); if (S.log.length > 80) S.log.shift(); renderLog(); saveSoon();
    let settled = false;
    const finish = (played, late) => {
      if (settled) return; settled = true;
      rec.late = !!late; rec.played = played;
      if (late && CURSAY === rec) { $('#subtitle').classList.add('late'); }
      renderLog();
      const wait = opt.wait === false ? 0 : Math.max(opt.min || 0, (line.dur || 2.4) * 1000);
      if (wait <= 0) resolve({ played, late });
      else setTimeout(() => resolve({ played, late }), wait);
    };
    if (!AU.ac || !line.file) return finish(false, true);
    const t0 = performance.now();
    const guard = setTimeout(() => { if (!settled && !rec.ready) finish(false, true); }, 300);
    AU.load(line.file).then(buf => {
      rec.ready = true;
      const dt = performance.now() - t0;
      if (dt <= 300) {
        clearTimeout(guard);
        if (AU.ac.state === 'running') {
          AU.play('vo', line.file, 1, { duck: true });
          note('vo', line.wid);
          finish(true, false);
        } else finish(false, true);
      } else {
        // 늦게 도착 — 자동 재생 금지. 기록에서 눌러 듣는다.
        clearTimeout(guard);
        if (!settled) finish(false, true);
      }
    }).catch(() => { clearTimeout(guard); finish(false, true); });
  });
}

/* ───────────────────────── 비트 진행 ───────────────────────── */
function beat(id) { return BEATS[id]; }
function voOf(b, wid) { return (b && b.vo || []).find(v => v.wid === wid) || LINES[wid] || null; }

async function go(id, opt) {
  opt = opt || {};
  TOKEN++;
  const tk = TOKEN;
  if (S.beat !== id || opt.force) S.seen[id] = true;
  S.beat = id;
  S.n02.done = false;
  save();
  hideSubtitle();
  closeLog();
  $('#sceneHint').classList.add('hide');
  $('#sceneHint').textContent = '';
  loader(false);
  $('#ending').classList.remove('on');
  $('#board').classList.remove('on');
  document.body.classList.remove('boardMode');
  document.body.classList.remove('hideChrome');
  clearRings();
  endCut();
  const b = beat(id);
  $('#markText').textContent = b ? b.title : '';
  pips();
  if (id === 'B00-01') return enter00(opt);
  if (id === 'B00-02') return enterBoard(opt);
  if (id === 'B00-03') return playCutBEAT('cut00', () => go('B01-01'));
  if (id === 'B01-01') return enter01(opt);
  if (id === 'B01-02') return playCutBEAT('cut01', () => go('BN02-01'));
  if (id === 'BN02-01') return enterN02(opt);
  if (id === 'BN02-02') return playCutBEAT('cutN02', () => showEnding());
}

function pips() {
  const order = ['B00-01', 'B00-02', 'B00-03', 'B01-01', 'B01-02', 'BN02-01', 'BN02-02'];
  const i = order.indexOf(S.beat);
  const box = $('#beatPips'); box.innerHTML = '';
  order.forEach((_, k) => {
    const d = document.createElement('i');
    if (k <= i) d.className = 'on';
    box.appendChild(d);
  });
}

function panel(title, sub) {
  $('#panelTitle').innerHTML = '<b></b>' + (sub ? ' <span style="opacity:.55">· ' + sub + '</span>' : '');
  $('#panelTitle b').textContent = title;
}
function clearActions() {
  $('#panelBody').innerHTML = '';
  $('#panelBody').appendChild(threadStripEl());
  const o = document.createElement('div');
  o.id = 'obsLine';
  $('#panelBody').appendChild(o);
  clearRings();
  showObs();
}
function showObs() {
  const o = $('#obsLine'); if (!o) return;
  const last = S.clues[S.clues.length - 1];
  if (!last || !CLUES[last]) { o.innerHTML = ''; return; }
  const c = CLUES[last];
  o.innerHTML = '<b>' + c.label + '</b> — ' + (c.from || '').replace(/^\[\d+\]\s*/, '');
}
function clearRings() { const r = $('#ringLayer'); if (r) r.innerHTML = ''; }
function threadStripEl() {
  const d = document.createElement('div');
  d.id = 'threadStrip';
  d.innerHTML = '<svg viewBox="0 0 300 40" preserveAspectRatio="none"></svg><div class="hint"></div>';
  return d;
}
function drawThread() {
  const d = $('#threadStrip'); if (!d) return;
  const svg = $('svg', d); const hint = $('.hint', d);
  if (!svg) return;
  const found = S.clues;
  let path = '';
  let knots = '';
  found.forEach((id, i) => {
    const x = 18 + i * (264 / Math.max(5, found.length));
    const y = 20 + Math.sin(i * 1.2) * 5;
    path += (i ? 'L' : 'M') + x + ' ' + y + ' ';
    knots += `<circle cx="${x}" cy="${y}" r="4.4" fill="none" stroke="#bfe6d8" stroke-width="1.1"/>` +
             `<circle cx="${x}" cy="${y}" r="1.5" fill="#bfe6d8"/>`;
  });
  svg.innerHTML = `<path d="${path}" fill="none" stroke="rgba(223,233,239,.22)" stroke-width="1"/>` + knots;
  hint.textContent = found.length ? '결 ' + found.length : '';
  hint.style.left = 'auto'; hint.style.right = '0'; hint.style.top = '16px';
}

/* ───────────────────────── [00] 탐험 ───────────────────────── */
let btns00 = null;
async function enter00(opt) {
  const tk = TOKEN;
  MODE = 'explore00';
  Sc.setImage('assets/still/00/c00_3.webp');
  Sc.imgSrc = 'assets/still/00/c00_3.webp';
  $('#panel').style.display = '';
  clearActions();
  panel('냄새 층 분리', '캡틴 · 한쪽 눈');
  AU.amb('assets/amb/amb_urban.opus');
  AU.startBgm('piano_sparse');
  S.n02.pressure = S.n02.pressure || 2;
  drawThread();
  addRoundBtn('추리', '가설을 세운다', S.clues.length >= 2, () => go('B00-02'));
  hint('길게 눌러 킁킁 · 매듭을 끌어당기면 결이 붙잡힌다');
  if (!opt.resume && !S.seen.intro00) {
    S.seen.intro00 = true;
    await sleep(650);
    if (!alive(tk)) return;
    await say(voOf(beat('B00-01'), '00_004'));
    if (!alive(tk)) return;
    say(voOf(beat('B00-01'), '00_008'));
  }
  saveSoon();
}

async function enter01(opt) {
  const tk = TOKEN;
  MODE = 'explore01';
  Sc.setImage('assets/still/01/c01_1.webp');
  $('#panel').style.display = '';
  clearActions();
  panel('주인 냄새 붙잡기', '누리 · 코');
  AU.amb('assets/amb/amb_road.opus');
  AU.startBgm('piano_sparse');
  drawThread();
  $('#panelBody').appendChild(strandMeter());
  hint('흰 자국을 따라가며 붙잡는다 · 시간이 지나면 결이 얇아진다');
  if (!opt.resume) {
    await sleep(400);
    if (!alive(tk)) return;
    AU.play('sfx', 'assets/sfx/door.opus', 0.85);
    await say(voOf(beat('B01-01'), '01_000'));
    if (!alive(tk)) return;
    await say(voOf(beat('B01-01'), '01_001'));
    if (!alive(tk)) return;
    if (!S.seen.gripTip) {
      S.seen.gripTip = true;
      hint('시작점을 짚고, 자국을 따라 손가락을 끈다');
    }
  }
  if (S.scent.held) {
    addRoundBtn('위로', '목소리가 떨어졌다', true, () => end01());
  }
  tickScent();
  saveSoon();
}

function strandMeter() {
  const d = document.createElement('div');
  d.id = 'strandMeter';
  d.innerHTML = '<div class="mLabel">결의 두께</div><div class="mTrack"><i></i></div><div class="mSub"></div>';
  return d;
}
function updateStrandMeter() {
  const m = $('#strandMeter'); if (!m) return;
  const st = S.scent;
  const pct = Math.round(clamp(st.integrity, 0, 1) * 100);
  $('.mTrack i', m).style.width = pct + '%';
  $('.mTrack i', m).style.background = st.integrity > 0.5 ? 'rgba(191,230,216,.7)'
    : st.integrity > 0.2 ? 'rgba(232,192,122,.75)' : 'rgba(217,104,74,.8)';
  $('.mSub', m).textContent = st.held ? '붙잡았다 — 주인님의 냄새가 손끝에 남았다'
    : st.torn ? '찢겼다 · 흩어지기 전에 다시' : '붙잡기 ' + Math.round(st.grip * 100) + '%';
}

let scentTimer = null;
function tickScent() {
  if (scentTimer) return;
  let last = performance.now();
  scentTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000; last = now;
    if (MODE !== 'explore01' || S.scent.held || paused) return;
    const st = S.scent;
    const held = !!finger && drag && drag.mode === 'strand';
    const decay = held ? 0.006 : 0.014;
    st.integrity = clamp(st.integrity - decay * dt * (1 + (1 - st.integrity) * 0.6), 0, 1);
    if (st.integrity <= 0.001 && !st.torn) tearScent();
    updateStrandMeter();
  }, 120);
}
async function tearScent() {
  const st = S.scent;
  st.torn = true; st.attempts++;
  AU.play('sfx', 'assets/sfx/whoosh.opus', 0.7);
  subtitle('얇아지면 바람에 찢긴다. 찢기면, 흩어진다.', 'nuri', { spText: '누리' });
  S.scent.grip = 0;
  updateStrandMeter();
  if (st.attempts === 1) {
    await say(voOf(beat('B01-01'), '01_005'), { wait: false });
    setTimeout(() => { if (MODE === 'explore01' && !S.scent.held) retryBtn(); }, 2600);
  } else {
    // 두 번째에도 찢기면 결말은 그대로, 과정만 다르게 — 다시 잡을 수 있게 둔다
    setTimeout(() => { if (MODE === 'explore01' && !S.scent.held) retryBtn(); }, 1600);
  }
}
function retryBtn() {
  if ($('#retryBtn')) return;
  const b = document.createElement('button');
  b.className = 'roundBtn'; b.id = 'retryBtn';
  b.innerHTML = '다시<small>결을 잡는다</small>';
  b.onclick = () => {
    b.remove();
    S.scent.integrity = 0.9; S.scent.torn = false; S.scent.grip = 0;
    updateStrandMeter();
    hint('시작점부터 다시 — 이번엔 끊기지 않게');
  };
  $('#panelBody').appendChild(b);
}
async function end01() {
  const tk = TOKEN;
  MODE = 'pause';
  await say(voOf(beat('B01-01'), '01_013'));
  if (!alive(tk)) return;
  AU.play('sfx', 'assets/sfx/tail.opus', 0.7);
  await say(voOf(beat('B01-01'), '01_014'));
  if (!alive(tk)) return;
  setTimeout(() => { if (alive(tk)) go('B01-02'); }, 700);
}

/* ───────────────────────── 추리판 ───────────────────────── */
const HYP = [];
function enterBoard(opt) {
  MODE = 'board';
  $('#board').classList.add('on');
  document.body.classList.add('boardMode');
  $('#boardMap').src = 'assets/still/00/c00_1.webp';
  $('#panel').style.display = 'none';
  AU.fadeAmb(0.35, 0.8);
  drawBoard();
  hintBoard();
  if (!S.seen.board) {
    S.seen.board = true;
    say(voOf(beat('B00-01'), '00_012'));
  }
  saveSoon();
}
function hintBoard() {
  const ready = HYP.filter(h => readyH(h)).length;
  $('#boardHint').textContent = ready
    ? '실이 붙은 가설 ' + ready + '개 — 하나를 골라 이걸로 간다'
    : '매듭을 끌어 물음표에 묶는다 · 필요한 두 결이 다 붙어야 가설이 열린다';
}
function readyH(h) { return h.needs.every(n => S.tied.indexOf(n) >= 0); }

function drawBoard() {
  const svg = $('#boardSvg');
  const box = $('#board').getBoundingClientRect();
  const sceneH = Sc.band + Math.round(window.innerHeight * 0.1);
  const W = box.width;
  const qx = W / 2, qy = Math.min(sceneH * 0.30, 146);
  svg.setAttribute('viewBox', `0 0 ${W} ${box.height}`);
  let inner = '';
  // 물음표 매듭
  const q = document.createElement('div');
  q.className = 'qKnot'; q.id = 'qKnot';
  q.style.left = qx + 'px'; q.style.top = qy + 'px';
  q.textContent = '';
  q.innerHTML = '<span>저 개는<br>왜 여기 있나</span>';
  const old = $('#qKnot'); if (old) old.remove();
  $('#board').insertBefore(q, $('#hyps'));

  const knots = S.clues.slice();
  knots.forEach((id, i) => {
    const c = CLUES[id];
    const ang = rad(-158 + i * (136 / Math.max(1, knots.length - 1)));
    const rx = Math.min(W * 0.40, 148), ry = 58;
    const x = clamp(qx + Math.cos(ang) * rx, 52, W - 52);
    const y = qy + 168 + Math.sin(ang) * ry;
    const tied = S.tied.indexOf(id) >= 0;
    const el = document.createElement('div');
    el.className = 'knot ' + (c.kind === 'smell' ? 'smell' : '') + (tied ? ' tied' : '');
    el.dataset.id = id;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.innerHTML = '<span class="dot"></span><span class="lb"></span>';
    el.querySelector('.lb').textContent = c.label;
    el.addEventListener('pointerdown', ev => startTie(ev, id, el));
    const old2 = $('#board .knot[data-id="' + id + '"]'); if (old2) old2.remove();
    $('#board').insertBefore(el, $('#hyps'));
    if (tied) {
      inner += `<path d="M${x} ${y} Q ${(x + qx) / 2} ${(y + qy) / 2 - 26} ${qx} ${qy}" fill="none" stroke="rgba(191,230,216,.65)" stroke-width="1.4"/>`;
      inner += `<circle cx="${qx}" cy="${qy}" r="6" fill="rgba(191,230,216,.12)" stroke="rgba(191,230,216,.6)"/>`;
    }
  });
  inner += `<path id="liveThread" d="" fill="none" stroke="rgba(232,192,122,.9)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
  svg.innerHTML = inner;
  renderHyps(qx, qy);
  window.__boardGeo = { qx, qy, W };
}

let tying = null;
function startTie(ev, id, el) {
  ev.preventDefault();
  if (S.tied.indexOf(id) >= 0) return;
  tying = { id, x: ev.clientX, y: ev.clientY };
  el.setPointerCapture && el.setPointerCapture(ev.pointerId);
  const move = e => {
    if (!tying) return;
    const live = $('#liveThread'); const g = window.__boardGeo;
    const r = $('#board').getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const kx = parseFloat(el.style.left), ky = parseFloat(el.style.top);
    live.setAttribute('d', `M${kx} ${ky} Q ${(kx + px) / 2} ${(ky + py) / 2 - 18} ${px} ${py}`);
    const d = Math.hypot(px - g.qx, py - g.qy);
    $('#qKnot').classList.toggle('hot', d < 58);
  };
  const up = e => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    if (!tying) return;
    const g = window.__boardGeo;
    const r = $('#board').getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const d = Math.hypot(px - g.qx, py - g.qy);
    tying = null;
    $('#liveThread').setAttribute('d', '');
    $('#qKnot').classList.remove('hot');
    if (d < 58) tie(id); else drawBoard();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}
function tie(id) {
  if (S.tied.indexOf(id) < 0) S.tied.push(id);
  AU.play('sfx', 'assets/sfx/lock.opus', 0.5);
  AU.bell(660 + S.tied.length * 90, 0.1);
  Sc_rippleBoard(id);
  drawBoard();
  hintBoard();
  saveSoon();
}
function Sc_rippleBoard() { /* 판 위 리플은 생략(가벼움) */ }

function renderHyps() {
  const box = $('#hyps'); box.innerHTML = '';
  HYP.forEach(h => {
    const ready = readyH(h);
    const b = document.createElement('button');
    b.className = 'hyp' + (ready ? ' ready' : '') + (S.hyp === h.id ? ' sel' : '');
    b.dataset.id = h.id;
    b.dataset.conf = '확신도 ' + confLabel();
    const names = h.needs.map(n => CLUES[n].label).join(' + ');
    b.innerHTML = '<span class="hl"></span><span class="need"></span>';
    $('.hl', b).textContent = '“' + h.line + '”' + (h.canon ? ' · 정사' : '');
    $('.need', b).textContent = ready ? '실: ' + names : '필요한 결: ' + names;
    b.onclick = () => {
      if (!ready) {
        AU.play('sfx', 'assets/sfx/snap.opus', 0.4);
        b.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 180 });
        return;
      }
      S.hyp = h.id; S.conf = S.tied.filter(t => h.needs.indexOf(t) >= 0).length;
      renderHyps(); confirmBtn();
      AU.bell(520, 0.06);
    };
    box.appendChild(b);
  });
  confirmBtn();
}
function confLabel() {
  const n = S.tied.length;
  return n >= 3 ? '충분' : n === 2 ? '보통' : '약함';
}
function confirmBtn() {
  let b = $('#confirmHyp');
  if (!b) {
    b = document.createElement('button');
    b.className = 'roundBtn'; b.id = 'confirmHyp';
    b.onclick = confirmHyp;
    $('#board').appendChild(b);
  }
  const sel = HYP.find(h => h.id === S.hyp);
  b.disabled = !sel;
  b.innerHTML = sel ? '이걸로<small>간다</small>' : '가설<small>고르기</small>';
}

async function confirmHyp() {
  const h = HYP.find(x => x.id === S.hyp);
  if (!h) return;
  $('#board').classList.remove('on');
  document.body.classList.remove('boardMode');
  $('#panel').style.display = '';
  MODE = 'deduce';
  S.n02.pressure = h.effect['N02.pressure_start'];
  S.n02.start = S.n02.pressure;
  S.conf = S.tied.filter(t => h.needs.indexOf(t) >= 0).length;
  save();
  const tk = TOKEN;
  if (h.vo === 'canon') {
    await say(voOf(beat('B00-02'), '00_013'));
    if (!alive(tk)) return;
  } else {
    subtitle(h.line, 'captain', { spText: '캡틴 · 자막' });
    S.log.push({ speaker: 'captain', text: h.line, file: null, wid: null, late: true });
    renderLog();
    setTimeout(hideSubtitle, 2400);
    await sleep(1800);
    if (!alive(tk)) return;
  }
  go('B00-03');
}

/* ───────────────────────── [N02] 대치 ───────────────────────── */
const CONF_T = {
  entry: ['N02_000', 'N02_001', 'N02_002', 'N02_003', 'N02_004'],
  turns: [
    { prompt: 'N02_005' },
    { prompt: 'N02_011' },
    { prompt: 'N02_012' }
  ]
};
const CHOICES = {
  H00_DRIFTED: [[
    { id: 'admit', label: '떠내려왔다고\n인정한다', jeong: 1, press: -1, hold: 0, react: ['N02_009'] },
    { id: 'owner', label: '주인님이라고\n부른다', jeong: 2, press: 0, hold: -1, react: ['N02_009', 'N02_010'] },
    { id: 'silent', label: '아무 말 없이\n앉아 있다', jeong: 0, press: 1, hold: 1, react: ['N02_011'] }
  ]],
  H00_LOST: [[
    { id: 'show', label: '냄새 맡은\n자리를 보인다', jeong: 1, press: 0, hold: 0, react: ['N02_010'] },
    { id: 'wait', label: '기다린다고\n말한다', jeong: 1, press: 0, hold: 1, react: ['N02_009'] },
    { id: 'scan', label: '도망칠 곳을\n살핀다', jeong: 0, press: 1, hold: 1, react: ['N02_011'] }
  ]],
  H00_BAIT: [[
    { id: 'notbait', label: '미끼가\n아니라고 한다', jeong: 1, press: -1, hold: 0, react: ['N02_009'] },
    { id: 'lower', label: '몸을 낮춘다', jeong: 1, press: -1, hold: -1, react: ['N02_010'] },
    { id: 'shout', label: '소리를 지른다', jeong: -1, press: 2, hold: 1, react: ['N02_008'] }
  ]],
  DEFAULT: [[
    { id: 'admit', label: '떠내려왔다고\n인정한다', jeong: 1, press: -1, hold: 0, react: ['N02_009'] },
    { id: 'silent', label: '아무 말 없이\n앉아 있다', jeong: 0, press: 1, hold: 1, react: ['N02_011'] },
    { id: 'scan', label: '도망칠 곳을\n살핀다', jeong: 0, press: 1, hold: 1, react: ['N02_011'] }
  ]]
};

async function enterN02(opt) {
  const tk = TOKEN;
  MODE = 'confront';
  Sc.setImage('assets/still/N02/cN02_1.webp');
  $('#panel').style.display = '';
  clearActions();
  panel('말의 대치', '까망 · 담벼락 위');
  AU.amb('assets/amb/amb_rain.opus');
  AU.startBgm('guitar_tense');
  const hyp = S.hyp || 'DEFAULT';
  if (!opt.resume) {
    const p0 = (HYP.find(h => h.id === S.hyp) || { effect: {} }).effect['N02.pressure_start'];
    S.n02 = { pressure: p0 == null ? 2 : p0, start: p0 == null ? 2 : p0,
              jeong: 0, hold: 3, turn: 0, done: false, choices: [] };
  }
  // 여기서 압박 시작값은 [00] 가설이 정한다 (0 / 2 / 3)
  renderGauges();
  updateStrandMeter && null;
  if (!opt.resume) {
    for (const wid of CONF_T.entry) {
      const l = voOf(beat('BN02-01'), wid);
      if (!alive(tk)) return;
      if (wid === 'N02_003') { AU.play('sfx', 'assets/sfx/cat_alert.opus', 0.5); }
      await say(l);
    }
    if (!alive(tk)) return;
  }
  nextTurn();
  saveSoon();
}

function renderGauges() {
  const g = $('#gauges');
  const n = S.n02;
  const row = (cls, name, v) => {
    let pips = '';
    for (let i = 0; i < 5; i++) pips += '<i class="' + (i < v ? 'on' : '') + '"></i>';
    return `<div class="gauge ${cls}"><span>${name}</span><span class="pips">${pips}</span></div>`;
  };
  g.innerHTML = row('press', '압박', clamp(n.pressure, 0, 5)) +
                row('jeong', '정', clamp(n.jeong, 0, 5)) +
                row('hold', '버팀', clamp(n.hold, 0, 5));
}

async function nextTurn() {
  const tk = TOKEN;
  const n = S.n02;
  if (n.done) return;
  if (n.jeong >= 3 || n.hold <= 0 || n.turn >= 3) return endConfront();
  const t = CONF_T.turns[n.turn];
  clearActions();
  drawThread();
  const promptLine = voOf(beat('BN02-01'), t.prompt);
  await say(promptLine, { wait: false });
  await sleep(Math.min(2600, (promptLine && promptLine.dur * 1000) || 2000));
  if (!alive(tk)) return;
  showChoices();
}

function showChoices() {
  const n = S.n02;
  const hyp = CHOICES[S.hyp] ? S.hyp : 'DEFAULT';
  let list = CHOICES[hyp][0].slice();
  if (n.turn === 1) {
    list = [
      { id: 'sorry', label: '사과한다', jeong: 1, press: 1, hold: 0, react: ['N02_007', 'N02_008'] },
      { id: 'endure', label: '버틴다', jeong: 0, press: 1, hold: 1, react: ['N02_012'] }
    ];
    if (S.scent.held || S.scent.grip > 0.6) {
      list.unshift({ id: 'scent', label: '주인님의\n냄새를 내민다', jeong: 2, press: -1, hold: 0, react: ['N02_009', 'N02_010'], unlock: true });
    }
  }
  if (n.turn === 2) {
    list = [
      { id: 'tail', label: '꼬리를 낮춘다', jeong: 1, press: -1, hold: 0, react: ['N02_010'] },
      { id: 'eyes', label: '눈을 마주친다', jeong: 1, press: 1, hold: 1, react: ['N02_013'] },
      { id: 'turn', label: '먼저 돌아선다', jeong: 0, press: 0, hold: -1, react: ['N02_013'] }
    ];
  }
  const box = $('#panelBody');
  box.innerHTML = '';
  clearRings();
  const W = Sc.W, H = Sc.H;
  const cx = W / 2, cy = H + 34, R = 138;
  const span = list.length >= 4 ? 100 : list.length === 3 ? 92 : 56;
  const a0 = 270 - span / 2;
  list.forEach((c, i) => {
    const a = rad(a0 + (span * i) / Math.max(1, list.length - 1));
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    const b = document.createElement('button');
    b.className = 'ringBtn' + (c.unlock ? ' unlock' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.innerHTML = c.label.replace(/\n/g, '<br>');
    b.onclick = () => pick(c, b);
    $('#ringLayer').appendChild(b);
  });
  const tail = document.createElement('div');
  tail.id = 'tailRow';
  tail.className = n.pressure >= 3 ? 'hot' : '';
  tail.style.top = '58px';
  tail.innerHTML = '<svg viewBox="0 0 54 22"><path d="M4 20 C 15 20, 20 6, 34 8 S 50 14, 52 4"/></svg><span></span>';
  tail.querySelector('span').textContent = n.pressure >= 3 ? '까망의 꼬리가 빠르게 튄다 — 위험'
    : n.pressure >= 1 ? '까망의 꼬리가 천천히 흔들린다 — 경계'
    : '까망의 꼬리는 낮게 늘어져 있다';
  tail.querySelector('path').style.animationDuration = (n.pressure >= 3 ? 0.7 : n.pressure >= 1 ? 1.8 : 3.6) + 's';
  box.appendChild(tail);

  const tag = document.createElement('div');
  tag.className = 'turnTag';
  tag.style.top = '4px';
  tag.innerHTML = '정 <b>' + Math.min(3, clamp(n.jeong, 0, 5)) + '/3</b> — 3이면 까망이 등을 돌린다 · 버팀 <b>' +
    clamp(n.hold, 0, 5) + '</b> — 0이면 무너진다<br>' +
    (S.hyp ? '지금은 말로 버티는 중 — 명령이 아니라 대답이다' : '가설 없이 들어왔다 — 대답이 얕다');
  box.appendChild(tag);
  panel('말의 대치', (n.turn === 0 ? '첫 마디' : (n.turn + 1) + '번째 마디') + ' · 까망');
}

async function pick(c, el) {
  const tk = TOKEN;
  const n = S.n02;
  if (n.done) return;
  el && el.blur();
  $('#ringLayer').querySelectorAll('.ringBtn').forEach(b => b.disabled = true);
  n.choices.push(c.id);
  // 상태 먼저 (원칙 5)
  n.jeong = clamp(n.jeong + c.jeong, -2, 6);
  n.pressure = clamp(n.pressure + c.press, 0, 6);
  n.hold = clamp(n.hold + c.hold, -1, 6);
  renderGauges();
  save();
  for (const wid of c.react) {
    if (!alive(tk)) return;
    const l = voOf(beat('BN02-01'), wid);
    if (wid === 'N02_010' || wid === 'N02_013') AU.play('sfx', 'assets/sfx/tail.opus', 0.4);
    await say(l);
  }
  if (!alive(tk)) return;
  n.turn++;
  if (n.hold <= 0) {
    subtitle('누리의 다리가 꺾였다. 그래도 눈은 떼지 않았다.', 'narrator', { spText: '내레이션 · 자막' });
    await sleep(2200);
    if (!alive(tk)) return;
    return endConfront();
  }
  if (n.jeong >= 3) {
    subtitle('정은, 실수다. 그런데 이미 늦었다.', 'kkamang', { spText: '까망 · 자막' });
    await sleep(2100);
    if (!alive(tk)) return;
    return endConfront();
  }
  if (n.turn >= 3) return endConfront();
  nextTurn();
}

async function endConfront() {
  const tk = TOKEN;
  const n = S.n02;
  if (n.done) return;
  n.done = true;
  MODE = 'pause';
  const l = voOf(beat('BN02-01'), 'N02_013');
  await say(l, { wait: false });
  await sleep(1200);
  if (!alive(tk)) return;
  go('BN02-02');
}

/* ───────────────────────── 결과 컷 ───────────────────────── */
function endCut() {
  loader(false);
  const v = $('#cutVideo');
  if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); }
  $('#cut').classList.remove('on');
  cut.on = false;
  AU.fadeAmb(1, 0.4);
}
async function playCutBEAT(cutId, next) {
  const meta = (CUE.beats.find(x => x.result && typeof x.result.cut === 'string' && x.result.cut.indexOf(cutId) >= 0) || {}).result;
  if (!meta) return next && next();
  MODE = 'cut';
  document.body.classList.add('hideChrome');
  $('#gauges').innerHTML = '';
  hideSubtitle();
  clearTimeout(sniffTimer);
  AU.stopBgm();
  AU.fadeAmb(0, 0.25);
  loader(true, '결과 컷');
  const v = $('#cutVideo');
  $('#cut').classList.add('on');
  cut.on = true;
  $('#cutCap').textContent = 'v3.6 마스터본 · ' + fmtTC(meta.tc_in) + '–' + fmtTC(meta.tc_out);
  let cap = $('#cutCapTop');
  if (!cap) { cap = document.createElement('div'); cap.className = 'capTop'; cap.id = 'cutCapTop'; $('#cut').appendChild(cap); }
  const sps = [...new Set((meta.subtitles || []).map(x => SPNAME[x.speaker] || ''))].filter(Boolean);
  cap.innerHTML = '마스터본에 새겨진 자막 그대로 · <b>' + sps.join(' / ') + '</b>';
  let cm = $('#cutMeta');
  if (!cm) {
    cm = document.createElement('div'); cm.className = 'capMeta'; cm.id = 'cutMeta';
    cm.style.top = 'calc(15vh + 56.25vw + 56px)';
    $('#cut').appendChild(cm);
    const ct = document.createElement('div'); ct.className = 'capTime'; ct.id = 'cutTime';
    ct.style.top = 'calc(15vh + 56.25vw + 96px)';
    $('#cut').appendChild(ct);
  }
  cm.textContent = (BEATS[S.beat] && BEATS[S.beat].title) || '결과 컷';
  v.src = meta.cut;
  v.currentTime = 0;
  const canplay = new Promise(res => {
    const done = () => { v.removeEventListener('canplay', done); res(); };
    v.addEventListener('canplay', done);
    setTimeout(done, 4000);
  });
  const playP = v.play().catch(e => note('cut-autoplay', String(e)));
  await Promise.race([playP, canplay, sleep(5000)]);
  loader(false);
  let ended = false;
  const subs = meta.subtitles || [];
  const onTime = () => {
    const t = v.currentTime;
    // 마스터 컷에는 자막이 이미 구워져 있다 — 위에 겹쳐 쓰지 않는다.
    const d = v.duration || (meta.tc_out - meta.tc_in);
    $('#cutBar').style.width = (100 * clamp(t / d, 0, 1)) + '%';
    const ct = $('#cutTime');
    if (ct) ct.textContent = fmtTC(t) + ' / ' + fmtTC(d) + ' · ' + fmtTC(meta.tc_in) + '–' + fmtTC(meta.tc_out) + ' (105분 마스터)';
  };
  v.ontimeupdate = onTime;
  const finish = () => {
    if (ended) return; ended = true;
    v.ontimeupdate = null; v.onended = null;
    endCut();
    next && next();
  };
  v.onended = finish;
  $('#cutSkip').onclick = finish;
  onTime();
}

function fmtTC(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/* ───────────────────────── 엔딩 ───────────────────────── */
function showEnding() {
  MODE = 'ending';
  S.beat = 'END';
  Sc.setImage('assets/still/N02/cN02_3.webp');
  document.body.classList.add('hideChrome');
  AU.stopBgm(); AU.stopAmb();
  const n = S.n02;
  const h = HYP.find(x => x.id === S.hyp);
  const PRES = { 0: '낮음', 2: '보통', 3: '높음' };
  $('#endTitle').textContent = S.hyp === 'H00_DRIFTED' ? '떠내려온 것을 알아본 밤'
    : S.hyp === 'H00_BAIT' ? '미끼를 의심한 밤'
    : S.hyp === 'H00_LOST' ? '길을 잃었다고 본 밤' : '가설 없이 지나간 밤';
  $('#endRec').innerHTML =
    '<div>가설 — <b></b> <span class="dim"></span></div>' +
    '<div>실을 붙인 결 — <b></b></div>' +
    '<div>까망의 압박 시작값 — <b></b></div>' +
    '<div>정 게이지 — <b></b> · 버팀 — <b></b></div>' +
    '<div>주인 냄새 — <b></b></div>' +
    '<div>모은 결 — <b></b></div>' +
    '<div>마디 — <b></b></div>';
  const d = $('#endRec').children;
  d[0].querySelector('b').textContent = h ? '“' + h.line + '”' : '세우지 못함';
  d[0].querySelector('span').textContent = h ? (h.canon ? '(정사)' : '(대안)') : '';
  d[1].querySelector('b').textContent = h ? (S.tied.length + '개 · ' + confLabel()) : '—';
  d[2].querySelector('b').textContent = PRES[S.n02.start != null ? S.n02.start : S.n02.pressure] || (S.n02.start || S.n02.pressure);
  d[3].querySelectorAll('b')[0].textContent = Math.min(3, S.n02.jeong) + ' / 3';
  d[3].querySelectorAll('b')[1].textContent = S.n02.hold;
  d[4].querySelector('b').textContent = S.scent.held ? '붙잡음' : (S.scent.torn ? '찢김' : '흘림');
  d[5].querySelector('b').textContent = S.clues.length + '개';
  d[6].querySelector('b').textContent = S.n02.choices.length + '번';
  $('#endNext').innerHTML = '다음 슬라이스 B 예고 — [N04] 콤비의 탄생<br>' +
    '생선가게 세 번 쫓기기 · 들개 · 늙은 고양이와 체온 나누기<br>' +
    '<span style="opacity:.6">이번 판의 가설과 정 게이지는 B의 까망 합류 조건으로 넘어갑니다.</span>';
  $('#ending').classList.add('on');
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

/* ───────────────────────── 입력 ───────────────────────── */
function bindScene() {
  const cv = Sc.cv;
  let start = null, moved = false, holdT = null, grab = null;

  cv.addEventListener('pointerdown', e => {
    if (MODE === 'board' || MODE === 'cut' || MODE === 'ending') return;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    start = { x, y, t: performance.now() }; moved = false; grab = null;
    if (MODE === 'explore00') {
      const hit = nearestKnot(x, y);
      if (hit) {
        grab = { id: hit, x0: x, y0: y };
        AU.senseSwell(toneHz(hit), (x / Sc.W) * 2 - 1);
        return;
      }
      holdT = setTimeout(() => startSniff(), 340);
    }
    if (MODE === 'explore01') {
      const d = distToPath(x, y);
      if (d < 46) { grab = { mode: 'strand', x0: x, y0: y }; finger = { x, y }; }
      else holdT = setTimeout(() => hint('흰 자국 위에서 시작한다'), 500);
    }
  });

  cv.addEventListener('pointermove', e => {
    if (!start) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (Math.hypot(x - start.x, y - start.y) > 9) {
      moved = true;
      if (holdT) { clearTimeout(holdT); holdT = null; }
    }
    if (MODE === 'explore00' && grab && moved) {
      const dy = Math.abs(y - grab.y0), dx = Math.abs(x - grab.x0);
      const need = 40;
      if (Math.hypot(dx, dy * 1.15) > need) {
        const c = CLUES[grab.id];
        grabClue(grab.id, x, y);
        grab = null;
      }
    }
    if (MODE === 'explore01' && grab && grab.mode === 'strand') {
      finger = { x, y };
      advanceGrip(x, y);
    }
  });

  const up = e => {
    if (holdT) { clearTimeout(holdT); holdT = null; }
    const wasStart = start;
    if (start && !moved && performance.now() - start.t < 320) tapAt(start.x, start.y);
    if (grab && grab.mode === 'strand') { finger = null; }
    start = null; grab = null; drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (start) up(e); });
}

function tapAt(x, y) {
  if (MODE !== 'explore00') return;
  const hit = OBSS.find(o => S.clues.indexOf(o.id) < 0 &&
    Math.hypot(Sc.proj(o.nx, o.ny).x - x, Sc.proj(o.nx, o.ny).y - y) < 26);
  if (hit) {
    S.clues.push(hit.id);
    AU.bell(760, 0.09);
    Sc.ripple(Sc.proj(hit.nx, hit.ny).x, Sc.proj(hit.nx, hit.ny).y, '#dfe9ef');
    toast(hit.label + ' — 눈으로 본 것');
    if (hit.id === 'OB_TAIL' && !S.seen.tail) {
      S.seen.tail = true;
      say(voOf(beat('B00-01'), '00_011'));
    }
    onClueChange();
    return;
  }
  if (sniffOn) { sniffOn = false; }
}

function nearestKnot(x, y) {
  let best = null, bd = 44;
  SMELL.forEach(L => {
    if (S.clues.indexOf(L.id) >= 0) return;
    if (L.hidden && sniff < 0.45) return;
    const p = Sc.proj(L.nx, L.ny);
    const yy = p.y + (L.off || 0) * sniff * 16;
    const d = Math.hypot(p.x - x, yy - y);
    if (d < bd) { bd = d; best = L.id; }
  });
  return best;
}
function toneHz(id) {
  const L = SMELL.find(s => s.id === id);
  return L ? 380 + (L.ny - 0.5) * 900 : 500;
}
async function grabClue(id, x, y) {
  if (S.clues.indexOf(id) >= 0) return;
  S.clues.push(id);
  AU.bell(620, 0.1);
  AU.play('sfx', 'assets/sfx/sniff.opus', 0.5);
  Sc.ripple(x, y, CLUES[id].tone);
  toast(CLUES[id].label + ' — 결이 붙잡혔다');
  if (id === 'SM_SOAP' && !S.seen.soap) {
    S.seen.soap = true;
    say(voOf(beat('B00-01'), '00_010'));
  }
  onClueChange();
}
function onClueChange() {
  drawThread();
  showObs();
  const btn = $('#roundBtn');
  if (btn) btn.disabled = S.clues.length < 2;
  saveSoon();
  if (S.clues.length >= 2 && !S.seen.two) {
    S.seen.two = true;
    hint('두 결이 모였다 · 오른쪽 아래 「추리」로 가설을 세운다');
    const b = $('#roundBtn');
    if (b) b.classList.add('ready');
  }
}

function startSniff() {
  if (MODE !== 'explore00') return;
  sniffOn = true;
  AU.play('sfx', 'assets/sfx/sniff.opus', 0.85);
  AU.senseSwell(520, -0.2);
  if (navigator.vibrate) navigator.vibrate(24);
  const b = Sc.proj(0.5, 0.55);
  Sc.ripple(b.x, b.y, '#bfe6d8');
  if (!S.seen.sniff) {
    S.seen.sniff = true;
    say(voOf(beat('B00-01'), '00_009'));
    hint('층이 벌어졌다 · 매듭을 바깥으로 끌어당긴다');
  }
  clearTimeout(sniffTimer);
  sniffTimer = setTimeout(() => { if (!sniffOn) return; }, 12000);
}

/* [01] 결 붙잡기 */
function distToPath(x, y) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = Sc.proj(PATH[i][0], PATH[i][1]);
    const b = Sc.proj(PATH[i + 1][0], PATH[i + 1][1]);
    best = Math.min(best, segDist(x, y, a.x, a.y, b.x, b.y));
  }
  return best;
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
function advanceGrip(x, y) {
  const st = S.scent;
  if (st.held) return;
  const d = distToPath(x, y);
  if (d > 52) return;
  // 경로 진행도: 가장 가까운 구간의 인덱스
  let bi = 0, bd = 1e9;
  PATH.forEach((p, i) => {
    const s = Sc.proj(p[0], p[1]);
    const dd = Math.hypot(s.x - x, s.y - y);
    if (dd < bd) { bd = dd; bi = i; }
  });
  const target = (bi + 1) / PATH.length;
  if (target > st.grip) {
    st.grip = Math.min(1, st.grip + 0.06);
    if (!S.seen.grab) { S.seen.grab = true; say(voOf(beat('B01-01'), '01_003'), { wait: false }); }
    updateStrandMeter();
  }
  if (st.grip >= 0.99 && !st.held) {
    st.held = true; st.integrity = 1;
    AU.bell(540, 0.12);
    updateStrandMeter();
    say(voOf(beat('B01-01'), '01_004'));
    const b = document.createElement('button');
    b.className = 'roundBtn'; b.id = 'upBtn';
    b.innerHTML = '위로<small>목소리가 떨어졌다</small>';
    b.onclick = () => end01();
    $('#panelBody').appendChild(b);
  }
  saveSoon();
}

/* 보조 UI */
function addRoundBtn(label, sub, enabled, onTap) {
  const old = $('#roundBtn');
  if (old) old.remove();
  const b = document.createElement('button');
  b.className = 'roundBtn'; b.id = 'roundBtn';
  b.innerHTML = label + '<small>' + sub + '</small>';
  b.disabled = !enabled;
  b.onclick = onTap;
  $('#panelBody').appendChild(b);
}
function hint(text) {
  const el = $('#sceneHint');
  el.textContent = text;
  el.classList.remove('hide');
  clearTimeout(hint._t);
  hint._t = setTimeout(() => el.classList.add('hide'), 5200);
}
function toast(text) {
  hint(text);
}
function loader(on, text) {
  $('#loader').classList.toggle('on', !!on);
  if (text) $('#loaderText').textContent = text;
}
function note(kind, detail) {
  (window.__cjNotes = window.__cjNotes || []).push([kind, String(detail)]);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ───────────────────────── 초기화 ───────────────────────── */
async function boot() {
  Sc.init();
  Sc.frame(performance.now());
  document.body.classList.add('hideChrome');
  Sc.setImage('assets/still/00/c00_4.webp');
  CUE = await (await fetch('data/cuesheet/slice_a.json')).json();
  CUE.beats.forEach(b => { BEATS[b.beat_id] = b; CUE.clues && null; });
  CUE.beats.forEach(b => (b.vo || []).forEach(l => LINES[l.wid] = l));
  Object.assign(HYP, CUE.hypotheses);
  HYP.forEach(h => { h.needs = h.needs || []; });
  window.CLUE_MAP = CUE.clues;
  Object.assign(CLUES, CUE.clues);
  bindScene();
  bindChrome();
  const sv = loadSave();
  if (sv && sv.beat && sv.beat !== 'B00-01') {
    $('#resumeBtn').hidden = false;
    $('#resumeBtn').textContent = '이어서 계속 — ' + (BEATS[sv.beat] ? BEATS[sv.beat].title : sv.beat);
  } else if (sv) {
    $('#resumeBtn').hidden = false;
    $('#resumeBtn').textContent = '이어서 계속 — 서장부터';
  }
  // 접힘 감지
  if (window.visualViewport && window.visualViewport.segments && window.visualViewport.segments.length === 2) {
    document.body.classList.add('folded');
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); AU.suspend(); if (cut.on) try { $('#cutVideo').pause(); } catch (e) {} }
    else { if (S.started) AU.resume(); }
  });
  window.addEventListener('pagehide', () => { save(); AU.suspend(); });
  requestAnimationFrame(function loop(ts) {
    sniff = lerp(sniff, sniffOn ? 1 : 0, 0.12);
    requestAnimationFrame(loop);
  });
  window.__cj = {
    state: () => JSON.parse(JSON.stringify({ beat: S.beat, clues: S.clues, tied: S.tied, hyp: S.hyp, conf: S.conf, scent: S.scent, n02: S.n02, log: S.log.length, sniffOn })),
    go, start: startGame, choose: id => { const b = [...document.querySelectorAll('.ringBtn')].find(x => x.textContent.replace(/\n/g, '').indexOf(id) >= 0); if (b) b.click(); },
    pick: (turn, i) => { const bs = [...document.querySelectorAll('.ringBtn')]; if (bs[i]) bs[i].click(); },
    tapClue: id => { const L = [...SMELL, ...OBSS].find(x => x.id === id); if (!L) return; if (S.clues.indexOf(id) < 0) { S.clues.push(id); onClueChange(); } },
    tie: id => tie(id),
    setHyp: id => { S.hyp = id; renderHyps(); },
    confirm: () => confirmHyp(),
    skipCut: () => { const b = $('#cutSkip'); if (b) b.click(); },
    openBoard: () => go('B00-02'),
    previewN02: id => {
      const h = HYP.find(x => x.id === id);
      const p = h ? h.effect['N02.pressure_start'] : 2;
      S.hyp = id; S.n02 = { pressure: p, start: p, jeong: 0, hold: 3, turn: 0, done: false, choices: [] };
      go('BN02-01', { resume: true });
    },
    cuelines: () => LINES,
    geos: () => ({ SMELL: SMELL.map(l => ({ id: l.id, p: Sc.proj(l.nx, l.ny) })), OBSS: OBSS.map(o => ({ id: o.id, p: Sc.proj(o.nx, o.ny) })), PATH: PATH.map(p => Sc.proj(p[0], p[1])) }),
    mode: () => MODE,
    notes: () => window.__cjNotes || []
  };
}

function onResize() {
  Sc.resize();
  if (MODE === 'board') drawBoard();
}
function bindChrome() {
  $('#btnLog').onclick = openLog;
  $('#logClose').onclick = closeLog;
  $('#boardClose').onclick = () => {
    if (S.hyp) { go('B00-03'); return; }
    $('#board').classList.remove('on');
    document.body.classList.remove('boardMode');
    $('#panel').style.display = '';
    MODE = 'explore00';
    Sc.setImage('assets/still/00/c00_3.webp');
  };
  $('#startBtn').onclick = () => startGame(null);
  $('#resumeBtn').onclick = () => startGame(loadSave());
  $('#endAgain').onclick = () => {
    localStorage.removeItem(SAVE_KEY);
    S.clues = []; S.tied = []; S.hyp = null; S.conf = 0; S.log = []; S.seen = {};
    S.scent = { grip: 0, integrity: 1, held: false, torn: false, attempts: 0 };
    S.n02 = { pressure: 2, jeong: 0, hold: 3, turn: 0, done: false, choices: [] };
    $('#ending').classList.remove('on');
    MODE = 'title';
    go('B00-01', { force: true });
  };
  $('#endLog').onclick = openLog;
}

async function startGame(sv) {
  AU.unlock();
  AU.resume();
  S.started = true;
  $('#title').classList.add('hide');
  document.body.classList.remove('hideChrome');
  loader(true, '준비 중');
  try {
    await AU.load('assets/amb/amb_urban.opus').catch(() => {});
  } catch (e) {}
  // 이미지 선반입
  ['assets/still/00/c00_3.webp', 'assets/still/00/c00_1.webp', 'assets/still/01/c01_1.webp', 'assets/still/N02/cN02_1.webp']
    .forEach(src => { const i = new Image(); i.src = src; });
  loader(false);
  if (sv) {
    Object.assign(S, {
      clues: sv.clues || [], tied: sv.tied || [], hyp: sv.hyp, conf: sv.conf || 0,
      scent: sv.scent || S.scent, n02: sv.n02 || S.n02, log: sv.log || [], seen: sv.seen || {}
    });
    go(sv.beat, { resume: true });
    $('#resumeBtn').hidden = true;
  } else {
    go('B00-01', {});
    $('#resumeBtn').hidden = true;
  }
}

document.addEventListener('DOMContentLoaded', boot);
})();
