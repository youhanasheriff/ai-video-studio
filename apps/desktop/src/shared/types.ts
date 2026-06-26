export type ProjectStatus = "draft" | "processing" | "completed" | "failed";
export type ProjectMode = "short" | "story";
export type JobStatus =
  | "queued"
  | "preparing"
  | "generating_audio"
  | "transcribing"
  | "assembling_media"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export type ProviderKind = "script_llm" | "tts" | "transcription" | "media" | "render" | "cloud";
export type ProviderPrivacy = "local" | "api" | "cloud";
export type ProviderStatus = "connected" | "missing" | "error" | "disabled";
export type StoryStage = "writer" | "prompts" | "images" | "tts" | "assemble" | "subtitles" | "finalize";
export type StoryStageStatus = "pending" | "running" | "done" | "failed" | "stale";
export type StorySceneStatus = "pending" | "generating" | "done" | "failed";
export type CharacterConsistencyMode = "prompt_tokens" | "reference_images";

export interface Project {
  id: string;
  name: string;
  mode: ProjectMode;
  status: ProjectStatus;
  script: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  kind: "video" | "audio" | "image" | "other";
  source: "imported" | "generated";
  originalPath: string | null;
  localPath: string;
  fileUrl: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  privacy: ProviderPrivacy;
  enabled: boolean;
  baseUrl?: string;
  hasSecret?: boolean;
  status: ProviderStatus;
  config: Record<string, unknown>;
  updatedAt: string;
}

export interface ProviderSaveInput extends Partial<ProviderConfig> {
  id: string;
  secret?: string;
}

export interface ProviderInstallResult {
  ok: boolean;
  targetId: string;
  message: string;
  command?: string;
  log?: string;
}

export interface DependencyStatus {
  id: string;
  name: string;
  status: "ok" | "missing" | "error";
  version?: string;
  message?: string;
  installUrl?: string;
}

export interface StockVideoFile {
  id: string | number;
  quality: string;
  fileType: string;
  width: number;
  height: number;
  link: string;
}

export interface StockVideo {
  id: string;
  provider: "pexels" | "pixabay";
  width: number;
  height: number;
  duration: number;
  url: string;
  previewUrl: string | null;
  files: StockVideoFile[];
}

export interface StoryCharacter {
  key: string;
  name: string;
  visualToken: string;
  wardrobe: string;
  portraitPose?: string;
  portraitBackground?: string;
  portraitAssetId?: string | null;
  portraitPath?: string | null;
  portraitUrl?: string | null;
}

export interface StoryCharacterConsistency {
  enabled: boolean;
  mode: CharacterConsistencyMode;
  maxRefsPerScene: number;
  charactersDir?: string;
}

export interface ShortGenerationRequest {
  kind?: "short";
  projectId: string;
  script: string;
  keywords: string[];
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  voiceName: string;
  voiceSpeed: number;
  mediaMode: "local_assets" | "stock_provider";
  subtitleSettings: {
    enabled: boolean;
    fontSize: number;
    position: "top" | "center" | "bottom";
    primaryColor: string;
    highlightColor: string;
    styleName: string;
    animation: "none" | "fade" | "karaoke" | "typewriter";
  };
}

export interface StoryConfig {
  seed: string;
  target: {
    scriptWords: number;
    sceneCount: number;
    approximateMinutes?: number;
  };
  style: {
    genre: string;
    visualStyle: string;
    aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
    styleLock?: string;
    palette?: string;
    crossfade?: boolean;
    kenBurns?: boolean;
  };
  imageProvider: string;
  voiceProvider: string;
  llmProviderId: string;
  llmModel?: string;
  imageModel?: string;
  imageBackend?: "imagen" | "gemini";
  characters: StoryCharacter[];
  characterConsistency: StoryCharacterConsistency;
  voiceName: string;
  voiceSpeed: number;
  subtitles: {
    enabled: boolean;
    style: string;
    karaoke: boolean;
  };
}

export interface StoryGenerationRequest {
  kind: "story";
  projectId: string;
  config: StoryConfig;
  fromStage?: StoryStage;
}

export type GenerationRequest = ShortGenerationRequest;
export type JobRequest = ShortGenerationRequest | StoryGenerationRequest;

