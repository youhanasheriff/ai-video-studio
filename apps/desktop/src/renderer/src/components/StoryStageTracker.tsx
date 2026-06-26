import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { StoryStage, StoryStageState } from "../../../shared/types";

const labels: Record<StoryStage, string> = {
  writer: "Writer",
  prompts: "Prompts",
  images: "Images",
  tts: "Voice",
  assemble: "Assemble",
  subtitles: "Captions",
  finalize: "Finalize",
};

export function StoryStageTracker({
  stages,
  onRunStage,
  onOpenStage,
}: {
  stages: StoryStageState[];
  onRunStage: (stage: StoryStage) => void;
  onOpenStage: (stage: StoryStage) => void;
}) {
  return (
    <div className="story-stage-tracker">
      {stages.map((stage) => {
        const shouldRun = stage.status === "failed" || stage.status === "pending" || stage.status === "stale";
        return (
          <button
            key={stage.stage}
            type="button"
            className={`story-stage ${stage.status} ${shouldRun ? "can-run" : "can-open"}`}
            onClick={() => shouldRun ? onRunStage(stage.stage) : onOpenStage(stage.stage)}
            title={stage.error || (shouldRun ? `Run ${labels[stage.stage]} stage` : `Open ${labels[stage.stage]} step`)}
          >
            <span className="story-stage-icon">
              {stage.status === "done" && <CheckCircle2 size={15} />}
              {stage.status === "running" && <Loader2 className="spin" size={15} />}
              {stage.status === "failed" && <XCircle size={15} />}
              {!["done", "running", "failed"].includes(stage.status) && <Circle size={15} />}
            </span>
            <span className="story-stage-body">
              <strong>{labels[stage.stage]}</strong>
              <small>{stage.status === "failed" && stage.error ? stage.error : stage.detail || stage.status}</small>
            </span>
            <em>{stage.progress}%</em>
          </button>
        );
      })}
    </div>
  );
}
