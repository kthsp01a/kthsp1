# 새벽의 냄새길 — Unity(C#) 이식 가이드

이 저장소는 **데이터/에셋/코드가 완전히 분리된 표준 JSON 구조**입니다.
웹 엔진(`app/*.js`)은 이 JSON을 읽어 재생할 뿐이고, 같은 JSON을 Unity가 그대로 읽으면 됩니다.
(게임 기획 원칙: 대본·큐시트·특기 데이터와 에셋을 코드에서 떼어 두고, 나중에 Unity에서 다듬는다.)

```
index.html                 웹 앱 셸
app/core.js                오디오 5버스 · 캔버스 2.5D 카메라 · 날씨/렌즈 · 자막
app/data.js                JSON 로더
app/explore.js             탐험(시점 렌즈) — 매듭 수집
app/deduce.js              추리판 — 실 잇기 · 가설
app/battle.js              턴제 대치 — 숨/체온/긴장·의도/증거
app/flow.js                챕터 지도 · 비트 진행 · 결과 컷 · 엔딩
data/script_v37.json       v3.7 대본 41챕터 745줄 (화자·타임코드·음성 파일명)
data/characters.json       배역 15 + 파티 8 + 작전/신호 + 별이 성장 5단계
data/skills.json           33특기 (해금 지점·효과 ops·근거 문장)
data/cuesheet/ch00..ch18.json  19챕터 · 114비트 큐시트
data/index.json            챕터/씬 목차 + 냄새길 지도 + 배포 정보
data/manifest.json         전 파일 해시·바이트·합계(용량 검사)
assets/vo/<씬>/<wid>.opus  13역 음성 745개 (Opus 32kbps 모노 48kHz)
assets/still/<씬>/*.webp   v3.6 키프레임 1280×720
assets/cut/<씬>.mp4        결과 컷 H.264 720p (씬마다 1편, 총 40편)
assets/amb/*.opus          환경음 10종
assets/sfx/*.opus          효과음 30종
```

## 1. 파일 배치

Unity 프로젝트로 옮길 때 두 갈래 중 하나를 고릅니다.

| 방식 | 배치 | 특징 |
| --- | --- | --- |
| StreamingAssets (권장, 단순) | `Assets/StreamingAssets/concrete_rpg/` 아래에 `data/` `assets/` 를 그대로 복사 | 경로 문자열 그대로 사용, 빌드에 포함, 갱신은 재빌드 |
| Addressables (권장, 대용량) | `assets/` 를 Addressables 그룹으로, `data/` 만 StreamingAssets | 씬 단위 비동기 로드·원격 갱신에 유리 |

경로 규칙: JSON 안의 `assets/...` 경로는 **root(`concrete_rpg/`) 기준 상대경로**입니다.

```csharp
string Root => Path.Combine(Application.streamingAssetsPath, "concrete_rpg");
string Abs(string rel) => Path.Combine(Root, rel);   // rel = "assets/vo/00/00_000.opus"
```

