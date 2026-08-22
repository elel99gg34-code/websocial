import { pickFreePreset, findPreset } from "../llm/presets.ts";
import { UserError } from "./log.ts";
import type { LlmConfig, Profile, StageId } from "./types.ts";
import { ProfileSchema, STAGES } from "./types.ts";

/** .env 를 있으면 읽는다. 없으면 조용히 넘어간다. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // .env 가 없는 것은 정상
  }
}

export type SetupMode = "claude" | "mixed" | "free" | "mock";

/** 사용 가능한 키를 보고 기본 구성 모드를 고른다. */
export function detectMode(env = process.env): SetupMode {
  const hasClaude = (env["ANTHROPIC_API_KEY"] ?? "").trim() !== "";
  const hasFree = pickFreePreset(env) !== undefined;
  if (hasClaude && hasFree) return "mixed";
  if (hasClaude) return "claude";
  if (hasFree) return "free";
  return "mock";
}

const profile = (
  values: Partial<Profile> & Pick<Profile, "provider" | "model">,
): Profile => ProfileSchema.parse(values);

function freeProfile(presetId: string, model: string): Profile {
  const preset = findPreset(presetId);
  if (preset === undefined) {
    throw new UserError(`알 수 없는 프리셋: ${presetId}`);
  }
  return profile({
    provider: preset.kind,
    preset: preset.id,
    model: model === "" ? preset.defaultModel : model,
    maxOutputTokens: 8000,
  });
}

const CLAUDE = (model: string): Profile =>
  profile({
    provider: "anthropic",
    preset: "anthropic",
    model,
    effort: "high",
    maxOutputTokens: 16000,
  });

/** 기계적인 단계(검수·다이제스트)는 무료 모델로 내려도 품질 손실이 작다 */
const MECHANICAL: StageId[] = ["qa", "digest"];

export type BuildLlmOptions = {
  mode: SetupMode;
  /** free/mixed 모드에서 쓸 프리셋 id. 비우면 자동 선택 */
  freePreset?: string;
  freeModel?: string;
  claudeModel?: string;
};

export function buildLlmConfig(opts: BuildLlmOptions, env = process.env): LlmConfig {
  const claudeModel = opts.claudeModel ?? "claude-opus-5";
  const routes: Record<string, string> = {};

  if (opts.mode === "mock") {
    for (const stage of STAGES) routes[stage] = "mock";
    return {
      profiles: { mock: profile({ provider: "mock", preset: "mock", model: "mock-1" }) },
      routes,
    };
  }

  if (opts.mode === "claude") {
    for (const stage of STAGES) routes[stage] = "quality";
    return { profiles: { quality: CLAUDE(claudeModel) }, routes };
  }

  const presetId = opts.freePreset ?? pickFreePreset(env)?.id;
  if (presetId === undefined) {
    throw new UserError(
      "사용할 수 있는 무료 제공자 키가 없습니다.",
      "GEMINI_API_KEY / GROQ_API_KEY 등을 설정하거나, --provider ollama (로컬) 또는 --mock 을 쓰세요.",
    );
  }
  const free = freeProfile(presetId, opts.freeModel ?? "");

  if (opts.mode === "free") {
    for (const stage of STAGES) routes[stage] = "free";
    return { profiles: { free }, routes };
  }

  // mixed: 창작 품질이 중요한 단계는 Claude, 기계적 단계는 무료
  for (const stage of STAGES) {
    routes[stage] = MECHANICAL.includes(stage) ? "free" : "quality";
  }
  return { profiles: { quality: CLAUDE(claudeModel), free }, routes };
}
