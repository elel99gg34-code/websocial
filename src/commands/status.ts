import { z } from "zod";
import { loadCanon, loadForeshadow, unresolvedForeshadow } from "../core/canon.ts";
import { log } from "../core/log.ts";
import { episodeFile, projectFile } from "../core/paths.ts";
import { exists, readJsonl } from "../core/store.ts";
import { loadOutline, loadProgress, loadProject } from "./common.ts";

const UsageRowSchema = z.object({
  stage: z.string(),
  model: z.string(),
  episode: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  costUsd: z.number(),
  pricingKnown: z.boolean(),
});

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  planned: "트리트먼트",
  drafted: "초고",
  revised: "퇴고",
  final: "확정",
  needs_human: "사람 확인 필요",
};

export function cmdStatus(slug: string): void {
  const project = loadProject(slug);
  const progress = loadProgress(slug);

  log.step(`${project.title} (${slug})`);
  log.info(`장르 ${project.genre} / 플랫폼 ${project.platform} / 목표 ${project.plannedEpisodes}화`);
  log.info(
    `단계 라우팅: ${Object.entries(project.llm.routes)
      .map(([stage, name]) => `${stage}=${name}`)
      .join(" ")}`,
  );
  for (const [name, profile] of Object.entries(project.llm.profiles)) {
    log.info(`  프로필 ${name}: ${profile.provider} / ${profile.model}`);
  }

  log.plain("");
  log.step("파이프라인");
  for (const [label, file] of [
    ["기획", projectFile.concept(slug)],
    ["설정집", projectFile.bible(slug)],
    ["회차표", projectFile.outline(slug)],
  ] as const) {
    log.info(`${exists(file) ? "완료" : "미완"}  ${label}`);
  }

  if (exists(projectFile.outline(slug))) {
    const outline = loadOutline(slug);
    const entries = outline.episodes.map((ep) => {
      const state = progress.episodes[String(ep.number)];
      return {
        n: ep.number,
        title: ep.title,
        status: state?.status ?? (exists(episodeFile.final(slug, ep.number)) ? "final" : "pending"),
        chars: state?.charCount ?? 0,
        revisions: state?.revisions ?? 0,
        note: state?.note ?? "",
      };
    });
    const done = entries.filter((e) => e.status === "final").length;
    const blocked = entries.filter((e) => e.status === "needs_human");

    log.plain("");
    log.step(`회차 (${done}/${entries.length} 확정)`);
    for (const e of entries.filter((x) => x.status !== "pending")) {
      log.info(
        `${String(e.n).padStart(3)}화  ${(STATUS_LABEL[e.status] ?? e.status).padEnd(8)}  ${String(e.chars).padStart(5)}자  퇴고 ${e.revisions}회  ${e.title}`,
      );
    }
    if (blocked.length > 0) {
      log.warn(`사람 확인 필요: ${blocked.map((b) => `${b.n}화(${b.note})`).join(", ")}`);
    }
  }

  const canon = loadCanon(slug);
  const foreshadow = loadForeshadow(slug);
  const pending = unresolvedForeshadow(foreshadow);
  log.plain("");
  log.step("연속성");
  log.info(`확정 사실 ${canon.facts.length}건`);
  log.info(`미회수 복선 ${pending.length}건 / 전체 ${foreshadow.items.length}건`);
  for (const item of pending.slice(0, 8)) {
    log.info(`  ${item.id} (${item.plantedAt}화): ${item.description}`);
  }

  const rows = readJsonl(projectFile.usage(slug), UsageRowSchema);
  if (rows.length > 0) {
    const sum = rows.reduce(
      (acc, r) => ({
        input: acc.input + r.inputTokens,
        output: acc.output + r.outputTokens,
        cacheRead: acc.cacheRead + r.cacheReadTokens,
        cost: acc.cost + r.costUsd,
        unknown: acc.unknown || !r.pricingKnown,
      }),
      { input: 0, output: 0, cacheRead: 0, cost: 0, unknown: false },
    );
    const finals = new Set(
      rows.filter((r) => r.stage === "digest").map((r) => r.episode),
    ).size;

    log.plain("");
    log.step("비용");
    log.info(`호출 ${rows.length}회`);
    log.info(
      `입력 ${sum.input.toLocaleString()} / 캐시읽기 ${sum.cacheRead.toLocaleString()} / 출력 ${sum.output.toLocaleString()} 토큰`,
    );
    log.info(`누적 $${sum.cost.toFixed(4)}${sum.unknown ? " (단가 미등록 모델 포함)" : ""}`);
    if (finals > 0) log.info(`확정 회차당 평균 $${(sum.cost / finals).toFixed(4)}`);
  }
}
