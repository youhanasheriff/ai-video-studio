import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryConfig } from "../../../shared/types";
import { projectDir } from "../../paths";
import { listStoryScenes } from "../scenes";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export function runSubtitlesStage(projectId: string, config: StoryConfig): { assPath: string; words: number } {
  const captionDir = join(projectDir(projectId), "captions");
  mkdirSync(captionDir, { recursive: true });
  const words = approximateWords(projectId);
  const [width, height] = videoSize(config.style.aspectRatio);
  const ass = buildAssSubtitles(words, { width, height, fontSize: height >= 1900 ? 64 : 54 });
  const assPath = join(captionDir, "narration.ass");
  writeFileSync(assPath, ass, "utf8");
  writeFileSync(join(captionDir, "narration.json"), JSON.stringify({ segments: [{ words }] }, null, 2), "utf8");
  return { assPath, words: words.length };
}

export function approximateWords(projectId: string): WordTiming[] {
  const out: WordTiming[] = [];
  for (const scene of listStoryScenes(projectId)) {
    const start = scene.audioStartSeconds ?? 0;
    const duration = scene.audioDurationSeconds ?? scene.estimatedDurationSeconds ?? 3;
    const words = scene.narrationText.split(/\s+/).map((word) => word.trim()).filter(Boolean);
    const step = duration / Math.max(1, words.length);
    for (const [index, word] of words.entries()) {
      out.push({
        word,
        start: start + index * step,
        end: start + (index + 1) * step,
      });
    }
  }
  return out;
}

export function buildAssSubtitles(words: WordTiming[], opts: { width: number; height: number; fontSize: number }): string {
  const lines = groupWords(words);
  const marginV = Math.round(opts.height * 0.12);
  const header = `[Script Info]
Title: AI Video Studio Karaoke
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Helvetica,${opts.fontSize},&H00FFFFFF,&H00B0B0B0,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return header + lines.map(lineToDialogue).join("\n") + "\n";
}

function groupWords(words: WordTiming[], maxWords = 6, maxChars = 42, maxDur = 4): WordTiming[][] {
  const lines: WordTiming[][] = [];
  let current: WordTiming[] = [];
  for (const word of words) {
    const chars = current.reduce((sum, entry) => sum + entry.word.length + 1, 0) + word.word.length;
    const dur = current[0] ? word.end - current[0].start : 0;
    if (current.length && (current.length >= maxWords || chars > maxChars || dur > maxDur)) {
      lines.push(current);
      current = [];
    }
    current.push(word);
    if (/[.!?]$/.test(word.word) && current.length >= 3) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

function lineToDialogue(words: WordTiming[]): string {
  const start = words[0]?.start ?? 0;
  const end = (words.at(-1)?.end ?? start + 1) + 0.2;
  const body = words.map((word) => {
    const dur = Math.max(1, Math.round((word.end - word.start) * 100));
    return `{\\1c&H0080DDFF\\kf${dur}}${escapeAss(word.word)}{\\1c&H00FFFFFF}`;
  }).join(" ");
  return `Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Karaoke,,0,0,0,,${body}`;
}

function escapeAss(text: string): string {
  return text.replaceAll("{", "\\{").replaceAll("}", "\\}").replaceAll("\n", " ");
}

function fmtAssTime(t: number): string {
  const value = Math.max(0, t);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function videoSize(aspectRatio: StoryConfig["style"]["aspectRatio"]): [number, number] {
  if (aspectRatio === "9:16") return [1080, 1920];
  if (aspectRatio === "1:1") return [1080, 1080];
  if (aspectRatio === "4:5") return [1080, 1350];
  return [1920, 1080];
}
