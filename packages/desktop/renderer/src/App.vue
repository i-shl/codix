<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted } from 'vue';
import type { Session, Message, Tab, ContentPart } from './types';
import type { GlobalConfig } from './api';
import { t, setLang } from './i18n';
import { useTurnQueue } from './useTurnQueue';
import Sidebar from './components/Sidebar.vue';
import ChatView from './components/ChatView.vue';
import SkillsView from './components/SkillsView.vue';
import McpView from './components/McpView.vue';
import RulesView from './components/RulesView.vue';
import SettingsView from './components/SettingsView.vue';
import ModelsSettings from './components/ModelsSettings.vue';
import Composer from './components/Composer.vue';
import PermissionModal from './components/PermissionModal.vue';
import ModelPickerModal from './components/ModelPickerModal.vue';

const cwd = ref<string>('');
const homeDir = ref<string>('');
const sessions = ref<Session[]>([]);
const currentSession = ref<Session | null>(null);
const messages = ref<Message[]>([]);
const streamingText = ref<string>('');
const streamingThinking = ref<string>('');
const streamingTools = ref<Array<{ id: string; name: string; input: unknown; result?: unknown }>>([]);
const tab = ref<Tab>('chat');
type SettingsSection = 'general' | 'models' | 'skills' | 'mcp' | 'rules';
const settingsSection = ref<SettingsSection>('general');
const pendingAsk = ref<{ id: string; req: unknown } | null>(null);
const lastError = ref<string>('');
const showError = ref(false);
let errorTimer: ReturnType<typeof setTimeout> | null = null;
function flashError(msg: string): void {
  lastError.value = msg;
  showError.value = true;
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { showError.value = false; }, 5000);
}
const theme = ref<'light' | 'dark'>('light');
const availableModels = ref<Array<{
  key: string;
  model: string;
  provider: string;
  providerId: string;
  providerLabel: string;
  baseURL: string;
  isCurrent: boolean;
}>>([]);
const showModelPicker = ref(false);
const sidebarCollapsed = ref(false);
/** 当前正在跑的那一轮属于哪个会话；用于拦截旧会话的流式事件串到新会话屏幕上 */
const activeRunSessionId = ref<string | null>(null);
const editing = ref<{ id: string; text: string } | null>(null);

