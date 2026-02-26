# DeepSeek 网页版反向代理工具 — 从原理分析到独立实现

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [原项目（OpenClaw Zero Token）实现原理深度分析](#2-原项目实现原理深度分析)
3. [独立反代工具架构设计](#3-独立反代工具架构设计)
4. [分步实现指南](#4-分步实现指南)
5. [关键代码实现](#5-关键代码实现)
6. [部署与使用](#6-部署与使用)
7. [常见问题与注意事项](#7-常见问题与注意事项)

---

## 1. 项目背景与目标

### 1.1 我们要做什么

构建一个独立的 DeepSeek 网页版反向代理工具，核心功能：

- 通过浏览器自动化捕获 DeepSeek 网页版的登录凭证（Cookie + Bearer Token）
- 本地启动一个兼容 OpenAI API 格式的 HTTP 服务
- 将 `/v1/chat/completions` 请求转发到 DeepSeek 网页版内部 API
- 支持 SSE 流式响应
- 为本地 AI 应用（如 Cursor、Continue、Open WebUI 等）提供免费的 DeepSeek 模型接入

### 1.2 与原项目的区别

| 维度 | OpenClaw Zero Token | 我们的反代工具 |
|------|---------------------|---------------|
| 定位 | 完整 AI Agent 平台 | 轻量反代工具 |
| 依赖 | pi-agent-core 等大量依赖 | 仅 Playwright + Express |
| 复杂度 | 数百个文件 | 约 5-6 个核心文件 |
| 功能 | Agent、TUI、Web UI、多平台 | 仅 DeepSeek 反代 + OpenAI 兼容 API |

---

## 2. 原项目实现原理深度分析

### 2.1 整体架构

原项目的 DeepSeek 零 Token 实现涉及以下核心模块：

```
src/providers/deepseek-web-auth.ts    → 浏览器自动化登录 + 凭证捕获
src/providers/deepseek-web-client.ts  → DeepSeek 网页 API 客户端（含 PoW 求解）
src/agents/deepseek-web-stream.ts     → SSE 流式响应解析器
src/browser/chrome.ts                 → Chrome 启动与管理
src/gateway/openai-http.ts            → OpenAI 兼容 HTTP 网关
```

### 2.2 凭证捕获流程（deepseek-web-auth.ts）

这是整个方案的核心入口。原项目的实现流程：

```
┌─────────────────────────────────────────────────────────────────┐
│                    凭证捕获流程                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 1: 启动 Chrome（带 CDP 远程调试端口）                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ launchOpenClawChrome()                                    │   │
│  │   → spawn chrome --remote-debugging-port=18892            │   │
│  │   → --user-data-dir=独立用户目录                           │   │
│  │   → --no-first-run --disable-sync                         │   │
│  │   → --disable-features=AutomationControlled (反检测)       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Step 2: Playwright 通过 CDP 连接浏览器                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ getChromeWebSocketUrl(cdpUrl)                             │   │
│  │   → GET http://127.0.0.1:18892/json/version               │   │
│  │   → 获取 webSocketDebuggerUrl                              │   │
│  │ chromium.connectOverCDP(wsUrl)                             │   │
│  │   → 连接到已有浏览器实例                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Step 3: 导航到 DeepSeek 并监听网络请求                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ page.goto("https://chat.deepseek.com")                    │   │
│  │                                                            │   │
│  │ page.on("request", handler)                                │   │
│  │   → 监听所有 /api/v0/ 开头的请求                           │   │
│  │   → 捕获 Authorization: Bearer xxx 头                      │   │
│  │                                                            │   │
│  │ context.cookies(["https://chat.deepseek.com"])             │   │
│  │   → 获取所有 Cookie                                        │   │
│  │   → 检查关键 Cookie: ds_session_id, d_id 等                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Step 4: 返回凭证                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ return {                                                   │   │
│  │   cookie: "ds_session_id=xxx; d_id=xxx; ...",              │   │
│  │   bearer: "eyJhbGciOiJIUzI1NiIs...",                      │   │
│  │   userAgent: "Mozilla/5.0 ..."                             │   │
│  │ }                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**关键实现细节：**

- 使用 `page.on("request")` 事件监听器拦截网络请求
- 只关注 URL 包含 `/api/v0/` 的请求
- 从请求头中提取 `Authorization` 字段获取 Bearer Token
- 通过 `context.cookies()` 获取完整 Cookie 字符串
- 验证关键 Cookie 存在（`ds_session_id` 或 `d_id`）后才认为捕获成功
- 设置 5 分钟超时，超时则报错

### 2.3 API 客户端实现（deepseek-web-client.ts）

这是最核心的文件，实现了与 DeepSeek 网页 API 的完整交互。

#### 2.3.1 请求头构造

```typescript
// 原项目的请求头构造
{
  Cookie: this.cookie,                    // 捕获的完整 Cookie
  "User-Agent": this.userAgent,           // 捕获的 UA
  "Content-Type": "application/json",
  Accept: "*/*",
  Authorization: `Bearer ${this.bearer}`, // 捕获的 Bearer Token
  Referer: "https://chat.deepseek.com/",
  Origin: "https://chat.deepseek.com",
  "x-client-platform": "web",
  "x-client-version": "1.7.0",
  "x-app-version": "20241129.1",
  "x-client-locale": "zh_CN",
  "x-client-timezone-offset": "28800",
}
```

**注意：** `x-client-version` 和 `x-app-version` 可能会随 DeepSeek 前端更新而变化，需要定期检查。

#### 2.3.2 PoW（工作量证明）机制

DeepSeek 使用 PoW 防止滥用。每次发送聊天请求前，必须先获取并求解一个 PoW 挑战。

**流程：**

```
1. POST /api/v0/chat/create_pow_challenge
   Body: { target_path: "/api/v0/chat/completion" }
   → 返回: { algorithm, challenge, difficulty, salt, signature, expire_at }

2. 根据 algorithm 求解:
   - "sha256": 暴力搜索 nonce，使 SHA256(salt + challenge + nonce) 的前 N 位为 0
   - "DeepSeekHashV1": 使用内嵌的 WASM 模块求解（SHA3-Keccak 变体）

3. 将求解结果 Base64 编码后放入请求头:
   x-ds-pow-response: base64({ ...challenge, answer: nonce, target_path })
```

**SHA256 求解逻辑（原项目代码）：**

```typescript
// 遍历 nonce，找到满足难度要求的哈希
let nonce = 0;
while (true) {
  const input = salt + target + nonce;
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  // 计算前导零比特数
  let zeroBits = 0;
  for (const char of hash) {
    const val = parseInt(char, 16);
    if (val === 0) { zeroBits += 4; }
    else { zeroBits += Math.clz32(val) - 28; break; }
  }
  // difficulty > 1000 时取 log2
  const targetDifficulty = difficulty > 1000
    ? Math.floor(Math.log2(difficulty)) : difficulty;
  if (zeroBits >= targetDifficulty) return nonce;
  nonce++;
}
```

**DeepSeekHashV1 求解：**
- 使用内嵌的 WASM 二进制模块（约 12KB base64 编码的 SHA3 实现）
- 通过 `WebAssembly.instantiate()` 加载
- 调用 `wasm_solve(retptr, challengePtr, challengeLen, prefixPtr, prefixLen, difficulty)`
- prefix 格式为 `${salt}_${expire_at}_`

#### 2.3.3 会话管理

```
1. 创建会话:
   POST /api/v0/chat_session/create
   Body: {}
   → 返回 chat_session_id

2. 发送消息:
   POST /api/v0/chat/completion
   Body: {
     chat_session_id: "xxx",
     parent_message_id: null | "上一条消息ID",
     prompt: "用户消息",
     ref_file_ids: [],
     thinking_enabled: true,
     search_enabled: true,
     preempt: false
   }
   Headers: { x-ds-pow-response: "base64编码的PoW结果" }
   → 返回 SSE 流
```

#### 2.3.4 SSE 响应格式

DeepSeek 网页版返回的 SSE 格式比较特殊，不是标准 OpenAI 格式：

```
event: message
data: {"p":"/0/e/0/v","v":"你"}

event: message
data: {"p":"/0/e/0/v","v":"好"}

event: message
data: {"response_message_id":"msg_xxx","p":"/0/e/0/v","v":"！"}

// 推理模式下的思考内容
data: {"p":"/0/e/0/reasoning/v","v":"让我思考一下..."}

// 搜索结果
data: {"type":"search_result","v":{"query":"xxx"}}

data: [DONE]
```

**关键字段解析：**
- `p` (path): 指示内容类型
  - 包含 `reasoning` → 思考/推理内容
  - 包含 `content` 或 `choices` → 正文内容
- `v` (value): 增量文本
- `response_message_id`: 用于多轮对话的消息 ID 追踪
- `type`: 特殊事件类型（如 `search_result`）

### 2.4 流式响应解析（deepseek-web-stream.ts）

原项目实现了一个复杂的标签解析器，处理 DeepSeek 返回的 XML 风格标签：

- `<think>` / `<thinking>` / `<thought>` → 思考内容
- `<tool_call id="xxx" name="xxx">` → 工具调用
- `<final>` → 最终回复
- `[[reply_to_current]]` → 回复标记

对于我们的反代工具，可以大幅简化这部分，只需要将 DeepSeek 的 SSE 格式转换为 OpenAI 格式即可。

---

## 3. 独立反代工具架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    DeepSeek Reverse Proxy                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │ 本地 AI 应用  │     │  Express     │     │  DeepSeek    │    │
│  │ (Cursor等)   │────▶│  HTTP 服务   │────▶│  Web API     │    │
│  │              │◀────│  :3000       │◀────│              │    │
│  └──────────────┘     └──────┬───────┘     └──────────────┘    │
│                              │                                   │
│                     ┌────────▼────────┐                         │
│                     │  凭证管理模块    │                         │
│                     │  auth.json      │                         │
│                     └────────┬────────┘                         │
│                              │                                   │
│                     ┌────────▼────────┐                         │
│                     │  Playwright     │                         │
│                     │  浏览器自动化    │                         │
│                     └─────────────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 核心文件结构

```
deepseek-proxy/
├── src/
│   ├── auth.ts              # 凭证捕获（Playwright + CDP）
│   ├── client.ts            # DeepSeek Web API 客户端（含 PoW）
│   ├── server.ts            # Express HTTP 服务（OpenAI 兼容）
│   ├── stream-converter.ts  # SSE 格式转换（DeepSeek → OpenAI）
│   └── index.ts             # 入口文件
├── data/
│   └── auth.json            # 凭证存储（自动生成，勿提交）
├── package.json
├── tsconfig.json
└── .gitignore
```

### 3.3 请求处理流程

```
客户端请求 POST /v1/chat/completions
    │
    ▼
① 解析 OpenAI 格式的请求体 (model, messages, stream)
    │
    ▼
② 读取本地凭证 (auth.json → cookie, bearer, userAgent)
    │
    ▼
③ 创建/复用 DeepSeek 会话 (chat_session_id)
    │
    ▼
④ 获取 PoW 挑战 → 求解 → 编码为 x-ds-pow-response
    │
    ▼
⑤ 将 messages 拼接为单条 prompt 发送到 DeepSeek Web API
    │
    ▼
⑥ 接收 DeepSeek SSE 响应 → 转换为 OpenAI SSE 格式 → 返回客户端
```

---

## 4. 分步实现指南

### 4.1 项目初始化

```bash
mkdir deepseek-proxy
cd deepseek-proxy
npm init -y
npm install express playwright-core typescript @types/express @types/node
npm install -D tsx
```

**package.json 关键配置：**

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "auth": "tsx src/auth.ts"
  }
}
```

**tsconfig.json：**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### 4.2 凭证捕获模块（auth.ts）

这是第一步，也是最关键的一步。有两种方式：

#### 方式 A：自动捕获（推荐）

```typescript
// src/auth.ts
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(process.cwd(), "data", "auth.json");

interface Credentials {
  cookie: string;
  bearer: string;
  userAgent: string;
  capturedAt: string;
}

/**
 * 启动 Chrome 并自动捕获 DeepSeek 登录凭证
 *
 * 前提：本机已安装 Chrome，且需要先手动启动 Chrome 调试模式：
 *   Windows: chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\tmp\chrome-debug"
 *   macOS:   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"
 *   Linux:   google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"
 *
 * 或者使用 Playwright 自带浏览器（无需手动启动 Chrome）
 */
export async function captureCredentials(): Promise<Credentials> {
  console.log("🔗 正在连接 Chrome 调试端口 (9222)...");

  // 方式1: 连接已有 Chrome 实例（推荐，可复用登录态）
  // 需要先手动启动: chrome --remote-debugging-port=9222 --user-data-dir=xxx
  let browser;
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version");
    const data = await res.json() as { webSocketDebuggerUrl: string };
    browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
    console.log("✅ 已连接到 Chrome");
  } catch {
    // 方式2: 启动新的 Playwright 浏览器
    console.log("⚠️  未检测到 Chrome 调试端口，启动 Playwright 浏览器...");
    browser = await chromium.launch({ headless: false });
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();

  await page.goto("https://chat.deepseek.com");
  const userAgent = await page.evaluate(() => navigator.userAgent);

  console.log("👤 请在浏览器中登录 DeepSeek...");
  console.log("   （登录后会自动捕获凭证，最长等待 5 分钟）");

  return new Promise<Credentials>((resolve, reject) => {
    let capturedBearer = "";
    const timeout = setTimeout(() => reject(new Error("登录超时（5分钟）")), 300_000);

    const tryResolve = async () => {
      if (!capturedBearer) return;

      const cookies = await context.cookies([
        "https://chat.deepseek.com",
        "https://deepseek.com",
      ]);

      if (cookies.length === 0) return;

      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
      const hasSession = cookieString.includes("ds_session_id=")
                      || cookieString.includes("d_id=")
                      || cookies.length > 3;

      if (hasSession) {
        clearTimeout(timeout);
        const creds: Credentials = {
          cookie: cookieString,
          bearer: capturedBearer,
          userAgent,
          capturedAt: new Date().toISOString(),
        };

        // 保存到文件
        fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
        fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
        console.log("✅ 凭证已捕获并保存到 data/auth.json");

        resolve(creds);
      }
    };

    // 监听网络请求，捕获 Bearer Token
    page.on("request", async (request) => {
      const url = request.url();
      if (url.includes("/api/v0/")) {
        const auth = request.headers()["authorization"];
        if (auth?.startsWith("Bearer ") && !capturedBearer) {
          capturedBearer = auth.slice(7);
          console.log("🔑 已捕获 Bearer Token");
          await tryResolve();
        }
      }
    });

    page.on("close", () => reject(new Error("浏览器窗口被关闭")));
  });
}

// 读取已保存的凭证
export function loadCredentials(): Credentials | null {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

// 直接运行时执行捕获
if (process.argv[1]?.endsWith("auth.ts")) {
  captureCredentials()
    .then(() => { console.log("🎉 完成！可以启动代理服务了。"); process.exit(0); })
    .catch(err => { console.error("❌ 失败:", err.message); process.exit(1); });
}
```

#### 方式 B：手动粘贴

如果不想用浏览器自动化，可以手动从 DevTools 复制：

1. 打开 https://chat.deepseek.com 并登录
2. F12 → Network → 找到任意 `/api/v0/` 请求
3. 复制 `Cookie` 和 `Authorization` 请求头
4. 手动写入 `data/auth.json`：

```json
{
  "cookie": "ds_session_id=xxx; d_id=xxx; ...",
  "bearer": "eyJhbGciOiJIUzI1NiIs...",
  "userAgent": "Mozilla/5.0 ...",
  "capturedAt": "2025-01-01T00:00:00.000Z"
}
```

### 4.3 DeepSeek Web API 客户端（client.ts）

```typescript
// src/client.ts
import crypto from "node:crypto";

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
  thinkingEnabled?: boolean;
  searchEnabled?: boolean;
  signal?: AbortSignal;
}

export class DeepSeekWebClient {
  private cookie: string;
  private bearer: string;
  private userAgent: string;

  constructor(creds: { cookie: string; bearer: string; userAgent: string }) {
    this.cookie = creds.cookie;
    this.bearer = creds.bearer;
    this.userAgent = creds.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  }

  private headers() {
    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: "*/*",
      ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
      Referer: "https://chat.deepseek.com/",
      Origin: "https://chat.deepseek.com",
      "x-client-platform": "web",
      "x-client-version": "1.7.0",       // 注意：可能需要更新
      "x-app-version": "20241129.1",      // 注意：可能需要更新
      "x-client-locale": "zh_CN",
      "x-client-timezone-offset": "28800",
    };
  }

  // ========== PoW 求解 ==========

  private async fetchPowChallenge(targetPath: string): Promise<PowChallenge> {
    const res = await fetch("https://chat.deepseek.com/api/v0/chat/create_pow_challenge", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ target_path: targetPath }),
    });
    if (!res.ok) throw new Error(`PoW challenge 请求失败: ${res.status}`);

    const data = await res.json() as any;
    const challenge = data.data?.biz_data?.challenge || data.data?.challenge || data.challenge;
    if (!challenge) throw new Error("PoW challenge 响应中缺少 challenge 字段");
    return challenge;
  }

  private solvePowSha256(challenge: PowChallenge): number {
    const { challenge: target, salt, difficulty } = challenge;
    let nonce = 0;
    const targetDifficulty = difficulty > 1000 ? Math.floor(Math.log2(difficulty)) : difficulty;

    while (nonce < 1_000_000) {
      const input = salt + target + nonce;
      const hash = crypto.createHash("sha256").update(input).digest("hex");

      let zeroBits = 0;
      for (const char of hash) {
        const val = parseInt(char, 16);
        if (val === 0) { zeroBits += 4; }
        else { zeroBits += Math.clz32(val) - 28; break; }
      }

      if (zeroBits >= targetDifficulty) return nonce;
      nonce++;
    }
    throw new Error("SHA256 PoW 求解超时");
  }

  /**
   * 求解 PoW 并返回 base64 编码的响应头值
   *
   * 注意：原项目还支持 DeepSeekHashV1 算法（使用内嵌 WASM），
   * 这里只实现了 SHA256。如果 DeepSeek 切换到 DeepSeekHashV1，
   * 需要额外引入 WASM 模块。
   */
  private async solvePow(targetPath: string): Promise<string> {
    const challenge = await this.fetchPowChallenge(targetPath);

    let answer: number;
    if (challenge.algorithm === "sha256") {
      answer = this.solvePowSha256(challenge);
    } else {
      // DeepSeekHashV1 需要 WASM 模块，这里先抛错
      // 实际使用中可以从原项目提取 WASM 二进制
      throw new Error(`不支持的 PoW 算法: ${challenge.algorithm}，需要实现 WASM 求解器`);
    }

    return Buffer.from(JSON.stringify({
      ...challenge,
      answer,
      target_path: targetPath,
    })).toString("base64");
  }

  // ========== 会话管理 ==========

  async createSession(): Promise<string> {
    const res = await fetch("https://chat.deepseek.com/api/v0/chat_session/create", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`创建会话失败: ${res.status}`);

    const data = await res.json() as any;
    const sessionId = data.data?.biz_data?.id || data.data?.biz_data?.chat_session_id || "";
    if (!sessionId) throw new Error("创建会话返回空 ID");
    return sessionId;
  }

  // ========== 聊天请求 ==========

  async chat(params: ChatParams): Promise<ReadableStream<Uint8Array> | null> {
    const targetPath = "/api/v0/chat/completion";
    const powResponse = await this.solvePow(targetPath);

    const res = await fetch(`https://chat.deepseek.com${targetPath}`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "x-ds-pow-response": powResponse,
      },
      body: JSON.stringify({
        chat_session_id: params.sessionId,
        parent_message_id: params.parentMessageId ?? null,
        prompt: params.message,
        ref_file_ids: [],
        thinking_enabled: params.thinkingEnabled ?? true,
        search_enabled: params.searchEnabled ?? false,
        preempt: false,
      }),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`聊天请求失败: ${res.status} ${text}`);
    }

    return res.body;
  }
}
```

### 4.4 SSE 格式转换器（stream-converter.ts）

将 DeepSeek 的 SSE 格式转换为 OpenAI 兼容格式：

```typescript
// src/stream-converter.ts
import { Transform } from "node:stream";
import crypto from "node:crypto";

/**
 * 将 DeepSeek Web SSE 流转换为 OpenAI 兼容的 SSE 流
 *
 * DeepSeek 格式:
 *   data: {"p":"/0/e/0/v","v":"你好"}
 *   data: {"p":"/0/e/0/reasoning/v","v":"思考中..."}
 *
 * OpenAI 格式:
 *   data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"你好"}}]}
 */
export function createStreamConverter(model: string) {
  const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let parentMessageId: string | null = null;

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("event:")) continue;

        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") {
            this.push("data: [DONE]\n\n");
            continue;
          }

          try {
            const data = JSON.parse(dataStr);

            // 记录 parent message id（用于多轮对话）
            if (data.response_message_id) {
              parentMessageId = data.response_message_id;
            }

            // 提取文本增量
            let content: string | null = null;
            let isReasoning = false;

            // 推理内容
            if (data.p?.includes("reasoning") || data.type === "thinking") {
              content = data.v ?? data.content ?? null;
              isReasoning = true;
            }
            // 正文内容
            else if (typeof data.v === "string") {
              content = data.v;
            }
            else if (data.type === "text" && typeof data.content === "string") {
              content = data.content;
            }
            // OpenAI 格式的 choices（兼容）
            else if (data.choices?.[0]?.delta?.content) {
              content = data.choices[0].delta.content;
            }
            else if (data.choices?.[0]?.delta?.reasoning_content) {
              content = data.choices[0].delta.reasoning_content;
              isReasoning = true;
            }

            // 过滤垃圾 token
            if (content === "<｜end▁of▁thinking｜>" || content === "<|endoftext|>") {
              continue;
            }

            if (content !== null) {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: isReasoning
                    ? { reasoning_content: content }  // 部分客户端支持
                    : { content },
                  finish_reason: null,
                }],
              };
              this.push(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
      callback();
    },

    flush(callback) {
      // 发送结束标记
      const endChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop",
        }],
      };
      this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
      this.push("data: [DONE]\n\n");
      callback();
    },
  });

  return { transform, getParentMessageId: () => parentMessageId };
}

