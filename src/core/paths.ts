import path from "node:path";
import { fileURLToPath } from "node:url";

/** 저장소 루트 (src/core/paths.ts 기준 2단계 위) */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const PROMPTS_DIR = path.join(ROOT, "prompts");
/**
 * 프로젝트 저장 위치. 상수가 아니라 함수인 이유는 테스트가
 * WEBSOCIAL_PROJECTS_DIR 로 임시 디렉터리를 지정할 수 있게 하기 위해서다.
 */
export function projectsDir(): string {
  return process.env["WEBSOCIAL_PROJECTS_DIR"] ?? path.join(ROOT, "projects");
}

export function projectDir(slug: string): string {
  return path.join(projectsDir(), slug);
}

export function episodeDir(slug: string, n: number): string {
  return path.join(projectDir(slug), "episodes", `ep-${String(n).padStart(4, "0")}`);
}

export const projectFile = {
  project: (s: string) => path.join(projectDir(s), "project.json"),
  concept: (s: string) => path.join(projectDir(s), "concept.json"),
  bible: (s: string) => path.join(projectDir(s), "bible.json"),
  outline: (s: string) => path.join(projectDir(s), "outline.json"),
  canon: (s: string) => path.join(projectDir(s), "canon.json"),
  foreshadow: (s: string) => path.join(projectDir(s), "foreshadow.json"),
  characterStates: (s: string) => path.join(projectDir(s), "characters-state.json"),
  progress: (s: string) => path.join(projectDir(s), "progress.json"),
  usage: (s: string) => path.join(projectDir(s), "runs", "usage.jsonl"),
  exports: (s: string) => path.join(projectDir(s), "exports"),
};

export const episodeFile = {
  plan: (s: string, n: number) => path.join(episodeDir(s, n), "plan.json"),
  draft: (s: string, n: number) => path.join(episodeDir(s, n), "draft.md"),
  qa: (s: string, n: number) => path.join(episodeDir(s, n), "qa.json"),
  final: (s: string, n: number) => path.join(episodeDir(s, n), "final.md"),
  digest: (s: string, n: number) => path.join(episodeDir(s, n), "digest.json"),
};

/** 퇴고 이력 파일 (rev-1.md, rev-2.md ...) */
export function revisionFile(slug: string, n: number, revision: number): string {
  return path.join(episodeDir(slug, n), `rev-${revision}.md`);
}
