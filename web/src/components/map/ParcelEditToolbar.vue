<template>
  <div class="parcel-edit-toolbar" :class="{ active: mode !== 'idle' }" aria-label="地块操作工具">
    <template v-if="mode === 'filter'">
      <div class="edit-stat">
        <span class="stat-dot hidden" aria-hidden="true"></span>
        <span>已隐藏</span>
        <strong>{{ hiddenCount }}</strong>
      </div>
      <button
        type="button"
        class="edit-action restore-all"
        :disabled="hiddenCount === 0 || pendingRestoreCount === hiddenCount"
        title="将当前村全部隐藏地块标记为待恢复"
        @click="emit('restore-all')"
      >全部恢复</button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="edit-stat">
        <span class="stat-dot pending-hide" aria-hidden="true"></span>
        <span>待隐藏</span>
        <strong>{{ pendingHideCount }}</strong>
      </div>
      <div class="edit-stat">
        <span class="stat-dot pending-restore" aria-hidden="true"></span>
        <span>待恢复</span>
        <strong>{{ pendingRestoreCount }}</strong>
      </div>
      <button type="button" class="edit-action primary" :disabled="pendingChangeCount === 0" @click="emit('save-filter')">保存更改</button>
      <button type="button" class="edit-action cancel" @click="emit('cancel-filter')">取消</button>
    </template>

    <template v-else-if="mode === 'batch' || mode === 'drawing'">
      <div class="batch-draw-count"><span>已绘制</span><strong>{{ batchSavedCount }}</strong><span>地块</span></div>
      <button v-if="mode === 'batch'" type="button" class="edit-action draw-action" @click="emit('start-drawing')">绘制</button>
      <button v-else type="button" class="edit-action draw-action active" @click="emit('exit-drawing')">退出绘制</button>
      <button type="button" class="edit-action" :disabled="draftPointCount === 0 && batchSavedCount === 0" @click="emit('undo-manual')">撤销</button>
      <button type="button" class="edit-action primary" :disabled="!batchHasChanges && draftPointCount === 0" @click="emit('save-batch')">保存</button>
      <button type="button" class="edit-action cancel" @click="emit('cancel-batch')">取消</button>
    </template>

    <template v-else-if="mode === 'editing'">
      <div class="draw-guide"><strong>编辑人工地块</strong><span>拖动顶点修正边界</span><small>{{ draftAreaText }}</small></div>
      <button type="button" class="edit-action primary" @click="emit('save-manual-edit')">保存</button>
      <button type="button" class="edit-action cancel" @click="emit('cancel-manual-edit')">取消</button>
    </template>

    <template v-else>
      <button type="button" class="edit-launch primary-launch" @click="emit('start-manual')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m4 5 7-2 5 5-2 10-9 2-2-8Z" /><path d="M18 13v8M14 17h8" />
        </svg>
        新增地块
      </button>
      <button
        type="button"
        class="edit-launch"
        :disabled="!parcelOn || !hasFilterableParcels"
        :title="hasFilterableParcels ? '筛选地块' : '当前村没有可筛选的地块'"
        @click="emit('start-filter')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 5h16l-6.5 7.2V19l-3 1.5v-8.3Z" />
        </svg>
        筛选地块
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ParcelMode } from '../../features/parcels/parcelTypes'

defineProps<{
  mode: ParcelMode
  parcelOn: boolean
  hasFilterableParcels: boolean
  hiddenCount: number
  pendingHideCount: number
  pendingRestoreCount: number
  pendingChangeCount: number
  batchSavedCount: number
  draftPointCount: number
  batchHasChanges: boolean
  draftAreaText: string
}>()

const emit = defineEmits<{
  'start-manual': []
  'start-filter': []
  'restore-all': []
  'save-filter': []
  'cancel-filter': []
  'start-drawing': []
  'exit-drawing': []
  'undo-manual': []
  'save-batch': []
  'cancel-batch': []
  'save-manual-edit': []
  'cancel-manual-edit': []
}>()
</script>

<style scoped>
.parcel-edit-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  color: #334155;
  font-size: 13px;
  backdrop-filter: blur(8px);
}
.parcel-edit-toolbar.active { gap: 4px; padding: 5px 6px; }
.edit-launch,
.edit-action {
  height: 34px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}
.edit-launch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  background: #fff;
  color: #1d4ed8;
}
.edit-launch svg { width: 16px; height: 16px; }
.edit-launch:hover:not(:disabled) { background: #eff6ff; color: #1e40af; }
.edit-launch.primary-launch { background: #2563eb; color: #fff; box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25); }
.edit-launch.primary-launch:hover { background: #1d4ed8; color: #fff; }
.edit-launch:disabled { cursor: not-allowed; color: #94a3b8; opacity: 0.7; }
.edit-action { padding: 0 12px; background: transparent; color: #475569; }
.edit-action:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.edit-launch:focus-visible,
.edit-action:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.edit-action:disabled { cursor: not-allowed; opacity: 0.38; }
.edit-action.primary { background: #2563eb; color: #fff; box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25); }
.edit-action.primary:hover:not(:disabled) { background: #1d4ed8; color: #fff; }
.edit-action.draw-action { color: #7e22ce; }
.edit-action.draw-action:hover { background: #faf5ff; color: #6b21a8; }
.edit-action.draw-action.active { background: #faf5ff; color: #6b21a8; }
.edit-action.restore-all { color: #166534; }
.edit-action.restore-all:hover:not(:disabled) { background: #f0fdf4; color: #14532d; }
.edit-action.cancel { color: #475569; }
.draw-guide {
  min-width: 166px;
  height: 34px;
  display: grid;
  grid-template-columns: auto auto;
  align-content: center;
  column-gap: 8px;
  padding: 0 8px;
  white-space: nowrap;
}
.draw-guide strong { color: #581c87; font-size: 12px; }
.draw-guide span { color: #475569; font-size: 12px; }
.draw-guide small { grid-column: 1 / -1; color: #7e22ce; font-size: 10px; font-variant-numeric: tabular-nums; }
.batch-draw-count {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  color: #475569;
  white-space: nowrap;
}
.batch-draw-count strong { color: #7e22ce; font-size: 15px; font-variant-numeric: tabular-nums; }
.edit-stat {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  color: #64748b;
  white-space: nowrap;
}
.edit-stat strong { min-width: 1.2em; color: #0f172a; font-variant-numeric: tabular-nums; }
.stat-dot { width: 7px; height: 7px; border-radius: 50%; }
.stat-dot.hidden { background: #eab308; box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.16); }
.stat-dot.pending-hide { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.14); }
.stat-dot.pending-restore { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); }
.toolbar-divider { width: 1px; height: 22px; margin: 0 2px; background: #cbd5e1; }

@media (max-width: 720px) {
  .parcel-edit-toolbar { top: 64px; max-width: calc(100vw - 24px); }
  .parcel-edit-toolbar.active { gap: 2px; }
  .edit-stat { padding-inline: 4px; }
  .edit-stat span:not(.stat-dot) { display: none; }
  .edit-action { padding-inline: 9px; }
  .draw-guide span { display: none; }
  .draw-guide { min-width: 96px; }
}

@media (max-width: 520px) {
  .parcel-edit-toolbar { left: 12px; right: 12px; overflow-x: auto; }
  .edit-action,
  .edit-launch { flex: 0 0 auto; }
}
</style>
