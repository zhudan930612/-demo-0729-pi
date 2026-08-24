<template>
  <aside class="agri-panel" aria-label="农情监测工作台">
    <header class="panel-header">
      <div class="tab-list" role="tablist" aria-label="农情监测视图">
        <button v-for="t in tabs" :id="`agri-tab-${t.key}`" :key="t.key" type="button" role="tab" :aria-selected="activeTab === t.key" :tabindex="activeTab === t.key ? 0 : -1" @click="emit('select-tab', t.key)">{{ t.label }}</button>
      </div>
      <button type="button" class="close-button" :aria-label="closeLabel" :title="closeLabel" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="panel-body">
      <div v-if="phase === 'loading'" class="panel-loading" role="status" aria-live="polite">加载农情监测数据…</div>
      <div v-else-if="phase === 'error'" class="panel-error" role="alert">农情数据加载失败{{ errorMessage ? `（${errorMessage}）` : '' }}</div>
      <template v-else-if="activeTab === 'overview'">
        <AgriOverview @select-child="(row) => emit('select-child', row)" />
      </template>
      <template v-else-if="activeTab === 'anomaly'">
        <AgriAnomaly @select-village="(code) => emit('select-village', code)" />
      </template>
      <template v-else-if="activeTab === 'tasks'">
        <AgriTasks @locate-task="(loc) => emit('locate-task', loc)" @close-task="emit('close-task')" />
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import type { AgriTab } from '../../features/agri-monitoring/agriMonitoringTypes'
import AgriOverview from './AgriOverview.vue'
import AgriAnomaly from './AgriAnomaly.vue'
import AgriTasks from './AgriTasks.vue'

const emit = defineEmits<{
  close: []
  'select-tab': [tab: AgriTab]
  'select-village': [code: string]
  'select-child': [row: { code: string; name: string; geometry: unknown; level: string }]
  'locate-task': [location: { lon: number; lat: number; name: string }]
  'close-task': []
}>()

const agri = useAgriMonitoringStore()
const tabs: Array<{ key: AgriTab; label: string }> = [
  { key: 'overview', label: '农情概况' },
  { key: 'anomaly', label: '异常top' },
  { key: 'tasks', label: '任务列表' },
]
const activeTab = computed(() => agri.activeTab)
const phase = computed(() => agri.phase)
const errorMessage = computed(() => agri.errorMessage)
const closeLabel = computed(() => '退出农情监测')
</script>

<style scoped>
.agri-panel {
  position: absolute; top: 12px; right: 12px; z-index: 1010;
  width: 380px; max-height: calc(100vh - 160px); box-sizing: border-box;
  display: flex; flex-direction: column;
  border: 1px solid rgba(37, 99, 235, 0.55); border-radius: 10px;
  background: rgba(248, 250, 252, 0.96); box-shadow: 0 7px 22px rgba(15, 23, 42, 0.24);
  color: #0f172a; font-size: 12px;
}
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid rgba(148,163,184,0.2); }
.tab-list { display: flex; gap: 2px; }
.tab-list button { padding: 4px 10px; border: 0; border-radius: 6px; background: transparent; color: #64748b; font-size: 12px; font-weight: 600; cursor: pointer; }
.tab-list button:hover { background: #eef2f7; }
.tab-list button[aria-selected='true'] { background: #dbeafe; color: #1d4ed8; box-shadow: inset 3px 0 #2563eb; }
.close-button { width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: #64748b; cursor: pointer; }
.close-button:hover { background: #e2e8f0; }
.close-button svg { width: 12px; height: 12px; }
.panel-body { padding: 8px 10px; overflow: auto; }
.panel-loading, .panel-error { padding: 12px; text-align: center; color: #64748b; font-size: 11px; }
.panel-error { color: #b91c1c; }
@media (max-width: 560px) { .agri-panel { width: calc(100% - 12px); right: 6px; } }
</style>
