import { join } from "node:path";
import { app, BrowserWindow, net, protocol } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { appName } from "./paths";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio-file",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

let mainWindow: BrowserWindowType | null = null;

export function getMainWindow(): BrowserWindowType | null {
  return mainWindow;
}

export function registerLocalFileProtocol(): void {
  protocol.handle("studio-file", (request) => {
    const parsed = new URL(request.url);
    const fileUrl = parsed.hostname === "local"
      ? `file://${parsed.pathname}`
      : `file:///${parsed.hostname}${parsed.pathname}`;
    return net.fetch(fileUrl);
  });
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: appName,
    backgroundColor: "#10131a",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`);
  });

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`Renderer: ${message}`);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

export function hasOpenWindows(): boolean {
  return BrowserWindow.getAllWindows().length > 0;
}

export { app };
