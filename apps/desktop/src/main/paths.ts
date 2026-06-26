import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";

export const appName = "AI Video Studio";

let dbPath = "";
let projectsDir = "";
let logsDir = "";
let runtimePathCache: string | null = null;

export function localFileUrl(filePath: string): string {
  return `studio-file://local${pathToFileURL(filePath).pathname}`;
}

export function runtimePath(): string {
  if (runtimePathCache) return runtimePathCache;
  const home = app.getPath("home");
  const shellPath =
    process.platform === "win32"
      ? ""
      : (() => {
          try {
            return execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", 'printf "%s" "$PATH"'], {
              encoding: "utf8",
              timeout: 2000,
              env: process.env,
            });
          } catch {
            return "";
          }
        })();
  const pythonBins = ["3.13", "3.12", "3.11", "3.10"].map((version) => join(home, "Library", "Python", version, "bin"));
  const entries = [
    process.env.PATH || "",
    shellPath,
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    join(home, ".local", "bin"),
    ...pythonBins,
  ]
    .join(process.platform === "win32" ? ";" : ":")
    .split(process.platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);
  runtimePathCache = Array.from(new Set(entries)).join(process.platform === "win32" ? ";" : ":");
  return runtimePathCache;
}

export function resetRuntimePathCache(): void {
  runtimePathCache = null;
}

export function runtimeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: runtimePath() };
}

export function initPaths(): void {
  app.setName(appName);
  const dataPath = app.getPath("userData");
  dbPath = join(dataPath, "studio.db");
  projectsDir = join(dataPath, "projects");
  logsDir = join(dataPath, "logs");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
}

export function getDbPath(): string {
  return dbPath;
}

export function getProjectsDir(): string {
  return projectsDir;
}

export function getLogsDir(): string {
  return logsDir;
}

export function projectDir(projectId: string): string {
  const dir = join(projectsDir, projectId);
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "renders"), { recursive: true });
  mkdirSync(join(dir, "audio"), { recursive: true });
  mkdirSync(join(dir, "captions"), { recursive: true });
  return dir;
}
