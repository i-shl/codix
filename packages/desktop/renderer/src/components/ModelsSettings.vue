<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import type {
  GlobalConfig,
  ProviderConfig,
  ProviderType,
  ModelConfig,
  DiscoveredModel,
  ModelTestResult,
} from '../api';
// 本文件模板里 `t` 已被 v-for 循环变量占用，i18n 函数用 `tr` 别名
import { t as tr } from '../i18n';

const emit = defineEmits<{ modelsChanged: [] }>();

// computed：语言切换时 hint 需要跟着变
const PROVIDER_TYPES = computed<Array<{ value: ProviderType; label: string; hint: string }>>(() => [
  {
    value: 'openai-compatible',
    label: 'OpenAI Compatible',
    hint: tr('ui.modelHintOpenai'),
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    hint: '/responses —— OpenAI Responses API',
  },
  { value: 'anthropic', label: 'Anthropic', hint: tr('ui.providerAnthropicHint') },
  { value: 'gemini', label: 'Google Gemini', hint: tr('ui.providerGeminiHint') },
]);

const TYPE_LABEL: Record<string, string> = {
  openai: 'OpenAI Compatible',
  'openai-compatible': 'OpenAI Compatible',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

/** 老配置里的 `openai` 等价于 `openai-compatible`，UI 只暴露后者 */
function normalizeType(t: ProviderType | undefined): ProviderType {
  return t === 'openai' || !t ? 'openai-compatible' : t;
}

/**
 * 深拷贝成纯对象。
 * Vue 的 reactive 是 Proxy，Electron IPC 的结构化克隆无法序列化 Proxy，
 * 直接传会抛 "An object could not be cloned"（这正是「能聊天但测试链接失败」的原因）。
 */
function plain<T>(v: T): T {
  return v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// ===================== 状态 =====================

const cfg = ref<GlobalConfig | null>(null);
const loading = ref(true);
const msg = ref('');
const msgType = ref<'success' | 'error' | ''>('');

/** 勾选的模型 key */
const selected = ref<Set<string>>(new Set());
/** 每个模型 key 的测试结果；'testing' 表示进行中 */
const testResults = reactive<Record<string, ModelTestResult | 'testing'>>({});
/** 折叠的供应商 id */
const collapsed = ref<Set<string>>(new Set());

const UNGROUPED = '__ungrouped__';

// ---- 供应商表单（新增 / 编辑） ----
const providerDialog = ref(false);
const providerEditingId = ref<string | null>(null);
const pForm = reactive({
  id: '',
  label: '',
  type: 'openai-compatible' as ProviderType,
  apiKey: '',
  baseURL: '',
});

// ---- 拉取模型列表 ----
const discoverFor = ref<string | null>(null);
const discoverLoading = ref(false);
const discoverError = ref('');
const discoverList = ref<DiscoveredModel[]>([]);
const discoverPicked = ref<Set<string>>(new Set());
const discoverFilter = ref('');

// ---- 手动输入 ----
const manualFor = ref<string | null>(null);
const manualText = ref('');

// ---- 待确认删除的供应商 ----
const pendingDelProvider = ref<string | null>(null);

// ===================== 派生 =====================

interface ModelRow {
  key: string;
  model: string;
  isDefault: boolean;
  hasOwnKey: boolean;
}
interface Group {
  id: string;
  label: string;
  type: ProviderType | '—';
  baseURL: string;
  hasKey: boolean;
  isReal: boolean;
  providerIds: string[];
  models: ModelRow[];
}

/** 已知 host → 友好供应商名 */
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

/** 由 baseURL 推导一个可读的供应商名（优先已知映射，否则取主机名） */
function hostLabel(url: string): string {
  if (!url) return tr('ui.providerDefault');
  try {
    const h = new URL(url).host;
    if (h === 'api.zai.cn') return tr('ui.hostLabelZhipu');
    if (KNOWN_HOSTS[h]) return KNOWN_HOSTS[h];
    return h.replace(/^api\./, '').split('.')[0] || h;
  } catch {
    return url;
  }
}

/** 模型实际请求的 baseURL（模型自身 > 所属供应商 > 协议默认） */
function effectiveBaseURL(m: ModelConfig, providers: Record<string, ProviderConfig>): string {
  if (m.baseURL) return m.baseURL;
  const p = m.providerId ? providers[m.providerId] : undefined;
  if (p?.baseURL) return p.baseURL;
  return DEFAULT_BASE_URLS[m.provider] || '';
}

/** 每个分组取一个代表供应商 id（用于「获取模型 / 编辑 / 删除」） */
function reprProvider(g: Group): string {
  return g.providerIds[0] ?? '';
}

const groups = computed<Group[]>(() => {
  const c = cfg.value;
  if (!c) return [];
  const providers = c.providers ?? {};
  const map = new Map<string, Group>();

  // 1) 供应商按 baseURL 建组（同一 baseURL 的不同供应商会合并到一组）
  for (const [pid, p] of Object.entries(providers)) {
    const url = p.baseURL || DEFAULT_BASE_URLS[p.type] || '';
    let g = map.get(url);
    if (!g) {
      g = {
        id: url || UNGROUPED,
        label: p.label?.trim() || hostLabel(url),
        type: p.type,
        baseURL: url,
        hasKey: !!p.apiKey,
        isReal: true,
        providerIds: [],
        models: [],
      };
      map.set(url, g);
    }
    g.providerIds.push(pid);
    if (p.label?.trim()) g.label = p.label.trim();
    if (p.apiKey) g.hasKey = true;
    if (g.type === '—') g.type = p.type;
  }

  // 2) 模型归入其有效 baseURL 对应的组
  for (const [key, m] of Object.entries(c.models ?? {})) {
    const url = effectiveBaseURL(m, providers);
    let g = map.get(url);
    if (!g) {
      g = {
        id: url || UNGROUPED,
        label: url ? hostLabel(url) : tr('ui.modelUncategorized'),
        type: m.provider,
        baseURL: url,
        hasKey: !!m.apiKey,
        isReal: !!m.providerId,
        providerIds: m.providerId ? [m.providerId] : [],
        models: [],
      };
      map.set(url, g);
    }
    g.models.push({
      key,
      model: m.model,
      isDefault: key === c.defaultModel,
      hasOwnKey: !!m.apiKey,
    });
  }

  const out = [...map.values()];
  for (const g of out) g.models.sort((a, b) => a.model.localeCompare(b.model));
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
});

const allKeys = computed(() => Object.keys(cfg.value?.models ?? {}));
const selectedCount = computed(() => selected.value.size);
const allSelected = computed(
  () => allKeys.value.length > 0 && selected.value.size === allKeys.value.length
);

const filteredDiscover = computed(() => {
  const f = discoverFilter.value.trim().toLowerCase();
  if (!f) return discoverList.value;
  return discoverList.value.filter((m) => m.id.toLowerCase().includes(f));
});

/** 当前供应商下已存在的模型 id 集合，用于在拉取列表中标记"已添加" */
const existingModelIds = computed(() => {
  const c = cfg.value;
  const pid = discoverFor.value;
  const s = new Set<string>();
  if (!c || !pid) return s;
  for (const m of Object.values(c.models ?? {})) {
    if (m.providerId === pid) s.add(m.model);
  }
  return s;
});

// ===================== 工具 =====================

function flash(text: string, type: 'success' | 'error' = 'success'): void {
  msg.value = text;
  msgType.value = type;
  window.setTimeout(() => {
    if (msg.value === text) {
      msg.value = '';
      msgType.value = '';
    }
  }, 3000);
}

function slug(s: string): string {
  return s
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const c = await window.voked.loadGlobalConfig();
    if (!c.models) c.models = {};
    if (!c.providers) c.providers = {};
    cfg.value = c;
    // 清理已不存在的选中项
    const keys = new Set(Object.keys(c.models));
    selected.value = new Set([...selected.value].filter((k) => keys.has(k)));
  } catch (e) {
    flash(tr('ui.loadFailed') + (e as Error).message, 'error');
  } finally {
    loading.value = false;
  }
}

/** 读取最新配置 → 变更 → 保存 → 回填。避免并发覆盖。 */
async function mutate(fn: (c: GlobalConfig) => void | string): Promise<void> {
  try {
    const c = await window.voked.loadGlobalConfig();
    if (!c.models) c.models = {};
    if (!c.providers) c.providers = {};
    const note = fn(c);
    // defaultModel 指向已删除的模型时兜底
    if (c.defaultModel && !c.models[c.defaultModel]) {
      c.defaultModel = Object.keys(c.models)[0];
    }
    if (!c.defaultModel) c.defaultModel = Object.keys(c.models)[0];
    await window.voked.saveGlobalConfig(plain(c));
    cfg.value = c;
    emit('modelsChanged');
    if (typeof note === 'string' && note) flash(note);
  } catch (e) {
    flash(tr('ui.saveFailed') + (e as Error).message, 'error');
  }
}

// ===================== 供应商 CRUD =====================

function openAddProvider(): void {
  providerEditingId.value = null;
  pForm.id = '';
  pForm.label = '';
  pForm.type = 'openai-compatible';
  pForm.apiKey = '';
  pForm.baseURL = '';
  providerDialog.value = true;
}

function openEditProvider(id: string): void {
  const p = cfg.value?.providers?.[id];
  if (!p) return;
  providerEditingId.value = id;
  pForm.id = id;
  pForm.label = p.label ?? '';
  pForm.type = normalizeType(p.type);
  pForm.apiKey = p.apiKey ?? '';
  pForm.baseURL = p.baseURL ?? '';
  providerDialog.value = true;
}

const providerIdPreview = computed(() => {
  if (providerEditingId.value) return providerEditingId.value;
  return slug(pForm.id || pForm.label) || 'provider';
});

async function submitProvider(): Promise<void> {
  const label = pForm.label.trim();
  if (!label) return;
  const editing = providerEditingId.value;
  const entry: ProviderConfig = {
    label,
    type: pForm.type,
    apiKey: pForm.apiKey.trim() || undefined,
    baseURL: pForm.baseURL.trim() || undefined,
  };
  await mutate((c) => {
    const providers = c.providers as Record<string, ProviderConfig>;
    if (editing) {
      providers[editing] = { ...providers[editing], ...entry };
      // 供应商协议变更时同步到旗下模型
      for (const m of Object.values(c.models)) {
        if (m.providerId === editing) m.provider = entry.type;
      }
      return tr('ui.providerUpdated');
    }
    const id = uniqueKey(slug(pForm.id || label) || 'provider', new Set(Object.keys(providers)));
    providers[id] = entry;
    return tr('ui.providerAdded');
  });
  providerDialog.value = false;
}

async function deleteProvider(id: string): Promise<void> {
  pendingDelProvider.value = null;
  await mutate((c) => {
    delete (c.providers as Record<string, ProviderConfig>)[id];
    let n = 0;
    for (const [k, m] of Object.entries(c.models)) {
      if (m.providerId === id) {
        delete c.models[k];
        selected.value.delete(k);
        n++;
      }
    }
    return tr('ui.providerDeletedModels', { n });
  });
}

// ===================== 拉取模型列表 =====================

/** 调用供应商的「列出模型」接口 */
async function fetchModels(pid: string): Promise<DiscoveredModel[]> {
  const p = cfg.value?.providers?.[pid];
  if (!p) throw new Error(tr('ui.providerNotFound'));
  return await window.voked.listProviderModels(
    plain({
      type: normalizeType(p.type),
      apiKey: p.apiKey,
      baseURL: p.baseURL,
      headers: p.headers,
    })
  );
}

async function openDiscover(pid: string): Promise<void> {
  if (!cfg.value?.providers?.[pid]) return;
  discoverFor.value = pid;
  discoverList.value = [];
  discoverPicked.value = new Set();
  discoverFilter.value = '';
  discoverError.value = '';
  discoverLoading.value = true;
  try {
    const list = await fetchModels(pid);
    discoverList.value = list;
    if (!list.length) discoverError.value = tr('ui.noModelsReturned');
  } catch (e) {
    discoverError.value = (e as Error).message;
  } finally {
    discoverLoading.value = false;
  }
}

/** 一键：拉取该供应商全部模型并直接添加（cherry-studio / cc-switch 的用法） */
const fetchingAll = ref<string | null>(null);

async function fetchAllModels(pid: string): Promise<void> {
  if (fetchingAll.value) return;
  fetchingAll.value = pid;
  try {
    const list = await fetchModels(pid);
    if (!list.length) {
      flash(tr('ui.noModelsReturned'), 'error');
      return;
    }
    await addModelIds(pid, list.map((m) => m.id));
  } catch (e) {
    flash(tr('ui.fetchModelsFailed') + (e as Error).message, 'error');
  } finally {
    fetchingAll.value = null;
  }
}

function toggleDiscoverPick(id: string): void {
  const s = new Set(discoverPicked.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  discoverPicked.value = s;
}

function pickAllDiscover(): void {
  const avail = filteredDiscover.value
    .filter((m) => !existingModelIds.value.has(m.id))
    .map((m) => m.id);
  const s = new Set(discoverPicked.value);
  const allIn = avail.length > 0 && avail.every((id) => s.has(id));
  for (const id of avail) {
    if (allIn) s.delete(id);
    else s.add(id);
  }
  discoverPicked.value = s;
}

async function addPickedModels(): Promise<void> {
  const pid = discoverFor.value;
  const picked = [...discoverPicked.value];
  if (!pid || !picked.length) return;
  await addModelIds(pid, picked);
  discoverFor.value = null;
}

/** 把一组模型 id 挂到指定供应商下 */
async function addModelIds(pid: string, ids: string[]): Promise<void> {
  await mutate((c) => {
    const p = (c.providers as Record<string, ProviderConfig>)[pid];
    if (!p) return tr('ui.providerNotFound');
    const taken = new Set(Object.keys(c.models));
    const exists = new Set(
      Object.values(c.models)
        .filter((m) => m.providerId === pid)
        .map((m) => m.model)
    );
    let n = 0;
    for (const raw of ids) {
      const id = raw.trim();
      if (!id || exists.has(id)) continue;
      const key = uniqueKey(`${pid}/${id}`, taken);
      taken.add(key);
      exists.add(id);
      c.models[key] = { provider: normalizeType(p.type), providerId: pid, model: id };
      n++;
    }
    return n ? tr('ui.modelsAdded', { n }) : tr('ui.modelsAddedNone');
  });
}

// ===================== 手动输入 =====================

function openManual(pid: string): void {
  manualFor.value = pid;
  manualText.value = '';
}

const manualParsed = computed(() =>
  manualText.value
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
);

async function submitManual(): Promise<void> {
  const pid = manualFor.value;
  if (!pid || !manualParsed.value.length) return;
  await addModelIds(pid, manualParsed.value);
  manualFor.value = null;
}

// ===================== 单模型操作 =====================

async function setDefault(key: string): Promise<void> {
  await mutate((c) => {
    c.defaultModel = key;
    return tr('ui.setDefault');
  });
}

// ---- 编辑单个模型（模型名 / 独立 Key / 独立 Base URL） ----
const modelDialog = ref(false);
const modelEditingKey = ref<string | null>(null);
const mForm = reactive({ model: '', apiKey: '', baseURL: '' });

function openEditModel(key: string): void {
  const m = cfg.value?.models?.[key];
  if (!m) return;
  modelEditingKey.value = key;
  mForm.model = m.model;
  mForm.apiKey = m.apiKey ?? '';
  mForm.baseURL = m.baseURL ?? '';
  modelDialog.value = true;
}

/** 编辑中的模型继承来的默认值，作为输入框 placeholder 展示 */
const inheritedFrom = computed(() => {
  const key = modelEditingKey.value;
  const c = cfg.value;
  if (!key || !c) return { baseURL: '', hasKey: false };
  const m = c.models[key];
  const p = m?.providerId ? c.providers?.[m.providerId] : undefined;
  return {
    baseURL: p?.baseURL || DEFAULT_BASE_URLS[normalizeType(m?.provider)] || '',
    hasKey: !!p?.apiKey,
  };
});

async function submitModel(): Promise<void> {
  const key = modelEditingKey.value;
  const name = mForm.model.trim();
  if (!key || !name) return;
  await mutate((c) => {
    const m = c.models[key];
    if (!m) return tr('ui.modelNotFound');
    m.model = name;
    m.apiKey = mForm.apiKey.trim() || undefined;
    m.baseURL = mForm.baseURL.trim() || undefined;
    return tr('ui.modelSaved');
  });
  delete testResults[key];
  modelDialog.value = false;
}

async function removeModel(key: string): Promise<void> {
  await mutate((c) => {
    delete c.models[key];
    selected.value.delete(key);
    delete testResults[key];
    return tr('ui.modelDeleted');
  });
}

async function testModel(key: string): Promise<void> {
  const c = cfg.value;
  const m = c?.models?.[key];
  if (!c || !m) return;
  testResults[key] = 'testing';
  try {
    testResults[key] = await window.voked.testModel(
      plain({ model: m, providers: c.providers })
    );
  } catch (e) {
    testResults[key] = { ok: false, latencyMs: 0, error: (e as Error).message };
  }
}

// ===================== 多选 & 批量 =====================

function toggleSelect(key: string): void {
  const s = new Set(selected.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  selected.value = s;
}

function toggleSelectAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(allKeys.value);
}

function toggleSelectGroup(g: Group): void {
  const keys = g.models.map((m) => m.key);
  const s = new Set(selected.value);
  const allIn = keys.length > 0 && keys.every((k) => s.has(k));
  for (const k of keys) {
    if (allIn) s.delete(k);
    else s.add(k);
  }
  selected.value = s;
}

function groupChecked(g: Group): boolean {
  return g.models.length > 0 && g.models.every((m) => selected.value.has(m.key));
}

function toggleCollapse(id: string): void {
  const s = new Set(collapsed.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  collapsed.value = s;
}

const batchTesting = ref(false);

async function batchTest(): Promise<void> {
  const keys = [...selected.value];
  if (!keys.length || batchTesting.value) return;
  batchTesting.value = true;
  try {
    // 限制并发，避免一次性打爆上游
    const CONCURRENCY = 4;
    let i = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      while (i < keys.length) {
        const k = keys[i++];
        await testModel(k);
      }
    });
    await Promise.all(workers);
    const okCount = keys.filter((k) => {
      const r = testResults[k];
      return r && r !== 'testing' && r.ok;
    }).length;
    flash(tr('ui.batchTestDone', { ok: okCount, total: keys.length }), okCount === keys.length ? 'success' : 'error');
  } finally {
    batchTesting.value = false;
  }
}

const pendingBatchDelete = ref(false);

async function batchDelete(): Promise<void> {
  const keys = [...selected.value];
  pendingBatchDelete.value = false;
  if (!keys.length) return;
  await mutate((c) => {
    for (const k of keys) {
      delete c.models[k];
      delete testResults[k];
    }
    return tr('ui.batchDeleted', { n: keys.length });
  });
  selected.value = new Set();
}

function resultOf(key: string): ModelTestResult | 'testing' | undefined {
  return testResults[key];
}

onMounted(load);

defineExpose({ reload: load });
</script>

<template>
  <div class="models-settings">
    <div class="ms-head">
      <div>
        <h2>{{ tr('ui.modelsTitle') }}</h2>
        <p class="muted">{{ tr('ui.modelsDesc') }}</p>
      </div>
      <button class="primary" @click="openAddProvider">{{ tr('ui.addProviderBtn') }}</button>
    </div>

    <!-- 批量操作条 -->
    <div class="ms-bulk" v-if="allKeys.length">
      <label class="chk">
        <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
        <span>{{ selectedCount ? tr('ui.selectedCount', { n: selectedCount }) : tr('ui.selectAll') }}</span>
      </label>
      <div class="spacer"></div>
      <template v-if="selectedCount">
        <button :disabled="batchTesting" @click="batchTest">
          {{ batchTesting ? tr('ui.batchTesting') : tr('ui.batchTest') }}
        </button>
        <template v-if="!pendingBatchDelete">
          <button class="danger" @click="pendingBatchDelete = true">{{ tr('ui.batchDelete') }}</button>
        </template>
        <template v-else>
          <span class="confirm-text">{{ tr('ui.batchDeleteConfirm', { n: selectedCount }) }}</span>
          <button class="danger" @click="batchDelete">{{ tr('ui.confirm') }}</button>
          <button class="text" @click="pendingBatchDelete = false">{{ tr('ui.cancel') }}</button>
        </template>
      </template>
      <span v-if="msg" :class="['msg', msgType]">{{ msg }}</span>
    </div>
    <div v-else-if="msg" :class="['msg', msgType, 'standalone']">{{ msg }}</div>

    <div v-if="loading" class="muted">{{ tr('ui.loading') }}</div>
    <div v-else-if="!groups.length" class="empty-box">
      {{ tr('ui.providersEmpty') }}
    </div>

    <!-- 供应商分组 -->
    <div v-for="g in groups" :key="g.id" class="provider-card">
      <div class="pc-head">
        <label class="chk" v-if="g.models.length">
          <input type="checkbox" :checked="groupChecked(g)" @change="toggleSelectGroup(g)" />
        </label>
        <button
          class="pc-toggle"
          :title="collapsed.has(g.id) ? tr('ui.expand') : tr('ui.collapse')"
          @click="toggleCollapse(g.id)"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"
            :style="{ transform: collapsed.has(g.id) ? 'rotate(-90deg)' : 'none', transition: 'transform .12s' }">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div class="pc-title">
          <strong>{{ g.label }}</strong>
          <span class="pc-meta">
            <span class="tag ghost">{{ TYPE_LABEL[g.type] ?? g.type }}</span>
            <span class="count">{{ tr('ui.modelCount', { n: g.models.length }) }}</span>
            <span v-if="g.isReal && !g.hasKey" class="tag warn">{{ tr('ui.tagNoKey') }}</span>
          </span>
          <div v-if="g.baseURL" class="pc-url">{{ g.baseURL }}</div>
        </div>
        <div class="pc-actions" v-if="g.isReal">
          <button
            class="primary"
            :disabled="!g.providerIds.length || !!fetchingAll"
            :title="tr('ui.getAllModelsTip')"
            @click="fetchAllModels(reprProvider(g))"
          >
            {{ fetchingAll === reprProvider(g) ? tr('ui.fetching') : tr('ui.getAllModels') }}
          </button>
          <button :disabled="!g.providerIds.length" @click="openDiscover(reprProvider(g))">{{ tr('ui.pickModels') }}</button>
          <button :disabled="!g.providerIds.length" @click="openManual(reprProvider(g))">{{ tr('ui.manualAdd') }}</button>
          <button :disabled="!g.providerIds.length" @click="openEditProvider(reprProvider(g))">{{ tr('ui.edit') }}</button>
          <template v-if="pendingDelProvider !== g.id">
            <button class="danger" :disabled="!g.providerIds.length" @click="pendingDelProvider = g.id">{{ tr('ui.delete') }}</button>
          </template>
          <template v-else>
            <span class="confirm-text">{{ tr('ui.delProviderConfirm', { n: g.models.length }) }}</span>
            <button class="danger" @click="deleteProvider(g.id)">{{ tr('ui.confirm') }}</button>
            <button class="text" @click="pendingDelProvider = null">{{ tr('ui.cancel') }}</button>
          </template>
        </div>
        <div class="pc-actions" v-else>
          <span class="muted small">{{ tr('ui.uncategorizedHint') }}</span>
        </div>
      </div>

      <div class="pc-body" v-show="!collapsed.has(g.id)">
        <div v-if="!g.models.length" class="muted small pad">{{ tr('ui.modelsEmpty') }}</div>
        <div v-for="m in g.models" :key="m.key" class="model-row">
          <label class="chk">
            <input type="checkbox" :checked="selected.has(m.key)" @change="toggleSelect(m.key)" />
          </label>
          <div class="mr-name">
            <span class="mid">{{ m.model }}</span>
            <span v-if="m.isDefault" class="tag primary">{{ tr('ui.tagDefault') }}</span>
            <span v-if="m.hasOwnKey" class="tag ghost">{{ tr('ui.tagOwnKey') }}</span>
            <span class="mkey">{{ m.key }}</span>
          </div>
          <div class="mr-result">
            <span v-if="resultOf(m.key) === 'testing'" class="tag ghost">{{ tr('ui.tagTesting') }}</span>
            <template v-else-if="resultOf(m.key)">
              <span
                v-if="(resultOf(m.key) as any).ok"
                class="tag ok"
                :title="(resultOf(m.key) as any).sample || ''"
              >{{ tr('ui.tagOk', { ms: (resultOf(m.key) as any).latencyMs }) }}</span>
              <span v-else class="tag err" :title="(resultOf(m.key) as any).error || ''">
                {{ tr('ui.tagFail', { msg: ((resultOf(m.key) as any).error || '').slice(0, 40) }) }}
              </span>
            </template>
          </div>
          <div class="mr-actions">
            <button v-if="!m.isDefault" @click="setDefault(m.key)">{{ tr('ui.setDefaultBtn') }}</button>
            <button @click="testModel(m.key)" :disabled="resultOf(m.key) === 'testing'">{{ tr('ui.testLink') }}</button>
            <button @click="openEditModel(m.key)">{{ tr('ui.edit') }}</button>
            <button class="danger" @click="removeModel(m.key)">{{ tr('ui.deleteModel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 供应商弹窗 -->
    <div v-if="providerDialog" class="ms-mask" @click.self="providerDialog = false">
      <div class="ms-dialog">
        <h3>{{ providerEditingId ? tr('ui.editProvider') : tr('ui.addProvider') }}</h3>
        <div class="form-grid">
          <label>{{ tr('ui.name') }}
            <input v-model="pForm.label" :placeholder="tr('ui.providerLabelPlaceholder')" @keydown.enter="submitProvider" />
          </label>
          <label>{{ tr('ui.protocolType') }}
            <select v-model="pForm.type">
              <option v-for="t in PROVIDER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
            <span class="muted small">{{ PROVIDER_TYPES.find(t => t.value === pForm.type)?.hint }}</span>
          </label>
          <label>{{ tr('ui.apiKey') }}
            <input v-model="pForm.apiKey" type="text" autocomplete="off" spellcheck="false" placeholder="sk-..." />
          </label>
          <label>{{ tr('ui.baseURL') }}
            <input v-model="pForm.baseURL" spellcheck="false" :placeholder="DEFAULT_BASE_URLS[pForm.type] || 'https://api.deepseek.com/v1'" />
          </label>
        </div>
        <p class="muted small">{{ tr('ui.providerIdPreview') }}<code>{{ providerIdPreview }}</code>{{ tr('ui.providerIdSuffix') }}</p>
        <div class="ms-dialog-actions">
          <button class="primary" :disabled="!pForm.label.trim()" @click="submitProvider">
            {{ providerEditingId ? tr('ui.save') : tr('ui.add') }}
          </button>
          <button class="text" @click="providerDialog = false">{{ tr('ui.cancel') }}</button>
        </div>
      </div>
    </div>

    <!-- 编辑单个模型 -->
    <div v-if="modelDialog" class="ms-mask" @click.self="modelDialog = false">
      <div class="ms-dialog">
        <h3>{{ tr('ui.editModelTitle') }}</h3>
        <div class="form-grid">
          <label>{{ tr('ui.modelNameLabel') }}
            <input v-model="mForm.model" spellcheck="false" :placeholder="tr('ui.modelPlaceholder')" @keydown.enter="submitModel" />
          </label>
          <label>{{ tr('ui.ownKeyLabel') }}
            <input
              v-model="mForm.apiKey"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :placeholder="inheritedFrom.hasKey ? tr('ui.inheritKey') : tr('ui.providerNoKey')"
            />
          </label>
          <label>{{ tr('ui.ownBaseURLLabel') }}
            <input v-model="mForm.baseURL" spellcheck="false" :placeholder="inheritedFrom.baseURL || tr('ui.inheritBaseURL')" />
          </label>
        </div>
        <p class="muted small">{{ tr('ui.modelKeyLabel') }}<code>{{ modelEditingKey }}</code></p>
        <div class="ms-dialog-actions">
          <button class="primary" :disabled="!mForm.model.trim()" @click="submitModel">{{ tr('ui.save') }}</button>
          <button class="text" @click="modelDialog = false">{{ tr('ui.cancel') }}</button>
        </div>
      </div>
    </div>

    <!-- 拉取模型弹窗 -->
    <div v-if="discoverFor" class="ms-mask" @click.self="discoverFor = null">
      <div class="ms-dialog wide">
        <h3>{{ tr('ui.discoverTitle') }}</h3>
        <div v-if="discoverLoading" class="muted pad">{{ tr('ui.discoverLoading') }}</div>
        <div v-else-if="discoverError" class="msg error pad">{{ discoverError }}</div>
        <template v-else>
          <div class="dv-bar">
            <input v-model="discoverFilter" :placeholder="tr('ui.searchModels')" class="dv-search" />
            <button @click="pickAllDiscover">{{ tr('ui.selectAllToggle') }}</button>
            <span class="muted small">{{ tr('ui.discoverCount', { total: filteredDiscover.length, picked: discoverPicked.size }) }}</span>
          </div>
          <div class="dv-list">
            <label
              v-for="m in filteredDiscover"
              :key="m.id"
              :class="['dv-item', { disabled: existingModelIds.has(m.id) }]"
            >
              <input
                type="checkbox"
                :disabled="existingModelIds.has(m.id)"
                :checked="discoverPicked.has(m.id)"
                @change="toggleDiscoverPick(m.id)"
              />
              <span class="dv-id">{{ m.id }}</span>
              <span v-if="m.detail" class="muted small">{{ m.detail }}</span>
              <span v-if="existingModelIds.has(m.id)" class="tag ghost">{{ tr('ui.tagAdded') }}</span>
            </label>
          </div>
        </template>
        <div class="ms-dialog-actions">
          <button class="primary" :disabled="!discoverPicked.size" @click="addPickedModels">
            {{ tr('ui.addSelected', { n: discoverPicked.size }) }}
          </button>
          <button class="text" @click="discoverFor = null">{{ tr('ui.close') }}</button>
        </div>
      </div>
    </div>

    <!-- 手动添加弹窗 -->
    <div v-if="manualFor" class="ms-mask" @click.self="manualFor = null">
      <div class="ms-dialog">
        <h3>{{ tr('ui.manualTitle') }}</h3>
        <p class="muted small">{{ tr('ui.manualHint') }}</p>
        <textarea
          v-model="manualText"
          class="ms-textarea"
          placeholder="deepseek-chat,deepseek-reasoner"
        ></textarea>
        <p class="muted small" v-if="manualParsed.length">{{ tr('ui.manualPreview', { n: manualParsed.length, list: manualParsed.join(' · ') }) }}</p>
        <div class="ms-dialog-actions">
          <button class="primary" :disabled="!manualParsed.length" @click="submitManual">{{ tr('ui.add') }}</button>
          <button class="text" @click="manualFor = null">{{ tr('ui.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.models-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ms-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.ms-head h2 {
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 600;
}
.ms-head p {
  margin: 0;
  font-size: 12px;
}
.muted {
  color: var(--text-tertiary);
}
.small {
  font-size: 12px;
}
.pad {
  padding: 10px 12px;
}
.spacer {
  flex: 1;
}

.ms-bulk {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-spotlight);
  font-size: 12px;
  flex-wrap: wrap;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.chk input {
  cursor: pointer;
  margin: 0;
  accent-color: var(--brand);
}
.confirm-text {
  color: var(--error);
  font-size: 12px;
}

.empty-box {
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}

/* ---- 供应商卡片 ---- */
.provider-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-container);
  overflow: hidden;
}
.pc-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-spotlight);
  border-bottom: 1px solid var(--border);
}
.pc-toggle {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  margin-top: 2px;
}
.pc-title {
  flex: 1;
  min-width: 0;
}
.pc-title strong {
  font-size: 13px;
}
.pc-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}
.pc-meta .count {
  font-size: 11px;
  color: var(--text-tertiary);
}
.pc-url {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.pc-body {
  display: flex;
  flex-direction: column;
}

/* ---- 模型行 ---- */
.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-secondary, var(--border));
}
.model-row:last-child {
  border-bottom: none;
}
.model-row:hover {
  background: var(--bg-hover);
}
.mr-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mid {
  font-size: 13px;
  font-weight: 500;
}
.mkey {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
}
.mr-result {
  flex-shrink: 0;
  min-width: 0;
}
.mr-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ---- 标签 ---- */
.tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  white-space: nowrap;
}
.tag.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-tertiary);
}
.tag.primary {
  background: var(--brand-soft);
  color: var(--brand);
}
.tag.ok {
  background: rgba(82, 196, 26, 0.14);
  color: var(--success);
}
.tag.err {
  background: rgba(255, 77, 79, 0.12);
  color: var(--error);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag.warn {
  background: rgba(250, 173, 20, 0.15);
  color: #d48806;
}

/* ---- 弹窗 ---- */
.ms-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.ms-dialog {
  background: var(--bg-container);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  width: 460px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.ms-dialog.wide {
  width: 620px;
}
.ms-dialog h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}
.ms-dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  align-items: center;
}
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.ms-textarea {
  width: 100%;
  min-height: 90px;
  resize: vertical;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

/* ---- 拉取列表 ---- */
.dv-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.dv-search {
  flex: 1;
}
.dv-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 44vh;
  overflow: auto;
}
.dv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-secondary, var(--border));
}
.dv-item:last-child {
  border-bottom: none;
}
.dv-item:hover {
  background: var(--bg-hover);
}
.dv-item.disabled {
  opacity: 0.55;
  cursor: default;
}
.dv-id {
  flex: 1;
  font-family: var(--font-mono, monospace);
}
.dv-item input {
  accent-color: var(--brand);
  margin: 0;
}

.msg.standalone {
  padding: 6px 0;
}
.msg.success {
  color: var(--success);
}
.msg.error {
  color: var(--error);
}
</style>
