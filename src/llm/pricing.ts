/**
 * 1M 토큰당 USD 단가. 공식 가격표 기준 (2026-06 스냅샷).
 * 가격이 바뀌면 이 파일만 고치면 된다. 등록되지 않은 모델은 비용 0으로 기록하되
 * pricingKnown=false 로 표시해 status 에서 "단가 미등록"으로 보여준다.
 */
export type Rate = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const anthropicRate = (input: number, output: number): Rate => ({
  input,
  output,
  cacheRead: input * 0.1,
  cacheWrite: input * 1.25,
});

export const PRICING: Record<string, Rate> = {
  "claude-opus-5": anthropicRate(5, 25),
  "claude-opus-4-8": anthropicRate(5, 25),
  "claude-sonnet-5": anthropicRate(3, 15),
  "claude-sonnet-4-6": anthropicRate(3, 15),
  "claude-haiku-4-5": anthropicRate(1, 5),
  "claude-fable-5": anthropicRate(10, 50),
};

const FREE: Rate = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export type CostInput = {
  model: string;
  free: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function estimateCost(u: CostInput): { usd: number; known: boolean } {
  const rate = u.free ? FREE : PRICING[u.model];
  if (rate === undefined) return { usd: 0, known: false };
  const usd =
    (u.inputTokens * rate.input +
      u.outputTokens * rate.output +
      u.cacheReadTokens * rate.cacheRead +
      u.cacheWriteTokens * rate.cacheWrite) /
    1_000_000;
  return { usd, known: true };
}
