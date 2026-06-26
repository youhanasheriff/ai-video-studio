import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeStorage } from "electron";
import type { DependencyStatus } from "../shared/types";
import { type ProviderRow, execSql, now, parseJson, querySql, sql } from "./db";
import { runtimeEnv } from "./paths";

const execFileAsync = promisify(execFile);
// Each provider owns its key. The legacy "openai" id is a read-only fallback so a
// pre-split install keeps working, but openai-tts and openai-chat never read each
// other's key — they can point at different OpenAI-compatible vendors (Groq, DeepSeek…).
function secretLookupIds(providerId: string): string[] {
  if (providerId === "openai-tts" || providerId === "openai-chat") return [providerId, "openai"];
  return [providerId];
}

export async function checkBinary(command: string, versionArgs: string[] = ["--version"]): Promise<DependencyStatus> {
  try {
    const { stdout } = await execFileAsync(command, versionArgs, { timeout: 3000, env: runtimeEnv() });
    return {
      id: command,
      name: command,
      status: "ok",
      version: stdout.split("\n")[0]?.slice(0, 140),
    };
  } catch {
    return {
      id: command,
      name: command,
      status: "missing",
      message: `${command} was not found on PATH.`,
    };
  }
}

export function providerBinary(provider: ProviderRow, fallback: string): string {
  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const binaryPath = typeof config.binaryPath === "string" ? config.binaryPath.trim() : "";
  return binaryPath || fallback;
}

export function hasSecret(providerId: string): boolean {
  const ids = secretLookupIds(providerId);
  const rows = querySql<{ provider_id: string }>(`SELECT provider_id FROM provider_secrets WHERE provider_id IN (${ids.map(sql).join(", ")}) LIMIT 1;`);
  return Boolean(rows[0]);
}

export function readProviderSecret(providerId: string): string | null {
  const ids = secretLookupIds(providerId);
  const row = querySql<{ secret_value: string; encrypted: 0 | 1 }>(
    `SELECT secret_value, encrypted FROM provider_secrets WHERE provider_id IN (${ids.map(sql).join(", ")}) ORDER BY CASE provider_id ${ids.map((entry, index) => `WHEN ${sql(entry)} THEN ${index}`).join(" ")} ELSE 99 END LIMIT 1;`,
  )[0];
  if (!row) return null;
  try {
    const value = Buffer.from(row.secret_value, "base64");
    if (row.encrypted) return safeStorage.decryptString(value);
    return value.toString("utf8");
  } catch {
    return null;
  }
}

