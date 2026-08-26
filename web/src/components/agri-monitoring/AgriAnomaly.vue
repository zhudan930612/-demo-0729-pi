<template>
  <div class="agri-anomaly">
    <div class="list-caption">异常村（最近一期极差+较差承保面积占比 &gt; 10%；AI 按严重度建议）</div>
    <div v-if="rows.length === 0" class="empty">暂无异常村</div>
    <div v-for="v in rows" :key="v.code" class="anomaly-village">
      <div class="av-head">
        <span class="av-name">{{ v.name }}</span>
        <span v-if="v.anomalyRatio >= 0.15" class="strategy-badge convert" :title="`最近一期极差+较差 ${pct(v.anomalyRatio)}%，建议转任务`">AI建议：转任务</span>
        <span v-else class="strategy-badge observe" :title="`最近一期极差+较差 ${pct(v.anomalyRatio)}%，发现异常建议继续观察`">AI建议：待观察</span>
        <span class="av-period">最近一期极差+较差 {{ pct(v.anomalyRatio) }}%</span>
      </div>
      <div class="detail-band">
        <div v-for="lv in levels" :key="lv" class="band-seg" :style="bandStyle(lv, v.levels[lv] ?? 0)" :title="`${label(lv)} ${pct(v.levels[lv] ?? 0)}%`"></div>
      </div>
      <div class="av-foot">
        <span class="av-pct">极差+较差 {{ pct(v.anomalyRatio) }}%（&gt;10% 为异常，≥15% 建议转任务）</span>
        <button v-if="!converted.has(v.code)" type="button" class="convert-btn" @click="createTask(v)">一键转</button>
        <button v-else type="button" class="cancel-btn" @click="cancelConvert(v.code)">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { GROWTH_LEVELS, LEVEL_COLORS, LEVEL_LABELS, type GrowthLevel } from '../../features/agri-monitoring/agriMonitoringTypes'
import { villageAnomaly, type VillageAnomaly } from '../../features/agri-monitoring/agriAnomaly'

const agri = useAgriMonitoringStore()
const levels = GROWTH_LEVELS
const pct = (v: number) => Math.round((v ?? 0) * 100)
const label = (lv: GrowthLevel) => LEVEL_LABELS[lv]
const converted = computed(() => agri.convertedSet)

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

function bandStyle(lv: GrowthLevel, ratio: number) {
  const [r, b, g] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${b},${g})`, flex: `0 0 ${Math.max(0, pct(ratio))}%` }
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
.anomaly-village { padding: 7px 4px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.av-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.av-name { font-weight: 600; color: #0f172a; }
.strategy-badge { flex: none; font-size: 9px; padding: 1px 6px; border-radius: 8px; white-space: nowrap; }
.strategy-badge.convert { background: #fee2e2; color: #b91c1c; }
.strategy-badge.observe { background: #e0f2fe; color: #0369a1; }
.av-period { font-size: 9px; color: #94a3b8; margin-left: auto; }
.detail-band { display: flex; height: 16px; border-radius: 4px; overflow: hidden; margin-bottom: 5px; }
.band-seg { display: flex; align-items: center; justify-content: center; min-width: 0; font-size: 9px; color: #fff; text-shadow: 0 0 1px rgba(0,0,0,0.5); }
.av-foot { display: flex; align-items: center; gap: 8px; }
.av-pct { font-weight: 700; color: #b91c1c; font-size: 11px; }
.convert-btn { margin-left: auto; padding: 2px 8px; border: 0; border-radius: 6px; background: #dc2626; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; }
.convert-btn:hover { background: #b91c1c; }
.cancel-btn { margin-left: auto; padding: 2px 8px; border: 1px solid #94a3b8; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; cursor: pointer; }
.cancel-btn:hover { background: #f1f5f9; }
</style>
