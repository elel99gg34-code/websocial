import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "websocial-server-"));
process.env["WEBSOCIAL_PROJECTS_DIR"] = tmp;

const { startServer } = await import("../src/server/server.ts");
type Handle = Awaited<ReturnType<typeof startServer>>;

let server: Handle;
let base = "";

before(async () => {
  server = await startServer(0);
  base = server.url;
});
after(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(path: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  return { status: res.status, body: await res.json() };
}

const post = (path: string, body: unknown) =>
  call(path, { method: "POST", body: JSON.stringify(body) });

async function waitForJob(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const { body } = await call("/api/jobs/current");
    if (body.job === null || body.job.status !== "running") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("작업이 끝나지 않았습니다");
}

test("페이지와 제공자 목록을 서빙한다", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /websocial/);

  const { body } = await call("/api/providers");
  assert.ok(Array.isArray(body));
  assert.ok(body.some((p: { id: string }) => p.id === "anthropic"));
  assert.ok(body.some((p: { id: string; ready: boolean }) => p.id === "ollama" && p.ready));
});

test("작품을 만들고 mock 으로 2화까지 연재한다", async () => {
  const created = await post("/api/projects", {
    slug: "웹작", title: "웹 테스트", idea: "회귀물 아이디어",
    episodes: 3, charTarget: 3000, mode: "mock",
  });
  assert.equal(created.status, 200);

  const started = await post("/api/projects/%EC%9B%B9%EC%9E%91/run", { to: 2, mock: true });
  assert.equal(started.status, 200);
  assert.ok(String(started.body.jobId).startsWith("job-"));

  await waitForJob();

  const { body } = await call("/api/projects/%EC%9B%B9%EC%9E%91");
  assert.equal(body.stages.outline, true);
  assert.equal(body.episodes.filter((e: { status: string }) => e.status === "final").length, 2);
  assert.ok(body.canon.length > 0);
  assert.ok(body.usage.calls > 0);
});

test("회차 상세를 읽고 사람이 고친 원고를 저장한다", async () => {
  const detail = await call("/api/projects/%EC%9B%B9%EC%9E%91/episodes/1");
  assert.equal(detail.status, 200);
  assert.ok(detail.body.plan !== null);
  assert.equal(detail.body.qa.verdict, "pass");
  assert.ok(detail.body.final.length > 1000);

  const saved = await call("/api/projects/%EC%9B%B9%EC%9E%91/episodes/1", {
    method: "PUT",
    body: JSON.stringify({ text: "사람이 직접 고친 원고." }),
  });
  assert.equal(saved.body.saved, true);

  const after = await call("/api/projects/%EC%9B%B9%EC%9E%91/episodes/1");
  assert.equal(after.body.final.trim(), "사람이 직접 고친 원고.");
});

test("빈 원고 저장과 경로 조작은 거부한다", async () => {
  const empty = await call("/api/projects/%EC%9B%B9%EC%9E%91/episodes/1", {
    method: "PUT",
    body: JSON.stringify({ text: "   " }),
  });
  assert.equal(empty.status, 400);

  const traversal = await call("/api/projects/..%2F..%2Fetc");
  assert.equal(traversal.status, 400);

  const missing = await call("/api/projects/없는작품");
  assert.equal(missing.status, 400);
});
