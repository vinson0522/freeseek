import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import {
  captureCredentials,
  loadCredentials,
  clearCredentials,
} from "./auth";
import { startServer, getStats, type ServerLog } from "./server";

let mainWindow: BrowserWindow | null = null;
let serverInstance: ReturnType<typeof startServer> | null = null;
let serverPort = 3000;
let serverRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "FreeSeek",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载 renderer HTML
  const htmlPath = path.join(__dirname, "..", "renderer", "index.html");
  mainWindow.loadFile(htmlPath);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendLog(log: ServerLog) {
  mainWindow?.webContents.send("log", log);
}

// ========== IPC Handlers ==========

// 服务控制
ipcMain.handle("server:start", async (_event, port: number) => {
  if (serverRunning) return { ok: true, port: serverPort };
  try {
    serverPort = port || 3000;
    serverInstance = startServer(serverPort, sendLog);
    serverRunning = true;
    return { ok: true, port: serverPort };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("server:stop", async () => {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
    serverRunning = false;
  }
  return { ok: true };
});

ipcMain.handle("server:status", async () => {
  const creds = loadCredentials();
  return {
    running: serverRunning,
    port: serverPort,
    hasCredentials: !!creds,
    capturedAt: creds?.capturedAt ?? null,
  };
});

ipcMain.handle("server:stats", async () => {
  return getStats();
});

// 凭证管理
ipcMain.handle("auth:start", async () => {
  try {
    const creds = await captureCredentials((msg) => {
      mainWindow?.webContents.send("auth:status", msg);
    });
    return { ok: true, capturedAt: creds.capturedAt };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("auth:get", async () => {
  const creds = loadCredentials();
  if (!creds) return null;
  return {
    hasCookie: !!creds.cookie,
    cookieCount: creds.cookie.split(";").length,
    hasBearer: !!creds.bearer,
    bearerLength: creds.bearer.length,
    capturedAt: creds.capturedAt,
    hasSessionId:
      creds.cookie.includes("ds_session_id=") ||
      creds.cookie.includes("d_id="),
  };
});

ipcMain.handle("auth:clear", async () => {
  return { ok: clearCredentials() };
});

ipcMain.handle(
  "auth:saveManual",
  async (
    _event,
    data: { cookie: string; bearer: string; userAgent: string },
  ) => {
    try {
      const authDir = path.join(__dirname, "..", "..", "data");
      fs.mkdirSync(authDir, { recursive: true });
      const creds = {
        ...data,
        userAgent:
          data.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        capturedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(authDir, "auth.json"),
        JSON.stringify(creds, null, 2),
      );
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
);

// ========== App Lifecycle ==========

app.whenReady().then(() => {
  createWindow();

  // 自动启动服务（如果有凭证）
  const creds = loadCredentials();
  if (creds) {
    serverInstance = startServer(serverPort, sendLog);
    serverRunning = true;
  }
});

app.on("window-all-closed", () => {
  if (serverInstance) {
    serverInstance.close();
  }
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
