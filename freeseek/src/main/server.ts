import express from "express";
import { Readable, Transform as NodeTransform } from "node:stream";
import { registry } from "./providers";

export interface ServerLog {
  time: string;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
}

export type LogCallback = (log: ServerLog) => void;

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
    const models = registry.getAllModels().map((m) => ({
      id: m.id,
      object: "model",
      owned_by: m.owned_by,
    }));
    res.json({ object: "list", data: models });
  });

  // 聊天补全
  app.post("/v1/chat/completions", async (req, res) => {
    try {
      const {
        model = "deepseek-chat",
        messages = [],
        stream = false,
        strip_reasoning = false,
        clean_mode = false,
      } = req.body;

      // 通过 registry 查找对应的 Provider
      const provider = registry.resolve(model);
      if (!provider) {
        emitLog("err", `未知模型: ${model}`);
        return res.status(400).json({
          error: { message: `不支持的模型: ${model}`, type: "invalid_request_error" },
        });
      }

      const mappedModel = provider.mapModel(model);
      const stripReasoning =
        strip_reasoning || req.headers["x-strip-reasoning"] === "true";
      const cleanMode =
        clean_mode || req.headers["x-clean-mode"] === "true";

      emitLog(
        "info",
        `POST /v1/chat/completions → [${provider.name}] model=${model}${model !== mappedModel ? `→${mappedModel}` : ""}, stream=${stream}${stripReasoning ? ", strip_reasoning" : ""}${cleanMode ? ", clean_mode" : ""}`,
      );

      const sessionKey =
        (req.headers["x-session-id"] as string) || undefined;

      const startTime = Date.now();

      // 调用 Provider 的 chat 方法
      const { stream: responseStream } = await provider.chat({
        model,
        messages,
        stream,
        strip_reasoning: stripReasoning,
        clean_mode: cleanMode,
        sessionKey,
      });

      if (!responseStream) {
        emitLog("err", `  └─ [${provider.name}] 返回空响应`);
        return res
          .status(500)
          .json({ error: { message: `${provider.name} 返回空响应` } });
      }

      requestCount++;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const { transform } = provider.createStreamConverter({
          model,
          stripReasoning,
          cleanMode,
        });

        const nodeStream = Readable.fromWeb(responseStream as any);

        let outputChars = 0;
        transform.on("data", (chunk: Buffer) => {
          outputChars += chunk.length;
        });

        transform.on("error", (err: Error) => {
          emitLog("err", `  └─ [${provider.name}] 流转换错误: ${err.message}`);
        });

        nodeStream.on("error", (err: Error) => {
          emitLog("err", `  └─ [${provider.name}] 源流错误: ${err.message}`);
        });

        transform.on("end", () => {
          const outputTokens = Math.ceil(outputChars / 2);
          totalOutputTokens += outputTokens;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          emitLog(
            "ok",
            `  └─ [${provider.name}] 完成: ~${outputTokens} token, ${elapsed}s`,
          );
        });

        nodeStream.pipe(transform).pipe(res);
        req.on("close", () => nodeStream.destroy());
      } else {
        const result = await provider.collectFullResponse(
          responseStream,
          model,
          { stripReasoning, cleanMode },
        );
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        emitLog(
          "ok",
          `  └─ [${provider.name}] 完成 (非流式): ${elapsed}s`,
        );
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
    const providers = registry.all();
    const status: Record<string, any> = {};
    let anyCredentials = false;

    for (const p of providers) {
      const creds = p.loadCredentials();
      status[p.id] = {
        hasCredentials: !!creds,
        capturedAt: creds?.capturedAt ?? null,
      };
      if (creds) anyCredentials = true;
    }

    emitLog(
      "ok",
      `GET /health → ${providers.map((p) => `${p.name}:${p.loadCredentials() ? "有效" : "无"}`).join(" ")}`,
    );

    res.json({
      status: anyCredentials ? "ok" : "no_credentials",
      providers: status,
    });
  });

  return app;
}

// ========== 兼容旧接口 ==========

/** @deprecated 使用 registry.get("claude")?.resetClient() */
export function resetClaudeClient() {
  registry.get("claude")?.resetClient();
}

export function getStats() {
  return {
    requestCount,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

export function resetSessions() {
  registry.resetAll();
}

export function startServer(
  port = 3000,
  onLog?: LogCallback,
): ReturnType<ReturnType<typeof createApp>["listen"]> {
  if (onLog) logCallback = onLog;
  const app = createApp();
  return app.listen(port, "127.0.0.1", () => {
    emitLog("info", `FreeSeek 反代服务已启动: http://127.0.0.1:${port}`);
    emitLog(
      "info",
      `已注册 Provider: ${registry.all().map((p) => p.name).join(", ")}`,
    );
  });
}
