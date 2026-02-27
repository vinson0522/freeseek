<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "../stores/app";
const store = useAppStore();

function copyText(t: string) {
  navigator.clipboard?.writeText(t);
  store.showToast("已复制", "ok");
}
function copyCode(el: Event) {
  const btn = el.target as HTMLElement;
  const block = btn.closest(".ant-code-block");
  if (block) {
    navigator.clipboard?.writeText(block.textContent?.replace("复制", "").trim() || "");
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "复制"), 1200);
  }
}

const configJson = computed(() => {
  const port = store.serverPort || 3000;
  return JSON.stringify({
    agents: {
      defaults: {
        model: { primary: "freeseek/deepseek-chat" },
      },
    },
    models: {
      mode: "merge",
      providers: {
        freeseek: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "any",
          api: "openai-completions",
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
            { id: "deepseek-reasoner", name: "DeepSeek R1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 },
            { id: "claude-sonnet-4-6", name: "Claude Sonnet 4", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
            { id: "claude-opus-4-6", name: "Claude Opus 4", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 8192 },
          ],
        },
      },
    },
  }, null, 2);
});
</script>

<template>
  <div>
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">🦞 FreeSeek × OpenClaw 集成指南</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px">
          <a href="https://github.com/openclaw/openclaw" target="_blank" style="color:var(--primary)">OpenClaw</a>
          是一个开源自托管 AI Agent 平台，可连接 WhatsApp、Telegram、Discord、Slack 等消息平台，24/7 自动化执行任务。
        </p>
        <p style="margin-bottom:12px">
          将 FreeSeek 配置为 OpenClaw 的 LLM 后端后，OpenClaw 可免费使用 DeepSeek R1/V3 和 Claude 全部能力，无需 API 额度。
        </p>
        <div class="flow-diagram">
          <span class="flow-node">消息平台</span>
          <span class="flow-arrow">→</span>
          <span class="flow-node hl">OpenClaw</span>
          <span class="flow-arrow">→</span>
          <span class="flow-node hl">FreeSeek</span>
          <span class="flow-arrow">→</span>
          <span class="flow-node">DeepSeek / Claude</span>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">前置条件</div></div>
      <div class="ant-card-body">
        <div class="checklist">
          <div class="check-item">
            <span class="check-icon">✅</span>
            <div>
              <span class="check-title">FreeSeek 已运行</span>
              <span class="check-desc">默认监听 <span class="ant-code">http://127.0.0.1:{{ store.serverPort }}</span></span>
            </div>
          </div>
          <div class="check-item">
            <span class="check-icon">✅</span>
            <div>
              <span class="check-title">凭证已配置</span>
              <span class="check-desc">在「登录 &amp; 凭证」页面完成 DeepSeek / Claude 凭证配置</span>
            </div>
          </div>
          <div class="check-item">
            <span class="check-icon">✅</span>
            <div>
              <span class="check-title">OpenClaw 已安装</span>
              <span class="check-desc">参考 <a href="https://github.com/openclaw/openclaw" target="_blank" style="color:var(--primary)">官方仓库</a> 完成安装</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">方式一：编辑配置文件（推荐）</div>
      </div>
      <div class="ant-card-body">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-content">
            <p class="step-title">打开 OpenClaw 配置文件</p>
            <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button>nano ~/.openclaw/openclaw.json</div>
          </div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-content">
            <p class="step-title">粘贴以下配置（已根据当前端口自动生成）</p>
            <div class="ant-code-block" style="white-space:pre"><button class="copy-btn" @click="copyCode">复制</button>{{ configJson }}</div>
            <p style="margin-top:8px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
              💡 <span class="ant-code">apiKey</span> 随便填，FreeSeek 不做鉴权。<span class="ant-code">cost</span> 全部为 0，因为走的是网页版通道。
            </p>
          </div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-content">
            <p class="step-title">重启 OpenClaw Gateway</p>
            <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button>openclaw gateway restart</div>
          </div>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <div class="step-content">
            <p class="step-title">验证模型列表</p>
            <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button>openclaw models list</div>
            <p style="margin-top:8px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
              应该能看到 <span class="ant-code">freeseek/deepseek-chat</span>、<span class="ant-code">freeseek/claude-sonnet-4-6</span> 等模型。
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">方式二：CLI 快速配置</div>
      </div>
      <div class="ant-card-body">
        <p style="margin-bottom:16px;color:var(--text-secondary)">如果你更喜欢命令行操作，可以用 OpenClaw CLI 逐步设置：</p>
        <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button># 设置 FreeSeek 为自定义 Provider
