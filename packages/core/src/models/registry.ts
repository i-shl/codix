/**
 * 模型注册表 - 根据 provider 创建适配器
 */
import type { ModelAdapter, ModelConfig, ModelProvider } from '../types/model.js';
import { createAnthropic } from './anthropic.js';
import { createGemini } from './gemini.js';
import { createOpenAICompatible } from './openai.js';
import { createOpenAIResponses } from './openaiResponses.js';

export function createAdapter(config: ModelConfig): ModelAdapter {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic(config);
    case 'gemini':
      return createGemini(config);
    case 'openai-responses':
      return createOpenAIResponses(config);
    case 'openai':
    case 'openai-compatible':
      return createOpenAICompatible(config);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${config.provider as string}`);
    }
  }
}

export function inferProvider(model: string): ModelProvider {
  const m = model.toLowerCase();
  if (m.startsWith('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.startsWith('gemini')) return 'gemini';
  return 'openai-compatible';
}