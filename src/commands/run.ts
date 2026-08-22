import { log } from "../core/log.ts";
import { projectFile, episodeFile } from "../core/paths.ts";
import { exists } from "../core/store.ts";
import { BudgetExceededError } from "../llm/engine.ts";
import type { Engine } from "../llm/engine.ts";
import { cmdBible } from "./bible.ts";
import { loadBible, loadConcept, loadOutline, loadProject } from "./common.ts";
import { cmdConcept } from "./concept.ts";
import { cmdOutline } from "./outline.ts";
import type { EpisodeContext, EpisodeOutcome } from "./write.ts";
import { writeEpisode } from "./write.ts";

export type RunOptions = {
  from: number;
  to: number;
  force: boolean;
  /** 검수 미통과 회차가 나와도 계속 진행 */
  keepGoing: boolean;
};

/**
 * 기획부터 원하는 회차까지 한 번에 진행한다.
 * 이미 끝난 단계는 건너뛰므로 중단 후 다시 실행하면 이어서 진행된다.
 */
export async function cmdRun(
  slug: string,
  engine: Engine,
  opts: RunOptions,
): Promise<void> {
  if (!exists(projectFile.concept(slug))) await cmdConcept(slug, engine, false);
  if (!exists(projectFile.bible(slug))) await cmdBible(slug, engine, false);
  if (!exists(projectFile.outline(slug))) await cmdOutline(slug, engine, false);

  const ctx: EpisodeContext = {
    project: loadProject(slug),
    concept: loadConcept(slug),
    bible: loadBible(slug),
    outline: loadOutline(slug),
  };

  const last = Math.min(opts.to, ctx.outline.episodes.length);
  let start = opts.from;
  if (start === 0) {
    start = 1;
    while (start <= last && exists(episodeFile.final(slug, start))) start += 1;
  }

  if (start > last) {
    log.ok(`${last}화까지 이미 확정되어 있습니다.`);
    return;
  }

  log.step(`연재 진행: ${start}화 ~ ${last}화`);
  const outcomes: EpisodeOutcome[] = [];

  for (let n = start; n <= last; n += 1) {
    try {
      const outcome = await writeEpisode(ctx, engine, n, opts.force);
      outcomes.push(outcome);
      if (outcome.status === "needs_human" && !opts.keepGoing) {
        log.warn("사람 확인이 필요해 진행을 멈춥니다. (--keep-going 으로 계속 진행 가능)");
        break;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        log.warn(`${err.message} — ${n}화 진입 전에 중단합니다.`);
        break;
      }
      throw err;
    }
  }

  log.plain("");
  log.step("진행 요약");
  for (const o of outcomes) {
    log.info(
      `${String(o.episode).padStart(3)}화  ${o.status === "final" ? "확정" : "보류"}  ${o.charCount}자  퇴고 ${o.revisions}회`,
    );
  }
  engine.reportSpend();
}
