import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, StoryConfig } from "../../shared/types";
import { execSql, getProject, id, parseJson, querySql, sql, now } from "../db";
import { projectDir } from "../paths";

export function defaultStoryConfig(seed = ""): StoryConfig {
  return {
    seed,
    target: {
      scriptWords: 1200,
      sceneCount: 8,
      approximateMinutes: 8,
    },
    style: {
      genre: "bedtime narration",
      visualStyle: "cinematic storybook illustration",
      aspectRatio: "16:9",
      styleLock: "soft cinematic storybook lighting",
      palette: "amber, deep teal, moonlit blue, warm white",
      crossfade: false,
      kenBurns: true,
    },
    imageProvider: "google",
    voiceProvider: "openai-tts",
    llmProviderId: "openai-chat",
    llmModel: "gpt-4o-mini",
    imageBackend: "imagen",
    imageModel: "imagen-4.0-fast-generate-001",
    voiceName: "alloy",
    voiceSpeed: 1,
    subtitles: {
      enabled: true,
      style: "karaoke",
      karaoke: true,
    },
  };
}

export function normalizeStoryConfig(value: unknown): StoryConfig {
  const fallback = defaultStoryConfig();
  const input = (value && typeof value === "object" ? value : {}) as Partial<StoryConfig>;
  const target = input.target ?? fallback.target;
  const style = input.style ?? fallback.style;
  const subtitles = input.subtitles ?? fallback.subtitles;
  return {
    ...fallback,
    ...input,
    seed: String(input.seed ?? fallback.seed),
    target: {
      scriptWords: Number(target.scriptWords || fallback.target.scriptWords),
      sceneCount: Math.max(1, Number(target.sceneCount || fallback.target.sceneCount)),
      approximateMinutes: target.approximateMinutes === undefined ? fallback.target.approximateMinutes : Number(target.approximateMinutes),
    },
    style: {
      ...fallback.style,
      ...style,
      aspectRatio: style.aspectRatio ?? fallback.style.aspectRatio,
    },
    subtitles: {
      ...fallback.subtitles,
      ...subtitles,
      enabled: Boolean(subtitles.enabled ?? fallback.subtitles.enabled),
      karaoke: Boolean(subtitles.karaoke ?? fallback.subtitles.karaoke),
    },
  };
}

export function getStoryConfig(projectId: string): StoryConfig {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  return normalizeStoryConfig(project.settings);
}

export function saveStoryConfig(projectId: string, config: StoryConfig): StoryConfig {
  const normalized = normalizeStoryConfig(config);
  execSql(`
    UPDATE projects
    SET settings_json = ${sql(JSON.stringify(normalized))}, updated_at = ${sql(now())}
    WHERE id = ${sql(projectId)};
  `);
  writeStoryConfigFiles(projectId, normalized);
  return normalized;
}

export function createStoryProject(name: string, config: StoryConfig): Project {
  const projectId = id("project");
  const createdAt = now();
  const normalized = normalizeStoryConfig(config);
  execSql(`
    INSERT INTO projects (id, name, mode, status, script, settings_json, created_at, updated_at)
    VALUES (
      ${sql(projectId)}, ${sql(name || "Untitled Story")}, 'story', 'draft', '',
      ${sql(JSON.stringify(normalized))}, ${sql(createdAt)}, ${sql(createdAt)}
    );
  `);
  writeStoryConfigFiles(projectId, normalized);
  const project = getProject(projectId);
  if (!project) throw new Error("Failed to create story project");
  return project;
}

export function writeStoryConfigFiles(projectId: string, config: StoryConfig): void {
  const dir = projectDir(projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "seed.txt"), config.seed || "", "utf8");
  writeFileSync(join(dir, "config.yaml"), storyConfigYaml(config), "utf8");
}

export function updateProjectScript(projectId: string, script: string): void {
  execSql(`
    UPDATE projects SET script = ${sql(script)}, updated_at = ${sql(now())}
    WHERE id = ${sql(projectId)};
  `);
}

function storyConfigYaml(config: StoryConfig): string {
  const lines = [
    "target:",
    `  script_words: ${config.target.scriptWords}`,
    `  scene_count: ${config.target.sceneCount}`,
    `  approximate_minutes: ${config.target.approximateMinutes ?? ""}`,
    "style:",
    `  genre: ${JSON.stringify(config.style.genre)}`,
    `  visual_style: ${JSON.stringify(config.style.visualStyle)}`,
    `  aspect_ratio: ${JSON.stringify(config.style.aspectRatio)}`,
    `  style_lock: ${JSON.stringify(config.style.styleLock ?? "")}`,
    `  palette: ${JSON.stringify(config.style.palette ?? "")}`,
    "image:",
    `  provider: ${JSON.stringify(config.imageProvider)}`,
    `  backend: ${JSON.stringify(config.imageBackend ?? "imagen")}`,
    `  model: ${JSON.stringify(config.imageModel ?? "")}`,
    "tts:",
    `  provider: ${JSON.stringify(config.voiceProvider)}`,
    `  voice_name: ${JSON.stringify(config.voiceName)}`,
    `  voice_speed: ${config.voiceSpeed}`,
    "llm:",
    `  provider: ${JSON.stringify(config.llmProviderId)}`,
    `  model: ${JSON.stringify(config.llmModel ?? "")}`,
    "subtitles:",
    `  enabled: ${config.subtitles.enabled}`,
    `  style: ${JSON.stringify(config.subtitles.style)}`,
    `  karaoke: ${config.subtitles.karaoke}`,
    "",
  ];
  return lines.join("\n");
}

export function listStoryProjects(): Project[] {
  return querySql<{
    id: string;
    name: string;
    mode?: string;
    status: string;
    script: string;
    settings_json: string;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM projects WHERE mode = 'story' ORDER BY updated_at DESC;").map((row) => ({
    id: row.id,
    name: row.name,
    mode: "story",
    status: row.status as Project["status"],
    script: row.script,
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
