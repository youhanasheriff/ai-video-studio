import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryConfig } from "../../../shared/types";
import { execSql, getProvider, id, logJob, now, sql } from "../../db";
import { localFileUrl, projectDir } from "../../paths";
import { generateGoogleImage } from "../google";
import { listStoryScenes, upsertStoryScene } from "../scenes";
import { spawnPythonStage } from "../subprocess";

export async function runImagesStage(projectId: string, config: StoryConfig, onScene?: (done: number, total: number) => void, jobId?: string): Promise<{ generated: number; failed: number }> {
  if (config.imageProvider === "flux2") {
    if (localProviderReady("flux2")) {
      return runLocalFluxImagesStage(projectId, config, onScene, jobId);
    }
    if (jobId) logJob(jobId, "warn", "FLUX.2 provider is not connected; falling back to Google image generation.");
  }
  const scenes = listStoryScenes(projectId);
  if (!scenes.length) throw new Error("No story scenes exist. Run writer/prompts first.");
  const dir = join(projectDir(projectId), "images");
  mkdirSync(dir, { recursive: true });
  let generated = 0;
  let failed = 0;
  const manifest: Array<Record<string, unknown>> = [];
  for (const [index, scene] of scenes.entries()) {
    if (scene.imageStatus === "done" && scene.imageAssetId) {
      onScene?.(index + 1, scenes.length);
      continue;
    }
    const outputPath = join(dir, `scene_${String(scene.sceneId).padStart(4, "0")}.png`);
    upsertStoryScene({ ...sceneToInput(scene), imageStatus: "generating", imageError: null });
    try {
      const image = await retry(() => generateGoogleImage(scene.imagePrompt || scene.title, {
        aspectRatio: config.style.aspectRatio,
        backend: config.imageBackend,
        model: config.imageModel,
      }));
      writeFileSync(outputPath, image);
      const assetId = id("asset");
      execSql(`
        INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
        VALUES (
          ${sql(assetId)}, ${sql(projectId)}, 'image', 'generated', NULL, ${sql(outputPath)},
          ${sql(JSON.stringify({ sceneId: scene.sceneId, provider: "google", fileUrl: localFileUrl(outputPath) }))}, ${sql(now())}
        );
      `);
      upsertStoryScene({ ...sceneToInput(scene), imageAssetId: assetId, imageStatus: "done", imageError: null });
      manifest.push({ scene_id: scene.sceneId, output_path: outputPath, status: existsSync(outputPath) ? "generated" : "failed", backend: config.imageBackend ?? "imagen", model: config.imageModel });
      generated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      upsertStoryScene({ ...sceneToInput(scene), imageStatus: "failed", imageError: message.slice(0, 1200) });
      manifest.push({ scene_id: scene.sceneId, output_path: outputPath, status: "failed", error: message.slice(0, 1200) });
      failed += 1;
    }
    onScene?.(index + 1, scenes.length);
    await sleep(1000);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ scenes: manifest }, null, 2), "utf8");
  return { generated, failed };
}

export async function regenerateSceneImage(projectId: string, sceneId: number, config: StoryConfig, promptOverride?: string) {
  const scene = listStoryScenes(projectId).find((entry) => entry.sceneId === sceneId);
  if (!scene) throw new Error("Story scene not found");
  const dir = join(projectDir(projectId), "images");
  mkdirSync(dir, { recursive: true });
  const prompt = promptOverride || scene.imagePrompt || scene.title;
  const outputPath = join(dir, `scene_${String(sceneId).padStart(4, "0")}.png`);
  upsertStoryScene({ ...sceneToInput(scene), imagePrompt: prompt, imageStatus: "generating", imageError: null });
  if (config.imageProvider === "flux2" && localProviderReady("flux2")) {
    await spawnPythonStage({
      jobId: `regen_${projectId}_${sceneId}_${Date.now()}`,
      projectId,
      scriptName: "generate_local_images.py",
      args: ["--project", projectDir(projectId), "--scenes", String(sceneId), "--force"],
      config,
    });
    ingestImageManifest(projectId, "flux2");
    return listStoryScenes(projectId).find((entry) => entry.sceneId === sceneId) ?? upsertStoryScene({ ...sceneToInput(scene), imageStatus: "failed", imageError: "Local image generation did not update this scene." });
  }
  const image = await retry(() => generateGoogleImage(prompt, {
    aspectRatio: config.style.aspectRatio,
    backend: config.imageBackend,
    model: config.imageModel,
  }));
  writeFileSync(outputPath, image);
  const assetId = id("asset");
  execSql(`
    INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
    VALUES (${sql(assetId)}, ${sql(projectId)}, 'image', 'generated', NULL, ${sql(outputPath)}, ${sql(JSON.stringify({ sceneId, provider: "google" }))}, ${sql(now())});
  `);
  return upsertStoryScene({ ...sceneToInput(scene), imagePrompt: prompt, imageAssetId: assetId, imageStatus: "done", imageError: null });
}

