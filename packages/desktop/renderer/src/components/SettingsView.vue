<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { GlobalConfig as Config } from '../api';
import { t, setLang, lang, type Lang } from '../i18n';

defineProps<{ theme: 'light' | 'dark' }>();
const emit = defineEmits<{
  toggleTheme: [];
}>();

// ===== 语言 =====
/** 切换界面语言：立刻生效 + 落 localStorage，再异步写入全局配置供 CLI 复用。 */
async function pickLang(next: Lang): Promise<void> {
  if (lang.value === next) return;
  setLang(next);
  localStorage.setItem('codix:lang', next);
  try {
    const global = (await window.codix.loadGlobalConfig()) as Config;
    const ui = (global.ui ?? {}) as Record<string, unknown>;
    ui.language = next;
    global.ui = ui;
    await window.codix.saveGlobalConfig(global);
  } catch {
    // 写配置失败不影响界面语言，localStorage 已经记住选择
  }
}

// ===== 配置 JSON =====
const cfg = ref<Config | null>(null);
const jsonText = ref('');
const saving = ref(false);
const msg = ref('');
const msgType = ref<'success' | 'error' | ''>('');
const readOnly = ref(true);
const showAdvanced = ref(false);

async function loadMergedView(): Promise<void> {
  try {
    const merged = (await window.codix.loadConfig('.')) as Config;
    cfg.value = merged;
    jsonText.value = JSON.stringify(merged, null, 2);
    readOnly.value = true;
  } catch (e) {
    msg.value = t('ui.loadFailed') + (e as Error).message;
    msgType.value = 'error';
  }
}

async function loadGlobal(): Promise<void> {
  try {
    const global = (await window.codix.loadGlobalConfig()) as Config;
    cfg.value = global;
    jsonText.value = JSON.stringify(global, null, 2);
    readOnly.value = false;
  } catch (e) {
    msg.value = t('ui.loadFailed') + (e as Error).message;
    msgType.value = 'error';
  }
}

async function save(): Promise<void> {
  if (readOnly.value) return;
  saving.value = true;
  msg.value = '';
  msgType.value = '';
  try {
    const parsed = JSON.parse(jsonText.value) as Config;
    await window.codix.saveGlobalConfig(parsed);
    msg.value = t('ui.saved');
    msgType.value = 'success';
    cfg.value = parsed;
  } catch (e) {
    msg.value = t('ui.jsonParseFailed') + (e as Error).message;
    msgType.value = 'error';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadMergedView();
});
</script>

<template>
  <div class="settings">
    <!-- 语言 -->
    <div class="settings-section">
      <h2>{{ t('settings.language') }}</h2>
      <div class="theme-row">
        <div class="theme-label">
          <strong>{{ t('settings.language') }}</strong>
          <span class="muted">{{ t('settings.languageHint') }}</span>
        </div>
        <div class="theme-toggle">
          <button :class="{ active: lang === 'zh' }" @click="pickLang('zh')">
            <span>{{ t('settings.language.zh') }}</span>
          </button>
          <button :class="{ active: lang === 'en' }" @click="pickLang('en')">
            <span>{{ t('settings.language.en') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 外观 -->
    <div class="settings-section">
      <h2>{{ t('ui.appearance') }}</h2>
      <div class="theme-row">
        <div class="theme-label">
          <strong>{{ t('ui.themeMode') }}</strong>
          <span class="muted">{{ theme === 'light' ? t('ui.themeLight') : t('ui.themeDark') }}</span>
        </div>
        <div class="theme-toggle">
          <button :class="{ active: theme === 'light' }" @click="theme === 'dark' && emit('toggleTheme')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            <span>{{ t('ui.themeLightBtn') }}</span>
          </button>
          <button :class="{ active: theme === 'dark' }" @click="theme === 'light' && emit('toggleTheme')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            <span>{{ t('ui.themeDarkBtn') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 高级：原始配置 JSON -->
    <div class="settings-section">
      <div class="adv-head">
        <h2>{{ t('ui.advanced') }}</h2>
        <button class="text" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? t('ui.hideRawConfig') : t('ui.showRawConfig') }}
        </button>
      </div>
      <template v-if="showAdvanced">
        <div v-if="readOnly" class="banner">
          {{ t('ui.mergedWarn') }}<strong>{{ t('ui.mergedWarnStrong') }}</strong>{{ t('ui.mergedWarnTail') }}
        </div>
        <textarea
          v-model="jsonText"
          :readonly="readOnly"
          class="json-editor"
          :style="readOnly ? { background: 'var(--bg-spotlight)', color: 'var(--text-secondary)' } : {}"
        />
        <div class="actions-row">
          <button class="primary" :disabled="saving || readOnly" @click="save">
            {{ saving ? t('ui.saving') : t('ui.saveGlobal') }}
          </button>
          <button @click="loadGlobal" v-if="readOnly">{{ t('ui.editGlobal') }}</button>
          <button @click="loadMergedView" v-else>{{ t('ui.viewMerged') }}</button>
          <button class="text" @click="loadMergedView">{{ t('ui.refresh') }}</button>
          <span v-if="msg" :class="['msg', msgType]">{{ msg }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.adv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.adv-head h2 {
  margin: 0;
}
.sec-desc {
  margin: -4px 0 10px;
  font-size: 12px;
}
.mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: auto;
  min-height: 46px;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-container);
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.mode-card:hover {
  background: var(--bg-hover);
  color: inherit;
  border-color: var(--border);
}
.mode-card.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}
.mode-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.mode-text strong {
  font-size: 13px;
}
.mode-text .muted {
  font-size: 12px;
}
.mode-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary);
}
.mode-dot.mode-default {
  background: var(--brand);
}
.mode-dot.mode-strict {
  background: var(--error);
}
.mode-dot.mode-auto {
  background: var(--success);
}
</style>
