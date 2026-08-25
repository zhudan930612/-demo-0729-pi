<template>
  <div class="agri-anomaly">
    <!-- 村级详情（选中异常乡镇） -->
    <div v-if="selectedTownship" class="anomaly-detail">
      <div class="detail-header">
        <button type="button" class="back-btn" aria-label="返回异常乡镇列表" @click="selectedTownship = null">‹</button>
        <span class="detail-title">{{ selectedTownship.countyName }} · {{ selectedTownship.name }}</span>
      </div>
      <div class="list-caption">异常村（极差+较差承保面积占比 > 50%，按占比降序）</div>
      <div v-if="villageRows.length === 0" class="empty">暂无异常村</div>
      <div v-for="v in villageRows" :key="v.code" class="anomaly-village">
        <div class="av-head">
          <span class="av-name">{{ v.name }}</span>
          <span v-if="v.consecutivePeriods >= 3" class="strategy-badge convert">建议转任务</span>
          <span v-else class="strategy-badge observe">建议待观察</span>
          <span class="av-period">连续{{ v.consecutivePeriods }}期异常</span>
        </div>
        <div class="av-bar">
          <div class="av-bar-fill" :style="{ width: pct(v.anomalyRatio) + '%' }"></div>
        </div>
        <div class="av-foot">
          <span class="av-pct">{{ pct(v.anomalyRatio) }}%</span>
          <button v-if="!converted.has(v.code)" type="button" class="convert-btn" @click="createTask(v)">一键转</button>
          <button v-else type="button" class="cancel-btn" @click="cancelConvert(v.code)">取消</button>
        </div>
      </div>
    </div>

    <!-- 主列表：异常乡镇（按 市·县 分栏） -->
    <template v-else>
      <div class="list-caption">异常乡镇（极差+较差承保面积占比 &gt; 50%，按占比降序）</div>
      <div v-if="townshipGroups.length === 0" class="empty">暂无异常</div>
      <template v-for="g in townshipGroups" :key="`${g.cityCode}-${g.countyCode}`">
        <div class="region-group-head">{{ g.cityName }} · {{ g.countyName }}</div>
        <button v-for="t in g.townships" :key="t.code" type="button" class="anomaly-row" @click="selectTownship(t)">
          <span class="row-name">{{ t.name }}</span>
          <span v-if="t.consecutivePeriods >= 3" class="strategy-badge convert">连续{{ t.consecutivePeriods }}期 → 转任务</span>
          <span v-else class="strategy-badge observe">连续{{ t.consecutivePeriods }}期 → 待观察</span>
          <div class="row-bar">
            <div class="row-bar-fill" :style="{ width: pct(t.anomalyRatio) + '%' }"></div>
          </div>
          <span class="row-pct">{{ pct(t.anomalyRatio) }}%</span>
        </button>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import type { GrowthLevel } from '../../features/agri-monitoring/agriMonitoringTypes'
import { aggregateRegion } from '../../features/agri-monitoring/agriRegionAggregate'
import {
  buildTownshipAnomalies, villageAnomaly, type TownshipAnomaly, type VillageAnomaly,
} from '../../features/agri-monitoring/agriAnomaly'
import { fetchJSON } from '../../api/data'

const agri = useAgriMonitoringStore()
const pct = (v: number) => Math.round((v ?? 0) * 100)
const converted = computed(() => agri.convertedSet)

const townshipRows = computed(() => buildTownshipAnomalies(agri.levelsByDate ?? [], agri.selectedDate))
const townshipGroups = computed(() => {
  const groups: Array<{ cityCode: string; cityName: string; countyCode: string; countyName: string; townships: TownshipAnomaly[] }> = []
  const map = new Map<string, (typeof groups)[number]>()
  for (const t of townshipRows.value) {
    const key = `${t.cityCode}-${t.countyCode}`
    let g = map.get(key)
    if (!g) { g = { cityCode: t.cityCode, cityName: t.cityName, countyCode: t.countyCode, countyName: t.countyName, townships: [] }; map.set(key, g); groups.push(g) }
    g.townships.push(t)
  }
  return groups
})

const selectedTownship = ref<TownshipAnomaly | null>(null)
const villageRows = ref<VillageAnomaly[]>([])

