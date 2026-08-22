import { applyDigest, loadCanon, loadForeshadow, relevantFacts, unresolvedForeshadow } from "../core/canon.ts";
import {
  formatCanon,
  formatForeshadow,
  formatOutlineEpisode,
  formatPlan,
  previousTail,
  recentSummaries,
} from "../core/context.ts";
import { log, UserError } from "../core/log.ts";
import { episodeFile, revisionFile } from "../core/paths.ts";
import { renderPrompt } from "../core/prompt.ts";
import { exists, initEpisodeDir, readJson, readText, writeJson, writeText } from "../core/store.ts";
import type { Bible, Concept, Digest, EpisodePlan, Outline, Project } from "../core/types.ts";
import { DigestSchema, EpisodePlanSchema, JudgeSchema } from "../core/types.ts";
import type { Engine } from "../llm/engine.ts";
import { buildQaReport, summarizeQa } from "../qa/check.ts";
import type { QaReport } from "../qa/check.ts";
import { analyzeDraft } from "../qa/metrics.ts";
import { baseSystemBlocks, episodeProgress, setEpisodeProgress } from "./common.ts";

export type EpisodeContext = {
  project: Project;
  concept: Concept;
  bible: Bible;
  outline: Outline;
};

const outlineEpisodeOf = (outline: Outline, n: number) => {
  const found = outline.episodes.find((e) => e.number === n);
  if (found === undefined) {
    throw new UserError(
      `회차표에 ${n}화가 없습니다.`,
      `회차표는 ${outline.episodes.length}화까지 있습니다. novel outline --force --episodes <수> 로 늘리세요.`,
    );
  }
  return found;
};

const charBounds = (ctx: EpisodeContext) => {
  const { charTarget, charTolerance } = ctx.project.qa;
  return {
    target: charTarget,
    min: Math.round(charTarget * (1 - charTolerance)),
    max: Math.round(charTarget * (1 + charTolerance)),
  };
};

const knownNames = (bible: Bible): string[] => [
  ...bible.characters.flatMap((c) => [c.name, c.aka]),
  ...bible.glossary.map((g) => g.term),
];

/* ── 4단계: 트리트먼트 ─────────────────────────────────────── */
export async function planEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  force: boolean,
): Promise<EpisodePlan> {
  const slug = ctx.project.slug;
  const file = episodeFile.plan(slug, n);
  if (exists(file) && !force) return readJson(file, EpisodePlanSchema);

  initEpisodeDir(slug, n);
  const outlineEpisode = outlineEpisodeOf(ctx.outline, n);
  const canon = loadCanon(slug);
  const foreshadow = loadForeshadow(slug);

  log.step(`${n}화 트리트먼트 — ${engine.describeRoute("plan")}`);
  const plan = await engine.json(
    {
      stage: "plan",
      episode: n,
      systemBlocks: baseSystemBlocks(ctx.project, ctx.concept, ctx.bible),
      user: renderPrompt("episode-plan", {
        number: String(n),
        outlineEpisode: formatOutlineEpisode(outlineEpisode),
        recent: recentSummaries(slug, n),
        canon: formatCanon(relevantFacts(canon, [])),
        foreshadow: formatForeshadow(unresolvedForeshadow(foreshadow)),
        charTarget: String(ctx.project.qa.charTarget),
      }),
    },
    EpisodePlanSchema,
    "episode_plan",
  );

  const normalized: EpisodePlan = { ...plan, number: n };
  writeJson(file, normalized);
  setEpisodeProgress(slug, n, { status: "planned" });
  log.ok(`트리트먼트 저장: ${normalized.title} (비트 ${normalized.beats.length}개)`);
  return normalized;
}

