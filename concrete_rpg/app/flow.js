/* 새벽의 냄새길 · 완전판 엔진 — flow
   챕터 지도(냄새길 한 줄) · 비트 진행 · 막간 · 결과 컷 · 엔딩 · 부팅. */
(function () {
'use strict';
const CJ = window.CJ, $ = CJ.$, $$ = CJ.$$, S = CJ.S, Sc = CJ.Sc, AU = CJ.AU, D = CJ.D;
const esc = CJ.esc, sleep = CJ.sleep;

let TOKEN = 0;
CJ.mode = 'title';
let curBeat = null;
let curSubs = null;   // {kind, ...}

CJ.alive = tk => tk === TOKEN;

/* ─────────── 비트 진행 ─────────── */
CJ.go = async function (id, opt) {
  opt = opt || {};
  TOKEN++;
  const tk = TOKEN;
  const b = CJ.beat(id);
  if (!b) { console.warn('beat 없음', id); return; }
  curBeat = b;
  S.ended = false;
  S.beat = id; S.chapter = b.chapter;
  S.unlocked = Math.max(S.unlocked, b.chapter);
  CJ.save();
  CJ.hideSubtitle();
  CJ.closeLog();
  $('#sceneHint').classList.add('hide');
  $('#ending').classList.remove('on');
  $('#board').classList.remove('on');
  $('#mapSheet').classList.remove('on');
  $('#interCard').classList.remove('on');
  document.body.classList.remove('boardMode', 'hideChrome', 'mapMode');
  CJ.clearRings();
  if (CJ.Ex && CJ.Ex.abort) CJ.Ex.abort();
  if (CJ.Bt && CJ.Bt.abort) CJ.Bt.abort();
  if (CJ.Dd) CJ.Dd.beat = null;
  CJ.endCut();
  CJ.loader(false);
  $('#gauges').innerHTML = '';
  CJ.layoutStack();
  $('#markText').textContent = chapterLabel(b) ;
  $('#chapterMark').className = 'k' + b.chapter;
  CJ.pips();
  Sc.weather = b.weather || 'night';
  Sc.knots = [];
  const chIdx = D.index.chapters[b.chapter];
  if (chIdx && chIdx.star_stage) {
    const order = ['eyes_shut', 'cant_walk', 'leg_move', 'eyes_open', 'standing'];
    if (order.indexOf(chIdx.star_stage) > order.indexOf(S.star)) S.star = chIdx.star_stage;
  }
  switch (b.kind) {
    case 'explore': return CJ.Ex.enter(b, opt, tk);
    case 'deduce': return CJ.Dd.enter(b, opt, tk);
    case 'battle': return CJ.Bt.enter(b, opt, tk);
    case 'cut': return CJ.playCut(b, opt, tk);
    case 'intermission': return CJ.intermission(b, opt, tk);
    default: return CJ.next(tk);
  }
};

function chapterLabel(b) {
  const c = D.index.chapters[b.chapter];
  if (!c) return b.title || '';
  return c.label + ' · ' + c.title;
}
CJ.pips = function () {
  const box = $('#beatPips'); if (!box) return;
  const c = D.index.chapters[S.chapter];
  box.innerHTML = '';
  if (!c) return;
  c.beats.forEach(id => {
    const d = document.createElement('i');
    const n = D.order.indexOf(id), now = D.order.indexOf(S.beat);
    if (n < now) d.className = 'on';
    else if (n === now) d.className = 'now';
    box.appendChild(d);
  });
};

CJ.next = function (tk) {
  if (tk != null && tk !== TOKEN) return;
  const b = curBeat;
  S.stats.beats++;
  if (b && b.next) return CJ.go(b.next);
  return CJ.showEnding();
};

/* ─────────── 막간 ─────────── */
CJ.intermission = async function (b, opt, tk) {
  CJ.mode = 'intermission';
  Sc.setBandMode('scene');
  document.body.classList.add('hideChrome');
  CJ.panelShow(false);
  CJ.clearRings();
  Sc.setStill(b.still);
  Sc.setMotion('push_in', 26);
  AU.amb(b.amb); AU.startBgm('forest'); AU.fadeAmb(0.5, 1.2);
  const card = $('#interCard');
  card.classList.add('on');
  $('#interKicker').textContent = 'INTERMISSION';
  $('#interTitle').textContent = '2막 · 숲의 시험';
  $('#interSub').textContent = b.quote || '';
  await sleep(CJ.fast ? 30 : 2600);
  if (!CJ.alive(tk)) return;
  for (const l of (b.lines || [])) {
    if (!CJ.alive(tk)) return;
    await CJ.say(l);
  }
  if (!CJ.alive(tk)) return;
  card.classList.remove('on');
  document.body.classList.remove('hideChrome');
  CJ.next(tk);
};

/* ─────────── 결과 컷 ─────────── */
let cutState = { on: false, v: null };
CJ.endCut = function () {
  const v = $('#cutVideo');
  if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); }
  $('#cut').classList.remove('on');
  cutState.on = false;
  AU.fadeAmb(1, 0.4);
};
CJ.playCut = async function (b, opt, tk) {
  CJ.mode = 'cut';
  Sc.setBandMode('scene');
  document.body.classList.add('hideChrome');
  $('#gauges').innerHTML = '';
  CJ.hideSubtitle();
  CJ.panelShow(false);
  CJ.clearRings();
  AU.stopBgm();
  AU.fadeAmb(0, 0.3);
  const meta = b.cut;
  const v = $('#cutVideo');
  $('#cut').classList.add('on');
  cutState.on = true;
  $('#cutCap').textContent = 'v3.6 마스터본 · ' + fmtTC(meta.tc_in) + '–' + fmtTC(meta.tc_out);
  $('#cutTitle').textContent = b.title.replace('결과 컷 · ', '');
  $('#cutAction').textContent = meta.action || '';
  $('#cutBar').style.width = '0%';
  let cap = $('#cutCapTop');
  if (cap) cap.textContent = '마스터본에 새겨진 자막 그대로 · ' + (meta.subs || []).map(x => CJ.SPNAME[x.speaker] || '').filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / ');
  CJ.loader(true, '결과 컷');
  if (CJ.fast) {
    CJ.loader(false);
    $('#cutBar').style.width = '100%';
    $('#cutTime').textContent = fmtTC(meta.tc_out - meta.tc_in);
    S.stats.cuts++;
    setTimeout(() => { if (CJ.alive(tk)) { CJ.endCut(); CJ.next(tk); } }, 60);
    return;
  }
  v.src = meta.file;
  v.currentTime = 0;
  const canplay = new Promise(res => {
    const done = () => { v.removeEventListener('canplay', done); res(); };
    v.addEventListener('canplay', done);
    setTimeout(done, 3000);
  });
  const playP = v.play().catch(e => CJ.note('cut-autoplay', String(e)));
  await Promise.race([playP, canplay, sleep(3600)]);
  if (!CJ.alive(tk)) return;
  CJ.loader(false);
  let ended = false;
  const onTime = () => {
    const t = v.currentTime, d = v.duration || (meta.tc_out - meta.tc_in);
    $('#cutBar').style.width = (100 * CJ.clamp(t / (isFinite(d) ? d : 30), 0, 1)) + '%';
    $('#cutTime').textContent = fmtTC(t) + ' / ' + fmtTC(isFinite(d) ? d : 0);
  };
  v.ontimeupdate = onTime;
  const finish = () => {
    if (ended) return; ended = true;
    v.ontimeupdate = null; v.onended = null;
    S.stats.cuts++;
    CJ.endCut();
    if (!CJ.alive(tk)) return;
    CJ.next(tk);
  };
  v.onended = finish;
  const skip = $('#cutSkip');
  skip.onclick = finish;
  onTime();
  // 영상이 아예 못 뜨면 포스터 + 자막으로 대체
  setTimeout(() => {
    if (!ended && v.readyState < 2) {
      CJ.note('cut-fallback', meta.file);
      $('#cutFallback').style.backgroundImage = 'url(' + meta.poster + ')';
      $('#cutFallback').classList.add('on');
    }
  }, 2500);
};
function fmtTC(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
CJ.fmtTC = fmtTC;

/* ─────────── 냄새길 지도 (챕터 선택) ─────────── */
CJ.openMap = function () {
  const sheet = $('#mapSheet');
  sheet.classList.add('on');
  document.body.classList.add('mapMode');
  const line = $('#mapLine');
  const box = $('#mapDots');
  box.innerHTML = '';
  const chs = D.index.chapters;
  chs.forEach((c, i) => {
    const y = 8 + i * 46;
    const dot = document.createElement('button');
    const locked = i > S.unlocked && !S.seen['ch' + i];
    dot.className = 'mapDot' + (i === S.chapter ? ' now' : '') + (locked ? ' locked' : '') +
      (c.act === '2막' ? ' act2' : '') + (c.act === '종장' ? ' end' : '');
    dot.style.top = y + 'px';
    dot.style.left = '44px';
    dot.innerHTML = '<i></i><b>' + esc(c.label) + '</b><span>' + esc(c.title) + '</span>';
    dot.disabled = locked;
    dot.onclick = () => {
      CJ.closeMap();
      CJ.go(c.first, { jump: true });
    };
    box.appendChild(dot);
  });
  box.style.height = (8 + chs.length * 46 + 20) + 'px';
  if (line) line.style.height = (8 + chs.length * 46) + 'px';
};
CJ.closeMap = function () {
  $('#mapSheet').classList.remove('on');
  document.body.classList.remove('mapMode');
};

/* ─────────── 엔딩 ─────────── */
CJ.showEnding = function () {
  CJ.mode = 'ending';
  Sc.setBandMode('scene');
  S.ended = true;
  document.body.classList.add('hideChrome');
  CJ.hud(false);
  CJ.panelShow(false);
  CJ.clearRings();
  AU.stopAll();
  Sc.setStill('assets/still/A39/' + 'cA39_2.webp');
  Sc.setMotion('pull_out', 40);
  const st = S.stats;
  $('#endTitle').textContent = '이름은 살아남은 뒤에 온다';
  const rows = [
    ['걸어온 길', D.index.chapters.length + '장 · 41씬'],
    ['붙잡은 결', st.clues + '개'],
    ['세운 가설', Object.keys(S.hyps).length + '개'],
    ['대치', st.battles + '회 · ' + st.turns + '마디'],
    ['결과 컷', st.cuts + '편'],
    ['별이', CJ.starStage(S.star).name],
    ['쓴 특기', Object.keys(st.skills).length + '종']
  ];
  $('#endRec').innerHTML = rows.map(r => '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
  $('#endNext').innerHTML = '새벽은 늘, 오는 쪽이었다.<br><span class="dim">손수건은 다음에도 가져갈 것이다. 틈은 남아 있으니까.</span>';
  $('#ending').classList.add('on');
  CJ.clearRings();
  setTimeout(() => CJ.clearRings(), 60);
  CJ.clearSave();
};

/* ─────────── 부팅 ─────────── */
let booted = false;
CJ.boot = async function () {
  if (booted) return; booted = true;
  Sc.init();
  Sc.start();
  document.body.classList.add('hideChrome');
  Sc.setStill('assets/still/00/c00_4.webp');
  $('#title').classList.add('show');
  CJ.hud(false);
  $('#loader').classList.add('on');
  $('#loaderText').textContent = '냄새길을 펴는 중';
  try {
    await CJ.loadData(p => { $('#loaderText').textContent = '냄새길을 펴는 중 · ' + Math.round(p * 100) + '%'; });
  } catch (e) {
    CJ.note('data-fail', String(e));
    $('#loaderText').textContent = '데이터를 읽지 못했습니다';
    return;
  }
  const chs = D.index.chapters;
  $('#titleSub').innerHTML = chs.length + '장 · 41씬 · ' + D.skillsList.length + '특기 · 13역 음성<br>' +
    'v3.6 마스터본 컷과 v3.7 대본으로';
  const sv = CJ.loadSave();
  if (sv && sv.beat) {
    $('#resumeBtn').hidden = false;
    $('#resumeBtn').textContent = '이어서 — ' + ((CJ.beat(sv.beat) || {}).title || '');
  }
  $('#startBtn').onclick = () => CJ.startGame(null);
  $('#resumeBtn').onclick = () => CJ.startGame(CJ.loadSave());
  $('#endAgain').onclick = () => {
    CJ.clearSave();
    location.reload();
  };
  $('#endMap').onclick = () => { $('#ending').classList.remove('on'); CJ.openMap(); };
  $('#endLog').onclick = () => CJ.openLog();
  $('#btnLog').onclick = () => CJ.openLog();
  $('#btnMap').onclick = () => CJ.openMap();
  $('#logClose').onclick = () => CJ.closeLog();
  $('#mapClose').onclick = () => CJ.closeMap();
  $('#boardClose').onclick = () => CJ.Dd.close();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { CJ.save(); AU.suspend(); if (cutState.on) { try { $('#cutVideo').pause(); } catch (e) {} } }
    else if (S.started) AU.resume();
  });
  window.addEventListener('pagehide', () => { CJ.save(); AU.suspend(); });
  CJ.bindInput();
  CJ.loader(false);
  CJ.note('boot-ok', D.order.length + ' beats');
};

