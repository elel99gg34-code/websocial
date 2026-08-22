import { z } from "zod";

/* ────────────────────────────────────────────────────────────
 * 파이프라인 단계 — LLM 라우팅 키이자 사용량 기록 키
 * ──────────────────────────────────────────────────────────── */
export const STAGES = [
  "concept",
  "bible",
  "outline",
  "plan",
  "draft",
  "qa",
  "revise",
  "digest",
] as const;
export type StageId = (typeof STAGES)[number];

/* ────────────────────────────────────────────────────────────
 * LLM 프로필 / 라우팅
 * ──────────────────────────────────────────────────────────── */
export const ProviderKindSchema = z.enum([
  "anthropic",
  "openai-compat",
  "gemini",
  "mock",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProfileSchema = z.object({
  provider: ProviderKindSchema,
  /** presets.ts 의 프리셋 이름(groq, openrouter, ollama...). openai-compat 에서만 의미 있음 */
  preset: z.string().default(""),
  model: z.string(),
  /** 프리셋 기본값을 덮어쓸 때만 지정 */
  baseUrl: z.string().default(""),
  apiKeyEnv: z.string().default(""),
  /** anthropic 전용: 사고 깊이. 다른 제공자에서는 무시된다 */
  effort: z.enum(["low", "medium", "high"]).default("high"),
  maxOutputTokens: z.number().int().positive().default(16000),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const LlmConfigSchema = z.object({
  profiles: z.record(z.string(), ProfileSchema),
  /** 단계 → 프로필 이름 */
  routes: z.record(z.string(), z.string()),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/* ────────────────────────────────────────────────────────────
 * 프로젝트 메타
 * ──────────────────────────────────────────────────────────── */
export const QaThresholdsSchema = z.object({
  /** 공백 포함 목표 글자수 */
  charTarget: z.number().int().positive().default(5200),
  /** 허용 오차 비율 (0.12 = ±12%) */
  charTolerance: z.number().positive().default(0.12),
  dialogueRatioMin: z.number().default(0.2),
  dialogueRatioMax: z.number().default(0.6),
  avgSentenceMax: z.number().default(45),
  longParagraphRatioMax: z.number().default(0.15),
  repeatedPhraseMax: z.number().int().default(2),
  endingRunMax: z.number().int().default(3),
  bannedPhrases: z.array(z.string()).default([]),
  /** 검수 실패 시 자동 퇴고 최대 횟수 */
  maxRevisions: z.number().int().min(0).default(2),
  /** AI 심사 사용 여부 */
  useAiJudge: z.boolean().default(true),
});
export type QaThresholds = z.infer<typeof QaThresholdsSchema>;

export const ProjectSchema = z.object({
  slug: z.string(),
  title: z.string(),
  idea: z.string(),
  genre: z.string().default("현대판타지"),
  platform: z.string().default("문피아"),
  pov: z.string().default("3인칭 제한적 시점"),
  tense: z.string().default("과거 시제"),
  targetReader: z.string().default("20~40대 남성 독자"),
  plannedEpisodes: z.number().int().positive().default(30),
  createdAt: z.string(),
  llm: LlmConfigSchema,
  qa: QaThresholdsSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

/* ────────────────────────────────────────────────────────────
 * 1단계: 기획
 * ──────────────────────────────────────────────────────────── */
export const ConceptSchema = z.object({
  logline: z.string().describe("한 문장 로그라인"),
  synopsis: z.string().describe("3~5문단 시놉시스"),
  subGenre: z.string(),
  keywords: z.array(z.string()).describe("플랫폼 검색 키워드/트로프 5~10개"),
  protagonist: z.object({
    name: z.string(),
    role: z.string(),
    want: z.string().describe("표면적 욕망"),
    need: z.string().describe("진짜 필요한 것"),
    flaw: z.string().describe("결핍/약점"),
    hook: z.string().describe("이 주인공만의 매력 포인트"),
  }),
  antagonist: z.object({
    name: z.string(),
    role: z.string(),
    threat: z.string(),
    motive: z.string(),
  }),
  coreConflict: z.string(),
  sellingPoints: z.array(z.string()).describe("흥행 포인트 3~5개"),
  firstEpisodeHook: z.string().describe("1화에서 독자를 붙잡는 전략"),
  endingDirection: z.string(),
});
export type Concept = z.infer<typeof ConceptSchema>;

/* ────────────────────────────────────────────────────────────
 * 2단계: 설정집
 * ──────────────────────────────────────────────────────────── */
export const CharacterSchema = z.object({
  name: z.string(),
  aka: z.string().describe("별칭/호칭. 없으면 빈 문자열"),
  role: z.string().describe("주인공/조력자/적대자/조연 중 하나"),
  age: z.string(),
  appearance: z.string(),
  personality: z.string(),
  speechStyle: z.string().describe("말투·어미·자주 쓰는 표현. 대사 일관성의 핵심"),
  background: z.string(),
  goal: z.string(),
  secret: z.string().describe("독자에게 아직 숨긴 정보. 없으면 빈 문자열"),
  relations: z.array(z.string()).describe("'인물명: 관계' 형식"),
});
export type Character = z.infer<typeof CharacterSchema>;

export const BibleSchema = z.object({
  world: z.object({
    setting: z.string(),
    rules: z.array(z.string()).describe("이 세계에서 절대 어길 수 없는 규칙"),
    powerSystem: z.string().describe("능력/재력/권력 체계. 없으면 빈 문자열"),
    society: z.string(),
    timeline: z.array(z.string()).describe("작품 시작 이전의 주요 사건"),
  }),
  characters: z.array(CharacterSchema),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
  taboos: z.array(z.string()).describe("이 작품에서 하면 안 되는 전개/표현"),
});
export type Bible = z.infer<typeof BibleSchema>;

/* ────────────────────────────────────────────────────────────
 * 3단계: 회차표
 * ──────────────────────────────────────────────────────────── */
export const OutlineSchema = z.object({
  arcs: z.array(
    z.object({
      id: z.string().describe("arc-1 형식"),
      title: z.string(),
      summary: z.string(),
      fromEpisode: z.number().int(),
      toEpisode: z.number().int(),
      climax: z.string(),
    }),
  ),
  episodes: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      arcId: z.string(),
      goal: z.string().describe("이 회차가 이야기에서 수행하는 역할"),
      hook: z.string().describe("회차 마지막 훅"),
      plantForeshadow: z.array(z.string()).describe("이번 화에 심을 복선"),
      payoffForeshadow: z.array(z.string()).describe("이번 화에 회수할 복선"),
    }),
  ),
});
export type Outline = z.infer<typeof OutlineSchema>;
export type OutlineEpisode = Outline["episodes"][number];

/* ────────────────────────────────────────────────────────────
 * 4단계: 회차 트리트먼트
 * ──────────────────────────────────────────────────────────── */
export const EpisodePlanSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  logline: z.string(),
  pov: z.string().describe("시점 인물"),
  place: z.string(),
  charactersOnStage: z.array(z.string()).describe("이번 화에 실제로 등장하는 인물명"),
  beats: z
    .array(z.object({ beat: z.string(), purpose: z.string() }))
    .describe("장면 비트 4~6개. 순서대로"),
  emotionCurve: z.string().describe("감정선 흐름"),
  hook: z.string().describe("마지막 문단에서 터뜨릴 훅"),
  mustInclude: z.array(z.string()),
  mustAvoid: z.array(z.string()),
});
export type EpisodePlan = z.infer<typeof EpisodePlanSchema>;

/* ────────────────────────────────────────────────────────────
 * 8단계: 다이제스트 (캐논 갱신 입력)
 * ──────────────────────────────────────────────────────────── */
export const DigestSchema = z.object({
  summary: z.string().describe("200자 내외 회차 요약"),
  keyEvents: z.array(z.string()),
  newFacts: z
    .array(
      z.object({
        text: z.string().describe("이번 화로 확정된 사실 한 문장"),
        category: z.string().describe("설정/인물/사건/장소/관계 중 하나"),
        characters: z.array(z.string()).describe("관련 인물명"),
      }),
    )
    .describe("앞으로 절대 어기면 안 되는 확정 사실만"),
  characterUpdates: z.array(
    z.object({
      name: z.string(),
      state: z.string().describe("현재 상태(부상·감정·처지)"),
      location: z.string(),
      knows: z.array(z.string()).describe("이 인물이 새로 알게 된 것"),
    }),
  ),
  foreshadowPlanted: z.array(
    z.object({
      id: z.string().describe("fs-요약키워드 형식의 짧은 식별자"),
      description: z.string(),
      plannedPayoff: z.string().describe("언제/어떻게 회수할 계획"),
    }),
  ),
  foreshadowResolved: z.array(z.string()).describe("회수된 복선 id 목록"),
  endingHook: z.string(),
});
export type Digest = z.infer<typeof DigestSchema>;

/* ────────────────────────────────────────────────────────────
 * 6단계: AI 심사
 * ──────────────────────────────────────────────────────────── */
export const JudgeSchema = z.object({
  scores: z.object({
    immersion: z.number().int().min(1).max(5).describe("몰입도"),
    characterConsistency: z.number().int().min(1).max(5).describe("캐릭터 일관성"),
    prose: z.number().int().min(1).max(5).describe("문장력"),
    hook: z.number().int().min(1).max(5).describe("훅 강도"),
    clarity: z.number().int().min(1).max(5).describe("전달 명료성"),
  }),
  continuityViolations: z
    .array(z.string())
    .describe("설정집·확정 사실과 모순되는 서술. 없으면 빈 배열"),
  issues: z.array(
    z.object({
      severity: z.string().describe("치명/주의/제안 중 하나"),
      where: z.string().describe("문제가 있는 대목 인용 또는 위치"),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
  verdict: z.enum(["pass", "revise"]),
  revisionNotes: z.array(z.string()).describe("퇴고 지시. verdict=pass면 빈 배열"),
});
export type Judge = z.infer<typeof JudgeSchema>;

/* ────────────────────────────────────────────────────────────
 * 연속성 원장
 * ──────────────────────────────────────────────────────────── */
export const CanonFactSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.string(),
  characters: z.array(z.string()),
  episode: z.number().int(),
});
export type CanonFact = z.infer<typeof CanonFactSchema>;
export const CanonSchema = z.object({ facts: z.array(CanonFactSchema) });
export type Canon = z.infer<typeof CanonSchema>;

export const ForeshadowSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      plannedPayoff: z.string(),
      plantedAt: z.number().int(),
      resolvedAt: z.number().int().describe("미회수면 0"),
    }),
  ),
});
export type Foreshadow = z.infer<typeof ForeshadowSchema>;

