import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryConfig } from "../../../shared/types";
import { execSql, getProvider, id, logJob, now, parseJson, sql } from "../../db";
import { probeDuration, runFfmpeg } from "../../ffmpeg";
import { projectDir } from "../../paths";
import { resolveOpenAiCompatibleTtsInputLimit } from "../../providers";
import { synthesizeOpenAiSpeech } from "../../tts";
import { listStoryScenes, upsertStoryScene } from "../scenes";
import { spawnPythonStage } from "../subprocess";

export async function runTtsStage(projectId: string, config: StoryConfig, onScene?: (done: number, total: number) => void, jobId?: string): Promise<{ totalDuration: number; chunks: number }> {
  if (config.voiceProvider === "cosyvoice") {
    if (localProviderReady("cosyvoice")) {
      return runLocalCosyVoiceStage(projectId, config, onScene, jobId);
    }
    if (jobId) logJob(jobId, "warn", "CosyVoice provider is not connected; falling back to OpenAI TTS.");
  }
  const scenes = listStoryScenes(projectId);
  if (!scenes.length) throw new Error("No story scenes exist. Run writer first.");
  const audioDir = join(projectDir(projectId), "audio");
  mkdirSync(audioDir, { recursive: true });
  const concatPath = join(audioDir, "concat.txt");
  const chunks: Array<{ scene_id: number; chunk_path: string; start_seconds: number; duration_seconds: number }> = [];
  let cursor = 0;
  for (const [index, scene] of scenes.entries()) {
    const providerId = config.voiceProvider === "cosyvoice" ? "openai-tts" : config.voiceProvider || "openai-tts";
    const provider = getProvider(providerId);
    const providerConfig = parseJson<Record<string, unknown>>(provider?.config_json, {});
    const modelName = String(providerConfig.modelName || providerConfig.ttsModel || "tts-1").trim();
    const textParts = splitTextForTts(scene.narrationText, resolveOpenAiCompatibleTtsInputLimit({ baseUrl: provider?.base_url, modelName }));
    upsertStoryScene({ ...sceneToInput(scene), audioStatus: "generating", audioError: null });
    const sceneStart = cursor;
    const sceneChunkPaths: string[] = [];
    let sceneDuration = 0;
    let providerName = "OpenAI TTS";
    for (const [partIndex, textPart] of textParts.entries()) {
      const requestedChunkPath = join(audioDir, `chunk_${String(scene.sceneId).padStart(4, "0")}_${String(partIndex + 1).padStart(2, "0")}.mp3`);
      const audio = await synthesizeOpenAiSpeech({
        script: textPart,
        voiceName: config.voiceName,
        voiceSpeed: config.voiceSpeed,
        outPath: requestedChunkPath,
        providerId,
      });
      if (!audio) throw new Error(`TTS provider unavailable: ${config.voiceProvider}`);
      providerName = audio.provider;
      const chunkPath = audio.audioPath;
      const duration = await probeDuration(chunkPath) ?? Math.max(1, textPart.split(/\s+/).length / 2.5);
      sceneChunkPaths.push(chunkPath);
      chunks.push({ scene_id: scene.sceneId, chunk_path: chunkPath, start_seconds: cursor, duration_seconds: duration });
      cursor += duration;
      sceneDuration += duration;
    }
    const assetId = id("asset");
    execSql(`
      INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
      VALUES (
        ${sql(assetId)}, ${sql(projectId)}, 'audio', 'generated', NULL, ${sql(sceneChunkPaths[0] ?? "")},
        ${sql(JSON.stringify({ sceneId: scene.sceneId, provider: providerName, parts: sceneChunkPaths }))}, ${sql(now())}
      );
    `);
    upsertStoryScene({
      ...sceneToInput(scene),
      audioAssetId: assetId,
      audioStatus: "done",
      audioStartSeconds: sceneStart,
      audioDurationSeconds: sceneDuration,
      audioError: null,
    });
    onScene?.(index + 1, scenes.length);
  }
  writeFileSync(concatPath, chunks.map((chunk) => concatLine(chunk.chunk_path)).join(""), "utf8");
  const narrationPath = join(audioDir, "narration.mp3");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:a", "libmp3lame", narrationPath]);
  writeFileSync(join(audioDir, "timestamps.json"), JSON.stringify({
    provider: config.voiceProvider,
    total_duration_seconds: cursor,
    chunks,
  }, null, 2), "utf8");
  return { totalDuration: cursor, chunks: chunks.length };
}

