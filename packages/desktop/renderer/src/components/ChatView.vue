<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import type { Message } from '../types';
// 本文件模板里 `t` 已被 v-for 循环变量占用，i18n 函数用 `tr` 别名
import { t as tr } from '../i18n';
import MarkdownView from './MarkdownView.vue';

const emit = defineEmits<{
  (e: 'edit', msg: Message): void;
  (e: 'regenerate', msg: Message): void;
}>();

const copiedId = ref<string | null>(null);
async function copyText(msg: Message): Promise<void> {
  await copyToClipboard(textOfContent(msg.content), msg.id);
}
async function copyAI(ai: AIMerged): Promise<void> {
  const text = ai.thinking ? ai.thinking + '\n\n' + ai.text : ai.text;
  await copyToClipboard(text, ai.id);
}
async function copyToClipboard(text: string, id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }
  copiedId.value = id;
  setTimeout(() => { if (copiedId.value === id) copiedId.value = null; }, 1500);
}

interface AIMerged {
  id: string;
  thinking: string;
  text: string;
  toolCalls: ToolCall[];
  toolResults: Array<{ id: string; isError: boolean; content: string }>;
  synthetic: boolean;
  lastMsg: Message;
}
interface Turn {
  user: Message | null;
  ai: AIMerged | null;
}

/**
 * 把扁平的 messages 按「轮次」分组：
 *   [user] → [assistant(含思考/工具) → tool → assistant → ...]
 * 合并成一个用户气泡 + 一个 AI 气泡，避免一次工具调用循环产生「好几个 AI 回复」。
 */
const turns = computed<Turn[]>(() => {
  const out: Turn[] = [];
  let cur: Turn = { user: null, ai: null };
  const acc = {
    id: '', thinking: '', text: '', toolCalls: [] as ToolCall[], toolResults: [] as Array<{ id: string; isError: boolean; content: string }>, synthetic: false, lastMsg: null as Message | null,
  };
  const resetAcc = (): void => {
    acc.id = ''; acc.thinking = ''; acc.text = ''; acc.toolCalls = []; acc.toolResults = []; acc.synthetic = false; acc.lastMsg = null;
  };
  const flushAI = (): void => {
    if (acc.lastMsg) {
      cur.ai = {
        id: acc.id,
        thinking: acc.thinking,
        text: acc.text,
        toolCalls: acc.toolCalls,
        toolResults: acc.toolResults,
        synthetic: acc.synthetic,
        lastMsg: acc.lastMsg,
      };
    }
  };
  for (const m of props.messages) {
    if (m.role === 'user') {
      flushAI();
      if (cur.user || cur.ai) out.push(cur);
      cur = { user: m, ai: null };
      resetAcc();
    } else if (m.role === 'assistant') {
      acc.lastMsg = m;
      acc.id = m.id;
      if (m.thinking) acc.thinking += (acc.thinking ? '\n' : '') + m.thinking;
      if (m.toolCalls) acc.toolCalls.push(...m.toolCalls);
      const t = textOfContent(m.content);
      if (t) acc.text += (acc.text ? '\n' : '') + t;
      if (m.meta?.synthetic) acc.synthetic = true;
    } else if (m.role === 'tool' && m.toolResult) {
      acc.toolResults.push({ id: m.toolResult.toolCallId, isError: !!m.toolResult.isError, content: fmtResult(m.toolResult.content) });
    }
  }
  flushAI();
  if (cur.user || cur.ai) out.push(cur);
  return out;
});

interface ToolCall { id: string; name: string; input: unknown; result?: unknown }

const props = defineProps<{
  messages: Message[];
  streamingText: string;
  streamingThinking: string;
  streamingTools: ToolCall[];
  busy: boolean;
  currentSession: { id: string; title: string } | null;
}>();

function fmtToolInput(input: unknown): string {
  try {
    const s = JSON.stringify(input, null, 2);
    return s.length > 800 ? s.slice(0, 800) + '\n…' : s;
  } catch {
    return String(input).slice(0, 800);
  }
}

function fmtResult(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  return content.map((p: any) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(' ');
}

const container = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  if (container.value) container.value.scrollTop = container.value.scrollHeight;
}

