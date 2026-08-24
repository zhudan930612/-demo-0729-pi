<template>
  <div class="agri-anomaly">
    <!-- 详情（选中异常村） -->
    <div v-if="detailVillage" class="anomaly-detail">
      <div class="detail-header">
        <button type="button" class="back-btn" aria-label="返回异常列表" @click="closeDetail">‹</button>
        <span class="detail-title">{{ detailVillage.name }}</span>
      </div>
      <div class="detail-body">
        <div class="detail-label">长势 5 级占比（承保面积）</div>
        <div class="detail-band">
          <div v-for="lv in levels" :key="lv" class="band-seg" :style="bandStyle(lv, detailVillage.levels[lv])">{{ pct(detailVillage.levels[lv]) }}%</div>
        </div>
        <div class="detail-ratio">极差+较差占比：<strong>{{ pct(detailVillage.anomalyRatio) }}%</strong><span class="ratio-threshold">（>30% 为异常）</span></div>
      </div>
      <div class="detail-actions">
        <button
          type="button"
          class="convert-btn"
          :disabled="converted.has(detailVillage.code)"
          @click="createTask(detailVillage)"
        >{{ converted.has(detailVillage.code) ? '已转任务✓' : '一键转任务' }}</button>
      </div>
    </div>

    <!-- 列表 -->
    <template v-else>
      <div class="list-caption">异常村（极差+较差承保面积占比 > 30%，按占比降序）</div>
      <div v-if="rows.length === 0" class="empty">暂无异常村</div>
      <button v-for="row in rows" :key="row.code" type="button" class="anomaly-row" @click="emit('select-village', row.code)">
        <span class="row-name">{{ row.name }}</span>
        <div class="row-bar">
          <div class="row-bar-fill" :style="{ width: pct(row.anomalyRatio) + '%' }"></div>
        </div>
        <span class="row-pct">{{ pct(row.anomalyRatio) }}%</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { GROWTH_LEVELS, LEVEL_COLORS, type GrowthLevel, type VillageGrowth } from '../../features/agri-monitoring/agriMonitoringTypes'

const emit = defineEmits<{ 'select-village': [code: string] }>()
const agri = useAgriMonitoringStore()
const levels = GROWTH_LEVELS

const pct = (v: number) => Math.round((v ?? 0) * 100)
const rows = computed(() =>
  (agri.villages ?? []).filter((v) => v.isAnomaly).sort((a, b) => b.anomalyRatio - a.anomalyRatio),
)
const detailVillage = computed<VillageGrowth | null>(() =>
  agri.villages?.find((v) => v.code === agri.villageDetailCode) ?? null,
)
const converted = computed(() => agri.convertedSet)

function bandStyle(lv: GrowthLevel, ratio: number) {
  const [r, g, b] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${g},${b})`, flex: `0 0 ${Math.max(0, pct(ratio))}%` }
}
function closeDetail() { agri.closeVillageDetail() }
function createTask(village: VillageGrowth) {
  const task = agri.createTaskFromAnomaly(village)
  if (task) agri.setTab('tasks')
}
</script>

<style scoped>
.agri-anomaly { font-size: 12px; }
.list-caption { font-size: 10px; color: #475569; margin-bottom: 6px; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
.anomaly-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 4px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.12); background: transparent; cursor: pointer; color: #334155; }
.anomaly-row:hover { background: #fef2f2; }
.row-name { width: 80px; flex: none; font-weight: 600; text-align: left; }
.row-bar { flex: 1; height: 10px; border-radius: 5px; background: #fee2e2; overflow: hidden; }
.row-bar-fill { height: 100%; background: #dc2626; border-radius: 5px; }
.row-pct { width: 40px; flex: none; text-align: right; font-weight: 600; color: #b91c1c; font-variant-numeric: tabular-nums; }
.anomaly-detail .detail-header { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.back-btn { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #2563eb; font-size: 16px; cursor: pointer; }
.back-btn:hover { background: #eef2f7; }
.detail-title { font-size: 14px; font-weight: 600; color: #0f172a; }
.detail-label { font-size: 10px; color: #64748b; margin-bottom: 4px; }
.detail-band { display: flex; height: 18px; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
.band-seg { display: flex; align-items: center; justify-content: center; min-width: 0; font-size: 9px; color: #fff; text-shadow: 0 0 1px rgba(0,0,0,0.5); }
.detail-ratio { font-size: 11px; color: #475569; margin-bottom: 8px; }
.detail-ratio strong { color: #b91c1c; }
.ratio-threshold { color: #94a3b8; font-size: 10px; }
.detail-actions { display: flex; }
.convert-btn { padding: 6px 12px; border: 0; border-radius: 7px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
.convert-btn:hover:not(:disabled) { background: #1d4ed8; }
.convert-btn:disabled { background: #16a34a; cursor: default; }
</style>
