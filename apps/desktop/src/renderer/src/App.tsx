import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  HardDrive,
  Home,
  Image,
  KeyRound,
  Layers,
  Loader2,
  Mic2,
  Monitor,
  Palette,
  Play,
  Plus,
  Package,
  RefreshCcw,
  Save,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Smartphone,
  TerminalSquare,
  Trash2,
  Upload,
  User,
  Video,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import type {
  Asset,
  DependencyStatus,
  GenerationJob,
  GenerationRequest,
  JobLog,
  Project,
  ProviderConfig,
  ProviderInstallResult,
  ProviderSaveInput,
  StockVideo,
} from "../../shared/types";
import { errorMessage, safeInvoke } from "./lib/api";
import { StoryStudio, createDefaultStoryConfig } from "./StoryStudio";

type View = "dashboard" | "studio" | "providers" | "jobs" | "settings";
type StudioStep = "script" | "voice" | "media" | "captions" | "export";

const starterScript =
  "Create faster social videos with AI Video Studio. Import your clips, choose API or local providers, generate captions, and render a polished short on your desktop.";

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "studio", label: "Studio", icon: Clapperboard },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "jobs", label: "Jobs", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

const steps: Array<{ id: StudioStep; label: string; icon: typeof Home }> = [
  { id: "script", label: "Script", icon: Sparkles },
  { id: "voice", label: "Voice", icon: Mic2 },
  { id: "media", label: "Media", icon: Layers },
  { id: "captions", label: "Captions", icon: Film },
  { id: "export", label: "Export", icon: Download },
];

const voices = [
  { id: "alloy", name: "Alloy", description: "Neutral and balanced", tone: "balanced" },
  { id: "ash", name: "Ash", description: "Calm and direct", tone: "calm" },
  { id: "ballad", name: "Ballad", description: "Story-driven", tone: "narrative" },
  { id: "coral", name: "Coral", description: "Warm and bright", tone: "warm" },
  { id: "echo", name: "Echo", description: "Natural and steady", tone: "steady" },
  { id: "sage", name: "Sage", description: "Clear and composed", tone: "clear" },
  { id: "shimmer", name: "Shimmer", description: "Expressive and upbeat", tone: "expressive" },
  { id: "verse", name: "Verse", description: "Editorial and polished", tone: "polished" },
  { id: "marin", name: "Marin", description: "Soft and confident", tone: "soft" },
  { id: "cedar", name: "Cedar", description: "Deep and grounded", tone: "deep" },
] as const;

const subtitlePresets = [
  { name: "Classic", primaryColor: "#FFFFFF", highlightColor: "#FFFF00", backgroundColor: "transparent", fontFamily: "Inter" },
  { name: "Bold Pop", primaryColor: "#FFFFFF", highlightColor: "#FF3366", backgroundColor: "#000000", fontFamily: "Inter" },
  { name: "Minimal", primaryColor: "#F8FAFC", highlightColor: "#F8FAFC", backgroundColor: "transparent", fontFamily: "Inter" },
  { name: "Neon", primaryColor: "#00FF88", highlightColor: "#FF00FF", backgroundColor: "transparent", fontFamily: "Inter" },
  { name: "Warm", primaryColor: "#FFE4B5", highlightColor: "#FF6B35", backgroundColor: "transparent", fontFamily: "Inter" },
  { name: "Ocean", primaryColor: "#E0F7FA", highlightColor: "#00BCD4", backgroundColor: "transparent", fontFamily: "Inter" },
];

const aspectRatios = [
  { id: "9:16", name: "Portrait", description: "TikTok, Reels, Shorts", width: 1080, height: 1920, icon: Smartphone, platforms: ["TikTok", "Reels", "Shorts"] },
  { id: "16:9", name: "Landscape", description: "YouTube, Desktop", width: 1920, height: 1080, icon: Monitor, platforms: ["YouTube", "LinkedIn", "Website"] },
  { id: "1:1", name: "Square", description: "Instagram Feed", width: 1080, height: 1080, icon: Square, platforms: ["Instagram", "Facebook", "X"] },
  { id: "4:5", name: "Portrait Feed", description: "Instagram, Facebook", width: 1080, height: 1350, icon: Image, platforms: ["Instagram Feed", "Facebook Feed"] },
] as const;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "video";
}

function jobTone(status: GenerationJob["status"]): "good" | "bad" | "active" | "quiet" {
  if (status === "completed") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "queued") return "quiet";
  return "active";
}

function voiceSpeedDescription(speed: number): string {
  if (speed <= 0.8) return "Slow delivery for explainers, tutorials, and dense ideas.";
  if (speed <= 1.2) return "Natural delivery for most short-form videos.";
  if (speed <= 1.6) return "Fast delivery for energetic social edits.";
  return "Very fast delivery. Best for quick cuts and short scripts.";
}