onMounted(() => nextTick(scrollToBottom));
watch(
  () => [props.messages.length, props.streamingText, props.streamingThinking, props.streamingTools.length],
  () => { nextTick(scrollToBottom); },
);

function toolLabel(name: string, input: unknown): string {
  if (name === 'Bash') return `Bash · ${String((input as any)?.command ?? '').slice(0, 80)}`;
  if (name === 'Write') return `Write · ${(input as any)?.filePath ?? ''}`;
  if (name === 'Edit') return `Edit · ${(input as any)?.filePath ?? ''}`;
  if (name === 'Read') return `Read · ${(input as any)?.filePath ?? ''}`;
  if (name === 'Glob') return `Glob · ${(input as any)?.pattern ?? ''}`;
  if (name === 'Grep') return `Grep · ${(input as any)?.pattern ?? ''}`;
  if (name === 'LS' || name === 'Ls') return `LS · ${(input as any)?.path ?? ''}`;
  if (name === 'WebFetch') return `WebFetch · ${(input as any)?.url ?? ''}`;
  if (name === 'WebSearch') return `WebSearch · ${(input as any)?.query ?? ''}`;
  if (name.startsWith('mcp:')) {
    const parts = name.split(':');
    return `MCP · ${parts.slice(1).join(':')}`;
  }
  return name;
}

function textOfContent(c: Message['content']): string {
  if (typeof c === 'string') return c;
  return c.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
}

interface ContentPartView {
  type: 'text' | 'image' | 'file';
  text?: string;
  src?: string;
  fileName?: string;
  mediaType?: string;
  data?: string;
  size?: number;
}

function contentParts(c: Message['content']): ContentPartView[] {
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return c.map((p) => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    if (p.type === 'image') {
      const src = p.source.type === 'base64' ? `data:${p.source.mediaType};base64,${p.source.data}` : p.source.data;
      return { type: 'image', src };
    }
    if (p.type === 'file') {
      const size = Math.floor((p.data.length * 3) / 4);
      return { type: 'file', fileName: p.fileName, mediaType: p.mediaType, data: p.data, size };
    }
    return { type: 'text', text: '' };
  });
}

