import { app } from "electron";
import { initDatabase } from "./db";
import { registerIpc } from "./ipc";
import { appName, initPaths } from "./paths";
import { initAutoUpdate } from "./updater";
import { createWindow, hasOpenWindows, registerLocalFileProtocol } from "./window";

app.whenReady().then(() => {
  app.setName(appName);
  initPaths();
  initDatabase();
  registerIpc();
  registerLocalFileProtocol();
  createWindow();
  initAutoUpdate();

  app.on("activate", () => {
    if (!hasOpenWindows()) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
