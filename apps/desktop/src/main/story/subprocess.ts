import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { StoryConfig } from "../../shared/types";
import { projectDir, runtimeEnv } from "../paths";
import { writeStoryConfigFiles } from "./config";
import { writeScenesJson } from "./scenes";

export const activeStoryProcs = new Map<string, ChildProcess>();

export function cancelStoryProcess(jobId: string): void {
  const child = activeStoryProcs.get(jobId);
  if (!child) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 2500).unref();
}

export function resolvePythonScript(scriptName: string): string {
  const cwd = process.cwd();
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, "python", scriptName) : "",
    join(app.getAppPath(), "resources", "python", scriptName),
    join(cwd, "resources", "python", scriptName),
    join(cwd, "apps", "desktop", "resources", "python", scriptName),
    join(cwd, "..", "story-video-pipeline", "scripts", scriptName),
    join(cwd, "..", "..", "story-video-pipeline", "scripts", scriptName),
    join(cwd, "..", "..", "..", "story-video-pipeline", "scripts", scriptName),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Bundled Python script not found: ${scriptName}`);
  return found;
}

export async function spawnPythonStage({
  jobId,
  projectId,
  scriptName,
  args,
  config,
  env,
  command,
  commandArgs,
  onLine,
}: {
  jobId: string;
  projectId: string;
  scriptName: string;
  args: string[];
  config?: StoryConfig;
  env?: NodeJS.ProcessEnv;
  command?: string;
  commandArgs?: string[];
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}): Promise<void> {
  if (config) writeStoryConfigFiles(projectId, config);
  writeScenesJson(projectId);

  const scriptPath = resolvePythonScript(scriptName);
  const python = process.platform === "win32" ? "python" : "python3";
  const executable = command ?? python;
  const spawnArgs = commandArgs ? [...commandArgs, scriptPath, ...args] : [scriptPath, ...args];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, spawnArgs, {
      cwd: projectDir(projectId),
      env: { ...runtimeEnv(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeStoryProcs.set(jobId, child);

    const consume = (stream: "stdout" | "stderr") => {
      let buffer = "";
      const source = stream === "stdout" ? child.stdout : child.stderr;
      source.setEncoding("utf8");
      source.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) onLine?.(line, stream);
        }
      });
      source.on("end", () => {
        if (buffer.trim()) onLine?.(buffer, stream);
      });
    };

    consume("stdout");
    consume("stderr");

    child.on("error", (error) => {
      activeStoryProcs.delete(jobId);
      reject(error);
    });
    child.on("close", (code, signal) => {
      activeStoryProcs.delete(jobId);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptName} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`));
    });
  });
}
