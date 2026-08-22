import type { z } from "zod";
import type { ProviderKind } from "../core/types.ts";
import { toStrictJsonSchema } from "./json.ts";
import type {
  GenRequest,
  JsonResult,
  Provider,
  ProseResult,
  ResolvedProfile,
} from "./provider.ts";

/* 결정적 난수 — 같은 입력이면 항상 같은 결과가 나와 테스트가 안정적이다 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(arr: readonly T[], rnd: () => number): T =>
  arr[Math.floor(rnd() * arr.length)] as T;

/* ── 본문 생성용 어휘 풀 ─────────────────────────────────────
 * 조합 수를 크게 잡아 4어절 반복·종결어미 단조로움 검사를 자연스럽게 통과시킨다. */
const ADV = ["천천히", "곧바로", "한참을", "이내", "조용히", "다시", "문득", "가만히"];
const SUBJ = [
  "그는", "서연은", "민준은", "노인은", "여자는", "사내는",
  "비서는", "형사는", "점원은", "기사는", "청년은", "지배인은",
];
const OBJ = [
  "휴대폰을", "봉투를", "문고리를", "커피잔을", "창밖을",
  "계약서를", "손목시계를", "명함을", "리모컨을", "우산을",
];
const VERB = [
  "바라보았다", "내려놓았다", "움켜쥐었다", "확인했다",
  "밀어냈다", "집어 들었다", "돌아보았다", "펼쳤다",
];
/* 대사는 세 조각을 조합해 만든다. 조각이 짧아야 4어절 반복 검사에 걸리지 않는다. */
const D1 = ["지금", "그건", "내가", "당신이", "이제", "우리가", "이번엔", "결국", "아직", "여기서"];
const D2 = ["그렇게", "먼저", "다시", "굳이", "혼자", "끝까지", "조용히", "확실히", "당장", "천천히"];
const D3 = [
  "정하시죠.", "말해보세요.", "확인했습니다.", "물러섭시다.", "설명하시죠.",
  "감당하시겠습니까?", "끝냅시다.", "돌아가시죠.", "결정하세요.", "기다리겠습니다.",
];

const endingOf = (sentence: string): string => sentence.replace(/[.!?]$/, "").slice(-2);

function mockProse(targetChars: number, seed: number): string {
  const rnd = mulberry32(seed);
  const paragraphs: string[] = [];
  const recentEndings: string[] = [];
  let chars = 0;
  let i = 0;

  while (chars < targetChars * 0.99 && paragraphs.length < 400) {
    if (i % 2 === 1) {
      const line = `"${pick(D1, rnd)} ${pick(D2, rnd)} ${pick(D3, rnd)}"`;
      paragraphs.push(line);
      chars += line.length + 1;
    } else {
      const sentences: string[] = [];
      const count = 1 + Math.floor(rnd() * 2);
      for (let s = 0; s < count; s += 1) {
        let sentence = "";
        // 같은 종결어미가 4연속 되지 않도록 회피한다
        for (let attempt = 0; attempt < 8; attempt += 1) {
          sentence = `${pick(ADV, rnd)} ${pick(SUBJ, rnd)} ${pick(OBJ, rnd)} ${pick(VERB, rnd)}.`;
          const ending = endingOf(sentence);
          const monotone =
            recentEndings.length >= 2 && recentEndings.slice(-2).every((e) => e === ending);
          if (!monotone) break;
        }
        recentEndings.push(endingOf(sentence));
        sentences.push(sentence);
      }
      const paragraph = sentences.join(" ");
      paragraphs.push(paragraph);
      chars += paragraph.length + 1;
    }
    i += 1;
  }

  paragraphs.push('"…아직 끝난 게 아니야."');
  paragraphs.push("문이 열렸고, 거기 서 있는 얼굴을 본 순간 모든 계산이 무너졌다.");
  return paragraphs.join("\n\n");
}

/* ── 스키마 기반 가짜 JSON 생성 ───────────────────────────── */
type Node = Record<string, unknown>;