function onResize() {
  Sc.resize();
  if (CJ.mode === 'deduce') CJ.Dd.redraw();
  if (curBeat && curBeat.kind === 'explore') CJ.Ex.relayout();
}

CJ.startGame = async function (sv) {
  AU.unlock();
  AU.resume();
  S.started = true;
  $('#title').classList.remove('show');
  document.body.classList.remove('hideChrome');
  CJ.hud(true);
  CJ.loader(true, '준비 중');
  if (sv) {
    Object.assign(S, {
      clues: sv.clues || {}, hyps: sv.hyps || {}, seen: sv.seen || {},
      log: sv.log || [], settings: sv.settings || S.settings,
      unlocked: sv.unlocked || 0, star: sv.star || 'eyes_shut',
      hypsEffects: sv.hypsEffects || {}, stats: sv.stats || S.stats
    });
    $('#resumeBtn').hidden = true;
    await AU.load('assets/amb/amb_urban.opus').catch(() => {});
    CJ.loader(false);
    CJ.go(sv.beat, { resume: true });
  } else {
    $('#resumeBtn').hidden = true;
    await AU.load('assets/amb/amb_urban.opus').catch(() => {});
    CJ.loader(false);
    CJ.go(D.index.chapters[0].first, { fresh: true });
  }
};

