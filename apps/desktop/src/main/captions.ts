import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { ShortGenerationRequest } from "../shared/types";
import { getProvider, parseJson } from "./db";
import { probeDuration } from "./ffmpeg";
import { projectDir, runtimeEnv } from "./paths";
import { readProviderSecret } from "./providers";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface AssSubtitleOptions {
  width: number;
  height: number;
  fontSize: number;
  position: "top" | "center" | "bottom";
  primaryColor: string;
  highlightColor: string;
  fontFamily?: string;
  animation?: "none" | "fade" | "karaoke" | "typewriter";
}

export async function transcribeWordTimestamps(audioPath: string, options: { providerId?: string; projectId?: string; script?: string; duration?: number } = {}): Promise<WordTimestamp[]> {
  const cachePath = options.projectId ? join(projectDir(options.projectId), "captions", `${hashFile(audioPath)}.words.json`) : null;
  if (cachePath && existsSync(cachePath)) {
    return parseJson<WordTimestamp[]>(readFileSync(cachePath, "utf8"), []);
  }
  let words: WordTimestamp[] = [];
  try {
    words = await transcribeOpenAi(audioPath, options.providerId ?? "openai-chat");
  } catch {
    words = await transcribeWhisperCli(audioPath).catch(() => []);
  }
  if (!words.length && options.script) {
    words = await approximateWordTimestamps(options.script, options.duration ?? await probeDuration(audioPath) ?? 0);
  }
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(words, null, 2), "utf8");
  }
  return words;
}

export async function approximateWordTimestamps(script: string, duration: number): Promise<WordTimestamp[]> {
  const words = script.match(/\S+/g) ?? [];
  if (!words.length) return [];
  const total = Math.max(duration, words.length * 0.18);
  const slot = total / words.length;
  return words.map((word, index) => {
    const start = index * slot;
    const end = index === words.length - 1 ? total : Math.max(start + 0.08, (index + 1) * slot - 0.02);
    return { word, start, end };
  });
}

export function buildAssSubtitles(words: WordTimestamp[], options: AssSubtitleOptions): string {
  const primary = normalizeAssColor(options.primaryColor || "#FFFFFF");
  const highlight = normalizeAssColor(options.highlightColor || options.primaryColor || "#FFFF00");
  const alignment = resolveAlignment(options.position);
  const marginV = options.position === "top" ? 120 : options.position === "center" ? 0 : 150;
  const header = `[Script Info]
Title: AI Video Studio Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${options.width}
PlayResY: ${options.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${assText(options.fontFamily || "Arial")},${Math.max(12, Math.round(options.fontSize))},${primary},${highlight},&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,${alignment},50,50,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const lines = groupCaptionLines(words, 5).map((line) => dialogueLine(line, options.animation ?? "karaoke"));
  return [header, ...lines].join("\n");
}

export function writeAssForRequest(projectId: string, request: ShortGenerationRequest, words: WordTimestamp[], width: number, height: number): string | null {
  if (!request.subtitleSettings?.enabled || !words.length) return null;
  const captionsDir = join(projectDir(projectId), "captions");
  mkdirSync(captionsDir, { recursive: true });
  const assPath = join(captionsDir, "narration.ass");
  writeFileSync(assPath, buildAssSubtitles(words, {
    width,
    height,
    fontSize: request.subtitleSettings.fontSize,
    position: request.subtitleSettings.position,
    primaryColor: request.subtitleSettings.primaryColor,
    highlightColor: request.subtitleSettings.highlightColor,
    animation: request.subtitleSettings.animation,
    fontFamily: "Arial",
  }), "utf8");
  return assPath;
}

export function normalizeAssColor(color: string): string {
  const stripped = (color || "").trim();
  if (/^&H[0-9A-Fa-f]{8}$/.test(stripped)) return stripped.toUpperCase();
  const match = stripped.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!match) return "&H00FFFFFF";
  const value = match[1];
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase();
}

export function resolveAlignment(position: string): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

export function groupCaptionLines(words: WordTimestamp[], wordsPerLine = 5): WordTimestamp[][] {
  const lines: WordTimestamp[][] = [];
  let current: WordTimestamp[] = [];
  for (const word of words) {
    current.push(word);
    const text = word.word.trim();
    const shouldBreak = current.length >= wordsPerLine || /[.!?,;:]$/.test(text);
    if (shouldBreak) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

export function escapeAssFilterPath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

async function transcribeOpenAi(audioPath: string, providerId: string): Promise<WordTimestamp[]> {
  const provider = getProvider(providerId) ?? getProvider("openai-chat") ?? getProvider("openai");
  if (!provider) throw new Error("OpenAI transcription provider not found");
  const secret = readProviderSecret(provider.id);
  if (!secret) throw new Error("OpenAI transcription key is missing");
  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const baseUrl = (provider.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const form = new FormData();
  form.append("model", String(config.whisperModel || "whisper-1"));
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("file", new Blob([readFileSync(audioPath)]), audioPath.split(/[\\/]/).pop() || "audio.mp3");
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI transcription failed (${response.status}): ${detail.slice(0, 500) || response.statusText}`);
  }
  const data = await response.json() as { words?: Array<{ word: string; start: number; end: number }> };
  return normalizeWords(data.words ?? []);
}

async function transcribeWhisperCli(audioPath: string): Promise<WordTimestamp[]> {
  const outDir = dirname(audioPath);
  const baseName = audioPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "audio";
  await runCommand("whisper", [audioPath, "--model", "base", "--output_format", "json", "--word_timestamps", "True", "--output_dir", outDir]);
  const jsonPath = join(outDir, `${baseName}.json`);
  if (!existsSync(jsonPath)) return [];
  const data = JSON.parse(readFileSync(jsonPath, "utf8")) as { segments?: Array<{ words?: Array<{ word: string; start: number; end: number }> }> };
  return normalizeWords((data.segments ?? []).flatMap((segment) => segment.words ?? []));
}

function normalizeWords(words: Array<{ word: string; start: number; end: number }>): WordTimestamp[] {
  return words
    .map((word) => ({ word: String(word.word ?? "").trim(), start: Number(word.start), end: Number(word.end) }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
}

function dialogueLine(words: WordTimestamp[], animation: AssSubtitleOptions["animation"]): string {
  const start = words[0]?.start ?? 0;
  const end = Math.max(words.at(-1)?.end ?? start + 1, start + 0.5) + 0.1;
  const text = animation === "karaoke" || animation === "typewriter"
    ? words.map((word) => `{\\kf${Math.max(1, Math.round((word.end - word.start) * 100))}}${assText(word.word)}`).join(" ")
    : `${animation === "fade" ? "{\\fad(120,120)}" : ""}${words.map((word) => assText(word.word)).join(" ")}`;
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe % 1) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function assText(text: string): string {
  return text.replaceAll("{", "(").replaceAll("}", ")").replaceAll("\n", "\\N");
}

function hashFile(path: string): string {
  return createHash("sha1").update(readFileSync(path)).digest("hex").slice(0, 20);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], env: runtimeEnv() });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1000) || `${command} exited with code ${code}`));
    });
  });
}
