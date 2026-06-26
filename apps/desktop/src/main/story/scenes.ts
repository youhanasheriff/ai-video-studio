import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryScene, StoryScenePatch, StorySceneStatus, StoryStage, StoryStageState, StoryStageStatus } from "../../shared/types";
import { mergeStoryCharacters, normalizeSceneCharacterKeys, toPipelineCharacter } from "../../shared/characters";
import { execSql, now, parseJson, querySql, sql } from "../db";
import { projectDir } from "../paths";
import { getStoryConfig } from "./config";

export interface StorySceneRow {
  project_id: string;
  scene_id: number;
  title: string;
  narration_text: string;
  image_prompt: string;
  negative_prompt: string;
  characters_json: string;
  continuity_notes: string;
  estimated_duration_seconds: number | null;
  image_asset_id: string | null;
  image_status: StorySceneStatus;
  image_error: string | null;
  audio_asset_id: string | null;
  audio_status: StorySceneStatus;
  audio_start_seconds: number | null;
  audio_duration_seconds: number | null;
  audio_error: string | null;
  updated_at: string;
}

export interface StoryStageRow {
  project_id: string;
  stage: StoryStage;
  status: StoryStageStatus;
  progress: number;
  detail: string | null;
  output_json: string | null;
  error: string | null;
  updated_at: string;
}

export const storyStageOrder: StoryStage[] = ["writer", "prompts", "images", "tts", "assemble", "subtitles", "finalize"];

export function mapStoryScene(row: StorySceneRow): StoryScene {
  return {
    projectId: row.project_id,
    sceneId: row.scene_id,
    title: row.title,
    narrationText: row.narration_text,
    imagePrompt: row.image_prompt,
    negativePrompt: row.negative_prompt,
    characters: parseJson<Array<string | Record<string, unknown>>>(row.characters_json, []),
    continuityNotes: row.continuity_notes,
    estimatedDurationSeconds: row.estimated_duration_seconds,
    imageAssetId: row.image_asset_id,
    imageStatus: row.image_status,
    imageError: row.image_error,
    audioAssetId: row.audio_asset_id,
    audioStatus: row.audio_status,
    audioStartSeconds: row.audio_start_seconds,
    audioDurationSeconds: row.audio_duration_seconds,
    audioError: row.audio_error,
    updatedAt: row.updated_at,
  };
}

export function mapStoryStage(row: StoryStageRow): StoryStageState {
  return {
    projectId: row.project_id,
    stage: row.stage,
    status: row.status,
    progress: row.progress,
    detail: row.detail,
    output: parseJson<Record<string, unknown> | null>(row.output_json, null),
    error: row.error,
    updatedAt: row.updated_at,
  };
}

export function listStoryScenes(projectId: string): StoryScene[] {
  return querySql<StorySceneRow>(`
    SELECT * FROM story_scenes WHERE project_id = ${sql(projectId)} ORDER BY scene_id ASC;
  `).map(mapStoryScene);
}

export function getStoryScene(projectId: string, sceneId: number): StoryScene {
  const row = querySql<StorySceneRow>(`
    SELECT * FROM story_scenes WHERE project_id = ${sql(projectId)} AND scene_id = ${sql(sceneId)} LIMIT 1;
  `)[0];
  if (!row) throw new Error("Story scene not found");
  return mapStoryScene(row);
}

export function upsertStoryScene(input: {
  projectId: string;
  sceneId: number;
  title?: string;
  narrationText?: string;
  imagePrompt?: string;
  negativePrompt?: string;
  characters?: StoryScene["characters"];
  continuityNotes?: string;
  estimatedDurationSeconds?: number | null;
  imageAssetId?: string | null;
  imageStatus?: StorySceneStatus;
  imageError?: string | null;
  audioAssetId?: string | null;
  audioStatus?: StorySceneStatus;
  audioStartSeconds?: number | null;
  audioDurationSeconds?: number | null;
  audioError?: string | null;
}): StoryScene {
  execSql(`
    INSERT INTO story_scenes (
      project_id, scene_id, title, narration_text, image_prompt, negative_prompt, characters_json,
      continuity_notes, estimated_duration_seconds, image_asset_id, image_status, image_error,
      audio_asset_id, audio_status, audio_start_seconds, audio_duration_seconds, audio_error, updated_at
    ) VALUES (
      ${sql(input.projectId)}, ${sql(input.sceneId)}, ${sql(input.title ?? "")}, ${sql(input.narrationText ?? "")},
      ${sql(input.imagePrompt ?? "")}, ${sql(input.negativePrompt ?? "")}, ${sql(JSON.stringify(input.characters ?? []))},
      ${sql(input.continuityNotes ?? "")}, ${sql(input.estimatedDurationSeconds ?? null)}, ${sql(input.imageAssetId ?? null)},
      ${sql(input.imageStatus ?? "pending")}, ${sql(input.imageError ?? null)}, ${sql(input.audioAssetId ?? null)},
      ${sql(input.audioStatus ?? "pending")}, ${sql(input.audioStartSeconds ?? null)}, ${sql(input.audioDurationSeconds ?? null)},
      ${sql(input.audioError ?? null)}, ${sql(now())}
    )
    ON CONFLICT(project_id, scene_id) DO UPDATE SET
      title = excluded.title,
      narration_text = excluded.narration_text,
      image_prompt = CASE WHEN excluded.image_prompt = '' THEN story_scenes.image_prompt ELSE excluded.image_prompt END,
      negative_prompt = CASE WHEN excluded.negative_prompt = '' THEN story_scenes.negative_prompt ELSE excluded.negative_prompt END,
      characters_json = excluded.characters_json,
      continuity_notes = CASE WHEN excluded.continuity_notes = '' THEN story_scenes.continuity_notes ELSE excluded.continuity_notes END,
      estimated_duration_seconds = excluded.estimated_duration_seconds,
      image_asset_id = COALESCE(excluded.image_asset_id, story_scenes.image_asset_id),
      image_status = excluded.image_status,
      image_error = excluded.image_error,
      audio_asset_id = COALESCE(excluded.audio_asset_id, story_scenes.audio_asset_id),
      audio_status = excluded.audio_status,
      audio_start_seconds = excluded.audio_start_seconds,
      audio_duration_seconds = excluded.audio_duration_seconds,
      audio_error = excluded.audio_error,
      updated_at = excluded.updated_at;
  `);
  return getStoryScene(input.projectId, input.sceneId);
}

