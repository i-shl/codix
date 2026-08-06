<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { GlobalConfig, McpServerConfig } from '../api';
import { t } from '../i18n';

const props = defineProps<{ cwd: string }>();

interface McpStatus {
  name: string;
  connected: boolean;
  error?: string;
  tools: string[];
  resources: string[];
  prompts: string[];
}

const servers = ref<McpServerConfig[]>([]);
const status = ref<Record<string, McpStatus>>({});
const loading = ref(false);
const testing = ref(false);
const msg = ref('');
const msgType = ref<'success' | 'error' | ''>('');

const pendingDelete = ref<string | null>(null);

// ---- 代码块编辑 ----
const dialog = ref(false);
const editingName = ref<string | null>(null);
const code = ref('');
const editError = ref('');

const TEMPLATE = `{
  "name": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
  "env": {},
  "enabled": true,
  "autoConnect": true
}`;

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

/** 校验并规范化一个 MCP 服务器 JSON 对象 */
function parseServer(text: string): McpServerConfig {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(t('ui.mcp.jsonParseFailed') + (e as Error).message);
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error(t('ui.mcp.topMustObject'));
  }
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new Error(t('ui.mcp.missingName'));
  }
  obj.name = obj.name.trim();
  const transport = obj.transport ?? 'stdio';
  if (!['stdio', 'sse', 'http'].includes(transport)) {
    throw new Error(t('ui.mcp.badTransport', { t: String(transport) }));
  }
  obj.transport = transport;
  if (transport === 'stdio') {
    if (typeof obj.command !== 'string' || !obj.command.trim()) {
      throw new Error(t('ui.mcp.stdioNeedsCommand'));
    }
    if (obj.args !== undefined && !Array.isArray(obj.args)) {
      throw new Error(t('ui.mcp.argsMustArray'));
    }
  } else {
    if (typeof obj.url !== 'string' || !obj.url.trim()) {
      throw new Error(t('ui.mcp.sseNeedsUrl'));
    }
  }
  if (obj.env !== undefined && (typeof obj.env !== 'object' || obj.env === null || Array.isArray(obj.env))) {
    throw new Error(t('ui.mcp.envMustObject'));
  }
  if (obj.headers !== undefined && (typeof obj.headers !== 'object' || obj.headers === null || Array.isArray(obj.headers))) {
    throw new Error(t('ui.mcp.headersMustObject'));
  }
  if (obj.enabled !== undefined) obj.enabled = !!obj.enabled;
  if (obj.autoConnect !== undefined) obj.autoConnect = !!obj.autoConnect;
  // 丢弃空串字段，保持配置干净
  const clean: Record<string, unknown> = { name: obj.name, transport: obj.transport };
  for (const k of ['command', 'args', 'url', 'cwd', 'env', 'headers']) {
    if (obj[k] !== undefined && obj[k] !== '' && !(Array.isArray(obj[k]) && obj[k].length === 0)) clean[k] = obj[k];
  }
  if (obj.enabled !== undefined) clean.enabled = obj.enabled;
  if (obj.autoConnect !== undefined) clean.autoConnect = obj.autoConnect;
  return clean as unknown as McpServerConfig;
}

async function loadConfig(): Promise<void> {
  loading.value = true;
  try {
    const cfg = await window.voked.loadGlobalConfig();
    servers.value = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
  } catch (e) {
    flash(t('ui.loadFailed') + (e as Error).message, 'error');
    servers.value = [];
  } finally {
    loading.value = false;
  }
}

async function mutate(fn: (list: McpServerConfig[]) => string | void): Promise<void> {
  try {
    const cfg = (await window.voked.loadGlobalConfig()) as GlobalConfig;
    const list = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
    const note = fn(list);
    cfg.mcpServers = list;
    await window.voked.saveGlobalConfig(cfg);
    servers.value = list;
    if (typeof note === 'string' && note) flash(note);
  } catch (e) {
    flash(t('ui.saveFailed') + (e as Error).message, 'error');
  }
}

