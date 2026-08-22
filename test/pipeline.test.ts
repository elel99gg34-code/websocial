import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "websocial-e2e-"));
const SLUG = "e2e";

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function novel(...args: string[]): string {
  return execFileSync("node", [path.join(ROOT, "src", "cli.ts"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, WEBSOCIAL_PROJECTS_DIR: tmp, NO_COLOR: "1" },
  });
}

const projectPath = (...parts: string[]) => path.join(tmp, SLUG, ...parts);

test("mock 으로 기획부터 내보내기까지 전 구간이 돈다", () => {
  novel(
    "init", SLUG,
    "--idea", "재벌가 망나니가 파산 직전으로 회귀한다",
    "--title", "테스트 작품",
    "--episodes", "3",
    "--chars", "3000",
    "--mode", "mock",
  );
  assert.ok(fs.existsSync(projectPath("project.json")));

  const runOutput = novel("run", SLUG, "--to", "2", "--mock");
  assert.match(runOutput, /1화 확정/);
  assert.match(runOutput, /2화 확정/);

  for (const file of ["concept.json", "bible.json", "outline.json", "canon.json", "progress.json"]) {
    assert.ok(fs.existsSync(projectPath(file)), `${file} 없음`);
  }
  for (const n of ["ep-0001", "ep-0002"]) {
    for (const file of ["plan.json", "draft.md", "qa.json", "final.md", "digest.json"]) {
      assert.ok(fs.existsSync(projectPath("episodes", n, file)), `${n}/${file} 없음`);
    }
  }

  const final = fs.readFileSync(projectPath("episodes", "ep-0001", "final.md"), "utf8");
  assert.ok(final.length > 2600 && final.length < 3400, `분량 ${final.length}자`);

  const qa = JSON.parse(fs.readFileSync(projectPath("episodes", "ep-0001", "qa.json"), "utf8"));
  assert.equal(qa.verdict, "pass");

  novel("export", SLUG, "--format", "txt");
  const exported = fs.readdirSync(projectPath("exports"));
  assert.equal(exported.length, 1);
});

test("이미 확정된 회차는 다시 만들지 않는다 (재개 가능)", () => {
  const before = fs.readFileSync(projectPath("episodes", "ep-0001", "final.md"), "utf8");
  const output = novel("run", SLUG, "--to", "1", "--mock");
  assert.match(output, /이미 확정/);
  assert.equal(fs.readFileSync(projectPath("episodes", "ep-0001", "final.md"), "utf8"), before);
});

test("outline --episodes 는 프로젝트 기본값을 덮어쓴다", () => {
  const slug = "recount";
  novel("init", slug, "--idea", "테스트", "--episodes", "3", "--mode", "mock");
  novel("concept", slug, "--mock");
  novel("bible", slug, "--mock");
  novel("outline", slug, "--mock", "--episodes", "6");
  const outline = JSON.parse(
    fs.readFileSync(path.join(tmp, slug, "outline.json"), "utf8"),
  ) as { episodes: unknown[] };
  assert.equal(outline.episodes.length, 6);
});

test("status 는 진행률과 연속성 원장을 보여준다", () => {
  const output = novel("status", SLUG);
  assert.match(output, /회차 \(2\/3 확정\)/);
  assert.match(output, /확정 사실/);
  assert.match(output, /미회수 복선/);
});

test("회차표에 없는 회차를 쓰려 하면 명확히 실패한다", () => {
  assert.throws(() => novel("write", SLUG, "--ep", "99", "--mock"), /Command failed/);
});

test("키가 없는 제공자를 쓰면 안내와 함께 실패한다", () => {
  const slug = "nokey";
  novel("init", slug, "--idea", "테스트", "--provider", "gemini");
  let output = "";
  try {
    novel("concept", slug);
  } catch (err) {
    output = String((err as { stdout?: string; stderr?: string }).stdout ?? "") +
      String((err as { stderr?: string }).stderr ?? "");
  }
  assert.match(output, /GEMINI_API_KEY/);
});
