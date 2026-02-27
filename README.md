# FreeSeek

> 免费使用 DeepSeek R1 / V3 和 Claude 全部能力，无需 API 额度。

FreeSeek 是一个 DeepSeek + Claude 网页版反向代理工具。它把 chat.deepseek.com 和 claude.ai 的能力包装成本地 OpenAI 兼容 API，让你可以在 Cursor、Continue、Open WebUI 等任意 AI 工具中直接调用，包括深度思考（Chain-of-Thought）和联网搜索。

支持两种运行模式：
- **桌面模式**：Electron GUI，适合 Windows / macOS 本机使用
- **Web 模式**：纯 Node.js，适合 Linux 服务器部署，通过浏览器访问管理面板

## 为什么用 FreeSeek

- **零成本**：直接走网页版通道，不消耗 API 额度
- **多厂商**：同时支持 DeepSeek 和 Claude，统一 OpenAI 格式输出
- **完整能力**：深度思考（R1 推理链）、联网搜索、Claude 200K 上下文，网页版有的这里都有
- **即插即用**：OpenAI 兼容接口，改个 Base URL 就能接入现有工具链
- **双模式部署**：桌面 Electron + Linux Web 服务器，按需选择
- **PoW 全自动**：SHA256 和 DeepSeekHashV1（WASM）两种算法自动识别求解

## 快速开始

### 桌面模式（Windows / macOS）

```bash
cd freeseek
npm install
npm start
```

启动后在应用中点击「启动自动捕获」，浏览器弹出后登录账号，凭证自动保存。

### Web 模式（Linux 服务器）

```bash
cd freeseek
npm install
npm run build
npm run web:start          # 默认 API 端口 3000，管理面板端口 3001
# 或自定义端口
node dist/main/server-standalone.js --port 8080 --admin-port 8081
```

启动后访问 `http://你的服务器IP:3001` 打开管理面板，在凭证页面配置登录信息。

## 凭证配置

### DeepSeek 凭证

DeepSeek 登录没有特殊要求，以下三种方式任选：

**方式一：自动捕获（桌面模式）**

点击「启动自动捕获」→ 弹出 Chrome → 登录 DeepSeek → 凭证自动保存。

**方式二：管理面板手动粘贴**

1. 在浏览器中打开 `chat.deepseek.com` 并登录
2. 按 F12 打开开发者工具 → Network 面板
3. 找到任意 `/api/v0/` 请求，复制 `Cookie` 和 `Authorization` 请求头
4. 在管理面板「凭证」页面 → 「手动粘贴凭证」中填入

**方式三：直接编辑文件（适合 Linux 服务器）**

```bash
mkdir -p data
cat > data/auth.json << 'EOF'
{
  "cookie": "ds_session_id=xxx; d_id=xxx; ...",
  "bearer": "eyJhbGciOiJIUzI1NiIs...",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
EOF
```

### Claude 凭证

> ⚠️ **重要提示**：Claude 使用 Cloudflare 防护，对访问节点的 IP 纯净度有严格要求。IDC 机房 IP、数据中心 IP 大概率无法访问 claude.ai，会被 Cloudflare 拦截。建议使用住宅 IP 或优质代理节点。

**方式一：自动捕获（桌面模式）**

点击「启动自动捕获」→ 弹出 Chrome → 登录 Claude → sessionKey 自动保存。

需要代理时，先在「设置」页面配置代理地址（如 `http://127.0.0.1:7890`），Playwright 启动的浏览器不会继承系统代理。

**方式二：管理面板手动粘贴**

1. 在浏览器中打开 `claude.ai` 并登录
2. 按 F12 → Application → Cookies → 找到 `sessionKey`（格式为 `sk-ant-sid01-...` 或 `sk-ant-sid02-...`）
3. 在管理面板「凭证」页面 → Claude「手动粘贴凭证」中填入

**方式三：直接编辑文件（适合 Linux 服务器）**

```bash
cat > data/claude-auth.json << 'EOF'
{
  "sessionKey": "sk-ant-sid01-xxxxxxxx",
  "cookie": "sessionKey=sk-ant-sid01-xxxxxxxx",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "capturedAt": "2026-01-01T00:00:00.000Z"
}
EOF
```

