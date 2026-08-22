import { bibleBlock, seriesBlock, styleBlock } from "../core/context.ts";
import { projectFile } from "../core/paths.ts";
import { readJson, readJsonIf, writeJson } from "../core/store.ts";
import type {
  Bible,
  Concept,
  EpisodeProgress,
  EpisodeStatus,
  Outline,
  Progress,
  Project,
} from "../core/types.ts";
import {
  BibleSchema,
  ConceptSchema,
  OutlineSchema,
  ProgressSchema,
  ProjectSchema,
} from "../core/types.ts";

export const loadProject = (slug: string): Project =>
  readJson(projectFile.project(slug), ProjectSchema);

export const loadConcept = (slug: string): Concept =>
  readJson(projectFile.concept(slug), ConceptSchema);

export const loadBible = (slug: string): Bible =>
  readJson(projectFile.bible(slug), BibleSchema);

export const loadOutline = (slug: string): Outline =>
  readJson(projectFile.outline(slug), OutlineSchema);

export const loadProgress = (slug: string): Progress =>
  readJsonIf(projectFile.progress(slug), ProgressSchema, { episodes: {} });

export function episodeProgress(slug: string, n: number): EpisodeProgress {
  return (
    loadProgress(slug).episodes[String(n)] ?? {
      status: "pending" as EpisodeStatus,
      revisions: 0,
      qaVerdict: "",
      charCount: 0,
      updatedAt: "",
      note: "",
    }
  );
}

export function setEpisodeProgress(
  slug: string,
  n: number,
  patch: Partial<EpisodeProgress>,
): void {
  const progress = loadProgress(slug);
  const current = progress.episodes[String(n)] ?? {
    status: "pending" as EpisodeStatus,
    revisions: 0,
    qaVerdict: "",
    charCount: 0,
    updatedAt: "",
    note: "",
  };
  progress.episodes[String(n)] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(projectFile.progress(slug), progress);
}

/**
 * 모든 회차 호출에서 동일하게 앞에 붙는 system 블록.
 * 이 세 블록이 바이트 단위로 같아야 Anthropic 프롬프트 캐시가 적중한다.
 */
export const baseSystemBlocks = (
  project: Project,
  concept: Concept,
  bible: Bible,
): string[] => [styleBlock(project), seriesBlock(project, concept), bibleBlock(bible)];
