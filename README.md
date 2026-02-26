# FreeSeek

> 免费使用 DeepSeek R1 / V3 全部能力，无需 API 额度。

FreeSeek 是一个 DeepSeek 网页版反向代理工具。它把 chat.deepseek.com 的能力包装成本地 OpenAI 兼容 API，让你可以在 Cursor、Continue、Open WebUI 等任意 AI 工具中直接调用 DeepSeek，包括深度思考（Chain-of-Thought）和联网搜索。

核心原理：自动化登录 → 抓取凭证 → 本地起一个 OpenAI 格式的 HTTP 服务 → 请求转发到 DeepSeek Web → PoW 自动求解 → 流式响应实时转换。

## 为什么用 FreeSeek

- **零成本**：直接走网页版通道，不消耗 API 额度
- **完整能力**：深度思考（R1 推理链）、联网搜索、长上下文，网页版有的这里都有
- **即插即用**：OpenAI 兼容接口，改个 Base URL 就能接入现有工具链
- **桌面应用**：Electron GUI，凭证管理、服务控制、日志监控、在线测试一站搞定
- **PoW 全自动**：SHA256 和 DeepSeekHashV1（WASM）两种算法自动识别求解，无需手动干预

## 快速开始

```bash
cd freeseek
npm install
npm start
```

启动后：

1. 在应用中点击「启动自动捕获」，浏览器弹出后登录你的 DeepSeek 账号
2. 登录成功后凭证自动保存，反代服务自动启动在 `http://127.0.0.1:3000`
3. 在你的 AI 工具中配置 Base URL 为 `http://127.0.0.1:3000/v1`，API Key 随便填

也支持手动粘贴凭证：F12 打开 DevTools → Network → 找到 `/api/v0/` 请求 → 复制 Cookie 和 Authorization 头。

## 可用模型

| 模型 ID | 说明 | 思考链 |
|---|---|---|
| `deepseek-chat` | DeepSeek V3 对话 | 否 |
| `deepseek-reasoner` | DeepSeek R1 推理 | 是 |
| `deepseek-chat-search` | V3 + 联网搜索 | 否 |
| `deepseek-reasoner-search` | R1 + 联网搜索 | 是 |

`deepseek-reasoner` 系列模型会在流式响应中返回 `reasoning_content` 字段，包含完整的推理思考过程。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/models` | 模型列表 |
| POST | `/v1/chat/completions` | 聊天补全（流式/非流式） |
| GET | `/health` | 健康检查 |

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "证明根号2是无理数"}],
    "stream": true
  }'
```

## 接入示例

| 工具 | 配置方式 |
|---|---|
| Cursor | Settings → Models → OpenAI API Base: `http://127.0.0.1:3000/v1` |
| Continue | config.json → `apiBase: "http://127.0.0.1:3000/v1"` |
| Open WebUI | 设置 → 连接 → API Base URL: `http://127.0.0.1:3000/v1` |
| ChatBox | 设置 → API 域名: `http://127.0.0.1:3000` |
| Python | `OpenAI(base_url="http://127.0.0.1:3000/v1", api_key="any")` |
| Node.js | `new OpenAI({ baseURL: "http://127.0.0.1:3000/v1", apiKey: "any" })` |

## 项目结构

```
freeseek/
├── src/
│   ├── main/
│   │   ├── index.ts            # Electron 主进程
│   │   ├── client.ts           # DeepSeek Web API 客户端
│   │   ├── server.ts           # OpenAI 兼容 HTTP 服务
│   │   ├── stream-converter.ts # SSE 流格式转换
│   │   ├── auth.ts             # 凭证捕获（Playwright 自动化）
│   │   ├── pow-wasm.ts         # PoW WASM 求解器
│   │   ├── preload.ts          # Electron preload
│   │   └── wasm-b64.txt        # WASM 二进制
│   └── renderer/
│       └── index.html          # 控制面板 GUI
├── data/
│   └── auth.json               # 凭证存储（自动生成，已 gitignore）
├── package.json
└── tsconfig.json
```

## 开发命令

```bash
npm start          # 构建并启动
npm run build      # 仅构建
npm run auth       # 命令行捕获凭证（不启动 GUI）
npm run pack       # 打包为可分发桌面应用
```

## 免责声明

本项目仅供个人学习研究使用，请遵守 DeepSeek 服务条款。因使用本工具产生的任何问题由使用者自行承担。

## License

MIT
