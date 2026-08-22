# websocial — 자동화 웹소설 집필 파이프라인

한 줄 아이디어를 넣으면 **기획 → 설정집 → 회차표 → 트리트먼트 → 본문 → 검수 → 퇴고 → 연속성 갱신**을
회차 단위로 반복하는 CLI다. 중간 산출물이 전부 파일로 남아서 사람이 언제든 열어 고칠 수 있다.

**Claude API와 무료 API를 함께 쓴다.** 단계별로 다른 모델에 보낼 수 있어서,
집필은 Claude로, 검수·요약 같은 기계적인 단계는 무료 모델로 돌리면 비용이 크게 줄어든다.
키가 하나도 없어도 `--mock` 으로 전 구간을 무과금 리허설할 수 있다.

자세한 설계 근거는 [docs/PLAN.md](docs/PLAN.md).

## 설치 없이 쓰기 — `standalone/websocial.html`

**Node·터미널·설치가 전부 필요 없다.** [`standalone/websocial.html`](standalone/websocial.html) 파일 하나를
내려받아 **더블클릭**하면 브라우저에서 바로 열린다. 설정에서 API 키를 넣고 아이디어 한 줄만 적으면
기획 → 설정집 → 회차표 → 집필 → 검수 → 퇴고 → 캐논 갱신까지 화면에서 돈다.

- 데이터는 그 브라우저의 localStorage 에만 저장된다. 서버로 아무것도 보내지 않는다.
- API 키는 파일 안에 들어가지 않으므로 파일을 남에게 줘도 키는 따라가지 않는다.
- 제공자는 **Anthropic · Groq · xAI Grok · Gemini · OpenRouter · 직접 입력(Ollama 등)** 중에서 고른다.
  **Anthropic 만 브라우저 직접 호출이 되는 것을 확인했다.** 나머지는 각 제공자의 CORS 정책에 달렸으므로
  설정 화면의 **‘연결 테스트’** 로 5초 만에 확인하면 된다.
- 모델명을 몰라도 된다. 설정의 **‘모델 목록’** 버튼이 그 키로 실제 쓸 수 있는 모델을 불러와 채워 준다.
- 한계: 브라우저 저장 공간(수 MB)에 묶이고, 단계별 모델 라우팅·예산 상한·회차 파일 저장은 없다.
  본격적으로 길게 연재하려면 아래 CLI/서버판을 쓰는 게 낫다.

## 빠른 시작 — 브라우저에서 (권장)

```bash
npm install
cp .env.example .env      # 쓸 제공자의 키만 채우면 된다
npm run novel -- serve    # http://127.0.0.1:4173
```

브라우저에서 작품 생성 → 기획·설정집·회차표 만들기 → 연재 진행(진행 로그 실시간) →
회차별 원고를 **직접 고쳐 저장**하는 것까지 전부 화면에서 된다. 고친 원고는 확정본이 되고
다음 회차가 그 내용을 이어받는다.

서버는 `127.0.0.1` 에만 바인딩되고 인증이 없다. 외부에 열지 마라.

## 빠른 시작 — CLI

```bash
npm install
cp .env.example .env

npm run novel -- providers          # 어떤 제공자를 쓸 수 있는지 확인

npm run novel -- init 회귀한-망나니 \
  --idea "재벌가 망나니가 파산 직전으로 회귀해 그룹을 재건한다" \
  --title "회귀한 망나니 도련님" \
  --genre 현대판타지 --platform 문피아 --episodes 30

npm run novel -- run 회귀한-망나니 --to 10 --budget 20   # 1~10화 자동 진행
npm run novel -- status 회귀한-망나니
npm run novel -- export 회귀한-망나니 --format txt
```

`run` 은 기획·설정집·회차표가 없으면 알아서 먼저 만들고, 이미 끝난 단계는 건너뛴다.
중간에 멈춰도 같은 명령을 다시 실행하면 이어서 진행한다.

키가 하나도 없다면:

```bash
npm run novel -- init 연습작 --idea "..." --mode mock
npm run novel -- run 연습작 --to 3 --mock
```

## 제공자 고르기

| 목적 | 명령 | 결과 |
|------|------|------|
| 품질 우선 | `--mode claude` | 전 단계 Claude (`claude-opus-5`) |
| 비용/품질 균형 (권장) | `--mode mixed` | 집필·기획은 Claude, 검수·다이제스트는 무료 모델 |
| 완전 무료 | `--provider gemini` / `groq` / `openrouter` / `cerebras` | 전 단계 무료 티어 |
| 오프라인 무료 | `--provider ollama` | 로컬 모델. 키 불필요 |
| 무과금 리허설 | `--mode mock` | API 호출 없음. 구조 검증용 |

