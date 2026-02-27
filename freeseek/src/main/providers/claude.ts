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
import { ClaudeWebClient, type ClaudeCredentials } from "../claude-client";
import {
  loadClaudeCredentials,
  clearClaudeCredentials,
  captureClaudeCredentials,
} from "../claude-auth";
import {
  createClaudeStreamConverter,
  collectClaudeFullResponse,
} from "../claude-stream";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "claude-auth.json");

/** Claude 模型别名映射 */
const MODEL_ALIASES: Record<string, string> = {
  "claude-3-5-sonnet": "claude-sonnet-4-6",
  "claude-3-opus": "claude-opus-4-6",
  "claude-3-haiku": "claude-haiku-4-6",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus": "claude-opus-4-6",
  "claude-haiku": "claude-haiku-4-6",
};

export class ClaudeProvider implements Provider {
  readonly id = "claude";
  readonly name = "Claude";

  private client: ClaudeWebClient | null = null;
  private sessionCache = new Map<string, string>();

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "claude-sonnet-4-6", owned_by: "claude-web" },
      { id: "claude-opus-4-6", owned_by: "claude-web" },
      { id: "claude-haiku-4-6", owned_by: "claude-web" },
      { id: "claude-3-5-sonnet", owned_by: "claude-web", aliasOf: "claude-sonnet-4-6" },
      { id: "claude-3-opus", owned_by: "claude-web", aliasOf: "claude-opus-4-6" },
      { id: "claude-3-haiku", owned_by: "claude-web", aliasOf: "claude-haiku-4-6" },
    ];
  }

  matchModel(model: string): boolean {
    return model.startsWith("claude-");
  }

  mapModel(model: string): string {
    return MODEL_ALIASES[model] || model;
  }

  // --- 凭证 ---

  loadCredentials(): ClaudeCredentials | null {
    return loadClaudeCredentials();
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = loadClaudeCredentials();
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasSessionKey: !!creds.sessionKey,
      sessionKeyPrefix: creds.sessionKey?.slice(0, 20) + "...",
      hasCookie: !!creds.cookie,
      hasOrganizationId: !!creds.organizationId,
    };
  }

  clearCredentials(): boolean {
    this.resetClient();
    return clearClaudeCredentials();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const authDir = path.dirname(AUTH_FILE);
    fs.mkdirSync(authDir, { recursive: true });
    const creds = {
      sessionKey: data.sessionKey.trim(),
      cookie:
        data.cookie?.trim() || `sessionKey=${data.sessionKey.trim()}`,
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
    this.resetClient();
  }

  async captureCredentials(
    onStatus?: (msg: string) => void,
  ): Promise<BaseCredentials> {
    const creds = await captureClaudeCredentials(onStatus);
    this.resetClient();
    return creds;
  }

  // --- 客户端 ---

  private async getClient(): Promise<ClaudeWebClient> {
    if (this.client) return this.client;
    const creds = loadClaudeCredentials();
    if (!creds) throw new Error("未找到 Claude 凭证，请先捕获 Claude 登录凭证");
    this.client = new ClaudeWebClient(creds);
    await this.client.init();
    return this.client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const client = await this.getClient();
    const mappedModel = this.mapModel(request.model);
    const prompt = this.buildPrompt(request.messages);

    // 获取或创建会话
    const sessionKey = request.sessionKey || "claude-default";
    let conversationId = this.sessionCache.get(sessionKey);

    if (!conversationId) {
      conversationId = await client.createConversation();
      this.sessionCache.set(sessionKey, conversationId);
    }

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        conversationId,
        message: prompt,
        model: mappedModel,
      });
    } catch (chatErr: any) {
      // 会话失效，重试
      if (
        chatErr.message?.includes("403") ||
        chatErr.message?.includes("401") ||
        chatErr.message?.includes("410") ||
        chatErr.message?.includes("认证")
      ) {
        this.sessionCache.delete(sessionKey);
        const newConvId = await client.createConversation();
        this.sessionCache.set(sessionKey, newConvId);
        responseStream = await client.chat({
          conversationId: newConvId,
          message: prompt,
          model: mappedModel,
        });
      } else {
        throw chatErr;
      }
    }

    return { stream: responseStream };
  }

  resetClient(): void {
    if (this.client) {
      this.client.close().catch(() => {});
    }
    this.client = null;
    this.sessionCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const { transform } = createClaudeStreamConverter({
      model: this.mapModel(options.model),
    });
    return { transform };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
  ): Promise<object> {
    return collectClaudeFullResponse(stream, this.mapModel(model));
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
