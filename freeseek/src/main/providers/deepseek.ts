import type {
  Provider,
  BaseCredentials,
  CredentialsSummary,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  StreamConverterResult,
  StreamConverterOptions,
} from "./types";
import { DeepSeekWebClient } from "../client";
import {
  loadCredentials,
  clearCredentials,
  captureCredentials,
  type Credentials,
} from "../auth";
import {
  createStreamConverter as createDSStreamConverter,
  collectFullResponse as collectDSFullResponse,
  type StreamConverterOptions as DSStreamOpts,
} from "../stream-converter";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "auth.json");

export class DeepSeekProvider implements Provider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";

  private sessionCache = new Map<string, string>();

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "deepseek-chat", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner", owned_by: "deepseek-web" },
      { id: "deepseek-chat-search", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner-search", owned_by: "deepseek-web" },
    ];
  }

  matchModel(model: string): boolean {
    return model.startsWith("deepseek-");
  }

  mapModel(model: string): string {
    return model;
  }

  // --- 凭证 ---

  loadCredentials(): Credentials | null {
    return loadCredentials();
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = loadCredentials();
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasCookie: !!creds.cookie,
      cookieCount: creds.cookie.split(";").length,
      hasBearer: !!creds.bearer,
      bearerLength: creds.bearer.length,
      hasSessionId:
        creds.cookie.includes("ds_session_id=") ||
        creds.cookie.includes("d_id="),
    };
  }

  clearCredentials(): boolean {
    return clearCredentials();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const authDir = path.dirname(AUTH_FILE);
    fs.mkdirSync(authDir, { recursive: true });
    const creds = {
      cookie: data.cookie,
      bearer: data.bearer,
      userAgent:
        data.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
  }

  async captureCredentials(
    onStatus?: (msg: string) => void,
  ): Promise<BaseCredentials> {
    return captureCredentials(onStatus);
  }

  checkExpiry(): {
    valid: boolean;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
    remainingMs?: number;
  } {
    const creds = loadCredentials();
    if (!creds?.bearer) return { valid: false };
    try {
      const parts = creds.bearer.split(".");
      if (parts.length !== 3) return { valid: true, expiresAt: null };
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString(),
      );
      if (payload.exp) {
        const expiresAt = payload.exp * 1000;
        const remaining = expiresAt - Date.now();
        return {
          valid: remaining > 0,
          expiresAt: new Date(expiresAt).toISOString(),
          remainingMs: remaining,
          expired: remaining <= 0,
          expiringSoon: remaining > 0 && remaining < 30 * 60 * 1000,
        };
      }
      return { valid: true, expiresAt: null };
    } catch {
      return { valid: true, expiresAt: null };
    }
  }

  // --- 客户端 ---

  private getClient(): DeepSeekWebClient {
    const creds = loadCredentials();
    if (!creds) throw new Error("未找到 DeepSeek 凭证，请先捕获登录凭证");
    return new DeepSeekWebClient(creds);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = this.getClient();

    // 将 OpenAI messages 拼接为 prompt
    const prompt = this.buildPrompt(request.messages);

    const searchEnabled = request.model.endsWith("-search");
    const baseModel = searchEnabled
      ? request.model.replace(/-search$/, "")
      : request.model;

    // 获取或创建会话
    const sessionKey = request.sessionKey || "default";
    let sessionId = this.sessionCache.get(sessionKey);

    if (!sessionId) {
      sessionId = await client.createSession();
      this.sessionCache.set(sessionKey, sessionId);
    }

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        sessionId,
        message: prompt,
        model: baseModel,
        thinkingEnabled: baseModel.includes("reasoner"),
        searchEnabled,
      });
    } catch (chatErr: any) {
      // 会话失效，重建
      if (
        chatErr.message?.includes("40") ||
        chatErr.message?.includes("session")
      ) {
        this.sessionCache.delete(sessionKey);
        const newSessionId = await client.createSession();
        this.sessionCache.set(sessionKey, newSessionId);
        responseStream = await client.chat({
          sessionId: newSessionId,
          message: prompt,
          model: baseModel,
          thinkingEnabled: baseModel.includes("reasoner"),
          searchEnabled,
        });
      } else {
        throw chatErr;
      }
    }

    return { stream: responseStream };
  }

  resetClient(): void {
    this.sessionCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const dsOpts: DSStreamOpts = {
      stripReasoning: options.stripReasoning,
      cleanMode: options.cleanMode,
    };
    const { transform, getParentMessageId } = createDSStreamConverter(
      options.model,
      dsOpts,
    );
    return {
      transform,
      getMetadata: () => ({ parentMessageId: getParentMessageId() }),
    };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
    options?: { stripReasoning?: boolean; cleanMode?: boolean },
  ): Promise<object> {
    return collectDSFullResponse(stream, model, options);
  }

  // --- 内部工具 ---

  private buildPrompt(messages: any[]): string {
    const extractContent = (m: any) =>
      typeof m.content === "string"
        ? m.content
        : (m.content || [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("");

    const nonSystemMessages = messages.filter(
      (m: any) => m.role !== "system",
    );
    const systemMessages = messages.filter((m: any) => m.role === "system");

    if (
      nonSystemMessages.length === 1 &&
      nonSystemMessages[0].role === "user"
    ) {
      const userContent = extractContent(nonSystemMessages[0]);
      if (systemMessages.length > 0) {
        const sysContent = systemMessages.map(extractContent).join("\n");
        return `${sysContent}\n\n${userContent}`;
      }
      return userContent;
    }

    const parts: string[] = [];
    for (const m of messages) {
      const content = extractContent(m);
      if (m.role === "system") parts.push(`[System]\n${content}`);
      else if (m.role === "user") parts.push(`[User]\n${content}`);
      else parts.push(`[Assistant]\n${content}`);
    }
    return parts.join("\n\n");
  }
}
