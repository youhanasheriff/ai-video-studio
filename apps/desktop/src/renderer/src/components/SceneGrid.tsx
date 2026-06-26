import { Image, Loader2, RefreshCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Asset, StoryCharacter, StoryScene, StoryScenePatch } from "../../../shared/types";
import { normalizeSceneCharacterKeys, parseCharacterKeyList } from "../../../shared/characters";

export function SceneGrid({
  scenes,
  assets,
  characters,
  busySceneId,
  onSaveScene,
  onRegenerateImage,
}: {
  scenes: StoryScene[];
  assets: Asset[];
  characters: StoryCharacter[];
  busySceneId: number | null;
  onSaveScene: (sceneId: number, patch: StoryScenePatch) => void;
  onRegenerateImage: (sceneId: number, prompt: string) => void;
}) {
  const assetsByScene = useMemo(() => {
    const map = new Map<number, Asset>();
    for (const asset of assets) {
      const sceneId = Number(asset.metadata.sceneId);
      if (Number.isFinite(sceneId)) map.set(sceneId, asset);
    }
    return map;
  }, [assets]);

  return (
    <div className="scene-grid">
      {scenes.map((scene) => (
        <SceneCard
          key={scene.sceneId}
          scene={scene}
          asset={scene.imageAssetId ? assets.find((asset) => asset.id === scene.imageAssetId) ?? assetsByScene.get(scene.sceneId) : assetsByScene.get(scene.sceneId)}
          characters={characters}
          busy={busySceneId === scene.sceneId}
          onSaveScene={onSaveScene}
          onRegenerateImage={onRegenerateImage}
        />
      ))}
      {scenes.length === 0 && (
        <div className="scene-empty">
          <Image size={22} />
          <strong>No scenes yet</strong>
          <span>Run the writer stage to create scene rows.</span>
        </div>
      )}
    </div>
  );
}

function SceneCard({
  scene,
  asset,
  characters,
  busy,
  onSaveScene,
  onRegenerateImage,
}: {
  scene: StoryScene;
  asset?: Asset;
  characters: StoryCharacter[];
  busy: boolean;
  onSaveScene: (sceneId: number, patch: StoryScenePatch) => void;
  onRegenerateImage: (sceneId: number, prompt: string) => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [negativePrompt, setNegativePrompt] = useState(scene.negativePrompt);
  const [characterInput, setCharacterInput] = useState(normalizeSceneCharacterKeys(scene.characters, characters).join(", "));
  const [continuityNotes, setContinuityNotes] = useState(scene.continuityNotes);

  useEffect(() => {
    setTitle(scene.title);
    setPrompt(scene.imagePrompt);
    setNegativePrompt(scene.negativePrompt);
    setCharacterInput(normalizeSceneCharacterKeys(scene.characters, characters).join(", "));
    setContinuityNotes(scene.continuityNotes);
  }, [scene.sceneId, scene.title, scene.imagePrompt, scene.negativePrompt, scene.characters, scene.continuityNotes, characters]);

  return (
    <article className="scene-card">
      <div className="scene-thumb">
        {asset?.fileUrl ? <img src={asset.fileUrl} alt={scene.title} /> : <Image size={30} />}
        <span className={`scene-status ${scene.imageStatus}`}>{scene.imageStatus}</span>
      </div>
      <div className="scene-card-body">
        <div className="scene-title-row">
          <span>{String(scene.sceneId).padStart(4, "0")}</span>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <textarea className="scene-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <input className="input" value={characterInput} onChange={(event) => setCharacterInput(event.target.value)} placeholder="characters_in_scene" />
        <input className="input" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="Negative prompt" />
        <input className="input" value={continuityNotes} onChange={(event) => setContinuityNotes(event.target.value)} placeholder="Continuity notes" />
        {scene.imageError && <p className="scene-error">{scene.imageError}</p>}
        <div className="scene-actions">
          <button className="button ghost" onClick={() => onSaveScene(scene.sceneId, { title, imagePrompt: prompt, negativePrompt, characters: parseCharacterKeyList(characterInput, characters), continuityNotes })}>
            <Save size={14} />
            Save
          </button>
          <button className="button primary" onClick={() => onRegenerateImage(scene.sceneId, prompt)} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}
            Regenerate
          </button>
        </div>
      </div>
    </article>
  );
}