function fmtSize(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function downloadFile(p: ContentPartView): void {
  if (!p.data || !p.fileName) return;
  const bytes = Uint8Array.from(atob(p.data), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: p.mediaType ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = p.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const hasStreamingContent = computed(() =>
  !!props.streamingText || !!props.streamingThinking || props.streamingTools.length > 0,
);

/** busy 时始终渲染 AI 气泡，避免「发送后到首个 token 之间」界面空白 */
const showStreaming = computed(() => props.busy || hasStreamingContent.value);
</script>

<template>
  <div ref="container" class="messages">
    <div v-if="!messages.length && !hasStreamingContent" class="empty">
      <div class="empty-mark">⌘</div>
      <div class="empty-title">{{ tr('chat.emptyTitle') }}</div>
      <div class="empty-desc">{{ tr('chat.emptyDesc') }}</div>
    </div>

    <template v-for="(turn, ti) in turns" :key="ti">
      <!-- 用户消息 -->
      <div v-if="turn.user" :class="['message', 'user']">
        <div class="avatar">user</div>
        <div class="body">
          <div v-if="turn.user.content && !turn.user.meta?.synthetic" class="content">
            <template v-for="(part, i) in contentParts(turn.user.content)" :key="i">
              <MarkdownView v-if="part.type === 'text' && part.text" :source="part.text" />
              <div v-else-if="part.type === 'image' && part.src" class="attach-image">
                <img :src="part.src" :alt="tr('ui.imageAlt')" />
              </div>
              <div v-else-if="part.type === 'file' && part.fileName" class="attach-file">
                <svg class="file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div class="file-info">
                  <span class="file-name" :title="part.fileName">{{ part.fileName }}</span>
                  <span class="file-size">{{ fmtSize(part.size ?? 0) }}</span>
                </div>
                <button class="file-dl" @click="downloadFile(part)">{{ tr('chat.download') }}</button>
              </div>
            </template>
          </div>
          <div class="msg-actions">
            <button class="ma-btn" @click="copyText(turn.user)">
              {{ copiedId === turn.user.id ? tr('ui.copied') : tr('ui.copy') }}
            </button>
            <button class="ma-btn" @click="emit('edit', turn.user)">{{ tr('ui.edit') }}</button>
          </div>
        </div>
      </div>

      <!-- 合并后的 AI 气泡（含本轮所有思考 / 工具调用 / 结果 / 最终回答） -->
      <div v-if="turn.ai" :class="['message', 'assistant']">
        <div class="avatar">AI</div>
        <div class="body">
          <div v-if="turn.ai.thinking" class="thinking">
            <div class="thinking-head">
              <span class="dot"></span>
              <span>{{ tr('chat.thinkingProcess') }}</span>
            </div>
            <div class="thinking-body">{{ turn.ai.thinking }}</div>
          </div>

          <div v-if="turn.ai.synthetic && turn.ai.text" class="thinking synth">
            <div class="thinking-head">
              <span class="dot"></span>
              <span>{{ tr('chat.contextSummary') }}</span>
            </div>
            <div class="thinking-body">
              <MarkdownView :source="turn.ai.text" />
            </div>
          </div>
          <div v-else-if="turn.ai.text" class="content">
            <MarkdownView :source="turn.ai.text" />
          </div>

          <template v-for="(tc, i) in turn.ai.toolCalls" :key="'tc' + i">
            <div class="tool-block">
              <div class="tool-head">
                <span class="caret">▸</span>
                <span class="tool-name">{{ toolLabel(tc.name, tc.input) }}</span>
              </div>
              <pre class="tool-body">{{ fmtToolInput(tc.input) }}</pre>
            </div>
            <div
              v-for="r in turn.ai.toolResults.filter((x) => x.id === tc.id)"
              :key="'tr' + r.id"
              :class="['tool-result-block', { error: r.isError }]"
            >
              <div class="tr-meta">
                <span class="tr-dot"></span>
                <span>{{ r.isError ? tr('ui.toolFailed') : tr('ui.toolResult') }}</span>
              </div>
              <pre class="tr-body">{{ r.content }}</pre>
            </div>
          </template>

          <div class="msg-actions">
            <button class="ma-btn" @click="copyAI(turn.ai)">
              {{ copiedId === turn.ai.id ? tr('ui.copied') : tr('ui.copy') }}
            </button>
            <button class="ma-btn" @click="emit('regenerate', turn.ai.lastMsg)">{{ tr('chat.regenerate') }}</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 流式 assistant 块 -->
    <div v-if="showStreaming" class="message assistant streaming">
      <div class="avatar">AI</div>
      <div class="body">
        <!-- busy 但还没有任何内容：先给一个标识，避免空白 -->
        <div v-if="busy && !hasStreamingContent" class="thinking live">
          <div class="thinking-head">
            <span class="spinner"></span>
            <span>{{ tr('chat.thinkingDots') }}</span>
          </div>
        </div>

        <!-- 思考中（常显） -->
        <div v-if="streamingThinking" class="thinking live">
          <div class="thinking-head">
            <span v-if="busy" class="spinner"></span>
            <span>{{ busy ? tr('ui.thinking') : tr('chat.thinkingProcess') }}</span>
          </div>
          <div class="thinking-body">{{ streamingThinking }}</div>
        </div>

        <!-- 工具调用（常显，含调用参数与执行结果） -->
        <div v-for="t in streamingTools" :key="t.id" class="tool-block live">
          <div class="tool-head">
            <span class="caret">▸</span>
            <span class="tool-name">{{ toolLabel(t.name, t.input) }}</span>
          </div>
          <pre class="tool-body">{{ fmtToolInput(t.input) }}</pre>
          <pre
            v-if="t.result !== undefined"
            :class="['streaming-result', { error: (t.result as any)?.isError }]"
          >{{ fmtResult((t.result as any)?.content) }}</pre>
        </div>

        <div v-if="streamingText" class="content">
          <MarkdownView :source="streamingText" :streaming="true" />
          <span v-if="busy" class="cursor"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 空状态 */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  gap: var(--space-2);
  padding: 80px 24px;
}
.empty-mark {
  font-size: 36px;
  color: var(--text-quaternary);
  margin-bottom: 4px;
}
.empty-title {
  font-size: 16px;
  color: var(--text-secondary);
  font-weight: 500;
}
.empty-desc {
  font-size: 13px;
  color: var(--text-tertiary);
}

/* 消息 */
.message {
  display: flex;
  gap: 10px;
  max-width: 100%;
  padding: 2px 0;
  position: relative;
}
.message .avatar {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  color: var(--text-on-brand);
  letter-spacing: 0;
  margin-top: 0;
}
.message.user .avatar {
  background: var(--text-tertiary);
  color: var(--bg-container);
  width: auto;
  min-width: 26px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 9px;
}
.message.assistant .avatar {
  background: var(--brand);
}
.message .body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.message .content {
  font-size: var(--fs-md, 14px);
  line-height: 1.65;
  color: var(--text-primary);
  word-wrap: break-word;
}
/* markstream 段落默认 margin:1.5em 0，去掉首元素顶部间距让首行与头像对齐 */
.message .content :deep(:first-child),
.thinking .thinking-body :deep(:first-child) {
  margin-top: 0;
}

/* 附件：图片 */
.attach-image {
  margin: 4px 0;
}
.attach-image img {
  max-width: 280px;
  max-height: 320px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  display: block;
  object-fit: contain;
  background: var(--bg-container);
}

/* 附件：文件卡片 */
.attach-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-spotlight);
  font-size: 12.5px;
}
.attach-file .file-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.attach-file .file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.attach-file .file-name {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.attach-file .file-size {
  color: var(--text-tertiary);
  font-size: 11px;
}
.attach-file .file-dl {
  flex-shrink: 0;
  padding: 3px 10px;
  font-size: 12px;
  height: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.attach-file .file-dl:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 思考块（常显） */
.thinking {
  border: 1px solid var(--border);
  background: var(--bg-spotlight);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 12px;
  color: var(--text-secondary);
}
.thinking .thinking-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-weight: 500;
  color: var(--text-tertiary);
}
.thinking .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.thinking .spinner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand);
  position: relative;
}
.thinking .spinner::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--brand);
  border-top-color: transparent;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.thinking-body {
  padding: 0 12px 10px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  font-size: 12.5px;
  line-height: 1.6;
}

