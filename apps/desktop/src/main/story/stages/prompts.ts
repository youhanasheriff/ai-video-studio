import type { StoryConfig } from "../../../shared/types";
import { mergeStoryCharacters, normalizeSceneCharacterKeys } from "../../../shared/characters";
import { saveStoryConfig } from "../config";
import { chatCompletion, extractJsonObject } from "../llm";
import { listStoryScenes, upsertStoryScene, writeScenesJson } from "../scenes";

const PROMPT_PROMPTER = `You are the Image Prompt subagent in a story-to-video pipeline.
Return strict JSON with top-level "characters" and "scenes" arrays.
Each character must include: key, name, visual_token, wardrobe, portrait_pose, portrait_background.
Each scene must include: scene_id, title, image_prompt, negative_prompt, continuity_notes, estimated_duration_seconds, characters_in_scene.
Use stable character keys in characters_in_scene. Every recurring character must have one exact visual_token and wardrobe description reused verbatim in every scene prompt where that character appears.
Every image_prompt must be standalone and include subject, setting, lighting, composition, medium, palette, style lock, and the exact visual tokens for characters_in_scene.`;

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
          existing_characters: config.characters,
          character_consistency: config.characterConsistency,
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
  const parsed = extractJsonObject(response) as { characters?: unknown[]; scenes?: Array<Record<string, unknown>> };
  const generatedCharacters = mergeStoryCharacters(config.characters, parsed.characters, parsed.scenes?.flatMap((scene) => scene.characters ?? scene.characters_in_scene ?? []));
  const nextConfig = { ...config, characters: generatedCharacters };
  config.characters = generatedCharacters;
  saveStoryConfig(projectId, nextConfig);
  const byId = new Map((parsed.scenes ?? []).map((scene) => [Number(scene.scene_id), scene]));
  for (const scene of scenes) {
    const prompt = byId.get(scene.sceneId);
    const sceneCharacters = normalizeSceneCharacterKeys(prompt?.characters_in_scene ?? prompt?.characters ?? scene.characters, generatedCharacters);
    const imagePrompt = withCharacterConsistency(
      String(prompt?.image_prompt || fallbackPrompt(scene.title, scene.narrationText, config, sceneCharacters, generatedCharacters)),
      sceneCharacters,
      generatedCharacters,
      config.characterConsistency.enabled,
    );
    upsertStoryScene({
      projectId,
      sceneId: scene.sceneId,
      title: String(prompt?.title || scene.title),
      narrationText: scene.narrationText,
      imagePrompt,
      negativePrompt: String(prompt?.negative_prompt || "text, words, letters, captions, subtitles, watermark, logo, blurry, low quality"),
      characters: sceneCharacters,
      continuityNotes: String(prompt?.continuity_notes || ""),
      estimatedDurationSeconds: Number(prompt?.estimated_duration_seconds || scene.estimatedDurationSeconds || 0) || null,
      imageStatus: scene.imageStatus === "done" ? "done" : "pending",
      audioStatus: scene.audioStatus,
    });
  }
  writeScenesJson(projectId);
  return { sceneCount: scenes.length };
}

function fallbackPrompt(title: string, narration: string, config: StoryConfig, characterKeys: string[], characters: StoryConfig["characters"]): string {
  return [
    `${title}: ${narration.split(/[.!?]/)[0]?.slice(0, 180) || "A cinematic story moment"}`,
    characterSuffix(characterKeys, characters),
    `setting and atmosphere matching ${config.style.genre}`,
    "soft directional light, cinematic depth, detailed environment",
    "wide environmental composition, subject readable, no text",
    `${config.style.visualStyle}, ${config.style.palette ?? ""}, ${config.style.styleLock ?? ""}, ${config.style.aspectRatio} composition`,
  ].filter(Boolean).join(" | ");
}

function withCharacterConsistency(prompt: string, characterKeys: string[], characters: StoryConfig["characters"], enabled: boolean): string {
  if (!enabled || !characterKeys.length) return prompt;
  const suffix = characterSuffix(characterKeys, characters);
  if (!suffix) return prompt;
  const missing = characterKeys.some((key) => {
    const character = characters.find((entry) => entry.key === key);
    return character?.visualToken && !prompt.toLowerCase().includes(character.visualToken.toLowerCase());
  });
  return missing ? `${prompt.replace(/\s+$/, "")} | ${suffix}` : prompt;
}

function characterSuffix(characterKeys: string[], characters: StoryConfig["characters"]): string {
  const parts = characterKeys
    .map((key) => characters.find((character) => character.key === key))
    .filter(Boolean)
    .map((character) => `${character!.visualToken}${character!.wardrobe ? `, ${character!.wardrobe}` : ""}`);
  return parts.length ? `character consistency: ${parts.join("; ")}` : "";
}
