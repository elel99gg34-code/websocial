import path from "node:path";
import { UserError } from "./log.ts";
import { PROMPTS_DIR } from "./paths.ts";
import { exists, readText } from "./store.ts";

const cache = new Map<string, string>();

/**
 * prompts/<name>.md 를 읽어 {{key}} 자리를 채운다.
 * 채워지지 않은 자리표시자가 남으면 조용히 넘기지 않고 실패시킨다.
 */
export function renderPrompt(name: string, vars: Record<string, string>): string {
  const file = path.join(PROMPTS_DIR, `${name}.md`);
  let template = cache.get(file);
  if (template === undefined) {
    if (!exists(file)) {
      throw new UserError(`프롬프트 템플릿이 없습니다: prompts/${name}.md`);
    }
    template = readText(file);
    cache.set(file, template);
  }

  const missing: string[] = [];
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      missing.push(key);
      return "";
    }
    return value;
  });

  if (missing.length > 0) {
    throw new UserError(
      `프롬프트 변수 누락: prompts/${name}.md`,
      `채워지지 않은 자리표시자: ${[...new Set(missing)].join(", ")}`,
    );
  }
  return rendered.trim();
}

/** 테스트에서 템플릿 캐시를 비운다. */
export function clearPromptCache(): void {
  cache.clear();
}
