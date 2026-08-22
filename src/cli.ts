#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadDotEnv } from "./core/config.ts";
import { log, UserError } from "./core/log.ts";
import { episodeFile } from "./core/paths.ts";
import { readJson, readText, requireProject } from "./core/store.ts";
import type { SetupMode } from "./core/config.ts";
import { EpisodePlanSchema } from "./core/types.ts";
import { Engine } from "./llm/engine.ts";
import { QaReportSchema } from "./qa/check.ts";
import { cmdBible } from "./commands/bible.ts";
import {
  episodeProgress,
  loadBible,
  loadConcept,
  loadOutline,
  loadProject,
} from "./commands/common.ts";
import { cmdConcept } from "./commands/concept.ts";
import { cmdExport } from "./commands/export.ts";
import { cmdInit } from "./commands/init.ts";
import { cmdOutline } from "./commands/outline.ts";
import { cmdProviders } from "./commands/providers.ts";
import { cmdRun } from "./commands/run.ts";
import { cmdStatus } from "./commands/status.ts";
import { serve } from "./server/server.ts";
import type { EpisodeContext } from "./commands/write.ts";
import { qaEpisode, reviseEpisode, writeEpisode } from "./commands/write.ts";

const HELP = `
자동화 웹소설 집필 파이프라인

사용법: novel <명령> [슬러그] [옵션]

명령
  init <슬러그>      프로젝트 생성      --idea "한 줄 아이디어" (필수)
  concept <슬러그>   기획 생성
  bible <슬러그>     설정집 생성
  outline <슬러그>   회차표 생성        --episodes <수>
  write <슬러그>     한 회차 집필       --ep <회차>
  qa <슬러그>        한 회차 검수       --ep <회차>
  revise <슬러그>    한 회차 퇴고       --ep <회차>
  run <슬러그>       기획~연재 자동 진행 --to <회차> [--from <회차>]
  status <슬러그>    진행/비용 현황
  serve              브라우저 UI 를 localhost 에 띄운다  --port <포트>
  export <슬러그>    원고 내보내기      --format txt|md [--split]
  providers          제공자 목록과 키 감지 상태

serve 옵션
  --port <포트>      기본 4173. 127.0.0.1 에만 바인딩된다

공통 옵션
  --mock             API 호출 없이 구조만 검증 (무과금)
  --budget <USD>     이번 실행 누적 비용 상한. 초과 직전에 멈춘다
  --force            이미 만들어진 산출물을 다시 만든다
  --help             이 도움말

init 옵션
  --title <제목>  --genre <장르>  --platform <플랫폼>  --reader <독자층>
  --episodes <수> --chars <회차 글자수>
  --mode auto|claude|mixed|free|mock    (기본 auto: 감지된 키로 결정)
  --provider <프리셋 id>   --model <모델명>

예시
  novel init 회귀한-망나니 --idea "재벌가 망나니가 파산 직전으로 회귀한다" --mode mixed
  novel run 회귀한-망나니 --to 10 --budget 20
  novel export 회귀한-망나니 --format txt
  novel serve                          # http://127.0.0.1:4173
`;

const options = {
  help: { type: "boolean", short: "h", default: false },
  mock: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  "keep-going": { type: "boolean", default: false },
  split: { type: "boolean", default: false },
  budget: { type: "string", default: "0" },
  ep: { type: "string", default: "0" },
  from: { type: "string", default: "0" },
  to: { type: "string", default: "0" },
  episodes: { type: "string", default: "" },
  chars: { type: "string", default: "5200" },
  title: { type: "string", default: "" },
  idea: { type: "string", default: "" },
  genre: { type: "string", default: "현대판타지" },
  platform: { type: "string", default: "문피아" },
  reader: { type: "string", default: "20~40대 남성 독자" },
  mode: { type: "string", default: "auto" },
  provider: { type: "string", default: "" },
  model: { type: "string", default: "" },
  format: { type: "string", default: "txt" },
  port: { type: "string", default: "4173" },
} as const;

const MODES = new Set(["auto", "claude", "mixed", "free", "mock"]);

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireEpisode(value: string): number {
  const n = Math.trunc(num(value));
  if (n < 1) throw new UserError("--ep <회차> 를 1 이상으로 지정하세요.");
  return n;
}

