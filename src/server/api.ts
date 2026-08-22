import { loadCanon, loadForeshadow, loadStates } from "../core/canon.ts";
import { UserError } from "../core/log.ts";
import { episodeFile, projectFile } from "../core/paths.ts";
import { exists, listProjects, readJsonIf, readText, writeText } from "../core/store.ts";
import type { Digest, EpisodePlan, Outline } from "../core/types.ts";
import { DigestSchema, EpisodePlanSchema } from "../core/types.ts";
import { cmdBible } from "../commands/bible.ts";
import { loadBible, loadConcept, loadOutline, loadProgress, loadProject } from "../commands/common.ts";
import { cmdConcept } from "../commands/concept.ts";
import { cmdExport } from "../commands/export.ts";
import { cmdInit } from "../commands/init.ts";
import type { InitOptions } from "../commands/init.ts";
import { cmdOutline } from "../commands/outline.ts";
import { cmdRun } from "../commands/run.ts";
import { Engine } from "../llm/engine.ts";
import { PRESETS } from "../llm/presets.ts";
import { QaReportSchema } from "../qa/check.ts";
import type { QaReport } from "../qa/check.ts";

const SLUG_RE = /^[a-z0-9가-힣][a-z0-9가-힣._-]*$/i;

/** 경로 조작을 막는다. 서버는 사용자 입력을 그대로 파일 경로에 쓰지 않는다. */
export function assertSafeSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug.includes("..")) {
    throw new UserError(`올바르지 않은 프로젝트 이름: ${slug}`);
  }
  return slug;
}

export function providerList(): unknown {
  return PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    tier: p.tier,
    defaultModel: p.defaultModel,
    apiKeyEnv: p.apiKeyEnv,
    signupUrl: p.signupUrl,
    note: p.note,
    ready: p.apiKeyEnv === "" || (process.env[p.apiKeyEnv] ?? "").trim() !== "",
  }));
}

export function projectList(): unknown {
  return listProjects().map((slug) => {
    const project = loadProject(slug);
    const progress = loadProgress(slug);
    const episodes = Object.values(progress.episodes);
    return {
      slug,
      title: project.title,
      genre: project.genre,
      plannedEpisodes: project.plannedEpisodes,
      finalCount: episodes.filter((e) => e.status === "final").length,
      needsHuman: episodes.filter((e) => e.status === "needs_human").length,
    };
  });
}

export function projectOverview(slug: string): unknown {
  const project = loadProject(slug);
  const progress = loadProgress(slug);
  const outline: Outline | null = exists(projectFile.outline(slug))
    ? loadOutline(slug)
    : null;

  return {
    project,
    stages: {
      concept: exists(projectFile.concept(slug)),
      bible: exists(projectFile.bible(slug)),
      outline: outline !== null,
    },
    concept: exists(projectFile.concept(slug)) ? loadConcept(slug) : null,
    bible: exists(projectFile.bible(slug)) ? loadBible(slug) : null,
    episodes: (outline?.episodes ?? []).map((ep) => {
      const state = progress.episodes[String(ep.number)];
      return {
        number: ep.number,
        title: ep.title,
        goal: ep.goal,
        hook: ep.hook,
        status: state?.status ?? "pending",
        charCount: state?.charCount ?? 0,
        revisions: state?.revisions ?? 0,
        note: state?.note ?? "",
      };
    }),
    canon: loadCanon(slug).facts,
    foreshadow: loadForeshadow(slug).items,
    characterStates: loadStates(slug).states,
    usage: usageTotals(slug),
  };
}

type UsageRow = {
  stage: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  pricingKnown: boolean;
};

function usageTotals(slug: string): unknown {
  const file = projectFile.usage(slug);
  if (!exists(file)) {
    return { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, pricingKnown: true };
  }
  const rows = readText(file)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line): UsageRow[] => {
      try {
        return [JSON.parse(line) as UsageRow];
      } catch {
        return [];
      }
    });
  return rows.reduce(
    (acc, r) => ({
      calls: acc.calls + 1,
      costUsd: acc.costUsd + (r.costUsd ?? 0),
      inputTokens: acc.inputTokens + (r.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (r.outputTokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (r.cacheReadTokens ?? 0),
      pricingKnown: acc.pricingKnown && r.pricingKnown !== false,
    }),
    { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, pricingKnown: true },
  );
}

export function episodeDetail(slug: string, n: number): unknown {
  const read = (file: string) => (exists(file) ? readText(file) : "");
  return {
    number: n,
    plan: readJsonIf<EpisodePlan | null>(episodeFile.plan(slug, n), EpisodePlanSchema.nullable(), null),
    qa: readJsonIf<QaReport | null>(episodeFile.qa(slug, n), QaReportSchema.nullable(), null),
    digest: readJsonIf<Digest | null>(episodeFile.digest(slug, n), DigestSchema.nullable(), null),
    draft: read(episodeFile.draft(slug, n)),
    final: read(episodeFile.final(slug, n)),
  };
}

/** 사람이 웹에서 직접 고친 원고를 확정본으로 저장한다 */
export function saveFinal(slug: string, n: number, text: string): unknown {
  if (text.trim() === "") throw new UserError("빈 원고는 저장할 수 없습니다.");
  writeText(episodeFile.final(slug, n), `${text.trim()}\n`);
  return { saved: true, charCount: text.trim().length };
}

export type RunRequest = {
  from: number;
  to: number;
  mock: boolean;
  budget: number;
  force: boolean;
  keepGoing: boolean;
};

export function makeRunner(slug: string, req: RunRequest): () => Promise<void> {
  return async () => {
    const engine = new Engine(loadProject(slug), { mock: req.mock, budgetUsd: req.budget });
    await cmdRun(slug, engine, {
      from: req.from,
      to: req.to,
      force: req.force,
      keepGoing: req.keepGoing,
    });
  };
}

export type StageName = "concept" | "bible" | "outline";

export function makeStageRunner(
  slug: string,
  stage: StageName,
  opts: { mock: boolean; force: boolean; episodes: number },
): () => Promise<void> {
  return async () => {
    const engine = new Engine(loadProject(slug), { mock: opts.mock, budgetUsd: 0 });
    if (stage === "concept") await cmdConcept(slug, engine, opts.force);
    else if (stage === "bible") await cmdBible(slug, engine, opts.force);
    else await cmdOutline(slug, engine, opts.force, opts.episodes > 0 ? opts.episodes : undefined);
    engine.reportSpend();
  };
}

export function createProject(body: Partial<InitOptions>): unknown {
  const slug = assertSafeSlug(String(body.slug ?? ""));
  cmdInit({
    slug,
    title: String(body.title ?? ""),
    idea: String(body.idea ?? ""),
    genre: String(body.genre ?? "현대판타지"),
    platform: String(body.platform ?? "문피아"),
    targetReader: String(body.targetReader ?? "20~40대 남성 독자"),
    episodes: Number(body.episodes ?? 30),
    charTarget: Number(body.charTarget ?? 5200),
    mode: (body.mode ?? "auto") as InitOptions["mode"],
    provider: String(body.provider ?? ""),
    model: String(body.model ?? ""),
    force: false,
  });
  return { slug };
}

export function exportProject(slug: string, format: "txt" | "md", split: boolean): unknown {
  cmdExport(slug, { format, from: 1, to: 0, split });
  return { exported: true };
}
