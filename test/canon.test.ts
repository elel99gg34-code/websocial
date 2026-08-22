import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "websocial-canon-"));
process.env["WEBSOCIAL_PROJECTS_DIR"] = tmp;

const { applyDigest, loadCanon, loadForeshadow, loadStates, relevantFacts, unresolvedForeshadow } =
  await import("../src/core/canon.ts");
const { initProjectDirs } = await import("../src/core/store.ts");
const { DigestSchema } = await import("../src/core/types.ts");

const SLUG = "t";

before(() => {
  initProjectDirs(SLUG);
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const digest = (patch: Record<string, unknown>) =>
  DigestSchema.parse({
    summary: "요약",
    keyEvents: [],
    newFacts: [],
    characterUpdates: [],
    foreshadowPlanted: [],
    foreshadowResolved: [],
    endingHook: "훅",
    ...patch,
  });

test("확정 사실은 출처 회차와 함께 누적되고 중복은 걸러진다", () => {
  applyDigest(SLUG, 1, digest({
    newFacts: [{ text: "민준은 회귀했다", category: "설정", characters: ["민준"] }],
  }));
  applyDigest(SLUG, 2, digest({
    newFacts: [
      { text: "민준은 회귀했다", category: "설정", characters: ["민준"] },
      { text: "서연은 비서다", category: "인물", characters: ["서연"] },
    ],
  }));

  const canon = loadCanon(SLUG);
  assert.equal(canon.facts.length, 2);
  assert.equal(canon.facts[0]?.episode, 1);
  assert.equal(canon.facts[1]?.episode, 2);
});

test("등장인물 기준으로 관련 사실만 추린다", () => {
  const canon = loadCanon(SLUG);
  const picked = relevantFacts(canon, ["서연"], 40);
  assert.ok(picked.some((f) => f.text.includes("서연")));
});

test("복선은 심은 회차와 회수 회차를 기록한다", () => {
  applyDigest(SLUG, 3, digest({
    foreshadowPlanted: [
      { id: "fs-red", description: "붉은 봉투", plannedPayoff: "10화에서 공개" },
    ],
  }));
  assert.equal(unresolvedForeshadow(loadForeshadow(SLUG)).length, 1);

  applyDigest(SLUG, 5, digest({ foreshadowResolved: ["fs-red"] }));
  const resolved = loadForeshadow(SLUG).items.find((i) => i.id === "fs-red");
  assert.equal(resolved?.plantedAt, 3);
  assert.equal(resolved?.resolvedAt, 5);
  assert.equal(unresolvedForeshadow(loadForeshadow(SLUG)).length, 0);
});

test("인물 상태는 덮어쓰되 알게 된 것은 합친다", () => {
  applyDigest(SLUG, 6, digest({
    characterUpdates: [{ name: "민준", state: "부상", location: "병원", knows: ["A"] }],
  }));
  applyDigest(SLUG, 7, digest({
    characterUpdates: [{ name: "민준", state: "회복", location: "본사", knows: ["B"] }],
  }));

  const state = loadStates(SLUG).states.find((s) => s.name === "민준");
  assert.equal(state?.state, "회복");
  assert.equal(state?.location, "본사");
  assert.deepEqual(state?.knows, ["A", "B"]);
  assert.equal(state?.updatedAt, 7);
});