/** 实际连接一次，拿工具列表 */
async function testConnections(): Promise<void> {
  if (!props.cwd || testing.value) return;
  testing.value = true;
  try {
    const list = (await window.voked.listMcp(props.cwd)) as McpStatus[];
    const map: Record<string, McpStatus> = {};
    for (const s of list) map[s.name] = s;
    status.value = map;
    const ok = list.filter((s) => s.connected).length;
    flash(t('ui.mcp.testDone', { ok, total: list.length }), ok === list.length ? 'success' : 'error');
  } catch (e) {
    flash(t('ui.mcp.connectFailed') + (e as Error).message, 'error');
  } finally {
    testing.value = false;
  }
}

function openAdd(): void {
  editingName.value = null;
  code.value = TEMPLATE;
  editError.value = '';
  dialog.value = true;
}

function openEdit(s: McpServerConfig): void {
  editingName.value = s.name;
  code.value = JSON.stringify(s, null, 2);
  editError.value = '';
  dialog.value = true;
}

function formatCode(): void {
  try {
    code.value = JSON.stringify(JSON.parse(code.value), null, 2);
    editError.value = '';
  } catch (e) {
    editError.value = (e as Error).message;
  }
}

function insertTab(e: Event): void {
  const el = e.target as HTMLTextAreaElement;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  code.value = code.value.slice(0, start) + '  ' + code.value.slice(end);
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + 2;
  });
}

async function submit(): Promise<void> {
  let entry: McpServerConfig;
  try {
    entry = parseServer(code.value);
  } catch (e) {
    editError.value = (e as Error).message;
    return;
  }
  editError.value = '';
  const name = entry.name;
  const prev = editingName.value;
  if (servers.value.some((x) => x.name === name && x.name !== prev)) {
    editError.value = t('ui.mcp.dupName', { name });
    return;
  }

  await mutate((list) => {
    const idx = prev ? list.findIndex((x) => x.name === prev) : -1;
    if (idx >= 0) {
      list[idx] = entry;
      return t('ui.mcp.updated');
    }
    list.push(entry);
    return t('ui.mcp.added');
  });
  dialog.value = false;
}

async function remove(name: string): Promise<void> {
  pendingDelete.value = null;
  await mutate((list) => {
    const i = list.findIndex((x) => x.name === name);
    if (i >= 0) list.splice(i, 1);
    delete status.value[name];
    return t('ui.mcp.deleted') + name;
  });
}

async function toggleEnabled(s: McpServerConfig): Promise<void> {
  await mutate((list) => {
    const target = list.find((x) => x.name === s.name);
    if (target) target.enabled = target.enabled === false;
    return target?.enabled === false
      ? t('ui.mcp.disabled', { name: s.name })
      : t('ui.mcp.enabled', { name: s.name });
  });
}

function summary(s: McpServerConfig): string {
  if (s.transport === 'stdio') {
    return [s.command, ...(s.args ?? [])].filter(Boolean).join(' ');
  }
  return s.url ?? '';
}

onMounted(() => {
  void loadConfig();
});
</script>