export interface StoryScene {
  projectId: string;
  sceneId: number;
  title: string;
  narrationText: string;
  imagePrompt: string;
  negativePrompt: string;
  characters: Array<string | Partial<StoryCharacter>>;
  continuityNotes: string;
  estimatedDurationSeconds: number | null;
  imageAssetId: string | null;
  imageStatus: StorySceneStatus;
  imageError: string | null;
  audioAssetId: string | null;
  audioStatus: StorySceneStatus;
  audioStartSeconds: number | null;
  audioDurationSeconds: number | null;
  audioError: string | null;
  updatedAt: string;
}

export interface StoryStageState {
  projectId: string;
  stage: StoryStage;
  status: StoryStageStatus;
  progress: number;
  detail: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  updatedAt: string;
}

export type StoryScenePatch = Partial<Pick<StoryScene, "title" | "narrationText" | "imagePrompt" | "negativePrompt" | "characters" | "continuityNotes">>;

export interface GenerationJob {
  id: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  currentStep: string | null;
  request: JobRequest;
  result: { outputPath?: string; outputUrl?: string; audioPath?: string; audioUrl?: string; provider?: string } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobLog {
  id: string;
  jobId: string;
  level: "info" | "warn" | "error";
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  mode?: ProjectMode;
  script?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
}

export interface StudioApi {
  providers: {
    list: () => Promise<ProviderConfig[]>;
    save: (config: ProviderSaveInput) => Promise<ProviderConfig>;
    test: (providerId: string) => Promise<ProviderConfig>;
    testVoice: (input: { text?: string; voiceName: string; voiceSpeed: number }) => Promise<{ audioPath: string; audioUrl: string; provider: string }>;
    install: (targetId: string) => Promise<ProviderInstallResult>;
    openInstallGuide: (targetId: string) => Promise<void>;
  };
  projects: {
    list: () => Promise<Project[]>;
    create: (input: CreateProjectInput) => Promise<Project>;
    get: (projectId: string) => Promise<Project | null>;
    update: (projectId: string, patch: Partial<Pick<Project, "name" | "script" | "status">> & { settings?: Record<string, unknown> }) => Promise<Project>;
    delete: (projectId: string) => Promise<boolean>;
  };
  assets: {
    importFiles: (projectId: string) => Promise<Asset[]>;
    list: (projectId: string) => Promise<Asset[]>;
    remove: (assetId: string) => Promise<boolean>;
  };
  jobs: {
    createGeneration: (projectId: string, request: GenerationRequest) => Promise<GenerationJob>;
    get: (jobId: string) => Promise<GenerationJob | null>;
    list: (projectId?: string) => Promise<GenerationJob[]>;
    logs: (jobId: string) => Promise<JobLog[]>;
    cancel: (jobId: string) => Promise<boolean>;
  };
  script: {
    generate: (input: { providerId: string; topic: string; lengthHint?: string }) => Promise<string>;
  };
  stock: {
    search: (input: { providerId: "pexels" | "pixabay"; query: string; perPage?: number }) => Promise<StockVideo[]>;
    download: (input: { projectId: string; video: StockVideo; keyword?: string }) => Promise<Asset>;
  };
  story: {
    createProject: (input: { name: string; config: StoryConfig }) => Promise<Project>;
    getConfig: (projectId: string) => Promise<StoryConfig>;
    saveConfig: (projectId: string, config: StoryConfig) => Promise<StoryConfig>;
    run: (projectId: string, fromStage?: StoryStage) => Promise<GenerationJob>;
    resume: (projectId: string) => Promise<GenerationJob>;
    runStage: (projectId: string, stage: StoryStage) => Promise<GenerationJob>;
    updateScript: (projectId: string, script: string) => Promise<StoryScene[]>;
    stages: (projectId: string) => Promise<StoryStageState[]>;
    scenes: (projectId: string) => Promise<StoryScene[]>;
    generateCharacterPortraits: (projectId: string, config: StoryConfig, force?: boolean) => Promise<StoryConfig>;
    regenerateImage: (projectId: string, sceneId: number, promptOverride?: string) => Promise<StoryScene>;
    updateScene: (projectId: string, sceneId: number, patch: StoryScenePatch) => Promise<StoryScene>;
  };
  exports: {
    choosePath: (defaultName: string) => Promise<string | null>;
    saveAs: (input: { jobId: string; defaultName: string }) => Promise<{ outputPath: string } | null>;
    revealInFinder: (path: string) => Promise<void>;
  };
  system: {
    checkDependencies: () => Promise<DependencyStatus[]>;
    getAppInfo: () => Promise<{ appDataPath: string; platform: string; pathEntries: string[] }>;
  };
}
