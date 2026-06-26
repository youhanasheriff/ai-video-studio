import { describe, expect, it } from "vitest";
import { buildAssSubtitles, groupCaptionLines, normalizeAssColor } from "./captions";
import { clamp, escapeDrawText, estimateDuration, ffmpegColor } from "./ffmpeg";
import { installPlan, normalizeOpenAiVoice, resolveOpenAiCompatibleTtsFormat, resolveOpenAiCompatibleTtsInputLimit, resolveOpenAiCompatibleTtsVoice } from "./providers";
import { parseJson, shouldApplyLegacyOpenAiProviderState, sql } from "./db";
import { characterKey, mergeStoryCharacters, normalizeSceneCharacterKeys, toPipelineCharacter } from "../shared/characters";

describe("db helpers", () => {
  it("escapes SQL values", () => {
    expect(sql("Bob's clip")).toBe("'Bob''s clip'");
    expect(sql(null)).toBe("NULL");
    expect(sql(true)).toBe("1");
  });

  it("parses json with fallback", () => {
    expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(parseJson("{", { ok: true })).toEqual({ ok: true });
  });

  it("only applies legacy OpenAI provider state to untouched split providers", () => {
    expect(shouldApplyLegacyOpenAiProviderState({ enabled: 0, has_secret: 0, status: "disabled" }, false)).toBe(true);
    expect(shouldApplyLegacyOpenAiProviderState({ enabled: 1, has_secret: 0, status: "disabled" }, false)).toBe(false);
    expect(shouldApplyLegacyOpenAiProviderState({ enabled: 0, has_secret: 1, status: "disabled" }, false)).toBe(false);
    expect(shouldApplyLegacyOpenAiProviderState({ enabled: 0, has_secret: 0, status: "disabled" }, true)).toBe(false);
  });
});

describe("ffmpeg helpers", () => {
  it("clamps and estimates duration", () => {
    expect(clamp(12, 1, 10)).toBe(10);
    expect(estimateDuration("one two three four five", 1)).toBeGreaterThanOrEqual(6);
  });

  it("normalizes drawtext and colors", () => {
    expect(escapeDrawText("a:b's % value")).toContain("\\:");
    expect(ffmpegColor("#ff00aa", "white")).toBe("0xff00aa");
  });
});

describe("provider helpers", () => {
  it("maps legacy OpenAI voices", () => {
    expect(normalizeOpenAiVoice("nova")).toBe("coral");
    expect(normalizeOpenAiVoice("alloy")).toBe("alloy");
  });

  it("maps default OpenAI voices to Groq Orpheus voices", () => {
    expect(resolveOpenAiCompatibleTtsVoice("alloy", { baseUrl: "https://api.groq.com/openai/v1", modelName: "canopylabs/orpheus-v1-english" })).toBe("daniel");
    expect(resolveOpenAiCompatibleTtsVoice("hannah", { modelName: "canopylabs/orpheus-v1-english" })).toBe("hannah");
    expect(resolveOpenAiCompatibleTtsFormat({ modelName: "canopylabs/orpheus-v1-english" })).toBe("wav");
    expect(resolveOpenAiCompatibleTtsInputLimit({ modelName: "canopylabs/orpheus-v1-english" })).toBe(200);
  });

  it("has install plans", () => {
    expect(installPlan("flux2").command).toContain("mflux");
    expect(installPlan("openai-chat").guideUrl).toContain("platform.openai.com");
  });
});

describe("story character helpers", () => {
  it("normalizes character bible entries and scene keys for the pipeline", () => {
    const characters = mergeStoryCharacters([
      { name: "Rimuru Tempest", visual_token: "small translucent blue slime Rimuru", wardrobe: "glossy blue body" },
      { key: "rimuru_tempest", name: "Rimuru", visualToken: "Rimuru slime" },
    ]);

    expect(characterKey("Rimuru Tempest!")).toBe("rimuru_tempest");
    expect(characters).toHaveLength(1);
    expect(toPipelineCharacter(characters[0]).visual_token).toBe("small translucent blue slime Rimuru");
    expect(normalizeSceneCharacterKeys(["Rimuru"], characters)).toEqual(["rimuru_tempest"]);
  });
});

describe("caption helpers", () => {
  it("normalizes ASS colors and groups lines", () => {
    expect(normalizeAssColor("#112233")).toBe("&H00332211");
    const lines = groupCaptionLines([
      { word: "Hello", start: 0, end: 0.2 },
      { word: "world.", start: 0.2, end: 0.5 },
      { word: "Again", start: 0.6, end: 0.9 },
    ], 5);
    expect(lines).toHaveLength(2);
  });

  it("builds ASS subtitles", () => {
    const ass = buildAssSubtitles([{ word: "Hello", start: 0, end: 0.4 }], {
      width: 1080,
      height: 1920,
      fontSize: 58,
      position: "bottom",
      primaryColor: "#ffffff",
      highlightColor: "#ffff00",
      animation: "karaoke",
    });
    expect(ass).toContain("[Events]");
    expect(ass).toContain("\\kf40");
  });
});