### Linux 服务器凭证获取建议

Linux 服务器通常没有桌面环境，无法使用自动捕获。推荐流程：

1. 在本机（Windows / macOS）浏览器登录 DeepSeek 和 Claude
2. 用 F12 抓取凭证信息
3. 通过管理面板（`http://服务器:3001`）手动粘贴，或直接 SCP 上传凭证文件到服务器的 `data/` 目录

### 代理配置

Playwright 启动的浏览器不继承系统代理。如需代理，有两种方式：

- 管理面板「设置」页面填写代理地址
- 或设置环境变量：`export HTTPS_PROXY=http://127.0.0.1:7890`

支持 `http`、`https`、`socks5` 协议。

## 可用模型

| 模型 ID | 说明 | 厂商 | 特性 |
|---|---|---|---|
| `deepseek-chat` | DeepSeek V3 对话 | DeepSeek | — |
| `deepseek-reasoner` | DeepSeek R1 推理 | DeepSeek | 深度思考 |
| `deepseek-chat-search` | V3 + 联网搜索 | DeepSeek | — |
| `deepseek-reasoner-search` | R1 + 联网搜索 | DeepSeek | 深度思考 |
| `claude-sonnet-4-6` | Claude Sonnet 4 | Claude | 200K 上下文 |
| `claude-opus-4-6` | Claude Opus 4 | Claude | 200K 上下文 |
| `claude-haiku-4-6` | Claude Haiku 4 | Claude | 200K 上下文 |
| `claude-3-5-sonnet` | Claude 3.5 Sonnet（别名） | Claude | → claude-sonnet-4-6 |
| `claude-3-opus` | Claude 3 Opus（别名） | Claude | → claude-opus-4-6 |
| `claude-3-haiku` | Claude 3 Haiku（别名） | Claude | → claude-haiku-4-6 |

模型 ID 以 `claude-` 开头时自动路由到 Claude，其余走 DeepSeek。`deepseek-reasoner` 系列会在流式响应中返回 `reasoning_content` 字段。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/models` | 模型列表 |
| POST | `/v1/chat/completions` | 聊天补全（流式/非流式） |
| GET | `/health` | 健康检查 |

支持 `strip_reasoning` 参数（body 字段或 `x-strip-reasoning` 请求头），设为 `true` 时过滤掉思考链内容，只返回最终回答。

```bash
# DeepSeek 示例
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "证明根号2是无理数"}],
    "stream": true
  }'

# Claude 示例
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

Windows CMD 用户：

```cmd
curl -N http://127.0.0.1:3000/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"stream\":true}"
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

API Key 随便填，服务不做鉴权。

## 项目结构

```
freeseek/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron 主进程
│   │   ├── server.ts             # OpenAI 兼容 HTTP 服务 + Claude 路由
│   │   ├── server-standalone.ts  # 独立 Web 模式入口（无需 Electron）
│   │   ├── client.ts             # DeepSeek Web API 客户端
│   │   ├── claude-client.ts      # Claude Web API 客户端（Playwright 浏览器上下文）
│   │   ├── claude-auth.ts        # Claude 凭证捕获
│   │   ├── claude-stream.ts      # Claude SSE → OpenAI 格式转换
│   │   ├── stream-converter.ts   # DeepSeek SSE 流格式转换
│   │   ├── auth.ts               # DeepSeek 凭证捕获（Playwright 自动化）
│   │   ├── pow-wasm.ts           # PoW WASM 求解器
│   │   ├── preload.ts            # Electron preload
│   │   └── wasm-b64.txt          # WASM 二进制
│   └── renderer/                 # Vue 3 + Pinia 管理面板
│       ├── App.vue
│       ├── bridge.ts             # 通信桥接（Electron IPC / Web HTTP 自动切换）
│       ├── stores/app.ts         # Pinia 状态管理
│       ├── pages/                # 页面组件（仪表盘、凭证、API、调试、聊天、日志、设置）
│       ├── components/           # 通用组件（侧边栏、顶栏、Toast）
│       └── styles/global.css     # Ant Design 风格全局样式
├── data/
│   ├── auth.json                 # DeepSeek 凭证（自动生成，已 gitignore）
│   └── claude-auth.json          # Claude 凭证（自动生成，已 gitignore）
├── package.json
└── tsconfig.json
```

## 开发命令

```bash
# 桌面模式
npm start              # 构建并启动 Electron 应用
npm run dev            # 同上

