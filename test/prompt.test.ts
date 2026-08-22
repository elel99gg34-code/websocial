import assert from "node:assert/strict";
import { test } from "node:test";
import { UserError } from "../src/core/log.ts";
import { renderPrompt } from "../src/core/prompt.ts";
import { ProjectSchema } from "../src/core/types.ts";
import { buildLlmConfig } from "../src/core/config.ts";
import { styleBlock } from "../src/core/context.ts";

test("템플릿 변수를 채운다", () => {
  const text = renderPrompt("style", {
    genre: "무협",
    platform: "문피아",
    pov: "1인칭",
    tense: "과거",
    targetReader: "테스트 독자",
  });
  assert.ok(text.includes("무협"));
  assert.ok(text.includes("테스트 독자"));
  assert.ok(!text.includes("{{"));
});

test("변수가 빠지면 조용히 넘기지 않고 실패한다", () => {
  assert.throws(
    () => renderPrompt("style", { genre: "무협" }),
    (err: unknown) => err instanceof UserError && err.hint.includes("platform"),
  );
});

test("없는 템플릿은 UserError 로 알린다", () => {
  assert.throws(() => renderPrompt("no-such-template", {}), UserError);
});

test("문체 블록은 프로젝트 설정을 그대로 반영한다", () => {
  const project = ProjectSchema.parse({
    slug: "t",
    title: "제목",
    idea: "아이디어",
    genre: "로맨스판타지",
    createdAt: new Date().toISOString(),
    llm: buildLlmConfig({ mode: "mock" }),
    qa: {},
  });
  assert.ok(styleBlock(project).includes("로맨스판타지"));
});
