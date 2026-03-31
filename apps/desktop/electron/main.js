const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const { detectGtaPath, installModZip, removeInstalledMod } = require("./install-manager");

const store = new Store({
  defaults: {
    token: "",
    user: null,
    serverBaseUrl: "http://localhost:8787",
    gtaPath: ""
  }
});

let mainWindow;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0a0a12",
    title: "HARDY",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
}

function handleDeepLink(url) {
  if (!url || !url.startsWith("hardy://auth-success")) return;
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get("token");
    if (token) {
      store.set("token", token);
      send("auth-token", { token });
    }
  } catch (error) {
    log.error("Deep link error", error);
  }
}

function setupProtocol() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient("hardy", process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient("hardy");
  }

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find(arg => arg.startsWith("hardy://"));
    if (deepLink) handleDeepLink(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function setupUpdates() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => send("update-status", { type: "checking" }));
  autoUpdater.on("update-available", info => send("update-status", { type: "available", info }));
  autoUpdater.on("update-not-available", info => send("update-status", { type: "not-available", info }));
  autoUpdater.on("download-progress", progress => send("update-status", { type: "downloading", progress }));
  autoUpdater.on("update-downloaded", () => send("update-status", { type: "downloaded" }));
  autoUpdater.on("error", error => send("update-status", { type: "error", message: String(error) }));
}

app.whenReady().then(() => {
  setupProtocol();
  createWindow();
  setupUpdates();

  const deepLinkArg = process.argv.find(arg => arg.startsWith("hardy://"));
  if (deepLinkArg) handleDeepLink(deepLinkArg);
});

ipcMain.handle("auth:get-state", async () => ({
  token: store.get("token"),
  user: store.get("user"),
  serverBaseUrl: store.get("serverBaseUrl"),
  gtaPath: store.get("gtaPath")
}));

ipcMain.handle("auth:set-user", async (_evt, payload) => {
  store.set("user", payload.user);
  if (payload.token) store.set("token", payload.token);
  return { ok: true };
});

ipcMain.handle("auth:logout", async () => {
  store.set("token", "");
  store.set("user", null);
  return { ok: true };
});

ipcMain.handle("app:get-server-url", async () => store.get("serverBaseUrl"));
ipcMain.handle("app:set-server-url", async (_evt, url) => {
  store.set("serverBaseUrl", url);
  return { ok: true };
});
ipcMain.handle("app:open-external", async (_evt, url) => shell.openExternal(url));

ipcMain.handle("gta:detect-path", async () => {
  const detected = detectGtaPath();
  if (detected) store.set("gtaPath", detected);
  return { path: detected || "" };
});

ipcMain.handle("gta:choose-path", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { path: "" };
  store.set("gtaPath", result.filePaths[0]);
  return { path: result.filePaths[0] };
});

ipcMain.handle("mods:install", async (_evt, payload) => {
  const gtaPath = payload.gtaPath || store.get("gtaPath");
  if (!gtaPath) throw new Error("GTA V path is not set");

  send("install-status", { type: "start", modId: payload.mod.id });
  try {
    const result = await installModZip({
      mod: payload.mod,
      gtaPath,
      onProgress: (stage, extra = {}) => send("install-status", { type: "progress", stage, ...extra })
    });
    return result;
  } catch (error) {
    send("install-status", { type: "error", message: String(error) });
    throw error;
  }
});

ipcMain.handle("mods:remove", async (_evt, payload) => {
  const gtaPath = payload.gtaPath || store.get("gtaPath");
  if (!gtaPath) throw new Error("GTA V path is not set");
  return await removeInstalledMod({ modId: payload.modId, gtaPath });
});

ipcMain.handle("updates:check", async () => autoUpdater.checkForUpdates());
ipcMain.handle("updates:download", async () => autoUpdater.downloadUpdate());
ipcMain.handle("updates:install", async () => {
  autoUpdater.quitAndInstall();
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
