/**
 * 桌面端 i18n —— 在 `@voked/core/i18n` 之上包一层 Vue 响应式。
 *
 * core 的 `t()` 是纯函数，Vue 模板无法感知语言切换，所以这里用一个 ref
 * 做「版本号」：切换语言时 bump 一次，所有引用 `t()` 的计算属性/模板随之重算。
 */
import { ref, computed } from 'vue';
import {
  t as coreT,
  setLang as coreSetLang,
  getLang as coreGetLang,
  type Lang,
} from '@voked/core/i18n';

export type { Lang };

/** 语言版本号：仅用于触发 Vue 重新渲染。 */
const langRef = ref<Lang>(coreGetLang());

/** 响应式翻译函数：模板里直接 `t('ui.settings')`。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  // 读一次 langRef 建立依赖，保证语言切换时模板重算。
  void langRef.value;
  return coreT(key, vars);
}

/** 切换语言（同时同步给 core，供非 Vue 代码使用）。 */
export function setLang(lang: Lang | string | null | undefined): void {
  const next: Lang = lang === 'en' ? 'en' : 'zh';
  coreSetLang(next);
  langRef.value = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
  }
}

/** 当前语言（响应式）。 */
export const lang = computed<Lang>(() => langRef.value);

/** 当前语言对应的 BCP-47 locale，用于日期/数字格式化。 */
export const locale = computed(() => (langRef.value === 'en' ? 'en-US' : 'zh-CN'));

/** 组合式入口，便于在 `<script setup>` 中一次性取用。 */
export function useI18n() {
  return { t, setLang, lang, locale };
}
