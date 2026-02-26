import express from "express";
import { Readable, Transform as NodeTransform } from "node:stream";
import { DeepSeekWebClient } from "./client";
import { loadCredentials } from "./auth";
import {
  createStreamConverter,
  collectFullResponse,
} from "./stream-converter";

export interface ServerLog {
  time: string;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
}

export type LogCallback = (log: ServerLog) => void;

const sessionCache = new Map<string, string>();
let logCallback: LogCallback | null = null;
let requestCount = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

function emitLog(level: ServerLog["level"], msg: string) {
  const log: ServerLog = {
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    level,
    msg,
  };
  logCallback?.(log);
  const prefix =
    level === "ok" ? "✅" : level === "warn" ? "⚠️" : level === "err" ? "❌" : "ℹ️";
  console.log(`[${log.time}] ${prefix} ${msg}`);
}

function getClient() {
  const creds = loadCredentials();
  if (!creds) throw new Error("未找到凭证，请先捕获登录凭证");
  return new DeepSeekWebClient(creds);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // 模型列表
  app.get("/v1/models", (_req, res) => {
    emitLog("ok", "GET /v1/models → 200");
    res.json({
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model", owned_by: "deepseek-web" },
        {
          id: "deepseek-reasoner",
          object: "model",
          owned_by: "deepseek-web",
        },
        {
          id: "deepseek-chat-search",
          object: "model",
          owned_by: "deepseek-web",
        },
        {
          id: "deepseek-reasoner-search",
          object: "model",
          owned_by: "deepseek-web",
        },
      ],
    });
  });

  // 聊天补全
  app.post("/v1/chat/completions", async (req, res) => {
    try {
      const {
        model = "deepseek-chat",
        messages = [],
        stream = false,
      } = req.body;
      const client = getClient();

      emitLog(
        "info",
        `POST /v1/chat/completions → model=${model}, stream=${stream}`,
      );

      // 获取或创建会话
      const sessionKey =
        (req.headers["x-session-id"] as string) || "default";
      let sessionId = sessionCache.get(sessionKey);
      if (!sessionId) {
        sessionId = await client.createSession();
        sessionCache.set(sessionKey, sessionId);
        emitLog("info", `  ├─ 创建会话: ${sessionId.slice(0, 10)}...`);
      } else {
        emitLog("info", `  ├─ 复用会话: ${sessionId.slice(0, 10)}...`);
      }

      // 将 OpenAI messages 拼接为 prompt
      const prompt = messages
        .map((m: any) => {
          const role =
            m.role === "system"
              ? "System"
              : m.role === "user"
                ? "User"
                : "Assistant";
          const content =
            typeof m.content === "string"
              ? m.content
              : (m.content || [])
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("");
          return `${role}: ${content}`;
        })
        .join("\n\n");

      // 解析模型名：支持 -search 后缀
      const searchEnabled = model.endsWith("-search");
      const baseModel = searchEnabled
        ? model.replace(/-search$/, "")
        : model;

      // 估算输入 token
      const inputTokens = Math.ceil(prompt.length / 1.5);
      totalInputTokens += inputTokens;

      const startTime = Date.now();
      const responseStream = await client.chat({
        sessionId,
        message: prompt,
        model: baseModel,
        thinkingEnabled: baseModel.includes("reasoner"),
        searchEnabled,
      });

      if (!responseStream) {
        emitLog("err", "  └─ DeepSeek 返回空响应");
        return res
          .status(500)
          .json({ error: { message: "DeepSeek 返回空响应" } });
      }

      requestCount++;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const { transform } = createStreamConverter(model);
        const nodeStream = Readable.fromWeb(responseStream as any);

        // 调试：记录原始 SSE 数据的前几条
        let debugLines = 0;
        const debugTransform = new NodeTransform({
          transform(chunk, _enc, cb) {
            if (debugLines < 3) {
              const text = chunk.toString().slice(0, 200);
              emitLog("info", `  ├─ RAW: ${text.replace(/\n/g, "\\n")}`);
              debugLines++;
            }
            this.push(chunk);
            cb();
          },
        });

        let outputChars = 0;
        transform.on("data", (chunk: Buffer) => {
          outputChars += chunk.length;
        });

        transform.on("end", () => {
          const outputTokens = Math.ceil(outputChars / 2);
          totalOutputTokens += outputTokens;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          emitLog(
            "ok",
            `  └─ 完成: ~${outputTokens} token, ${elapsed}s`,
          );
        });

        nodeStream.pipe(debugTransform).pipe(transform).pipe(res);
        req.on("close", () => nodeStream.destroy());
      } else {
        const result = await collectFullResponse(responseStream, model);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        emitLog("ok", `  └─ 完成 (非流式): ${elapsed}s`);
        res.json(result);
      }
    } catch (err: any) {
      emitLog("err", `请求处理失败: ${err.message}`);
      res.status(500).json({
        error: { message: err.message, type: "server_error" },
      });
    }
  });

  // 健康检查
  app.get("/health", (_req, res) => {
    const creds = loadCredentials();
    emitLog("ok", `GET /health → ${creds ? "凭证有效" : "无凭证"}`);
    res.json({
      status: creds ? "ok" : "no_credentials",
      capturedAt: creds?.capturedAt,
    });
  });

  return app;
}

export function getStats() {
  return {
    requestCount,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

export function startServer(
  port = 3000,
  onLog?: LogCallback,
): ReturnType<ReturnType<typeof createApp>["listen"]> {
  if (onLog) logCallback = onLog;
  const app = createApp();
  return app.listen(port, "127.0.0.1", () => {
    emitLog("info", `FreeSeek 反代服务已启动: http://127.0.0.1:${port}`);
  });
}
