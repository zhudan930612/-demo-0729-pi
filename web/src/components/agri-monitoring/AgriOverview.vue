<template>
  <div class="agri-overview">
    <!-- 顶部当前层级概况 -->
    <section class="ov-summary">
      <div class="ov-title">{{ currentName }}</div>
      <div class="ov-metrics">
        <div class="metric"><span class="metric-label">承保面积</span><span class="metric-value">{{ fmtArea(currentArea) }}</span></div>
        <div class="metric"><span class="metric-label">承保户数</span><span class="metric-value">{{ householdCount }}</span></div>
      </div>
      <div class="ov-band" :class="{ empty: !hasAnyLevel }">
        <div v-for="lv in levels" :key="lv" v-show="villageLevels[lv] > 0" class="band-seg" :style="bandStyle(lv)" :title="`${label(lv)} ${pct(villageLevels[lv])}%`"></div>
      </div>
      <div class="ov-legend">
        <span v-for="lv in levels" :key="lv" class="ov-legend-item"><i class="ov-legend-swatch" :style="{ background: segColor(lv) }"></i>{{ label(lv) }} {{ pct(villageLevels[lv]) }}%</span>
      </div>
    </section>

    <!-- 非村：下一级区划列表；村：保单列表 -->
    <section class="ov-list">
      <div v-if="!isVillage" class="list-caption">下辖 {{ nextLevelName }}（按承保面积降序）</div>
      <div v-else class="list-caption">村内承保保单（按长势排序）</div>

      <div v-if="isVillage">
        <div v-if="policyRows.length === 0" class="empty">该村暂无保单数据</div>
        <div v-for="row in policyRows" :key="row.policyNo" class="policy-row">
          <div class="policy-head"><span class="policy-party">{{ row.insuredName }}</span><span class="policy-area">{{ fmtArea(row.insuredAreaMu) }} 亩</span></div>
          <div class="policy-meta"><span class="policy-no">保单 {{ row.policyNo }}</span></div>
          <div class="policy-levels" @mouseenter="showTip(row.levels, $event)" @mouseleave="hideTip">
            <div v-for="lv in levels" :key="lv" class="level-cell" :class="{ absent: !(row.levels[lv] > 0) }" :style="segCellStyle(lv, row.levels[lv])"></div>
          </div>
        </div>
      </div>
      <div v-else>
        <div v-if="childRows.length === 0" class="empty">暂无下一级区划数据</div>
        <button v-for="row in childRows" :key="row.code" type="button" class="child-row" :class="{ 'no-data': !row.levels }" @click="emit('select-child', { code: row.code, name: row.name, geometry: row.geometry, level: row.level })">
          <span class="child-name">{{ row.name }}</span>
          <div class="child-levels" :class="{ 'no-data': !row.levels }" @mouseenter="row.levels && showTip(row.levels, $event)" @mouseleave="hideTip">
            <template v-if="row.levels">
              <div v-for="lv in levels" :key="lv" class="level-cell" :class="{ absent: !(row.levels[lv] > 0) }" :style="segCellStyle(lv, row.levels[lv])"></div>
            </template>
            <span v-else class="child-nodata">—</span>
          </div>
          <span class="child-area">{{ row.area > 0 ? fmtArea(row.area) + ' 亩' : '—' }}</span>
        </button>
      </div>
    </section>

    <div v-if="hoverTip" class="cell-tooltip" :style="tipStyle">
      <span v-for="lv in levels" :key="lv" class="cell-tooltip-item"><i class="cell-tooltip-swatch" :style="{ background: segColor(lv) }"></i>{{ label(lv) }} {{ pct(hoverTip.levels[lv]) }}%</span>
    </div>
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
const hasAnyLevel = computed(() => levels.some((lv) => villageLevels.value[lv] > 0))