<template>
  <div class="settings mcp-view">
    <div class="mv-head">
      <div>
        <h2>{{ t('ui.mcp.title') }}</h2>
        <p class="muted">{{ t('ui.mcp.desc') }}<code>~/.voked/config.json</code></p>
      </div>
      <div class="mv-head-actions">
        <button :disabled="testing || !servers.length" @click="testConnections">
          {{ testing ? t('ui.mcp.testing') : t('ui.mcp.testConnect') }}
        </button>
        <button class="primary" @click="openAdd">+ {{ t('ui.add') }}</button>
      </div>
    </div>

    <div v-if="msg" :class="['msg', msgType]">{{ msg }}</div>

    <div v-if="loading" class="muted">{{ t('ui.loading') }}</div>

    <div v-else-if="!servers.length" class="empty-box">
      {{ t('ui.mcp.emptyHint') }}
      <code>npx -y @modelcontextprotocol/server-filesystem .</code>
    </div>

    <div v-else class="mv-list">
      <div v-for="s in servers" :key="s.name" class="mv-row">
        <div class="mv-main">
          <div class="mv-title">
            <strong>{{ s.name }}</strong>
            <span class="tag ghost">{{ s.transport }}</span>
            <span v-if="s.enabled === false" class="tag warn">{{ t('ui.mcp.tagDisabled') }}</span>
            <template v-else-if="status[s.name]">
              <span v-if="status[s.name].connected" class="tag ok">
                {{ t('ui.mcp.connectedTools', { n: status[s.name].tools.length }) }}
              </span>
              <span v-else class="tag err" :title="status[s.name].error || ''">{{ t('ui.mcp.tagConnFailed') }}</span>
            </template>
          </div>
          <div class="mv-cmd">{{ summary(s) }}</div>
          <div
            v-if="status[s.name] && !status[s.name].connected && status[s.name].error"
            class="mv-err"
          >
            {{ status[s.name].error }}
          </div>
          <div
            v-else-if="status[s.name]?.connected && status[s.name].tools.length"
            class="mv-tools"
          >
            {{ status[s.name].tools.slice(0, 8).join(' · ') }}
            <span v-if="status[s.name].tools.length > 8">
              {{ t('ui.mcp.andMore', { n: status[s.name].tools.length }) }}
            </span>
          </div>
        </div>
        <div class="mv-actions">
          <button @click="toggleEnabled(s)">{{ s.enabled === false ? t('ui.mcp.enable') : t('ui.mcp.disable') }}</button>
          <button @click="openEdit(s)">{{ t('ui.edit') }}</button>
          <template v-if="pendingDelete !== s.name">
            <button class="danger" @click="pendingDelete = s.name">{{ t('ui.delete') }}</button>
          </template>
          <template v-else>
            <span class="confirm-text">{{ t('ui.confirmDelete') }}</span>
            <button class="danger" @click="remove(s.name)">{{ t('ui.confirm') }}</button>
            <button class="text" @click="pendingDelete = null">{{ t('ui.cancel') }}</button>
          </template>
        </div>
      </div>
    </div>

    <!-- 弹窗 -->
    <div v-if="dialog" class="mv-mask" @click.self="dialog = false">
      <div class="mv-dialog">
        <h3>{{ editingName ? t('ui.mcp.editTitle') : t('ui.mcp.addTitle') }}</h3>
        <p class="muted small">{{ t('ui.mcp.dialogHint') }}</p>
        <textarea
          v-model="code"
          class="code-editor"
          spellcheck="false"
          :placeholder="TEMPLATE"
          @keydown.tab.prevent="insertTab"
        ></textarea>
        <div v-if="editError" class="mv-err">{{ editError }}</div>
        <div class="mv-dialog-actions">
          <button class="text" @click="formatCode">{{ t('ui.mcp.format') }}</button>
          <div class="spacer"></div>
          <button class="primary" @click="submit">
            {{ editingName ? t('ui.mcp.save') : t('ui.mcp.add') }}
          </button>
          <button class="text" @click="dialog = false">{{ t('ui.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.mv-head h2 {
  margin: 0 0 2px;
}
.mv-head p {
  margin: 0;
  font-size: 12px;
}
.mv-head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.muted {
  color: var(--text-tertiary);
}
.empty-box {
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1.8;
}
.mv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mv-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-container);
}
.mv-main {
  flex: 1;
  min-width: 0;
}
.mv-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mv-cmd {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  margin-top: 3px;
  word-break: break-all;
}
.mv-err {
  font-size: 12px;
  color: var(--error);
  margin-top: 4px;
}
.mv-tools {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
.mv-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.confirm-text {
  font-size: 12px;
  color: var(--error);
}

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
.tag.ok {
  background: rgba(82, 196, 26, 0.14);
  color: var(--success);
}
.tag.err {
  background: rgba(255, 77, 79, 0.12);
  color: var(--error);
}
.tag.warn {
  background: rgba(250, 173, 20, 0.15);
  color: #d48806;
}

.mv-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.mv-dialog {
  background: var(--bg-container);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  width: 480px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.mv-dialog h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
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
.form-grid label.inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.form-grid label.inline input {
  margin: 0;
  accent-color: var(--brand);
}
.kv {
  min-height: 64px;
  resize: vertical;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.code-editor {
  width: 100%;
  min-height: 280px;
  max-height: 56vh;
  resize: vertical;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  line-height: 1.55;
  tab-size: 2;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-spotlight);
  color: var(--text-primary);
  white-space: pre;
  overflow: auto;
}
.code-editor:focus {
  outline: none;
  border-color: var(--brand);
}
.mv-dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  align-items: center;
}
.spacer {
  flex: 1;
}
.msg.success {
  color: var(--success);
}
.msg.error {
  color: var(--error);
}
</style>
