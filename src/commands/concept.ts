import { renderPrompt } from "../core/prompt.ts";
import { log } from "../core/log.ts";
import { projectFile } from "../core/paths.ts";
import { exists, writeJson } from "../core/store.ts";
import { ConceptSchema } from "../core/types.ts";
import type { Engine } from "../llm/engine.ts";
import { loadProject } from "./common.ts";
import { styleBlock } from "../core/context.ts";

export async function cmdConcept(
  slug: string,
  engine: Engine,
  force: boolean,
): Promise<void> {
  const file = projectFile.concept(slug);
  if (exists(file) && !force) {
    log.ok("기획이 이미 있습니다 (--force 로 재생성).");
    return;
  }
  const project = loadProject(slug);
  log.step(`기획 생성 — ${engine.describeRoute("concept")}`);

  const concept = await engine.json(
    {
      stage: "concept",
      episode: 0,
      systemBlocks: [styleBlock(project)],
      user: renderPrompt("concept", {
        title: project.title,
        idea: project.idea,
        genre: project.genre,
        platform: project.platform,
        targetReader: project.targetReader,
        plannedEpisodes: String(project.plannedEpisodes),
      }),
    },
    ConceptSchema,
    "concept",
  );

  writeJson(file, concept);
  log.ok(`기획 저장: ${concept.logline}`);
}