옵션을 안 주면 설정된 키를 감지해서 알아서 고른다(`--mode auto`).
나중에 바꾸려면 `projects/<슬러그>/project.json` 의 `llm.profiles` / `llm.routes` 를 고치면 된다.

```jsonc
"llm": {
  "profiles": {
    "quality": { "provider": "anthropic", "preset": "anthropic", "model": "claude-opus-5", "effort": "high" },
    "free":    { "provider": "gemini",    "preset": "gemini",    "model": "gemini-2.5-flash" }
  },
  "routes": {
    "concept": "quality", "bible": "quality", "outline": "quality",
    "plan": "quality", "draft": "quality", "revise": "quality",
    "qa": "free", "digest": "free"          // ← 여기만 바꾸면 단계별 모델이 바뀐다
  }
}
```

> 무료 모델은 한국어 장문 품질이 Claude보다 확연히 떨어진다.
> 본문 집필(`draft`)까지 무료로 돌리면 원고를 그대로 쓰기는 어렵고, 구조 확인용으로는 충분하다.

## 명령

| 명령 | 하는 일 |
|------|---------|
| `init <슬러그>` | 프로젝트 생성. `--idea` 필수 |
| `concept` / `bible` / `outline` | 기획 / 설정집 / 회차표 생성 |
| `write --ep N` | 한 회차를 트리트먼트부터 확정까지 |
| `qa --ep N` / `revise --ep N` | 한 회차만 검수 / 퇴고 |
| `run --to N` | 기획부터 N화까지 자동 진행 |
| `status` | 진행률·연속성 원장·누적 비용 |
| `export --format txt\|md [--split]` | 확정 원고 내보내기 |
| `providers` | 제공자 목록과 키 감지 상태 |
| `serve [--port 4173]` | 브라우저 UI 를 localhost 에 띄운다 |

공통 옵션: `--mock`(무과금) `--budget <USD>`(이번 실행 상한) `--force`(재생성) `--keep-going`(보류 회차 무시하고 계속)

## 산출물

```
projects/<슬러그>/
├── project.json          메타 + 모델 라우팅 + 검수 기준
├── concept.json          기획
├── bible.json            설정집 (세계관·인물·용어·금기)
├── outline.json          아크 / 회차표
├── canon.json            확정 사실 원장 (출처 회차 표기)
├── foreshadow.json       복선 원장 (심음 / 회수)
├── characters-state.json 인물별 현재 상태
├── progress.json         회차 상태 머신
├── episodes/ep-0001/     plan.json · draft.md · qa.json · rev-N.md · final.md · digest.json
├── runs/usage.jsonl      호출별 토큰·비용
└── exports/
```

## 품질 게이트

규칙 검사(무료·즉시)와 AI 심사를 함께 돌린다.

- **하드 게이트(자동 퇴고 강제)**: 분량 이탈, 금칙 표현, 본문 속 메타 텍스트, 설정 모순, AI 심사 `revise`
- **경고(퇴고 지시에 참고)**: 대사 비율, 평균 문장 길이, 긴 문단 비율, 반복 표현, 종결어미 연속, 설정집에 없는 고유명사 후보

자동 퇴고를 `maxRevisions`(기본 2)회 해도 통과하지 못하면 그 회차를 `needs_human` 으로 두고 **멈춘다**.
조용히 넘어가지 않는다.

기준값은 `project.json` 의 `qa` 에서 조정한다 (`charTarget`, `charTolerance`, `bannedPhrases`, `useAiJudge` 등).

## 프롬프트 고치기

프롬프트는 코드가 아니라 `prompts/*.md` 파일이다. 문체가 마음에 안 들면 `prompts/style.md` 부터 고치면 된다.
`{{변수}}` 자리표시자는 채워지지 않으면 실행이 실패하므로, 변수명을 바꿀 때는 코드도 함께 봐야 한다.

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test (40개, 네트워크 불필요)
npm run check       # 둘 다
```

- **Node 22.18 이상**이 필요하다. 네이티브 타입 스트리핑으로 빌드 단계 없이 `node src/cli.ts` 가 바로 돈다.
  (22.6~22.17 은 `node --experimental-strip-types src/cli.ts` 로 실행해야 한다.)
- 런타임 의존성은 `@anthropic-ai/sdk` 와 `zod` 둘뿐이다.
- 무료 제공자 어댑터는 로컬 스텁 서버로 실제 HTTP 왕복을 테스트한다(API 키 불필요).
- 웹 UI 는 의존성 없는 단일 HTML(`web/index.html`)이고, API 는 `src/server/` 의 `node:http` 서버다.
  빌드도 번들러도 없다.
