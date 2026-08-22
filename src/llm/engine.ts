import type { z } from "zod";
import { log, UserError } from "../core/log.ts";
import { projectFile } from "../core/paths.ts";
import { appendJsonl } from "../core/store.ts";
import type { Profile, Project, StageId, UsageRecord } from "../core/types.ts";
import { ProfileSchema } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { MockProvider } from "./mock.ts";
import { OpenAiCompatProvider } from "./openai-compat.ts";
import { estimateCost } from "./pricing.ts";
import type { GenRequest, Provider } from "./provider.ts";
import { resolveProfile } from "./provider.ts";

export class BudgetExceededError extends Error {
  readonly spent: number;
  readonly budget: number;
  constructor(spent: number, budget: number) {
    super(`예산 초과: $${spent.toFixed(2)} / $${budget.toFixed(2)}`);
    this.name = "BudgetExceededError";
    this.spent = spent;
    this.budget = budget;
  }
}

const MOCK_PROFILE: Profile = ProfileSchema.parse({
  provider: "mock",
  preset: "mock",
  model: "mock-1",
});

export type EngineOptions = {
  /** true 면 모든 단계를 mock 으로 강제한다 */
  mock: boolean;
  /** 0 이면 제한 없음. 이번 실행에서 누적된 비용 기준 */
  budgetUsd: number;
};

/**
 * 단계 → 프로필 라우팅, 제공자 인스턴스 캐싱, 사용량/비용 기록, 예산 차단을 담당한다.
 * 파이프라인 코드는 이 클래스만 알면 되고 제공자 차이는 전부 여기서 흡수된다.
 */
export class Engine {
  readonly #project: Project;
  readonly #options: EngineOptions;
  readonly #providers = new Map<string, Provider>();
  #spentUsd = 0;
  #unknownPricing = false;

  constructor(project: Project, options: EngineOptions) {
    this.#project = project;
    this.#options = options;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  get hasUnknownPricing(): boolean {
    return this.#unknownPricing;
  }

  profileNameFor(stage: StageId): string {
    if (this.#options.mock) return "mock";
    const name = this.#project.llm.routes[stage];
    if (name === undefined) {
      throw new UserError(
        `단계 "${stage}" 의 라우팅이 project.json 에 없습니다.`,
        `llm.routes 에 "${stage}": "<프로필명>" 을 추가하세요.`,
      );
    }
    return name;
  }

  #providerFor(stage: StageId): Provider {
    const profileName = this.profileNameFor(stage);
    const cached = this.#providers.get(profileName);
    if (cached !== undefined) return cached;

    const profile =
      profileName === "mock" && this.#options.mock
        ? MOCK_PROFILE
        : this.#project.llm.profiles[profileName];
    if (profile === undefined) {
      throw new UserError(
        `프로필을 찾을 수 없습니다: ${profileName}`,
        `사용 가능한 프로필: ${Object.keys(this.#project.llm.profiles).join(", ")}`,
      );
    }

    const resolved = resolveProfile(profileName, profile, process.env);
    const provider: Provider =
      profile.provider === "anthropic"
        ? new AnthropicProvider(resolved)
        : profile.provider === "gemini"
          ? new GeminiProvider(resolved)
          : profile.provider === "openai-compat"
            ? new OpenAiCompatProvider(resolved)
            : new MockProvider(resolved, this.#project.plannedEpisodes);

    this.#providers.set(profileName, provider);
    return provider;
  }

  describeRoute(stage: StageId): string {
    return `${stage} → ${this.#providerFor(stage).label}`;
  }

  #checkBudget(): void {
    if (this.#options.budgetUsd > 0 && this.#spentUsd >= this.#options.budgetUsd) {
      throw new BudgetExceededError(this.#spentUsd, this.#options.budgetUsd);
    }
  }

  #record(
    req: GenRequest,
    provider: Provider,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    },
    ms: number,
  ): void {
    const { usd, known } = estimateCost({
      model: provider.model,
      free: provider.free,
      ...usage,
    });
    if (!known) this.#unknownPricing = true;
    this.#spentUsd += usd;

    const record: UsageRecord = {
      ts: new Date().toISOString(),
      stage: req.stage,
      profile: this.profileNameFor(req.stage),
      provider: provider.kind,
      model: provider.model,
      episode: req.episode,
      ...usage,
      costUsd: usd,
      pricingKnown: known,
      ms,
    };
    appendJsonl(projectFile.usage(this.#project.slug), record);
  }

  async prose(req: GenRequest): Promise<string> {
    this.#checkBudget();
    const provider = this.#providerFor(req.stage);
    const started = Date.now();
    const result = await provider.prose(req);
    this.#record(req, provider, result.usage, Date.now() - started);
    if (result.text.trim() === "") {
      throw new UserError(
        `${req.stage} 단계에서 빈 응답을 받았습니다 (${provider.label}).`,
        "다시 실행하거나 다른 제공자로 라우팅하세요.",
      );
    }
    return result.text;
  }

  async json<T>(
    req: GenRequest,
    schema: z.ZodType<T>,
    schemaName: string,
  ): Promise<T> {
    this.#checkBudget();
    const provider = this.#providerFor(req.stage);
    const started = Date.now();
    const result = await provider.json(req, schema, schemaName);
    this.#record(req, provider, result.usage, Date.now() - started);
    return result.value;
  }

  reportSpend(): void {
    const spent = `$${this.#spentUsd.toFixed(4)}`;
    if (this.#unknownPricing) {
      log.info(`이번 실행 비용: ${spent} (단가 미등록 모델 포함 — 실제 청구액과 다를 수 있음)`);
    } else {
      log.info(`이번 실행 비용: ${spent}`);
    }
  }
}
