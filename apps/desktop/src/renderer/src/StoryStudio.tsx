import { useEffect, useMemo, useState } from "react";
import { BookOpen, Clapperboard, Download, Image, Loader2, Mic2, Play, Plus, RefreshCcw, Save, ScrollText, Sparkles, Trash2, UsersRound } from "lucide-react";
import type { Asset, GenerationJob, Project, ProviderConfig, StoryCharacter, StoryConfig, StoryScene, StoryScenePatch, StoryStage, StoryStageState } from "../../shared/types";
import { characterKey, characterUsageByKey, defaultCharacterConsistency, inferCharactersFromScenes, mergeStoryCharacters } from "../../shared/characters";
import { SceneGrid } from "./components/SceneGrid";
import { StoryStageTracker } from "./components/StoryStageTracker";

type StoryStep = "seed" | "script" | "characters" | "scenes" | "voice" | "render";

const storySteps: Array<{ id: StoryStep; label: string; icon: typeof Sparkles }> = [
  { id: "seed", label: "Seed", icon: Sparkles },
  { id: "script", label: "Script", icon: ScrollText },
  { id: "characters", label: "Characters", icon: UsersRound },
  { id: "scenes", label: "Scenes", icon: Image },
  { id: "voice", label: "Voice", icon: Mic2 },
  { id: "render", label: "Render", icon: Download },
];

const storyStageForStep: Partial<Record<StoryStep, StoryStage>> = {
  script: "writer",
  scenes: "prompts",
  voice: "tts",
  render: "finalize",
};

const stepForStoryStage: Record<StoryStage, StoryStep> = {
  writer: "script",
  prompts: "scenes",
  images: "scenes",
  tts: "voice",
  assemble: "render",
  subtitles: "render",
  finalize: "render",
};

const openAiVoices = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
const orpheusVoices = ["autumn", "diana", "hannah", "austin", "daniel", "troy"];

export function createDefaultStoryConfig(seed = ""): StoryConfig {
  return {
    seed,
    target: {
      scriptWords: 1200,
      sceneCount: 8,
      approximateMinutes: 8,
    },
    style: {
      genre: "bedtime narration",
      visualStyle: "cinematic storybook illustration",
      aspectRatio: "16:9",
      styleLock: "soft cinematic storybook lighting",
      palette: "amber, deep teal, moonlit blue, warm white",
      crossfade: false,
      kenBurns: true,
    },
    imageProvider: "google",
    voiceProvider: "openai-tts",
    llmProviderId: "openai-chat",
    llmModel: "gpt-4o-mini",
    imageBackend: "imagen",
    imageModel: "imagen-4.0-fast-generate-001",
    characters: [],
    characterConsistency: defaultCharacterConsistency,
    voiceName: "alloy",
    voiceSpeed: 1,
    subtitles: {
      enabled: true,
      style: "karaoke",
      karaoke: true,
    },
  };
}