/** 生成某镇村级异常：参保村(真实 4 期) + 非参保村(on-demand 栅格 4 期)。 */
async function loadVillageAnomalies(t: TownshipAnomaly) {
  const raster = agri.raster
  if (!raster) { villageRows.value = []; return }
  const ins: VillageAnomaly[] = []
  const nonIns: VillageAnomaly[] = []
  // 参保村：从 villagesByDate(4期) 取该镇参保村的每期 levels
  const insuredCodes = new Set<string>()
  for (const dv of agri.villagesByDate ?? []) for (const v of dv) if (v.townshipCode === t.code) insuredCodes.add(v.code)
  for (const code of insuredCodes) {
    const name = (agri.villagesByDate?.[0] ?? []).find((v) => v.code === code)?.name ?? code
    const levelsPerDate = (agri.villagesByDate ?? []).map((dv) => dv.find((v) => v.code === code)?.levels)
    ins.push(villageAnomaly(code, name, levelsPerDate, agri.selectedDate))
  }
  // 非参保村：拉该镇村 geojson + 栅格 4 期
  try {
    const fc = await fetchJSON<{ features?: Array<{ properties?: { code?: unknown; name?: unknown }; geometry?: unknown }> }>(`/data/villages/${t.code}.geojson`)
    for (const f of fc.features ?? []) {
      const code = String(f.properties?.code ?? '')
      if (!code || insuredCodes.has(code) || !f.geometry) continue
      const levelsPerDate: Array<Record<GrowthLevel, number> | undefined> = []
      for (let di = 0; di < (agri.raster?.dates.length ?? 0); di++) {
        const a = aggregateRegion(raster, di, f.geometry as never)
        levelsPerDate.push(a?.levels)
      }
      const va = villageAnomaly(code, String(f.properties?.name ?? code), levelsPerDate, agri.selectedDate)
      if (va.isAnomaly) nonIns.push(va)
    }
  } catch { /* 忽略 */ }
  villageRows.value = [...ins, ...nonIns].filter((v) => v.isAnomaly).sort((a, b) => b.anomalyRatio - a.anomalyRatio)
}

function selectTownship(t: TownshipAnomaly) {
  selectedTownship.value = t
  void loadVillageAnomalies(t)
}
watch(() => agri.selectedDate, () => { if (selectedTownship.value) void loadVillageAnomalies(selectedTownship.value) })

function createTask(v: VillageAnomaly) {
  const task = agri.createTaskFromAnomaly(v)
  if (task) agri.setTab('tasks')
}
function cancelConvert(code: string) { agri.cancelConvertVillage(code) }
</script>

<style scoped>
.agri-anomaly { font-size: 12px; }
.list-caption { font-size: 10px; color: #475569; margin-bottom: 4px; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
.region-group-head { font-size: 10px; font-weight: 700; color: #1d4ed8; margin: 8px 0 3px; padding: 2px 6px; border-radius: 4px; background: #eff6ff; }
.anomaly-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 4px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.12); background: transparent; cursor: pointer; color: #334155; }
.anomaly-row:hover { background: #fef2f2; }
.row-name { width: 74px; flex: none; font-weight: 600; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-bar { flex: 1; min-width: 0; height: 10px; border-radius: 5px; background: #fee2e2; overflow: hidden; }
.row-bar-fill { height: 100%; background: #dc2626; border-radius: 5px; }
.row-pct { width: 38px; flex: none; text-align: right; font-weight: 600; color: #b91c1c; font-variant-numeric: tabular-nums; }
.strategy-badge { flex: none; font-size: 9px; padding: 1px 5px; border-radius: 8px; white-space: nowrap; }
.strategy-badge.convert { background: #fee2e2; color: #b91c1c; }
.strategy-badge.observe { background: #e0f2fe; color: #0369a1; }
.anomaly-detail .detail-header { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.back-btn { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #2563eb; font-size: 16px; cursor: pointer; }
.back-btn:hover { background: #eef2f7; }
.detail-title { font-size: 14px; font-weight: 600; color: #0f172a; }
.anomaly-village { padding: 6px 4px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.av-head { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.av-name { font-weight: 600; color: #0f172a; }
.av-period { font-size: 9px; color: #94a3b8; margin-left: auto; }
.av-bar { height: 8px; border-radius: 4px; background: #fee2e2; overflow: hidden; }
.av-bar-fill { height: 100%; background: #dc2626; border-radius: 4px; }
.av-foot { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.av-pct { font-weight: 700; color: #b91c1c; font-size: 11px; }
.convert-btn { margin-left: auto; padding: 2px 8px; border: 0; border-radius: 6px; background: #dc2626; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; }
.convert-btn:hover { background: #b91c1c; }
.cancel-btn { margin-left: auto; padding: 2px 8px; border: 1px solid #94a3b8; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; cursor: pointer; }
.cancel-btn:hover { background: #f1f5f9; }
</style>