export function updateStoryScene(projectId: string, sceneId: number, patch: StoryScenePatch): StoryScene {
  const existing = getStoryScene(projectId, sceneId);
  execSql(`
    UPDATE story_scenes SET
      title = ${sql(patch.title ?? existing.title)},
      narration_text = ${sql(patch.narrationText ?? existing.narrationText)},
      image_prompt = ${sql(patch.imagePrompt ?? existing.imagePrompt)},
      negative_prompt = ${sql(patch.negativePrompt ?? existing.negativePrompt)},
      characters_json = ${sql(JSON.stringify(patch.characters ?? existing.characters))},
      continuity_notes = ${sql(patch.continuityNotes ?? existing.continuityNotes)},
      updated_at = ${sql(now())}
    WHERE project_id = ${sql(projectId)} AND scene_id = ${sql(sceneId)};
  `);
  writeScenesJson(projectId);
  return getStoryScene(projectId, sceneId);
}

export function listStoryStages(projectId: string): StoryStageState[] {
  ensureStoryStages(projectId);
  const rows = querySql<StoryStageRow>(`SELECT * FROM story_stages WHERE project_id = ${sql(projectId)};`);
  const mapped = new Map(rows.map((row) => [row.stage, mapStoryStage(row)]));
  return storyStageOrder.map((stage) => mapped.get(stage)).filter(Boolean) as StoryStageState[];
}

export function setStoryStage(projectId: string, stage: StoryStage, values: Partial<Pick<StoryStageState, "status" | "progress" | "detail" | "error">> & { output?: Record<string, unknown> | null } = {}): StoryStageState {
  execSql(`
    INSERT INTO story_stages (project_id, stage, status, progress, detail, output_json, error, updated_at)
    VALUES (
      ${sql(projectId)}, ${sql(stage)}, ${sql(values.status ?? "pending")}, ${sql(values.progress ?? 0)},
      ${sql(values.detail ?? null)}, ${sql(values.output === undefined ? null : JSON.stringify(values.output))},
      ${sql(values.error ?? null)}, ${sql(now())}
    )
    ON CONFLICT(project_id, stage) DO UPDATE SET
      status = ${sql(values.status ?? "pending")},
      progress = ${sql(values.progress ?? 0)},
      detail = ${sql(values.detail ?? null)},
      output_json = ${sql(values.output === undefined ? null : JSON.stringify(values.output))},
      error = ${sql(values.error ?? null)},
      updated_at = ${sql(now())};
  `);
  return listStoryStages(projectId).find((entry) => entry.stage === stage)!;
}

export function ensureStoryStages(projectId: string): void {
  for (const stage of storyStageOrder) {
    execSql(`
      INSERT OR IGNORE INTO story_stages (project_id, stage, status, progress, detail, output_json, error, updated_at)
      VALUES (${sql(projectId)}, ${sql(stage)}, 'pending', 0, NULL, NULL, NULL, ${sql(now())});
    `);
  }
}

export function firstIncompleteStage(projectId: string): StoryStage {
  const stages = listStoryStages(projectId);
  return stages.find((stage) => stage.status !== "done")?.stage ?? "writer";
}

export function markStagesStaleAfter(projectId: string, stage: StoryStage): void {
  const index = storyStageOrder.indexOf(stage);
  if (index < 0) return;
  const stale = storyStageOrder.slice(index + 1);
  if (!stale.length) return;
  execSql(`
    UPDATE story_stages SET status = 'stale', progress = 0, detail = NULL, error = NULL, updated_at = ${sql(now())}
    WHERE project_id = ${sql(projectId)} AND stage IN (${stale.map(sql).join(", ")});
  `);
}

export function writeScenesJson(projectId: string): void {
  const scenes = listStoryScenes(projectId);
  const config = getStoryConfig(projectId);
  const characters = mergeStoryCharacters(config.characters, scenes.flatMap((scene) => scene.characters));
  const payload = {
    style_lock: config.style.styleLock ?? "",
    palette: config.style.palette ?? "",
    medium: config.style.visualStyle,
    aspect_ratio: config.style.aspectRatio,
    character_consistency: {
      enabled: config.characterConsistency.enabled,
      mode: config.characterConsistency.mode,
      max_refs_per_scene: config.characterConsistency.maxRefsPerScene,
    },
    characters: characters.map(toPipelineCharacter),
    scenes: scenes.map((scene) => ({
      scene_id: scene.sceneId,
      title: scene.title,
      narration_text: scene.narrationText,
      image_prompt: scene.imagePrompt,
      negative_prompt: scene.negativePrompt,
      characters: scene.characters,
      characters_in_scene: normalizeSceneCharacterKeys(scene.characters, characters),
      continuity_notes: scene.continuityNotes,
      estimated_duration_seconds: scene.estimatedDurationSeconds,
    })),
  };
  writeFileSync(join(projectDir(projectId), "scenes.json"), JSON.stringify(payload, null, 2), "utf8");
}