/* ── 5단계: 집필 ───────────────────────────────────────────── */
export async function draftEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  plan: EpisodePlan,
  force: boolean,
): Promise<string> {
  const slug = ctx.project.slug;
  const file = episodeFile.draft(slug, n);
  if (exists(file) && !force) return readText(file);

  const bounds = charBounds(ctx);
  const canon = loadCanon(slug);
  const foreshadow = loadForeshadow(slug);

  log.step(`${n}화 집필 — ${engine.describeRoute("draft")}`);
  const text = await engine.prose({
    stage: "draft",
    episode: n,
    systemBlocks: baseSystemBlocks(ctx.project, ctx.concept, ctx.bible),
    mockChars: bounds.target,
    user: renderPrompt("episode-draft", {
      number: String(n),
      plan: formatPlan(plan),
      prevTail: previousTail(slug, n),
      recent: recentSummaries(slug, n),
      canon: formatCanon(relevantFacts(canon, plan.charactersOnStage)),
      foreshadow: formatForeshadow(unresolvedForeshadow(foreshadow)),
      charTarget: String(bounds.target),
      charMin: String(bounds.min),
      charMax: String(bounds.max),
      hook: plan.hook,
    }),
  });

  writeText(file, `${text.trim()}\n`);
  setEpisodeProgress(slug, n, { status: "drafted", charCount: text.length });
  log.ok(`초고 저장: ${text.length}자`);
  return text;
}

/* ── 6단계: 검수 ───────────────────────────────────────────── */
export async function qaEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  plan: EpisodePlan,
  text: string,
): Promise<QaReport> {
  const slug = ctx.project.slug;
  const metrics = analyzeDraft(text, ctx.project.qa, knownNames(ctx.bible));
  const canon = loadCanon(slug);

  let judge = null;
  if (ctx.project.qa.useAiJudge) {
    log.step(`${n}화 검수 — ${engine.describeRoute("qa")}`);
    judge = await engine.json(
      {
        stage: "qa",
        episode: n,
        systemBlocks: baseSystemBlocks(ctx.project, ctx.concept, ctx.bible),
        user: renderPrompt("episode-qa", {
          number: String(n),
          plan: formatPlan(plan),
          canon: formatCanon(relevantFacts(canon, plan.charactersOnStage)),
          draft: text,
        }),
      },
      JudgeSchema,
      "episode_judge",
    );
  } else {
    log.step(`${n}화 검수 — 규칙 기반만 (AI 심사 비활성)`);
  }

  const report = buildQaReport(n, metrics, judge);
  writeJson(episodeFile.qa(slug, n), report);
  for (const line of summarizeQa(report)) log.info(line);
  if (report.verdict === "pass") log.ok("검수 통과");
  else log.warn(`검수 실패: ${report.reasons.slice(0, 3).join(" / ")}`);
  return report;
}

/* ── 7단계: 퇴고 ───────────────────────────────────────────── */
export async function reviseEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  text: string,
  report: QaReport,
  revision: number,
): Promise<string> {
  const slug = ctx.project.slug;
  const bounds = charBounds(ctx);
  const canon = loadCanon(slug);
  const failed = report.metrics.filter((m) => !m.ok && m.level !== "info");

  log.step(`${n}화 퇴고 ${revision}차 — ${engine.describeRoute("revise")}`);
  const revised = await engine.prose({
    stage: "revise",
    episode: n,
    systemBlocks: baseSystemBlocks(ctx.project, ctx.concept, ctx.bible),
    mockChars: bounds.target,
    user: renderPrompt("episode-revise", {
      number: String(n),
      draft: text,
      notes:
        report.revisionNotes.length === 0
          ? "(자동 검사 지적 사항만 반영)"
          : report.revisionNotes.map((x) => `- ${x}`).join("\n"),
      metrics:
        failed.length === 0
          ? "(없음)"
          : failed.map((m) => `- ${m.label}: ${m.value} ${m.detail}`).join("\n"),
      canon: formatCanon(relevantFacts(canon, [])),
      charMin: String(bounds.min),
      charMax: String(bounds.max),
    }),
  });

  writeText(revisionFile(slug, n, revision), `${revised.trim()}\n`);
  writeText(episodeFile.draft(slug, n), `${revised.trim()}\n`);
  setEpisodeProgress(slug, n, {
    status: "revised",
    revisions: revision,
    charCount: revised.length,
  });
  log.ok(`퇴고본 저장: ${revised.length}자`);
  return revised;
}

