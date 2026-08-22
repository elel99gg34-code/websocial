import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { z } from "zod";
import { UserError } from "../src/core/log.ts";
import { ProfileSchema } from "../src/core/types.ts";
import { GeminiProvider } from "../src/llm/gemini.ts";
import { OpenAiCompatProvider } from "../src/llm/openai-compat.ts";
import type { GenRequest, ResolvedProfile } from "../src/llm/provider.ts";

type Handler = (
  req: http.IncomingMessage,
  body: string,
  res: http.ServerResponse,
) => void;

const servers: http.Server[] = [];

async function stub(handler: Handler): Promise<string> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => handler(req, body, res));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

after(() => {
  for (const server of servers) server.close();
});

const json = (res: http.ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const resolved = (baseUrl: string, provider: "openai-compat" | "gemini"): ResolvedProfile => ({
  name: "test",
  profile: ProfileSchema.parse({ provider, model: "test-model", maxOutputTokens: 1000 }),
  baseUrl,
  apiKey: "test-key",
  free: true,
  label: "테스트",
});

const request: GenRequest = {
  stage: "draft",
  episode: 1,
  systemBlocks: ["문체 지침", "설정집"],
  user: "1화를 써라",
};

const PlanSchema = z.object({ title: z.string(), beats: z.array(z.string()) });

test("OpenAI 호환: 산문 요청과 사용량 매핑", async () => {
  let seen: Record<string, unknown> = {};
  const base = await stub((req, body, res) => {
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers["authorization"], "Bearer test-key");
    seen = JSON.parse(body);
    json(res, 200, {
      choices: [{ message: { content: "본문입니다." } }],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    });
  });

  const result = await new OpenAiCompatProvider(resolved(base, "openai-compat")).prose(request);
  assert.equal(result.text, "본문입니다.");
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 40);

  const messages = seen["messages"] as { role: string; content: string }[];
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages[0]?.content.includes("설정집"));
  assert.equal(messages[1]?.content, "1화를 써라");
});

test("OpenAI 호환: json_schema 를 거부하면 json_object 로 낮춘다", async () => {
  const modes: string[] = [];
  const base = await stub((_req, body, res) => {
    const payload = JSON.parse(body) as { response_format?: { type: string } };
    const mode = payload.response_format?.type ?? "none";
    modes.push(mode);
    if (mode === "json_schema") {
      json(res, 400, { error: "json_schema not supported" });
      return;
    }
    json(res, 200, {
      choices: [{ message: { content: '{"title":"제목","beats":["가","나"]}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });

  const provider = new OpenAiCompatProvider(resolved(base, "openai-compat"));
  const result = await provider.json(request, PlanSchema, "plan");
  assert.deepEqual(modes, ["json_schema", "json_object"]);
  assert.equal(result.value.title, "제목");

  // 한 번 낮춘 모드는 다음 호출에서도 유지된다
  await provider.json(request, PlanSchema, "plan");
  assert.deepEqual(modes, ["json_schema", "json_object", "json_object"]);
});

test("OpenAI 호환: 스키마에 맞지 않으면 한 번 교정 요청한다", async () => {
  let call = 0;
  const prompts: string[] = [];
  const base = await stub((_req, body, res) => {
    call += 1;
    const payload = JSON.parse(body) as { messages: { content: string }[] };
    prompts.push(payload.messages.at(-1)?.content ?? "");
    json(res, 200, {
      choices: [
        {
          message: {
            content:
              call === 1 ? '{"title":"제목"}' : '{"title":"제목","beats":["가"]}',
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });

  const result = await new OpenAiCompatProvider(resolved(base, "openai-compat")).json(
    request,
    PlanSchema,
    "plan",
  );
  assert.equal(call, 2);
  assert.ok(prompts[1]?.includes("검증 오류"));
  assert.deepEqual(result.value.beats, ["가"]);
  assert.equal(result.usage.inputTokens, 20); // 두 호출 합산
});

test("OpenAI 호환: 429 는 재시도한다", async () => {
  let call = 0;
  const base = await stub((_req, _body, res) => {
    call += 1;
    if (call === 1) {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
      res.end("{}");
      return;
    }
    json(res, 200, {
      choices: [{ message: { content: "성공" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  });

  const result = await new OpenAiCompatProvider(resolved(base, "openai-compat")).prose(request);
  assert.equal(result.text, "성공");
  assert.equal(call, 2);
});

test("Gemini: 시스템 지시와 responseSchema 를 보내고 응답을 파싱한다", async () => {
  let seen: Record<string, unknown> = {};
  const base = await stub((req, body, res) => {
    assert.equal(req.url, "/models/test-model:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "test-key");
    seen = JSON.parse(body);
    json(res, 200, {
      candidates: [
        { content: { parts: [{ text: '{"title":"제목","beats":["가"]}' }] }, finishReason: "STOP" },
      ],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12 },
    });
  });

  const result = await new GeminiProvider(resolved(base, "gemini")).json(
    request,
    PlanSchema,
    "plan",
  );
  assert.equal(result.value.title, "제목");
  assert.equal(result.usage.inputTokens, 30);

  const config = seen["generationConfig"] as Record<string, unknown>;
  assert.equal(config["responseMimeType"], "application/json");
  const schema = config["responseSchema"] as Record<string, unknown>;
  assert.equal(schema["additionalProperties"], undefined);
  assert.ok((schema["properties"] as Record<string, unknown>)["title"] !== undefined);
});

test("Gemini: 안전 차단은 안내가 있는 오류로 바꾼다", async () => {
  const base = await stub((_req, _body, res) => {
    json(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
  });

  await assert.rejects(
    () => new GeminiProvider(resolved(base, "gemini")).prose(request),
    (err: unknown) => err instanceof UserError && err.message.includes("SAFETY"),
  );
});
