<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { t } from '../i18n';

interface ModelOption {
  key: string;
  model: string;
  provider: string;
  providerId?: string;
  providerLabel?: string;
  isCurrent: boolean;
}

const props = defineProps<{
  busy: boolean;
  hasSession: boolean;
  cwd: string;
  editing?: { id: string; text: string } | null;
  currentModel: string;
  availableModels: ModelOption[];
}>();

const emit = defineEmits<{
  send: [input: { text?: string; images?: { mediaType: string; data: string }[]; files?: { fileName: string; mediaType: string; data: string }[]; rerun?: { userMessageId: string; text?: string } }];
  cancelEdit: [];
  pickModel: [key: string];
  toggleModelPicker: [];
}>();

const text = ref('');
const attachments = ref<Array<{ kind: 'image' | 'file'; name: string; mediaType: string; data: string; size: number }>>([]);
const imageInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

// 进入编辑态时把被编辑消息的文本预填进输入框并聚焦
watch(
  () => props.editing,
  async (e) => {
    if (e) {
      text.value = e.text;
      await nextTick();
      textareaEl.value?.focus();
      textareaEl.value?.setSelectionRange(e.text.length, e.text.length);
    }
  },
  { immediate: true },
);

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const currentModelLabel = computed(() => {
  const m = props.availableModels.find((x) => x.key === props.currentModel);
  if (!m) return props.currentModel || 'model';
  // 始终显示完整模型名（如 gpt-oss-120b，不要被截断）
  return m.model;
});

const currentModelFull = computed(() => {
  const m = props.availableModels.find((x) => x.key === props.currentModel);
  if (!m) return props.currentModel || 'model';
  const p = m.providerLabel?.trim();
  return p ? `${p} · ${m.model}` : m.model;
});

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function ingestFiles(files: FileList | File[]): Promise<void> {
  for (const f of Array.from(files)) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      alert(t('ui.fileTooLarge', { name: f.name }));
      continue;
    }
    const buf = await f.arrayBuffer();
    const data = bufToBase64(buf);
    if (f.type.startsWith('image/')) {
      attachments.value.push({ kind: 'image', name: f.name, mediaType: f.type, data, size: f.size });
    } else {
      attachments.value.push({ kind: 'file', name: f.name, mediaType: f.type || 'application/octet-stream', data, size: f.size });
    }
  }
}

async function onFiles(ev: Event): Promise<void> {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  await ingestFiles(files);
  if (fileInput.value) fileInput.value.value = '';
}

async function onImages(ev: Event): Promise<void> {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  await ingestFiles(files);
  if (imageInput.value) imageInput.value.value = '';
}

async function onPaste(ev: ClipboardEvent): Promise<void> {
  const cd = ev.clipboardData;
  if (!cd) return;
  if (cd.files && cd.files.length > 0) {
    ev.preventDefault();
    await ingestFiles(cd.files);
    return;
  }
  const items = cd.items;
  if (items) {
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (!f) continue;
        if (f.size > MAX_ATTACHMENT_BYTES) continue;
        ev.preventDefault();
        if (f.type.startsWith('image/')) {
          attachments.value.push({ kind: 'image', name: f.name || 'pasted.png', mediaType: f.type, data: bufToBase64(await f.arrayBuffer()), size: f.size });
        } else {
          attachments.value.push({ kind: 'file', name: f.name || 'pasted', mediaType: f.type || 'application/octet-stream', data: bufToBase64(await f.arrayBuffer()), size: f.size });
        }
      }
    }
  }
}

function removeAttachment(i: number): void {
  attachments.value.splice(i, 1);
}

function submit(): void {
  if (!text.value.trim() && !attachments.value.length) return;
  const input: { text?: string; images?: { mediaType: string; data: string }[]; files?: { fileName: string; mediaType: string; data: string }[]; rerun?: { userMessageId: string; text?: string } } = {};
  if (text.value) input.text = text.value;
  if (attachments.value.length) {
    input.images = attachments.value.filter((a) => a.kind === 'image').map((a) => ({ mediaType: a.mediaType, data: a.data }));
    input.files = attachments.value.filter((a) => a.kind === 'file').map((a) => ({ fileName: a.name, mediaType: a.mediaType, data: a.data }));
  }
  if (props.editing) {
    // 编辑重发：覆盖旧回复
    input.rerun = { userMessageId: props.editing.id, text: text.value };
  }
  emit('send', input);
  text.value = '';
  attachments.value = [];
}

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.isComposing || ev.keyCode === 229) return;
  if (ev.key === 'Escape' && props.editing) {
    ev.preventDefault();
    emit('cancelEdit');
    return;
  }
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    submit();
  }
}

function fmtSize(n: number): string {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
}

const placeholder = computed(() => {
  if (props.editing) return t('ui.editHint');
  if (!props.hasSession) return t('ui.noSessionHint');
  if (props.busy) return t('ui.busyHint');
  return t('ui.composerHint');
});
</script>

<template>
  <div class="composer">
    <div v-if="editing" class="edit-banner">
      <span class="edit-dot"></span>
      <span>{{ t('composer.editingBadge') }}</span>
      <button class="edit-cancel" @click="emit('cancelEdit')">{{ t('ui.cancel') }}</button>
    </div>
    <div v-if="attachments.length" class="attachments">
      <div v-for="(a, i) in attachments" :key="i" :class="['chip', a.kind]">
        <span class="chip-icon">
          <svg v-if="a.kind === 'image'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </span>
        <span class="chip-name">{{ a.name }}</span>
        <span class="chip-size">{{ fmtSize(a.size) }}</span>
        <button class="chip-x" :title="t('ui.remove')" @click="removeAttachment(i)">×</button>
      </div>
    </div>
    <textarea
      ref="textareaEl"
      v-model="text"
      :placeholder="placeholder"
      rows="3"
      @paste="onPaste"
      @keydown="onKeyDown"
    />
    <div class="toolbar">
      <div class="left">
        <button class="icon-btn" :title="t('composer.pasteImage')" @click="imageInput?.click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </button>
        <button class="icon-btn" :title="t('composer.pasteFile')" @click="fileInput?.click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <!-- 模型选择 -->
        <button class="pill" :title="t('ui.currentModel', { model: currentModelFull })" @click="emit('toggleModelPicker')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
          <span class="pill-label">{{ currentModelLabel }}</span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="right">
        <span class="hint" v-if="text.length || attachments.length">{{ t('composer.counter', { chars: text.length, files: attachments.length }) }}</span>
        <button class="send" :disabled="!text.trim() && !attachments.length" @click="submit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
          <span>{{ t('composer.send') }}</span>
        </button>
      </div>
    </div>
    <input ref="imageInput" type="file" accept="image/*" multiple style="display:none;" @change="onImages" />
    <input ref="fileInput" type="file" multiple style="display:none;" @change="onFiles" />
  </div>
</template>
