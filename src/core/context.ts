import { episodeFile } from "./paths.ts";
import { renderPrompt } from "./prompt.ts";
import { exists, readJsonIf, readText } from "./store.ts";
import type {
  Bible,
  CanonFact,
  Concept,
  Digest,
  EpisodePlan,
  Foreshadow,
  OutlineEpisode,
  Project,
} from "./types.ts";
import { DigestSchema } from "./types.ts";

const bullet = (items: string[]): string =>
  items.length === 0 ? "(없음)" : items.map((i) => `- ${i}`).join("\n");

/* ── system 블록 ─────────────────────────────────────────────
 * 순서가 곧 프롬프트 캐시 접두부다: 문체 지침 → 시리즈 → 설정집.
 * 세 블록 모두 연재 내내 바이트 단위로 동일해야 캐시가 적중한다. */

export function styleBlock(project: Project): string {
  return renderPrompt("style", {
    genre: project.genre,
    platform: project.platform,
    pov: project.pov,
    tense: project.tense,
    targetReader: project.targetReader,
  });
}

export function seriesBlock(project: Project, concept: Concept): string {
  return renderPrompt("series-block", {
    title: project.title,
    logline: concept.logline,
    coreConflict: concept.coreConflict,
    keywords: concept.keywords.join(", "),
    sellingPoints: bullet(concept.sellingPoints),
    synopsis: concept.synopsis,
    protagonist: [
      `이름: ${concept.protagonist.name} (${concept.protagonist.role})`,
      `표면 욕망: ${concept.protagonist.want}`,
      `진짜 필요: ${concept.protagonist.need}`,
      `결핍: ${concept.protagonist.flaw}`,
      `매력 포인트: ${concept.protagonist.hook}`,
    ].join("\n"),
    antagonist: [
      `이름: ${concept.antagonist.name} (${concept.antagonist.role})`,
      `위협: ${concept.antagonist.threat}`,
      `동기: ${concept.antagonist.motive}`,
    ].join("\n"),
  });
}

export function characterCards(bible: Bible, only: string[] = []): string {
  const filter = new Set(only);
  const chosen =
    only.length === 0
      ? bible.characters
      : bible.characters.filter((c) => filter.has(c.name));
  const list = chosen.length === 0 ? bible.characters : chosen;
  return list
    .map((c) =>
      [
        `### ${c.name}${c.aka === "" ? "" : ` (${c.aka})`} — ${c.role}, ${c.age}`,
        `외모: ${c.appearance}`,
        `성격: ${c.personality}`,
        `말투: ${c.speechStyle}`,
        `배경: ${c.background}`,
        `목표: ${c.goal}`,
        c.secret === "" ? "" : `비밀(미공개): ${c.secret}`,
        c.relations.length === 0 ? "" : `관계: ${c.relations.join(" / ")}`,
      ]
        .filter((l) => l !== "")
        .join("\n"),
    )
    .join("\n\n");
}

export function bibleBlock(bible: Bible): string {
  return renderPrompt("bible-block", {
    world: [
      `배경: ${bible.world.setting}`,
      `사회: ${bible.world.society}`,
      bible.world.powerSystem === "" ? "" : `체계: ${bible.world.powerSystem}`,
      "규칙:",
      bullet(bible.world.rules),
      "작품 시작 이전 사건:",
      bullet(bible.world.timeline),
    ]
      .filter((l) => l !== "")
      .join("\n"),
    characters: characterCards(bible),
    glossary: bullet(bible.glossary.map((g) => `${g.term}: ${g.meaning}`)),
    taboos: bullet(bible.taboos),
  });
}

/** bible/outline 단계 user 프롬프트에 넣는 기획 요약 */
export function conceptBrief(project: Project, concept: Concept): string {
  return [
    `제목: ${project.title}`,
    `장르: ${project.genre} / 플랫폼: ${project.platform}`,
    `로그라인: ${concept.logline}`,
    `핵심 갈등: ${concept.coreConflict}`,
    `주인공: ${concept.protagonist.name} — 원하는 것 ${concept.protagonist.want} / 진짜 필요한 것 ${concept.protagonist.need}`,
    `적대자: ${concept.antagonist.name} — ${concept.antagonist.threat}`,
    `키워드: ${concept.keywords.join(", ")}`,
    "",
    "시놉시스:",
    concept.synopsis,
  ].join("\n");
}

/* ── 회차별 가변 컨텍스트 ─────────────────────────────────── */

export const formatCanon = (facts: CanonFact[]): string =>
  facts.length === 0
    ? "(아직 확정된 사실 없음)"
    : facts.map((f) => `- [${f.episode}화·${f.category}] ${f.text}`).join("\n");

export const formatForeshadow = (items: Foreshadow["items"]): string =>
  items.length === 0
    ? "(미회수 복선 없음)"
    : items
        .map(
          (i) =>
            `- ${i.id} (${i.plantedAt}화에 심음): ${i.description} → 회수 계획: ${i.plannedPayoff}`,
        )
        .join("\n");

export const formatOutlineEpisode = (ep: OutlineEpisode): string =>
  [
    `제목: ${ep.title}`,
    `목표: ${ep.goal}`,
    `훅: ${ep.hook}`,
    `심을 복선: ${ep.plantForeshadow.join(", ") || "(없음)"}`,
    `회수할 복선: ${ep.payoffForeshadow.join(", ") || "(없음)"}`,
  ].join("\n");

export const formatPlan = (plan: EpisodePlan): string =>
  [
    `제목: ${plan.title}`,
    `로그라인: ${plan.logline}`,
    `시점: ${plan.pov} / 장소: ${plan.place}`,
    `등장인물: ${plan.charactersOnStage.join(", ")}`,
    `감정선: ${plan.emotionCurve}`,
    "비트:",
    plan.beats.map((b, i) => `  ${i + 1}. ${b.beat} (목적: ${b.purpose})`).join("\n"),
    `훅: ${plan.hook}`,
    `반드시 포함: ${plan.mustInclude.join(" / ") || "(없음)"}`,
    `절대 금지: ${plan.mustAvoid.join(" / ") || "(없음)"}`,
  ].join("\n");

/** 직전 K회 요약. 회차가 늘어도 주입량이 일정하게 유지된다. */
export function recentSummaries(slug: string, upto: number, k = 3): string {
  const lines: string[] = [];
  for (let n = Math.max(1, upto - k); n < upto; n += 1) {
    const digest = readJsonIf<Digest | null>(
      episodeFile.digest(slug, n),
      DigestSchema.nullable(),
      null,
    );
    if (digest !== null) lines.push(`- ${n}화: ${digest.summary}`);
  }
  return lines.length === 0 ? "(첫 회차)" : lines.join("\n");
}

/** 직전 회차 마지막 대목 — 문체와 장면 연결용 앵커 */
export function previousTail(slug: string, upto: number, chars = 400): string {
  const prev = upto - 1;
  if (prev < 1) return "(첫 회차라 이어받을 대목 없음)";
  const file = episodeFile.final(slug, prev);
  if (!exists(file)) return "(직전 회차 확정 원고 없음)";
  const text = readText(file).trim();
  return text.length <= chars ? text : `...${text.slice(-chars)}`;
}