/**
 * 非流式响应：收集完整内容后返回
 */
export async function collectFullResponse(
  stream: ReadableStream<Uint8Array>,
  model: string,
): Promise<object> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        if (data.p?.includes("reasoning") || data.type === "thinking") {
          reasoning += data.v ?? data.content ?? "";
        } else if (typeof data.v === "string") {
          if (data.v !== "<｜end▁of▁thinking｜>" && data.v !== "<|endoftext|>") {
            content += data.v;
          }
        } else if (data.choices?.[0]?.delta?.content) {
          content += data.choices[0].delta.content;
        }
      } catch {}
    }
  }

  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
```

### 4.5 HTTP 服务（server.ts）

```typescript
// src/server.ts
import express from "express";
import { Readable } from "node:stream";
import { DeepSeekWebClient } from "./client.js";
import { loadCredentials } from "./auth.js";
import { createStreamConverter, collectFullResponse } from "./stream-converter.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// 会话缓存
const sessionCache = new Map<string, string>();

function getClient() {
  const creds = loadCredentials();
  if (!creds) throw new Error("未找到凭证，请先运行 npm run auth");
  return new DeepSeekWebClient(creds);
}

// ========== OpenAI 兼容接口 ==========

// 模型列表
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "deepseek-chat", object: "model", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner", object: "model", owned_by: "deepseek-web" },
    ],
  });
});

