import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GenerationJob, StoryConfig } from "../../../shared/types";
import { execSql, id, now, sql } from "../../db";
import { runFfmpeg } from "../../ffmpeg";
import { localFileUrl, projectDir } from "../../paths";

export async function runFinalizeStage(job: GenerationJob, config: StoryConfig): Promise<NonNullable<GenerationJob["result"]>> {
  const dir = projectDir(job.projectId);
  const intermediatePath = join(dir, "video", "story_silent.mp4");
  const narrationPath = join(dir, "audio", "narration.mp3");
  const assPath = join(dir, "captions", "narration.ass");
  if (!existsSync(intermediatePath)) throw new Error(`Assembled video missing: ${intermediatePath}`);
  if (!existsSync(narrationPath)) throw new Error(`Narration audio missing: ${narrationPath}`);
  const renderDir = join(dir, "renders");
  mkdirSync(renderDir, { recursive: true });
  const outputPath = join(renderDir, `${job.id}.mp4`);
  const subtitlesEnabled = config.subtitles.enabled && existsSync(assPath);
  await runFfmpeg([
    "-y",
    "-i",
    intermediatePath,
    "-i",
    narrationPath,
    ...(subtitlesEnabled
      ? ["-vf", `ass=${escapeFilterPath(assPath)}`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]
      : ["-c:v", "copy"]),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  execSql(`
    INSERT INTO exports (id, project_id, job_id, output_path, format, created_at)
    VALUES (${sql(id("export"))}, ${sql(job.projectId)}, ${sql(job.id)}, ${sql(outputPath)}, 'mp4', ${sql(now())});
    UPDATE projects SET status = 'completed', updated_at = ${sql(now())} WHERE id = ${sql(job.projectId)};
  `);
  return {
    outputPath,
    outputUrl: localFileUrl(outputPath),
    audioPath: narrationPath,
    audioUrl: localFileUrl(narrationPath),
    provider: `Story pipeline (${config.imageProvider}, ${config.voiceProvider})`,
  };
}

function escapeFilterPath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}
