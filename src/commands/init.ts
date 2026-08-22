import { buildLlmConfig, detectMode } from "../core/config.ts";
import type { SetupMode } from "../core/config.ts";
import { log, UserError } from "../core/log.ts";
import { projectFile } from "../core/paths.ts";
import { exists, initProjectDirs, writeJson } from "../core/store.ts";
import { ProjectSchema, QaThresholdsSchema } from "../core/types.ts";
import { findPreset } from "../llm/presets.ts";

export type InitOptions = {
  slug: string;
  title: string;
  idea: string;
  genre: string;
  platform: string;
  targetReader: string;
  episodes: number;
  charTarget: number;
  mode: SetupMode | "auto";
  provider: string;
  model: string;
  force: boolean;
};

const SLUG_RE = /^[a-z0-9가-힣][a-z0-9가-힣._-]*$/i;

export function cmdInit(opts: InitOptions): void {
  if (!SLUG_RE.test(opts.slug)) {
    throw new UserError(
      `프로젝트 슬러그가 올바르지 않습니다: ${opts.slug}`,
      "영문/숫자/한글과 - _ . 만 쓸 수 있습니다.",
    );
  }
  if (exists(projectFile.project(opts.slug)) && !opts.force) {
    throw new UserError(
      `이미 존재하는 프로젝트입니다: ${opts.slug}`,
      "--force 를 주면 project.json 을 덮어씁니다(원고는 보존).",
    );
  }
  if (opts.idea.trim() === "") {
    throw new UserError("--idea 로 한 줄 아이디어를 주세요.");
  }

  const preset = opts.provider === "" ? undefined : findPreset(opts.provider);
  if (opts.provider !== "" && preset === undefined) {
    throw new UserError(
      `알 수 없는 제공자: ${opts.provider}`,
      "`novel providers` 로 목록을 확인하세요.",
    );
  }

  // --mode 를 직접 준 경우가 최우선, 그 다음이 --provider, 마지막이 자동 감지

  const mode: SetupMode = opts.mode !== "auto"
    ? opts.mode
    : preset === undefined
      ? detectMode()
      : preset.kind === "anthropic"
        ? "claude"
        : preset.kind === "mock"
          ? "mock"
          : "free";

  const llm = buildLlmConfig({
    mode,
    ...(preset !== undefined && preset.kind === "anthropic"
      ? { claudeModel: opts.model === "" ? preset.defaultModel : opts.model }
      : {}),
    ...(preset !== undefined && preset.kind !== "anthropic" && preset.kind !== "mock"
      ? { freePreset: preset.id }
      : {}),
    ...(opts.model === "" ? {} : { freeModel: opts.model }),
  });

  const project = ProjectSchema.parse({
    slug: opts.slug,
    title: opts.title === "" ? opts.slug : opts.title,
    idea: opts.idea,
    genre: opts.genre,
    platform: opts.platform,
    targetReader: opts.targetReader,
    plannedEpisodes: opts.episodes,
    createdAt: new Date().toISOString(),
    llm,
    qa: QaThresholdsSchema.parse({ charTarget: opts.charTarget }),
  });

  initProjectDirs(opts.slug);
  writeJson(projectFile.project(opts.slug), project);

  log.ok(`프로젝트 생성: ${project.title} (${opts.slug})`);
  log.info(`구성 모드: ${mode}`);
  for (const [stage, profileName] of Object.entries(project.llm.routes)) {
    const p = project.llm.profiles[profileName];
    log.info(`  ${stage.padEnd(8)} → ${profileName} (${p?.provider ?? "?"}/${p?.model ?? "?"})`);
  }
  log.info("");
  log.info("다음 단계:");
  log.info(`  npm run novel -- concept ${opts.slug}`);
  log.info(`  npm run novel -- bible   ${opts.slug}`);
  log.info(`  npm run novel -- outline ${opts.slug}`);
  log.info(`  npm run novel -- run     ${opts.slug} --to 3`);
}
