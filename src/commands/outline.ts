import { conceptBrief, styleBlock } from "../core/context.ts";
import { log, UserError } from "../core/log.ts";
import { projectFile } from "../core/paths.ts";
import { renderPrompt } from "../core/prompt.ts";
import { exists, writeJson } from "../core/store.ts";
import { OutlineSchema } from "../core/types.ts";
import type { Engine } from "../llm/engine.ts";
import { loadBible, loadConcept, loadProject } from "./common.ts";
import { bibleBlock } from "../core/context.ts";

export async function cmdOutline(
  slug: string,
  engine: Engine,
  force: boolean,
  episodes?: number,
): Promise<void> {
  const file = projectFile.outline(slug);
  if (exists(file) && !force) {
    log.ok("회차표가 이미 있습니다 (--force 로 재생성).");
    return;
  }
  const project = loadProject(slug);
  const concept = loadConcept(slug);
  const bible = loadBible(slug);
  const count = episodes ?? project.plannedEpisodes;
  log.step(`회차표 생성 (${count}화) — ${engine.describeRoute("outline")}`);

  const outline = await engine.json(
    {
      stage: "outline",
      episode: 0,
      mockCount: count,
      systemBlocks: [styleBlock(project), bibleBlock(bible)],
      user: renderPrompt("outline", {
        conceptBrief: conceptBrief(project, concept),
        episodes: String(count),
      }),
    },
    OutlineSchema,
    "outline",
  );

  const numbers = outline.episodes.map((e) => e.number);
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => !numbers.includes(n),
  );
  if (missing.length > 0) {
    throw new UserError(
      `회차표에 빠진 회차가 있습니다: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""}`,
      "다시 실행하거나 더 강한 모델로 outline 단계를 라우팅하세요.",
    );
  }

  writeJson(file, outline);
  log.ok(`회차표 저장: 아크 ${outline.arcs.length}개 / ${outline.episodes.length}화`);
}