openclaw config set models.providers.freeseek.baseUrl "http://127.0.0.1:{{ store.serverPort }}/v1"
openclaw config set models.providers.freeseek.apiKey "any"
openclaw config set models.providers.freeseek.api "openai-completions"

# 设置默认模型
openclaw models set freeseek/deepseek-chat

# 重启并验证
openclaw gateway restart
openclaw models list</div>
        <p style="margin-top:12px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
          ⚠️ CLI 不支持直接添加 models 数组，模型定义仍需手动编辑配置文件。但 OpenClaw 会自动通过
          <span class="ant-code">GET /v1/models</span> 发现 FreeSeek 提供的模型。
        </p>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">可用模型映射</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>OpenClaw 模型 ID</th><th>实际模型</th><th>特性</th></tr>
          <tr>
            <td><span class="ant-code">freeseek/deepseek-chat</span></td>
            <td>DeepSeek V3</td>
            <td><span class="ant-tag">通用对话</span></td>
          </tr>
          <tr>
            <td><span class="ant-code">freeseek/deepseek-reasoner</span></td>
            <td>DeepSeek R1</td>
            <td><span class="ant-tag ant-tag-processing">深度思考</span></td>
          </tr>
          <tr>
            <td><span class="ant-code">freeseek/deepseek-chat-search</span></td>
            <td>DeepSeek V3 + 联网</td>
            <td><span class="ant-tag ant-tag-warning">联网搜索</span></td>
          </tr>
          <tr>
            <td><span class="ant-code">freeseek/claude-sonnet-4-6</span></td>
            <td>Claude Sonnet 4</td>
            <td><span class="ant-tag ant-tag-success">200K 上下文</span></td>
          </tr>
          <tr>
            <td><span class="ant-code">freeseek/claude-opus-4-6</span></td>
            <td>Claude Opus 4</td>
            <td><span class="ant-tag ant-tag-success">200K 上下文</span></td>
          </tr>
        </table>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">切换模型</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">在 OpenClaw 中随时切换 FreeSeek 提供的模型：</p>
        <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button># 切换到 DeepSeek R1（深度思考）
openclaw models set freeseek/deepseek-reasoner

# 切换到 Claude Sonnet 4
openclaw models set freeseek/claude-sonnet-4-6

# 切换回 DeepSeek V3
openclaw models set freeseek/deepseek-chat</div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">远程部署场景</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">
          如果 FreeSeek 和 OpenClaw 不在同一台机器上（比如 FreeSeek 跑在你的 Windows 桌面，OpenClaw 跑在 Linux 服务器），需要：
        </p>
        <div class="tip-box">
          <div class="tip-title">🔧 让 FreeSeek 监听外部访问</div>
          <p>目前 FreeSeek 默认只监听 <span class="ant-code">127.0.0.1</span>（仅本机）。远程访问需要修改监听地址为 <span class="ant-code">0.0.0.0</span>，或通过 SSH 隧道转发：</p>
          <div class="ant-code-block" style="margin-top:8px"><button class="copy-btn" @click="copyCode">复制</button># 在 OpenClaw 服务器上建立 SSH 隧道到 FreeSeek 机器