export function saveProviderSecret(providerId: string, secret: string): void {
  // Per-provider key. Do NOT fan out across the OpenAI family — openai-tts and
  // openai-chat may point at different vendors (OpenAI, Groq, DeepSeek…).
  if (!secret.trim()) {
    execSql(`DELETE FROM provider_secrets WHERE provider_id = ${sql(providerId)};`);
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  const value = encrypted
    ? safeStorage.encryptString(secret).toString("base64")
    : Buffer.from(secret, "utf8").toString("base64");
  execSql(`
    INSERT INTO provider_secrets (provider_id, secret_value, encrypted, updated_at)
    VALUES (${sql(providerId)}, ${sql(value)}, ${sql(encrypted)}, ${sql(now())})
    ON CONFLICT(provider_id) DO UPDATE SET
      secret_value = excluded.secret_value,
      encrypted = excluded.encrypted,
      updated_at = excluded.updated_at;
  `);
}

export interface InstallPlan {
  command?: string;
  guideUrl: string;
  label: string;
}

export function installPlan(targetId: string): InstallPlan {
  const platform = process.platform;
  const isMac = platform === "darwin";
  const isWin = platform === "win32";
  const isLinux = platform === "linux";
  const fallback: InstallPlan = { guideUrl: "https://aivideostudio.local/setup", label: "Open setup guide" };

  if (targetId === "ffmpeg") {
    return {
      label: "Install FFmpeg",
      guideUrl: "https://ffmpeg.org/download.html",
      command: isMac
        ? "brew install ffmpeg"
        : isWin
          ? "winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements"
          : isLinux
            ? "command -v apt-get >/dev/null && sudo apt-get update && sudo apt-get install -y ffmpeg"
            : undefined,
    };
  }
  if (targetId === "sqlite3") {
    return {
      label: "Install SQLite",
      guideUrl: "https://www.sqlite.org/download.html",
      command: isMac
        ? "brew install sqlite"
        : isWin
          ? "winget install SQLite.SQLite --accept-package-agreements --accept-source-agreements"
          : isLinux
            ? "command -v apt-get >/dev/null && sudo apt-get update && sudo apt-get install -y sqlite3"
            : undefined,
    };
  }
  if (targetId === "ollama") {
    return {
      label: "Install Ollama",
      guideUrl: "https://ollama.com/download",
      command: isMac
        ? "brew install ollama"
        : isWin
          ? "winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements"
          : isLinux
            ? "curl -fsSL https://ollama.com/install.sh | sh"
            : undefined,
    };
  }
  if (targetId === "whisper") {
    return {
      label: "Install Whisper",
      guideUrl: "https://github.com/openai/whisper",
      command: "python3 -m pip install --user -U openai-whisper",
    };
  }
  if (targetId === "piper") {
    return {
      label: "Install Piper",
      guideUrl: "https://github.com/rhasspy/piper",
      command: "python3 -m pip install --user -U piper-tts",
    };
  }
  if (targetId === "flux2") {
    return {
      label: "Install mflux",
      guideUrl: "https://github.com/filipstrand/mflux",
      command: "uv tool install --upgrade mflux --with hf_transfer",
    };
  }
  if (targetId === "cosyvoice") return { label: "Open CosyVoice setup", guideUrl: "https://github.com/FunAudioLLM/CosyVoice" };
  if (targetId === "lm-studio") return { label: "Open LM Studio", guideUrl: "https://lmstudio.ai" };
  if (["openai", "openai-tts", "openai-chat"].includes(targetId)) return { label: "Open OpenAI keys", guideUrl: "https://platform.openai.com/api-keys" };
  if (targetId === "google") return { label: "Open Google AI Studio keys", guideUrl: "https://aistudio.google.com/app/apikey" };
  if (targetId === "pexels") return { label: "Open Pexels keys", guideUrl: "https://www.pexels.com/api/" };
  if (targetId === "pixabay") return { label: "Open Pixabay keys", guideUrl: "https://pixabay.com/api/docs/" };
  return fallback;
}

export function normalizeOpenAiVoice(voiceName: string): string {
  const supported = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
  if (supported.has(voiceName)) return voiceName;
  const legacyMap: Record<string, string> = {
    nova: "coral",
    fable: "verse",
    onyx: "cedar",
  };
  return legacyMap[voiceName] ?? "alloy";
}

export function resolveOpenAiCompatibleTtsVoice(voiceName: string, options: { baseUrl?: string | null; modelName?: string | null } = {}): string {
  const normalized = voiceName.trim().toLowerCase();
  if (isOrpheusTts(options)) {
    const orpheusVoices = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
    if (orpheusVoices.has(normalized)) return normalized;
    const fallbackMap: Record<string, string> = {
      alloy: "daniel",
      ash: "austin",
      ballad: "troy",
      coral: "hannah",
      echo: "daniel",
      sage: "autumn",
      shimmer: "diana",
      verse: "troy",
      marin: "diana",
      cedar: "austin",
      nova: "hannah",
      fable: "troy",
      onyx: "daniel",
    };
    return fallbackMap[normalized] ?? "daniel";
  }
  return normalizeOpenAiVoice(normalized);
}

export function resolveOpenAiCompatibleTtsFormat(options: { baseUrl?: string | null; modelName?: string | null } = {}): "mp3" | "wav" {
  return isOrpheusTts(options) ? "wav" : "mp3";
}

export function resolveOpenAiCompatibleTtsInputLimit(options: { baseUrl?: string | null; modelName?: string | null } = {}): number {
  return isOrpheusTts(options) ? 200 : 4096;
}

function isOrpheusTts({ baseUrl, modelName }: { baseUrl?: string | null; modelName?: string | null }): boolean {
  return String(baseUrl ?? "").toLowerCase().includes("groq.com") || String(modelName ?? "").toLowerCase().includes("orpheus");
}
