import crypto from "node:crypto";

/**
 * 通义千问 Web API 客户端
 *
 * 使用 Cookie 复用模式，直接通过抓包获取的 cookie/headers 发请求。
 * 千问网页版 SSE 格式：
 * - choices[0].delta.phase: "thinking_summary" | "answer"
 * - choices[0].delta.content: 正文增量
 * - choices[0].delta.extra.summary_thought.content: 思考链内容
 * - choices[0].delta.status: "typing" | "finished"
 */

export interface QwenCredentials {
  cookie: string;
  token?: string;
  bxUa?: string;
  bxUmidtoken?: string;
  userAgent: string;
  capturedAt: string;
}

export class QwenWebClient {
  private cookie: string;
  private token: string;
  private bxUa: string;
  private bxUmidtoken: string;
  private userAgent: string;

  constructor(creds: QwenCredentials) {
    this.cookie = creds.cookie;
    this.token = creds.token || this.extractTokenFromCookie(creds.cookie);
    this.bxUa = creds.bxUa || "";
    this.bxUmidtoken = creds.bxUmidtoken || "";
    this.userAgent =
      creds.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
  }

  private extractTokenFromCookie(cookie: string): string {
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    return match ? match[1] : "";
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      Origin: "https://chat.qwen.ai",
      Referer: "https://chat.qwen.ai/",
      source: "web",
      "x-request-id": crypto.randomUUID(),
    };
    // bx-ua 和 bx-umidtoken 是阿里风控必需的签名，缺少会导致 Bad_Request
    if (this.bxUa) headers["bx-ua"] = this.bxUa;
    if (this.bxUmidtoken) headers["bx-umidtoken"] = this.bxUmidtoken;
    return headers;
  }

  /** 发送聊天请求，返回 SSE 流 */
  async chat(params: {
    message: string;
    model?: string;
    chatId?: string;
    thinkingEnabled?: boolean;
    searchEnabled?: boolean;
    signal?: AbortSignal;
  }): Promise<ReadableStream<Uint8Array> | null> {
    const chatId = params.chatId || crypto.randomUUID();
    const model = params.model || "qwen3.5-plus";
    const thinkingEnabled = params.thinkingEnabled ?? true;
    const searchEnabled = params.searchEnabled ?? true;
    const fid = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    const requestBody = {
      stream: true,
      version: "2.1",
      incremental_output: true,
      chat_id: chatId,
      chat_mode: "normal",
      model,
      parent_id: null,
      messages: [
        {
          fid,
          parentId: null,
          childrenIds: [crypto.randomUUID()],
          role: "user",
          content: params.message,
          user_action: "chat",
          files: [],
          timestamp,
          models: [model],
          chat_type: "t2t",
          feature_config: {
            thinking_enabled: thinkingEnabled,
            output_schema: "phase",
            research_mode: "normal",
            auto_thinking: thinkingEnabled,
            thinking_format: "summary",
            auto_search: searchEnabled,
          },
          extra: { meta: { subChatType: "t2t" } },
          sub_chat_type: "t2t",
          parent_id: null,
        },
      ],
      timestamp: timestamp + 1,
    };

    const url = `https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`;

    console.log(`[Qwen] 发送请求 (model: ${model}, chatId: ${chatId})`);
    if (!this.bxUa) {
      console.warn("[Qwen] ⚠️ 缺少 bx-ua 风控签名，请求可能被拒绝。请重新捕获凭证并在浏览器中发一条消息。");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
      signal: params.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Qwen] 请求失败: ${res.status}`, errorText.slice(0, 200));
      throw new Error(`Qwen 请求失败: ${res.status} ${errorText.slice(0, 200)}`);
    }

    // 千问可能返回 200 但 body 是错误 JSON（success: false）
    // 需要 peek 第一个 chunk 判断
    const contentType = res.headers.get("content-type") || "";
    const reader = res.body!.getReader();
    const { value: firstValue, done: firstDone } = await reader.read();

    if (firstDone || !firstValue) {
      throw new Error("Qwen 返回空响应");
    }

    const firstChunk = new TextDecoder().decode(firstValue);

    // 检查是否是错误 JSON（不以 "data:" 开头）
    if (firstChunk.trimStart().startsWith("{")) {
      try {
        const errData = JSON.parse(firstChunk);
        if (errData.success === false) {
          const code = errData.data?.code || "unknown";
          const details = errData.data?.details || errData.data?.message || "未知错误";
          console.error(`[Qwen] API 业务错误: ${code} - ${details}`);
          throw new Error(`Qwen API 错误: ${code} - ${details}`);
        }
      } catch (e: any) {
        if (e.message?.startsWith("Qwen API")) throw e;
        // JSON 解析失败，可能不是完整 JSON，继续当 SSE 处理
      }
    }

    // 把已读的 chunk 和剩余流拼回去
    const combined = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(firstValue);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }
      }
    });
    return combined;
  }
}
