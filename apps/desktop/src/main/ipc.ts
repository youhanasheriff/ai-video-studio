import { execFile } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { dialog, ipcMain, shell } from "electron";
import type {
  Asset,
  CreateProjectInput,
  DependencyStatus,
  GenerationRequest,
  JobLog,
  Project,
  ProviderInstallResult,
  ProviderSaveInput,
  ProviderStatus,
} from "../shared/types";
import {
  type AssetRow,
  type JobRow,
  type ProjectRow,
  type ProviderRow,
  execSql,
  getJob,
  getProject,
  id,
  listAssets,
  mapAsset,
  mapJob,
  mapProject,
  mapProvider,
  now,
  parseJson,
  querySql,
  sql,
  updateJob,
} from "./db";
import { ffmpegBinary } from "./ffmpeg";
import { notifyJob, runGeneration } from "./jobs";
import { getDbPath, getProjectsDir, projectDir, resetRuntimePathCache, runtimeEnv, runtimePath } from "./paths";
import { checkBinary, hasSecret, installPlan, providerBinary, readProviderSecret, saveProviderSecret } from "./providers";
import { generateScript } from "./script";
import { registerStoryIpc } from "./story/ipc";
import { cancelStoryProcess } from "./story/subprocess";
import { downloadStockAsset, searchStockVideos } from "./stock";
import { testOpenAiVoice } from "./tts";
import { getMainWindow } from "./window";

const execFileAsync = promisify(execFile);

