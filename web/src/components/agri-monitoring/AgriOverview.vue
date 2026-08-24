<template>
  <div class="agri-overview">
    <!-- 顶部当前层级概况 -->
    <section class="ov-summary">
      <div class="ov-title">{{ currentName }}</div>
      <div class="ov-metrics">
        <div class="metric"><span class="metric-label">承保面积</span><span class="metric-value">{{ fmtArea(currentArea) }}</span></div>
        <div class="metric"><span class="metric-label">承保户数</span><span class="metric-value">{{ householdCount }}</span></div>
      </div>
      <div class="ov-band">
        <div v-for="lv in levels" :key="lv" v-show="villageLevels[lv] > 0" class="band-seg" :style="bandStyle(lv)" :title="`${label(lv)} ${pct(villageLevels[lv])}%`">
          <span class="band-pct">{{ pct(villageLevels[lv]) }}%</span>
        </div>
      </div>
    </section>

    <!-- 非村：下一级区划列表；村：保单列表 -->
    <section class="ov-list">
      <div v-if="!isVillage" class="list-caption">下辖 {{ nextLevelName }}（按承保面积降序）</div>
      <div v-else class="list-caption">村内承保保单（按长势排序）</div>

      <div v-if="isVillage">
        <div v-if="policyRows.length === 0" class="empty">该村暂无保单数据</div>
        <div v-for="row in policyRows" :key="row.policyNo" class="policy-row">
          <div class="policy-top"><span class="policy-no">{{ row.policyNo }}</span><span class="policy-party">{{ row.insuredName }}</span><span class="policy-area">{{ fmtArea(row.insuredAreaMu) }}亩</span></div>
          <div class="policy-levels">
            <div v-for="lv in levels" :key="lv" class="level-cell" :style="segStyle(lv)">{{ pct(row.levels[lv]) }}%</div>
          </div>
        </div>
      </div>
      <div v-else>
        <div v-if="childRows.length === 0" class="empty">暂无下一级区划数据</div>
        <button v-for="row in childRows" :key="row.code" type="button" class="child-row" :class="{ 'no-data': !row.levels }" @click="emit('select-child', { code: row.code, name: row.name, geometry: row.geometry, level: row.level })">
          <span class="child-name">{{ row.name }}</span>
          <div class="child-levels" :class="{ 'no-data': !row.levels }">
            <template v-if="row.levels">
              <div v-for="lv in levels" :key="lv" class="level-cell" :style="segStyle(lv)">{{ pct(row.levels[lv]) }}%</div>
            </template>
            <span v-else class="child-nodata">—</span>
          </div>
          <span class="child-area">{{ row.area > 0 ? fmtArea(row.area) : '—' }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDrilldownStore, childrenUrl, NEXT_LEVEL } from '../../stores/drilldown'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { GROWTH_LEVELS, LEVEL_COLORS, LEVEL_LABELS, type GrowthLevel } from '../../features/agri-monitoring/agriMonitoringTypes'
import { fetchJSON } from '../../api/data'

const emit = defineEmits<{ 'select-child': [row: { code: string; name: string; geometry: unknown; level: string }] }>()
const store = useDrilldownStore()
const agri = useAgriMonitoringStore()

const levels = GROWTH_LEVELS
const isVillage = computed(() => store.current.level === 'village')
const currentName = computed(() => store.current.name)
const currentCode = computed(() => store.current.code)

const label = (lv: GrowthLevel) => LEVEL_LABELS[lv]
const pct = (v: number) => Math.round((v ?? 0) * 100)
const fmtArea = (v: number) => Math.round(v).toLocaleString()
const nextLevelName = computed(() => ({
  province: '市级', city: '县级', county: '乡级', township: '村级', village: '',
} as Record<string, string>)[store.current.level])

function bandStyle(lv: GrowthLevel) {
  const [r, g, b] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${g},${b})`, flex: `0 0 ${Math.max(0, pct(villageLevels.value[lv]))}%` }
}

// 当前层级聚合（省/市/县/镇 from byCode；村 from villages）
const currentArea = computed(() => {
  if (isVillage.value) return agri.villages?.find((v) => v.code === currentCode.value)?.insuredAreaMu ?? 0
  return agri.levels?.[currentCode.value]?.insuredAreaMu ?? 0
})
const householdCount = computed(() => {
  if (isVillage.value) return agri.villages?.find((v) => v.code === currentCode.value)?.householdCount ?? 0
  return agri.levels?.[currentCode.value]?.householdCount ?? 0
})
const villageLevels = computed<Record<GrowthLevel, number>>(() => {
  if (isVillage.value) return agri.villages?.find((v) => v.code === currentCode.value)?.levels ?? zeroLevels()
  return agri.levels?.[currentCode.value]?.levels ?? zeroLevels()
})

function zeroLevels(): Record<GrowthLevel, number> {
  return { veryPoor: 0, poor: 0, normal: 0, good: 0, excellent: 0 }
}
function segStyle(lv: GrowthLevel) {
  const [r, g, b] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${g},${b})` }
}

