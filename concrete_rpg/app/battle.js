/* 새벽의 냄새길 · 완전판 엔진 — battle (턴제 대치)
   자원: 동물별 '숨', 파티 '체온', 상대 '긴장/의도', 기록 '증거'.
   원칙 3: 동물은 반원 링으로 직접 명령, 사람은 신호(작전 성향)로만 움직인다.
   죽음 없음 — 실패하면 '위기'가 되고 다시 짠다. */
(function () {
'use strict';
const CJ = window.CJ, $ = CJ.$, S = CJ.S, Sc = CJ.Sc, AU = CJ.AU, D = CJ.D;
const esc = CJ.esc, clamp = CJ.clamp;

const PLAN_OF_SIGNAL = {
  '불빛 세 번': '지키기',
  '휘파람': '돕기',
  '노란 손수건': '물러나기',
  '꼬리': '기록하기'
};
const BASE_ACTIONS = [
  { id: 'lower', name: '낮추기', sub: '정 +1', ops: { jeong: 1, tension: -0.5 } },
  { id: 'endure', name: '버티기', sub: '방어 +1', ops: { guard: 1 } },
  { id: 'scan', name: '살피기', sub: '의도 공개', ops: { reveal: 1 } },
  { id: 'warm', name: '붙어 있기', sub: '체온 +1', ops: { warmth: 1 } }
];

const Bt = CJ.Bt = {
  beat: null, b: null, tk: 0, phase: 0,
  warmth: 6, warmthMax: 8, loss: 1,
  allies: [], humans: [], enemy: null,
  evidence: 0, progress: 0, jeong: 0, guard: 0, reveal: 0, stun: 0, charge: 0,
  turns: 0, plan: '돕기', acted: false, done: false, sel: null, page: 0,

  async enter(b, opt, tk) {
    const sp = b.battle;
    this.beat = b; this.b = sp; this.tk = tk; this.phase = 0;
    this.warmth = sp.warmth || 6; this.warmthMax = Math.max(8, sp.warmth || 6);
    this.loss = (sp.warmthLoss || 0) + Math.max(0, (CJ.starStage(S.star).loss || 1) - 1);
    this.evidence = 0; this.progress = 0; this.jeong = 0;
    this.guard = 0; this.reveal = 0; this.stun = 0; this.charge = 0; this.turns = 0;
    this.done = false; this.acted = false; this.page = 0;
    this.plan = '돕기';
    const party = (D.chars && D.chars.party) || {};
    this.allies = (sp.allies || []).filter(id => party[id]).map(id => ({
      id, name: party[id].name, breath: party[id].breath || 4, max: party[id].breath || 4
    }));
    this.humans = (sp.humans || []).filter(id => party[id]).map(id => ({
      id, name: party[id].name, plan: party[id].plan || '돕기'
    }));
    this.setEnemy(sp.enemy);
    // 가설 효과 이월 (직전 추리판)
    const effs = Object.values(S.hypsEffects || {});
    effs.forEach(e => {
      if (!e) return;
      if (e.battle_tension) this.enemy.tension = clamp(this.enemy.tension + e.battle_tension, 0, 12);
      if (e.reveal) this.reveal = 1;
      if (e.evidence) this.evidence += e.evidence;
      if (e.jeong) this.jeong += e.jeong;
      if (e.warmth) this.warmth = clamp(this.warmth + e.warmth, 1, this.warmthMax);
      if (e.progress) this.progress += e.progress;
      if (e.star) this.warmth = clamp(this.warmth + 1, 1, this.warmthMax);
    });
    CJ.mode = 'battle';
    Sc.setBandMode('battle');
    document.body.classList.remove('hideChrome');
    CJ.panelShow(true);
    Sc.lens = 'battle';
    Sc.knots = [];
    AU.amb(b.amb);
    AU.startBgm(sp.mode === 'talk' ? 'guitar_tense' : 'guitar_tense');
    AU.fadeAmb(0.8, .8);
    if (b.still) Sc.setStill(b.still);
    Sc.setMotion('push_in', 30);
    this.render();
    CJ.layoutStack();
    if (!opt.resume && sp.intro) {
      CJ.subtitle(sp.intro, 'narrator', { spText: '대치 · 규칙' });
      CJ.log({ sp: 'narrator', text: sp.intro, file: null, late: true });
    }
    S.stats.battles++;
    CJ.save();
  },

  setEnemy(e) {
    this.enemy = {
      name: e.name, kind: e.kind, tension: e.tension || 0,
      intents: (e.intents || []).slice(), i: 0,
      tensionMax: Math.max(6, e.tension || 0)
    };
  },

  skills() {
    const ids = (this.b.skills || []);
    return ids.map(id => D.skills[id]).filter(Boolean);
  },

  intent() {
    if (!this.enemy) return null;
    return this.enemy.intents[this.enemy.i % Math.max(1, this.enemy.intents.length)] || null;
  },

  abort() { this.done = true; this.beat = null; this.tk = -1; this.failed = false; },

  render() {
    if (!this.beat || !CJ.alive(this.tk)) return;
    const g = $('#gauges');
    const st = CJ.starStage(S.star);
    const bar = (cls, name, v, max, extra) => {
      const pct = clamp(v / max, 0, 1) * 100;
      return `<div class="gbar ${cls}"><span>${esc(name)}</span><i><b style="width:${pct}%"></b></i><em>${extra != null ? extra : Math.round(v * 10) / 10}</em></div>`;
    };
    const goal = this.b.goal;
    const goalTxt = goal.type === 'tension' ? '긴장' : goal.type === 'evidence' ? '증거'
      : goal.type === 'hold' ? '버티기' : goal.type === 'jeong' ? '정' : '진행';
    const goalVal = goal.type === 'tension' ? this.enemy.tension
      : goal.type === 'evidence' ? this.evidence : goal.type === 'hold' ? this.turns
      : goal.type === 'jeong' ? this.jeong : this.progress;
    const goalMax = goal.type === 'tension' ? this.enemy.tensionMax : Math.max(goal.value, 1);
    const goalEm = goal.type === 'tension' ? (Math.round(goalVal * 10) / 10) + ' → 0'
      : goal.type === 'hold' ? this.turns + ' / ' + goal.value
      : (Math.round(goalVal * 10) / 10) + ' / ' + goal.value;
    g.innerHTML =
      bar('warm', '체온', this.warmth, this.warmthMax, Math.round(this.warmth * 10) / 10) +
      bar('goal', goalTxt, goalVal, goalMax, goalEm) +
      `<div class="gturn"><span>${this.turns + 1}마디</span><em>${esc(this.enemy.name)} · ${esc(CJ.starStage(S.star).name)}</em></div>`;

    // 반원 링 — 동물 특기(최대 4) + 행동
    const sk = this.skills().filter(s => s.act !== '패시브');
    const pages = Math.max(1, Math.ceil(sk.length / 4));
    const page = this.page % pages;
    const slice = sk.slice(page * 4, page * 4 + 4);
    const list = slice.map(s => {
      const owner = this.allies.find(a => a.id === s.owner);
      const can = owner && owner.breath > 0;
      return {
        id: s.id, label: s.name, sub: owner ? owner.name + ' · 숨1' : s.act,
        cls: can ? 'skill' : 'skill off', disabled: !can,
        onTap: () => this.use(s)
      };
    });
    if (!list.length) list.push({ id: 'wait', label: '숨<br>고르기', sub: '대기 · 숨+1', cls: 'skill', onTap: () => this.use(null) });
    CJ.ringButtons(list, { Rx: 146, Ry: 60, lift: 58 });

    // 사람 신호 / 기본 행동 / 기록
    const body = $('#panelBody');
    body.innerHTML =
      `<div id="btTop">
         <div class="btLead">사람 동료 — 명령이 아니라 신호 · 작전${pages > 1 ? ' · 특기 ' + (page + 1) + '/' + pages + ' <button id="btPage" class="tiny">다음 특기</button>' : ''}</div>
         <div class="btSignals">${(D.chars.signals || []).map(sg => `<button class="sig${PLAN_OF_SIGNAL[sg] === this.plan ? ' on' : ''}" data-s="${esc(sg)}">${esc(sg)}</button>`).join('')}</div>
         <div class="btBase">${BASE_ACTIONS.map(a => `<button class="base" data-a="${a.id}">${esc(a.name)}<small>${esc(a.sub)}</small></button>`).join('')}</div>
       </div>
       <div id="btLog">${this.logLines().map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
    CJ.$$('.sig', body).forEach(b => b.onclick = () => { this.plan = PLAN_OF_SIGNAL[b.dataset.s]; this.render(); });
    CJ.$$('.base', body).forEach(b => b.onclick = () => this.use(null, BASE_ACTIONS.find(a => a.id === b.dataset.a)));
    const pg = $('#btPage'); if (pg) pg.onclick = () => { this.page = (this.page + 1) % pages; this.render(); };
    CJ.panel('대치 · ' + this.b.title, this.enemy.name + (this.reveal || this.turns === 0 ? ' · ' + (this.intent() ? this.intent().name : '') : ' · 의도 불명'));
  },

  logLines() {
    return (this._log || []).slice(-3);
  },
  push(l) { this._log = (this._log || []).concat(l).slice(-12); },

  use(skill, base) {
    if (this.done) return;
    const ops = {};
    let name = '';
    if (base) { Object.assign(ops, base.ops); name = base.name; }
    else if (skill) {
      const owner = this.allies.find(a => a.id === skill.owner);
      if (owner) { if (owner.breath <= 0) return; owner.breath--; }
      Object.assign(ops, skill.ops);
      name = skill.name;
      S.stats.skills[skill.id] = (S.stats.skills[skill.id] || 0) + 1;
      S.stats.turns++;
      AU.play('sfx', skill.id.indexOf('unlock') >= 0 ? 'assets/sfx/lock.opus' : 'assets/sfx/snap.opus', .4);
    } else {
      // 대기 — 숨 회복
      this.allies.forEach(a => a.breath = Math.min(a.max, a.breath + 1));
      name = '숨 고르기';
      this.push('숨을 고른다. 다음 마디를 위해.');
    }
    if (ops.breath === -1) { /* 소모 */ }
    this.resolve(ops, name, skill);
  },

  applyOps(ops) {
    const m = (1 + (ops.charge ? 0 : this.charge)) ;
    if (this.charge) this.charge = 0;
    if (ops.tension) this.enemy.tension = clamp(this.enemy.tension + ops.tension * (ops.tension < 0 ? m : 1), 0, this.enemy.tensionMax);
    if (ops.jeong) this.jeong = clamp(this.jeong + ops.jeong * (ops.jeong > 0 ? m : 1), 0, 9);
    if (ops.evidence) this.evidence = clamp(this.evidence + ops.evidence * (ops.evidence > 0 ? m : 1), 0, 9);
    if (ops.progress) this.progress = clamp(this.progress + ops.progress * (ops.progress > 0 ? m : 1), 0, 9);
    if (ops.warmth) this.warmth = clamp(this.warmth + ops.warmth, 0, this.warmthMax);
    if (ops.star) this.warmth = clamp(this.warmth + ops.star * 0.5, 0, this.warmthMax);
    if (ops.guard) this.guard = clamp(this.guard + ops.guard, 0, 4);
    if (ops.reveal) this.reveal = 1;
    if (ops.stun) this.stun = clamp(this.stun + ops.stun, 0, 2);
    if (ops.breath) {
      if (ops.breath > 0) this.allies.forEach(a => a.breath = Math.min(a.max, a.breath + ops.breath));
      else {
        const a = this.allies[Math.floor(Math.random() * this.allies.length)];
        if (a) a.breath = clamp(a.breath + ops.breath, 0, a.max);
      }
    }
    if (ops.charge) this.charge = clamp(this.charge + ops.charge, 0, 2);
  },

  async resolve(ops, name, skill) {
    if (!this.beat || !CJ.alive(this.tk)) return;
    this.applyOps(ops);
    const opsTxt = [];
    if (ops.tension) opsTxt.push('긴장 ' + (ops.tension > 0 ? '+' : '') + ops.tension);
    if (ops.jeong) opsTxt.push('정 +' + ops.jeong);
    if (ops.evidence) opsTxt.push('증거 +' + ops.evidence);
    if (ops.progress) opsTxt.push('진행 +' + ops.progress);
    if (ops.warmth) opsTxt.push('체온 ' + (ops.warmth > 0 ? '+' : '') + ops.warmth);
    if (ops.guard) opsTxt.push('방어 +' + ops.guard);
    if (ops.reveal) opsTxt.push('의도 공개');
    if (ops.stun) opsTxt.push('시야 차단');
    if (ops.charge) opsTxt.push('다음 마디 강화');
    this.push(name + (opsTxt.length ? ' — ' + opsTxt.join(', ') : ''));
    if (skill && skill.src) this.push('“' + skill.src + '”');

    // 사람 동료: 명령 불가 — 작전대로만 움직인다
    if (this.humans.length) {
      const p = this.plan;
      const humans = this.humans.map(h => h.name).join('·');
      if (p === '지키기') this.applyOps({ guard: 1 });
      else if (p === '돕기') {
        const g = this.b.goal.type;
        if (g === 'evidence') this.applyOps({ evidence: 1 });
        else if (g === 'free' || g === 'rescue' || g === 'through') this.applyOps({ progress: 1 });
        else this.applyOps({ tension: -1 });
      } else if (p === '기록하기') this.applyOps({ evidence: 1 });
      else if (p === '물러나기') this.applyOps({ warmth: 1, breath: 1 });
      this.push(humans + ' — 신호대로 ' + p);
    }
    // 패시브
    if (this.humans.some(h => h.id === 'somi') && this.plan === '지키기') this.applyOps({ guard: 1 });

    this.render();
    await CJ.sleep(CJ.fast ? 20 : 420);
    if (this.done || !CJ.alive(this.tk)) return;

    // 상대 차례
    if (this.stun > 0) {
      this.stun--;
      this.push(this.enemy.name + ' — 시야가 막혀 움직이지 못한다');
    } else if (this.guard > 0) {
      this.guard--;
      const it = this.intent();
      this.push((it ? it.text : this.enemy.name + '의 움직임') + ' — 막았다');
      this.enemy.i++;
    } else {
      const it = this.intent();
      if (it) {
        this.push(it.text);
        if (it.warmth) this.warmth = clamp(this.warmth + it.warmth, 0, this.warmthMax);
        if (it.breath) {
          const a = this.allies[Math.floor(Math.random() * this.allies.length)];
          if (a) a.breath = clamp(a.breath - it.breath, 0, a.max);
        }
        this.enemy.i++;
      }
    }
    // 환경 손실
    if (this.loss > 0) this.warmth = clamp(this.warmth - this.loss, 0, this.warmthMax);
    this.turns++;
    this.acted = true;
    this.render();
    await CJ.sleep(CJ.fast ? 20 : 280);
    if (this.check()) return;
    // 숨이 모두 비면 한 번 쉰다
    if (this.allies.length && this.allies.every(a => a.breath <= 0)) {
      this.allies.forEach(a => a.breath = Math.min(a.max, a.breath + 2));
      this.push('모두 숨이 찼다. 한 번 크게 쉰다.');
      this.render();
    }
  },

  check() {
    const g = this.b.goal;
    const win = g.type === 'tension' ? this.enemy.tension <= 0
      : g.type === 'evidence' ? this.evidence >= g.value
      : g.type === 'hold' ? this.turns >= g.value
      : g.type === 'jeong' ? this.jeong >= g.value
      : this.progress >= g.value;
    if (win) { this.finish(true); return true; }
    if (this.warmth <= 0) { this.finish(false, '체온이 떨어졌다'); return true; }
    if (this.turns >= (g.turns || 8)) { this.finish(false, '마디가 다했다'); return true; }
    return false;
  },

  async finish(win, why) {
    if (this.done || !this.beat) return;
    this.done = true;
    const tk = this.tk;
    CJ.clearRings();
    AU.stopBgm();
    if (win) {
      // 다음 상대(파도)가 있으면 이어서
      const ph = (this.b.phases || [])[this.phase];
      if (ph) {
        if (!CJ.alive(tk)) return;
        this.phase++;
        this.setEnemy(ph);
        this.turns = 0; this.guard = 1; this.progress = 0; this.evidence = 0; this.jeong = 0;
        this.done = false;
        this.push('— ' + ph.name + '이(가) 앞을 막았다');
        CJ.subtitle(ph.name + ' — 아직 끝이 아니다.', 'narrator', { spText: '대치 · 다음' });
        await CJ.sleep(CJ.fast ? 30 : 1200);
        if (!CJ.alive(tk)) return;
        this.render();
        return;
      }
      await CJ.say({ speaker: this.beat.pov, text: this.b.win || '해냈다.', dur: 3.2, file: null });
      if (!CJ.alive(tk)) return;
      CJ.log({ sp: this.beat.pov, text: this.b.win || '', file: null, late: true });
      if (S.stats.turns === 0) S.stats.turns = this.turns;
      CJ.next(tk);
    } else {
      this.failed = true;
      AU.play('sfx', 'assets/sfx/heart.opus', .8);
      await CJ.say({ speaker: 'narrator', text: (this.b.lose || '위기다.') + ' (' + why + ')', dur: 2.8, file: null });
      if (!CJ.alive(tk)) return;
      CJ.ringButtons([
        { id: 'retry', label: '다시<br>짠다', cls: 'go', onTap: () => { CJ.clearRings(); this.enter(this.beat, {}, this.tk); } },
        { id: 'skip', label: '이대로<br>간다', cls: 'ghost', onTap: () => { CJ.clearRings(); CJ.next(this.tk); } }
      ], { R: 132, lift: 36 });
    }
  },

  auto() {
    if (!this.beat) return false;
    if (this.done) {
      if (this.failed) {
        this.retries = (this.retries || 0) + 1;
        this.failed = false;
        if (this.retries > 3) { CJ.clearRings(); CJ.next(this.tk); return true; }
        this.enter(this.beat, {}, this.tk);
        return true;
      }
      return false;
    }
    const g = this.b.goal;
    const sk = this.skills().filter(s => s.act !== '패시브').filter(s => {
      const a = this.allies.find(x => x.id === s.owner);
      return !a || a.breath > 0;
    });
    const score = o => {
      let v = 0;
      if (g.type === 'tension') v += -(o.tension || 0) * 2 + (o.guard || 0) * 0.4;
      if (g.type === 'jeong') v += (o.jeong || 0) * 2 - (o.tension || 0) * 0.3;
      if (g.type === 'evidence') v += (o.evidence || 0) * 3;
      if (g.type === 'free' || g.type === 'rescue' || g.type === 'through') v += (o.progress || 0) * 3 + (o.guard || 0) * 0.5;
      if (g.type === 'hold') {
        const need = this.warmth <= this.loss * 2 + 1.5;
        v += (o.warmth || 0) * (need ? 4 : 0.4);
        v += (o.guard || 0) * (need ? 2.5 : 0.8);
        v += (o.stun || 0) * 1.2;
      }
      v += (o.warmth || 0) * 0.15;
      return v;
    };
    const cands = [];
    sk.forEach(s => cands.push({ kind: 'skill', s, sc: score(s.ops || {}) }));
    BASE_ACTIONS.forEach(a => cands.push({ kind: 'base', a, sc: score(a.ops || {}) }));
    cands.sort((x, y) => y.sc - x.sc);
    const best = cands[0];
    if (best && best.kind === 'skill' && best.sc >= 1.0) { this.use(best.s); return true; }
    if (best) { this.use(null, best.a); return true; }
    this.use(null); return true;
  }
};
})();