function fakeValue(node: Node, key: string, rnd: () => number, depth: number): unknown {
  const enumValues = node["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];

  const type = node["type"];
  if (type === "object") {
    const props = (node["properties"] ?? {}) as Node;
    const out: Node = {};
    for (const [name, child] of Object.entries(props)) {
      out[name] = fakeValue(child as Node, name, rnd, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    const items = (node["items"] ?? { type: "string" }) as Node;
    const length = key === "beats" ? 5 : 3;
    return Array.from({ length }, (_, i) =>
      fakeValue(items, `${key}-${i + 1}`, rnd, depth + 1),
    );
  }
  if (type === "integer" || type === "number") {
    const max = node["maximum"];
    if (typeof max === "number") return max;
    const min = node["minimum"];
    return typeof min === "number" ? min : 1;
  }
  if (type === "boolean") return true;
  return `[mock] ${key}`;
}

/** 단계별로 의미가 있어야 하는 숫자/식별자를 보정한다 */
function fixup(stage: string, value: unknown, req: GenRequest, episodes: number): unknown {
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Node;

  if (stage === "outline") {
    obj["arcs"] = [
      {
        id: "arc-1",
        title: "[mock] 1부",
        summary: "[mock] 도입 아크",
        fromEpisode: 1,
        toEpisode: episodes,
        climax: "[mock] 아크 절정",
      },
    ];
    obj["episodes"] = Array.from({ length: episodes }, (_, i) => ({
      number: i + 1,
      title: `[mock] ${i + 1}화`,
      arcId: "arc-1",
      goal: `[mock] ${i + 1}화 목표`,
      hook: `[mock] ${i + 1}화 훅`,
      plantForeshadow: i % 2 === 0 ? [`fs-mock-${i + 1}`] : [],
      payoffForeshadow: [],
    }));
  }

  if (stage === "plan") obj["number"] = req.episode;

  if (stage === "qa") {
    obj["verdict"] = "pass";
    obj["continuityViolations"] = [];
    obj["issues"] = [];
    obj["revisionNotes"] = [];
  }

  if (stage === "digest") {
    obj["foreshadowPlanted"] = [
      {
        id: `fs-mock-${req.episode}`,
        description: `[mock] ${req.episode}화에서 심은 복선`,
        plannedPayoff: "[mock] 이후 회차에서 회수",
      },
    ];
    obj["foreshadowResolved"] = [];
  }

  return obj;
}

/** API 호출 없이 파이프라인 전 구간을 돌려보기 위한 제공자 */
export class MockProvider implements Provider {
  readonly kind: ProviderKind = "mock";
  readonly model: string;
  readonly label = "Mock (무과금)";
  readonly free = true;
  readonly #plannedEpisodes: number;

  constructor(resolved: ResolvedProfile, plannedEpisodes: number) {
    this.model = resolved.profile.model;
    this.#plannedEpisodes = plannedEpisodes;
  }

  async prose(req: GenRequest): Promise<ProseResult> {
    const target = req.mockChars ?? 5200;
    const text = mockProse(target, hashString(`${req.stage}:${req.episode}`));
    return {
      text,
      usage: {
        inputTokens: Math.ceil(req.user.length / 3),
        outputTokens: Math.ceil(text.length / 3),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  async json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    _schemaName: string,
  ): Promise<JsonResult<T>> {
    const rnd = mulberry32(hashString(`${req.stage}:${req.episode}`));
    const jsonSchema = toStrictJsonSchema(schema);
    const raw = fakeValue(jsonSchema, req.stage, rnd, 0);
    const fixed = fixup(req.stage, raw, req, this.#plannedEpisodes);
    const parsed = schema.safeParse(fixed);
    if (!parsed.success) {
      throw new Error(
        `mock 생성값이 ${req.stage} 스키마와 맞지 않습니다: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ")}`,
      );
    }
    return {
      value: parsed.data,
      usage: {
        inputTokens: Math.ceil(req.user.length / 3),
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}