# Web 模式（Linux 部署）
npm run web            # 构建并启动独立 Web 服务
npm run web:start      # 仅启动（需先 build）

# 构建
npm run build          # 构建全部（main + renderer）
npm run build:main     # 仅构建主进程
npm run build:renderer # 仅构建前端

# 其他
npm run auth           # 命令行捕获 DeepSeek 凭证（不启动 GUI）
npm run pack           # 打包为可分发桌面应用
```

## 常见问题

**Q: Claude 自动捕获报 `ERR_CONNECTION_CLOSED`？**

Claude 使用 Cloudflare 防护，需要配置代理。在「设置」页面填写代理地址，或设置 `HTTPS_PROXY` 环境变量。注意 IDC 机房 IP 可能被 Cloudflare 拦截，需要使用住宅 IP 或高质量代理节点。

**Q: Linux 服务器上怎么获取凭证？**

Linux 服务器没有桌面环境，无法弹出浏览器自动捕获。建议在本机抓取凭证后，通过管理面板手动粘贴或直接上传 `data/auth.json` 和 `data/claude-auth.json` 文件。

**Q: 端口被占用（EADDRINUSE）？**

```bash
# Linux / macOS
lsof -i :3000
kill -9 <PID>

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Q: DeepSeek 返回的内容开头有感叹号？**

这是 DeepSeek 模型自身行为，不是转换器的问题。

**Q: Claude 报 `invalid_request_error` locale 错误？**

已修复。Claude API 只接受特定 locale 值（`en-US`、`de-DE` 等），代码中已硬编码为 `en-US`。

**Q: `npm install` 时 Electron 下载很慢或失败，提示 `Electron failed to install correctly`？**

Electron 安装时需要从 GitHub 下载约 100MB 的二进制文件，国内网络经常超时或下载不完整。解决方法：

方法一：设置 Electron 镜像源（推荐）

```bash
# 设置淘宝 Electron 镜像
npm config set electron_mirror https://npmmirror.com/mirrors/electron/

# 然后重新安装
rm -rf node_modules
npm install
```

Windows CMD 下同样适用，或者用环境变量：

```cmd
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
rmdir /s /q node_modules
npm install
```

PowerShell：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
Remove-Item -Recurse -Force node_modules
npm install
```

方法二：在 `.npmrc` 文件中配置（一劳永逸）

在项目根目录或用户目录（`~/.npmrc`）创建 `.npmrc` 文件：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
```

方法三：使用代理

如果你有代理，可以让 npm 走代理下载：

```bash
npm config set proxy http://127.0.0.1:7890
npm config set https-proxy http://127.0.0.1:7890
npm install
```

方法四：手动下载 Electron 二进制

1. 从 [npmmirror Electron 镜像](https://registry.npmmirror.com/binary.html?path=electron/) 下载对应版本的 zip 文件（如 `electron-v33.4.11-win32-x64.zip`）
2. 放到 Electron 缓存目录：
   - Windows: `%LOCALAPPDATA%\electron\Cache\`
   - macOS: `~/Library/Caches/electron/`
   - Linux: `~/.cache/electron/`
3. 重新运行 `npm install`

> 💡 如果已经报错 `Electron failed to install correctly`，一定要先删除 `node_modules` 再重新安装，否则 npm 会跳过 Electron 的 postinstall 脚本。

## 致谢

本项目基于 [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token/tree/main) 的底层实现，感谢原作者的贡献。

## 免责声明

本项目仅供个人学习研究使用，请遵守 DeepSeek 和 Anthropic 的服务条款。因使用本工具产生的任何问题由使用者自行承担。

## License

MIT
