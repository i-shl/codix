<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { DefaultSkill } from '../api';
import { t } from '../i18n';

const props = defineProps<{ cwd: string }>();

interface Skill {
  manifest: { name: string; version: string; description: string };
  path: string;
  enabled: boolean;
}

const skills = ref<Skill[]>([]);
const recommended = ref<DefaultSkill[]>([]);
const installSource = ref('');
const installing = ref('');
const loading = ref(true);
const msg = ref('');
const msgType = ref<'success' | 'error' | ''>('');
const pendingDelete = ref<string | null>(null);

const installedNames = computed(() => new Set(skills.value.map((s) => s.manifest.name)));

function flash(text: string, type: 'success' | 'error' = 'success'): void {
  msg.value = text;
  msgType.value = type;
  window.setTimeout(() => {
    if (msg.value === text) {
      msg.value = '';
      msgType.value = '';
    }
  }, 4000);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    skills.value = (await window.voked.listSkills(props.cwd || '.')) as Skill[];
  } catch {
    skills.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadRecommended(): Promise<void> {
  try {
    recommended.value = await window.voked.defaultSkills();
  } catch {
    recommended.value = [];
  }
}

async function install(source: string, tag = source): Promise<void> {
  if (!source.trim() || installing.value) return;
  installing.value = tag;
  msg.value = '';
  msgType.value = '';
  try {
    const dest = await window.voked.installSkill({ source: source.trim(), cwd: props.cwd });
    flash(t('ui.skillInstalled') + dest);
    if (tag === '__manual__') installSource.value = '';
    await refresh();
  } catch (e) {
    flash(t('ui.skillInstallFailed') + (e as Error).message, 'error');
  } finally {
    installing.value = '';
  }
}

async function uninstall(name: string): Promise<void> {
  pendingDelete.value = null;
  try {
    await window.voked.uninstallSkill({ name, cwd: props.cwd });
    flash(t('ui.skillUninstalled') + name);
    await refresh();
  } catch (e) {
    flash(t('ui.skillUninstallFailed') + (e as Error).message, 'error');
  }
}

function openExternal(url: string): void {
  void window.voked.openExternal(url);
}

function openPath(p: string): void {
  void window.voked.openPath(p);
}

onMounted(() => {
  void refresh();
  void loadRecommended();
});
</script>

<template>
  <div class="settings skills-view">
    <div class="sv-head">
      <div>
        <h2>{{ t('ui.skillsTitle') }}</h2>
        <p class="muted">{{ t('ui.skillsDescPre') }}<code>SKILL.md</code>{{ t('ui.skillsDescMid') }}<code>manifest.json</code>{{ t('ui.skillsDescPost') }}</p>
      </div>
      <button class="text" :disabled="loading" @click="refresh">{{ t('ui.refresh') }}</button>
    </div>

    <div v-if="msg" :class="['msg', msgType]">{{ msg }}</div>

    <!-- 推荐 -->
    <section v-if="recommended.length" class="sv-section">
      <h3>{{ t('ui.skillRecommended') }}</h3>
      <div class="sv-list">
        <div v-for="r in recommended" :key="r.name" class="sv-row">
          <div class="sv-main">
            <div class="sv-title">
              <strong>{{ r.label }}</strong>
              <span v-if="installedNames.has(r.name)" class="tag ok">{{ t('ui.skillTagInstalled') }}</span>
              <span v-else class="tag ghost">{{ t('ui.skillRecommended') }}</span>
            </div>
            <div class="sv-desc">{{ r.description }}</div>
            <a class="sv-src" href="#" @click.prevent="openExternal(r.source)">{{ r.source }}</a>
          </div>
          <div class="sv-actions">
            <button
              v-if="!installedNames.has(r.name)"
              class="primary"
              :disabled="!!installing"
              @click="install(r.source, r.name)"
            >
              {{ installing === r.name ? t('ui.skillInstalling') : t('ui.skillOneClick') }}
            </button>
            <span v-else class="muted small">{{ t('ui.skillAlreadyListed') }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 已安装 -->
    <section class="sv-section">
      <h3>{{ t('ui.skillInstalledCount', { n: skills.length }) }}</h3>
      <div v-if="loading" class="muted">{{ t('ui.loading') }}</div>
      <div v-else-if="!skills.length" class="empty-box">
        {{ t('ui.skillsEmpty') }}
      </div>
      <div v-else class="sv-list">
        <div v-for="s in skills" :key="s.manifest.name" class="sv-row">
          <div class="sv-main">
            <div class="sv-title">
              <strong>{{ s.manifest.name }}</strong>
              <span class="tag ghost">v{{ s.manifest.version }}</span>
              <span v-if="!s.enabled" class="tag warn">{{ t('ui.skillTagDisabled') }}</span>
            </div>
            <div class="sv-desc">{{ s.manifest.description }}</div>
            <div class="sv-src">{{ s.path }}</div>
          </div>
          <div class="sv-actions">
            <button @click="openPath(s.path)">{{ t('ui.skillOpenDir') }}</button>
            <template v-if="pendingDelete !== s.manifest.name">
              <button class="danger" @click="pendingDelete = s.manifest.name">{{ t('ui.skillUninstall') }}</button>
            </template>
            <template v-else>
              <span class="confirm-text">{{ t('ui.skillConfirmDelDir') }}</span>
              <button class="danger" @click="uninstall(s.manifest.name)">{{ t('ui.confirm') }}</button>
              <button class="text" @click="pendingDelete = null">{{ t('ui.cancel') }}</button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <!-- 手动安装 -->
    <section class="sv-section">
      <h3>{{ t('ui.skillFromSource') }}</h3>
      <div class="field">
        <input
          v-model="installSource"
          placeholder="https://www.skills.sh/owner/repo/skill · github.com/owner/repo · npm:pkg · git:url · local:./dir"
          :disabled="!!installing"
          @keydown.enter="install(installSource, '__manual__')"
        />
        <div class="hint">
          {{ t('ui.skillSourceHintPre') }}<code>npm:</code>、<code>git:</code>、<code>tarball:</code>、<code>local:</code>{{ t('ui.skillSourceHintPost') }}
        </div>
      </div>
      <div class="actions-row">
        <button
          class="primary"
          :disabled="!!installing || !installSource.trim()"
          @click="install(installSource, '__manual__')"
        >
          {{ installing === '__manual__' ? t('ui.skillInstalling') : t('ui.skillInstall') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.sv-head h2 {
  margin: 0 0 2px;
}
.sv-head p {
  margin: 0;
  font-size: 12px;
}
.sv-section {
  margin-top: 18px;
}
.sv-section h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.muted {
  color: var(--text-tertiary);
}
.small {
  font-size: 12px;
}
.empty-box {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.sv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sv-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-container);
}
.sv-main {
  flex: 1;
  min-width: 0;
}
.sv-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.sv-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
  line-height: 1.6;
}
.sv-src {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono, monospace);
  margin-top: 4px;
  word-break: break-all;
  text-decoration: none;
}
a.sv-src:hover {
  color: var(--brand);
  text-decoration: underline;
}
.sv-actions {
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
.tag.warn {
  background: rgba(250, 173, 20, 0.15);
  color: #d48806;
}
.msg.success {
  color: var(--success);
}
.msg.error {
  color: var(--error);
}
</style>