/* ─────────── 입력 (탐험 탭/끌기) ─────────── */
CJ.bindInput = function () {
  const cv = $('#scene');
  let st = null, holdT = null, moved = false;
  cv.addEventListener('pointerdown', e => {
    if (CJ.mode !== 'explore') return;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    st = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    moved = false;
    CJ.Ex.down(st.x, st.y);
    holdT = setTimeout(() => { CJ.Ex.hold(st.x, st.y); }, 340);
  });
  cv.addEventListener('pointermove', e => {
    if (!st || CJ.mode !== 'explore') return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (Math.hypot(x - st.x, y - st.y) > 9) { moved = true; clearTimeout(holdT); holdT = null; }
    CJ.Ex.move(x, y);
  });
  const up = e => {
    clearTimeout(holdT); holdT = null;
    if (st && CJ.mode === 'explore') {
      if (!moved && performance.now() - st.t < 340) CJ.Ex.tap(st.x, st.y);
      CJ.Ex.up();
    }
    st = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (st) up(e); });
};

document.addEventListener('DOMContentLoaded', CJ.boot);

/* ─────────── 테스트·자동 검증 훅 ─────────── */
CJ.fast = false;
CJ.debug = {
  state: () => JSON.parse(JSON.stringify({
    mode: CJ.mode, beat: S.beat, chapter: S.chapter, chapterTitle: (D.index.chapters[S.chapter] || {}).title,
    clues: Object.keys(S.clues).reduce((a, k) => (a[k] = S.clues[k].length, a), {}),
    hyps: S.hyps, star: S.star, stats: S.stats, unlocked: S.unlocked,
    explore: curBeat && curBeat.kind === 'explore' ? { shot: CJ.Ex.si, of: CJ.Ex.shots.length, line: CJ.Ex.li, done: CJ.Ex.done, knots: CJ.Ex.knots.length } : null,
    battle: curBeat && curBeat.kind === 'battle' ? { turn: CJ.Bt.turns, warmth: CJ.Bt.warmth, goal: CJ.Bt.b.goal, done: CJ.Bt.done } : null
  })),
  beats: () => D.order.slice(),
  chapters: () => D.index.chapters.map(c => ({ n: c.chapter, label: c.label, title: c.title, first: c.first, beats: c.beats.length })),
  go: id => CJ.go(id),
  auto: () => {
    if (CJ.mode === 'explore') {
      if (CJ.Ex.done) { const t = CJ.Ex.tk; CJ.clearRings(); CJ.next(t); return true; }
      return CJ.Ex.auto();
    }
    if (CJ.mode === 'intermission') return false;
    if (CJ.mode === 'deduce') return CJ.Dd.auto();
    if (CJ.mode === 'battle') return CJ.Bt.auto();
    if (CJ.mode === 'cut') { const b = $('#cutSkip'); if (b) b.click(); return true; }
    return false;
  },
  fast: v => { CJ.fast = !!v; return CJ.fast; },
  skipCut: () => { const b = $('#cutSkip'); if (b) b.click(); },
  notes: () => (window.__cjNotes || []),
  noteKinds: () => (window.__cjKinds || {}),
  missing: () => (window.__cjNotes || []).filter(n => /miss|fail|fallback/.test(n[0])),
  ending: () => $('#ending').classList.contains('on'),
  log: n => S.log.slice(-(n || 6))
};
})();
