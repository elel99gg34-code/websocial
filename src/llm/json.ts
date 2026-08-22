import { z } from "zod";

/**
 * 모델 응답에서 JSON 본문만 뽑아낸다.
 * 코드펜스, 앞뒤 설명 문장, 문자열 안의 중괄호를 모두 견딘다.
 */
export function extractJson(raw: string): string | null {
  const text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence?.[1]?.trim() ?? text;

  const start = body.search(/[[{]/);
  if (start === -1) return null;

  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

export type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseJsonWithSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): JsonParseResult<T> {
  const block = extractJson(raw);
  if (block === null) {
    return { ok: false, error: "응답에서 JSON 블록을 찾지 못했습니다." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 문법 오류: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n"),
    };
  }
  return { ok: true, value: result.data };
}

type JsonNode = Record<string, unknown>;

const isNode = (v: unknown): v is JsonNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 스키마 노드만 골라 재귀 변환한다.
 * `properties` 컨테이너는 스키마 노드가 아니라 이름→스키마 맵이므로
 * 그 자체를 변환 대상으로 삼으면 속성이 통째로 사라진다.
 */
function transformSchema(node: unknown, fn: (n: JsonNode) => JsonNode): unknown {
  if (!isNode(node)) return node;
  const next = fn({ ...node });

  if (isNode(next["properties"])) {
    const props: JsonNode = {};
    for (const [name, child] of Object.entries(next["properties"])) {
      props[name] = transformSchema(child, fn);
    }
    next["properties"] = props;
  }
  if (isNode(next["items"])) next["items"] = transformSchema(next["items"], fn);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branch = next[key];
    if (Array.isArray(branch)) next[key] = branch.map((b) => transformSchema(b, fn));
  }
  return next;
}

/**
 * OpenAI 호환 `json_schema` (strict) 용 스키마.
 * 모든 object 에 additionalProperties:false 와 전체 required 를 강제한다.
 */
export function toStrictJsonSchema(schema: z.ZodType<unknown>): JsonNode {
  const json = z.toJSONSchema(schema) as JsonNode;
  return transformSchema(json, (node) => {
    delete node["$schema"];
    if (node["type"] === "object" && isNode(node["properties"])) {
      node["additionalProperties"] = false;
      node["required"] = Object.keys(node["properties"]);
    }
    return node;
  }) as JsonNode;
}

/** Gemini responseSchema 는 OpenAPI 부분집합만 받는다. 지원하지 않는 키를 제거한다. */
const GEMINI_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "propertyOrdering",
]);

export function toGeminiSchema(schema: z.ZodType<unknown>): JsonNode {
  return transformSchema(toStrictJsonSchema(schema), (node) => {
    const kept: JsonNode = {};
    for (const [key, value] of Object.entries(node)) {
      if (GEMINI_KEYS.has(key)) kept[key] = value;
    }
    return kept;
  }) as JsonNode;
}

/** JSON 모드를 지원하지 않는 모델용 지시문 */
export function jsonInstruction(schema: z.ZodType<unknown>, name: string): string {
  return [
    `아래 JSON 스키마에 정확히 맞는 JSON 객체 하나만 출력하라. 이름: ${name}`,
    "설명, 인사말, 코드펜스 없이 JSON만 출력한다. 모든 필드는 필수다.",
    "값이 없으면 빈 문자열 또는 빈 배열을 넣되 필드 자체를 빼지 않는다.",
    "```json",
    JSON.stringify(toStrictJsonSchema(schema)),
    "```",
  ].join("\n");
}

/* ────────────────────────────────────────────────────────────
 * 구조화 출력을 네이티브로 보장하지 못하는 제공자용 공통 흐름:
 * 1회 생성 → 스키마 검증 → 실패 시 오류를 돌려주며 1회 교정 요청
 * ──────────────────────────────────────────────────────────── */
import type { RawUsage } from "./provider.ts";
import { UserError } from "../core/log.ts";

export type JsonSender = (
  userText: string,
) => Promise<{ text: string; usage: RawUsage }>;

const sumUsage = (a: RawUsage, b: RawUsage): RawUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export async function runJsonWithRepair<T>(
  send: JsonSender,
  userText: string,
  schema: z.ZodType<T>,
  stage: string,
): Promise<{ value: T; usage: RawUsage }> {
  const first = await send(userText);
  const parsed = parseJsonWithSchema(first.text, schema);
  if (parsed.ok) return { value: parsed.value, usage: first.usage };

  const repairPrompt = [
    userText,
    "",
    "── 직전 응답이 스키마 검증에 실패했다. 아래 오류를 고쳐 JSON만 다시 출력하라. ──",
    "[직전 응답]",
    first.text.slice(0, 4000),
    "",
    "[검증 오류]",
    parsed.error,
  ].join("\n");

  const second = await send(repairPrompt);
  const retried = parseJsonWithSchema(second.text, schema);
  const usage = sumUsage(first.usage, second.usage);
  if (retried.ok) return { value: retried.value, usage };

  throw new UserError(
    `${stage} 단계에서 구조화 출력 검증에 두 번 실패했습니다.`,
    `${retried.error}\n\n더 강한 모델(예: Claude)로 이 단계를 라우팅하거나 프롬프트를 단순화하세요.`,
  );
}
