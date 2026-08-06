<script setup lang="ts">
/**
 * MarkdownView - 使用 markstream-vue 渲染 AI 回复的 markdown
 *
 * 为什么用 markstream-vue 而不是自研解析器：
 *   - 自带 streaming 增量解析（`final` 标志），符合 AI 流式输出场景
 *   - 内置 Shiki 代码高亮、Mermaid 图、KaTeX 公式
 *   - 维护活跃（3000+ commits），跟得上前沿 markdown 语法
 *   - 自动适配深色/浅色主题
 */
import { computed, ref, onMounted, onUnmounted } from 'vue';
import MarkdownRender from 'markstream-vue';
import 'markstream-vue/index.css';

const props = defineProps<{ source: string; streaming?: boolean }>();

const isFinal = computed(() => !props.streaming);
const isDark = ref(document.documentElement.dataset.theme === 'dark');
const obs = new MutationObserver(() => {
  isDark.value = document.documentElement.dataset.theme === 'dark';
});
onMounted(() => obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }));
onUnmounted(() => obs.disconnect());
</script>

<template>
  <div class="md-wrap">
    <MarkdownRender
      mode="chat"
      :content="source || ''"
      :final="isFinal"
      :max-live-nodes="0"
      :typewriter="false"
      :is-dark="isDark"
    />
  </div>
</template>

<style scoped>
.md-wrap {
  font-size: var(--fs-md, 14px);
  line-height: 1.6;
  color: var(--text-primary);
  word-wrap: break-word;
}
</style>