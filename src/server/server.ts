import http from "node:http";
import path from "node:path";
import { log, UserError } from "../core/log.ts";
import { ROOT } from "../core/paths.ts";
import { exists, readText, requireProject } from "../core/store.ts";
import {
  assertSafeSlug,
  createProject,
  episodeDetail,
  exportProject,
  makeRunner,
  makeStageRunner,
  projectList,
  projectOverview,
  providerList,
  saveFinal,
} from "./api.ts";
import type { StageName } from "./api.ts";
import { JobManager } from "./jobs.ts";

const MAX_BODY = 2 * 1024 * 1024;

type Json = Record<string, unknown>;

async function readBody(req: http.IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new UserError("요청 본문이 너무 큽니다.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
  } catch {
    throw new UserError("본문 JSON 을 해석할 수 없습니다.");
  }
}

const send = (res: http.ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
};

const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;
const int = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export function startServer(port: number, host = "127.0.0.1"): Promise<ServerHandle> {
  const jobs = new JobManager();
  const indexPath = path.join(ROOT, "web", "index.html");

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (err instanceof UserError) {
        send(res, 400, { error: err.message, hint: err.hint });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        send(res, 500, { error: message, hint: "" });
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const parts = url.pathname.split("/").filter((p) => p !== "");
    const method = req.method ?? "GET";

    if (parts[0] === "favicon.ico") {
      res.writeHead(204).end();
      return;
    }

    // 정적 페이지
    if (parts.length === 0 || parts[0] === "index.html") {
      if (!exists(indexPath)) {
        send(res, 500, { error: "web/index.html 을 찾을 수 없습니다.", hint: "" });
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readText(indexPath));
      return;
    }

    if (parts[0] !== "api") {
      send(res, 404, { error: "없는 경로입니다.", hint: "" });
      return;
    }

    // /api/providers
    if (parts[1] === "providers" && method === "GET") {
      send(res, 200, providerList());
      return;
    }

    // /api/jobs/...
    if (parts[1] === "jobs") {
      const id = parts[2] ?? "";
      const job = id === "current" ? jobs.running : jobs.get(id);
      if (job === undefined) {
        send(res, 200, { job: null });
        return;
      }
      const from = int(url.searchParams.get("from"), 0);
      send(res, 200, {
        job: {
          id: job.id,
          slug: job.slug,
          label: job.label,
          status: job.status,
          error: job.error,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          total: job.lines.length,
          lines: job.lines.slice(from),
        },
      });
      return;
    }

    if (parts[1] !== "projects") {
      send(res, 404, { error: "없는 경로입니다.", hint: "" });
      return;
    }

    // /api/projects
    if (parts.length === 2) {
      if (method === "GET") {
        send(res, 200, projectList());
        return;
      }
      if (method === "POST") {
        send(res, 200, createProject(await readBody(req)));
        return;
      }
    }

    const slug = assertSafeSlug(decodeURIComponent(parts[2] ?? ""));
    requireProject(slug);

    // /api/projects/:slug
    if (parts.length === 3 && method === "GET") {
      send(res, 200, projectOverview(slug));
      return;
    }

    // /api/projects/:slug/stage
    if (parts[3] === "stage" && method === "POST") {
      const body = await readBody(req);
      const stage = String(body["stage"] ?? "") as StageName;
      if (!["concept", "bible", "outline"].includes(stage)) {
        throw new UserError(`알 수 없는 단계: ${stage}`);
      }
      const job = jobs.start(
        slug,
        `${slug} · ${stage}`,
        makeStageRunner(slug, stage, {
          mock: bool(body["mock"]),
          force: bool(body["force"]),
          episodes: int(body["episodes"], 0),
        }),
      );
      send(res, 200, { jobId: job.id });
      return;
    }

    // /api/projects/:slug/run
    if (parts[3] === "run" && method === "POST") {
      const body = await readBody(req);
      const to = int(body["to"], 1);
      const job = jobs.start(
        slug,
        `${slug} · ${to}화까지 연재`,
        makeRunner(slug, {
          from: int(body["from"], 0),
          to: Math.max(1, to),
          mock: bool(body["mock"]),
          budget: Number(body["budget"] ?? 0) || 0,
          force: bool(body["force"]),
          keepGoing: bool(body["keepGoing"]),
        }),
      );
      send(res, 200, { jobId: job.id });
      return;
    }

    // /api/projects/:slug/export
    if (parts[3] === "export" && method === "POST") {
      const body = await readBody(req);
      const format = body["format"] === "md" ? "md" : "txt";
      send(res, 200, exportProject(slug, format, bool(body["split"])));
      return;
    }

    // /api/projects/:slug/episodes/:n
    if (parts[3] === "episodes" && parts.length === 5) {
      const n = int(parts[4], 0);
      if (n < 1) throw new UserError("회차 번호가 올바르지 않습니다.");
      if (method === "GET") {
        send(res, 200, episodeDetail(slug, n));
        return;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        send(res, 200, saveFinal(slug, n, String(body["text"] ?? "")));
        return;
      }
    }

    send(res, 404, { error: "없는 경로입니다.", hint: "" });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        url: `http://${host}:${actual}`,
        port: actual,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

export async function serve(port: number): Promise<void> {
  const handle = await startServer(port);
  log.step(`웹 UI 실행 중 — ${handle.url}`);
  log.info("브라우저에서 위 주소를 여세요. 종료하려면 Ctrl+C.");
  log.info("이 서버는 127.0.0.1 에만 바인딩되며 인증이 없습니다. 외부에 노출하지 마세요.");
}