function providerSetupCopy(provider: ProviderConfig): { primary: string; secondary: string; installTarget: string } {
  if (provider.id === "ffmpeg") return { primary: "Required desktop renderer", secondary: "Installs the binary used for final MP4 assembly, captions, and audio muxing.", installTarget: "ffmpeg" };
  if (provider.id === "ollama") return { primary: "Optional local LLM runtime", secondary: "Use local models for script and idea generation when you want offline generation.", installTarget: "ollama" };
  if (provider.id === "lm-studio") return { primary: "OpenAI-compatible local server", secondary: "Point this at LM Studio's local /v1 endpoint.", installTarget: "lm-studio" };
  if (provider.id === "piper") return { primary: "Optional local voice producer", secondary: "Install Piper when you want local TTS instead of API voices.", installTarget: "piper" };
  if (provider.id === "whisper") return { primary: "Optional local transcription", secondary: "Install Whisper when you want local transcript and caption timing.", installTarget: "whisper" };
  if (provider.id === "openai") return { primary: "Bring-your-own OpenAI key", secondary: "Use your API key for voice generation now; model features can build on the same provider.", installTarget: "openai" };
  if (provider.id === "openai-tts") return { primary: "OpenAI voice provider", secondary: "Use the shared OpenAI key for narrated short and story videos.", installTarget: "openai" };
  if (provider.id === "openai-chat") return { primary: "OpenAI-compatible writer", secondary: "Use the shared OpenAI key for story writing, scene prompts, and script drafting.", installTarget: "openai" };
  if (provider.id === "google") return { primary: "Google image provider", secondary: "Use your Google AI key for story scene images through Imagen or Gemini.", installTarget: "google" };
  if (provider.id === "flux2") return { primary: "Optional local image model", secondary: "Use mflux for local story scene image generation when it is installed.", installTarget: "flux2" };
  if (provider.id === "cosyvoice") return { primary: "Optional local narrator", secondary: "Use a configured CosyVoice checkout for local story narration.", installTarget: "cosyvoice" };
  if (provider.id === "pexels") return { primary: "Bring-your-own stock media key", secondary: "Use Pexels only when you explicitly enable stock search.", installTarget: "pexels" };
  if (provider.id === "pixabay") return { primary: "Bring-your-own stock media key", secondary: "Use Pixabay only when you explicitly enable stock search.", installTarget: "pixabay" };
  return { primary: "Provider", secondary: "Configure this provider for the desktop app.", installTarget: provider.id };
}

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [appInfo, setAppInfo] = useState<{ appDataPath: string; platform: string; pathEntries: string[] } | null>(null);
  const [step, setStep] = useState<StudioStep>("script");
  const [script, setScript] = useState(starterScript);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [mediaMode, setMediaMode] = useState<GenerationRequest["mediaMode"]>("local_assets");
  const [aspectRatio, setAspectRatio] = useState<GenerationRequest["aspectRatio"]>("9:16");
  const [voiceName, setVoiceName] = useState("nova");
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState(subtitlePresets[0]);
  const [subtitlePosition, setSubtitlePosition] = useState<"top" | "center" | "bottom">("bottom");
  const [subtitleAnimation, setSubtitleAnimation] = useState<"none" | "fade" | "karaoke" | "typewriter">("karaoke");
  const [captionSize, setCaptionSize] = useState(58);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerBusyId, setProviderBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newProjectChooserOpen, setNewProjectChooserOpen] = useState(false);

  const activeJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null, [jobs, selectedJobId]);
  const latestOutput = useMemo(() => jobs.find((job) => job.request.kind !== "story" && job.status === "completed" && job.result?.outputUrl)?.result?.outputUrl ?? null, [jobs]);
  const dependencySummary = useMemo(() => {
    const ok = dependencies.filter((item) => item.status === "ok").length;
    return `${ok}/${dependencies.length || 0} ready`;
  }, [dependencies]);

  async function refreshAll(projectId = activeProjectId) {
    try {
    const [nextProjects, nextProviders, nextDependencies, info] = await Promise.all([
      window.studio.projects.list(),
      window.studio.providers.list(),
      window.studio.system.checkDependencies(),
      window.studio.system.getAppInfo(),
    ]);
    setProjects(nextProjects);
    setProviders(nextProviders);
    setDependencies(nextDependencies);
    setAppInfo(info);
    const resolvedProjectId = projectId ?? nextProjects[0]?.id ?? null;
    setActiveProjectId(resolvedProjectId);
    if (resolvedProjectId) {
      const [project, projectAssets, projectJobs] = await Promise.all([
        window.studio.projects.get(resolvedProjectId),
        window.studio.assets.list(resolvedProjectId),
        window.studio.jobs.list(resolvedProjectId),
      ]);
      setActiveProject(project);
      setAssets(projectAssets);
      setJobs(projectJobs);
      if (project) {
        setScript(project.script || starterScript);
        setAspectRatio((project.settings.aspectRatio as GenerationRequest["aspectRatio"]) || "9:16");
        setMediaMode((project.settings.mediaMode as GenerationRequest["mediaMode"]) || "local_assets");
        setKeywords(Array.isArray(project.settings.keywords) ? (project.settings.keywords as string[]) : []);
        setVoiceName((project.settings.voiceName as string) || "nova");
        setVoiceSpeed(Number(project.settings.voiceSpeed) || 1);
        setCaptionsEnabled(project.settings.captionsEnabled === false ? false : true);
        setCaptionSize(Number(project.settings.captionSize) || 58);
        setSubtitlePosition((project.settings.subtitlePosition as "top" | "center" | "bottom") || "bottom");
        setSubtitleAnimation((project.settings.subtitleAnimation as "none" | "fade" | "karaoke" | "typewriter") || "karaoke");
        const savedStyle = subtitlePresets.find((preset) => preset.name === project.settings.subtitleStyleName);
        setSubtitleStyle(savedStyle ?? subtitlePresets[0]);
      }
      if (!selectedJobId && projectJobs[0]) setSelectedJobId(projectJobs[0].id);
    } else {
      setActiveProject(null);
      setAssets([]);
      setJobs([]);
    }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => setMessage(event.message);
    const onRejection = (event: PromiseRejectionEvent) => {
      setMessage(errorMessage(event.reason));
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (!message || isErrorMessage(message)) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!activeProjectId) return;
    const interval = setInterval(async () => {
      const nextJobs = await safeInvoke(() => window.studio.jobs.list(activeProjectId), setMessage, jobs);
      setJobs(nextJobs);
    }, 900);
    return () => clearInterval(interval);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeJob) {
      setLogs([]);
      return;
    }
    void window.studio.jobs.logs(activeJob.id).then(setLogs);
  }, [activeJob?.id, activeJob?.status, activeJob?.progress]);

  function openNewProjectChooser() {
    setNewProjectChooserOpen(true);
  }

  async function createShortProject() {
    setBusy(true);
    try {
      const project = await window.studio.projects.create({
        name: `Untitled Short ${projects.length + 1}`,
        mode: "short",
        script: starterScript,
        aspectRatio: "9:16",
      });
      setMessage("Project created.");
      setView("studio");
      setStep("script");
      await refreshAll(project.id);
    } finally {
      setBusy(false);
      setNewProjectChooserOpen(false);
    }
  }

  async function createStoryProject() {
    setBusy(true);
    try {
      const project = await window.studio.story.createProject({
        name: `Untitled Story ${projects.length + 1}`,
        config: createDefaultStoryConfig(),
      });
      setMessage("Story project created.");
      setView("studio");
      await refreshAll(project.id);
    } finally {
      setBusy(false);
      setNewProjectChooserOpen(false);
    }
  }

  async function saveProjectPatch(patch: Partial<Project>) {
    if (!activeProjectId) return;
    const project = await window.studio.projects.update(activeProjectId, patch);
    setActiveProject(project);
    setProjects((items) => items.map((item) => (item.id === project.id ? project : item)));
  }

  async function renameActiveProject(name: string) {
    const trimmed = name.trim();
    if (!activeProjectId || !trimmed) return;
    await saveProjectPatch({ name: trimmed });
    setMessage("Project renamed.");
  }

  async function deleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    const label = project?.name ?? "this project";
    if (!window.confirm(`Delete ${label}? This removes its jobs, assets, story scenes, and exports from the app database.`)) return;
    await window.studio.projects.delete(projectId);
    setMessage("Project deleted.");
    const nextProject = projects.find((item) => item.id !== projectId) ?? null;
    if (activeProjectId === projectId) {
      setActiveProjectId(nextProject?.id ?? null);
      setSelectedJobId(null);
      if (!nextProject) setView("dashboard");
      await refreshAll(nextProject?.id ?? null);
      return;
    }
    await refreshAll(activeProjectId);
  }

  async function saveAsJob(jobId: string, defaultName?: string) {
    const job = jobs.find((item) => item.id === jobId) ?? (await window.studio.jobs.get(jobId));
    if (!job?.result?.outputPath) {
      setMessage("No rendered output is available.");
      return;
    }
    const request = job.request;
    const aspect = request.kind === "story" ? request.config.style.aspectRatio : request.aspectRatio;
    const name = defaultName ?? `${slug(activeProject?.name ?? "video")}-${aspect.replace(":", "x")}.mp4`;
    const saved = await window.studio.exports.saveAs({ jobId, defaultName: name });
    if (saved) setMessage(`Saved to ${saved.outputPath}`);
  }

  async function importAssets() {
    if (!activeProjectId) return;
    const imported = await window.studio.assets.importFiles(activeProjectId);
    if (imported.length > 0) setMessage(`Imported ${imported.length} clip${imported.length === 1 ? "" : "s"}.`);
    await refreshAll(activeProjectId);
  }

  async function generateVideo() {
    if (!activeProjectId) {
      await createShortProject();
      return;
    }
    setBusy(true);
    try {
      await saveProjectPatch({
        script,
        settings: {
          aspectRatio,
          keywords,
          mediaMode,
          voiceName,
          voiceSpeed,
          captionsEnabled,
          captionSize,
          subtitlePosition,
          subtitleAnimation,
          subtitleStyleName: subtitleStyle.name,
        },
      });
      const request: GenerationRequest = {
        projectId: activeProjectId,
        script,
        keywords,
        aspectRatio,
        voiceName,
        voiceSpeed,
        mediaMode,
        subtitleSettings: {
          enabled: captionsEnabled,
          fontSize: captionSize,
          position: subtitlePosition,
          primaryColor: subtitleStyle.primaryColor,
          highlightColor: subtitleStyle.highlightColor,
          styleName: subtitleStyle.name,
          animation: subtitleAnimation,
        },
      };
      const job = await window.studio.jobs.createGeneration(activeProjectId, request);
      setSelectedJobId(job.id);
      setView("jobs");
      setMessage("Render started.");
      await refreshAll(activeProjectId);
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(providerId: string) {
    setProviderBusyId(providerId);
    try {
      const provider = await window.studio.providers.test(providerId);
      setProviders((items) => items.map((item) => (item.id === provider.id ? provider : item)));
      setMessage(`${provider.name}: ${provider.status}.`);
    } finally {
      setProviderBusyId(null);
    }
  }

  async function saveProviderConfig(config: ProviderSaveInput) {
    setProviderBusyId(config.id);
    try {
      const provider = await window.studio.providers.save(config);
      setProviders((items) => items.map((item) => (item.id === provider.id ? provider : item)));
      setMessage(`${provider.name} saved.`);
    } finally {
      setProviderBusyId(null);
    }
  }

  async function installProvider(targetId: string) {
    setProviderBusyId(targetId);
    try {
      const result: ProviderInstallResult = await window.studio.providers.install(targetId);
      setMessage(result.message);
      await refreshAll();
    } finally {
      setProviderBusyId(null);
    }
  }

  async function openProviderGuide(targetId: string) {
    await window.studio.providers.openInstallGuide(targetId);
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setView("studio");
    void refreshAll(projectId);
  }

  return (
    <div className="app-shell">
      <aside className="nav">
        <div className="traffic-space" />
        <div className="brand">
          <div className="brand-mark">
            <Video size={20} />
          </div>
          <div>
            <strong>AI Video Studio</strong>
            <span>Desktop studio</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="nav-footer">
          <div className="health-pill">
            <HardDrive size={15} />
            <span>{dependencySummary}</span>
          </div>
          <div className="privacy-pill">
            <Shield size={15} />
            <span>No telemetry</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view === "studio" ? activeProject?.name ?? "Studio" : "Flexible provider studio"}</p>
            <h1>{viewLabel(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="button ghost" onClick={() => refreshAll()}>
              <RefreshCcw size={16} />
              Sync
            </button>
            <button className="button primary" onClick={openNewProjectChooser} disabled={busy}>
              <Plus size={16} />
              New Video
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <Dashboard
            projects={projects}
            jobs={jobs}
            dependencies={dependencies}
            providers={providers}
            onCreate={openNewProjectChooser}
            onSelectProject={selectProject}
            onDeleteProject={deleteProject}
            onProviders={() => setView("providers")}
          />
        )}

        {view === "studio" && activeProject?.mode === "story" && (
          <StoryStudio
            project={activeProject}
            providers={providers}
            assets={assets}
            jobs={jobs}
            onRefresh={refreshAll}
            onMessage={setMessage}
            onReveal={(path) => window.studio.exports.revealInFinder(path)}
            onRename={renameActiveProject}
            onDelete={() => deleteProject(activeProject.id)}
            onSaveAs={saveAsJob}
          />
        )}

        {view === "studio" && activeProject?.mode !== "story" && (
          <Studio
            project={activeProject}
            projects={projects}
            providers={providers}
            dependencies={dependencies}
            assets={assets}
            jobs={jobs}
            step={step}
            script={script}
            keywords={keywords}
            mediaMode={mediaMode}
            aspectRatio={aspectRatio}
            voiceName={voiceName}
            voiceSpeed={voiceSpeed}
            captionsEnabled={captionsEnabled}
            subtitleStyle={subtitleStyle}
            subtitlePosition={subtitlePosition}
            subtitleAnimation={subtitleAnimation}
            captionSize={captionSize}
            latestOutput={latestOutput}
            busy={busy}
            onStep={setStep}
            onScript={setScript}
            onKeywords={setKeywords}
            onMediaMode={setMediaMode}
            onAspectRatio={setAspectRatio}
            onVoiceName={setVoiceName}
            onVoiceSpeed={setVoiceSpeed}
            onCaptionsEnabled={setCaptionsEnabled}
            onSubtitleStyle={setSubtitleStyle}
            onSubtitlePosition={setSubtitlePosition}
            onSubtitleAnimation={setSubtitleAnimation}
            onCaptionSize={setCaptionSize}
            onCreate={openNewProjectChooser}
            onImport={importAssets}
            onGenerate={generateVideo}
            onProject={selectProject}
            onReveal={(path) => window.studio.exports.revealInFinder(path)}
            onMessage={setMessage}
            onRename={renameActiveProject}
            onDelete={() => activeProjectId && deleteProject(activeProjectId)}
            onSaveAs={saveAsJob}
          />
        )}

        {view === "providers" && (
          <ProviderCenter
            providers={providers}
            dependencies={dependencies}
            busyId={providerBusyId}
            onTest={testProvider}
            onSave={saveProviderConfig}
            onInstall={installProvider}
            onGuide={openProviderGuide}
            onRefresh={() => refreshAll()}
          />
        )}

        {view === "jobs" && (
          <JobsView jobs={jobs} selectedJob={activeJob} logs={logs} onSelect={setSelectedJobId} onSaveAs={saveAsJob} />
        )}

        {view === "settings" && <SettingsView appInfo={appInfo} dependencies={dependencies} />}
      </main>
      {newProjectChooserOpen && (
        <NewProjectChooser
          busy={busy}
          onClose={() => setNewProjectChooserOpen(false)}
          onShort={createShortProject}
          onStory={createStoryProject}
        />
      )}
      {message && (
        <Toast message={message} tone={isErrorMessage(message) ? "error" : "info"} onDismiss={() => setMessage(null)} />
      )}
    </div>
  );
}

