/* 새벽의 냄새길 · 완전판 엔진 — deduce (추리판)
   모은 결(매듭)을 물음표 매듭에 실로 묶어 가설을 세운다.
   가설은 카드가 아니라 아래쪽 반원(실루엣) 위에 뜬다. */
(function () {
'use strict';
const CJ = window.CJ, $ = CJ.$, S = CJ.S, Sc = CJ.Sc, AU = CJ.AU;
const esc = CJ.esc;

const Dd = CJ.Dd = {
  beat: null, tied: [], sel: null, geo: null, tk: 0,

  async enter(b, opt, tk) {
    this.beat = b; this.tk = tk; this.sel = S.hyps[(b.question || {}).id] || null;
    const got = (b.clues || []).filter(c => CJ.hasClue(b.scene, c.id));
    this.tied = got.map(c => c.id).filter(id => (b.hyps || []).some(h => (h.needs || []).indexOf(id) >= 0));
    CJ.mode = 'deduce';
    document.body.classList.add('boardMode');
    $('#board').classList.add('on');
    CJ.panelShow(false);
    CJ.clearRings();
    $('#boardMap').src = b.still || '';
    AU.fadeAmb(0.32, 0.9);
    AU.startBgm('piano_sparse');
    this.redraw();
    if (!S.seen['board' + b.scene]) {
      S.seen['board' + b.scene] = true;
      CJ.hint('매듭을 물음표로 끌어 묶는다 · 필요한 결이 다 붙어야 가설이 열린다', 5200);
    }
  },

  close() {
    $('#board').classList.remove('on');
    document.body.classList.remove('boardMode');
    CJ.mode = 'explore';
    CJ.panelShow(true);
    AU.fadeAmb(1, 0.6);
    CJ.ringButtons([{ id: 'reopen', label: '추리판<br>다시', cls: 'go', onTap: () => { CJ.clearRings(); this.enter(this.beat, {}, this.tk); } }], { R: 128, lift: 36 });
  },

  redraw() {
    const b = this.beat;
    if (!b) return;
    const board = $('#board');
    const box = board.getBoundingClientRect();
    const W = box.width, H = box.height;
    const qx = W / 2, qy = Math.round(H * 0.11);
    this.geo = { qx, qy, W, boxH: H };
    const svg = $('#boardSvg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.height = H + 'px';

    // 물음표 매듭
    let q = $('#qKnot');
    if (!q) { q = document.createElement('div'); q.id = 'qKnot'; board.insertBefore(q, $('#hyps')); }
    q.style.left = qx + 'px'; q.style.top = qy + 'px';
    q.innerHTML = '<span>' + esc((b.question || {}).text || '') + '</span>';

    // 결 매듭
    Array.from(board.querySelectorAll('.knot')).forEach(el => el.remove());
    const knots = (b.clues || []).filter(c => CJ.hasClue(b.scene, c.id));
    let inner = '';
    const KN = knots.length;
    knots.forEach((c, i) => {
      const x = KN === 1 ? qx : CJ.clamp(38 + i * (W - 76) / (KN - 1), 38, W - 38);
      const y = Math.round(H * 0.27) + (KN > 4 ? (i % 2 ? 34 : 0) : (KN > 2 ? (i % 2 ? 18 : 0) : 0));
      const tied = this.tied.indexOf(c.id) >= 0;
      const el = document.createElement('div');
      el.className = 'knot' + (tied ? ' tied' : '');
      el.dataset.id = c.id;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.innerHTML = '<span class="dot" style="--tone:' + c.tone + '"></span><span class="lb"></span>';
      el.querySelector('.lb').textContent = c.label;
      el.addEventListener('pointerdown', ev => this.startTie(ev, c.id, el));
      board.insertBefore(el, $('#hyps'));
      if (tied) inner += `<path d="M${x} ${y} Q ${(x + qx) / 2} ${(y + qy) / 2 - 24} ${qx} ${qy}" fill="none" stroke="rgba(191,230,216,.6)" stroke-width="1.5"/>`;
    });
    inner += `<path id="liveThread" d="" fill="none" stroke="rgba(232,192,122,.9)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
    inner += `<circle cx="${qx}" cy="${qy}" r="7" fill="rgba(191,230,216,.12)" stroke="rgba(191,230,216,.5)"/>`;
    svg.innerHTML = inner;
    this.renderHyps();
  },

  startTie(ev, id, el) {
    ev.preventDefault();
    if (this.tied.indexOf(id) >= 0) return;
    el.setPointerCapture && el.setPointerCapture(ev.pointerId);
    const move = e => {
      const r = $('#board').getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const kx = parseFloat(el.style.left), ky = parseFloat(el.style.top);
      const live = $('#liveThread');
      if (live) live.setAttribute('d', `M${kx} ${ky} Q ${(kx + px) / 2} ${(ky + py) / 2 - 16} ${px} ${py}`);
      const d = Math.hypot(px - this.geo.qx, py - this.geo.qy);
      const q = $('#qKnot'); if (q) q.classList.toggle('hot', d < 60);
    };
    const up = e => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const r = $('#board').getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const d = Math.hypot(px - this.geo.qx, py - this.geo.qy);
      const q = $('#qKnot'); if (q) q.classList.remove('hot');
      if (d < 60) this.tie(id); else this.redraw();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  },

  tie(id) {
    if (this.tied.indexOf(id) < 0) this.tied.push(id);
    AU.play('sfx', 'assets/sfx/lock.opus', .45);
    AU.bell(640 + this.tied.length * 80, .08);
    this.redraw();
    CJ.saveSoon();
  },

  ready(h) { return (h.needs || []).every(n => this.tied.indexOf(n) >= 0 || CJ.hasClue(this.beat.scene, n)); },

  renderHyps() {
    const box = $('#hyps');
    box.innerHTML = '';
    const hyps = this.beat.hyps || [];
    const W = Sc.W, H = Sc.H;
    const cx = W / 2, cy = H - 8, Rx = Math.min(W * 0.40, 148), Ry = 92;
    const n = hyps.length;
    const a0 = 202, a1 = 338;
    hyps.forEach((h, i) => {
      const a = CJ.rad(n === 1 ? 270 : a0 + (a1 - a0) * i / (n - 1));
      const x = cx + Math.cos(a) * Rx, y = cy + Math.sin(a) * Ry;
      const ok = this.ready(h);
      const b = document.createElement('button');
      b.className = 'hyp' + (ok ? ' ready' : '') + (this.sel === h.id ? ' sel' : '');
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.dataset.id = h.id;
      b.innerHTML = '<b>' + esc(h.line) + '</b>' + (h.canon ? '<em>정사</em>' : '') +
        '<small>' + (ok ? '실이 붙었다' : '결 ' + (h.needs || []).length + '개 필요') + '</small>';
      b.onclick = e => {
        e.stopPropagation();
        if (!ok) {
          AU.play('sfx', 'assets/sfx/snap.opus', .4);
          b.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 180 });
          CJ.hint('실이 모자란다 — 필요한 결: ' + (h.needs || []).map(id => {
            const c = (this.beat.clues || []).find(x => x.id === id);
            return c ? c.label : id;
          }).join(' + '), 3200);
          return;
        }
        this.sel = h.id;
        AU.bell(520, .05);
        this.renderHyps();
      };
      box.appendChild(b);
    });
    // 확신도
    let conf = $('#confTag');
    if (!conf) { conf = document.createElement('div'); conf.id = 'confTag'; $('#board').appendChild(conf); }
    conf.style.top = Math.round((this.geo.boxH || Sc.H) * 0.42) + 'px';
    conf.style.bottom = 'auto';
    const readyN = hyps.filter(h => this.ready(h)).length;
    const level = this.tied.length >= 3 ? '확신' : this.tied.length === 2 ? '보통' : '약함';
    conf.innerHTML = '묶은 결 <b>' + this.tied.length + '</b> · 열린 가설 <b>' + readyN + '</b> · 확신 <b>' + level + '</b>';
    // 확인
    let go = $('#confirmHyp');
    if (!go) {
      go = document.createElement('button');
      go.id = 'confirmHyp'; go.className = 'roundBtn';
      go.onclick = () => this.confirm();
      $('#board').appendChild(go);
    }
    go.style.top = Math.round((this.geo.boxH || Sc.H) * 0.47) + 'px';
    go.style.bottom = 'auto';
    const sel = hyps.find(h => h.id === this.sel);
    go.disabled = !sel;
    go.innerHTML = sel ? '이걸로<br><small>간다</small>' : '가설<br><small>고르기</small>';
  },

  async confirm() {
    const h = (this.beat.hyps || []).find(x => x.id === this.sel);
    if (!h) return;
    const qid = (this.beat.question || {}).id;
    S.hyps[qid] = h.id;
    S.hypsEffects[qid] = h.effect || {};
    S.seen['hyp_' + qid] = true;
    CJ.save();
    $('#board').classList.remove('on');
    document.body.classList.remove('boardMode');
    CJ.panelShow(false);
    CJ.mode = 'deduce';
    const tk = this.tk;
    await CJ.say({ speaker: this.beat.pov, text: h.line, dur: 2.4, file: null }, { wait: true });
    if (!CJ.alive(tk) || !this.beat) return;
    if (h.canon) AU.bell(660, .1);
    else { AU.play('sfx', 'assets/sfx/snap.opus', .5); }
    CJ.log({ sp: this.beat.pov, text: h.line + (h.canon ? '' : ' (대안 가설)'), file: null, wid: null, late: true });
    CJ.next(tk);
  },

  auto() {
    if (!this.beat) return false;
    const un = (this.beat.clues || []).filter(c => CJ.hasClue(this.beat.scene, c.id) && this.tied.indexOf(c.id) < 0);
    if (un.length) { this.tie(un[0].id); return true; }
    if (!this.sel) {
      const canon = (this.beat.hyps || []).find(h => h.canon && this.ready(h)) || (this.beat.hyps || []).find(h => this.ready(h));
      if (canon) { this.sel = canon.id; this.renderHyps(); return true; }
      // 결이 모자라면 정사 가설이 열릴 때까지 결을 채운다
      const need = (this.beat.hyps || [])[0];
      (need.needs || []).forEach(id => { if (this.tied.indexOf(id) < 0) this.tied.push(id); });
      this.redraw();
      return true;
    }
    this.confirm();
    return true;
  }
};
})();
