import assert from "node:assert/strict";
import { test } from "node:test";
import { QaThresholdsSchema } from "../src/core/types.ts";
import {
  analyzeDraft,
  dialogueRatio,
  longestEndingRun,
  properNounCandidates,
  repeatedPhrases,
  splitParagraphs,
  splitSentences,
} from "../src/qa/metrics.ts";

const qa = QaThresholdsSchema.parse({ charTarget: 100, charTolerance: 0.2 });

test("문단과 문장을 빈 줄 기준으로 나눈다", () => {
  const text = "첫 문단이다. 두 번째 문장.\n\n둘째 문단이다.";
  assert.equal(splitParagraphs(text).length, 2);
  assert.equal(splitSentences(text).length, 3);
});

test("대사 비율은 따옴표 안 글자 기준으로 센다", () => {
  assert.equal(dialogueRatio('"안녕"'), 1);
  assert.equal(dialogueRatio("지문만 있다."), 0);
  const mixed = dialogueRatio('"네개다" 네글자다');
  assert.ok(mixed > 0.4 && mixed < 0.6, `실제 ${mixed}`);
});

test("같은 종결어미 연속 횟수를 센다", () => {
  const run = longestEndingRun([
    "그는 갔다.",
    "그녀도 갔다.",
    "나도 갔다.",
    "너는 왔지.",
  ]);
  assert.equal(run.run, 3);
  assert.equal(run.ending, "갔다");
});

test("4어절 반복구를 잡아낸다", () => {
  const counts = repeatedPhrases("가 나 다 라 마 가 나 다 라");
  assert.equal(counts.get("가 나 다 라"), 2);
});

test("고유명사 후보는 주격 조사를 동반한 미등록 이름만 잡는다", () => {
  const text = [
    "서연은 문을 열었다. 서연은 웃었다. 서연은 돌아섰다.",
    "민준을 불렀다. 민준을 봤다. 민준을 지나쳤다.", // 목적격만 → 제외
    "리모컨을 들었다. 리모컨을 놓았다. 리모컨을 던졌다.",
  ].join("\n");
  const found = properNounCandidates(text, []);
  assert.ok(found.some((f) => f.startsWith("서연")), `실제: ${found.join(",")}`);
  assert.ok(!found.some((f) => f.startsWith("민준")), `실제: ${found.join(",")}`);
  assert.ok(!found.some((f) => f.startsWith("리모컨")), `실제: ${found.join(",")}`);
});

test("설정집에 등록된 이름은 후보에서 제외한다", () => {
  const text = "서연은 갔다. 서연은 왔다. 서연은 섰다.";
  assert.deepEqual(properNounCandidates(text, ["서연"]), []);
});

test("어절 중간을 잘라 오탐하지 않는다", () => {
  // "내일까지였을" 에서 "일까지였" 을 뽑아내면 안 된다
  const text = "내일까지였을 텐데. 내일까지였을 텐데. 내일까지였을 텐데.";
  assert.deepEqual(properNounCandidates(text, []), []);
});

test("분량 미달은 error, 대사 비율 이탈은 warn 으로 분류한다", () => {
  const report = analyzeDraft("짧다.", qa);
  assert.ok(report.errors.some((m) => m.id === "charCount"));
  assert.ok(report.warnings.some((m) => m.id === "dialogueRatio"));
});

test("금칙어와 메타 텍스트는 하드 게이트다", () => {
  const body = `${"가나다라마바사아. ".repeat(6)}묘한 이질감이 들었다. 제 3 화`;
  const report = analyzeDraft(body, qa);
  assert.ok(report.errors.some((m) => m.id === "bannedPhrases"));
  assert.ok(report.errors.some((m) => m.id === "metaText"));
});
