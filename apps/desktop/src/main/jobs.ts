import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GenerationJob, ShortGenerationRequest } from "../shared/types";
import { approximateWordTimestamps, escapeAssFilterPath, transcribeWordTimestamps, type WordTimestamp, writeAssForRequest } from "./captions";
import { execSql, getJob, id, listAssets, logJob, now, sql, updateJob } from "./db";
import { clamp, escapeDrawText, estimateDuration, ffmpegColor, probeDuration, runFfmpeg } from "./ffmpeg";
import { localFileUrl, projectDir } from "./paths";
import { getStockClips } from "./stock";
import { generateOpenAiSpeech } from "./tts";
import { getMainWindow } from "./window";

export const activeJobs = new Set<string>();

export function notifyJob(jobId: string): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;
  const job = getJob(jobId);
  if (job) mainWindow.webContents.send("jobs:updated", job);
}

export async function renderPreview(
  job: GenerationJob,
  audio?: { audioPath: string; audioUrl: string; provider: string } | null,
  captionWords: WordTimestamp[] = [],
): Promise<{ outputPath: string; outputUrl: string; audioPath?: string; audioUrl?: string; provider?: string }> {
  const request = job.request as ShortGenerationRequest;
  const assets = listAssets(job.projectId).filter((asset) => asset.kind === "video");
  const dir = projectDir(job.projectId);
  const outputPath = join(dir, "renders", `${job.id}.mp4`);
  const ratio = request.aspectRatio || "9:16";
  const size = ratio === "16:9" ? "1920x1080" : ratio === "1:1" ? "1080x1080" : ratio === "4:5" ? "1080x1350" : "1080x1920";
  const [width, height] = size.split("x").map(Number);
  const audioDuration = audio?.audioPath ? await probeDuration(audio.audioPath) : null;
  const duration = audioDuration
    ? clamp(Math.ceil(audioDuration), 6, 180)
    : estimateDuration(request.script, request.voiceSpeed);
  const subtitle = request.subtitleSettings ?? {
    enabled: true,
    fontSize: 58,
    position: "bottom" as const,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    styleName: "Classic",
    animation: "none" as const,
  };
  const assPath = writeAssForRequest(job.projectId, request, captionWords, width, height);
  const caption = escapeDrawText(request.script || "AI Video Studio preview");
  const captionY =
    subtitle.position === "top"
      ? "120"
      : subtitle.position === "center"
        ? "(h-text_h)/2"
        : "h-320";
  const captionFilter = subtitle.enabled
    ? assPath
      ? `,subtitles=${escapeAssFilterPath(assPath)}`
      : `,drawtext=text='${caption}':fontcolor=${ffmpegColor(subtitle.primaryColor, "white")}:fontsize=${subtitle.fontSize || 58}:box=1:boxcolor=black@0.58:boxborderw=24:x=(w-text_w)/2:y=${captionY}`
    : "";
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${captionFilter},format=yuv420p`;
  const commonOutputArgs = [
    "-t",
    String(duration),
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    ...(audio?.audioPath ? ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest"] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath,
  ];

  if (assets[0]?.localPath && existsSync(assets[0].localPath)) {
    await runFfmpeg([
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      assets[0].localPath,
      ...(audio?.audioPath ? ["-i", audio.audioPath] : []),
      ...commonOutputArgs,
    ]);
  } else {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x111827:s=${size}:d=${duration}`,
      ...(audio?.audioPath ? ["-i", audio.audioPath] : []),
      ...commonOutputArgs,
    ]);
  }

  return {
    outputPath,
    outputUrl: localFileUrl(outputPath),
    audioPath: audio?.audioPath,
    audioUrl: audio?.audioUrl,
    provider: audio?.provider ?? "Silent FFmpeg render",
  };
}

