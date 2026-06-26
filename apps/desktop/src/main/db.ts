import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  Asset,
  GenerationJob,
  JobRequest,
  JobLog,
  Project,
  ProviderConfig,
  ProviderPrivacy,
  ProviderStatus,
} from "../shared/types";
import { getDbPath, localFileUrl, runtimeEnv } from "./paths";

let dbMutex = Promise.resolve();

export function now(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function sql(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function withDbMutex<T>(work: () => Promise<T>): Promise<T> {
  const previous = dbMutex;
  let release!: () => void;
  dbMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function withSqliteTimeout(script: string): string {
  return `.timeout 4000\n${script}`;
}

export function execSql(script: string): void {
  execFileSync("sqlite3", [getDbPath()], {
    input: withSqliteTimeout(script),
    env: runtimeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function querySql<T>(script: string): T[] {
  const output = execFileSync("sqlite3", ["-json", getDbPath()], {
    input: withSqliteTimeout(script),
    encoding: "utf8",
    env: runtimeEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}

export function ensureColumn(table: string, column: string, ddl: string): void {
  const columns = querySql<{ name: string }>(`PRAGMA table_info(${table});`);
  if (columns.some((entry) => entry.name === column)) return;
  execSql(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
}

export function initDatabase(): void {
  execSql(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      privacy TEXT NOT NULL,
      base_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disabled',
      has_secret INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      script TEXT NOT NULL DEFAULT '',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      original_path TEXT,
      local_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS job_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      output_path TEXT NOT NULL,
      format TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_secrets (
      provider_id TEXT PRIMARY KEY,
      secret_value TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_scenes (
      project_id TEXT NOT NULL,
      scene_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      narration_text TEXT NOT NULL DEFAULT '',
      image_prompt TEXT NOT NULL DEFAULT '',
      negative_prompt TEXT NOT NULL DEFAULT '',
      characters_json TEXT NOT NULL DEFAULT '[]',
      continuity_notes TEXT NOT NULL DEFAULT '',
      estimated_duration_seconds REAL,
      image_asset_id TEXT,
      image_status TEXT NOT NULL DEFAULT 'pending',
      image_error TEXT,
      audio_asset_id TEXT,
      audio_status TEXT NOT NULL DEFAULT 'pending',
      audio_start_seconds REAL,
      audio_duration_seconds REAL,
      audio_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, scene_id)
    );
    CREATE TABLE IF NOT EXISTS story_stages (
      project_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      detail TEXT,
      output_json TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, stage)
    );
  `);
  ensureColumn("projects", "mode", "mode TEXT NOT NULL DEFAULT 'short'");

  const defaults: Array<Pick<ProviderConfig, "id" | "kind" | "name" | "privacy" | "enabled" | "status" | "baseUrl" | "hasSecret" | "config">> = [
    { id: "local-media", kind: "media", name: "Local Media Folder", privacy: "local", enabled: true, status: "connected", config: {} },
    { id: "ffmpeg", kind: "render", name: "FFmpeg Renderer", privacy: "local", enabled: true, status: "connected", config: {} },
    { id: "piper", kind: "tts", name: "Piper", privacy: "local", enabled: false, status: "missing", config: {} },
    { id: "whisper", kind: "transcription", name: "Whisper / faster-whisper", privacy: "local", enabled: false, status: "missing", config: {} },
    { id: "ollama", kind: "script_llm", name: "Ollama", privacy: "local", enabled: false, status: "missing", baseUrl: "http://localhost:11434", config: {} },
    { id: "lm-studio", kind: "script_llm", name: "LM Studio", privacy: "local", enabled: false, status: "missing", baseUrl: "http://localhost:1234/v1", config: {} },
    { id: "openai", kind: "tts", name: "OpenAI", privacy: "api", enabled: false, status: "disabled", hasSecret: false, config: {} },
    { id: "openai-tts", kind: "tts", name: "OpenAI TTS", privacy: "api", enabled: false, status: "disabled", hasSecret: false, baseUrl: "https://api.openai.com/v1", config: {} },
    { id: "openai-chat", kind: "script_llm", name: "OpenAI Chat", privacy: "api", enabled: false, status: "disabled", hasSecret: false, baseUrl: "https://api.openai.com/v1", config: {} },
    { id: "google", kind: "media", name: "Google Gemini Image", privacy: "api", enabled: false, status: "disabled", hasSecret: false, config: { imageBackend: "gemini", imageModel: "gemini-2.5-flash-image" } },
    { id: "flux2", kind: "media", name: "FLUX.2 / mflux", privacy: "local", enabled: false, status: "missing", config: {} },
    { id: "cosyvoice", kind: "tts", name: "CosyVoice", privacy: "local", enabled: false, status: "missing", config: {} },
    { id: "pexels", kind: "media", name: "Pexels", privacy: "api", enabled: false, status: "disabled", hasSecret: false, config: {} },
    { id: "pixabay", kind: "media", name: "Pixabay", privacy: "api", enabled: false, status: "disabled", hasSecret: false, config: {} },
  ];
  for (const provider of defaults) {
    execSql(`
      INSERT OR IGNORE INTO providers (
        id, kind, name, privacy, base_url, enabled, status, has_secret, config_json, created_at, updated_at
      ) VALUES (
        ${sql(provider.id)}, ${sql(provider.kind)}, ${sql(provider.name)}, ${sql(provider.privacy)},
        ${sql(provider.baseUrl ?? null)}, ${sql(provider.enabled)}, ${sql(provider.status)},
        ${sql(Boolean(provider.hasSecret))}, ${sql(JSON.stringify(provider.config))}, ${sql(now())}, ${sql(now())}
      );
    `);
  }

  migrateLegacyOpenAiProviders();

  execSql(`
    UPDATE providers
    SET enabled = 1, updated_at = ${sql(now())}
    WHERE privacy = 'api'
      AND status = 'connected'
      AND enabled = 0
      AND (
        has_secret = 1
        OR EXISTS(SELECT 1 FROM provider_secrets WHERE provider_id = providers.id)
      );
  `);

  execSql(`
    UPDATE generation_jobs
    SET status = 'failed', error = 'App closed before this job completed.', completed_at = ${sql(now())}
    WHERE status NOT IN ('completed', 'failed', 'cancelled');
  `);
}

export function shouldApplyLegacyOpenAiProviderState(row: Pick<ProviderRow, "enabled" | "has_secret" | "status">, hadOwnSecretBeforeMigration: boolean): boolean {
  return !hadOwnSecretBeforeMigration && !Boolean(row.enabled) && !Boolean(row.has_secret) && row.status === "disabled";
}

function providerSecretExists(providerId: string): boolean {
  return Boolean(querySql<{ found: number }>(`SELECT 1 AS found FROM provider_secrets WHERE provider_id = ${sql(providerId)} LIMIT 1;`)[0]);
}

function migrateLegacyOpenAiProviders(): void {
  const legacy = querySql<ProviderRow>("SELECT * FROM providers WHERE id = 'openai' LIMIT 1;")[0];
  if (!legacy) return;

  const splitIds = ["openai-tts", "openai-chat"];
  const hadOwnSecret = Object.fromEntries(splitIds.map((providerId) => [providerId, providerSecretExists(providerId)]));

  execSql(`
    INSERT OR IGNORE INTO provider_secrets (provider_id, secret_value, encrypted, updated_at)
    SELECT 'openai-tts', secret_value, encrypted, updated_at FROM provider_secrets WHERE provider_id = 'openai';
    INSERT OR IGNORE INTO provider_secrets (provider_id, secret_value, encrypted, updated_at)
    SELECT 'openai-chat', secret_value, encrypted, updated_at FROM provider_secrets WHERE provider_id = 'openai';
  `);

  for (const providerId of splitIds) {
    const provider = querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(providerId)} LIMIT 1;`)[0];
    if (!provider) continue;

    const applyLegacyState = shouldApplyLegacyOpenAiProviderState(provider, Boolean(hadOwnSecret[providerId]));
    const hasMigratedSecret = providerSecretExists(providerId) || providerSecretExists("openai");
    execSql(`
      UPDATE providers
      SET
        enabled = ${sql(applyLegacyState ? Boolean(legacy.enabled) : Boolean(provider.enabled))},
        has_secret = ${sql(hasMigratedSecret || Boolean(provider.has_secret))},
        config_json = ${sql(applyLegacyState ? (legacy.config_json || provider.config_json) : provider.config_json)},
        base_url = ${sql(applyLegacyState ? (legacy.base_url ?? provider.base_url) : provider.base_url)},
        updated_at = ${sql(now())}
      WHERE id = ${sql(providerId)};
    `);
  }
}

export interface ProjectRow {
  id: string;
  name: string;
  mode?: string;
  status: string;
  script: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    mode: (row.mode ?? "short") as Project["mode"],
    status: row.status as Project["status"],
    script: row.script,
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AssetRow {
  id: string;
  project_id: string;
  kind: Asset["kind"];
  source: Asset["source"];
  original_path: string | null;
  local_path: string;
  metadata_json: string;
  created_at: string;
}

export function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    source: row.source,
    originalPath: row.original_path,
    localPath: row.local_path,
    fileUrl: localFileUrl(row.local_path),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

export interface JobRow {
  id: string;
  project_id: string;
  status: GenerationJob["status"];
  progress: number;
  current_step: string | null;
  request_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function mapJob(row: JobRow): GenerationJob {
  const result = parseJson<GenerationJob["result"]>(row.result_json, null);
  if (result?.outputPath) result.outputUrl = localFileUrl(result.outputPath);
  if (result?.audioPath) result.audioUrl = localFileUrl(result.audioPath);
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    progress: row.progress,
    currentStep: row.current_step,
    request: parseJson(row.request_json, {} as JobRequest),
    result,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export interface ProviderRow {
  id: string;
  kind: ProviderConfig["kind"];
  name: string;
  privacy: ProviderPrivacy;
  base_url: string | null;
  enabled: 0 | 1;
  status: ProviderStatus;
  has_secret: 0 | 1;
  config_json: string;
  updated_at: string;
}

export function mapProvider(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    privacy: row.privacy,
    enabled: Boolean(row.enabled),
    baseUrl: row.base_url ?? undefined,
    hasSecret: Boolean(row.has_secret),
    status: row.status,
    config: parseJson(row.config_json, {}),
    updatedAt: row.updated_at,
  };
}

export function getProvider(providerId: string): ProviderRow | null {
  return querySql<ProviderRow>(`SELECT * FROM providers WHERE id = ${sql(providerId)} LIMIT 1;`)[0] ?? null;
}

export function getProject(projectId: string): Project | null {
  const rows = querySql<ProjectRow>(`SELECT * FROM projects WHERE id = ${sql(projectId)} LIMIT 1;`);
  return rows[0] ? mapProject(rows[0]) : null;
}

export function listAssets(projectId: string): Asset[] {
  return querySql<AssetRow>(`
    SELECT * FROM assets WHERE project_id = ${sql(projectId)} ORDER BY created_at DESC;
  `).map(mapAsset);
}

export function getJob(jobId: string): GenerationJob | null {
  const rows = querySql<JobRow>(`SELECT * FROM generation_jobs WHERE id = ${sql(jobId)} LIMIT 1;`);
  return rows[0] ? mapJob(rows[0]) : null;
}

export function logJob(jobId: string, level: JobLog["level"], message: string, metadata: Record<string, unknown> = {}): void {
  execSql(`
    INSERT INTO job_logs (id, job_id, level, message, metadata_json, created_at)
    VALUES (${sql(id("log"))}, ${sql(jobId)}, ${sql(level)}, ${sql(message)}, ${sql(JSON.stringify(metadata))}, ${sql(now())});
  `);
}

export function updateJob(
  jobId: string,
  values: Partial<Pick<GenerationJob, "status" | "progress" | "currentStep" | "error">> & {
    result?: GenerationJob["result"];
    startedAt?: string;
    completedAt?: string;
  },
): void {
  const job = getJob(jobId);
  if (!job) return;
  execSql(`
    UPDATE generation_jobs
    SET
      status = ${sql(values.status ?? job.status)},
      progress = ${sql(values.progress ?? job.progress)},
      current_step = ${sql(values.currentStep ?? job.currentStep)},
      result_json = ${sql(values.result === undefined ? JSON.stringify(job.result) : JSON.stringify(values.result))},
      error = ${sql(values.error ?? job.error)},
      started_at = ${sql(values.startedAt ?? job.startedAt)},
      completed_at = ${sql(values.completedAt ?? job.completedAt)}
    WHERE id = ${sql(jobId)};
  `);
}
