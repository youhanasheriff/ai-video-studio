import type { StoryCharacter, StoryCharacterConsistency, StoryScene } from "./types";

export const defaultCharacterConsistency: StoryCharacterConsistency = {
  enabled: true,
  mode: "reference_images",
  maxRefsPerScene: 4,
};

export function characterKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function normalizeStoryCharacters(value: unknown): StoryCharacter[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, StoryCharacter>();
  for (const entry of value) {
    const character = normalizeStoryCharacter(entry);
    if (!character) continue;
    const existing = byKey.get(character.key);
    byKey.set(character.key, existing ? mergeCharacter(existing, character) : character);
  }
  return Array.from(byKey.values());
}

export function normalizeStoryCharacter(value: unknown): StoryCharacter | null {
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return null;
    const name = value.trim();
    const key = characterKey(name);
    if (!key) return null;
    return {
      key,
      name,
      visualToken: name,
      wardrobe: "",
    };
  }

  const record = value as Record<string, unknown>;
  const name = stringValue(record.name) || stringValue(record.display_name) || stringValue(record.key) || stringValue(record.visual_token) || stringValue(record.visualToken);
  const key = characterKey(stringValue(record.key) || name);
  if (!key || !name) return null;

  return {
    key,
    name,
    visualToken: stringValue(record.visualToken) || stringValue(record.visual_token) || name,
    wardrobe: stringValue(record.wardrobe) || stringValue(record.costume),
    portraitPose: stringValue(record.portraitPose) || stringValue(record.portrait_pose) || undefined,
    portraitBackground: stringValue(record.portraitBackground) || stringValue(record.portrait_background) || undefined,
    portraitAssetId: stringValue(record.portraitAssetId) || stringValue(record.portrait_asset_id) || null,
    portraitPath: stringValue(record.portraitPath) || stringValue(record.portrait_path) || null,
    portraitUrl: stringValue(record.portraitUrl) || stringValue(record.portrait_url) || null,
  };
}

export function normalizeCharacterConsistency(value: unknown): StoryCharacterConsistency {
  const record = value && typeof value === "object" ? value as Partial<StoryCharacterConsistency> : {};
  const mode = record.mode === "reference_images" || record.mode === "prompt_tokens" ? record.mode : defaultCharacterConsistency.mode;
  return {
    enabled: Boolean(record.enabled ?? defaultCharacterConsistency.enabled),
    mode,
    maxRefsPerScene: Math.max(1, Number(record.maxRefsPerScene || defaultCharacterConsistency.maxRefsPerScene)),
    charactersDir: stringValue(record.charactersDir) || undefined,
  };
}

export function mergeStoryCharacters(...groups: unknown[]): StoryCharacter[] {
  const byKey = new Map<string, StoryCharacter>();
  for (const group of groups) {
    for (const character of normalizeStoryCharacters(group)) {
      const existing = byKey.get(character.key);
      byKey.set(character.key, existing ? mergeCharacter(existing, character) : character);
    }
  }
  return Array.from(byKey.values());
}

export function normalizeSceneCharacterKeys(value: unknown, characters: StoryCharacter[] = []): string[] {
  const knownByName = new Map<string, string>();
  const aliasCandidates = new Map<string, string[]>();
  for (const character of characters) {
    knownByName.set(characterKey(character.key), character.key);
    knownByName.set(characterKey(character.name), character.key);
    knownByName.set(characterKey(character.visualToken), character.key);
    const firstName = characterKey(character.name.split(/\s+/)[0] ?? "");
    if (firstName && firstName !== character.key) {
      aliasCandidates.set(firstName, [...(aliasCandidates.get(firstName) ?? []), character.key]);
    }
  }
  for (const [alias, keys] of aliasCandidates) {
    if (keys.length === 1 && !knownByName.has(alias)) knownByName.set(alias, keys[0]);
  }

  const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  const keys: string[] = [];
  for (const entry of raw) {
    const inferred = inferSceneCharacterKey(entry, knownByName);
    if (inferred && !keys.includes(inferred)) keys.push(inferred);
  }
  return keys;
}

export function parseCharacterKeyList(value: string, characters: StoryCharacter[] = []): string[] {
  return normalizeSceneCharacterKeys(value, characters);
}

export function inferCharactersFromScenes(scenes: StoryScene[]): StoryCharacter[] {
  return mergeStoryCharacters(scenes.flatMap((scene) => scene.characters));
}

export function characterUsageByKey(scenes: StoryScene[], characters: StoryCharacter[]): Map<string, number[]> {
  const usage = new Map<string, number[]>();
  for (const scene of scenes) {
    for (const key of normalizeSceneCharacterKeys(scene.characters, characters)) {
      const list = usage.get(key) ?? [];
      list.push(scene.sceneId);
      usage.set(key, list);
    }
  }
  return usage;
}

export function toPipelineCharacter(character: StoryCharacter): Record<string, unknown> {
  return {
    key: character.key,
    name: character.name,
    visual_token: character.visualToken,
    wardrobe: character.wardrobe,
    portrait_pose: character.portraitPose ?? "",
    portrait_background: character.portraitBackground ?? "",
    portrait_path: character.portraitPath ?? "",
    portrait_url: character.portraitUrl ?? "",
  };
}

function inferSceneCharacterKey(value: unknown, knownByName: Map<string, string>): string {
  if (typeof value === "string") {
    const key = characterKey(value);
    return knownByName.get(key) ?? key;
  }
  const character = normalizeStoryCharacter(value);
  if (!character) return "";
  return knownByName.get(characterKey(character.key)) ?? knownByName.get(characterKey(character.name)) ?? character.key;
}

function mergeCharacter(existing: StoryCharacter, next: StoryCharacter): StoryCharacter {
  return {
    key: existing.key || next.key,
    name: existing.name || next.name,
    visualToken: existing.visualToken || next.visualToken,
    wardrobe: existing.wardrobe || next.wardrobe,
    portraitPose: existing.portraitPose || next.portraitPose,
    portraitBackground: existing.portraitBackground || next.portraitBackground,
    portraitAssetId: existing.portraitAssetId || next.portraitAssetId || null,
    portraitPath: existing.portraitPath || next.portraitPath || null,
    portraitUrl: existing.portraitUrl || next.portraitUrl || null,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
