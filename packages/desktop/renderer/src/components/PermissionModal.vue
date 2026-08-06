<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';

interface PermissionAsk {
  description: string;
  options: { allow: string; deny: string; allowAll?: string };
  tool: string;
  input: unknown;
}

const props = defineProps<{ req: unknown }>();
const emit = defineEmits<{ choice: [c: 'allow' | 'deny' | 'allowAll'] }>();

const ask = computed<PermissionAsk>(() => (props.req ?? {}) as PermissionAsk);
const fmtInput = computed<string>(() => {
  try {
    return JSON.stringify({ tool: ask.value.tool, input: ask.value.input }, null, 2);
  } catch {
    return String(ask.value.input);
  }
});

function onKey(e: KeyboardEvent): void {
  if (e.key === 'y' || e.key === 'Y') emit('choice', 'allow');
  else if (e.key === 'n' || e.key === 'N') emit('choice', 'deny');
  else if ((e.key === 'a' || e.key === 'A') && ask.value.options.allowAll) emit('choice', 'allowAll');
}
</script>

<template>
  <div class="permissions-modal" @keydown="onKey" tabindex="0">
    <div class="card">
      <h3>{{ t('ui.permissionTitle') }}</h3>
      <p>{{ ask.description }}</p>
      <pre>{{ fmtInput }}</pre>
      <div class="actions">
        <button @click="emit('choice', 'deny')">{{ ask.options.deny || t('ui.permissionDeny') }} (N)</button>
        <button v-if="ask.options.allowAll" @click="emit('choice', 'allowAll')">
          {{ ask.options.allowAll }} (A)
        </button>
        <button class="primary" @click="emit('choice', 'allow')">{{ ask.options.allow || t('ui.permissionAllow') }} (Y)</button>
      </div>
    </div>
  </div>
</template>
