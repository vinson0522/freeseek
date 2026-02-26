import crypto from "node:crypto";
import { solveDeepSeekHashV1 } from "./pow-wasm";

interface PowChallenge {
  algorithm: string;
  challenge: string;
  difficulty: number;
  salt: string;
  signature: string;
  expire_at?: number;
}

interface ChatParams {
  sessionId: string;
  parentMessageId?: string | number | null;
  message: string;
  model?: string;
  thinkingEnabled?: boolean;
  searchEnabled?: boolean;
  fileIds?: string[];
  signal?: AbortSignal;
}

export class DeepSeekWebClient {
  private cookie: string;
  private bearer: string;
  private userAgent: string;

  constructor(creds: { cookie: string; bearer: string; userAgent: string }) {
    this.cookie = creds.cookie;
    this.bearer = creds.bearer;
    this.userAgent =
      creds.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }

  private headers(): Record<string, string> {
    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: "*/*",
      ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
      Referer: "https://chat.deepseek.com/",
      Origin: "https://chat.deepseek.com",
      "x-client-platform": "web",
      "x-client-version": "1.7.0",
      "x-app-version": "20241129.1",
      "x-client-locale": "zh_CN",
      "x-client-timezone-offset": "28800",
    };
  }

  // ========== PoW 求解 ==========

  private async fetchPowChallenge(targetPath: string): Promise<PowChallenge> {
    const res = await fetch(
      "https://chat.deepseek.com/api/v0/chat/create_pow_challenge",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ target_path: targetPath }),
      },
    );
    if (!res.ok) throw new Error(`PoW challenge 请求失败: ${res.status}`);

    const data = (await res.json()) as any;
    console.log("[PoW] challenge 原始响应:", JSON.stringify(data).slice(0, 500));
    const challenge =
      data.data?.biz_data?.challenge ||
      data.data?.challenge ||
      data.challenge;
    if (!challenge) throw new Error("PoW challenge 响应中缺少 challenge 字段");

    // challenge 可能是嵌套对象或直接就是 biz_data
    const result = typeof challenge === "object" && challenge.algorithm
      ? challenge
      : data.data?.biz_data || data.data || data;
    console.log("[PoW] 解析后 challenge:", JSON.stringify(result).slice(0, 300));
    return result;
  }

  private solvePowSha256(challenge: PowChallenge): number {
    const { challenge: target, salt, difficulty } = challenge;
    const targetDifficulty =
      difficulty > 1000 ? Math.floor(Math.log2(difficulty)) : difficulty;
    let nonce = 0;

    while (nonce < 1_000_000) {
      const input = salt + target + nonce;
      const hash = crypto.createHash("sha256").update(input).digest("hex");

      let zeroBits = 0;
      for (const char of hash) {
        const val = parseInt(char, 16);
        if (val === 0) {
          zeroBits += 4;
        } else {
          zeroBits += Math.clz32(val) - 28;
          break;
        }
      }

      if (zeroBits >= targetDifficulty) return nonce;
      nonce++;
    }
    throw new Error("SHA256 PoW 求解超时");
  }

  private async solvePow(targetPath: string): Promise<string> {
    const challenge = await this.fetchPowChallenge(targetPath);

    let answer: number;
    if (challenge.algorithm === "sha256") {
      answer = this.solvePowSha256(challenge);
    } else if (challenge.algorithm === "DeepSeekHashV1") {
      answer = await solveDeepSeekHashV1(
        challenge.challenge,
        challenge.salt,
        challenge.expire_at ?? 0,
        challenge.difficulty,
      );
    } else {
      throw new Error(`未知 PoW 算法: ${challenge.algorithm}`);
    }

    return Buffer.from(
      JSON.stringify({
        ...challenge,
        answer,
        target_path: targetPath,
      }),
    ).toString("base64");
  }

  // ========== 会话管理 ==========

  async createSession(): Promise<string> {
    const res = await fetch(
      "https://chat.deepseek.com/api/v0/chat_session/create",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) throw new Error(`创建会话失败: ${res.status}`);

    const data = (await res.json()) as any;
    const sessionId =
      data.data?.biz_data?.id ||
      data.data?.biz_data?.chat_session_id ||
      "";
    if (!sessionId) throw new Error("创建会话返回空 ID");
    return sessionId;
  }

  // ========== 聊天请求 ==========

  async chat(
    params: ChatParams,
  ): Promise<ReadableStream<Uint8Array> | null> {
    const targetPath = "/api/v0/chat/completion";
    const powResponse = await this.solvePow(targetPath);

    const res = await fetch(
      `https://chat.deepseek.com${targetPath}`,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "x-ds-pow-response": powResponse,
        },
        body: JSON.stringify({
          chat_session_id: params.sessionId,
          parent_message_id: params.parentMessageId ?? null,
          prompt: params.message,
          ref_file_ids: params.fileIds || [],
          thinking_enabled:
            params.thinkingEnabled ??
            !(params.model === "deepseek-chat" && !params.model?.includes("reasoning")),
          search_enabled: params.searchEnabled ?? true,
          preempt: false,
        }),
        signal: params.signal,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`聊天请求失败: ${res.status} ${text}`);
    }

    return res.body;
  }
}