Android는 StreamingAssets가 압축(APK) 안에 있어 `File.ReadAllBytes`로 직접 못 읽습니다.
`UnityWebRequest`(file:// 또는 jar://)로 읽거나, 위 에셋 폴더만 Addressables/압축 해제 대상으로 두세요.

## 2. JSON 로딩

`JsonUtility`는 최상위 배열과 Dictionary를 지원하지 않으므로 **Newtonsoft.Json** 을 권장합니다.

```csharp
[Serializable] public class Line {
  public string speaker, text, file, wid; public float t, dur; public int deadline_ms;
}
[Serializable] public class Shot {
  public float t0, t1; public string still, motion, action; public List<Line> lines; public List<string> clues;
}
[Serializable] public class Clue {
  public string id, label, kind, tone, from_; public float nx, ny; public bool hidden;
}
[Serializable] public class Beat {
  public string beat_id, title, kind, pov, lens, weather, amb, next;
  public List<Shot> shots; public List<Clue> clues;
  public Question question; public List<Hyp> hyps; public Battle battle; public Cut cut;
}
```

> `from` 은 C# 예약어라 `[JsonProperty("from")] public string from_;` 로 매핑하세요.

```csharp
var index = JsonConvert.DeserializeObject<Index>(File.ReadAllText(Abs("data/index.json")));
foreach (var c in index.chapters) {
    var cue = JsonConvert.DeserializeObject<Cue>(File.ReadAllText(Abs(c.cuesheet)));
    foreach (var b in cue.beats) beats[b.beat_id] = b;
}
```

## 3. 비트 = 씬 매니저 단위

`data/index.json`의 `chapters[]` → `beats[]` 가 곧 재생 순서입니다. `beat.next` 로 다음 비트를 잇고,
마지막 비트(`B18-04`)의 `next`가 null이면 엔딩입니다. 저장 단위도 비트입니다(웹은 localStorage `cj_full_v37`).

| `kind` | Unity에서 할 일 |
| --- | --- |
| `explore` | `shots[]` 를 순서대로: 키프레임 표시 + `motion` 카메라 + `lines[]` 대사 재생. `shot.clues[]` 매듭을 탭/홀드로 수집 |
| `deduce` | `clues`(수집분) 매듭을 `question` 에 실로 묶고 → `hyps[].needs` 충족 시 선택 → `hyps[].effect` 를 저장 |
| `battle` | `battle` 스펙으로 턴제 대치(아래 5절) |
| `cut` | `cut.file` 영상 재생, 끝나면 `next` |
| `intermission` | 타이틀 카드 + `lines[]` |

### 카메라 모션 이름 (씬 스틸 위 2.5D)
`pan_lr`, `pan_rl`, `tilt_down`, `tilt_up`, `push_in`, `push_fast`, `pull_out`, `static`
— 웹 구현은 `app/core.js`의 `MOTION` 표(줌 배율/이동량)와 같습니다. Orthographic 카메라에서
`size = base / zoom`, `offset = (x * 0.045W, y * 0.05H)` 로 옮기면 같은 느낌이 납니다.

### 시점 렌즈
`lens`: `oneeye`(캡틴, 왼쪽 시야 어둠) · `strand`(누리, 결 따라 끌기) · `high`(까망, 담장 위) ·
`aerial`(잿빛, 하늘 선) · `text`(소미·김반장, 글자·기억).
`beat.gesture` 가 요구 손짓입니다: `hold` 길게 누르기 / `drag` 끌기 / `tap` 짚기.

## 4. 대사 재생 규칙 (원탁 결정)
- 자막 먼저, 음성은 **300ms 안에 로드되면 재생**, 늦으면 자막만(`line.deadline_ms`).
- 늦게 온 음성은 자동재생 금지 — 대사 기록에서 눌러 다시 듣기.
- 결과 컷 영상에는 자막이 **구워져 있으므로** 위에 겹쳐 쓰지 않습니다(`cut.subs`는 검증용 메타).

## 5. 대치(battle) 스펙

```json
"battle": {
  "id": "BT_N15", "title": "8차선 횡단 — 열한 마리", "mode": "animal",
  "goal": { "type": "through", "value": 3, "turns": 8 },
  "warmth": 6, "warmthLoss": 2, "starStage": "eyes_shut",
  "allies": ["nuri", "kkamang", "otbit"], "humans": ["kim", "park"],
  "enemy": { "name": "대로", "kind": "env", "tension": 0,
             "intents": [{ "name": "트럭", "text": "...", "warmth": -2 }] },
  "phases": [{ "name": "들개", "kind": "animal", "tension": 5, "intents": [] }],
  "skills": ["kim_baton", "park_hazard", "nuri_nape_bite"],
  "intro": "...", "win": "...", "lose": "..."
}
```

- **자원**: 동물별 `숨`(characters.party[].breath), 파티 `체온`(battle.warmth), 상대 `긴장`, 기록 `증거`, 진행 `progress`.
- **승리 조건** `goal.type`: `tension`(긴장 0) · `evidence`(증거 value) · `hold`(value 마디 버티기) · `jeong`(정 value) · `free`/`rescue`/`through`(진행 value).
- **원칙 3**: 동물은 반원 링으로 직접 명령(최대 4개), 사람은 **명령 불가** — `signals`(불빛 세 번·휘파람·노란 손수건·꼬리)로 `작전`(지키기/돕기/기록하기/물러나기)만 바꿉니다.
- **특기 효과 `ops`**: `tension` `jeong` `evidence` `progress` `warmth` `star` `guard` `reveal` `stun` `breath` `charge`. `act:"패시브"` 는 링에 뜨지 않고 상시 적용.
- **죽음 없음**: `warmth<=0` 또는 마디 초과 → 위기 → 재시작(`retry`) 또는 이어가기.
- **가설 효과 이월**: 추리판에서 고른 `hyp.effect` 가 다음 대치 시작값을 바꿉니다(`battle_tension`, `warmth`, `evidence`, `progress`, `jeong`, `reveal`).

## 6. 별이 성장(호위 대상)
`data/characters.json` → `star_stages[]`: `eyes_shut` → `cant_walk` → `leg_move` → `eyes_open` → `standing`.
각 단계 `loss` 가 체온 손실률에 가산됩니다(웹: `loss + (stage.loss - 1)`).

## 7. 사운드 버스
`VO / BGM / AMB / SFX / SENSE` 5버스. 단문 VO·SFX는 `AudioClip`으로 미리 디코드,
긴 환경음은 스트리밍. Unity에서는 `AudioMixer` 5그룹 + `AudioSource.Priority`로 같은 구조를 만들면 됩니다.
BGM은 웹에서 Web Audio로 합성(피아노/기타)하므로 Unity에서는 `data/index.json`의 `weather`/`lens`에 맞춰
자체 루프 클립을 붙이거나, 같은 합성 코드를 `OnAudioFilterRead`로 옮기면 됩니다.

## 8. 검증 훅 (웹)
브라우저 콘솔에서 `CJ.debug.state()`, `CJ.debug.beats()`, `CJ.debug.go(id)`, `CJ.debug.auto()`,
`CJ.debug.fast(true)`, `CJ.debug.notes()` 로 전 구간을 자동 주행할 수 있습니다.
QA 스크립트: `concrete_rpg_src/qa_full.py` (Playwright, 390×844 / 844×390).

## 9. 용량
`data/manifest.json` 참고 — 2026-11-21 빌드 기준 **158.4MB** (GitHub Pages 한도 1GB, 예산 650MB 이내).
결과 컷 40편이 115MB로 대부분을 차지합니다. 더 줄이려면 `assets/cut`만 CRF를 올리거나 AV1로 바꾸면 됩니다.