function loadContext(slug: string): EpisodeContext {
  return {
    project: loadProject(slug),
    concept: loadConcept(slug),
    bible: loadBible(slug),
    outline: loadOutline(slug),
  };
}

async function main(): Promise<void> {
  loadDotEnv();
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options,
    allowPositionals: true,
  });

  const command = positionals[0] ?? "";
  if (values.help || command === "" || command === "help") {
    log.plain(HELP.trim());
    return;
  }
  if (command === "providers") {
    cmdProviders();
    return;
  }
  if (command === "serve") {
    await serve(Math.trunc(num(values.port, 4173)));
    return;
  }

  const slug = positionals[1] ?? "";
  if (slug === "") throw new UserError(`프로젝트 슬러그가 필요합니다: novel ${command} <슬러그>`);

  if (command === "init") {
    if (!MODES.has(values.mode)) {
      throw new UserError(`--mode 값이 올바르지 않습니다: ${values.mode}`, "auto|claude|mixed|free|mock");
    }
    cmdInit({
      slug,
      title: values.title,
      idea: values.idea,
      genre: values.genre,
      platform: values.platform,
      targetReader: values.reader,
      episodes: Math.max(1, Math.trunc(num(values.episodes, 30))),
      charTarget: Math.max(500, Math.trunc(num(values.chars, 5200))),
      mode: values.mode as SetupMode | "auto",
      provider: values.provider,
      model: values.model,
      force: values.force,
    });
    return;
  }

  requireProject(slug);
  if (command === "status") {
    cmdStatus(slug);
    return;
  }
  if (command === "export") {
    const format = values.format === "md" ? "md" : "txt";
    cmdExport(slug, {
      format,
      from: Math.max(1, Math.trunc(num(values.from, 1))),
      to: Math.trunc(num(values.to)),
      split: values.split,
    });
    return;
  }

  const engine = new Engine(loadProject(slug), {
    mock: values.mock,
    budgetUsd: num(values.budget),
  });

  switch (command) {
    case "concept":
      await cmdConcept(slug, engine, values.force);
      break;
    case "bible":
      await cmdBible(slug, engine, values.force);
      break;
    case "outline":
      await cmdOutline(
        slug,
        engine,
        values.force,
        values.episodes === "" ? undefined : Math.trunc(num(values.episodes)),
      );
      break;
    case "write": {
      const ctx = loadContext(slug);
      await writeEpisode(ctx, engine, requireEpisode(values.ep), values.force);
      break;
    }
    case "qa": {
      const ctx = loadContext(slug);
      const n = requireEpisode(values.ep);
      const plan = readJson(episodeFile.plan(slug, n), EpisodePlanSchema);
      await qaEpisode(ctx, engine, n, plan, readText(episodeFile.draft(slug, n)));
      break;
    }
    case "revise": {
      const ctx = loadContext(slug);
      const n = requireEpisode(values.ep);
      const plan = readJson(episodeFile.plan(slug, n), EpisodePlanSchema);
      const report = readJson(episodeFile.qa(slug, n), QaReportSchema);
      const text = readText(episodeFile.draft(slug, n));
      const revision = episodeProgress(slug, n).revisions + 1;
      const revised = await reviseEpisode(ctx, engine, n, text, report, revision);
      await qaEpisode(ctx, engine, n, plan, revised);
      break;
    }
    case "run":
      await cmdRun(slug, engine, {
        from: Math.trunc(num(values.from)),
        to: Math.max(1, Math.trunc(num(values.to, 1))),
        force: values.force,
        keepGoing: values["keep-going"],
      });
      return;
    default:
      throw new UserError(`알 수 없는 명령: ${command}`, "novel --help 로 사용법을 보세요.");
  }

  engine.reportSpend();
}

main().catch((err: unknown) => {
  if (err instanceof UserError) {
    log.error(err.message);
    if (err.hint !== "") log.plain(`  ${err.hint}`);
  } else if (err instanceof Error) {
    log.error(err.message);
    if (process.env["WEBSOCIAL_DEBUG"] === "1" && err.stack !== undefined) {
      log.plain(err.stack);
    } else {
      log.plain("  자세한 오류는 WEBSOCIAL_DEBUG=1 로 다시 실행하세요.");
    }
  } else {
    log.error(String(err));
  }
  process.exitCode = 1;
});
