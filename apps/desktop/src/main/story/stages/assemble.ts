import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryConfig } from "../../../shared/types";
import { probeDuration, runFfmpeg } from "../../ffmpeg";
import { projectDir } from "../../paths";
import { listStoryScenes } from "../scenes";
import { videoSize } from "./subtitles";

export async function runAssembleStage(projectId: string, config: StoryConfig, onScene?: (done: number, total: number) => void): Promise<{ intermediatePath: string; duration: number }> {
  const scenes = listStoryScenes(projectId);
  if (!scenes.length) throw new Error("No story scenes to assemble");
  const dir = projectDir(projectId);
  const segmentDir = join(dir, "video", "_segments");
  mkdirSync(segmentDir, { recursive: true });
  const [width, height] = videoSize(config.style.aspectRatio);
  const segments: string[] = [];
  for (const [index, scene] of scenes.entries()) {
    const imagePath = join(dir, "images", `scene_${String(scene.sceneId).padStart(4, "0")}.png`);
    if (!existsSync(imagePath)) throw new Error(`Missing image for scene ${scene.sceneId}: ${imagePath}`);
    const duration = Math.max(1, scene.audioDurationSeconds ?? scene.estimatedDurationSeconds ?? 4);
    const segmentPath = join(segmentDir, `seg_${String(scene.sceneId).padStart(4, "0")}.mp4`);
    if (!existsSync(segmentPath)) {
      const filter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p[v]`;
      await runFfmpeg([
        "-y",
        "-loop",
        "1",
        "-t",
        duration.toFixed(3),
        "-i",
        imagePath,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        segmentPath,
      ]);
    }
    segments.push(segmentPath);
    onScene?.(index + 1, scenes.length);
  }
  const concatPath = join(segmentDir, "concat.txt");
  writeFileSync(concatPath, segments.map((segment) => concatLine(segment)).join(""), "utf8");
  const intermediatePath = join(dir, "video", "story_silent.mp4");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c:v", "copy", intermediatePath]);
  const duration = await probeDuration(intermediatePath) ?? 0;
  return { intermediatePath, duration };
}

function concatLine(path: string): string {
  return `file '${path.replaceAll("'", "'\\''")}'\n`;
}

export function calculateXfadeOffsets(durations: number[], transitionSeconds: number): number[] {
  const transition = Math.max(0, transitionSeconds);
  const offsets: number[] = [];
  let adjustedSum = 0;
  for (let index = 0; index < durations.length - 1; index += 1) {
    adjustedSum += Math.max(0, durations[index] ?? 0) + transition;
    offsets.push(Number((adjustedSum - (index + 1) * transition).toFixed(3)));
  }
  return offsets;
}
