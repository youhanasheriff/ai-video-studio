import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { GenerationJob, ShortGenerationRequest } from "../shared/types";
import { getProvider, parseJson } from "./db";
import { clamp } from "./ffmpeg";
import { localFileUrl, projectDir } from "./paths";
import { readProviderSecret, resolveOpenAiCompatibleTtsFormat, resolveOpenAiCompatibleTtsInputLimit, resolveOpenAiCompatibleTtsVoice } from "./providers";

export interface OpenAiSpeechOptions {
  script: string;
  voiceName: string;
  voiceSpeed: number;
  outPath: string;
  providerId?: string;
}

export async function synthesizeOpenAiSpeech({
  script,
  voiceName,
  voiceSpeed,
  outPath,
  providerId = "openai",
}: OpenAiSpeechOptions): Promise<{ audioPath: string; audioUrl: string; provider: string } | null> {
  const provider = getProvider(providerId);
  if (!provider) return null;
  // A saved key is sufficient; the "enabled" toggle is only an auto-discovery default.
  const secret = readProviderSecret(providerId);
  if (!secret) return null;

  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const modelName = String(config.modelName || config.ttsModel || "tts-1").trim();
  const baseUrl = (provider.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const responseFormat = resolveOpenAiCompatibleTtsFormat({ baseUrl: provider.base_url, modelName });
  const inputLimit = resolveOpenAiCompatibleTtsInputLimit({ baseUrl: provider.base_url, modelName });
  const targetPath = withAudioExtension(outPath, responseFormat);
  const body: Record<string, unknown> = {
    model: modelName,
    input: script.trim().slice(0, inputLimit) || "AI Video Studio",
    voice: resolveOpenAiCompatibleTtsVoice(voiceName, { baseUrl: provider.base_url, modelName }),
    response_format: responseFormat,
  };
  if (responseFormat !== "wav") body.speed = clamp(voiceSpeed || 1, 0.25, 4);

  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI TTS failed (${response.status}): ${detail.slice(0, 500) || response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(targetPath), { recursive: true });
  await import("node:fs/promises").then((fs) => fs.writeFile(targetPath, buffer));
  return { audioPath: targetPath, audioUrl: localFileUrl(targetPath), provider: "OpenAI TTS" };
}

export async function generateOpenAiSpeech(job: GenerationJob): Promise<{ audioPath: string; audioUrl: string; provider: string } | null> {
  const request = job.request as ShortGenerationRequest;
  const options = {
    script: request.script,
    voiceName: request.voiceName,
    voiceSpeed: request.voiceSpeed,
    outPath: join(projectDir(job.projectId), "audio", `${job.id}-voice.mp3`),
  };
  return (await synthesizeOpenAiSpeech({
    ...options,
    providerId: "openai-tts",
  })) ?? synthesizeOpenAiSpeech({
    ...options,
    providerId: "openai",
  });
}

export async function testOpenAiVoice({
  text,
  voiceName,
  voiceSpeed,
}: {
  text?: string;
  voiceName: string;
  voiceSpeed: number;
}): Promise<{ audioPath: string; audioUrl: string; provider: string }> {
  const previewDir = join(tmpdir(), "ai-video-studio", "voice-previews");
  const outPath = join(previewDir, `${randomUUID()}.mp3`);
  const script = text?.trim() || "This is an AI Video Studio voice preview.";
  const result = (await synthesizeOpenAiSpeech({
    script,
    voiceName,
    voiceSpeed,
    outPath,
    providerId: "openai-tts",
  })) ?? await synthesizeOpenAiSpeech({
    script,
    voiceName,
    voiceSpeed,
    outPath,
    providerId: "openai",
  });
  if (!result) throw new Error("OpenAI TTS is not enabled or no API key is saved.");
  return result;
}

function withAudioExtension(outPath: string, extension: "mp3" | "wav"): string {
  return /\.[^/\\.]+$/.test(outPath) ? outPath.replace(/\.[^/\\.]+$/, `.${extension}`) : `${outPath}.${extension}`;
}