export const CharacterStateSchema = z.object({
  states: z.array(
    z.object({
      name: z.string(),
      state: z.string(),
      location: z.string(),
      knows: z.array(z.string()),
      updatedAt: z.number().int().describe("마지막 갱신 회차"),
    }),
  ),
});
export type CharacterStates = z.infer<typeof CharacterStateSchema>;

/* ────────────────────────────────────────────────────────────
 * 진행 상태
 * ──────────────────────────────────────────────────────────── */
export const EPISODE_STATUSES = [
  "pending",
  "planned",
  "drafted",
  "revised",
  "final",
  "needs_human",
] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const ProgressSchema = z.object({
  episodes: z.record(
    z.string(),
    z.object({
      status: z.enum(EPISODE_STATUSES),
      revisions: z.number().int().default(0),
      qaVerdict: z.string().default(""),
      charCount: z.number().int().default(0),
      updatedAt: z.string().default(""),
      note: z.string().default(""),
    }),
  ),
});
export type Progress = z.infer<typeof ProgressSchema>;
export type EpisodeProgress = Progress["episodes"][string];

/* ────────────────────────────────────────────────────────────
 * 사용량 / 비용
 * ──────────────────────────────────────────────────────────── */
export type UsageRecord = {
  ts: string;
  stage: StageId;
  profile: string;
  provider: ProviderKind;
  model: string;
  episode: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  pricingKnown: boolean;
  ms: number;
};
