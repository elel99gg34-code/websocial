import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, PRICING } from "../src/llm/pricing.ts";

test("Claude 단가로 입력·출력 비용을 계산한다", () => {
  const { usd, known } = estimateCost({
    model: "claude-opus-5",
    free: false,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(known, true);
  assert.equal(usd, 5);
});

test("캐시 읽기는 입력 단가의 10%, 쓰기는 125% 로 계산한다", () => {
  const rate = PRICING["claude-opus-5"];
  assert.equal(rate?.cacheRead, 0.5);
  assert.equal(rate?.cacheWrite, 6.25);

  const { usd } = estimateCost({
    model: "claude-opus-5",
    free: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
  });
  assert.equal(usd, 0.5);
});

test("무료 제공자는 비용 0 이고 단가를 아는 것으로 본다", () => {
  const { usd, known } = estimateCost({
    model: "gemini-2.5-flash",
    free: true,
    inputTokens: 5_000_000,
    outputTokens: 5_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(usd, 0);
  assert.equal(known, true);
});

test("단가가 등록되지 않은 유료 모델은 0 으로 기록하되 미등록으로 표시한다", () => {
  const { usd, known } = estimateCost({
    model: "무언가-새-모델",
    free: false,
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(usd, 0);
  assert.equal(known, false);
});