export async function runGeneration(jobId: string): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    updateJob(jobId, { status: "preparing", progress: 8, currentStep: "Preparing project render...", startedAt: now() });
    logJob(jobId, "info", "Generation started.");
    notifyJob(jobId);

    const job = getJob(jobId);
    if (!job || job.status === "cancelled") return;

    updateJob(jobId, { status: "generating_audio", progress: 24, currentStep: "Checking configured voice providers..." });
    notifyJob(jobId);
    let audio: { audioPath: string; audioUrl: string; provider: string } | null = null;
    try {
      audio = await generateOpenAiSpeech(job);
      if (audio) logJob(jobId, "info", `Voice track generated with ${audio.provider}.`, { audioPath: audio.audioPath });
      else logJob(jobId, "warn", "No enabled TTS provider with a saved API key. Continuing with a silent render.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logJob(jobId, "warn", `${message}. Continuing with a silent render.`);
      audio = null;
    }

    updateJob(jobId, { status: "transcribing", progress: 45, currentStep: "Preparing caption overlay from script..." });
    notifyJob(jobId);
    const request = job.request as ShortGenerationRequest;
    let captionWords: WordTimestamp[] = [];
    if (request.subtitleSettings?.enabled !== false) {
      const duration = audio?.audioPath ? await probeDuration(audio.audioPath) : estimateDuration(request.script, request.voiceSpeed);
      try {
        captionWords = audio?.audioPath
          ? await transcribeWordTimestamps(audio.audioPath, {
              providerId: "openai-chat",
              projectId: job.projectId,
              script: request.script,
              duration: duration ?? undefined,
            })
          : await approximateWordTimestamps(request.script, duration ?? estimateDuration(request.script, request.voiceSpeed));
        logJob(jobId, "info", captionWords.length ? `Prepared ${captionWords.length} caption word timings.` : "No caption word timings available; using drawtext fallback.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logJob(jobId, "warn", `${message}. Using drawtext fallback.`);
      }
    }

    updateJob(jobId, { status: "assembling_media", progress: 62, currentStep: "Assembling imported clips and generated audio..." });
    notifyJob(jobId);
    if (request.mediaMode === "stock_provider" && !listAssets(job.projectId).some((asset) => asset.kind === "video")) {
      try {
        const stockAssets = await getStockClips(job.projectId, request);
        if (stockAssets.length) logJob(jobId, "info", `Downloaded ${stockAssets.length} stock clip${stockAssets.length === 1 ? "" : "s"}.`);
        else logJob(jobId, "warn", "No stock clips found; using generated color background.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logJob(jobId, "warn", `${message}. Continuing without stock clips.`);
      }
    }

    updateJob(jobId, { status: "rendering", progress: 80, currentStep: "Rendering MP4 with FFmpeg..." });
    logJob(jobId, "info", "FFmpeg render started.");
    notifyJob(jobId);

    const latestJob = getJob(jobId);
    if (!latestJob || latestJob.status === "cancelled") return;
    const result = await renderPreview(latestJob, audio, captionWords);
    updateJob(jobId, {
      status: "completed",
      progress: 100,
      currentStep: "Render complete",
      result,
      completedAt: now(),
    });
    execSql(`
      INSERT INTO exports (id, project_id, job_id, output_path, format, created_at)
      VALUES (${sql(id("export"))}, ${sql(job.projectId)}, ${sql(job.id)}, ${sql(result.outputPath)}, 'mp4', ${sql(now())});
      UPDATE projects SET status = 'completed', updated_at = ${sql(now())} WHERE id = ${sql(job.projectId)};
    `);
    logJob(jobId, "info", "Render completed.", result);
    notifyJob(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJob(jobId, {
      status: "failed",
      progress: 100,
      currentStep: "Render failed",
      error: message,
      completedAt: now(),
    });
    const job = getJob(jobId);
    if (job) {
      execSql(`UPDATE projects SET status = 'failed', updated_at = ${sql(now())} WHERE id = ${sql(job.projectId)};`);
    }
    logJob(jobId, "error", message);
    notifyJob(jobId);
  } finally {
    activeJobs.delete(jobId);
  }
}
