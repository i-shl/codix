<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { t } from '../i18n';

interface ModelOption {
  key: string;
  model: string;
  provider: string;
  providerId?: string;
  providerLabel?: string;
  baseURL?: string;
  isCurrent: boolean;
}

const props = defineProps<{ models: ModelOption[] }>();
const emit = defineEmits<{
  choose: [key: string];
  close: [];
}>();

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  openai: 'OpenAI Compatible',
  'openai-compatible': 'OpenAI Compatible',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  gemini: 'Google Gemini',
};

const KNOWN_HOSTS: Record<string, string> = {
  'api.openai.com': 'OpenAI',
  'api.anthropic.com': 'Anthropic',
  'generativelanguage.googleapis.com': 'Google Gemini',
  'api.deepseek.com': 'DeepSeek',
  'api.groq.com': 'Groq',
  'api.moonshot.cn': 'Moonshot',
  'api.together.xyz': 'Together',
  'openrouter.ai': 'OpenRouter',
  'api.x.ai': 'xAI',
};

function hostLabel(url?: string): string {
  if (!url) return t('ui.providerDefault');
  try {
    if (new URL(url).host === 'api.zai.cn') return t('ui.hostLabelZhipu');
  } catch { /* 交给下面的通用分支 */ }
  try {
    const h = new URL(url).host;
    if (KNOWN_HOSTS[h]) return KNOWN_HOSTS[h];
    return h.replace(/^api\./, '').split('.')[0] || h;
  } catch {
    return url;
  }
}

const filter = ref('');
const cursor = ref(0);
const listEl = ref<HTMLElement | null>(null);

/** 按「实际请求的 baseURL」分组供应商（与设置页一致） */
function groupIdOf(m: ModelOption): string {
  return m.baseURL || m.providerId || `type:${m.provider}`;
}
function groupLabelOf(m: ModelOption): string {
  if (m.providerLabel) return m.providerLabel;
  if (m.baseURL) return hostLabel(m.baseURL);
  if (m.providerId) return m.providerId;
  return PROVIDER_TYPE_LABEL[m.provider] ?? m.provider;
}

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase();
  if (!f) return props.models;
  return props.models.filter(
    (m) =>
      m.key.toLowerCase().includes(f) ||
      m.model.toLowerCase().includes(f) ||
      groupLabelOf(m).toLowerCase().includes(f)
  );
});

/** 按供应商分组；每组内当前模型置顶 */
const grouped = computed<Array<{ id: string; label: string; type: string; items: ModelOption[] }>>(() => {
  const buckets = new Map<string, { id: string; label: string; type: string; items: ModelOption[] }>();
  for (const m of filtered.value) {
    const id = groupIdOf(m);
    let b = buckets.get(id);
    if (!b) {
      b = { id, label: groupLabelOf(m), type: m.provider, items: [] };
      buckets.set(id, b);
    }
    b.items.push(m);
  }
  const out = [...buckets.values()];
  for (const g of out) {
    g.items.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.model.localeCompare(b.model);
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
});

/** 扁平顺序，用于 ↑↓ 导航 */
const flat = computed(() => grouped.value.flatMap((g) => g.items));

function clampCursor(): void {
  const n = flat.value.length;
  if (!n) {
    cursor.value = 0;
    return;
  }
  if (cursor.value >= n) cursor.value = n - 1;
  if (cursor.value < 0) cursor.value = 0;
}

function move(delta: number): void {
  const n = flat.value.length;
  if (!n) return;
  cursor.value = (cursor.value + delta + n) % n;
  void nextTick(() => {
    listEl.value?.querySelector('.modal-item.cursor')?.scrollIntoView({ block: 'nearest' });
  });
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    clampCursor();
    const m = flat.value[cursor.value];
    if (m) emit('choose', m.key);
  }
}

function isCursor(m: ModelOption): boolean {
  return flat.value[cursor.value]?.key === m.key;
}

onMounted(() => {
  const i = props.models.findIndex((m) => m.isCurrent);
  cursor.value = i >= 0 ? flat.value.findIndex((m) => m.isCurrent) : 0;
  if (cursor.value < 0) cursor.value = 0;
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-title">
        {{ t('model.pickerTitle') }}
        <button class="modal-x" @click="emit('close')">×</button>
      </div>
      <div class="modal-search">
        <input
          v-model="filter"
          :placeholder="t('ui.model.searchPlaceholder')"
          autofocus
          @input="cursor = 0"
        />
        <span class="hint">{{ t('model.pickerHint') }}</span>
      </div>
      <div class="modal-list" ref="listEl">
        <div v-if="!models.length" class="empty">{{ t('model.pickerEmpty') }}</div>
        <div v-else-if="!flat.length" class="empty">{{ t('model.pickerNoMatch', { q: filter }) }}</div>
        <div v-for="g in grouped" :key="g.id" class="group">
          <div class="group-title">
            <span>{{ g.label }}</span>
            <span class="group-count">{{ g.items.length }}</span>
          </div>
          <div v-if="g.id" class="group-url">{{ g.id }}</div>
          <div
            v-for="m in g.items"
            :key="m.key"
            :class="['modal-item', { current: m.isCurrent, cursor: isCursor(m) }]"
            @click="emit('choose', m.key)"
            @mouseenter="cursor = flat.findIndex(x => x.key === m.key)"
          >
            <span :class="['item-dot', m.isCurrent ? 'active' : '']"></span>
            <div class="item-body">
              <div class="item-key">{{ m.model }}</div>
              <div class="item-model">{{ m.key }}</div>
            </div>
            <span v-if="m.isCurrent" class="item-tag">{{ t('model.currentTag') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  z-index: 50;
}
.modal-card {
  background: var(--bg-elevated, #fff);
  color: var(--text-primary);
  border-radius: 8px;
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px rgba(0,0,0,0.2);
  width: 520px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.modal-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 14px;
}
.modal-x {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-tertiary);
}
.modal-list {
  overflow-y: auto;
  padding: 4px;
}
.modal-list .group {
  padding: 4px 0;
}
.modal-list .group + .group {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 8px;
}
.modal-list .group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  padding: 6px 12px 4px;
}
.modal-list .group-count {
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.modal-list .group-url {
  font-size: 10.5px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  padding: 0 12px 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.modal-search input {
  flex: 1;
  min-width: 0;
}
.modal-search .hint {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.modal-item.cursor {
  background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  outline: 1px solid var(--brand);
  outline-offset: -1px;
}
.modal-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.modal-item:hover {
  background: var(--bg-hover, rgba(0,0,0,0.04));
}
.modal-item.current {
  background: var(--brand-soft, #e6f4ff);
}
.item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--text-tertiary, #999);
  background: transparent;
  flex-shrink: 0;
}
.item-dot.active {
  background: var(--brand, #1677ff);
  border-color: var(--brand, #1677ff);
}
.item-body {
  flex: 1;
  min-width: 0;
}
.item-key {
  font-weight: 500;
  font-size: 13px;
}
.item-model {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  font-family: var(--font-mono, monospace);
}
.item-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--brand, #1677ff);
  color: white;
  border-radius: 4px;
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}
</style>
