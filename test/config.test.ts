import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLlmConfig, detectMode } from "../src/core/config.ts";
import { STAGES } from "../src/core/types.ts";
import { availablePresets, pickFreePreset } from "../src/llm/presets.ts";

test("키가 없으면 mock, Claude 만 있으면 claude, 둘 다 있으면 mixed", () => {
  assert.equal(detectMode({}), "mock");
  assert.equal(detectMode({ ANTHROPIC_API_KEY: "x" }), "claude");
  assert.equal(detectMode({ GEMINI_API_KEY: "x" }), "free");
  assert.equal(detectMode({ ANTHROPIC_API_KEY: "x", GROQ_API_KEY: "y" }), "mixed");
});

test("mixed 는 집필을 Claude 로, 검수/다이제스트를 무료로 보낸다", () => {
  const cfg = buildLlmConfig({ mode: "mixed", freePreset: "gemini" });
  assert.equal(cfg.routes["draft"], "quality");
  assert.equal(cfg.routes["outline"], "quality");
  assert.equal(cfg.routes["qa"], "free");
  assert.equal(cfg.routes["digest"], "free");
  assert.equal(cfg.profiles["quality"]?.model, "claude-opus-5");
  assert.equal(cfg.profiles["free"]?.provider, "gemini");
});

test("모든 단계에 라우팅이 빠짐없이 생성된다", () => {
  for (const mode of ["claude", "free", "mock"] as const) {
    const cfg = buildLlmConfig({ mode, freePreset: "groq" });
    for (const stage of STAGES) {
      assert.ok(cfg.routes[stage] !== undefined, `${mode}/${stage} 라우팅 없음`);
      assert.ok(cfg.profiles[cfg.routes[stage] as string] !== undefined);
    }
  }
});

test("키가 설정된 프리셋만 사용 가능으로 본다", () => {
  const ids = availablePresets({ GROQ_API_KEY: "x" }).map((p) => p.id);
  assert.ok(ids.includes("groq"));
  assert.ok(ids.includes("ollama")); // 로컬은 키 불필요
  assert.ok(!ids.includes("anthropic"));
  assert.equal(pickFreePreset({ GROQ_API_KEY: "x" })?.id, "groq");
  assert.equal(pickFreePreset({}), undefined);
});