async function runLocalFluxImagesStage(projectId: string, config: StoryConfig, onScene?: (done: number, total: number) => void, jobId = `images_${projectId}`): Promise<{ generated: number; failed: number }> {
  const scenes = listStoryScenes(projectId);
  const seen = new Set<number>();
  if (config.characterConsistency.enabled && config.characterConsistency.mode === "reference_images" && config.characters.length) {
    await spawnPythonStage({
      jobId: `${jobId}_characters`,
      projectId,
      scriptName: "generate_character_portraits.py",
      args: ["--project", projectDir(projectId)],
      config,
      onLine: (line, stream) => {
        if (jobId) logJob(jobId, stream === "stderr" ? "warn" : "info", line);
      },
    });
  }
  await spawnPythonStage({
    jobId,
    projectId,
    scriptName: "generate_local_images.py",
    args: ["--project", projectDir(projectId)],
    config,
    onLine: (line, stream) => {
      if (stream === "stderr" && jobId) logJob(jobId, "warn", line);
      const match = line.match(/scene\s+(\d+)/i);
      if (!match) return;
      const sceneId = Number(match[1]);
      if (!Number.isFinite(sceneId) || seen.has(sceneId)) return;
      seen.add(sceneId);
      onScene?.(seen.size, scenes.length);
    },
  });
  if (seen.size < scenes.length) onScene?.(scenes.length, scenes.length);
  return ingestImageManifest(projectId, "flux2");
}

function ingestImageManifest(projectId: string, provider: string): { generated: number; failed: number } {
  const manifestPath = join(projectDir(projectId), "images", "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Image manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { scenes?: Array<Record<string, unknown>> };
  const scenes = new Map(listStoryScenes(projectId).map((scene) => [scene.sceneId, scene]));
  let generated = 0;
  let failed = 0;
  for (const entry of manifest.scenes ?? []) {
    const sceneId = Number(entry.scene_id);
    const outputPath = String(entry.output_path ?? "");
    const scene = scenes.get(sceneId);
    if (!scene) continue;
    if (outputPath && existsSync(outputPath) && statSync(outputPath).size > 0 && entry.status !== "failed") {
      const assetId = id("asset");
      execSql(`
        INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
        VALUES (
          ${sql(assetId)}, ${sql(projectId)}, 'image', 'generated', NULL, ${sql(outputPath)},
          ${sql(JSON.stringify({ sceneId, provider, fileUrl: localFileUrl(outputPath) }))}, ${sql(now())}
        );
      `);
      upsertStoryScene({ ...sceneToInput(scene), imageAssetId: assetId, imageStatus: "done", imageError: null });
      generated += 1;
    } else {
      const error = String(entry.error ?? "Local image generation failed.");
      upsertStoryScene({ ...sceneToInput(scene), imageStatus: "failed", imageError: error.slice(0, 1200) });
      failed += 1;
    }
  }
  return { generated, failed };
}

function localProviderReady(providerId: string): boolean {
  const provider = getProvider(providerId);
  return Boolean(provider?.enabled && provider.status === "connected");
}

function sceneToInput(scene: ReturnType<typeof listStoryScenes>[number]) {
  return {
    projectId: scene.projectId,
    sceneId: scene.sceneId,
    title: scene.title,
    narrationText: scene.narrationText,
    imagePrompt: scene.imagePrompt,
    negativePrompt: scene.negativePrompt,
    characters: scene.characters,
    continuityNotes: scene.continuityNotes,
    estimatedDurationSeconds: scene.estimatedDurationSeconds,
    audioAssetId: scene.audioAssetId,
    audioStatus: scene.audioStatus,
    audioStartSeconds: scene.audioStartSeconds,
    audioDurationSeconds: scene.audioDurationSeconds,
    audioError: scene.audioError,
  };
}

async function retry<T>(work: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/(429|500|502|503|504)/.test(message) || attempt === 2) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
