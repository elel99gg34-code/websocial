import type { z } from "zod";
import type { ProviderKind } from "../core/types.ts";
import {
  jsonInstruction,
  runJsonWithRepair,
  toStrictJsonSchema,
} from "./json.ts";
import type {
  GenRequest,
  JsonResult,
  Provider,
  ProseResult,
  RawUsage,
  ResolvedProfile,
} from "./provider.ts";
import { HttpError, retryAfterMs, withRetry } from "./retry.ts";

type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** JSON 강제 방식. 제공자마다 지원 범위가 달라 단계적으로 낮춘다. */
type JsonMode = "json_schema" | "json_object" | "prompt";

/**
 * OpenAI 호환 `/chat/completions` 어댑터.
 * Groq · OpenRouter · Cerebras · Mistral · DeepSeek · Ollama · LM Studio 등을 모두 커버한다.
 */
export class OpenAiCompatProvider implements Provider {
  readonly kind: ProviderKind = "openai-compat";
  readonly model: string;
  readonly label: string;
  readonly free: boolean;

  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #maxTokens: number;
  #jsonMode: JsonMode = "json_schema";

  constructor(resolved: ResolvedProfile) {
    this.model = resolved.profile.model;
    this.label = `${resolved.label} / ${this.model}`;
    this.free = resolved.free;
    this.#baseUrl = resolved.baseUrl.replace(/\/+$/, "");
    this.#apiKey = resolved.apiKey;
    this.#maxTokens = resolved.profile.maxOutputTokens;
  }

  async #post(body: Record<string, unknown>, label: string): Promise<ChatResponse> {
    return withRetry(async () => {
      const res = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#apiKey === "" ? {} : { authorization: `Bearer ${this.#apiKey}` }),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new HttpError(res.status, await res.text(), retryAfterMs(res.headers));
      }
      return (await res.json()) as ChatResponse;
    }, { label });
  }

  #extract(res: ChatResponse): { text: string; usage: RawUsage } {
    return {
      text: (res.choices?.[0]?.message?.content ?? "").trim(),
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  #body(req: GenRequest, user: string): Record<string, unknown> {
    const system = req.systemBlocks.filter((b) => b.trim().length > 0).join("\n\n");
    return {
      model: this.model,
      max_tokens: req.maxOutputTokens ?? this.#maxTokens,
      messages: [
        ...(system === "" ? [] : [{ role: "system", content: system }]),
        { role: "user", content: user },
      ],
    };
  }

  async prose(req: GenRequest): Promise<ProseResult> {
    const res = await this.#post(this.#body(req, req.user), `${this.label} ${req.stage}`);
    return this.#extract(res);
  }

  async json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    schemaName: string,
  ): Promise<JsonResult<T>> {
    const label = `${this.label} ${req.stage}`;

    const send = async (userText: string) => {
      // 지원 수준을 모르므로 json_schema → json_object → 프롬프트 순으로 낮춰 간다.
      for (;;) {
        const mode = this.#jsonMode;
        // json_object 모드는 프롬프트에 JSON 지시가 있어야 하는 제공자가 많다
        const content =
          mode === "json_schema"
            ? userText
            : `${userText}\n\n${jsonInstruction(schema, schemaName)}`;
        const body = this.#body(req, content);
        if (mode === "json_schema") {
          body["response_format"] = {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema: toStrictJsonSchema(schema),
            },
          };
        } else if (mode === "json_object") {
          body["response_format"] = { type: "json_object" };
        }

        try {
          return this.#extract(await this.#post(body, label));
        } catch (err) {
          const downgrade =
            err instanceof HttpError && err.status === 400 && mode !== "prompt";
          if (!downgrade) throw err;
          this.#jsonMode = mode === "json_schema" ? "json_object" : "prompt";
        }
      }
    };

    return runJsonWithRepair(send, req.user, schema, req.stage);
  }
}