// 聊天补全
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model = "deepseek-chat", messages = [], stream = false } = req.body;
    const client = getClient();

    // 获取或创建会话
    const sessionKey = req.headers["x-session-id"] as string || "default";
    let sessionId = sessionCache.get(sessionKey);
    if (!sessionId) {
      sessionId = await client.createSession();
      sessionCache.set(sessionKey, sessionId);
    }

    // 将 OpenAI messages 格式拼接为单条 prompt
    const prompt = messages.map((m: any) => {
      const role = m.role === "system" ? "System"
                 : m.role === "user" ? "User"
                 : "Assistant";
      const content = typeof m.content === "string"
        ? m.content
        : (m.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
      return `${role}: ${content}`;
    }).join("\n\n");

    // 发送请求
    const responseStream = await client.chat({
      sessionId,
      message: prompt,
      thinkingEnabled: model.includes("reasoner"),
      searchEnabled: false,
    });

    if (!responseStream) {
      return res.status(500).json({ error: { message: "DeepSeek 返回空响应" } });
    }

    if (stream) {
      // 流式响应
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const { transform } = createStreamConverter(model);
      const nodeStream = Readable.fromWeb(responseStream as any);
      nodeStream.pipe(transform).pipe(res);

      req.on("close", () => nodeStream.destroy());
    } else {
      // 非流式响应
      const result = await collectFullResponse(responseStream, model);
      res.json(result);
    }
  } catch (err: any) {
    console.error("请求处理失败:", err.message);
    res.status(500).json({
      error: { message: err.message, type: "server_error" },
    });
  }
});

