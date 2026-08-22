import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  extractJson,
  jsonInstruction,
  parseJsonWithSchema,
  toGeminiSchema,
  toStrictJsonSchema,
} from "../src/llm/json.ts";

test("코드펜스와 앞뒤 설명을 걷어내고 JSON 만 뽑는다", () => {
  const raw = '알겠습니다.\n```json\n{"a": 1}\n```\n이상입니다.';
  assert.equal(extractJson(raw), '{"a": 1}');
});

test("문자열 안의 중괄호에 속지 않는다", () => {
  const raw = '{"a": "닫는 } 괄호", "b": {"c": 2}}';
  assert.equal(extractJson(raw), raw);
});

test("이스케이프된 따옴표를 처리한다", () => {
  const raw = '{"a": "그는 \\"안녕\\" 이라 했다"}';
  assert.equal(extractJson(raw), raw);
});

test("JSON 이 없으면 null 을 돌려준다", () => {
  assert.equal(extractJson("죄송하지만 답할 수 없습니다."), null);
});

test("스키마 검증 실패를 오류 메시지로 돌려준다", () => {
  const schema = z.object({ n: z.number() });
  const ok = parseJsonWithSchema('{"n": 3}', schema);
  assert.equal(ok.ok && ok.value.n, 3);
  const bad = parseJsonWithSchema('{"n": "셋"}', schema);
  assert.equal(bad.ok, false);
});

test("strict JSON 스키마는 additionalProperties 와 required 를 강제한다", () => {
  const schema = z.object({ a: z.string(), b: z.object({ c: z.string() }) });
  const json = toStrictJsonSchema(schema) as Record<string, unknown>;
  assert.equal(json["additionalProperties"], false);
  assert.deepEqual(json["required"], ["a", "b"]);
  assert.equal(json["$schema"], undefined);
  const nested = (json["properties"] as Record<string, Record<string, unknown>>)["b"];
  assert.equal(nested?.["additionalProperties"], false);
});

test("Gemini 스키마는 지원하지 않는 키를 제거한다", () => {
  const schema = z.object({ score: z.number().int().min(1).max(5) });
  const json = toGeminiSchema(schema) as Record<string, unknown>;
  assert.equal(json["additionalProperties"], undefined);
  const score = (json["properties"] as Record<string, Record<string, unknown>>)["score"];
  assert.equal(score?.["minimum"], undefined);
  assert.equal(score?.["type"], "integer");
});

test("JSON 모드 미지원 모델용 지시문에 스키마가 들어간다", () => {
  const text = jsonInstruction(z.object({ a: z.string() }), "sample");
  assert.ok(text.includes("sample"));
  assert.ok(text.includes('"a"'));
});
