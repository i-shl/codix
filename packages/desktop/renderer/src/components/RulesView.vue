<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { t } from '../i18n';

const props = defineProps<{ cwd: string }>();

const content = ref('');
const rulePath = ref('~/.voked/rules.md');
const loading = ref(true);
const saving = ref(false);
const msg = ref('');
const msgType = ref<'success' | 'error' | ''>('');

async function load(): Promise<void> {
  loading.value = true;
  msg.value = '';
  msgType.value = '';
  try {
    content.value = await window.voked.readRules({ cwd: props.cwd, scope: 'global' });
  } catch (e) {
    content.value = '';
    msg.value = t('ui.loadFailed') + (e as Error).message;
    msgType.value = 'error';
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  msg.value = '';
  msgType.value = '';
  try {
    rulePath.value = await window.voked.writeRules({
      cwd: props.cwd,
      content: content.value,
      scope: 'global',
    });
    msg.value = t('ui.saved');
    msgType.value = 'success';
  } catch (e) {
    msg.value = t('ui.saveFailed') + (e as Error).message;
    msgType.value = 'error';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="settings">
    <div class="rules-head">
      <div>
        <h2>{{ t('ui.rulesTitle') }}</h2>
        <p class="muted">{{ t('ui.rulesDesc') }}</p>
      </div>
      <button class="text" :disabled="loading || saving" @click="load">{{ t('ui.reload') }}</button>
    </div>

    <div class="rules-path">{{ rulePath }}</div>

    <textarea
      v-model="content"
      class="json-editor"
      :disabled="saving || loading"
      :placeholder="t('ui.rulesPlaceholder')"
    />

    <div class="actions-row">
      <button class="primary" :disabled="saving || loading" @click="save">
        {{ saving ? t('ui.saving') : t('ui.save') }}
      </button>
      <span v-if="msg" :class="['msg', msgType]">{{ msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.rules-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.rules-head h2 {
  margin: 0 0 2px;
}
.rules-head p {
  margin: 0;
  font-size: 12px;
}
.muted {
  color: var(--text-tertiary);
}
.rules-path {
  font-size: var(--fs-xs);
  color: var(--text-tertiary);
  margin-bottom: 10px;
  font-family: var(--font-mono, monospace);
}
</style>