// 健康检查
app.get("/health", (_req, res) => {
  const creds = loadCredentials();
  res.json({
    status: creds ? "ok" : "no_credentials",
    capturedAt: creds?.capturedAt,
  });
});

export function startServer(port = 3000) {
  app.listen(port, () => {
    console.log(`\n🚀 DeepSeek 反代服务已启动: http://127.0.0.1:${port}`);
    console.log(`   兼容 OpenAI API 格式`);
    console.log(`   模型列表: GET  /v1/models`);
    console.log(`   聊天接口: POST /v1/chat/completions`);
    console.log(`   健康检查: GET  /health\n`);
  });
}
```

### 4.6 入口文件（index.ts）

```typescript
// src/index.ts
import { startServer } from "./server.js";
import { captureCredentials, loadCredentials } from "./auth.js";

const command = process.argv[2];

if (command === "auth") {
  // 凭证捕获模式
  captureCredentials()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
} else {
  // 服务模式
  const creds = loadCredentials();
  if (!creds) {
    console.error("❌ 未找到凭证文件 data/auth.json");
    console.error("   请先运行: npm run auth");
    process.exit(1);
  }
  const port = parseInt(process.env.PORT || "3000");
  startServer(port);
}
```

---

## 5. 关键代码实现

### 5.1 DeepSeekHashV1 WASM 求解器（可选但重要）

原项目内嵌了一个约 12KB 的 WASM 二进制（base64 编码），用于求解 `DeepSeekHashV1` 算法。如果 DeepSeek 服务端返回的 PoW 算法是 `DeepSeekHashV1` 而非 `sha256`，你需要这个模块。

**提取方式：**

从原项目 `src/providers/deepseek-web-client.ts` 中复制 `SHA3_WASM_B64` 常量（一个很长的 base64 字符串），然后：

```typescript
// src/pow-wasm.ts
const SHA3_WASM_B64 = "AGFzbQEAAAA..."; // 从原项目复制

