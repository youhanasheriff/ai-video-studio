import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { runtimeEnv } from "./paths";

const require = createRequire(import.meta.url);

export function ffmpegBinary(): string {
  try {
    const resolved = require("ffmpeg-static") as string | null;
    return resolved || "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

export function ffprobeBinary(): string {
  try {
    const resolved = require("ffprobe-static") as { path?: string } | string | null;
    return typeof resolved === "string" ? resolved : resolved?.path || "ffprobe";
  } catch {
    return "ffprobe";
  }
}

export function escapeDrawText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll("%", "\\%")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateDuration(script: string, speed = 1): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return clamp(Math.ceil(words / Math.max(1, 2.5 * speed)) + 1, 6, 90);
}

export function ffmpegColor(hex: string | undefined, fallback: string): string {
  const value = (hex || fallback).replace("#", "");
  return /^[0-9a-fA-F]{6}$/.test(value) ? `0x${value}` : fallback;
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegBinary(), args, { stdio: ["ignore", "pipe", "pipe"], env: runtimeEnv() });
    let stderr = "";
    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.split("\n").slice(-8).join("\n") || `ffmpeg exited with ${code}`));
    });
  });
}

export function probeDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const process = spawn(ffprobeBinary(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], {
      stdio: ["ignore", "pipe", "ignore"],
      env: runtimeEnv(),
    });
    let stdout = "";
    process.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    process.on("error", () => resolve(null));
    process.on("close", () => {
      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}

export function extractFrame(inputPath: string, outputPath: string, atSeconds = 1): Promise<void> {
  return runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, atSeconds)),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}
