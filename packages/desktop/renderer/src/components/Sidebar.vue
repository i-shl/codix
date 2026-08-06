<script setup lang="ts">
import { ref } from 'vue';
import type { Session, Tab } from '../types';
import { t, locale } from '../i18n';

const props = defineProps<{
  sessions: Session[];
  currentSession: Session | null;
  tab: Tab;
}>();

const emit = defineEmits<{
  selectSession: [id: string];
  deleteSession: [id: string];
  newSession: [];
  openSettings: [];
  toggleCollapse: [];
}>();

/** 待确认删除的会话 id。null = 列表态，id = 显示 ✓/✗ 二级确认 */
const pendingDeleteId = ref<string | null>(null);

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    return d.toLocaleDateString(locale.value, { month: '2-digit', day: '2-digit' });
  }
  return d.toLocaleDateString(locale.value, { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function onTrashClick(id: string, ev: MouseEvent): void {
  ev.stopPropagation();
  pendingDeleteId.value = pendingDeleteId.value === id ? null : id;
}

function onConfirm(id: string, ev: MouseEvent): void {
  ev.stopPropagation();
  pendingDeleteId.value = null;
  emit('deleteSession', id);
}

function onCancel(ev: MouseEvent): void {
  ev.stopPropagation();
  pendingDeleteId.value = null;
}

function onSelect(id: string): void {
  // 切换会话时清掉任何待确认状态，避免遗留确认 UI
  pendingDeleteId.value = null;
  emit('selectSession', id);
}
</script>

<template>
  <aside class="sidebar">
    <!-- 顶部：折叠 / 设置 / 新建会话（三个图标，无文字） -->
    <div class="sidebar-top">
      <button class="icon-btn-32" @click="emit('toggleCollapse')" :title="t('ui.collapseSidebar')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
      </button>
      <button :class="['icon-btn-32', { active: tab === 'settings' }]" @click="emit('openSettings')" :title="t('ui.settings')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <button class="icon-btn-32 primary" @click="emit('newSession')" :title="t('ui.newSession')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
    </div>

    <!-- 会话列表（不再分项目 / 工作区） -->
    <div class="sidebar-section sessions-section">
      <div
        v-for="s in sessions.slice(0, 50)"
        :key="s.id"
        :class="['session-item', { active: currentSession?.id === s.id }]"
        @click="onSelect(s.id)"
      >
        <span class="title">{{ s.title }}</span>
        <span class="time">{{ fmtTime(s.updatedAt) }}</span>

        <!-- 第一步：显示垃圾桶图标 -->
        <button
          v-if="pendingDeleteId !== s.id"
          class="delete trash"
          :title="t('ui.deleteX') + s.title"
          @click="onTrashClick(s.id, $event)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>

        <!-- 第二步：左侧 ✗ 取消 + 右侧 ✓ 确认 -->
        <span v-else class="confirm-group" @click.stop>
          <button class="confirm cancel" :title="t('ui.cancel')" @click="onCancel($event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <button class="confirm ok" :title="t('ui.confirmDeleteTip')" @click="onConfirm(s.id, $event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        </span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 列表态：垃圾桶图标只 hover 时出现 */
.session-item .trash {
  opacity: 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  height: 22px;
  width: 22px;
  padding: 0;
  border-radius: var(--radius-sm);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.session-item:hover .trash,
.session-item:focus-within .trash {
  opacity: 1;
}
.session-item .trash:hover {
  background: rgba(255, 77, 79, 0.1);
  color: var(--error);
}

/* 二级确认：✗ 在左，✓ 在右，颜色提示 */
.session-item .confirm-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  animation: confirm-in 0.12s ease-out;
}
.session-item .confirm {
  height: 22px;
  width: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  transition: background 0.12s, color 0.12s, transform 0.06s;
}
.session-item .confirm:active {
  transform: scale(0.92);
}
.session-item .confirm.ok {
  color: var(--success);
}
.session-item .confirm.ok:hover {
  background: rgba(82, 196, 26, 0.12);
}
.session-item .confirm.cancel {
  color: var(--text-tertiary);
}
.session-item .confirm.cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
@keyframes confirm-in {
  from { opacity: 0; transform: translateX(4px); }
  to { opacity: 1; transform: translateX(0); }
}
</style>
