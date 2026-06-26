import { contextBridge, ipcRenderer } from "electron";
import type { CreateProjectInput, GenerationRequest, Project, ProviderSaveInput, StockVideo, StoryConfig, StoryScene, StoryStage } from "../shared/types";
import type { StudioApi } from "../shared/types";

const api: StudioApi = {
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    save: (config: ProviderSaveInput) => ipcRenderer.invoke("providers:save", config),
    test: (providerId: string) => ipcRenderer.invoke("providers:test", providerId),
    testVoice: (input: { text?: string; voiceName: string; voiceSpeed: number }) => ipcRenderer.invoke("providers:testVoice", input),
    install: (targetId: string) => ipcRenderer.invoke("providers:install", targetId),
    openInstallGuide: (targetId: string) => ipcRenderer.invoke("providers:openInstallGuide", targetId),
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
    get: (projectId: string) => ipcRenderer.invoke("projects:get", projectId),
    update: (projectId: string, patch: Partial<Project>) => ipcRenderer.invoke("projects:update", projectId, patch),
    delete: (projectId: string) => ipcRenderer.invoke("projects:delete", projectId),
  },
  assets: {
    importFiles: (projectId: string) => ipcRenderer.invoke("assets:importFiles", projectId),
    list: (projectId: string) => ipcRenderer.invoke("assets:list", projectId),
    remove: (assetId: string) => ipcRenderer.invoke("assets:remove", assetId),
  },
  jobs: {
    createGeneration: (projectId: string, request: GenerationRequest) => ipcRenderer.invoke("jobs:createGeneration", projectId, request),
    get: (jobId: string) => ipcRenderer.invoke("jobs:get", jobId),
    list: (projectId?: string) => ipcRenderer.invoke("jobs:list", projectId),
    logs: (jobId: string) => ipcRenderer.invoke("jobs:logs", jobId),
    cancel: (jobId: string) => ipcRenderer.invoke("jobs:cancel", jobId),
  },
  script: {
    generate: (input: { providerId: string; topic: string; lengthHint?: string }) => ipcRenderer.invoke("script:generate", input),
  },
  stock: {
    search: (input: { providerId: "pexels" | "pixabay"; query: string; perPage?: number }) => ipcRenderer.invoke("stock:search", input),
    download: (input: { projectId: string; video: StockVideo; keyword?: string }) => ipcRenderer.invoke("stock:download", input),
  },
  story: {
    createProject: (input: { name: string; config: StoryConfig }) => ipcRenderer.invoke("story:createProject", input),
    getConfig: (projectId: string) => ipcRenderer.invoke("story:getConfig", projectId),
    saveConfig: (projectId: string, config: StoryConfig) => ipcRenderer.invoke("story:saveConfig", projectId, config),
    run: (projectId: string, fromStage?: StoryStage) => ipcRenderer.invoke("story:run", projectId, fromStage),
    resume: (projectId: string) => ipcRenderer.invoke("story:resume", projectId),
    runStage: (projectId: string, stage: StoryStage) => ipcRenderer.invoke("story:runStage", projectId, stage),
    updateScript: (projectId: string, script: string) => ipcRenderer.invoke("story:updateScript", projectId, script),
    stages: (projectId: string) => ipcRenderer.invoke("story:stages", projectId),
    scenes: (projectId: string) => ipcRenderer.invoke("story:scenes", projectId),
    regenerateImage: (projectId: string, sceneId: number, promptOverride?: string) => ipcRenderer.invoke("story:regenerateImage", projectId, sceneId, promptOverride),
    updateScene: (projectId: string, sceneId: number, patch: Partial<Pick<StoryScene, "title" | "narrationText" | "imagePrompt" | "negativePrompt" | "continuityNotes">>) =>
      ipcRenderer.invoke("story:updateScene", projectId, sceneId, patch),
  },
  exports: {
    choosePath: (defaultName: string) => ipcRenderer.invoke("exports:choosePath", defaultName),
    saveAs: (input: { jobId: string; defaultName: string }) => ipcRenderer.invoke("exports:saveAs", input),
    revealInFinder: (path: string) => ipcRenderer.invoke("exports:revealInFinder", path),
  },
  system: {
    checkDependencies: () => ipcRenderer.invoke("system:checkDependencies"),
    getAppInfo: () => ipcRenderer.invoke("system:getAppInfo"),
  },
};

contextBridge.exposeInMainWorld("studio", api);