ssh -L 3000:127.0.0.1:{{ store.serverPort }} user@freeseek-machine-ip -N</div>
          <p style="margin-top:8px">然后 OpenClaw 配置中的 baseUrl 保持 <span class="ant-code">http://127.0.0.1:3000/v1</span> 即可。</p>
        </div>
        <div class="tip-box" style="margin-top:12px">
          <div class="tip-title">⚠️ Claude 节点注意</div>
          <p>Claude 对 IP 纯净度有要求，IDC 机房 IP 可能被 Cloudflare 拦截。FreeSeek 应部署在有住宅 IP 或优质代理的环境中。</p>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">常见问题</div></div>
      <div class="ant-card-body">
        <div class="faq-item">
          <p class="faq-q">Q: OpenClaw 报 connection refused？</p>
          <p class="faq-a">确认 FreeSeek 服务正在运行。在本页面顶部的仪表盘检查服务状态，或访问
            <span class="ant-code">http://127.0.0.1:{{ store.serverPort }}/health</span> 检查。
          </p>
        </div>
        <div class="faq-item">
          <p class="faq-q">Q: 模型列表为空？</p>
          <p class="faq-a">FreeSeek 只会列出已配置凭证的厂商模型。确保在「登录 &amp; 凭证」页面至少配置了一个厂商的凭证。</p>
        </div>
        <div class="faq-item">
          <p class="faq-q">Q: OpenClaw 可以同时用 DeepSeek 和 Claude 吗？</p>
          <p class="faq-a">可以。在配置文件的 models 数组中同时列出两个厂商的模型，通过 <span class="ant-code">openclaw models set</span> 切换即可。</p>
        </div>
        <div class="faq-item">
          <p class="faq-q">Q: apiKey 填什么？</p>
          <p class="faq-a">随便填，比如 <span class="ant-code">"any"</span> 或 <span class="ant-code">"freeseek"</span>。FreeSeek 不做 API Key 鉴权。</p>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">快速验证</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">配置完成后，发一条消息测试：</p>
        <div class="ant-code-block"><button class="copy-btn" @click="copyCode">复制</button># 通过 OpenClaw 发送测试消息（Telegram / Discord / WhatsApp 均可）
# 或直接用 CLI 测试：
openclaw chat "你好，请介绍一下你自己"</div>
        <p style="margin-top:12px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
          如果一切正常，你应该能在 FreeSeek 的「运行日志」页面看到请求记录。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow-diagram {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-spotlight);
  border-radius: var(--radius);
  border: 1px solid var(--border-secondary);
  flex-wrap: wrap;
}
.flow-node {
  padding: 8px 16px;
  border-radius: var(--radius);
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  font-size: var(--font-size-sm);
  font-weight: 500;
  white-space: nowrap;
}
.flow-node.hl {
  background: var(--primary-bg);
  border-color: var(--primary-border);
  color: var(--primary);
}
.flow-arrow {
  color: var(--text-quaternary);
  font-size: 18px;
  font-weight: 300;
}

.checklist { display: flex; flex-direction: column; gap: 12px; }
.check-item { display: flex; gap: 12px; align-items: flex-start; }
.check-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.check-title { display: block; font-weight: 500; color: var(--text); margin-bottom: 2px; }
.check-desc { display: block; font-size: var(--font-size-sm); color: var(--text-tertiary); }

.step { display: flex; gap: 16px; margin-bottom: 24px; }
.step:last-child { margin-bottom: 0; }
.step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-size-sm); font-weight: 600; flex-shrink: 0;
}
.step-content { flex: 1; min-width: 0; }
.step-title { font-weight: 500; color: var(--text); margin-bottom: 8px; }

.tip-box {
  padding: 12px 16px;
  background: var(--primary-bg);
  border: 1px solid var(--primary-border);
  border-radius: var(--radius);
}
.tip-box p { color: var(--text-secondary) !important; font-size: var(--font-size-sm); }
.tip-title { font-weight: 600; color: var(--text); margin-bottom: 6px; }

.faq-item { margin-bottom: 16px; }
.faq-item:last-child { margin-bottom: 0; }
.faq-q { font-weight: 600; color: var(--text); margin-bottom: 4px; }
.faq-a { color: var(--text-secondary); font-size: var(--font-size); line-height: 1.6; }
</style>
