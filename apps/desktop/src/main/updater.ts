import { app } from "electron";
import { autoUpdater } from "electron-updater";

export function initAutoUpdate(): void {
  if (process.env.AIVS_ENABLE_AUTO_UPDATE !== "1") return;
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.logger = console;
  autoUpdater.checkForUpdates().catch((error) => {
    console.warn("Auto-update check failed:", error);
  });
}
