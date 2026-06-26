import { ipcMain } from "electron";
import type { StoryConfig, StoryStage } from "../../shared/types";
import { createStoryProject, getStoryConfig, saveStoryConfig } from "./config";
import { createStoryJob } from "./runner";
import { firstIncompleteStage, listStoryScenes, listStoryStages, markStagesStaleAfter, updateStoryScene } from "./scenes";
import { generateCharacterPortraits, regenerateSceneImage } from "./stages/images";
import { updateStoryScript } from "./script";

export function registerStoryIpc(): void {
  ipcMain.handle("story:createProject", async (_event, input: { name: string; config: StoryConfig }) => {
    return createStoryProject(input.name, input.config);
  });

  ipcMain.handle("story:getConfig", async (_event, projectId: string) => getStoryConfig(projectId));

  ipcMain.handle("story:saveConfig", async (_event, projectId: string, config: StoryConfig) => saveStoryConfig(projectId, config));

  ipcMain.handle("story:run", async (_event, projectId: string, fromStage?: StoryStage) => {
    const config = getStoryConfig(projectId);
    if (fromStage) markStagesStaleAfter(projectId, fromStage);
    return createStoryJob(projectId, config, fromStage);
  });

  ipcMain.handle("story:resume", async (_event, projectId: string) => {
    const config = getStoryConfig(projectId);
    return createStoryJob(projectId, config, firstIncompleteStage(projectId));
  });

  ipcMain.handle("story:runStage", async (_event, projectId: string, stage: StoryStage) => {
    const config = getStoryConfig(projectId);
    markStagesStaleAfter(projectId, stage);
    return createStoryJob(projectId, config, stage);
  });

  ipcMain.handle("story:updateScript", async (_event, projectId: string, script: string) => updateStoryScript(projectId, script));

  ipcMain.handle("story:stages", async (_event, projectId: string) => listStoryStages(projectId));

  ipcMain.handle("story:scenes", async (_event, projectId: string) => listStoryScenes(projectId));

  ipcMain.handle("story:generateCharacterPortraits", async (_event, projectId: string, config: StoryConfig, force?: boolean) => {
    return generateCharacterPortraits(projectId, config, Boolean(force));
  });

  ipcMain.handle("story:regenerateImage", async (_event, projectId: string, sceneId: number, promptOverride?: string) => {
    return regenerateSceneImage(projectId, sceneId, getStoryConfig(projectId), promptOverride);
  });

  ipcMain.handle("story:updateScene", async (_event, projectId: string, sceneId: number, patch: Parameters<typeof updateStoryScene>[2]) => {
    return updateStoryScene(projectId, sceneId, patch);
  });
}
