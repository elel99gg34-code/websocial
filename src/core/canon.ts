import { projectFile } from "./paths.ts";
import { readJsonIf, writeJson } from "./store.ts";
import type { Canon, CanonFact, CharacterStates, Digest, Foreshadow } from "./types.ts";
import { CanonSchema, CharacterStateSchema, ForeshadowSchema } from "./types.ts";

export const loadCanon = (slug: string): Canon =>
  readJsonIf(projectFile.canon(slug), CanonSchema, { facts: [] });

export const loadForeshadow = (slug: string): Foreshadow =>
  readJsonIf(projectFile.foreshadow(slug), ForeshadowSchema, { items: [] });

export const loadStates = (slug: string): CharacterStates =>
  readJsonIf(projectFile.characterStates(slug), CharacterStateSchema, { states: [] });

/**
 * 이번 화 등장인물과 관련된 확정 사실 + 최근 사실을 합쳐 돌려준다.
 * 임베딩 없이 결정적으로 동작하며, 회차가 쌓여도 주입량이 상한을 넘지 않는다.
 */
export function relevantFacts(
  canon: Canon,
  characters: string[],
  limit = 40,
): CanonFact[] {
  const onStage = new Set(characters);
  const related = canon.facts.filter(
    (f) => f.characters.length === 0 || f.characters.some((c) => onStage.has(c)),
  );
  const recent = canon.facts.slice(-12);
  const merged = new Map<string, CanonFact>();
  for (const fact of [...related, ...recent]) merged.set(fact.id, fact);
  return [...merged.values()].sort((a, b) => a.episode - b.episode).slice(-limit);
}

export const unresolvedForeshadow = (fs: Foreshadow): Foreshadow["items"] =>
  fs.items.filter((i) => i.resolvedAt === 0);

/** 회차 다이제스트를 원장에 반영한다. 기존 기록은 덮어쓰지 않고 덧붙인다. */
export function applyDigest(slug: string, episode: number, digest: Digest): void {
  const canon = loadCanon(slug);
  const known = new Set(canon.facts.map((f) => f.text.trim()));
  for (const fact of digest.newFacts) {
    const text = fact.text.trim();
    if (text === "" || known.has(text)) continue;
    known.add(text);
    canon.facts.push({
      // 재실행(--force)으로 사실이 바뀌어도 id 가 겹치지 않도록 원장 전체 기준으로 매긴다
      id: `f-${episode}-${canon.facts.length + 1}`,
      text,
      category: fact.category,
      characters: fact.characters,
      episode,
    });
  }
  writeJson(projectFile.canon(slug), canon);

  const foreshadow = loadForeshadow(slug);
  for (const planted of digest.foreshadowPlanted) {
    const id = planted.id.trim();
    if (id === "" || foreshadow.items.some((i) => i.id === id)) continue;
    foreshadow.items.push({
      id,
      description: planted.description,
      plannedPayoff: planted.plannedPayoff,
      plantedAt: episode,
      resolvedAt: 0,
    });
  }
  for (const resolvedId of digest.foreshadowResolved) {
    const item = foreshadow.items.find((i) => i.id === resolvedId.trim());
    if (item !== undefined && item.resolvedAt === 0) item.resolvedAt = episode;
  }
  writeJson(projectFile.foreshadow(slug), foreshadow);

  const states = loadStates(slug);
  for (const update of digest.characterUpdates) {
    const name = update.name.trim();
    if (name === "") continue;
    const existing = states.states.find((s) => s.name === name);
    if (existing === undefined) {
      states.states.push({
        name,
        state: update.state,
        location: update.location,
        knows: [...new Set(update.knows)],
        updatedAt: episode,
      });
    } else {
      existing.state = update.state;
      existing.location = update.location;
      existing.knows = [...new Set([...existing.knows, ...update.knows])].slice(-20);
      existing.updatedAt = episode;
    }
  }
  writeJson(projectFile.characterStates(slug), states);
}
