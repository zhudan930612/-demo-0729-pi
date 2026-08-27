<template>
  <aside class="disaster-warning-panel" aria-label="受灾预警工作台">
    <header class="panel-header">
      <div class="tab-list" role="tablist" aria-label="受灾预警视图">
        <button
          v-for="t in tabs"
          :id="`dw-tab-${t.key}`"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === t.key"
          :tabindex="activeTab === t.key ? 0 : -1"
          @click="emit('select-tab', t.key)"
        >{{ t.label }}</button>
      </div>
      <button type="button" class="close-button" :aria-label="closeLabel" :title="closeLabel" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="panel-body">
      <div v-if="phase === 'loading'" class="panel-status" role="status" aria-live="polite">加载受灾预警数据…</div>
      <div v-else-if="phase === 'error'" class="panel-status error" role="alert">
        受灾预警数据加载失败{{ errorMessage ? `（${errorMessage}）` : '' }}，已降级：预警监测空态、灾损预估 0、派发不可用。
      </div>

      <!-- 灾损预估 tab（默认，R1-5；内容由 T8 填充，本期为降级占位） -->
      <section v-if="activeTab === 'loss'" class="tab-pane loss-pane" data-test="dw-loss-pane">
        <div class="loss-title-row">
          <span class="loss-title">{{ regionName }} · 灾损预估</span>
          <span class="est-tag">预估</span>
        </div>
        <div class="loss-metrics">
          <div class="loss-metric"><span class="loss-metric-label">预估受灾面积</span><span class="loss-metric-value">{{ lossAreaText }}</span><span class="loss-metric-unit">万亩</span></div>
          <div class="loss-metric"><span class="loss-metric-label">预估涉及户数</span><span class="loss-metric-value">{{ lossHouseholdsText }}</span><span class="loss-metric-unit">户</span></div>
          <div class="loss-metric"><span class="loss-metric-label">预估赔偿金额</span><span class="loss-metric-value">{{ lossAmountText }}</span><span class="loss-metric-unit">万元</span></div>
        </div>
        <p class="loss-hint" data-test="dw-loss-hint">{{ lossHint }}</p>
      </section>

      <!-- 预警监测 tab（内容由 T6 填充，本期为空态占位；R2-18 降级=空态） -->
      <section v-else-if="activeTab === 'warning'" class="tab-pane" data-test="dw-warning-pane">
        <div class="empty-state" data-test="dw-warning-empty">暂无预警村{{ phase === 'error' ? '（数据缺失）' : '' }}</div>
      </section>

      <!-- 任务列表 tab（内容由 T9/T10 填充，本期为空态占位） -->
      <section v-else class="tab-pane" data-test="dw-task-pane">
        <div class="empty-state" data-test="dw-task-empty">暂无任务{{ phase === 'error' ? '（派发不可用）' : '' }}</div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DisasterWarningTab } from '../../features/disaster-warning/types'
import { DISASTER_WARNING_TABS } from '../../features/disaster-warning/types'
import type { DisasterWarningPhase } from '../../stores/disasterWarning'

const props = defineProps<{
  phase: DisasterWarningPhase
  activeTab: DisasterWarningTab
  errorMessage: string
  regionName: string
}>()
const emit = defineEmits<{
  close: []
  'select-tab': [tab: DisasterWarningTab]
}>()

const tabs = DISASTER_WARNING_TABS
const closeLabel = computed(() => '退出受灾预警')

// R2-18 降级：灾损预估显示 0；就绪态内容由 T8 填充，本期同样显示 0 + 提示
const lossAreaText = computed(() => '0')
const lossHouseholdsText = computed(() => '0')
const lossAmountText = computed(() => '0')
const lossHint = computed(() => {
  if (props.phase === 'error') return '数据缺失，灾损预估不可用'
  if (props.phase === 'loading') return '加载中…'
  return '灾损预估随台风播放与村级预警联动刷新'
})
</script>

<style scoped>
.disaster-warning-panel {
  position: absolute; top: 12px; right: 12px; z-index: 1010;
  width: 380px; max-width: calc(100% - 24px); box-sizing: border-box;
  display: flex; flex-direction: column; overflow: hidden;
  max-height: min(calc(100vh - 160px), 65vh);
  border: 1px solid rgba(148, 163, 184, 0.34); border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(8px);
  color: #0f172a; font-size: 12px;
}
.panel-header {
  height: 34px; flex: none; display: flex; align-items: stretch; justify-content: space-between; gap: 8px; padding: 0 4px 0 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.34);
}
.tab-list { display: flex; flex: 1; align-items: stretch; gap: 2px; min-width: 0; }
.tab-list button {
  height: 100%; min-width: 64px; padding: 0 10px; border: 0; border-radius: 0;
  background: transparent; color: #475569; font-size: 12.5px; font-weight: 600; cursor: pointer;
  position: relative; transition: color 0.15s ease, background-color 0.15s ease;
}
.tab-list button:hover:not([aria-selected='true']) { color: #1d4ed8; background: #eff6ff; }
.tab-list button[aria-selected='true'] { color: #1d4ed8; font-weight: 700; }
.tab-list button[aria-selected='true']::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: #2563eb;
}
.tab-list button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: -2px; }
.close-button {
  width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: #475569; cursor: pointer; align-self: center;
}
.close-button:hover { background: #e2e8f0; color: #0f172a; }
.close-button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: -2px; }
.close-button svg { width: 15px; height: 15px; }
.panel-body { flex: 1 1 auto; min-height: 0; padding: 10px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.panel-status { padding: 8px 10px; margin-bottom: 8px; border-radius: 6px; background: #f1f5f9; color: #64748b; font-size: 11px; }
.panel-status.error { background: #fef2f2; color: #991b1b; }
.tab-pane { display: flex; flex-direction: column; gap: 8px; }
.loss-title-row { display: flex; align-items: center; gap: 6px; }
.loss-title { font-weight: 700; color: #0f172a; }
.est-tag { flex: none; padding: 1px 6px; border-radius: 999px; background: #f1f5f9; color: #64748b; font-size: 10px; font-weight: 600; }
.loss-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.loss-metric { display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid rgba(148, 163, 184, 0.34); border-radius: 8px; background: #fff; }
.loss-metric-label { color: #64748b; font-size: 10.5px; }
.loss-metric-value { font-size: 18px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; line-height: 1.05; }
.loss-metric-unit { color: #94a3b8; font-size: 10px; }
.loss-hint { margin: 0; color: #94a3b8; font-size: 10.5px; }
.empty-state { padding: 24px 0; text-align: center; color: #94a3b8; font-size: 12px; }
@media (max-width: 560px) { .disaster-warning-panel { width: calc(100% - 12px); right: 6px; } }
</style>
