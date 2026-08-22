import type { z } from "zod";
import { UserError } from "../core/log.ts";
import type { Profile, ProviderKind, StageId } from "../core/types.ts";
import { findPreset } from "./presets.ts";

export type RawUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const emptyUsage = (): RawUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export type GenRequest = {
  stage: StageId;
  /** 회차 무관 단계는 0 */
  episode: number;
  /**
   * system 블록. 앞쪽일수록 안정적인 내용(문체 지침 → 시리즈 요약 → 설정집)이어야 하며
   * Anthropic 경로에서는 마지막 블록에 캐시 경계가 붙는다.
   */
  systemBlocks: string[];
  user: string;
  maxOutputTokens?: number;
  /** mock 제공자만 사용하는 힌트 */
  mockChars?: number;
  mockCount?: number;
};

export type ProseResult = { text: string; usage: RawUsage };
export type JsonResult<T> = { value: T; usage: RawUsage };

export interface Provider {
  readonly kind: ProviderKind;
  readonly model: string;
  readonly label: string;
  readonly free: boolean;
  prose(req: GenRequest): Promise<ProseResult>;
  json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    schemaName: string,
  ): Promise<JsonResult<T>>;
}

export type ResolvedProfile = {
  name: string;
  profile: Profile;
  baseUrl: string;
  apiKey: string;
  free: boolean;
  label: string;
};

/** 프로필 + 프리셋 + 환경변수를 합쳐 실제 접속 정보를 만든다. */
export function resolveProfile(
  name: string,
  profile: Profile,
  env = process.env,
): ResolvedProfile {
  const preset = profile.preset === "" ? undefined : findPreset(profile.preset);
  if (profile.preset !== "" && preset === undefined) {
    throw new UserError(
      `알 수 없는 제공자 프리셋: ${profile.preset}`,
      "`novel providers` 로 사용 가능한 프리셋을 확인하세요.",
    );
  }

  const baseUrl = profile.baseUrl !== "" ? profile.baseUrl : (preset?.baseUrl ?? "");
  const apiKeyEnv =
    profile.apiKeyEnv !== "" ? profile.apiKeyEnv : (preset?.apiKeyEnv ?? "");
  const apiKey = apiKeyEnv === "" ? "" : (env[apiKeyEnv] ?? "").trim();

  if (profile.provider !== "mock" && apiKeyEnv !== "" && apiKey === "") {
    throw new UserError(
      `API 키가 없습니다: ${apiKeyEnv} (프로필 "${name}")`,
      preset === undefined
        ? `${apiKeyEnv} 환경변수를 설정하거나 --mock 으로 실행하세요.`
        : `${preset.signupUrl} 에서 발급 후 ${apiKeyEnv} 를 설정하거나, --mock 으로 실행하세요.`,
    );
  }

  const tier = preset?.tier ?? "paid";
  return {
    name,
    profile,
    baseUrl,
    apiKey,
    free: tier === "free" || tier === "local" || tier === "freemium",
    label: preset?.label ?? profile.provider,
  };
}