export function registerIpc(): void {
  registerStoryIpc();

  ipcMain.handle("providers:list", async () => {
    return querySql<ProviderRow>("SELECT * FROM providers ORDER BY privacy, kind, name;").map((row) => ({
      ...mapProvider(row),
      hasSecret: Boolean(row.has_secret) || hasSecret(row.id),
    }));
  });

  ipcMain.handle("providers:save", async (_event, patch: ProviderSaveInput) => {
    const existing = querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(patch.id)} LIMIT 1;`)[0];
    if (!existing) throw new Error("Provider not found");
    if (patch.secret !== undefined) saveProviderSecret(patch.id, patch.secret);
    const nextHasSecret = patch.secret !== undefined ? Boolean(patch.secret.trim()) : Boolean(existing.has_secret) || hasSecret(patch.id);
    // Saving a non-empty API key auto-enables the provider so its "connected" state is honest.
    const savedKey = patch.secret !== undefined && Boolean(patch.secret.trim());
    const nextEnabled = patch.enabled ?? (savedKey ? true : Boolean(existing.enabled));
    execSql(`
      UPDATE providers SET
        enabled = ${sql(nextEnabled)},
        base_url = ${sql(patch.baseUrl ?? existing.base_url)},
        status = ${sql(patch.status ?? existing.status)},
        has_secret = ${sql(patch.hasSecret ?? nextHasSecret)},
        config_json = ${sql(JSON.stringify(patch.config ?? parseJson(existing.config_json, {})))},
        updated_at = ${sql(now())}
      WHERE id = ${sql(patch.id)};
    `);
    return mapProvider(querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(patch.id)};`)[0]);
  });

  ipcMain.handle("providers:test", async (_event, providerId: string) => {
    const provider = querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(providerId)} LIMIT 1;`)[0];
    if (!provider) throw new Error("Provider not found");
    let status: ProviderStatus = "connected";
    if (providerId === "ffmpeg") status = (await checkBinary(providerBinary(provider, "ffmpeg"))).status === "ok" ? "connected" : "missing";
    if (providerId === "piper") status = (await checkBinary(providerBinary(provider, "piper"))).status === "ok" ? "connected" : "missing";
    if (providerId === "whisper") status = (await checkBinary(providerBinary(provider, "whisper"), ["--help"])).status === "ok" ? "connected" : "missing";
    if (providerId === "flux2") status = (await checkBinary(providerBinary(provider, "mflux-generate-flux2"), ["--help"])).status === "ok" ? "connected" : "missing";
    if (providerId === "cosyvoice") {
      const config = parseJson<Record<string, unknown>>(provider.config_json, {});
      const repoPath = String(config.repoPath ?? config.binaryPath ?? "").trim();
      const condaReady = (await checkBinary("conda")).status === "ok";
      status = condaReady && repoPath && existsSync(repoPath) ? "connected" : "missing";
    }
    if (providerId === "ollama") {
      try {
        await execFileAsync("curl", ["-sf", `${provider.base_url ?? "http://localhost:11434"}/api/tags`], { timeout: 2500, env: runtimeEnv() });
        status = "connected";
      } catch {
        status = "missing";
      }
    }
    if (providerId === "lm-studio") {
      try {
        await execFileAsync("curl", ["-sf", `${provider.base_url ?? "http://localhost:1234/v1"}/models`], { timeout: 2500, env: runtimeEnv() });
        status = "connected";
      } catch {
        status = "missing";
      }
    }
    if (["openai", "openai-tts", "openai-chat", "google"].includes(providerId)) {
      const secret = readProviderSecret(providerId);
      if (!secret) {
        status = "disabled";
      } else {
        try {
          const baseUrl = (provider.base_url || (providerId === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1")).replace(/\/$/, "");
          const response = providerId === "google"
            ? await fetch(`${baseUrl}/models`, { headers: { "X-goog-api-key": secret } })
            : await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${secret}` } });
          status = response.ok ? "connected" : "error";
        } catch {
          status = "error";
        }
      }
    }
    if (["pexels", "pixabay"].includes(providerId)) {
      status = hasSecret(providerId) || Boolean(provider.has_secret) ? "connected" : "disabled";
    }
    // A successful connection test auto-enables the provider so "connected" means usable.
    const nextEnabled = status === "connected" ? true : Boolean(provider.enabled);
    execSql(`
      UPDATE providers SET
        status = ${sql(status)},
        enabled = ${sql(nextEnabled)},
        has_secret = ${sql(Boolean(provider.has_secret) || hasSecret(providerId))},
        updated_at = ${sql(now())}
      WHERE id = ${sql(providerId)};
    `);
    return mapProvider(querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(providerId)};`)[0]);
  });

  ipcMain.handle("providers:testVoice", async (_event, input: { text?: string; voiceName: string; voiceSpeed: number }) => {
    return testOpenAiVoice(input);
  });

  ipcMain.handle("providers:install", async (_event, targetId: string): Promise<ProviderInstallResult> => {
    const plan = installPlan(targetId);
    if (!plan.command) {
      await shell.openExternal(plan.guideUrl);
      return {
        ok: false,
        targetId,
        message: "No safe in-app installer is available for this provider on this platform. Opened the setup guide.",
      };
    }
    try {
      const shellBinary = process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/zsh";
      const args = process.platform === "win32" ? ["/d", "/s", "/c", plan.command] : ["-lc", plan.command];
      const { stdout, stderr } = await execFileAsync(shellBinary, args, {
        timeout: 180000,
        maxBuffer: 1024 * 1024 * 4,
        env: runtimeEnv(),
      });
      resetRuntimePathCache();
      if (["ffmpeg", "piper", "whisper", "ollama", "flux2"].includes(targetId)) {
        const providerId = targetId === "ffmpeg" ? "ffmpeg" : targetId;
        const provider = querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(providerId)} LIMIT 1;`)[0];
        if (provider) {
          execSql(`UPDATE providers SET enabled = 1, updated_at = ${sql(now())} WHERE id = ${sql(providerId)};`);
        }
      }
      return {
        ok: true,
        targetId,
        command: plan.command,
        message: `${plan.label} finished. Re-check providers to confirm PATH discovery.`,
        log: `${stdout}\n${stderr}`.trim().slice(-4000),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        targetId,
        command: plan.command,
        message: `${plan.label} did not finish. Open the guide or run the command manually.`,
        log: message.slice(-4000),
      };
    }
  });

  ipcMain.handle("providers:openInstallGuide", async (_event, targetId: string) => {
    await shell.openExternal(installPlan(targetId).guideUrl);
  });

  ipcMain.handle("projects:list", async () => {
    return querySql<ProjectRow>("SELECT * FROM projects ORDER BY updated_at DESC;").map(mapProject);
  });

  ipcMain.handle("projects:create", async (_event, input: CreateProjectInput) => {
    const projectId = id("project");
    const createdAt = now();
    const settings = { aspectRatio: input.aspectRatio ?? "9:16" };
    execSql(`
      INSERT INTO projects (id, name, mode, status, script, settings_json, created_at, updated_at)
      VALUES (
        ${sql(projectId)}, ${sql(input.name || "Untitled Video")}, ${sql(input.mode ?? "short")}, 'draft',
        ${sql(input.script ?? "")}, ${sql(JSON.stringify(settings))}, ${sql(createdAt)}, ${sql(createdAt)}
      );
    `);
    projectDir(projectId);
    return getProject(projectId);
  });

  ipcMain.handle("projects:get", async (_event, projectId: string) => getProject(projectId));

  ipcMain.handle("projects:update", async (_event, projectId: string, patch: Partial<Project>) => {
    const existing = getProject(projectId);
    if (!existing) throw new Error("Project not found");
    execSql(`
      UPDATE projects SET
        name = ${sql(patch.name ?? existing.name)},
        status = ${sql(patch.status ?? existing.status)},
        script = ${sql(patch.script ?? existing.script)},
        settings_json = ${sql(JSON.stringify(patch.settings ?? existing.settings))},
        updated_at = ${sql(now())}
      WHERE id = ${sql(projectId)};
    `);
    return getProject(projectId);
  });

  ipcMain.handle("projects:delete", async (_event, projectId: string) => {
    execSql(`
      DELETE FROM job_logs WHERE job_id IN (SELECT id FROM generation_jobs WHERE project_id = ${sql(projectId)});
      DELETE FROM exports WHERE project_id = ${sql(projectId)};
      DELETE FROM story_scenes WHERE project_id = ${sql(projectId)};
      DELETE FROM story_stages WHERE project_id = ${sql(projectId)};
      DELETE FROM projects WHERE id = ${sql(projectId)};
      DELETE FROM assets WHERE project_id = ${sql(projectId)};
      DELETE FROM generation_jobs WHERE project_id = ${sql(projectId)};
    `);
    const dir = join(getProjectsDir(), projectId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle("assets:importFiles", async (_event, projectId: string) => {
    const project = getProject(projectId);
    if (!project) throw new Error("Project not found");
    const options = {
      title: "Import video clips",
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] }],
    };
    const activeWindow = getMainWindow();
    const result = activeWindow
      ? await dialog.showOpenDialog(activeWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    const assets: Asset[] = [];
    const assetDir = join(projectDir(projectId), "assets");
    for (const filePath of result.filePaths) {
      const assetId = id("asset");
      const target = join(assetDir, `${assetId}${extname(filePath) || ".mp4"}`);
      copyFileSync(filePath, target);
      execSql(`
        INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
        VALUES (
          ${sql(assetId)}, ${sql(projectId)}, 'video', 'imported', ${sql(filePath)}, ${sql(target)},
          ${sql(JSON.stringify({ filename: basename(filePath) }))}, ${sql(now())}
        );
      `);
      const row = querySql<AssetRow>(`SELECT * FROM assets WHERE id = ${sql(assetId)};`)[0];
      assets.push(mapAsset(row));
    }
    execSql(`UPDATE projects SET updated_at = ${sql(now())} WHERE id = ${sql(projectId)};`);
    return assets;
  });

  ipcMain.handle("assets:list", async (_event, projectId: string) => listAssets(projectId));

  ipcMain.handle("assets:remove", async (_event, assetId: string) => {
    const row = querySql<AssetRow>(`SELECT * FROM assets WHERE id = ${sql(assetId)} LIMIT 1;`)[0];
    if (row?.local_path && existsSync(row.local_path)) rmSync(row.local_path, { force: true });
    execSql(`DELETE FROM assets WHERE id = ${sql(assetId)};`);
    return true;
  });

  ipcMain.handle("jobs:createGeneration", async (_event, projectId: string, request: GenerationRequest) => {
    const jobId = id("job");
    const createdAt = now();
    execSql(`
      INSERT INTO generation_jobs (
        id, project_id, status, progress, current_step, request_json, result_json, error, created_at, started_at, completed_at
      ) VALUES (
        ${sql(jobId)}, ${sql(projectId)}, 'queued', 0, 'Queued for provider-aware render',
        ${sql(JSON.stringify({ ...request, kind: request.kind ?? "short" }))}, NULL, NULL, ${sql(createdAt)}, NULL, NULL
      );
      UPDATE projects SET status = 'processing', script = ${sql(request.script)}, settings_json = ${sql(JSON.stringify({
        aspectRatio: request.aspectRatio,
        keywords: request.keywords,
        mediaMode: request.mediaMode,
        voiceName: request.voiceName,
        voiceSpeed: request.voiceSpeed,
        captionsEnabled: request.subtitleSettings.enabled,
        captionSize: request.subtitleSettings.fontSize,
        subtitlePosition: request.subtitleSettings.position,
        subtitleAnimation: request.subtitleSettings.animation,
        subtitleStyleName: request.subtitleSettings.styleName,
      }))}, updated_at = ${sql(now())}
      WHERE id = ${sql(projectId)};
    `);
    const job = getJob(jobId);
    if (!job) throw new Error("Failed to create job");
    void runGeneration(jobId);
    return job;
  });

  ipcMain.handle("jobs:get", async (_event, jobId: string) => getJob(jobId));

  ipcMain.handle("jobs:list", async (_event, projectId?: string) => {
    const where = projectId ? `WHERE project_id = ${sql(projectId)}` : "";
    return querySql<JobRow>(`SELECT * FROM generation_jobs ${where} ORDER BY created_at DESC LIMIT 80;`).map(mapJob);
  });

  ipcMain.handle("jobs:logs", async (_event, jobId: string) => {
    return querySql<{
      id: string;
      job_id: string;
      level: JobLog["level"];
      message: string;
      metadata_json: string;
      created_at: string;
    }>(`SELECT * FROM job_logs WHERE job_id = ${sql(jobId)} ORDER BY created_at ASC;`).map((row) => ({
      id: row.id,
      jobId: row.job_id,
      level: row.level,
      message: row.message,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
    }));
  });

  ipcMain.handle("jobs:cancel", async (_event, jobId: string) => {
    cancelStoryProcess(jobId);
    updateJob(jobId, { status: "cancelled", progress: 100, currentStep: "Cancelled", completedAt: now() });
    notifyJob(jobId);
    return true;
  });

  ipcMain.handle("script:generate", async (_event, input: { providerId: string; topic: string; lengthHint?: string }) => {
    return generateScript(input);
  });

  ipcMain.handle("stock:search", async (_event, input: { providerId: "pexels" | "pixabay"; query: string; perPage?: number }) => {
    return searchStockVideos(input.providerId, input.query, input.perPage);
  });

  ipcMain.handle("stock:download", async (_event, input: { projectId: string; video: Parameters<typeof downloadStockAsset>[1]; keyword?: string }) => {
    return downloadStockAsset(input.projectId, input.video, input.keyword);
  });

  ipcMain.handle("exports:choosePath", async (_event, defaultName: string) => {
    const options = {
      title: "Export video",
      defaultPath: defaultName.endsWith(".mp4") ? defaultName : `${defaultName}.mp4`,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    };
    const activeWindow = getMainWindow();
    const result = activeWindow
      ? await dialog.showSaveDialog(activeWindow, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle("exports:saveAs", async (_event, input: { jobId: string; defaultName: string }) => {
    const job = getJob(input.jobId);
    if (!job?.result?.outputPath) throw new Error("No rendered output is available for this job.");
    const options = {
      title: "Save rendered video",
      defaultPath: input.defaultName.endsWith(".mp4") ? input.defaultName : `${input.defaultName}.mp4`,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    };
    const activeWindow = getMainWindow();
    const result = activeWindow
      ? await dialog.showSaveDialog(activeWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    copyFileSync(job.result.outputPath, result.filePath);
    execSql(`
      INSERT INTO exports (id, project_id, job_id, output_path, format, created_at)
      VALUES (${sql(id("export"))}, ${sql(job.projectId)}, ${sql(job.id)}, ${sql(result.filePath)}, 'mp4', ${sql(now())});
    `);
    return { outputPath: result.filePath };
  });

  ipcMain.handle("exports:revealInFinder", async (_event, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle("system:checkDependencies", async () => {
    const [sqlite, ffmpeg, ffmpegFilters, piper, whisper, ollama] = await Promise.all([
      checkBinary("sqlite3", ["--version"]),
      checkBinary(ffmpegBinary(), ["-version"]),
      checkFfmpegSubtitleFilters(),
      checkBinary("piper", ["--version"]),
      checkBinary("whisper", ["--help"]),
      checkBinary("ollama", ["--version"]),
    ]);
    return [
      { ...sqlite, id: "sqlite3", name: "SQLite" },
      { ...ffmpeg, id: "ffmpeg", name: "FFmpeg" },
      ffmpegFilters,
      { ...piper, id: "piper", name: "Piper TTS", installUrl: "https://github.com/rhasspy/piper" },
      { ...whisper, id: "whisper", name: "Whisper", installUrl: "https://github.com/openai/whisper" },
      { ...ollama, id: "ollama", name: "Ollama", installUrl: "https://ollama.com" },
    ] satisfies DependencyStatus[];
  });

  ipcMain.handle("system:getAppInfo", async () => ({
    appDataPath: dirname(getDbPath()),
    platform: process.platform,
    pathEntries: runtimePath().split(process.platform === "win32" ? ";" : ":"),
  }));
}

async function checkFfmpegSubtitleFilters(): Promise<DependencyStatus> {
  try {
    const { stdout } = await execFileAsync(ffmpegBinary(), ["-hide_banner", "-filters"], { timeout: 3000, env: runtimeEnv() });
    const ok = /\bass\b/.test(stdout) || /\bsubtitles\b/.test(stdout);
    return {
      id: "ffmpeg-libass",
      name: "FFmpeg subtitles",
      status: ok ? "ok" : "missing",
      message: ok ? "ASS/subtitles filter available." : "FFmpeg was found, but the ASS/subtitles filter is unavailable.",
      installUrl: "https://ffmpeg.org/download.html",
    };
  } catch (error) {
    return {
      id: "ffmpeg-libass",
      name: "FFmpeg subtitles",
      status: "missing",
      message: error instanceof Error ? error.message : "Could not inspect FFmpeg filters.",
      installUrl: "https://ffmpeg.org/download.html",
    };
  }
}