// 村级保单列表（按长势排序：极差→极好，异常置顶）
interface PolicyRow { policyNo: string; insuredName: string; insuredAreaMu: number; levels: Record<GrowthLevel, number> }
const policyRows = computed<PolicyRow[]>(() => {
  if (!isVillage.value) return []
  const rows = agri.policyGrowth[currentCode.value] ?? []
  return [...rows]
    .map((r) => ({ policyNo: r.policyNo, insuredName: r.insuredName, insuredAreaMu: r.insuredAreaMu, levels: r.levels }))
    .sort((a, b) => sortByGrowth(a.levels) - sortByGrowth(b.levels))
})
function sortByGrowth(l: Record<GrowthLevel, number>): number {
  // 极差/较差权重高 → 值小（排在前面）
  return -(l.veryPoor * 4) - (l.poor * 3) - (l.normal * 2) + l.good + l.excellent * 2
}

// 下一级区划列表（省→市→县→镇；镇→村）
interface ChildRow { code: string; name: string; area: number; levels: Record<GrowthLevel, number> | null; geometry: unknown; level: string }
const childRows = ref<ChildRow[]>([])
watch(() => [currentCode.value, store.current.level] as const, () => { void loadChildren() })

async function loadChildren() {
  const crumb = store.current
  const url = childrenUrl(crumb)
  if (!url || isVillage.value) { childRows.value = []; return }
  let render: Array<{ code: string; name: string; geometry: unknown }> = []
  try {
    const fc = await fetchJSON<{ features?: Array<{ properties?: { code?: unknown; name?: unknown }; geometry?: unknown }> }>(url)
    render = (fc.features ?? []).map((f) => ({ code: String(f.properties?.code ?? ''), name: String(f.properties?.name ?? ''), geometry: f.geometry }))
  } catch { render = [] }
  const nextLevel = NEXT_LEVEL[crumb.level]
  const rows: ChildRow[] = render.map((c) => {
    let area = 0; let lev: Record<GrowthLevel, number> | null = null
    if (nextLevel === 'village') {
      const v = agri.villages?.find((vv) => vv.code === c.code)
      if (v && v.data) { area = v.insuredAreaMu; lev = v.levels }
    } else {
      const agg = agri.levels?.[c.code]
      if (agg && agg.data) { area = agg.insuredAreaMu; lev = agg.levels }
    }
    return { code: c.code, name: c.name, area, levels: lev, geometry: c.geometry, level: nextLevel ?? '' }
  })
  rows.sort((a, b) => b.area - a.area)
  childRows.value = rows
}

watch(() => agri.villages ?? null, () => { void loadChildren() })
watch(() => agri.levels ?? null, () => { void loadChildren() })
void loadChildren()
</script>

<style scoped>
.agri-overview { font-size: 12px; }
.ov-summary { border-bottom: 1px solid rgba(148,163,184,0.25); padding-bottom: 8px; margin-bottom: 6px; }
.ov-title { font-size: 14px; font-weight: 600; color: #0f172a; }
.ov-metrics { display: flex; gap: 16px; margin: 6px 0 8px; }
.metric { display: flex; flex-direction: column; }
.metric-label { font-size: 10px; color: #64748b; }
.metric-value { font-size: 16px; font-weight: 700; color: #1e3a8a; font-variant-numeric: tabular-nums; }
.ov-band { display: flex; height: 18px; border-radius: 4px; overflow: hidden; }
.band-seg { display: flex; align-items: center; justify-content: center; min-width: 0; }
.band-pct { font-size: 9px; color: #fff; text-shadow: 0 0 1px rgba(0,0,0,0.5); white-space: nowrap; }
.ov-list .list-caption { font-size: 10px; color: #475569; margin: 6px 0; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
.child-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 4px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: #334155; }
.child-row:hover { background: #eef2f7; }
.child-row.no-data { cursor: default; }
.child-row.no-data:hover { background: transparent; }
.child-name { width: 76px; flex: none; font-weight: 600; text-align: left; }
.child-levels { flex: 1; display: flex; gap: 1px; }
.child-levels.no-data { color: #cbd5e1; align-items: center; }
.child-nodata { font-size: 11px; color: #cbd5e1; }
.level-cell { flex: 1; height: 12px; border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: #fff; overflow: hidden; }
.child-area { width: 52px; flex: none; text-align: right; color: #64748b; font-variant-numeric: tabular-nums; }
.policy-row { padding: 5px 4px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.policy-top { display: flex; align-items: center; gap: 8px; }
.policy-no { font-weight: 600; color: #1e3a8a; }
.policy-party { flex: 1; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.policy-area { color: #64748b; font-variant-numeric: tabular-nums; }
.policy-levels { display: flex; gap: 2px; margin-top: 3px; }
.policy-levels .level-cell { height: 12px; }
</style>
