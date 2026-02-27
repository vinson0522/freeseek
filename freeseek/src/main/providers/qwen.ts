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
import { QwenWebClient, type QwenCredentials } from "../qwen-client";
import {
  loadQwenCredentials,
  clearQwenCredentials,
  captureQwenCredentials,
} from "../qwen-auth";
import {
  createQwenStreamConverter,
  collectQwenFullResponse,
} from "../qwen-stream";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "qwen-auth.json");

/** 千问模型前缀列表 */
const QWEN_PREFIXES = ["qwen", "qwq"];

export class QwenProvider implements Provider {
  readonly id = "qwen";
  readonly name = "通义千问";

  private chatIdCache = new Map<string, string>();

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "qwen3.5-plus", owned_by: "qwen-web" },
      { id: "qwen-max", owned_by: "qwen-web" },
      { id: "qwen-plus", owned_by: "qwen-web" },
      { id: "qwen-turbo", owned_by: "qwen-web" },
      { id: "qwq-plus", owned_by: "qwen-web" },
    ];
  }

  matchModel(model: string): boolean {
    return QWEN_PREFIXES.some((p) => model.startsWith(p));
  }

  mapModel(model: string): string {
    return model;
  }

  // --- 凭证 ---

  loadCredentials(): QwenCredentials | null {
    return loadQwenCredentials();
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = loadQwenCredentials();
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasCookie: !!creds.cookie,
      cookieCount: creds.cookie.split(";").length,
      hasToken: !!creds.token,
      tokenPrefix: creds.token ? creds.token.slice(0, 20) + "..." : "",
      hasBxUa: !!creds.bxUa,
      hasBxUmidtoken: !!creds.bxUmidtoken,
    };
  }

  clearCredentials(): boolean {
    this.resetClient();
    return clearQwenCredentials();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const authDir = path.dirname(AUTH_FILE);
    fs.mkdirSync(authDir, { recursive: true });
    const creds: QwenCredentials = {
      cookie: data.cookie?.trim() || "",
      token: data.token?.trim() || "",
      bxUa: data.bxUa?.trim() || "",
      bxUmidtoken: data.bxUmidtoken?.trim() || "",
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
    this.resetClient();
  }

  async captureCredentials(
    onStatus?: (msg: string) => void,
  ): Promise<BaseCredentials> {
    const creds = await captureQwenCredentials(onStatus);
    this.resetClient();
    return creds;
  }

  checkExpiry(): {
    valid: boolean;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
    remainingMs?: number;
  } {
    const creds = loadQwenCredentials();
    if (!creds?.token) return { valid: false };
    // 千问 token 是 JWT，尝试解析 exp
    try {
      const parts = creds.token.split(".");
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

  private getClient(): QwenWebClient {
    const creds = loadQwenCredentials();
    if (!creds) throw new Error("未找到通义千问凭证，请先捕获登录凭证");
    return new QwenWebClient(creds);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = this.getClient();
    const prompt = this.buildPrompt(request.messages);
    const model = this.mapModel(request.model);

    // 千问每次请求用新的 chatId
    const chatId = crypto.randomUUID();

    const isThinkingModel =
      model.includes("qwq") ||
      model.includes("qwen3.5") ||
      model.includes("qwen-max");

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        message: prompt,
        model,
        chatId,
        thinkingEnabled: isThinkingModel,
        searchEnabled: true,
      });
    } catch (chatErr: any) {
      // 401/403 时重试一次
      if (chatErr.message?.includes("401") || chatErr.message?.includes("403")) {
        responseStream = await client.chat({
          message: prompt,
          model,
          chatId: crypto.randomUUID(),
          thinkingEnabled: isThinkingModel,
          searchEnabled: true,
        });
      } else {
        throw chatErr;
      }
    }

    return { stream: responseStream };
  }

  resetClient(): void {
    this.chatIdCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const { transform } = createQwenStreamConverter({
      model: options.model,
      stripReasoning: options.stripReasoning,
    });
    return { transform };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
    options?: { stripReasoning?: boolean; cleanMode?: boolean },
  ): Promise<object> {
    return collectQwenFullResponse(stream, model, options);
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
