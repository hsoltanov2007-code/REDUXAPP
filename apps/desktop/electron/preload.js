const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hardy", {
  getAuthState: () => ipcRenderer.invoke("auth:get-state"),
  setUser: payload => ipcRenderer.invoke("auth:set-user", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getServerUrl: () => ipcRenderer.invoke("app:get-server-url"),
  setServerUrl: url => ipcRenderer.invoke("app:set-server-url", url),
  openExternal: url => ipcRenderer.invoke("app:open-external", url),

  detectGtaPath: () => ipcRenderer.invoke("gta:detect-path"),
  chooseGtaPath: () => ipcRenderer.invoke("gta:choose-path"),

  installMod: payload => ipcRenderer.invoke("mods:install", payload),
  removeMod: payload => ipcRenderer.invoke("mods:remove", payload),

  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),

  onAuthToken: callback => ipcRenderer.on("auth-token", (_e, payload) => callback(payload)),
  onInstallStatus: callback => ipcRenderer.on("install-status", (_e, payload) => callback(payload)),
  onUpdateStatus: callback => ipcRenderer.on("update-status", (_e, payload) => callback(payload))
});