function isErrorMessage(message: string): boolean {
  return /\b(fail(ed|s)?|error|missing|not found|could not|couldn't|cannot|can't|invalid|disabled|unauthorized|forbidden|no .*(provider|key|output)|insufficient|exceeded|rejected|timed? out)\b/i.test(message);
}

function Toast({ message, tone, onDismiss }: { message: string; tone: "info" | "error"; onDismiss: () => void }) {
  return (
    <div className={`toast toast-${tone}`} role="status">
      <span className="toast-text">{message}</span>
      <button className="toast-close" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}

function viewLabel(view: View): string {
  if (view === "dashboard") return "Dashboard";
  if (view === "studio") return "Studio";
  if (view === "providers") return "Provider Center";
  if (view === "jobs") return "Render Jobs";
  return "Settings";
}

function NewProjectChooser({
  busy,
  onClose,
  onShort,
  onStory,
}: {
  busy: boolean;
  onClose: () => void;
  onShort: () => void;
  onStory: () => void;
}) {
  return (
    <div className="new-project-backdrop" role="presentation" onClick={onClose}>
      <div className="new-project-dialog" role="dialog" aria-modal="true" aria-label="Create new video" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">New video</p>
            <h3>Choose a workflow</h3>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="new-project-options">
          <button className="new-project-card" onClick={onShort} disabled={busy}>
            <span className="new-project-icon">
              <Clapperboard size={20} />
            </span>
            <span>
              <strong>Short video</strong>
              <small>Script, voice, imported clips, captions, and MP4 export.</small>
            </span>
          </button>
          <button className="new-project-card featured" onClick={onStory} disabled={busy}>
            <span className="new-project-icon">
              <Film size={20} />
            </span>
            <span>
              <strong>Story long-form</strong>
              <small>Seed, AI script, scene images, narrated timeline, and final story render.</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({
  projects,
  jobs,
  dependencies,
  providers,
  onCreate,
  onSelectProject,
  onDeleteProject,
  onProviders,
}: {
  projects: Project[];
  jobs: GenerationJob[];
  dependencies: DependencyStatus[];
  providers: ProviderConfig[];
  onCreate: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onProviders: () => void;
}) {
  const readyDependencies = dependencies.filter((item) => item.status === "ok");
  const missingDependencies = dependencies.filter((item) => item.status !== "ok");
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const activeJobs = jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)).length;
  const requiredReady = ["sqlite3", "ffmpeg"].every((id) => dependencies.find((item) => item.id === id)?.status === "ok");
  const apiVoiceReady = providers.some((provider) => ["openai", "openai-tts"].includes(provider.id) && provider.enabled && provider.hasSecret);
  const nextAction = projects.length === 0 ? "Create your first video" : activeJobs > 0 ? "Review active render" : "Continue in Studio";

  return (
    <section className="dashboard-grid">
      <div className="command-panel">
        <div className="command-copy">
          <div className="status-line">
            <StatusBadge tone={requiredReady ? "good" : "bad"}>{requiredReady ? "Ready to render" : "Setup needed"}</StatusBadge>
            <span>Desktop render workspace</span>
          </div>
          <h2>Produce captioned videos with your providers and desktop rendering.</h2>
          <p>
            Import clips, draft a script, use your API keys or optional local producers, then render the final MP4 with FFmpeg on this desktop.
          </p>
          <div className="command-actions">
            <button className="button primary large" onClick={onCreate}>
              <Plus size={18} />
              {nextAction}
            </button>
            <button className="button ghost large" onClick={onProviders}>
              <Cpu size={18} />
              Check providers
            </button>
          </div>
        </div>
        <div className="readiness-card">
          <span className="readiness-label">Render engine</span>
          <strong>{readyDependencies.length}/{dependencies.length || 0}</strong>
          <p>{requiredReady ? "Core output path is available." : "SQLite and FFmpeg are required for desktop output."}</p>
          <div className="readiness-meter">
            <span style={{ width: `${dependencies.length ? (readyDependencies.length / dependencies.length) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <MetricTile label="Projects" value={projects.length} detail={projects.length === 1 ? "studio project" : "studio projects"} icon={Clapperboard} />
        <MetricTile label="Completed" value={completedJobs} detail="renders" icon={CheckCircle2} />
        <MetricTile label="Active jobs" value={activeJobs} detail="in queue" icon={Activity} />
        <MetricTile label="Voice" value={apiVoiceReady ? "Ready" : "Silent"} detail={apiVoiceReady ? "API TTS" : "fallback render"} icon={Mic2} />
      </div>

      <div className="panel recent-panel">
        <div className="panel-head">
          <h3>Recent Projects</h3>
          <span>{projects.length}</span>
        </div>
        <div className="list">
          {projects.length === 0 && (
            <div className="first-run-card">
              <div className="first-run-icon">
                <Video size={22} />
              </div>
              <div>
                <strong>No projects yet</strong>
                <p>Create a project, import a clip, and generate a desktop-rendered MP4.</p>
              </div>
              <button className="button primary" onClick={onCreate}>
                <Plus size={15} />
                Start
              </button>
            </div>
          )}
          {projects.map((project) => (
            <div key={project.id} className="project-row">
              <button className="project-row-main" onClick={() => onSelectProject(project.id)}>
                <span className="row-icon">
                  {project.mode === "story" ? <Film size={16} /> : <Clapperboard size={16} />}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{formatDate(project.updatedAt)}</small>
                </span>
              </button>
              <span className={`mode-badge ${project.mode}`}>{project.mode === "story" ? "Story" : "Short"}</span>
              <StatusBadge tone={project.status === "completed" ? "good" : project.status === "failed" ? "bad" : "quiet"}>
                {project.status}
              </StatusBadge>
              <button className="icon-button danger" onClick={() => onDeleteProject(project.id)} title={`Delete ${project.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel setup-panel">
        <div className="panel-head">
          <h3>Setup Checklist</h3>
          <button className="link-button" onClick={onProviders}>Open Providers</button>
        </div>
        <div className="setup-list">
          <SetupStep complete={dependencies.find((item) => item.id === "sqlite3")?.status === "ok"} title="Project database" detail="SQLite stores projects, jobs, and provider settings." />
          <SetupStep complete={dependencies.find((item) => item.id === "ffmpeg")?.status === "ok"} title="Render engine" detail="FFmpeg creates final desktop MP4 outputs." />
          <SetupStep complete={projects.length > 0} title="First project" detail="Create a video workspace." />
          <SetupStep complete={jobs.some((job) => job.status === "completed")} title="First export" detail="Generate a provider-aware desktop render." />
        </div>
      </div>

      <div className="panel health-panel">
        <div className="panel-head">
          <h3>System Health</h3>
          <span>{missingDependencies.length ? `${missingDependencies.length} missing` : "ready"}</span>
        </div>
        <div className="dependency-stack compact">
          {dependencies.slice(0, 5).map((item) => (
            <DependencyLine key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div className="panel jobs-panel">
        <div className="panel-head">
          <h3>Latest Jobs</h3>
          <span>{jobs.length}</span>
        </div>
        <div className="job-strip">
          {jobs.slice(0, 3).map((job) => (
            <div className="job-card" key={job.id}>
              <div className="job-card-head">
                <StatusBadge tone={jobTone(job.status)}>{job.status}</StatusBadge>
                <small>{formatDate(job.createdAt)}</small>
              </div>
              <strong>{job.currentStep || "Waiting for worker"}</strong>
              <Progress value={job.progress} />
            </div>
          ))}
          {jobs.length === 0 && (
            <div className="empty-state-inline">
              <Activity size={18} />
              <span>Render jobs and logs will appear here after your first generation.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Studio(props: {
  project: Project | null;
  projects: Project[];
  providers: ProviderConfig[];
  dependencies: DependencyStatus[];
  assets: Asset[];
  jobs: GenerationJob[];
  step: StudioStep;
  script: string;
  keywords: string[];
  mediaMode: GenerationRequest["mediaMode"];
  aspectRatio: GenerationRequest["aspectRatio"];
  voiceName: string;
  voiceSpeed: number;
  captionsEnabled: boolean;
  subtitleStyle: (typeof subtitlePresets)[number];
  subtitlePosition: "top" | "center" | "bottom";
  subtitleAnimation: "none" | "fade" | "karaoke" | "typewriter";
  captionSize: number;
  latestOutput: string | null;
  busy: boolean;
  onStep: (step: StudioStep) => void;
  onScript: (script: string) => void;
  onKeywords: (keywords: string[]) => void;
  onMediaMode: (mode: GenerationRequest["mediaMode"]) => void;
  onAspectRatio: (ratio: GenerationRequest["aspectRatio"]) => void;
  onVoiceName: (voice: string) => void;
  onVoiceSpeed: (speed: number) => void;
  onCaptionsEnabled: (enabled: boolean) => void;
  onSubtitleStyle: (style: (typeof subtitlePresets)[number]) => void;
  onSubtitlePosition: (position: "top" | "center" | "bottom") => void;
  onSubtitleAnimation: (animation: "none" | "fade" | "karaoke" | "typewriter") => void;
  onCaptionSize: (size: number) => void;
  onCreate: () => void;
  onImport: () => void;
  onGenerate: () => void;
  onProject: (id: string) => void;
  onReveal: (path: string) => void;
  onMessage: (message: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSaveAs: (jobId: string, defaultName?: string) => void;
}) {
  const completedJob = props.jobs.find((job) => job.result?.outputPath);
  const wordCount = props.script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration = Math.ceil(wordCount / Math.max(1, 2.5 * props.voiceSpeed));
  const ffmpegReady = props.dependencies.find((item) => item.id === "ffmpeg")?.status === "ok";
  const openAiVoiceReady = props.providers.some((provider) => ["openai", "openai-tts"].includes(provider.id) && provider.enabled && provider.hasSecret && provider.status === "connected");
  const [keywordInput, setKeywordInput] = useState("");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voicePreviewBusy, setVoicePreviewBusy] = useState(false);
  const [projectName, setProjectName] = useState(props.project?.name ?? "");
  const [scriptProviderId, setScriptProviderId] = useState("openai-chat");
  const [scriptTopic, setScriptTopic] = useState("");
  const [scriptLengthHint, setScriptLengthHint] = useState("45-60 seconds");
  const [scriptGenerating, setScriptGenerating] = useState(false);
  const scriptProviders = props.providers.filter((provider) => provider.kind === "script_llm");
  const stockProviders = props.providers.filter((provider) => provider.id === "pexels" || provider.id === "pixabay");
  const [stockProviderId, setStockProviderId] = useState<"pexels" | "pixabay">("pexels");
  const [stockQuery, setStockQuery] = useState("");
  const [stockResults, setStockResults] = useState<StockVideo[]>([]);
  const [stockBusy, setStockBusy] = useState(false);

  useEffect(() => {
    setProjectName(props.project?.name ?? "");
  }, [props.project?.id, props.project?.name]);

  useEffect(() => {
    if (scriptProviders.some((provider) => provider.id === scriptProviderId)) return;
    setScriptProviderId(scriptProviders.find((provider) => provider.enabled)?.id ?? scriptProviders[0]?.id ?? "openai-chat");
  }, [scriptProviders, scriptProviderId]);

  useEffect(() => {
    if (stockProviders.some((provider) => provider.id === stockProviderId)) return;
    setStockProviderId((stockProviders[0]?.id as "pexels" | "pixabay" | undefined) ?? "pexels");
  }, [stockProviders, stockProviderId]);

  function addKeyword() {
    const trimmed = keywordInput.trim().toLowerCase();
    if (!trimmed || props.keywords.includes(trimmed) || props.keywords.length >= 5) return;
    props.onKeywords([...props.keywords, trimmed]);
    setKeywordInput("");
  }

  function suggestKeywords() {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "have", "has", "had", "will",
      "would", "could", "should", "to", "of", "in", "for", "on", "with", "at",
      "by", "from", "and", "but", "or", "if", "this", "that", "these", "those",
      "your", "you", "our", "they", "their", "into", "through",
    ]);
    const counts: Record<string, number> = {};
    for (const word of props.script.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []) {
      if (!stopWords.has(word) && !props.keywords.includes(word)) counts[word] = (counts[word] || 0) + 1;
    }
    const suggested = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);
    if (suggested.length) props.onKeywords([...props.keywords, ...suggested.slice(0, 5 - props.keywords.length)]);
  }

  function removeKeyword(keyword: string) {
    props.onKeywords(props.keywords.filter((item) => item !== keyword));
  }

  async function previewVoice() {
    setVoicePreviewBusy(true);
    try {
      const result = await window.studio.providers.testVoice({
        text: props.script.slice(0, 420),
        voiceName: props.voiceName,
        voiceSpeed: props.voiceSpeed,
      });
      setVoicePreviewUrl(result.audioUrl);
      props.onMessage("Voice preview generated.");
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setVoicePreviewBusy(false);
    }
  }

  async function generateShortScript() {
    setScriptGenerating(true);
    try {
      const generated = await window.studio.script.generate({
        providerId: scriptProviderId,
        topic: scriptTopic || props.project?.name || "AI Video Studio",
        lengthHint: scriptLengthHint,
      });
      props.onScript(generated);
      props.onMessage("Script generated.");
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setScriptGenerating(false);
    }
  }

  async function searchStock() {
    const query = stockQuery.trim() || props.keywords[0] || props.project?.name || "technology";
    setStockBusy(true);
    try {
      const results = await window.studio.stock.search({ providerId: stockProviderId, query, perPage: 8 });
      setStockResults(results);
      props.onMessage(results.length ? `Found ${results.length} stock clips.` : "No stock clips found.");
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStockBusy(false);
    }
  }

  async function downloadStock(video: StockVideo) {
    if (!props.project) return;
    setStockBusy(true);
    try {
      await window.studio.stock.download({ projectId: props.project.id, video, keyword: stockQuery || props.keywords[0] });
      props.onMediaMode("stock_provider");
      props.onMessage("Stock clip downloaded.");
    } catch (error) {
      props.onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStockBusy(false);
    }
  }

  function commitProjectName() {
    if (!props.project) return;
    const trimmed = projectName.trim();
    if (trimmed && trimmed !== props.project.name) props.onRename(trimmed);
  }

  return (
    <section className="studio-layout">
      <aside className="studio-left">
        <button className="button primary full" onClick={props.onCreate}>
          <Plus size={16} />
          New Project
        </button>
        <div className="mini-section">
          <span className="section-label">Projects</span>
          {props.projects.slice(0, 8).map((project) => (
            <button key={project.id} className={props.project?.id === project.id ? "mini-row active" : "mini-row"} onClick={() => props.onProject(project.id)}>
              <FolderOpen size={14} />
              <span>{project.name}</span>
            </button>
          ))}
        </div>
        <div className="mini-section">
          <span className="section-label">Steps</span>
          {steps.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={props.step === item.id ? "step-row active" : "step-row"} onClick={() => props.onStep(item.id)}>
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="workflow-status">
          <div>
            <span className={ffmpegReady ? "status-dot good" : "status-dot bad"} />
            <span>MP4 renderer</span>
            <strong>{ffmpegReady ? "ready" : "needs FFmpeg"}</strong>
          </div>
          <div>
            <span className={openAiVoiceReady ? "status-dot good" : "status-dot quiet"} />
            <span>Voice track</span>
            <strong>{openAiVoiceReady ? "API ready" : "silent fallback"}</strong>
          </div>
        </div>
      </aside>

      <div className="preview-stage">
        <div className="preview-top">
          <div>
            <p className="eyebrow">Preview</p>
            {props.project ? (
              <div className="project-title-editor">
                <input
                  className="title-input"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  onBlur={commitProjectName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
                <button className="icon-button danger" onClick={props.onDelete} title="Delete project">
                  <Trash2 size={15} />
                </button>
              </div>
            ) : (
              <h2>No project selected</h2>
            )}
          </div>
          <StatusBadge tone={completedJob ? "good" : "quiet"}>{completedJob ? "ready" : "draft"}</StatusBadge>
        </div>
        <div className={`phone-frame ratio-${props.aspectRatio.replace(":", "-")}`}>
          {props.latestOutput ? (
            <video src={props.latestOutput} controls className="video-preview" />
          ) : (
            <div className="preview-empty">
              <Play size={40} />
              <strong>Your render will appear here</strong>
              <span>Import clips, choose providers, then generate a desktop MP4.</span>
            </div>
          )}
        </div>
        <div className="preview-actions">
          <button className="button ghost" onClick={props.onImport}>
            <Upload size={16} />
            Import Clips
          </button>
          <button className="button primary" onClick={props.onGenerate} disabled={props.busy || !props.project}>
            {props.busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            Generate MP4
          </button>
          {completedJob?.result?.outputPath && (
            <>
              <button className="button ghost" onClick={() => props.onSaveAs(completedJob.id)}>
                <Download size={16} />
                Save As
              </button>
              <button className="button ghost" onClick={() => props.onReveal(completedJob.result!.outputPath!)}>
                <FolderOpen size={16} />
                Reveal
              </button>
            </>
          )}
        </div>
      </div>

      <aside className="inspector">
        {props.step === "script" && (
          <InspectorPanel title="Script" subtitle="Write the narration and guide media matching with keywords.">
            <textarea className="script-box" value={props.script} onChange={(event) => props.onScript(event.target.value)} />
            <div className="metric-row">
              <span>{wordCount} words</span>
              <span>~{estimatedDuration}s</span>
            </div>
            <div className="editor-group">
              <div className="inspector-row">
                <label className="field-label">Stock keywords</label>
                <button className="link-button" onClick={suggestKeywords} disabled={props.script.length < 20}>
                  <Wand2 size={13} />
                  Auto-suggest
                </button>
              </div>
              <div className="keyword-input-row">
                <input
                  className="input"
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder="Add keyword..."
                  disabled={props.keywords.length >= 5}
                />
                <button className="button ghost" onClick={addKeyword} disabled={props.keywords.length >= 5 || !keywordInput.trim()}>
                  <Plus size={15} />
                </button>
              </div>
              <div className="keyword-list">
                {props.keywords.map((keyword, index) => (
                  <button className="keyword-chip" key={keyword} onClick={() => removeKeyword(keyword)}>
                    <span>{index + 1}</span>
                    {keyword}
                    <X size={12} />
                  </button>
                ))}
                {props.keywords.length === 0 && <p className="hint-copy">Keywords help future stock/API providers and folder matching pick better media.</p>}
              </div>
              <p className="hint-copy">{5 - props.keywords.length} keywords remaining.</p>
            </div>
            <div className="tips-box">
              <Sparkles size={14} />
              <div>
                <strong>Script tips</strong>
                <p>Keep sentences short, open with a hook, and use concrete nouns for better media matching.</p>
              </div>
            </div>
            <div className="editor-group">
              <div className="inspector-row">
                <label className="field-label">
                  <Sparkles size={14} />
                  Script generator
                </label>
                <StatusBadge tone={scriptProviders.length ? "quiet" : "bad"}>{scriptProviders.length ? "available" : "no provider"}</StatusBadge>
              </div>
              <label className="form-field compact">
                <span>Provider</span>
                <select className="input" value={scriptProviderId} onChange={(event) => setScriptProviderId(event.target.value)} disabled={!scriptProviders.length}>
                  {scriptProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name} ({provider.status})</option>
                  ))}
                </select>
              </label>
              <label className="form-field compact">
                <span>Topic</span>
                <input className="input" value={scriptTopic} onChange={(event) => setScriptTopic(event.target.value)} placeholder={props.project?.name ?? "Video topic"} />
              </label>
              <div className="keyword-input-row">
                <select className="input" value={scriptLengthHint} onChange={(event) => setScriptLengthHint(event.target.value)}>
                  <option value="30 seconds">30 seconds</option>
                  <option value="45-60 seconds">45-60 seconds</option>
                  <option value="90 seconds">90 seconds</option>
                </select>
                <button className="button primary" onClick={generateShortScript} disabled={scriptGenerating || !scriptProviders.length}>
                  {scriptGenerating ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                  Generate
                </button>
              </div>
            </div>
          </InspectorPanel>
        )}
        {props.step === "voice" && (
          <InspectorPanel title="Voice" subtitle="Choose the voice used by API TTS now. Optional local voice producers can map these voices later.">
            <div className="voice-list">
              {voices.map((voice) => (
                <button key={voice.id} className={props.voiceName === voice.id ? "voice-card active" : "voice-card"} onClick={() => props.onVoiceName(voice.id)}>
                  <span className="voice-avatar">
                    <User size={17} />
                  </span>
                  <span>
                    <strong>{voice.name}</strong>
                    <small>{voice.description}</small>
                  </span>
                  <StatusBadge tone="quiet">{voice.tone}</StatusBadge>
                </button>
              ))}
            </div>
            <div className="editor-group">
              <div className="inspector-row">
                <label className="field-label">
                  <Volume2 size={14} />
                  Speaking speed
                </label>
                <span className="mono-value">{props.voiceSpeed.toFixed(1)}x</span>
              </div>
              <input type="range" min={0.5} max={2} step={0.1} value={props.voiceSpeed} onChange={(event) => props.onVoiceSpeed(Number(event.target.value))} />
              <div className="speed-markers">
                {[0.5, 1, 1.5, 2].map((speed) => (
                  <button key={speed} className={props.voiceSpeed === speed ? "active" : ""} onClick={() => props.onVoiceSpeed(speed)}>
                    {speed.toFixed(1)}x
                  </button>
                ))}
              </div>
              <p className="hint-copy">{voiceSpeedDescription(props.voiceSpeed)}</p>
            </div>
            <div className="voice-preview-actions">
              <button className="button ghost full" onClick={previewVoice} disabled={voicePreviewBusy}>
                {voicePreviewBusy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                Preview voice
              </button>
              {voicePreviewUrl && <audio className="voice-preview-audio" src={voicePreviewUrl} controls autoPlay />}
            </div>
            <div className="notice">
              <Shield size={16} />
              OpenAI TTS works when you enable the OpenAI provider and save your API key. Without it, the app still renders silently.
            </div>
          </InspectorPanel>
        )}
        {props.step === "media" && (
          <InspectorPanel title="Media" subtitle="Import local clips or search enabled stock providers. Stock validation is off by default.">
            <div className="segmented two">
              <button className={props.mediaMode === "local_assets" ? "active" : ""} onClick={() => props.onMediaMode("local_assets")}>
                Local
              </button>
              <button className={props.mediaMode === "stock_provider" ? "active" : ""} onClick={() => props.onMediaMode("stock_provider")}>
                Stock
              </button>
            </div>
            <button className="button ghost full" onClick={props.onImport}>
              <Upload size={16} />
              Import MP4 / MOV
            </button>
            <div className="asset-list">
              {props.assets.map((asset) => (
                <div className="asset-row" key={asset.id}>
                  <Film size={15} />
                  <span>{String(asset.metadata.filename ?? "Imported clip")}</span>
                  <StatusBadge tone={asset.source === "generated" ? "active" : "quiet"}>{asset.source}</StatusBadge>
                </div>
              ))}
              {props.assets.length === 0 && <EmptyLine text="No clips imported or downloaded yet." />}
            </div>
            <div className="editor-group">
              <div className="inspector-row">
                <label className="field-label">
                  <Image size={14} />
                  Stock search
                </label>
                <StatusBadge tone={stockProviders.some((provider) => provider.enabled && provider.hasSecret) ? "quiet" : "bad"}>keys</StatusBadge>
              </div>
              <label className="form-field compact">
                <span>Provider</span>
                <select className="input" value={stockProviderId} onChange={(event) => setStockProviderId(event.target.value as "pexels" | "pixabay")}>
                  {(["pexels", "pixabay"] as const).map((id) => {
                    const provider = props.providers.find((entry) => entry.id === id);
                    return <option key={id} value={id}>{provider?.name ?? id} ({provider?.status ?? "missing"})</option>;
                  })}
                </select>
              </label>
              <div className="keyword-input-row">
                <input className="input" value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} placeholder={props.keywords[0] ?? "Search stock footage"} />
                <button className="button primary" onClick={searchStock} disabled={stockBusy}>
                  {stockBusy ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                  Search
                </button>
              </div>
              <div className="stock-results">
                {stockResults.map((video) => (
                  <div className="stock-result" key={`${video.provider}-${video.id}`}>
                    <div className="stock-thumb">
                      {video.previewUrl ? <img src={video.previewUrl} alt="" /> : <Film size={20} />}
                    </div>
                    <span>
                      <strong>{video.provider} {video.id}</strong>
                      <small>{video.width}x{video.height} · {Math.round(video.duration)}s</small>
                    </span>
                    <button className="button ghost" onClick={() => downloadStock(video)} disabled={stockBusy || !props.project}>
                      <Download size={14} />
                      Download
                    </button>
                  </div>
                ))}
                {stockResults.length === 0 && <p className="hint-copy">Search results appear here and can be downloaded into this project.</p>}
              </div>
            </div>
          </InspectorPanel>
        )}
        {props.step === "captions" && (
          <InspectorPanel title="Captions" subtitle="Match the web caption controls: presets, colors, size, position, and animation intent.">
            <label className="toggle-row">
              <input type="checkbox" checked={props.captionsEnabled} onChange={(event) => props.onCaptionsEnabled(event.target.checked)} />
              Enable captions
            </label>
            {props.captionsEnabled && (
              <>
                <div className="editor-group">
                  <label className="field-label">
                    <Palette size={14} />
                    Style preset
                  </label>
                  <div className="preset-grid">
                    {subtitlePresets.map((preset) => (
                      <button key={preset.name} className={props.subtitleStyle.name === preset.name ? "preset-card active" : "preset-card"} onClick={() => props.onSubtitleStyle(preset)}>
                        <span className="preset-preview" style={{ backgroundColor: preset.backgroundColor === "transparent" ? "#111827" : preset.backgroundColor }}>
                          <b style={{ color: preset.highlightColor }}>Aa</b>
                          <span style={{ color: preset.primaryColor }}>Bb</span>
                        </span>
                        <small>{preset.name}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="color-grid">
                  <label>
                    <span>Primary</span>
                    <input type="color" value={props.subtitleStyle.primaryColor} onChange={(event) => props.onSubtitleStyle({ ...props.subtitleStyle, primaryColor: event.target.value })} />
                  </label>
                  <label>
                    <span>Highlight</span>
                    <input type="color" value={props.subtitleStyle.highlightColor} onChange={(event) => props.onSubtitleStyle({ ...props.subtitleStyle, highlightColor: event.target.value })} />
                  </label>
                </div>
                <div className="editor-group">
                  <div className="inspector-row">
                    <label className="field-label">Font size</label>
                    <span className="mono-value">{props.captionSize}px</span>
                  </div>
                  <input type="range" min={24} max={82} value={props.captionSize} onChange={(event) => props.onCaptionSize(Number(event.target.value))} />
                </div>
                <div className="position-grid">
                  {[
                    { id: "top", label: "Top", icon: AlignVerticalJustifyStart },
                    { id: "center", label: "Center", icon: AlignVerticalJustifyCenter },
                    { id: "bottom", label: "Bottom", icon: AlignVerticalJustifyEnd },
                  ].map((position) => {
                    const Icon = position.icon;
                    return (
                      <button key={position.id} className={props.subtitlePosition === position.id ? "position-card active" : "position-card"} onClick={() => props.onSubtitlePosition(position.id as "top" | "center" | "bottom")}>
                        <Icon size={18} />
                        {position.label}
                      </button>
                    );
                  })}
                </div>
                <div className="animation-grid">
                  {[
                    { id: "karaoke", label: "Karaoke", description: "Word-by-word highlight" },
                    { id: "fade", label: "Fade", description: "Smooth in/out" },
                    { id: "typewriter", label: "Typewriter", description: "Letter reveal" },
                    { id: "none", label: "None", description: "Static caption" },
                  ].map((animation) => (
                    <button key={animation.id} className={props.subtitleAnimation === animation.id ? "animation-card active" : "animation-card"} onClick={() => props.onSubtitleAnimation(animation.id as "none" | "fade" | "karaoke" | "typewriter")}>
                      <strong>{animation.label}</strong>
                      <small>{animation.description}</small>
                    </button>
                  ))}
                </div>
                <div className="caption-preview">
                  <span style={{ color: props.subtitleStyle.highlightColor }}>Your </span>
                  <span style={{ color: props.subtitleStyle.primaryColor }}>subtitles here</span>
                </div>
              </>
            )}
          </InspectorPanel>
        )}
        {props.step === "export" && (
          <InspectorPanel title="Export" subtitle="Choose output dimensions. The desktop renderer exports MP4/H.264 with audio when a voice provider is configured.">
            <div className="format-grid">
              {aspectRatios.map((ratio) => {
                const Icon = ratio.icon;
                return (
                <button key={ratio.id} className={props.aspectRatio === ratio.id ? "format-card active" : "format-card"} onClick={() => props.onAspectRatio(ratio.id)}>
                  <span className="aspect-icon" data-ratio={ratio.id}>
                    <Icon size={16} />
                  </span>
                  <span>
                    <strong>{ratio.name}</strong>
                    <small>{ratio.description}</small>
                    <em>{ratio.width}x{ratio.height}</em>
                  </span>
                </button>
              )})}
            </div>
            <div className="quality-box">
              <div><span>Output quality</span><strong>HD 1080p</strong></div>
              <div><span>Frame rate</span><strong>30 FPS</strong></div>
              <div><span>Format</span><strong>MP4 H.264</strong></div>
            </div>
            <div className="platform-list">
              {aspectRatios.find((ratio) => ratio.id === props.aspectRatio)?.platforms.map((platform) => (
                <span key={platform}>{platform}</span>
              ))}
            </div>
          </InspectorPanel>
        )}
      </aside>
    </section>
  );
}

function ProviderCenter({
  providers,
  dependencies,
  busyId,
  onTest,
  onSave,
  onInstall,
  onGuide,
  onRefresh,
}: {
  providers: ProviderConfig[];
  dependencies: DependencyStatus[];
  busyId: string | null;
  onTest: (id: string) => void;
  onSave: (config: ProviderSaveInput) => void;
  onInstall: (targetId: string) => void;
  onGuide: (targetId: string) => void;
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0] ?? null;
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [binaryPath, setBinaryPath] = useState("");
  const readyCount = dependencies.filter((item) => item.status === "ok").length;
  const missingDependencies = dependencies.filter((item) => item.status !== "ok");

  useEffect(() => {
    if (!selectedId && providers[0]) setSelectedId(providers[0].id);
  }, [providers, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setEnabled(selected.enabled);
    setBaseUrl(selected.baseUrl ?? "");
    setApiKey("");
    setModelName(String(selected.config.modelName ?? selected.config.model ?? ""));
    setBinaryPath(String(selected.config.binaryPath ?? ""));
  }, [selected?.id]);

  if (!selected) {
    return (
      <section className="providers-layout">
        <EmptyLine text="No providers are registered." />
      </section>
    );
  }

  const setup = providerSetupCopy(selected);
  const canInstall = ["ffmpeg", "piper", "whisper", "ollama", "sqlite3", "flux2"].includes(setup.installTarget);
  const isApiProvider = selected.privacy === "api";
  const hasEndpoint = ["ollama", "lm-studio", "openai", "openai-tts", "openai-chat"].includes(selected.id);
  const providerBusy = busyId === selected.id || busyId === setup.installTarget;
  const endpointPlaceholder = selected.id === "ollama" ? "http://localhost:11434" : selected.id === "lm-studio" ? "http://localhost:1234/v1" : "https://api.openai.com/v1";
  const modelPlaceholder = selected.id === "openai" || selected.id === "openai-tts" ? "tts-1" : selected.id === "ollama" ? "llama3.2" : "gpt-4o-mini";

  function saveSelected() {
    onSave({
      id: selected.id,
      enabled,
      baseUrl: hasEndpoint ? baseUrl.trim() || undefined : selected.baseUrl,
      secret: apiKey || undefined,
      config: {
        ...selected.config,
        modelName: modelName.trim(),
        binaryPath: binaryPath.trim(),
      },
      status: enabled ? selected.status : "disabled",
    });
  }

  return (
    <section className="provider-console">
      <div className="provider-rail">
        <div className="provider-rail-head">
          <div>
            <p className="eyebrow">Provider stack</p>
            <h3>{providers.filter((provider) => provider.enabled).length} enabled</h3>
          </div>
          <button className="icon-button" onClick={onRefresh} title="Re-check providers">
            <RefreshCcw size={16} />
          </button>
        </div>
        <div className="provider-stack">
          {providers.map((provider) => {
            const copy = providerSetupCopy(provider);
            return (
              <button key={provider.id} className={selected.id === provider.id ? "provider-row active" : "provider-row"} onClick={() => setSelectedId(provider.id)}>
                <span className="provider-row-icon">
                  <ProviderIcon provider={provider} />
                </span>
                <span>
                  <strong>{provider.name}</strong>
                  <small>{copy.primary}</small>
                </span>
                <StatusBadge tone={provider.status === "connected" ? "good" : provider.status === "missing" || provider.status === "error" ? "bad" : "quiet"}>
                  {provider.status}
                </StatusBadge>
              </button>
            );
          })}
        </div>
      </div>

      <div className="provider-detail panel">
        <div className="provider-detail-head">
          <div className="provider-title xl">
            <ProviderIcon provider={selected} />
            <div>
              <p className="eyebrow">{selected.kind.replace("_", " ")}</p>
              <div>
                <strong>{selected.name}</strong>
                <small>{setup.secondary}</small>
              </div>
            </div>
          </div>
          <div className="provider-badges">
            <StatusBadge tone={selected.privacy === "local" ? "good" : selected.privacy === "api" ? "active" : "quiet"}>
              {selected.privacy === "local" ? "local" : "api"}
            </StatusBadge>
            <StatusBadge tone={selected.status === "connected" ? "good" : selected.status === "missing" || selected.status === "error" ? "bad" : "quiet"}>
              {selected.status}
            </StatusBadge>
          </div>
        </div>

        <div className="provider-form">
          <label className="switch-line">
            <span>
              <strong>Enable provider</strong>
              <small>Disabled providers are ignored by generation workflows.</small>
            </span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>

          {hasEndpoint && (
            <label className="form-field">
              <span>Base URL</span>
              <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={endpointPlaceholder} />
            </label>
          )}

          {(selected.kind === "script_llm" || selected.id === "openai" || selected.id === "openai-tts") && (
            <label className="form-field">
              <span>Default model</span>
              <input className="input" value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder={modelPlaceholder} />
            </label>
          )}

          {isApiProvider && (
            <label className="form-field">
              <span>{selected.hasSecret ? "Replace API key" : "API key"}</span>
              <input className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected.hasSecret ? "Stored locally. Enter a new key to replace." : "Paste your own key"} />
            </label>
          )}

          {selected.privacy === "local" && !["local-media", "ollama", "lm-studio"].includes(selected.id) && (
            <label className="form-field">
              <span>Custom binary path</span>
              <input className="input" value={binaryPath} onChange={(event) => setBinaryPath(event.target.value)} placeholder="Optional, if the command is not on PATH yet" />
            </label>
          )}

          <div className="provider-actions">
            <button className="button primary" onClick={saveSelected} disabled={providerBusy}>
              {providerBusy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save setup
            </button>
            <button className="button ghost" onClick={() => onTest(selected.id)} disabled={providerBusy}>
              <TerminalSquare size={16} />
              Test
            </button>
            {canInstall && (
              <button className="button ghost" onClick={() => onInstall(setup.installTarget)} disabled={providerBusy}>
                <Package size={16} />
                Install
              </button>
            )}
            <button className="button ghost" onClick={() => onGuide(setup.installTarget)}>
              <ExternalLink size={16} />
              Guide
            </button>
          </div>
        </div>

        <div className="provider-note">
          <SlidersHorizontal size={17} />
          <p>Provider config stays on this workstation. API keys are stored through Electron safe storage when available; optional desktop tools are found through the app runtime PATH plus Homebrew and user-local binary folders.</p>
        </div>
      </div>

      <aside className="dependency-panel panel">
        <div className="panel-head">
          <div>
            <h3>Desktop tools</h3>
            <span>{readyCount}/{dependencies.length || 0} ready</span>
          </div>
          <StatusBadge tone={missingDependencies.length ? "bad" : "good"}>{missingDependencies.length ? "action needed" : "ready"}</StatusBadge>
        </div>
        <div className="dependency-stack">
          {dependencies.map((item) => (
            <div className="dependency-action-row" key={item.id}>
              <DependencyLine item={item} />
              <div className="dependency-actions">
                {item.status !== "ok" && (
                  <button className="button ghost" onClick={() => onInstall(item.id)} disabled={busyId === item.id}>
                    {busyId === item.id ? <Loader2 className="spin" size={15} /> : <Package size={15} />}
                    Install
                  </button>
                )}
                {item.installUrl && (
                  <button className="icon-button" onClick={() => onGuide(item.id)} title={`Open ${item.name} setup guide`}>
                    <ExternalLink size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}

function JobsView({
  jobs,
  selectedJob,
  logs,
  onSelect,
  onSaveAs,
}: {
  jobs: GenerationJob[];
  selectedJob: GenerationJob | null;
  logs: JobLog[];
  onSelect: (id: string) => void;
  onSaveAs: (jobId: string, defaultName?: string) => void;
}) {
  const selectedRequest = selectedJob?.request;
  const selectedAspect = selectedRequest?.kind === "story" ? selectedRequest.config.style.aspectRatio : selectedRequest?.aspectRatio ?? "9:16";
  const selectedVoice = selectedRequest?.kind === "story" ? selectedRequest.config.voiceName : selectedRequest?.voiceName ?? "alloy";

  return (
    <section className="jobs-layout">
      <div className="panel job-list-panel">
        <div className="panel-head">
          <h3>Queue</h3>
          <span>{jobs.length}</span>
        </div>
        <div className="list">
          {jobs.map((job) => (
            <button key={job.id} className={selectedJob?.id === job.id ? "job-row active" : "job-row"} onClick={() => onSelect(job.id)}>
              <StatusBadge tone={jobTone(job.status)}>{job.status}</StatusBadge>
              <span>{job.currentStep || "Queued"}</span>
              <Progress value={job.progress} />
            </button>
          ))}
          {jobs.length === 0 && <EmptyLine text="No jobs yet." />}
        </div>
      </div>
      <div className="panel job-detail-panel">
        {selectedJob ? (
          <>
            <div className="panel-head">
              <h3>{selectedJob.currentStep || selectedJob.status}</h3>
              <StatusBadge tone={jobTone(selectedJob.status)}>{selectedJob.progress}%</StatusBadge>
            </div>
            <Progress value={selectedJob.progress} />
            {selectedJob.error && <div className="error-box">{selectedJob.error}</div>}
            <div className="job-meta-grid">
              <div>
                <span>Provider path</span>
                <strong>{selectedJob.result?.provider ?? (selectedJob.status === "completed" ? "FFmpeg render" : "pending")}</strong>
              </div>
              <div>
                <span>Aspect</span>
                <strong>{selectedAspect}</strong>
              </div>
              <div>
                <span>Voice</span>
                <strong>{selectedVoice}</strong>
              </div>
              <div>
                <span>Audio</span>
                <strong>{selectedJob.result?.audioPath ? "generated" : "silent/fallback"}</strong>
              </div>
            </div>
            {selectedJob.result?.outputPath && (
              <div className="output-box">
                <span>Output</span>
                <code>{selectedJob.result.outputPath}</code>
                <div className="output-actions">
                  <button className="button ghost" onClick={() => onSaveAs(selectedJob.id)}>
                    <Download size={15} />
                    Save As
                  </button>
                  <button className="button ghost" onClick={() => window.studio.exports.revealInFinder(selectedJob.result!.outputPath!)}>
                    <FolderOpen size={15} />
                    Reveal
                  </button>
                </div>
              </div>
            )}
            <div className="log-box">
              {logs.map((log) => (
                <div className={`log-line ${log.level}`} key={log.id}>
                  <span>{log.level}</span>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyLine text="Select a job to inspect logs." />
        )}
      </div>
    </section>
  );
}

function SettingsView({ appInfo, dependencies }: { appInfo: { appDataPath: string; platform: string; pathEntries: string[] } | null; dependencies: DependencyStatus[] }) {
  return (
    <section className="settings-grid">
      <div className="panel">
        <div className="panel-head">
          <h3>Storage</h3>
          <Database size={18} />
        </div>
        <div className="setting-line">
          <span>App data</span>
          <code>{appInfo?.appDataPath ?? "Loading..."}</code>
        </div>
        <div className="setting-line">
          <span>Platform</span>
          <code>{appInfo?.platform ?? "unknown"}</code>
        </div>
        <div className="path-list">
          {(appInfo?.pathEntries ?? []).slice(0, 10).map((entry) => (
            <code key={entry}>{entry}</code>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Privacy</h3>
          <Shield size={18} />
        </div>
        <p className="body-copy">No telemetry is sent by default. API providers only run when you configure and enable them; optional local providers keep those specific tasks on this machine.</p>
      </div>
      <div className="panel wide">
        <div className="panel-head">
          <h3>Installed Tools</h3>
          <span>{dependencies.filter((item) => item.status === "ok").length} ready</span>
        </div>
        <div className="dependency-grid">
          {dependencies.map((item) => (
            <DependencyLine key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function InspectorPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="inspector-panel">
      <p className="eyebrow">{title}</p>
      <h3>{title}</h3>
      <p className="body-copy">{subtitle}</p>
      {children}
    </div>
  );
}

function ProviderIcon({ provider }: { provider: ProviderConfig }) {
  if (provider.kind === "tts") return <Mic2 size={19} />;
  if (provider.kind === "media") return <Film size={19} />;
  if (provider.kind === "render") return <Cpu size={19} />;
  if (provider.kind === "transcription") return <TerminalSquare size={19} />;
  if (provider.privacy === "api") return <KeyRound size={19} />;
  return <Sparkles size={19} />;
}

function DependencyLine({ item }: { item: DependencyStatus }) {
  return (
    <div className="dependency-line">
      {item.status === "ok" ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <div>
        <strong>{item.name}</strong>
        <small>{item.version || item.message || "Not checked"}</small>
      </div>
      <StatusBadge tone={item.status === "ok" ? "good" : "bad"}>{item.status}</StatusBadge>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: typeof Home;
}) {
  return (
    <div className="metric-tile">
      <div className="metric-icon">
        <Icon size={17} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function SetupStep({ complete, title, detail }: { complete: boolean; title: string; detail: string }) {
  return (
    <div className={complete ? "setup-step complete" : "setup-step"}>
      {complete ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" | "active" | "quiet" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="empty-line">{text}</div>;
}
