<template>
  <div class="agri-anomaly">
    <div class="list-caption">异常村（最近一期 极差+较差占比 &gt; 3.5% 为异常；≥15% AI建议转任务）</div>
    <div v-if="rows.length === 0" class="empty">暂无异常村</div>
    <div v-for="v in rows" :key="v.code" class="anomaly-village" @click="drillToVillage(v)">
      <div class="av-head">
        <span class="av-name">{{ v.name }}</span>
        <span v-if="v.anomalyRatio >= 0.15" class="strategy-badge convert">待处理</span>
        <span v-else class="strategy-badge observe">待观察</span>
        <span class="av-pct">极差+较差 {{ pct(v.anomalyRatio) }}%</span>
      </div>
      <div class="ai-text"><span class="ai-chip">AI</span><span>{{ aiAdvice(v) }}</span></div>
      <div class="av-row">
        <div class="detail-band">
          <div v-for="lv in levels" :key="lv" class="band-seg" :style="bandStyle(lv, v.levels[lv] ?? 0)" :title="`${label(lv)} ${pct(v.levels[lv] ?? 0)}%`"></div>
        </div>
        <button v-if="!converted.has(v.code)" type="button" class="convert-btn" @click.stop="createTask(v)">派发任务</button>
        <button v-else type="button" class="cancel-btn" @click.stop="cancelConvert(v.code)">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { GROWTH_LEVELS, LEVEL_COLORS, LEVEL_LABELS, type GrowthLevel } from '../../features/agri-monitoring/agriMonitoringTypes'
import { villageAnomaly, type VillageAnomaly } from '../../features/agri-monitoring/agriAnomaly'

const emit = defineEmits<{ 'select-village': [code: string] }>()
const agri = useAgriMonitoringStore()
const levels = GROWTH_LEVELS
const pct = (v: number) => Math.round((v ?? 0) * 100)
const label = (lv: GrowthLevel) => LEVEL_LABELS[lv]
const converted = computed(() => agri.convertedSet)
function drillToVillage(v: VillageAnomaly) { emit('select-village', v.code) }

// 13 参保村中【最近一期】异常的村（固定最近一期，不随日期选择变化；按连续异常期数给 AI 建议）
const rows = computed<Array<VillageAnomaly & { code: string }>>(() => {
  const dateIdx = (agri.villagesByDate?.length ?? 1) - 1 // 最近一期
  const lastVillages = agri.villagesByDate?.[dateIdx] ?? []
  const out: Array<VillageAnomaly & { code: string }> = []
  for (const v of lastVillages) {
    const levelsPerDate = (agri.villagesByDate ?? []).map((dv) => dv.find((x) => x.code === v.code)?.levels)
    const va = villageAnomaly(v.code, v.name, levelsPerDate, dateIdx)
    if (!va.isAnomaly) continue // 用前端阈值(>10%)判定，非数据旧阈值
    out.push({ ...va, code: v.code })
  }
  return out.sort((a, b) => b.anomalyRatio - a.anomalyRatio)
})

// 弱化色带：将 5 级色与白色混合成淡色调（异常top 聚焦 AI 建议，色带退为辅助）
function bandStyle(lv: GrowthLevel, ratio: number) {
  const [r, g, b] = LEVEL_COLORS[lv]
  const m = 0.62 // 混入白的比例（越淡越弱化）
  const pale = `rgb(${Math.round(r + (255 - r) * m)},${Math.round(g + (255 - g) * m)},${Math.round(b + (255 - b) * m)})`
  return { background: pale, flex: `0 0 ${Math.max(0, pct(ratio))}%` }
}
// 强化 AI 建议：说明当前异常是什么 + 建议如何做
function aiAdvice(v: VillageAnomaly): string {
  const p = pct(v.anomalyRatio)
  if (v.anomalyRatio >= 0.15) {
    return `近一期极差+较差达 ${p}%，长势异常偏重。建议：转派核查任务，到场核实作物长势、减产程度与承保面积是否一致。`
  }
  if (v.anomalyRatio >= 0.10) {
    return `近一期极差+较差为 ${p}%，长势偏低且初现异常。建议：继续观察，跟踪下期长势是否持续下滑。`
  }
  return `近一期极差+较差为 ${p}%，长势偏低但尚轻。建议：列入重点关注，随下期影像复核。`
}
function createTask(v: VillageAnomaly) {
  const task = agri.createTaskFromAnomaly(v)
  if (task) agri.setTab('tasks')
}
function cancelConvert(code: string) { agri.cancelConvertVillage(code) }
</script>

<style scoped>
.agri-anomaly { font-size: 12px; height: 100%; overflow-y: auto; }
.list-caption { font-size: 10px; color: #475569; margin-bottom: 6px; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
.anomaly-village { padding: 15px 9px; border-bottom: 1px solid rgba(148,163,184,0.13); cursor: pointer; transition: background 0.12s ease; }
.anomaly-village:hover { background: #f8fafc; }
.av-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.av-name { font-weight: 650; color: #0f172a; font-size: 14px; }
.av-head .av-pct { margin-left: auto; font-size: 12px; font-weight: 600; color: #b45309; font-variant-numeric: tabular-nums; }
.ai-text { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: #475569; line-height: 1.6; margin-bottom: 10px; }
.ai-chip { flex: none; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; color: #fff; background: #6366f1; border-radius: 4px; padding: 1px 5px; line-height: 1.5; margin-top: 1px; }
.strategy-badge { flex: none; font-size: 10px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; font-weight: 600; }
.strategy-badge.convert { background: #fde8e8; color: #b91c1c; }
.strategy-badge.observe { background: #e6f1fb; color: #0369a1; }
.av-row { display: flex; align-items: center; gap: 12px; }
.detail-band { flex: 1; min-width: 0; display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: rgba(148,163,184,0.14); }
.band-seg { min-width: 0; }
.convert-btn { flex: none; padding: 4px 12px; border: 0; border-radius: 7px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
.convert-btn:hover { background: #b91c1c; }
.cancel-btn { flex: none; padding: 4px 12px; border: 1px solid #94a3b8; border-radius: 7px; background: #fff; color: #475569; font-size: 12px; cursor: pointer; }
.cancel-btn:hover { background: #f1f5f9; }
</style>