// 列表色带悬浮浮窗：fixed 定位固定在色带正下方居中（取容器视口坐标，不随鼠标移动，且不受面板 overflow 裁剪）
const hoverTip = ref<{ levels: Record<GrowthLevel, number>; top: number; left: number } | null>(null)
function showTip(levels: Record<GrowthLevel, number>, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  hoverTip.value = { levels, top: rect.bottom + 4, left: rect.left + rect.width / 2 }
}
function hideTip() { hoverTip.value = null }
const tipStyle = computed(() => {
  if (!hoverTip.value) return {}
  return { left: `${hoverTip.value.left}px`, top: `${Math.max(0, hoverTip.value.top)}px`, transform: 'translateX(-50%)' }
})
function segStyle(lv: GrowthLevel) {
  const [r, g, b] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${g},${b})` }
}
function segColor(lv: GrowthLevel) {
  return segStyle(lv).background
}
function segCellStyle(lv: GrowthLevel, v: number) {
  const [r, g, b] = LEVEL_COLORS[lv]
  return { background: `rgb(${r},${g},${b})`, flex: `0 0 ${Math.max(0, pct(v))}%` }
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
/* 概况区：层级名为头，metric 为基线对齐的次级数据行，色带为视觉重心 */
.ov-summary { border-bottom: 1px solid rgba(148,163,184,0.25); padding-bottom: 8px; margin-bottom: 8px; }
.ov-title { font-size: 15px; font-weight: 700; color: #1e3a8a; }
.ov-metrics { display: flex; align-items: baseline; gap: 20px; margin: 6px 0 8px; }
.metric { display: flex; align-items: baseline; gap: 5px; }
.metric-label { font-size: 10px; color: #64748b; }
.metric-value { font-size: 13px; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }
.ov-band { display: flex; height: 14px; border-radius: 3px; overflow: hidden; background: #e8edf3; }
.band-seg { min-width: 0; }
.ov-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 6px 0 2px; }
.ov-legend-item { display: flex; align-items: center; gap: 3px; font-size: 10px; color: #475569; white-space: nowrap; }
.ov-legend-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.ov-list .list-caption { font-size: 10px; color: #475569; margin: 8px 0 6px; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
/* 列表行，非村 / 村级共用同一横向节奏：名称(左) → 占比色带(中) → 面积(右) */
.child-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 4px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: #334155; }
.child-row:hover { background: #eef2f7; }
.child-row.no-data { cursor: default; }
.child-row.no-data:hover { background: transparent; }
.child-name { min-width: 66px; flex: none; font-weight: 600; text-align: left; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.child-row.no-data .child-name { color: #334155; }
.level-cell { flex: 1 1 0; min-width: 0; height: 12px; border-radius: 2px; }
.level-cell.absent { display: none; }
.child-levels { flex: 1; min-width: 0; display: flex; gap: 1px; position: relative; }
.child-levels.no-data { color: #cbd5e1; align-items: center; }
.child-nodata { font-size: 11px; color: #cbd5e1; }
.child-area { width: 60px; flex: none; text-align: right; color: #64748b; font-variant-numeric: tabular-nums; }
/* 村级保单行：投保人为主体，保单号降为次级标识，面积为右值 */
.policy-row { padding: 6px 4px; border-bottom: 1px solid rgba(148,163,184,0.12); }
.policy-row:last-child { border-bottom: 0; }
.policy-head { display: flex; align-items: baseline; gap: 10px; }
.policy-party { font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.policy-area { margin-left: auto; color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }
.policy-meta { margin: 1px 0 3px; }
.policy-no { display: block; font-size: 10px; color: #94a3b8; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.policy-levels { display: flex; gap: 2px; position: relative; }
.policy-levels .level-cell { height: 12px; }
/* 列表色带悬浮浮窗：fixed 定位固定在色带正下方居中（不随鼠标，不受面板 overflow 裁剪） */
.cell-tooltip { position: fixed; z-index: 1030; pointer-events: none; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 1px solid rgba(148,163,184,0.4); border-radius: 6px; background: #fff; box-shadow: 0 3px 10px rgba(15,23,42,0.18); color: #334155; font-size: 11px; white-space: nowrap; }
.cell-tooltip-item { display: flex; align-items: center; gap: 3px; }
.cell-tooltip-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.child-levels .level-cell, .policy-levels .level-cell { cursor: default; }
</style>
