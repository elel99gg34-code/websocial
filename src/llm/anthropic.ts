import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { log, UserError } from "../core/log.ts";
import type { ProviderKind } from "../core/types.ts";
import type {
  GenRequest,
  JsonResult,
  Provider,
  ProseResult,
  RawUsage,
  ResolvedProfile,
} from "./provider.ts";
import { withRetry } from "./retry.ts";

/** 정책 거절 시 같은 호출 안에서 대체 모델이 이어받게 하는 서버사이드 폴백 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function toRawUsage(u: AnthropicUsage): RawUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function isFallbackUnsupported(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false;
  return /fallback|beta/i.test(err.message);
}

export class AnthropicProvider implements Provider {
  readonly kind: ProviderKind = "anthropic";
  readonly model: string;
  readonly label: string;
  readonly free = false;

  readonly #client: Anthropic;
  readonly #effort: "low" | "medium" | "high";
  readonly #maxTokens: number;
  #useFallbacks = true;

  constructor(resolved: ResolvedProfile) {
    this.model = resolved.profile.model;
    this.label = `${resolved.label} / ${this.model}`;
    this.#effort = resolved.profile.effort;
    this.#maxTokens = resolved.profile.maxOutputTokens;
    this.#client = new Anthropic({
      ...(resolved.apiKey === "" ? {} : { apiKey: resolved.apiKey }),
      ...(resolved.baseUrl === "" ? {} : { baseURL: resolved.baseUrl }),
      maxRetries: 0, // 재시도는 withRetry 가 담당한다
    });
  }

  /**
   * system 블록 배열을 캐시 경계가 붙은 블록으로 변환.
   * 마지막 블록에만 cache_control 을 달아, 시리즈 내내 동일한 접두부(문체 지침 +
   * 시리즈 요약 + 설정집)가 캐시 적중되게 한다.
   */
  #system(blocks: string[]) {
    const used = blocks.filter((b) => b.trim().length > 0);
    return used.map((text, i) => ({
      type: "text" as const,
      text,
      ...(i === used.length - 1
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    }));
  }

  #betaOptions(): { betas: string[]; fallbacks: "default" } | Record<string, never> {
    return this.#useFallbacks
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {};
  }

  /** 폴백 베타가 허용되지 않은 계정이면 한 번만 폴백 없이 재시도한다. */
  async #callWithFallbackDegrade<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (this.#useFallbacks && isFallbackUnsupported(err)) {
        this.#useFallbacks = false;
        log.warn(
          "서버사이드 폴백(server-side-fallback) 베타를 쓸 수 없어 해당 옵션 없이 재시도합니다.",
        );
        return await fn();
      }
      throw err;
    }
  }

  #assertNotRefused(stopReason: string | null, details: unknown): void {
    if (stopReason !== "refusal") return;
    const category =
      typeof details === "object" && details !== null && "category" in details
        ? String((details as { category: unknown }).category)
        : "unknown";
    throw new UserError(
      `모델이 안전 정책상 이 요청을 거절했습니다 (분류: ${category}).`,
      "설정집/트리트먼트의 폭력·범죄 묘사 수위를 낮추거나, 해당 회차를 사람이 직접 집필하세요.",
    );
  }

  async prose(req: GenRequest): Promise<ProseResult> {
    const message = await withRetry(
      () =>
        this.#callWithFallbackDegrade(() =>
          this.#client.beta.messages
            .stream({
              model: this.model,
              max_tokens: req.maxOutputTokens ?? this.#maxTokens,
              system: this.#system(req.systemBlocks),
              messages: [{ role: "user", content: req.user }],
              thinking: { type: "adaptive" },
              output_config: { effort: this.#effort },
              ...this.#betaOptions(),
            })
            .finalMessage(),
        ),
      { label: `Claude ${req.stage}` },
    );

    this.#assertNotRefused(message.stop_reason, message.stop_details);
    if (message.stop_reason === "max_tokens") {
      log.warn(
        `출력이 max_tokens(${req.maxOutputTokens ?? this.#maxTokens})에서 잘렸습니다. project.json 의 maxOutputTokens 를 늘리세요.`,
      );
    }

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return { text, usage: toRawUsage(message.usage) };
  }

  async json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    _schemaName: string,
  ): Promise<JsonResult<T>> {
    const message = await withRetry(
      () =>
        this.#callWithFallbackDegrade(() =>
          this.#client.beta.messages.parse({
            model: this.model,
            max_tokens: req.maxOutputTokens ?? this.#maxTokens,
            system: this.#system(req.systemBlocks),
            messages: [{ role: "user", content: req.user }],
            thinking: { type: "adaptive" },
            output_config: {
              effort: this.#effort,
              format: betaZodOutputFormat(schema),
            },
            ...this.#betaOptions(),
          }),
        ),
      { label: `Claude ${req.stage}` },
    );

    this.#assertNotRefused(message.stop_reason, message.stop_details);
    const parsed = message.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new UserError(
        `${req.stage} 단계에서 구조화 출력 파싱에 실패했습니다.`,
        message.stop_reason === "max_tokens"
          ? "출력이 max_tokens 에서 잘렸습니다. maxOutputTokens 를 늘리세요."
          : "다시 실행하거나 프롬프트를 단순화하세요.",
      );
    }
    return { value: parsed as T, usage: toRawUsage(message.usage) };
  }
}
