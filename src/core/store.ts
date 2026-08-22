import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { UserError } from "./log.ts";
import { projectsDir, projectDir, projectFile, episodeDir } from "./paths.ts";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

export function readText(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

export function writeJson(file: string, value: unknown): void {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

const rel = (file: string) => path.relative(process.cwd(), file);

/** 저장된 JSON을 스키마로 검증하며 읽는다. 손상된 파일을 조용히 통과시키지 않는다. */
export function readJson<T>(file: string, schema: z.ZodType<T>): T {
  if (!exists(file)) {
    throw new UserError(`파일이 없습니다: ${rel(file)}`, "선행 단계를 먼저 실행하세요.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readText(file));
  } catch (err) {
    throw new UserError(
      `JSON 파싱 실패: ${rel(file)}`,
      err instanceof Error ? err.message : String(err),
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new UserError(
      `파일 형식이 스키마와 맞지 않습니다: ${rel(file)}`,
      parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n"),
    );
  }
  return parsed.data;
}

export function readJsonIf<T>(file: string, schema: z.ZodType<T>, fallback: T): T {
  return exists(file) ? readJson(file, schema) : fallback;
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(file: string, schema: z.ZodType<T>): T[] {
  if (!exists(file)) return [];
  return readText(file)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = schema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
}

export function listProjects(): string[] {
  const root = projectsDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(projectFile.project(e.name)))
    .map((e) => e.name)
    .sort();
}

export function requireProject(slug: string): void {
  if (!exists(projectFile.project(slug))) {
    const known = listProjects();
    throw new UserError(
      `프로젝트를 찾을 수 없습니다: ${slug}`,
      known.length > 0
        ? `사용 가능한 프로젝트: ${known.join(", ")}`
        : "먼저 `novel init <슬러그>` 로 프로젝트를 만드세요.",
    );
  }
}

export function initProjectDirs(slug: string): void {
  ensureDir(projectDir(slug));
  ensureDir(path.join(projectDir(slug), "episodes"));
  ensureDir(path.join(projectDir(slug), "runs"));
  ensureDir(projectFile.exports(slug));
}

export function initEpisodeDir(slug: string, n: number): void {
  ensureDir(episodeDir(slug, n));
}