let wasmInstance: WebAssembly.Instance | null = null;

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_solve: (retptr: number, ptrC: number, lenC: number, ptrP: number, lenP: number, difficulty: number) => void;
  __wbindgen_add_to_stack_pointer: (delta: number) => number;
  __wbindgen_export_0: (size: number, align: number) => number;
}

async function getInstance(): Promise<WebAssembly.Instance> {
  if (wasmInstance) return wasmInstance;
  const buf = Buffer.from(SHA3_WASM_B64, "base64");
  const { instance } = await WebAssembly.instantiate(buf, { wbg: {} });
  wasmInstance = instance;
  return instance;
}

export async function solveDeepSeekHashV1(
  challenge: string,
  salt: string,
  expireAt: number,
  difficulty: number,
): Promise<number> {
  const instance = await getInstance();
  const exports = instance.exports as unknown as WasmExports;
  const { memory, wasm_solve, __wbindgen_add_to_stack_pointer: addToStack, __wbindgen_export_0: alloc } = exports;

  const prefix = `${salt}_${expireAt}_`;

  const encode = (str: string): [number, number] => {
    const buf = Buffer.from(str, "utf8");
    const ptr = alloc(buf.length, 1);
    new Uint8Array(memory.buffer).set(buf, ptr);
    return [ptr, buf.length];
  };

  const [ptrC, lenC] = encode(challenge);
  const [ptrP, lenP] = encode(prefix);
  const retptr = addToStack(-16);

  wasm_solve(retptr, ptrC, lenC, ptrP, lenP, difficulty);

  const view = new DataView(memory.buffer);
  const status = view.getInt32(retptr, true);
  const answer = view.getFloat64(retptr + 8, true);
  addToStack(16);

  if (status === 0) throw new Error("DeepSeekHashV1 求解失败");
  return answer;
}
```

### 5.2 多轮对话支持

原项目通过 `parent_message_id` 实现多轮对话。每次 DeepSeek 返回的 SSE 中会包含 `response_message_id`，下一轮请求时将其作为 `parent_message_id` 传入。

在我们的反代工具中，由于每次请求都会把完整的 messages 历史拼接为 prompt，所以可以简化处理：

- 每次请求创建新会话（简单但浪费）
- 或者维护 session → (sessionId, parentMessageId) 的映射（推荐）

### 5.3 凭证过期处理

DeepSeek 的 Cookie 和 Bearer Token 会过期。建议：

1. 在请求失败时检查状态码（401/403）
2. 自动提示用户重新登录
3. 可以加一个定时检查机制

```typescript
// 在 server.ts 中添加
app.use(async (err: any, _req: any, res: any, _next: any) => {
  if (err.message?.includes("401") || err.message?.includes("403")) {
    res.status(401).json({
      error: {
        message: "DeepSeek 凭证已过期，请重新运行 npm run auth",
        type: "authentication_error",
      },
    });
  }
});
```

---

## 6. 部署与使用

### 6.1 首次使用

```bash
# 1. 安装依赖
npm install

