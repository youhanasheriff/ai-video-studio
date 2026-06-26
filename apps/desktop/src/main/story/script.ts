import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryScene } from "../../shared/types";
import { execSql, sql } from "../db";
import { projectDir } from "../paths";
import { getStoryConfig, updateProjectScript } from "./config";
import { listStoryScenes, markStagesStaleAfter, upsertStoryScene, writeScenesJson } from "./scenes";
import { splitScriptIntoScenes } from "./stages/writer";

export function updateStoryScript(projectId: string, script: string): StoryScene[] {
  const config = getStoryConfig(projectId);
  updateProjectScript(projectId, script);
  writeFileSync(join(projectDir(projectId), "script.md"), script, "utf8");
  const scenes = splitScriptIntoScenes(script, config.target.sceneCount);
  execSql(`DELETE FROM story_scenes WHERE project_id = ${sql(projectId)};`);
  for (const scene of scenes) {
    upsertStoryScene({
      projectId,
      sceneId: scene.sceneId,
      title: scene.title,
      narrationText: scene.text,
      estimatedDurationSeconds: Math.max(3, Math.ceil(scene.text.split(/\s+/).filter(Boolean).length / Math.max(1, 2.5 * config.voiceSpeed))),
      imageStatus: "pending",
      audioStatus: "pending",
    });
  }
  markStagesStaleAfter(projectId, "writer");
  writeScenesJson(projectId);
  return listStoryScenes(projectId);
}
