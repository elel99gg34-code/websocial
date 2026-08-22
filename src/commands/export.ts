import path from "node:path";
import { log, UserError } from "../core/log.ts";
import { episodeFile, projectFile } from "../core/paths.ts";
import { exists, readText, writeText } from "../core/store.ts";
import { loadOutline, loadProject } from "./common.ts";

export type ExportOptions = {
  format: "txt" | "md";
  from: number;
  to: number;
  /** 회차별 파일로 나눠 저장 */
  split: boolean;
};

export function cmdExport(slug: string, opts: ExportOptions): void {
  const project = loadProject(slug);
  const outline = loadOutline(slug);

  const chapters = outline.episodes
    .filter((ep) => ep.number >= opts.from && (opts.to === 0 || ep.number <= opts.to))
    .filter((ep) => exists(episodeFile.final(slug, ep.number)))
    .map((ep) => ({
      number: ep.number,
      title: ep.title,
      text: readText(episodeFile.final(slug, ep.number)).trim(),
    }));

  if (chapters.length === 0) {
    throw new UserError(
      "내보낼 확정 원고가 없습니다.",
      `먼저 novel run ${slug} --to <회차> 를 실행하세요.`,
    );
  }

  const dir = projectFile.exports(slug);
  const heading = (n: number, title: string) =>
    opts.format === "md" ? `## ${n}화 ${title}` : `${n}화 ${title}`;

  if (opts.split) {
    for (const ch of chapters) {
      const file = path.join(
        dir,
        `${String(ch.number).padStart(4, "0")}.${opts.format}`,
      );
      writeText(file, `${heading(ch.number, ch.title)}\n\n${ch.text}\n`);
    }
    log.ok(`${chapters.length}개 회차 파일 저장: ${dir}`);
    return;
  }

  const header =
    opts.format === "md"
      ? `# ${project.title}\n\n> ${project.genre} · ${project.platform}\n`
      : `${project.title}\n\n`;
  const body = chapters
    .map((ch) => `${heading(ch.number, ch.title)}\n\n${ch.text}`)
    .join("\n\n\n");
  const file = path.join(
    dir,
    `${slug}-${chapters[0]?.number ?? 1}-${chapters.at(-1)?.number ?? 1}.${opts.format}`,
  );
  writeText(file, `${header}\n${body}\n`);

  const totalChars = chapters.reduce((sum, ch) => sum + ch.text.length, 0);
  log.ok(`${chapters.length}화 / ${totalChars.toLocaleString()}자 → ${file}`);
}
