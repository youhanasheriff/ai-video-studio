import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryConfig } from "../../../shared/types";
import { execSql, now, sql } from "../../db";
import { projectDir } from "../../paths";
import { chatCompletion } from "../llm";
import { upsertStoryScene } from "../scenes";
import { updateProjectScript, writeStoryConfigFiles } from "../config";

const WRITER_PROMPT = `You are the Writer subagent in a story-to-video pipeline.
Write narration for the ear, not the eye. Use explicit scene headings exactly like:
## Scene 0001: Scene title
Do not include camera directions or markdown inside scene bodies. Keep each scene self-contained and TTS-friendly.`;

export async function runWriterStage(projectId: string, config: StoryConfig): Promise<{ sceneCount: number; wordCount: number }> {
  writeStoryConfigFiles(projectId, config);
  const response = await chatCompletion({
    providerId: config.llmProviderId,
    model: config.llmModel,
    messages: [
      { role: "system", content: WRITER_PROMPT },
      {
        role: "user",
        content: [
          `Seed:\n${config.seed}`,
          `Target words: ${config.target.scriptWords}`,
          `Scene count: ${config.target.sceneCount}`,
          `Genre: ${config.style.genre}`,
          `Visual style: ${config.style.visualStyle}`,
          "Return only the full script, starting with a # title line followed by scene blocks.",
        ].join("\n\n"),
      },
    ],
  });
  const script = normalizeScript(response, config);
  const scenes = splitScriptIntoScenes(script, config.target.sceneCount);
  const dir = projectDir(projectId);
  writeFileSync(join(dir, "script.md"), script, "utf8");
  writeFileSync(join(dir, "outline.md"), scenes.map((scene) => `- Scene ${String(scene.sceneId).padStart(4, "0")}: ${scene.title}`).join("\n"), "utf8");
  writeFileSync(join(dir, "metadata.json"), JSON.stringify({ title: firstTitle(script), genre: config.style.genre, language: "en" }, null, 2), "utf8");
  updateProjectScript(projectId, script);
  execSql(`DELETE FROM story_scenes WHERE project_id = ${sql(projectId)} AND scene_id > ${sql(config.target.sceneCount)};`);
  for (const scene of scenes) {
    upsertStoryScene({
      projectId,
      sceneId: scene.sceneId,
      title: scene.title,
      narrationText: scene.text,
      estimatedDurationSeconds: estimateSceneDuration(scene.text, config.voiceSpeed),
      imageStatus: "pending",
      audioStatus: "pending",
    });
  }
  return { sceneCount: scenes.length, wordCount: countWords(script) };
}

export function splitScriptIntoScenes(script: string, targetCount: number): Array<{ sceneId: number; title: string; text: string }> {
  const lines = script.split(/\r?\n/);
  const scenes: Array<{ sceneId: number; title: string; text: string[] }> = [];
  let current: { sceneId: number; title: string; text: string[] } | null = null;
  for (const line of lines) {
    const match = line.trim().match(/^## Scene\s+(\d+):\s*(.*)$/i);
    if (match) {
      if (current) scenes.push(current);
      current = { sceneId: Number(match[1]), title: match[2]?.trim() || `Scene ${match[1]}`, text: [] };
      continue;
    }
    if (current && !line.startsWith("#")) current.text.push(line);
  }
  if (current) scenes.push(current);
  if (scenes.length) {
    return scenes.map((scene) => ({
      sceneId: scene.sceneId,
      title: scene.title,
      text: scene.text.join(" ").replace(/\s+/g, " ").trim(),
    })).filter((scene) => scene.text);
  }
  const paragraphs = script.split(/\n\s*\n/).map((entry) => entry.replace(/^#+\s*/, "").trim()).filter(Boolean);
  const chunks = paragraphs.length ? paragraphs : [script.trim()];
  return Array.from({ length: Math.max(1, targetCount) }, (_, index) => ({
    sceneId: index + 1,
    title: `Scene ${String(index + 1).padStart(4, "0")}`,
    text: chunks[index % chunks.length],
  }));
}

function normalizeScript(text: string, config: StoryConfig): string {
  const trimmed = text.trim();
  if (/^#\s+/m.test(trimmed) && /^## Scene\s+\d+:/m.test(trimmed)) return trimmed;
  const title = config.seed.split(/\s+/).slice(0, 8).join(" ") || "Untitled Story";
  return `# ${title}\n\n${trimmed}`;
}

function firstTitle(script: string): string {
  return script.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Untitled Story";
}

function estimateSceneDuration(text: string, speed: number): number {
  return Math.max(3, Math.ceil(countWords(text) / Math.max(1, 2.5 * speed)));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
