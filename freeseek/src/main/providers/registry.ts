import type { Provider, ModelInfo } from "./types";
import { DeepSeekProvider } from "./deepseek";
import { ClaudeProvider } from "./claude";
import { QwenProvider } from "./qwen";

/**
 * Provider 注册中心
 *
 * 管理所有已注册的 AI 厂商 Provider。
 * 新增厂商只需：
 * 1. 实现 Provider 接口
 * 2. 在此处 register
 */
class ProviderRegistry {
  private providers = new Map<string, Provider>();

  /** 注册一个 Provider */
  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      console.warn(`[Registry] Provider "${provider.id}" 已存在，将被覆盖`);
    }
    this.providers.set(provider.id, provider);
    console.log(`[Registry] 已注册 Provider: ${provider.name} (${provider.id})`);
  }

  /** 根据模型 ID 查找对应的 Provider */
  resolve(model: string): Provider | null {
    for (const provider of this.providers.values()) {
      if (provider.matchModel(model)) return provider;
    }
    return null;
  }

  /** 获取指定 Provider */
  get(id: string): Provider | null {
    return this.providers.get(id) || null;
  }

  /** 获取所有已注册的 Provider */
  all(): Provider[] {
    return Array.from(this.providers.values());
  }

  /** 获取所有可用模型（只列出有凭证的厂商） */
  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      const creds = provider.loadCredentials();
      if (creds) {
        models.push(...provider.getModels());
      }
    }
    return models;
  }

  /** 获取所有模型（不管有没有凭证，DeepSeek 始终显示） */
  getAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      // DeepSeek 始终显示，其他厂商需要有凭证
      if (provider.id === "deepseek") {
        models.push(...provider.getModels());
      } else {
        const creds = provider.loadCredentials();
        if (creds) {
          models.push(...provider.getModels());
        }
      }
    }
    return models;
  }

  /** 重置所有 Provider 的客户端状态 */
  resetAll(): void {
    for (const provider of this.providers.values()) {
      provider.resetClient();
    }
  }
}

// 全局单例
export const registry = new ProviderRegistry();

// 注册内置 Provider
registry.register(new DeepSeekProvider());
registry.register(new ClaudeProvider());
registry.register(new QwenProvider());
