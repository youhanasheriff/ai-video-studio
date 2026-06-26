import type { GenerationJob, JobStatus, StoryConfig, StoryGenerationRequest, StoryStage } from "../../shared/types";
import { execSql, getJob, getProject, id, logJob, now, sql, updateJob } from "../db";
import { activeJobs, notifyJob } from "../jobs";
import { getStoryConfig } from "./config";
import { ensureStoryStages, firstIncompleteStage, setStoryStage, storyStageOrder } from "./scenes";
import { runAssembleStage } from "./stages/assemble";
import { runFinalizeStage } from "./stages/finalize";
import { runImagesStage } from "./stages/images";
import { runPromptsStage } from "./stages/prompts";
import { runSubtitlesStage } from "./stages/subtitles";
import { runTtsStage } from "./stages/tts";
import { runWriterStage } from "./stages/writer";

const progressBands: Record<StoryStage, [number, number]> = {
  writer: [0, 10],
  prompts: [10, 20],
  images: [20, 55],
  tts: [55, 80],
  assemble: [80, 90],
  subtitles: [90, 96],
  finalize: [96, 100],
};

const stageStatus: Record<StoryStage, JobStatus> = {
  writer: "preparing",
  prompts: "preparing",
  images: "assembling_media",
  tts: "generating_audio",
  assemble: "assembling_media",
  subtitles: "rendering",
  finalize: "rendering",
};

export async function runStoryGeneration(jobId: string, options: { fromStage?: StoryStage } = {}): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  let currentStage: StoryStage | null = null;
  try {
    const initialJob = getJob(jobId);
    if (!initialJob) throw new Error("Story job not found");
    const request = initialJob.request as StoryGenerationRequest;
    if (request.kind !== "story") throw new Error("Job is not a story generation job");
    const config = request.config || getStoryConfig(initialJob.projectId);
    ensureStoryStages(initialJob.projectId);
    const fromStage = options.fromStage || request.fromStage || firstIncompleteStage(initialJob.projectId);
    const startIndex = Math.max(0, storyStageOrder.indexOf(fromStage));
    updateJob(jobId, { status: "preparing", progress: progressBands[fromStage][0], currentStep: `Starting story stage: ${fromStage}`, startedAt: now() });
    execSql(`UPDATE projects SET status = 'processing', updated_at = ${sql(now())} WHERE id = ${sql(initialJob.projectId)};`);
    logJob(jobId, "info", `Story generation started from ${fromStage}.`);
    notifyJob(jobId);

    for (const stage of storyStageOrder.slice(startIndex)) {
      currentStage = stage;
      checkCancelled(jobId);
      await runStage(jobId, initialJob.projectId, config, stage);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const job = getJob(jobId);
    if (job?.status === "cancelled") {
      if (currentStage) setStoryStage(job.projectId, currentStage, { status: "pending", progress: progressBands[currentStage][0], detail: "Cancelled" });
      notifyJob(jobId);
      return;
    }
    updateJob(jobId, { status: "failed", progress: 100, currentStep: "Story generation failed", error: message, completedAt: now() });
    if (job) {
      if (currentStage) setStoryStage(job.projectId, currentStage, { status: "failed", progress: progressBands[currentStage][1], detail: "Failed", error: message });
      execSql(`UPDATE projects SET status = 'failed', updated_at = ${sql(now())} WHERE id = ${sql(job.projectId)};`);
    }
    logJob(jobId, "error", message);
    notifyJob(jobId);
  } finally {
    activeJobs.delete(jobId);
  }
}

async function runStage(jobId: string, projectId: string, config: StoryConfig, stage: StoryStage): Promise<void> {
  const [start, end] = progressBands[stage];
  setStoryStage(projectId, stage, { status: "running", progress: start, detail: `Running ${stage}` });
  updateJob(jobId, { status: stageStatus[stage], progress: start, currentStep: `Story ${stage}` });
  notifyJob(jobId);
  const sceneProgress = (done: number, total: number) => {
    checkCancelled(jobId);
    const progress = Math.round(start + ((end - start) * done) / Math.max(1, total));
    updateJob(jobId, { status: stageStatus[stage], progress, currentStep: `Story ${stage}: ${done}/${total}` });
    setStoryStage(projectId, stage, { status: "running", progress, detail: `${done}/${total}` });
    notifyJob(jobId);
  };
  let output: Record<string, unknown> | null = null;
  if (stage === "writer") output = await runWriterStage(projectId, config);
  if (stage === "prompts") output = await runPromptsStage(projectId, config);
  if (stage === "images") output = await runImagesStage(projectId, config, sceneProgress, jobId);
  if (stage === "tts") output = await runTtsStage(projectId, config, sceneProgress, jobId);
  if (stage === "assemble") output = await runAssembleStage(projectId, config, sceneProgress);
  if (stage === "subtitles") output = runSubtitlesStage(projectId, config);
  if (stage === "finalize") {
    const job = getJob(jobId);
    if (!job) throw new Error("Story job disappeared before finalize");
    const result = await runFinalizeStage(job, config);
    output = { outputPath: result.outputPath, audioPath: result.audioPath };
    updateJob(jobId, { status: "completed", progress: 100, currentStep: "Story render complete", result, completedAt: now() });
    logJob(jobId, "info", "Story render completed.", result);
  }
  setStoryStage(projectId, stage, { status: "done", progress: end, detail: "Done", output });
  if (stage !== "finalize") {
    updateJob(jobId, { status: stageStatus[stage], progress: end, currentStep: `Story ${stage} complete` });
  }
  logJob(jobId, "info", `Story stage ${stage} completed.`, output ?? {});
  notifyJob(jobId);
}

function checkCancelled(jobId: string): void {
  const job = getJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.status === "cancelled") throw new Error("cancelled");
}

export function createStoryJob(projectId: string, config: StoryConfig, fromStage?: StoryStage): GenerationJob {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");
  const jobId = id("job");
  const createdAt = now();
  const request: StoryGenerationRequest = {
    kind: "story",
    projectId,
    config,
    fromStage,
  };
  execSql(`
    INSERT INTO generation_jobs (
      id, project_id, status, progress, current_step, request_json, result_json, error, created_at, started_at, completed_at
    ) VALUES (
      ${sql(jobId)}, ${sql(projectId)}, 'queued', 0, 'Queued for story pipeline',
      ${sql(JSON.stringify(request))}, NULL, NULL, ${sql(createdAt)}, NULL, NULL
    );
    UPDATE projects SET status = 'processing', settings_json = ${sql(JSON.stringify(config))}, updated_at = ${sql(now())}
    WHERE id = ${sql(projectId)};
  `);
  const job = getJob(jobId);
  if (!job) throw new Error("Failed to create story job");
  void runStoryGeneration(jobId, { fromStage });
  return job;
}