/* ── 8단계: 다이제스트 + 캐논 갱신 ─────────────────────────── */
export async function digestEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  force: boolean,
): Promise<Digest> {
  const slug = ctx.project.slug;
  const file = episodeFile.digest(slug, n);
  if (exists(file) && !force) return readJson(file, DigestSchema);

  const finalText = readText(episodeFile.final(slug, n));
  log.step(`${n}화 다이제스트 — ${engine.describeRoute("digest")}`);

  const digest = await engine.json(
    {
      stage: "digest",
      episode: n,
      systemBlocks: baseSystemBlocks(ctx.project, ctx.concept, ctx.bible),
      user: renderPrompt("episode-digest", {
        number: String(n),
        final: finalText,
      }),
    },
    DigestSchema,
    "episode_digest",
  );

  writeJson(file, digest);
  applyDigest(slug, n, digest);
  log.ok(`캐논 갱신: 새 사실 ${digest.newFacts.length}건, 복선 +${digest.foreshadowPlanted.length}/-${digest.foreshadowResolved.length}`);
  return digest;
}

/* ── 회차 하나를 끝까지 ────────────────────────────────────── */
export type EpisodeOutcome = {
  episode: number;
  status: "final" | "needs_human";
  revisions: number;
  charCount: number;
};

export async function writeEpisode(
  ctx: EpisodeContext,
  engine: Engine,
  n: number,
  force: boolean,
): Promise<EpisodeOutcome> {
  const slug = ctx.project.slug;

  if (exists(episodeFile.final(slug, n)) && !force) {
    log.ok(`${n}화는 이미 확정되어 있습니다 (--force 로 재작업).`);
    if (!exists(episodeFile.digest(slug, n))) await digestEpisode(ctx, engine, n, false);
    const progress = episodeProgress(slug, n);
    return {
      episode: n,
      status: "final",
      revisions: progress.revisions,
      charCount: progress.charCount,
    };
  }

  const plan = await planEpisode(ctx, engine, n, force);
  let text = await draftEpisode(ctx, engine, n, plan, force);
  let report = await qaEpisode(ctx, engine, n, plan, text);
  let revisions = 0;

  while (report.verdict === "revise" && revisions < ctx.project.qa.maxRevisions) {
    revisions += 1;
    text = await reviseEpisode(ctx, engine, n, text, report, revisions);
    report = await qaEpisode(ctx, engine, n, plan, text);
  }

  if (report.verdict === "revise") {
    setEpisodeProgress(slug, n, {
      status: "needs_human",
      revisions,
      qaVerdict: "revise",
      charCount: text.length,
      note: report.reasons.slice(0, 3).join(" / "),
    });
    log.warn(
      `${n}화는 자동 퇴고 ${revisions}회 후에도 기준을 넘지 못했습니다. 사람이 봐야 합니다.`,
    );
    log.info(`원고: ${episodeFile.draft(slug, n)}`);
    log.info(`검수: ${episodeFile.qa(slug, n)}`);
    return { episode: n, status: "needs_human", revisions, charCount: text.length };
  }

  writeText(episodeFile.final(slug, n), `${text.trim()}\n`);
  setEpisodeProgress(slug, n, {
    status: "final",
    revisions,
    qaVerdict: "pass",
    charCount: text.length,
    note: "",
  });
  await digestEpisode(ctx, engine, n, force);
  log.ok(`${n}화 확정 (${text.length}자, 퇴고 ${revisions}회)`);
  return { episode: n, status: "final", revisions, charCount: text.length };
}
