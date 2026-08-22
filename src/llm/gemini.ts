import type { z } from "zod";
import { UserError } from "../core/log.ts";
import type { ProviderKind } from "../core/types.ts";
import { runJsonWithRepair, toGeminiSchema } from "./json.ts";
import type {
  GenRequest,
  JsonResult,
  Provider,
  ProseResult,
  RawUsage,
  ResolvedProfile,
} from "./provider.ts";
import { HttpError, retryAfterMs, withRetry } from "./retry.ts";

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

/** Google Gemini (AI Studio 무료 티어) 어댑터 */
export class GeminiProvider implements Provider {
  readonly kind: ProviderKind = "gemini";
  readonly model: string;
  readonly label: string;
  readonly free: boolean;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #maxTokens: number;

  constructor(resolved: ResolvedProfile) {
    this.model = resolved.profile.model;
    this.label = `${resolved.label} / ${this.model}`;
    this.free = resolved.free;
    this.#baseUrl = resolved.baseUrl.replace(/\/+$/, "");
    this.#apiKey = resolved.apiKey;
    this.#maxTokens = resolved.profile.maxOutputTokens;
  }

  async #generate(
    req: GenRequest,
    user: string,
    generationConfig: Record<string, unknown>,
  ): Promise<{ text: string; usage: RawUsage }> {
    const system = req.systemBlocks.filter((b) => b.trim().length > 0).join("\n\n");
    const body = {
      ...(system === "" ? {} : { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens ?? this.#maxTokens,
        ...generationConfig,
      },
    };

    const res = await withRetry(async () => {
      const response = await fetch(
        `${this.#baseUrl}/models/${this.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.#apiKey,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new HttpError(
          response.status,
          await response.text(),
          retryAfterMs(response.headers),
        );
      }
      return (await response.json()) as GeminiResponse;
    }, { label: `${this.label} ${req.stage}` });

    if (res.promptFeedback?.blockReason !== undefined) {
      throw new UserError(
        `Gemini 가 요청을 차단했습니다 (${res.promptFeedback.blockReason}).`,
        "묘사 수위를 낮추거나 다른 제공자로 이 단계를 라우팅하세요.",
      );
    }

    const candidate = res.candidates?.[0];
    const finish = candidate?.finishReason ?? "";
    if (finish === "SAFETY" || finish === "RECITATION" || finish === "PROHIBITED_CONTENT") {
      throw new UserError(
        `Gemini 가 생성을 중단했습니다 (${finish}).`,
        "해당 회차 소재의 수위를 조정하거나 다른 제공자를 쓰세요.",
      );
    }

    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    return {
      text,
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
        cacheReadTokens: res.usageMetadata?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      },
    };
  }

  async prose(req: GenRequest): Promise<ProseResult> {
    return this.#generate(req, req.user, {});
  }

  async json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    _schemaName: string,
  ): Promise<JsonResult<T>> {
    const config = {
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema),
    };
    return runJsonWithRepair(
      (userText) => this.#generate(req, userText, config),
      req.user,
      schema,
      req.stage,
    );
  }
}
