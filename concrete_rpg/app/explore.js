/* 새벽의 냄새길 · 완전판 엔진 — explore
   시점 렌즈(한쪽 눈/붙잡는 코/높은 곳/하늘 선/글자)마다 다른 손짓으로
   장면 속 냄새 결을 모은다. 단서는 목록이 아니라 캔버스 위 매듭으로만 존재한다. */
(function () {
'use strict';
const CJ = window.CJ, $ = CJ.$, S = CJ.S, Sc = CJ.Sc, AU = CJ.AU;

const LENS = {
  oneeye: { name: '한쪽 눈 · 층 냄새', hint: '길게 눌러 킁킁 — 층이 벌어진다 · 매듭을 짚어 결을 모은다', bgm: 'piano_sparse' },
  strand: { name: '붙잡는 코', hint: '결 위에서 끌어당겨 붙잡는다 · 얇아지기 전에', bgm: 'piano_sparse' },
  high: { name: '높은 곳', hint: '담장 위에서 먼저 본다 · 꼬리 표시를 읽는다', bgm: 'guitar_tense' },
  aerial: { name: '하늘 선', hint: '위에서 내려다본다 — 사람은 그림자로 보인다', bgm: 'piano_sparse' },
  text: { name: '글자 · 기억', hint: '글자와 사물을 짚어 읽는다 · 소리는 울음으로만', bgm: 'dawn' }
};

const Ex = CJ.Ex = {
  beat: null, shots: [], si: 0, li: -1, busy: false, done: false,
  knots: [], reveal: {}, tk: 0, press: null, drag: 0, endedShown: false,

  async enter(b, opt, tk) {
    this.beat = b; this.shots = b.shots || []; this.si = 0; this.li = -1;
    this.busy = false; this.done = false; this.tk = tk; this.endedShown = false;
    this.knots = []; this.reveal = {}; this.press = null; this.drag = 0;
    CJ.mode = 'explore';
    Sc.setBandMode('scene');
    const L = LENS[b.lens] || LENS.oneeye;
    Sc.lens = b.lens; Sc.weather = b.weather || 'night';
    Sc.dim = 1;
    document.body.classList.remove('hideChrome');
    CJ.panelShow(true);
    CJ.clearPanelBody();
    CJ.panel(b.title, (CJ.SPNAME[b.pov] || b.pov) + ' · ' + L.name);
    AU.amb(b.amb);
    AU.startBgm(L.bgm);
    AU.fadeAmb(1, 1.0);
    this.panelStrip();
    CJ.layoutStack();
    this.showShot(0);
    this.hint = L.hint;
    CJ.hint(L.hint, 6400);
    await CJ.sleep(CJ.fast ? 60 : 520);
    if (!CJ.alive(tk)) return;
    this.playNext();
  },

  abort() { this.beat = null; this.done = true; this.tk = -1; this.busy = false; this._skip = null; },

  relayout() {
    if (this.beat && this.shots[this.si]) {
      Sc.setStill(this.shots[this.si].still);
      Sc.fit();
      this.syncKnots();
    }
  },

  panelStrip() {
    const body = $('#panelBody');
    body.innerHTML = '<div id="threadStrip"><svg viewBox="0 0 300 34" preserveAspectRatio="none"></svg><div class="hint"></div></div>' +
      '<div id="shotRail"></div>';
    this.drawStrip();
    this.drawRail();
  },
  drawStrip() {
    const d = $('#threadStrip'); if (!d) return;
    const svg = $('svg', d), note = $('.hint', d);
    if (!svg) return;
    const all = this.beat.clues || [];
    const got = all.filter(c => CJ.hasClue(this.beat.scene, c.id));
    let p = '', dots = '';
    all.forEach((c, i) => {
      const x = 16 + i * (268 / Math.max(3, all.length - 1));
      const y = 17 + Math.sin(i * 1.3) * 4;
      const has = got.indexOf(c) >= 0;
      p += (i ? 'L' : 'M') + x + ' ' + y + ' ';
      dots += `<circle cx="${x}" cy="${y}" r="${has ? 4.6 : 3}" fill="${has ? CJ.hexA(c.tone, .85) : 'none'}" stroke="${CJ.hexA(c.tone, has ? .9 : .3)}" stroke-width="1.1"/>`;
      if (!has) dots += `<circle cx="${x}" cy="${y}" r="1.2" fill="${CJ.hexA(c.tone, .35)}"/>`;
    });
    svg.innerHTML = `<path d="${p}" fill="none" stroke="rgba(223,233,239,.20)" stroke-width="1"/>` + dots;
    if (note) note.textContent = got.length + ' / ' + all.length;
  },

  drawRail() {
    const rail = $('#shotRail');
    if (!rail) return;
    const n = this.shots.length;
    let h = '';
    for (let i = 0; i < n; i++) h += '<i class="' + (i < this.si ? 'on' : i === this.si ? 'now' : '') + '"></i>';
    rail.innerHTML = h + '<span>' + (this.si + 1) + ' / ' + n + '</span>';
  },

  showShot(i) {
    this.si = i; this.li = -1;
    const s = this.shots[i];
    if (!s) return;
    const dur = Math.max(5, (s.t1 - s.t0) || 8);
    Sc.setStill(s.still);
    Sc.setMotion(s.motion, dur);
    Sc.lens = this.beat.lens;
    this.syncKnots();
    this.drawRail();
    // 다음 샷 스틸 선반입
    const nx = this.shots[i + 1];
    if (nx) CJ.prefetchStills([nx.still]);
  },
  syncKnots() {
    const s = this.shots[this.si] || {};
    const ids = s.clues || [];
    this.knots = (this.beat.clues || []).filter(c => ids.indexOf(c.id) >= 0).map(c => ({
      id: c.id, label: c.label, tone: c.tone, nx: c.nx, ny: c.ny, hidden: c.hidden,
      got: CJ.hasClue(this.beat.scene, c.id), revealed: !!this.reveal[c.id], from: c.from
    }));
    Sc.knots = this.knots;
  },

  playNext() {
    if (!CJ.alive(this.tk)) return;
    const s = this.shots[this.si];
    if (!s) return this.finish();
    this.li++;
    if (this.li < (s.lines || []).length) {
      return this.playLine(s.lines[this.li]);
    }
    // 이 샷의 대사가 끝났다 → 다음 샷
    if (this.si < this.shots.length - 1) {
      this.showShot(this.si + 1);
      return this.playNext();
    }
    return this.finish();
  },

  async playLine(line) {
    this.busy = true;
    const p = CJ.say(line, { wait: false });
    const dur = CJ.fast ? 25 : Math.max(950, (line.dur || 2.0) * 1000);
    await this.waitSkip(dur);
    this.busy = false;
    if (!CJ.alive(this.tk)) return;
    if (this.autoRun) return this.playNext();
  },
  waitSkip(dur) {
    return new Promise(res => {
      let done = false;
      const f = () => { if (done) return; done = true; this._skip = null; clearTimeout(this._t); res(); };
      this._skip = f;
      this._t = setTimeout(f, dur);
    });
  },
  skip() { if (this._skip) this._skip(); },

  finish() {
    if (this.done || !this.beat || !CJ.alive(this.tk) || CJ.mode === 'ending' || CJ.mode === 'cut') return;
    this.done = true;
    CJ.layoutStack();
    CJ.hideSubtitle();
    const nextBeat = this.beat.next ? CJ.beat(this.beat.next) : null;
    const label = nextBeat ? (nextBeat.kind === 'deduce' ? '추리판' : nextBeat.kind === 'battle' ? '대치' : nextBeat.kind === 'cut' ? '결과 컷' : '계속') : '끝';
    CJ.ringButtons([{
      id: 'go', label: label + '<br>계속', cls: 'go',
      onTap: () => { CJ.clearRings(); CJ.next(this.tk); }
    }], { R: 128, lift: 36 });
    CI_showThreadHint(this);
  },

  /* ── 입력 ── */
  down(x, y) {
    this.press = { x, y, t: performance.now() };
    this.drag = 0;
    const k = this.knotAt(x, y);
    if (k) AU.senseSwell(380 + (k.ny - .5) * 800, (k.nx * 2 - 1));
  },
  hold(x, y) {
    if (!this.beat) return;
    if ((this.beat.gesture === 'hold') || this.beat.lens === 'text') {
      const hid = this.knots.filter(k => k.hidden && !k.got);
      if (hid.length) {
        hid.forEach(k => { this.reveal[k.id] = true; k.revealed = true; });
        AU.play('sfx', 'assets/sfx/sniff.opus', .8);
        AU.senseSwell(540, -0.2);
        if (navigator.vibrate) navigator.vibrate(22);
        Sc.ripple(x, y, '#bfe6d8');
        CJ.subtitle(this.beat.lens === 'text' ? '손끝에서 글자가 결로 번졌다.' : '층이 벌어졌다 — 맨 밑에, 아주 깨끗한 결이 있다.', this.beat.pov, { spText: '감각 · 자막' });
        CJ.hint('층이 벌어졌다 · 이제 매듭을 짚을 수 있다', 3000);
      } else {
        AU.play('sfx', 'assets/sfx/sniff.opus', .55);
        CJ.hint('냄새가 층층이 쌓여 있다 — 다른 결을 찾아본다', 2400);
      }
    }
  },
  move(x, y) {
    if (!this.press || !this.beat) return;
    this.drag = Math.hypot(x - this.press.x, y - this.press.y);
    if (this.drag > 46 && this.beat.gesture === 'drag') {
      const k = this.knotAt(x, y) || this.knotAt(this.press.x, this.press.y);
      if (k && !k.got) this.collect(k);
    }
  },
  up() { this.press = null; this.drag = 0; },

  tap(x, y) {
    if (this.done) return;
    const k = this.knotAt(x, y);
    if (k) {
      if (k.hidden && !k.revealed) {
        if (this.beat.gesture === 'tap') {
          this.reveal[k.id] = true; k.revealed = true;
          AU.bell(700, .08); Sc.ripple(x, y, k.tone);
          CJ.hint('결이 드러났다 — 한 번 더 짚어 붙잡는다', 2400);
        } else {
          CJ.hint(this.beat.gesture === 'drag' ? '결 위에서 끌어당긴다' : '길게 눌러 층을 벌린다', 2400);
        }
        return;
      }
      return this.collect(k);
    }
    if (this.busy) return this.skip();
    this.playNext();
  },

  knotAt(x, y) {
    let best = null, bd = 30;
    this.knots.forEach(k => {
      if (k.got) return;
      const p = Sc.proj(k.nx, k.ny);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  },

  collect(k) {
    if (!this.beat) return;
    const scene = this.beat.scene;
    if (!CJ.addClue(scene, k.id)) return;
    k.got = true;
    const p = Sc.proj(k.nx, k.ny);
    Sc.ripple(p.x, p.y, k.tone);
    AU.bell(620, .1);
    AU.play('sfx', 'assets/sfx/sniff.opus', .45);
    if (k.from) {
      CJ.subtitle(k.from, this.beat.pov, { spText: '대본 · ' + (CJ.SPNAME[this.beat.pov] || '') });
      CJ.log({ sp: this.beat.pov, text: k.from, file: null, wid: null, late: true });
    }
    CJ.toast(k.label + ' — 결이 붙잡혔다', 2200);
    this.drawStrip();
    if (S.stats.clues === 1 && !S.seen.firstClue) {
      S.seen.firstClue = true;
      CJ.hint('단서는 목록이 아니라, 이 장면의 결이다 · 추리판에서 실로 묶인다', 4200);
    }
    CJ.saveSoon();
  },

  /* 테스트·자동 진행 */
  auto() {
    if (!this.beat) return false;
    const un = this.knots.find(k => !k.got);
    if (un) {
      if (un.hidden && !un.revealed) { this.reveal[un.id] = true; un.revealed = true; return true; }
      this.collect(un); return true;
    }
    if (this.done) return false;
    if (this.busy) { this.skip(); return true; }
    this.playNext(); return true;
  }
};

function CI_showThreadHint(ex) {
  const got = (ex.beat.clues || []).filter(c => CJ.hasClue(ex.beat.scene, c.id)).length;
  const all = (ex.beat.clues || []).length;
  if (all && got < all) CJ.hint('결 ' + got + '/' + all + ' · 놓친 결이 있어도 이야기는 간다', 3600);
}
})();
