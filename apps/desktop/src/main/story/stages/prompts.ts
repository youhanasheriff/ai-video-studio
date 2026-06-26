import type { StoryConfig } from "../../../shared/types";
import { chatCompletion, extractJsonObject } from "../llm";
import { listStoryScenes, upsertStoryScene, writeScenesJson } from "../scenes";

const PROMPT_PROMPTER = `You are the Image Prompt subagent in a story-to-video pipeline.
Return strict JSON with a "scenes" array. Each scene object must include:
scene_id, title, image_prompt, negative_prompt, continuity_notes, estimated_duration_seconds, characters.
Every image_prompt must be standalone and include subject, setting, lighting, composition, medium, palette, and style lock.`;

export async function runPromptsStage(projectId: string, config: StoryConfig): Promise<{ sceneCount: number }> {
  const scenes = listStoryScenes(projectId);
  if (!scenes.length) throw new Error("No story scenes exist. Run writer first.");
  const response = await chatCompletion({
    providerId: config.llmProviderId,
    model: config.llmModel,
    json: true,
    messages: [
      { role: "system", content: PROMPT_PROMPTER },
      {
        role: "user",
        content: JSON.stringify({
          style: config.style,
          scenes: scenes.map((scene) => ({
            scene_id: scene.sceneId,
            title: scene.title,
            narration: scene.narrationText,
            estimated_duration_seconds: scene.estimatedDurationSeconds,
          })),
        }),
      },
    ],
  }).catch(async () => {
    return chatCompletion({
      providerId: config.llmProviderId,
      model: config.llmModel,
      json: false,
      messages: [
        { role: "system", content: `${PROMPT_PROMPTER}\nIf you cannot use JSON mode, still return only parseable JSON.` },
        { role: "user", content: scenes.map((scene) => `Scene ${scene.sceneId}: ${scene.title}\n${scene.narrationText}`).join("\n\n") },
      ],
    });
  });
  const parsed = extractJsonObject(response) as { scenes?: Array<Record<string, unknown>> };
  const byId = new Map((parsed.scenes ?? []).map((scene) => [Number(scene.scene_id), scene]));
  for (const scene of scenes) {
    const prompt = byId.get(scene.sceneId);
    const imagePrompt = String(prompt?.image_prompt || fallbackPrompt(scene.title, scene.narrationText, config));
    upsertStoryScene({
      projectId,
      sceneId: scene.sceneId,
      title: String(prompt?.title || scene.title),
      narrationText: scene.narrationText,
      imagePrompt,
      negativePrompt: String(prompt?.negative_prompt || "text, words, letters, captions, subtitles, watermark, logo, blurry, low quality"),
      characters: Array.isArray(prompt?.characters) ? prompt.characters : [],
      continuityNotes: String(prompt?.continuity_notes || ""),
      estimatedDurationSeconds: Number(prompt?.estimated_duration_seconds || scene.estimatedDurationSeconds || 0) || null,
      imageStatus: scene.imageStatus === "done" ? "done" : "pending",
      audioStatus: scene.audioStatus,
    });
  }
  writeScenesJson(projectId);
  return { sceneCount: scenes.length };
}

function fallbackPrompt(title: string, narration: string, config: StoryConfig): string {
  return [
    `${title}: ${narration.split(/[.!?]/)[0]?.slice(0, 180) || "A cinematic story moment"}`,
    `setting and atmosphere matching ${config.style.genre}`,
    "soft directional light, cinematic depth, detailed environment",
    "wide environmental composition, subject readable, no text",
    `${config.style.visualStyle}, ${config.style.palette ?? ""}, ${config.style.styleLock ?? ""}, ${config.style.aspectRatio} composition`,
  ].filter(Boolean).join(" | ");
}
