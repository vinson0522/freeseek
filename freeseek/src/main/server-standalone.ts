/**
 * FreeSeek 独立 Web 模式入口
 * 不依赖 Electron，纯 Node.js 运行
 * 用法: node dist/main/server-standalone.js [--port 3000] [--admin-port 3001]
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { getStats, resetSessions, startServer, type ServerLog } from "./server";
import { registry } from "./providers";

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}

const API_PORT = parseInt(getArg("--port", "3000"), 10);
const ADMIN_PORT = parseInt(getArg("--admin-port", "3001"), 10);
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// 日志收集
const recentLogs: ServerLog[] = [];
function onLog(log: ServerLog) {
  recentLogs.push(log);
  if (recentLogs.length > 500) recentLogs.splice(0, recentLogs.length - 300);
  const prefix = log.level === "ok" ? "✅" : log.level === "warn" ? "⚠️" : log.level === "err" ? "❌" : "ℹ️";
  console.log(`[${log.time}] ${prefix} ${log.msg}`);
}

// ========== 启动 API 代理服务 ==========
const apiServer = startServer(API_PORT, onLog);
const startedAt = Date.now();

// ========== 管理面板 HTTP API ==========
const admin = express();
admin.use(express.json());

// CORS
admin.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// 托管前端静态文件
const rendererDir = path.join(__dirname, "..", "renderer");
if (fs.existsSync(rendererDir)) {
  admin.use(express.static(rendererDir));
}

// --- 服务状态 ---
admin.get("/api/server/status", (_req, res) => {
  const deepseek = registry.get("deepseek");
  const creds = deepseek?.loadCredentials();
  res.json({
    running: true,
    port: API_PORT,
    hasCredentials: !!creds,
    capturedAt: creds?.capturedAt ?? null,
    uptime: Date.now() - startedAt,
  });
});

admin.get("/api/server/stats", (_req, res) => {
  res.json(getStats());
});

admin.post("/api/server/resetSessions", (_req, res) => {
  resetSessions();
  res.json({ ok: true });
});

// --- 通用 Provider API ---
// 获取所有 Provider 状态
admin.get("/api/providers", (_req, res) => {
  const providers = registry.all().map((p) => ({
    id: p.id,
    name: p.name,
    hasCredentials: !!p.loadCredentials(),
    models: p.getModels(),
  }));
  res.json(providers);
});

// --- DeepSeek 凭证（保持向后兼容） ---
admin.get("/api/auth/get", (_req, res) => {
  const provider = registry.get("deepseek");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/auth/clear", (_req, res) => {
  const provider = registry.get("deepseek");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/auth/checkExpiry", (_req, res) => {
  const provider = registry.get("deepseek");
  if (!provider?.checkExpiry) return res.json({ valid: false, reason: "no_credentials" });
  res.json(provider.checkExpiry());
});

admin.post("/api/auth/saveManual", (req, res) => {
  try {
    const provider = registry.get("deepseek");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/auth/start", async (_req, res) => {
  try {
    const provider = registry.get("deepseek");
    if (!provider) return res.json({ ok: false, error: "DeepSeek provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- Claude 凭证（保持向后兼容） ---
admin.get("/api/claude/get", (_req, res) => {
  const provider = registry.get("claude");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/claude/clear", (_req, res) => {
  const provider = registry.get("claude");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/claude/saveManual", (req, res) => {
  try {
    const provider = registry.get("claude");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/claude/start", async (_req, res) => {
  try {
    const provider = registry.get("claude");
    if (!provider) return res.json({ ok: false, error: "Claude provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Claude Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 通义千问凭证 ---
admin.get("/api/qwen/get", (_req, res) => {
  const provider = registry.get("qwen");
  const summary = provider?.getCredentialsSummary();
  res.json(summary || null);
});

admin.post("/api/qwen/clear", (_req, res) => {
  const provider = registry.get("qwen");
  res.json({ ok: provider?.clearCredentials() ?? false });
});

admin.post("/api/qwen/checkExpiry", (_req, res) => {
  const provider = registry.get("qwen");
  if (!provider?.checkExpiry) return res.json({ valid: false, reason: "no_credentials" });
  res.json(provider.checkExpiry());
});

admin.post("/api/qwen/saveManual", (req, res) => {
  try {
    const provider = registry.get("qwen");
    provider?.saveManualCredentials(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

admin.post("/api/qwen/start", async (_req, res) => {
  try {
    const provider = registry.get("qwen");
    if (!provider) return res.json({ ok: false, error: "Qwen provider not found" });
    const creds = await provider.captureCredentials((msg) => {
      console.log(`[Qwen Auth] ${msg}`);
    });
    res.json({ ok: true, capturedAt: creds.capturedAt });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 代理配置 ---
admin.get("/api/proxy/get", (_req, res) => {
  try {
    const f = path.join(DATA_DIR, "proxy.json");
    if (fs.existsSync(f)) return res.json(JSON.parse(fs.readFileSync(f, "utf-8")));
  } catch { /* ignore */ }
  res.json({ proxy: "" });
});

admin.post("/api/proxy/save", (req, res) => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "proxy.json"), JSON.stringify({ proxy: (req.body.proxy || "").trim() }, null, 2));
    res.json({ ok: true });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// --- 日志 ---
admin.get("/api/logs", (_req, res) => {
  res.json(recentLogs.slice(-200));
});

// SPA fallback
admin.get("*", (_req, res) => {
  const indexPath = path.join(rendererDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("管理界面未构建，请先运行 npm run build:renderer");
  }
});

admin.listen(ADMIN_PORT, "0.0.0.0", () => {
  console.log(`\n========================================`);
  console.log(`  FreeSeek 独立 Web 模式`);
  console.log(`  API 代理:   http://0.0.0.0:${API_PORT}`);
  console.log(`  管理面板:   http://0.0.0.0:${ADMIN_PORT}`);
  console.log(`========================================\n`);
});
