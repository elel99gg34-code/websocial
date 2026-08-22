import type { ProviderKind } from "../core/types.ts";

export type CostTier = "free" | "freemium" | "paid" | "local";

export type Preset = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** 빈 문자열이면 키가 필요 없다(로컬 실행) */
  apiKeyEnv: string;
  defaultModel: string;
  tier: CostTier;
  signupUrl: string;
  note: string;
};

/**
 * 제공자 프리셋.
 * 무료 한도와 모델 목록은 각 제공자 정책에 따라 자주 바뀐다.
 * defaultModel 은 "그럴듯한 기본값"일 뿐이므로, 실제 사용 가능한 모델명은
 * 각 제공자 문서에서 확인하고 project.json 의 llm.profiles 에서 바꿔 쓰면 된다.
 */
export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-opus-5",
    tier: "paid",
    signupUrl: "https://console.anthropic.com/",
    note: "한국어 장문 품질 최상. 집필/기획 단계 권장. 프롬프트 캐싱으로 반복 컨텍스트 비용 절감.",
  },
  {
    id: "gemini",
    label: "Google Gemini (AI Studio)",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    tier: "freemium",
    signupUrl: "https://aistudio.google.com/apikey",
    note: "무료 티어 제공. 구조화 JSON(responseSchema) 지원이 좋아 검수/다이제스트에 적합.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compat",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    tier: "freemium",
    signupUrl: "https://console.groq.com/keys",
    note: "무료 티어 + 매우 빠른 추론. 기계적 단계(요약·심사)에 적합.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "deepseek/deepseek-chat-v3-0324:free",
    tier: "freemium",
    signupUrl: "https://openrouter.ai/keys",
    note: "모델명에 :free 접미사가 붙은 모델은 무료. 여러 공급자를 키 하나로 사용.",
  },
  {
    id: "xai",
    label: "xAI Grok",
    kind: "openai-compat",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    defaultModel: "grok-4",
    tier: "paid",
    signupUrl: "https://console.x.ai/",
    note: "OpenAI 호환. 모델명이 자주 바뀌므로 공식 문서에서 확인 후 project.json 에서 바꾸세요.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    kind: "openai-compat",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    tier: "freemium",
    signupUrl: "https://cloud.cerebras.ai/",
    note: "무료 티어 제공. 초고속 추론.",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai-compat",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
    tier: "freemium",
    signupUrl: "https://console.mistral.ai/",
    note: "무료 실험 티어 제공.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compat",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    tier: "paid",
    signupUrl: "https://platform.deepseek.com/",
    note: "저가 유료. 장문 생성 단가가 낮다.",
  },
  {
    id: "ollama",
    label: "Ollama (로컬)",
    kind: "openai-compat",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: "",
    defaultModel: "qwen2.5:14b",
    tier: "local",
    signupUrl: "https://ollama.com/",
    note: "완전 무료·오프라인. `ollama serve` 후 사용. 한국어는 qwen/exaone 계열 권장.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (로컬)",
    kind: "openai-compat",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "",
    defaultModel: "local-model",
    tier: "local",
    signupUrl: "https://lmstudio.ai/",
    note: "완전 무료·오프라인. LM Studio 서버 모드에서 사용.",
  },
  {
    id: "mock",
    label: "Mock (무과금 리허설)",
    kind: "mock",
    baseUrl: "",
    apiKeyEnv: "",
    defaultModel: "mock-1",
    tier: "free",
    signupUrl: "",
    note: "API 호출 없이 파이프라인 구조만 검증. 실제 원고 품질과 무관.",
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** 키가 실제로 설정된, 사용 가능한 프리셋 */
export function availablePresets(env = process.env): Preset[] {
  return PRESETS.filter(
    (p) => p.apiKeyEnv === "" || (env[p.apiKeyEnv] ?? "").trim().length > 0,
  );
}

/** 무료로 쓸 수 있는 것 중 키가 설정된 첫 프리셋 (init --free 기본값 결정용) */
export function pickFreePreset(env = process.env): Preset | undefined {
  const order = ["gemini", "groq", "cerebras", "openrouter", "mistral"];
  for (const id of order) {
    const p = findPreset(id);
    if (p && (env[p.apiKeyEnv] ?? "").trim().length > 0) return p;
  }
  return undefined;
}