export function StoryStudio({
  project,
  providers,
  assets,
  jobs,
  onRefresh,
  onMessage,
  onReveal,
  onRename,
  onDelete,
  onSaveAs,
}: {
  project: Project;
  providers: ProviderConfig[];
  assets: Asset[];
  jobs: GenerationJob[];
  onRefresh: (projectId?: string) => Promise<void>;
  onMessage: (message: string) => void;
  onReveal: (path: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSaveAs: (jobId: string, defaultName?: string) => void;
}) {
  const [step, setStep] = useState<StoryStep>("seed");
  const [config, setConfig] = useState<StoryConfig>(() => createDefaultStoryConfig());
  const [script, setScript] = useState(project.script);
  const [scenes, setScenes] = useState<StoryScene[]>([]);
  const [stages, setStages] = useState<StoryStageState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [busySceneId, setBusySceneId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState(project.name);

  const storyJobs = useMemo(() => jobs.filter((job) => job.request.kind === "story"), [jobs]);
  const activeJob = storyJobs.find((job) => !["completed", "failed", "cancelled"].includes(job.status));
  const completedJob = storyJobs.find((job) => job.status === "completed" && job.result?.outputUrl);
  const outputPath = completedJob?.result?.outputPath ?? null;
  const outputUrl = completedJob?.result?.outputUrl ?? null;
  const stageStatus = (stage: StoryStage) => stages.find((item) => item.stage === stage)?.status;
  const assembleDone = stageStatus("assemble") === "done";
  const finalizeDone = stageStatus("finalize") === "done";
  const characterUsage = useMemo(() => characterUsageByKey(scenes, config.characters), [scenes, config.characters]);

  useEffect(() => {
    setScript(project.script);
    setProjectName(project.name);
    void loadStory();
  }, [project.id, project.name]);

  useEffect(() => {
    if (!activeJob) return;
    const interval = setInterval(() => {
      void loadStory(false);
    }, 1200);
    return () => clearInterval(interval);
  }, [activeJob?.id]);

  async function loadStory(refreshProject = false) {
    const [nextConfig, nextScenes, nextStages] = await Promise.all([
      window.studio.story.getConfig(project.id),
      window.studio.story.scenes(project.id),
      window.studio.story.stages(project.id),
    ]);
    setConfig(nextConfig);
    setScenes(nextScenes);
    setStages(nextStages);
    if (refreshProject) await onRefresh(project.id);
  }

  async function saveConfig() {
    setBusy("config");
    try {
      const saved = await window.studio.story.saveConfig(project.id, config);
      setConfig(saved);
      onMessage("Story settings saved.");
      await loadStory(true);
    } finally {
      setBusy(null);
    }
  }

  async function runStory(fromStage?: StoryStage) {
    setBusy(fromStage || "run");
    try {
      const saved = await window.studio.story.saveConfig(project.id, config);
      setConfig(saved);
      const job = await window.studio.story.run(project.id, fromStage);
      onMessage(`Story job queued: ${job.currentStep || job.status}.`);
      await onRefresh(project.id);
      await loadStory();
    } finally {
      setBusy(null);
    }
  }

  async function runStage(stage: StoryStage) {
    setBusy(stage);
    try {
      const saved = await window.studio.story.saveConfig(project.id, config);
      setConfig(saved);
      const job = await window.studio.story.runStage(project.id, stage);
      onMessage(`Stage queued: ${stage}.`);
      await onRefresh(project.id);
      await loadStory();
      void job;
    } finally {
      setBusy(null);
    }
  }

  function openStage(stage: StoryStage) {
    setStep(stepForStoryStage[stage]);
  }

  async function saveScript() {
    setBusy("script");
    try {
      const nextScenes = await window.studio.story.updateScript(project.id, script);
      setScenes(nextScenes);
      onMessage("Story script saved and scenes refreshed.");
      await onRefresh(project.id);
      await loadStory();
    } finally {
      setBusy(null);
    }
  }

  async function saveScene(sceneId: number, patch: StoryScenePatch) {
    const updated = await window.studio.story.updateScene(project.id, sceneId, patch);
    setScenes((items) => items.map((item) => item.sceneId === sceneId ? updated : item));
    onMessage(`Scene ${String(sceneId).padStart(4, "0")} saved.`);
  }

  function addCharacter() {
    const nextNumber = config.characters.length + 1;
    const next: StoryCharacter = {
      key: `character_${nextNumber}`,
      name: `Character ${nextNumber}`,
      visualToken: `Character ${nextNumber}`,
      wardrobe: "",
      portraitPose: "standing in a neutral pose, three-quarter view, full body visible",
      portraitBackground: "soft neutral studio background with gentle lighting",
    };
    setConfig((current) => ({ ...current, characters: [...current.characters, next] }));
  }

  function updateCharacter(index: number, patch: Partial<StoryCharacter>) {
    setConfig((current) => ({
      ...current,
      characters: current.characters.map((character, itemIndex) => {
        if (itemIndex !== index) return character;
        const merged = { ...character, ...patch };
        if (patch.name && (!patch.key || patch.key === character.key)) merged.key = characterKey(patch.name) || character.key;
        if (patch.key) merged.key = characterKey(patch.key) || character.key;
        return merged;
      }),
    }));
  }

  function removeCharacter(key: string) {
    setConfig((current) => ({
      ...current,
      characters: current.characters.filter((character) => character.key !== key),
    }));
  }

  function extractCharacters() {
    setConfig((current) => ({
      ...current,
      characters: mergeStoryCharacters(current.characters, inferCharactersFromScenes(scenes)),
    }));
  }

  async function regenerateImage(sceneId: number, prompt: string) {
    setBusySceneId(sceneId);
    try {
      const updated = await window.studio.story.regenerateImage(project.id, sceneId, prompt);
      setScenes((items) => items.map((item) => item.sceneId === sceneId ? updated : item));
      await onRefresh(project.id);
      onMessage(`Scene ${String(sceneId).padStart(4, "0")} image regenerated.`);
    } finally {
      setBusySceneId(null);
    }
  }

  function commitProjectName() {
    const trimmed = projectName.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
  }

  const providerStatus = (id: string) => providers.find((provider) => provider.id === id)?.status ?? "disabled";
  const providerOptions = {
    llm: providers.filter((provider) => provider.kind === "script_llm"),
    image: providers.filter((provider) => provider.kind === "media"),
    voice: providers.filter((provider) => provider.kind === "tts"),
  };
  const selectedVoiceProvider = useMemo(
    () => providers.find((provider) => provider.id === config.voiceProvider),
    [providers, config.voiceProvider],
  );
  const voiceChoices = useMemo(() => voiceChoicesForProvider(selectedVoiceProvider), [selectedVoiceProvider]);

  useEffect(() => {
    if (!voiceChoices.length || voiceChoices.some((voice) => voice.id === config.voiceName)) return;
    setConfig((current) => ({ ...current, voiceName: voiceChoices[0].id }));
  }, [voiceChoices, config.voiceName]);

  return (
    <section className="story-layout">
      <aside className="story-left">
        <div className="story-project-mark">
          <BookOpen size={19} />
          <span>
            <input
              className="title-input compact"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onBlur={commitProjectName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <small>{scenes.length || config.target.sceneCount} scenes planned</small>
          </span>
          <button className="icon-button danger" onClick={onDelete} title="Delete project">
            <Trash2 size={14} />
          </button>
        </div>
        <div className="mini-section">
          <span className="section-label">Story Steps</span>
          {storySteps.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={step === item.id ? "step-row active" : "step-row"} onClick={() => setStep(item.id)}>
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>
        <StoryStageTracker stages={stages} onRunStage={runStage} onOpenStage={openStage} />
      </aside>

      <main className="story-main">
        {step === "seed" && (
          <StoryPanel title="Seed" subtitle="Define the story target, style lock, and cloud providers.">
            <label className="form-field">
              <span>Seed</span>
              <textarea className="script-box story-seed-box" value={config.seed} onChange={(event) => setConfig({ ...config, seed: event.target.value })} />
            </label>
            <div className="story-form-grid">
              <NumberField label="Script words" value={config.target.scriptWords} onChange={(value) => setConfig({ ...config, target: { ...config.target, scriptWords: value } })} />
              <NumberField label="Scenes" value={config.target.sceneCount} onChange={(value) => setConfig({ ...config, target: { ...config.target, sceneCount: value } })} />
              <NumberField label="Minutes" value={config.target.approximateMinutes ?? 8} onChange={(value) => setConfig({ ...config, target: { ...config.target, approximateMinutes: value } })} />
            </div>
            <div className="story-form-grid two">
              <TextField label="Genre" value={config.style.genre} onChange={(value) => setConfig({ ...config, style: { ...config.style, genre: value } })} />
              <TextField label="Visual style" value={config.style.visualStyle} onChange={(value) => setConfig({ ...config, style: { ...config.style, visualStyle: value } })} />
              <TextField label="Style lock" value={config.style.styleLock ?? ""} onChange={(value) => setConfig({ ...config, style: { ...config.style, styleLock: value } })} />
              <TextField label="Palette" value={config.style.palette ?? ""} onChange={(value) => setConfig({ ...config, style: { ...config.style, palette: value } })} />
            </div>
            <div className="story-form-grid three">
              <SelectField label="LLM" value={config.llmProviderId} options={providerOptions.llm.map((provider) => ({ value: provider.id, label: `${provider.name} (${provider.status})` }))} onChange={(value) => setConfig({ ...config, llmProviderId: value })} />
              <SelectField label="Images" value={config.imageProvider} options={providerOptions.image.map((provider) => ({ value: provider.id, label: `${provider.name} (${provider.status})` }))} onChange={(value) => setConfig({ ...config, imageProvider: value })} />
              <SelectField label="Voice" value={config.voiceProvider} options={providerOptions.voice.map((provider) => ({ value: provider.id, label: `${provider.name} (${provider.status})` }))} onChange={(value) => setConfig({ ...config, voiceProvider: value })} />
            </div>
            <div className="story-form-grid three">
              <SelectField label="Aspect" value={config.style.aspectRatio} options={["16:9", "9:16", "1:1", "4:5"].map((value) => ({ value, label: value }))} onChange={(value) => setConfig({ ...config, style: { ...config.style, aspectRatio: value as StoryConfig["style"]["aspectRatio"] } })} />
              <TextField label="LLM model" value={config.llmModel ?? ""} onChange={(value) => setConfig({ ...config, llmModel: value })} />
              <TextField label="Image model" value={config.imageModel ?? ""} onChange={(value) => setConfig({ ...config, imageModel: value })} />
            </div>
            <div className="story-actions">
              <button className="button ghost" onClick={saveConfig} disabled={busy === "config"}>
                <Save size={15} />
                Save
              </button>
              <button className="button primary" onClick={() => runStory("writer")} disabled={Boolean(busy)}>
                {busy === "writer" ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                Generate Story
              </button>
            </div>
            <div className="story-provider-strip">
              <ProviderPill label="LLM" value={config.llmProviderId} status={providerStatus(config.llmProviderId)} />
              <ProviderPill label="Images" value={config.imageProvider} status={providerStatus(config.imageProvider)} />
              <ProviderPill label="Voice" value={config.voiceProvider} status={providerStatus(config.voiceProvider)} />
            </div>
          </StoryPanel>
        )}

        {step === "script" && (
          <StoryPanel title="Script" subtitle="Edit the generated narration. Scene headings rebuild the scene table.">
            <textarea className="script-box story-script-box" value={script} onChange={(event) => setScript(event.target.value)} />
            <div className="story-actions">
              <button className="button ghost" onClick={saveScript} disabled={busy === "script" || !script.trim()}>
                <Save size={15} />
                Save script
              </button>
              <button className="button primary" onClick={() => runStory("writer")} disabled={Boolean(busy)}>
                <RefreshCcw size={15} />
                Regenerate writer
              </button>
            </div>
          </StoryPanel>
        )}

        {step === "characters" && (
          <StoryPanel title="Characters" subtitle="Maintain canonical identities, wardrobe, and reference portrait settings.">
            <div className="character-control-grid">
              <label className="switch-line">
                <span>
                  <strong>Character consistency</strong>
                  <small>{config.characterConsistency.enabled ? "Enabled" : "Disabled"}</small>
                </span>
                <input
                  type="checkbox"
                  checked={config.characterConsistency.enabled}
                  onChange={(event) => setConfig({
                    ...config,
                    characterConsistency: { ...config.characterConsistency, enabled: event.target.checked },
                  })}
                />
              </label>
              <SelectField
                label="Mode"
                value={config.characterConsistency.mode}
                options={[
                  { value: "prompt_tokens", label: "Prompt tokens" },
                  { value: "reference_images", label: "Reference images" },
                ]}
                onChange={(value) => setConfig({
                  ...config,
                  characterConsistency: { ...config.characterConsistency, mode: value as StoryConfig["characterConsistency"]["mode"] },
                })}
              />
              <NumberField
                label="Max refs per scene"
                value={config.characterConsistency.maxRefsPerScene}
                onChange={(value) => setConfig({
                  ...config,
                  characterConsistency: { ...config.characterConsistency, maxRefsPerScene: value },
                })}
              />
            </div>
            <TextField
              label="Characters directory"
              value={config.characterConsistency.charactersDir ?? ""}
              onChange={(value) => setConfig({
                ...config,
                characterConsistency: { ...config.characterConsistency, charactersDir: value || undefined },
              })}
            />
            <div className="story-actions">
              <button className="button ghost" onClick={addCharacter}>
                <Plus size={15} />
                Add character
              </button>
              <button className="button ghost" onClick={extractCharacters} disabled={!scenes.length}>
                <UsersRound size={15} />
                Extract from scenes
              </button>
              <button className="button primary" onClick={saveConfig} disabled={busy === "config"}>
                {busy === "config" ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                Save characters
              </button>
            </div>
            <div className="character-grid">
              {config.characters.map((character, index) => (
                <article className="character-card" key={`${character.key}-${index}`}>
                  <div className="character-card-head">
                    <span className="character-avatar"><UsersRound size={16} /></span>
                    <div>
                      <strong>{character.name || character.key}</strong>
                      <small>{character.key}</small>
                    </div>
                    <button className="icon-button danger" onClick={() => removeCharacter(character.key)} title="Remove character">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="character-fields">
                    <TextField label="Name" value={character.name} onChange={(value) => updateCharacter(index, { name: value })} />
                    <TextField label="Key" value={character.key} onChange={(value) => updateCharacter(index, { key: value })} />
                    <TextField label="Visual token" value={character.visualToken} onChange={(value) => updateCharacter(index, { visualToken: value })} />
                    <TextField label="Wardrobe" value={character.wardrobe} onChange={(value) => updateCharacter(index, { wardrobe: value })} />
                  </div>
                  <label className="form-field">
                    <span>Portrait pose</span>
                    <textarea className="mini-textarea" value={character.portraitPose ?? ""} onChange={(event) => updateCharacter(index, { portraitPose: event.target.value })} />
                  </label>
                  <label className="form-field">
                    <span>Portrait background</span>
                    <textarea className="mini-textarea" value={character.portraitBackground ?? ""} onChange={(event) => updateCharacter(index, { portraitBackground: event.target.value })} />
                  </label>
                  <div className="character-usage">
                    {(characterUsage.get(character.key) ?? []).slice(0, 10).map((sceneId) => (
                      <span key={sceneId}>{String(sceneId).padStart(4, "0")}</span>
                    ))}
                    {!characterUsage.has(character.key) && <em>Unused</em>}
                  </div>
                </article>
              ))}
              {config.characters.length === 0 && (
                <div className="scene-empty">
                  <UsersRound size={22} />
                  <strong>No characters yet</strong>
                  <span>Character roster is empty.</span>
                </div>
              )}
            </div>
          </StoryPanel>
        )}

        {step === "scenes" && (
          <StoryPanel title="Scenes" subtitle="Review image prompts and regenerate individual scene images.">
            <div className="story-actions">
              <button className="button ghost" onClick={() => runStory("prompts")} disabled={Boolean(busy)}>
                <ScrollText size={15} />
                Generate prompts
              </button>
              <button className="button primary" onClick={() => runStory("images")} disabled={Boolean(busy)}>
                <Image size={15} />
                Generate images
              </button>
            </div>
            <SceneGrid scenes={scenes} assets={assets} characters={config.characters} busySceneId={busySceneId} onSaveScene={saveScene} onRegenerateImage={regenerateImage} />
          </StoryPanel>
        )}

        {step === "voice" && (
          <StoryPanel title="Voice" subtitle="Choose narrator voice and generate per-scene audio timings.">
            <div className="story-voice-grid">
              {voiceChoices.map((voice) => (
                <button key={voice.id} className={config.voiceName === voice.id ? "voice-card active" : "voice-card"} onClick={() => setConfig({ ...config, voiceName: voice.id })}>
                  <span className="voice-avatar"><Mic2 size={16} /></span>
                  <span><strong>{voice.id}</strong><small>{voice.description}</small></span>
                </button>
              ))}
            </div>
            <div className="editor-group">
              <div className="inspector-row">
                <label className="field-label">Voice speed</label>
                <span className="mono-value">{config.voiceSpeed.toFixed(1)}x</span>
              </div>
              <input type="range" min={0.5} max={2} step={0.1} value={config.voiceSpeed} onChange={(event) => setConfig({ ...config, voiceSpeed: Number(event.target.value) })} />
            </div>
            <div className="story-actions">
              <button className="button ghost" onClick={saveConfig} disabled={Boolean(busy)}>
                <Save size={15} />
                Save voice
              </button>
              <button className="button primary" onClick={() => runStory("tts")} disabled={Boolean(busy)}>
                <Mic2 size={15} />
                Generate narration
              </button>
            </div>
          </StoryPanel>
        )}

        {step === "render" && (
          <StoryPanel title="Render" subtitle="Assemble the story video, burn karaoke captions, and export MP4.">
            <div className="story-render-grid">
              <label className="toggle-row"><input type="checkbox" checked={config.subtitles.enabled} onChange={(event) => setConfig({ ...config, subtitles: { ...config.subtitles, enabled: event.target.checked } })} /> Burn captions</label>
              <label className="toggle-row"><input type="checkbox" checked={config.subtitles.karaoke} onChange={(event) => setConfig({ ...config, subtitles: { ...config.subtitles, karaoke: event.target.checked } })} /> Karaoke timing</label>
              <label className="toggle-row"><input type="checkbox" checked={Boolean(config.style.kenBurns)} onChange={(event) => setConfig({ ...config, style: { ...config.style, kenBurns: event.target.checked } })} /> Ken Burns</label>
              <label className="toggle-row"><input type="checkbox" checked={Boolean(config.style.crossfade)} onChange={(event) => setConfig({ ...config, style: { ...config.style, crossfade: event.target.checked } })} /> Crossfade</label>
            </div>
            <div className={`story-preview ratio-${config.style.aspectRatio.replace(":", "-")}`}>
              {outputUrl ? <video src={outputUrl} controls /> : <div><Play size={34} /><strong>No story render yet</strong></div>}
            </div>
            <div className="story-actions">
              <button className="button ghost" onClick={() => runStory("assemble")} disabled={Boolean(busy) || assembleDone}>
                <Clapperboard size={15} />
                {assembleDone ? "Assembled" : "Assemble"}
              </button>
              <button className="button primary" onClick={() => runStory("finalize")} disabled={Boolean(busy) || finalizeDone}>
                <Download size={15} />
                {finalizeDone ? "Finalized" : "Finalize MP4"}
              </button>
              {completedJob?.id && (
                <button className="button ghost" onClick={() => onSaveAs(completedJob.id)}>
                  <Download size={15} />
                  Save As
                </button>
              )}
              {outputPath && (
                <button className="button ghost" onClick={() => onReveal(outputPath)}>
                  Reveal
                </button>
              )}
            </div>
          </StoryPanel>
        )}
      </main>
    </section>
  );
}

function StoryPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="story-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Story</p>
          <h3>{title}</h3>
        </div>
        <span>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input className="input" type="number" value={value} min={1} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ProviderPill({ label, value, status }: { label: string; value: string; status: string }) {
  return (
    <div className={`story-provider-pill ${status}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{status}</em>
    </div>
  );
}

function voiceChoicesForProvider(provider?: ProviderConfig): Array<{ id: string; description: string }> {
  const modelName = String(provider?.config?.modelName ?? provider?.config?.model ?? "").toLowerCase();
  const baseUrl = String(provider?.baseUrl ?? "").toLowerCase();
  const isOrpheus = baseUrl.includes("groq.com") || modelName.includes("orpheus");
  const ids = isOrpheus ? orpheusVoices : openAiVoices;
  return ids.map((id) => ({ id, description: isOrpheus ? "Groq Orpheus voice" : "OpenAI TTS voice" }));
}
