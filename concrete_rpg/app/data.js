/* 새벽의 냄새길 · 완전판 엔진 — data
   data/index.json + data/cuesheet/ch00..ch18.json + skills/characters/script 를
   코드와 완전히 분리된 표준 JSON으로 읽어 온다(Unity 이식용 구조 그대로). */
(function () {
'use strict';
const CJ = window.CJ;
const D = CJ.D = {
  index: null, chapters: {}, beats: {}, order: [],
  skills: {}, skillsList: [], chars: null, script: null, ready: false
};

CJ.loadData = async function (onProgress) {
  const p = onProgress || function () {};
  const idx = await (await fetch('data/index.json')).json();
  D.index = idx;
  const list = idx.chapters;
  let done = 0;
  await Promise.all(list.map(async c => {
    const cue = await (await fetch(c.cuesheet)).json();
    D.chapters[c.chapter] = cue;
    cue.beats.forEach(b => {
      b._c = c.chapter;
      D.beats[b.beat_id] = b;
      D.order.push(b.beat_id);
    });
    done++;
    p(done / list.length);
  }));
  const sk = await (await fetch('data/skills.json')).json();
  sk.skills.forEach(s => { D.skills[s.id] = s; });
  D.skillsList = sk.skills;
  D.chars = await (await fetch('data/characters.json')).json();
  D.ready = true;
  return D;
};

CJ.beat = id => D.beats[id];
CJ.orderedBeats = () => D.order;
CJ.chapterOf = beat => D.chapters[beat._c] || D.chapters[beat.chapter];

/* 지금 씬에서 해금된 특기 (해금 지점 = 씬 순서) */
CJ.unlockedSkills = function (sceneId) {
  const idxs = D.index.scenes.map(s => s.scene);
  const si = idxs.indexOf(sceneId);
  return D.skillsList.filter(s => s.unlock_index >= 0 && s.unlock_index <= si);
};

/* 별이 성장 단계 */
CJ.starStage = function (id) {
  const st = (D.chars && D.chars.star_stages) || [];
  return st.find(s => s.id === id) || st[0] || { id: id, name: id, loss: 1, line: '' };
};
})();