interface PendingInput {
  text?: string;
  images?: { mediaType: string; data: string }[];
  files?: { fileName: string; mediaType: string; data: string }[];
  /** 重新运行某一轮：user 消息 id（编辑重发可带上新文本） */
  rerun?: { userMessageId: string; text?: string };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function textOfContent(c: Message['content']): string {
  if (typeof c === 'string') return c;
  return c.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

function buildUserMessage(input: PendingInput): Message {
  if (input.images?.length || input.files?.length) {
    const parts: ContentPart[] = [];
    if (input.text) parts.push({ type: 'text', text: input.text });
    for (const im of input.images ?? []) {
      parts.push({ type: 'image', source: { type: 'base64', mediaType: im.mediaType, data: im.data } });
    }
    for (const f of input.files ?? []) {
      parts.push({ type: 'file', fileName: f.fileName, mediaType: f.mediaType, data: f.data });
    }
    return { id: 'local-' + Date.now(), role: 'user', content: parts };
  }
  return { id: 'local-' + Date.now(), role: 'user', content: input.text ?? '' };
}

watch(theme, (v) => {
  document.documentElement.dataset.theme = v;
  localStorage.setItem('voked:theme', v);
}, { immediate: true });

async function refreshSessions(): Promise<void> {
  if (!cwd.value) return;
  sessions.value = (await window.voked.listSessions(cwd.value)) as Session[];
}

async function createNewSession(title?: string): Promise<void> {
  if (!cwd.value) return;
  const s = (await window.voked.createSession({ cwd: cwd.value, title })) as Session;
  await refreshSessions();
  await loadSession(s.id);
}

/** 切换会话：只清掉本地显示瞬态，但【不中止】后台正在跑的轮次。
 * 这样切走再切回来时，旧会话的回复会在后台继续跑完并落盘，回来时完整保留；
 * activeRunSessionId 保持不变，切回原会话时 onEvent 守卫会重新放行流式事件。 */
function clear(): void {
  streamingText.value = '';
  streamingThinking.value = '';
  streamingTools.value = [];
  editing.value = null;
}

async function loadSession(id: string): Promise<void> {
  if (!cwd.value) return;
  const s = (await window.voked.loadSession(id)) as Session & { messages: Message[] };
  if (s) {
    currentSession.value = {
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      model: s.model,
      createdAt: s.createdAt ?? Date.now(),
      updatedAt: s.updatedAt ?? Date.now(),
      messageCount: s.messages?.length ?? 0,
    };
    messages.value = s.messages ?? [];
    tab.value = 'chat';
  }
}

async function deleteSession(id: string): Promise<void> {
  await window.voked.deleteSession(id);
  if (currentSession.value?.id === id) {
    currentSession.value = null;
    messages.value = [];
  }
  await refreshSessions();
}

/** 一轮结束后把会话从磁盘重新载入，拿到完整（含落盘）的消息列表 */
async function afterTurn(): Promise<void> {
  const cs = currentSession.value;
  if (!cs) return;
  try {
    const s = (await window.voked.loadSession(cs.id)) as Session & { messages: Message[] };
    messages.value = s.messages ?? [];
    currentSession.value = {
      ...cs,
      messageCount: s.messages?.length ?? 0,
      updatedAt: s.updatedAt ?? Date.now(),
    };
  } catch { /* 忽略：下一轮 / 下次刷新会纠正 */ }
  await refreshSessions();
}

/** 还没有会话时先建一个；返回 false 则丢弃这条消息 */
async function ensureSession(): Promise<boolean> {
  if (currentSession.value) return true;
  if (!cwd.value) return false;
  const s = (await window.voked.createSession({ cwd: cwd.value })) as Session;
  await refreshSessions();
  await loadSession(s.id);
  return true;
}

async function runTurn(input: PendingInput): Promise<void> {
  const cs = currentSession.value;
  if (!cs) return;
  const sid = cs.id;
  // 进入循环时置 busy；切换会话会把它强制清掉，这里按「轮」重新点亮
  activeRunSessionId.value = sid;
  streamingText.value = '';
  streamingThinking.value = '';
  streamingTools.value = [];
  try {
    if (input.rerun) {
      // 编辑重发 / 重新回复：本地先截断到该 user 消息，再让 core 重跑覆盖旧回复
      const idx = messages.value.findIndex((m) => m.id === input.rerun!.userMessageId);
      if (idx >= 0) {
        const kept = messages.value.slice(0, idx + 1).map((m) => ({ ...m }));
        if (input.rerun!.text !== undefined) kept[idx].content = input.rerun!.text as Message['content'];
        messages.value = kept;
      }
      await window.voked.rerunTurn({
        cwd: cwd.value,
        sessionId: sid,
        userMessageId: input.rerun!.userMessageId,
        text: input.rerun!.text,
      });
    } else {
      if (input.text || input.images?.length || input.files?.length) {
        messages.value = [...messages.value, buildUserMessage(input)];
      }
      await window.voked.run({ cwd: cwd.value, sessionId: sid, userInput: input });
    }
    await afterTurn();
  } finally {
    activeRunSessionId.value = null;
  }
}

const { queue, busy, send: sendTurn, cancel: cancelQueued } = useTurnQueue<PendingInput>({
  runTurn,
  before: ensureSession,
  onError: (e) => flashError(t('ui.error') + errMsg(e)),
});

async function onComposerSend(input: PendingInput): Promise<void> {
  await sendTurn(input);
}

/** 流式事件：只接受「当前正在跑的那一轮」对应的会话，避免旧会话串屏 */
function onEvent(e: unknown): void {
  if (!e || typeof e !== 'object') return;
  const ev = e as { type: string; text?: string; id?: string; name?: string; input?: unknown; result?: unknown };
  if (activeRunSessionId.value === null) return;
  switch (ev.type) {
    case 'text_delta':
      streamingText.value += ev.text ?? '';
      break;
    case 'thinking_delta':
      streamingThinking.value += ev.text ?? '';
      break;
    case 'tool_start':
      streamingTools.value.push({ id: ev.id ?? '', name: ev.name ?? '', input: undefined });
      break;
    case 'tool_end': {
      const t = streamingTools.value.find((x) => x.id === ev.id);
      if (t) t.input = ev.input;
      break;
    }
    case 'tool_result': {
      const t = streamingTools.value.find((x) => x.id === ev.id);
      if (t) t.result = ev.result;
      break;
    }
    default:
      break;
  }
}

function onAsk(req: unknown): void {
  pendingAsk.value = { id: 'ask-' + Date.now(), req };
}

function onPermissionChoice(choice: 'allow' | 'deny' | 'allowAll'): void {
  pendingAsk.value = null;
  window.voked.respondAsk(choice);
}

function editMessage(msg: Message): void {
  editing.value = { id: msg.id, text: textOfContent(msg.content) };
  tab.value = 'chat';
}

async function regenerate(msg: Message): Promise<void> {
  if (!currentSession.value) return;
  // 找到这条 AI 回复之前最近的一条 user 消息，从它开始重跑
  const idx = messages.value.findIndex((m) => m.id === msg.id);
  let userIdx = -1;
  for (let i = idx; i >= 0; i--) {
    if (messages.value[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return;
  const userMsg = messages.value[userIdx];
  await sendTurn({ rerun: { userMessageId: userMsg.id } });
}

function clearEditing(): void {
  editing.value = null;
}

function toggleTheme(): void {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
}

async function refreshModelList(): Promise<void> {
  try {
    const cfg = (await window.voked.loadGlobalConfig()) as GlobalConfig;
    const models = cfg.models ?? {};
    const defaultKey = cfg.defaultModel ?? '';
    availableModels.value = Object.entries(models).map(([key, m]) => ({
      key,
      model: m.model,
      provider: m.provider,
      providerId: m.providerId ?? '',
      providerLabel: cfg.providers?.[m.providerId ?? '']?.label ?? '',
      baseURL: m.baseURL ?? (cfg.providers?.[m.providerId ?? '']?.baseURL ?? ''),
      isCurrent: key === defaultKey,
    }));
  } catch {
    availableModels.value = [];
  }
}

async function pickModel(key: string): Promise<void> {
  showModelPicker.value = false;
  try {
    const cfg = (await window.voked.loadGlobalConfig()) as GlobalConfig;
    cfg.defaultModel = key;
    await window.voked.saveGlobalConfig(cfg);
    await refreshModelList();
  } catch (e) {
    flashError(t('ui.modelSwitchFailed') + errMsg(e));
  }
}

onMounted(async () => {
  // 语言：优先读 localStorage（切换后立即生效、无需等 IPC），再回退到全局配置
  setLang(localStorage.getItem('voked:lang') ?? 'zh');
  try {
    homeDir.value = await window.voked.homeDir();
  } catch { /* ignore */ }
  const stored = localStorage.getItem('voked:cwd');
  cwd.value = stored ?? homeDir.value ?? '';
  if (!localStorage.getItem('voked:lang')) {
    try {
      const cfg = (await window.voked.loadGlobalConfig()) as GlobalConfig;
      const l = (cfg.ui as { language?: string } | undefined)?.language;
      if (l) setLang(l);
    } catch { /* 配置读不到就用默认中文 */ }
  }
  await refreshModelList();
  await refreshSessions();
  const offEvent = window.voked.onEvent(onEvent);
  const offAsk = window.voked.onAsk(onAsk);
  onUnmounted(() => {
    offEvent();
    offAsk();
  });
});
</script>

<template>
  <div class="layout" :class="{ 'sidebar-hidden': sidebarCollapsed }">
    <Sidebar
      v-if="!sidebarCollapsed"
      :sessions="sessions"
      :current-session="currentSession"
      :tab="tab"
      @select-session="loadSession"
      @delete-session="deleteSession"
      @new-session="() => createNewSession()"
      @open-settings="tab = 'settings'"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
    />
    <div class="main">
      <button
        v-if="sidebarCollapsed"
        class="icon-btn-32 sidebar-expand"
        :title="t('ui.expandSidebar')"
        @click="sidebarCollapsed = false"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div class="main-card">
        <ChatView
          v-if="tab === 'chat'"
          :messages="messages"
          :streaming-text="streamingText"
          :streaming-thinking="streamingThinking"
          :streaming-tools="streamingTools"
          :busy="busy"
          :current-session="currentSession"
          @edit="editMessage"
          @regenerate="regenerate"
        />
        <div v-else-if="tab === 'settings'" class="settings-layout">
          <div class="settings-rail">
            <button :class="{ active: settingsSection === 'general' }" @click="settingsSection = 'general'">{{ t('nav.general') }}</button>
            <button :class="{ active: settingsSection === 'models' }" @click="settingsSection = 'models'">{{ t('nav.models') }}</button>
            <button :class="{ active: settingsSection === 'skills' }" @click="settingsSection = 'skills'">{{ t('nav.skills') }}</button>
            <button :class="{ active: settingsSection === 'mcp' }" @click="settingsSection = 'mcp'">{{ t('nav.mcp') }}</button>
            <button :class="{ active: settingsSection === 'rules' }" @click="settingsSection = 'rules'">{{ t('nav.rules') }}</button>
          </div>
          <div class="settings-content">
            <SettingsView
              v-if="settingsSection === 'general'"
              :theme="theme"
              @toggle-theme="toggleTheme"
            />
            <ModelsSettings v-else-if="settingsSection === 'models'" @models-changed="refreshModelList" />
            <SkillsView v-else-if="settingsSection === 'skills'" :cwd="cwd" />
            <McpView v-else-if="settingsSection === 'mcp'" :cwd="cwd" />
            <RulesView v-else-if="settingsSection === 'rules'" :cwd="cwd" />
          </div>
        </div>
        <div v-if="queue.length" class="queue-strip">
          <div class="queue-label">
            <span class="queue-dot"></span>
            <span>{{ t('ui.queueCount', { n: queue.length }) }}</span>
          </div>
          <div class="queue-list">
            <div v-for="(q, i) in queue" :key="i" class="queue-item">
              <span class="qi-text">{{ (q.text ?? t('ui.emptyMessage')).slice(0, 60) }}{{ (q.text ?? '').length > 60 ? '…' : '' }}</span>
              <span v-if="q.images?.length || q.files?.length" class="qi-meta">{{ t('ui.attachmentCount', { n: (q.images?.length ?? 0) + (q.files?.length ?? 0) }) }}</span>
              <button class="qi-x" @click="cancelQueued(i)" :title="t('ui.remove')">×</button>
            </div>
          </div>
        </div>
        <Composer
          v-if="tab === 'chat'"
          :busy="busy"
          :has-session="!!currentSession"
          :cwd="cwd"
          :editing="editing"
          :current-model="availableModels.find(m => m.isCurrent)?.key ?? ''"
          :available-models="availableModels"
          @send="onComposerSend"
          @cancel-edit="clearEditing"
          @pick-model="(key) => pickModel(key)"
          @toggle-model-picker="showModelPicker = !showModelPicker"
        />
      </div>
    </div>
    <div v-if="showError" class="err-toast" @click="showError = false">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>{{ lastError }}</span>
    </div>
    <ModelPickerModal
      v-if="showModelPicker"
      :models="availableModels"
      @choose="pickModel"
      @close="showModelPicker = false"
    />
    <PermissionModal
      v-if="pendingAsk"
      :req="pendingAsk.req"
      @choice="onPermissionChoice"
    />
  </div>
</template>