# 2. 捕获凭证（会打开浏览器，登录后自动捕获）
npm run auth

# 3. 启动代理服务
npm start
# 或开发模式（自动重启）
npm run dev
```

### 6.2 在本地 AI 应用中配置

#### Cursor / Continue

```json
{
  "models": [{
    "title": "DeepSeek (Free)",
    "provider": "openai",
    "model": "deepseek-chat",
    "apiBase": "http://127.0.0.1:3000/v1",
    "apiKey": "not-needed"
  }]
}
```

#### Open WebUI

设置 → 连接 → OpenAI API：
- API Base URL: `http://127.0.0.1:3000/v1`
- API Key: `not-needed`（随便填）

#### 通用 curl 测试

```bash
# 流式
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'

# 非流式
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

---

## 7. 常见问题与注意事项

### 7.1 PoW 算法切换

DeepSeek 可能在 `sha256` 和 `DeepSeekHashV1` 之间切换。如果遇到 `不支持的 PoW 算法` 错误，需要实现 WASM 求解器（见 5.1 节）。

### 7.2 请求头版本号

`x-client-version` 和 `x-app-version` 会随 DeepSeek 前端更新而变化。如果请求被拒绝，可以：
1. 打开 DevTools 查看最新的请求头
2. 更新 `client.ts` 中的版本号

### 7.3 频率限制

网页版有隐式的频率限制，不适合高并发场景。建议：
- 请求间隔 > 2 秒
- 不要并发发送多个请求
- 如果被限流，等待几分钟后重试

### 7.4 安全提醒

- `data/auth.json` 包含敏感凭证，务必加入 `.gitignore`
- 不要将凭证暴露到公网
- 代理服务仅监听 `127.0.0.1`，不要绑定 `0.0.0.0`

### 7.5 合规声明

此方案仅供个人学习研究使用。使用时请遵守 DeepSeek 的服务条款。商业用途请使用 [DeepSeek 官方 API](https://platform.deepseek.com/)。

---

## 附录：原项目关键文件速查

| 文件 | 作用 | 我们的对应 |
|------|------|-----------|
| `src/providers/deepseek-web-auth.ts` | Playwright 登录捕获 | `src/auth.ts` |
| `src/providers/deepseek-web-client.ts` | API 客户端 + PoW | `src/client.ts` |
| `src/agents/deepseek-web-stream.ts` | SSE 解析 + 标签解析 | `src/stream-converter.ts` |
| `src/browser/chrome.ts` | Chrome 启动管理 | 简化为 CDP 连接 |
| `src/gateway/openai-http.ts` | OpenAI 兼容网关 | `src/server.ts` |
| `src/browser/cdp.helpers.ts` | CDP WebSocket 工具 | 不需要（Playwright 封装） |