/* 工具调用块（常显） */
.tool-block {
  border: 1px solid var(--border);
  background: var(--bg-spotlight);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
}
.tool-block.live {
  border-style: dashed;
}
.tool-block .tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  color: var(--text-secondary);
}
.tool-block .caret {
  color: var(--text-tertiary);
  font-size: 10px;
}
.tool-block .tool-name {
  color: var(--brand);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-block .tool-body {
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-container);
  border-top: 1px solid var(--border);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  max-height: 280px;
  overflow: auto;
}
.tool-block .streaming-result {
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-container);
  border-top: 1px solid var(--border);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  max-height: 200px;
  overflow: auto;
}
.tool-block .streaming-result.error {
  color: var(--error);
}

/* 工具结果 */
.tool-result-block {
  margin-left: 40px;
  border-left: 3px solid var(--success);
  background: var(--bg-spotlight);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  padding: 6px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  max-width: calc(100% - 40px);
}
.tool-result-block.error {
  border-left-color: var(--error);
  color: var(--error);
}
.tool-result-block .tr-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.tool-result-block .tr-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.tool-result-block.error .tr-dot {
  background: var(--error);
}
.tool-result-block .tr-body {
  margin: 0;
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}

/* 流式光标 */
.message.streaming .cursor {
  display: inline-block;
  width: 6px;
  height: 13px;
  background: var(--brand);
  margin-left: 2px;
  vertical-align: middle;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}

/* 消息操作：复制 / 编辑 / 重新回复 —— 绝对定位浮层，悬停才出现，不占用消息间距 */
.msg-actions {
  position: absolute;
  right: 0;
  bottom: 4px;
  display: flex;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  z-index: 2;
  transition: opacity 0.12s ease;
}
.message:hover .msg-actions {
  opacity: 1;
  pointer-events: auto;
}
.ma-btn {
  padding: 2px 9px;
  font-size: 11.5px;
  height: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-container);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.ma-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-strong, var(--border));
}
</style>
