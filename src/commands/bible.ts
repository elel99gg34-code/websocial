import { conceptBrief, styleBlock } from "../core/context.ts";
import { log } from "../core/log.ts";
import { projectFile } from "../core/paths.ts";
import { renderPrompt } from "../core/prompt.ts";
import { exists, writeJson } from "../core/store.ts";
import { BibleSchema } from "../core/types.ts";
import type { Engine } from "../llm/engine.ts";
import { loadConcept, loadProject } from "./common.ts";

export async function cmdBible(
  slug: string,
  engine: Engine,
  force: boolean,
): Promise<void> {
  const file = projectFile.bible(slug);
  if (exists(file) && !force) {
    log.ok("설정집이 이미 있습니다 (--force 로 재생성).");
    return;
  }
  const project = loadProject(slug);
  const concept = loadConcept(slug);
  log.step(`설정집 생성 — ${engine.describeRoute("bible")}`);

  const bible = await engine.json(
    {
      stage: "bible",
      episode: 0,
      systemBlocks: [styleBlock(project)],
      user: renderPrompt("bible", {
        conceptBrief: conceptBrief(project, concept),
        plannedEpisodes: String(project.plannedEpisodes),
      }),
    },
    BibleSchema,
    "bible",
  );

  writeJson(file, bible);
  log.ok(
    `설정집 저장: 인물 ${bible.characters.length}명, 규칙 ${bible.world.rules.length}개, 용어 ${bible.glossary.length}개`,
  );
}