async function runLocalCosyVoiceStage(projectId: string, config: StoryConfig, onScene?: (done: number, total: number) => void, jobId = `tts_${projectId}`): Promise<{ totalDuration: number; chunks: number }> {
  const scenes = listStoryScenes(projectId);
  const provider = getProvider("cosyvoice");
  const providerConfig = parseJson<Record<string, unknown>>(provider?.config_json, {});
  const repoPath = String(providerConfig.repoPath ?? providerConfig.binaryPath ?? "").trim();
  const condaEnv = String(providerConfig.condaEnv ?? "cosyvoice").trim() || "cosyvoice";
  const modelDir = String(providerConfig.modelDir ?? "").trim();
  const speaker = String(providerConfig.speaker ?? "").trim();
  const referenceAudio = String(providerConfig.referenceAudio ?? "").trim();
  const instruction = String(providerConfig.instruction ?? "").trim();
  const seen = new Set<number>();
  const args = ["--project", projectDir(projectId), "--force"];
  if (repoPath) args.push("--cosyvoice-dir", repoPath);
  if (modelDir) args.push("--model-dir", modelDir);
  if (speaker) args.push("--speaker", speaker);
  if (referenceAudio) args.push("--reference-audio", referenceAudio);
  if (instruction) args.push("--instruction", instruction);
  await spawnPythonStage({
    jobId,
    projectId,
    scriptName: "cosyvoice_tts.py",
    args,
    config,
    command: "conda",
    commandArgs: ["run", "-n", condaEnv, "python"],
    onLine: (line, stream) => {
      if (stream === "stderr" && jobId) logJob(jobId, "warn", line);
      const match = line.match(/(?:chunk|scene)_(\d+)|scene\s+(\d+)/i);
      if (!match) return;
      const sceneId = Number(match[1] ?? match[2]);
      if (!Number.isFinite(sceneId) || seen.has(sceneId)) return;
      seen.add(sceneId);
      onScene?.(seen.size, scenes.length);
    },
  });
  if (seen.size < scenes.length) onScene?.(scenes.length, scenes.length);
  return ingestCosyVoiceTimestamps(projectId);
}

async function ingestCosyVoiceTimestamps(projectId: string): Promise<{ totalDuration: number; chunks: number }> {
  const audioDir = join(projectDir(projectId), "audio");
  const timestampsPath = join(audioDir, "timestamps.json");
  if (!existsSync(timestampsPath)) throw new Error(`CosyVoice timestamps not found: ${timestampsPath}`);
  const payload = JSON.parse(readFileSync(timestampsPath, "utf8")) as {
    total_duration_seconds?: number;
    chunks?: Array<{ scene_id: number; chunk_path: string; start_seconds: number; duration_seconds: number }>;
  };
  const scenes = new Map(listStoryScenes(projectId).map((scene) => [scene.sceneId, scene]));
  for (const chunk of payload.chunks ?? []) {
    const scene = scenes.get(Number(chunk.scene_id));
    if (!scene) continue;
    const assetId = id("asset");
    execSql(`
      INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
      VALUES (
        ${sql(assetId)}, ${sql(projectId)}, 'audio', 'generated', NULL, ${sql(chunk.chunk_path)},
        ${sql(JSON.stringify({ sceneId: chunk.scene_id, provider: "cosyvoice" }))}, ${sql(now())}
      );
    `);
    upsertStoryScene({
      ...sceneToInput(scene),
      audioAssetId: assetId,
      audioStatus: "done",
      audioStartSeconds: Number(chunk.start_seconds) || 0,
      audioDurationSeconds: Number(chunk.duration_seconds) || 0,
      audioError: null,
    });
  }
  const wavPath = join(audioDir, "narration.wav");
  const mp3Path = join(audioDir, "narration.mp3");
  if (existsSync(wavPath)) {
    await runFfmpeg(["-y", "-i", wavPath, "-c:a", "libmp3lame", "-q:a", "2", mp3Path]);
  }
  return { totalDuration: Number(payload.total_duration_seconds) || 0, chunks: payload.chunks?.length ?? 0 };
}

function concatLine(path: string): string {
  return `file '${path.replaceAll("'", "'\\''")}'\n`;
}

function splitTextForTts(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return ["AI Video Studio"];
  const limit = Math.max(80, maxChars);
  if (clean.length <= limit) return [clean];
  const parts: string[] = [];
  let remaining = clean;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const sentenceBreak = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
    const commaBreak = window.lastIndexOf(", ");
    const spaceBreak = window.lastIndexOf(" ");
    const cut = sentenceBreak > limit * 0.45 ? sentenceBreak + 1 : commaBreak > limit * 0.55 ? commaBreak + 1 : Math.max(1, spaceBreak);
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
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
    imageAssetId: scene.imageAssetId,
    imageStatus: scene.imageStatus,
    imageError: scene.imageError,
  };
}

function localProviderReady(providerId: string): boolean {
  const provider = getProvider(providerId);
  return Boolean(provider?.enabled && provider.status === "connected");
}
