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

      <!-- 灾损预估 tab（默认，R4） -->
      <section v-if="activeTab === 'loss'" class="tab-pane loss-pane" data-test="dw-loss-pane">
        <div class="loss-title-row">
          <span class="loss-title">{{ regionName }} · 灾损预估</span>
        </div>
        <div v-if="phase === 'ready'" class="loss-subtitle" data-test="dw-loss-title">{{ lossTitle }}</div>
        <div class="loss-metrics">
          <div class="loss-metric"><span class="loss-metric-label">受灾面积</span><span class="loss-metric-value" data-test="dw-loss-area">{{ lossAreaText }}</span><span class="loss-metric-unit">万亩</span></div>
          <div class="loss-metric"><span class="loss-metric-label">涉及户数</span><span class="loss-metric-value" data-test="dw-loss-households">{{ lossHouseholdsText }}</span><span class="loss-metric-unit">户</span></div>
          <div class="loss-metric"><span class="loss-metric-label">赔偿金额</span><span class="loss-metric-value" data-test="dw-loss-amount">{{ lossAmountText }}</span><span class="loss-metric-unit">万元</span></div>
        </div>
        <!-- 村级风险分布：占比色带 + 色点明细行（R4-7） -->
        <div v-if="phase === 'ready' && riskBand.length > 0" class="loss-band-wrap" data-test="dw-risk-band">
          <div class="band-caption">村级风险分布（按承保面积）</div>
          <div class="detail-band">
            <div v-for="seg in riskBand" :key="seg.level" class="band-seg" :style="bandSegStyle(seg)" :title="`${seg.name} ${seg.pct}%`"></div>
          </div>
          <div class="band-detail-rows">
            <div v-for="seg in riskBand" :key="seg.level" class="band-detail-row">
              <i class="risk-dot" :style="{ background: riskDotColor(seg.level) }"></i>
              <span class="risk-name">{{ seg.name }}</span>
              <span class="risk-count">{{ seg.count }} 村</span>
              <span class="risk-area">{{ seg.areaText }}</span>
            </div>
          </div>
        </div>
        <p class="loss-hint" data-test="dw-loss-hint">{{ lossHint }}</p>
      </section>

      <!-- 预警监测 tab（R3-9~R3-18） -->
      <section v-if="activeTab === 'warning'" class="tab-pane warning-pane" data-test="dw-warning-pane">
        <!-- 表头：概览 + ⓘ + 一键派发 + 自动/人工开关（固定，列表区内滚） -->
        <div class="warning-head">
          <div class="warning-head-row">
            <span class="warning-overview" data-test="dw-warning-overview">{{ overviewText }}</span>
            <span class="rule-info" data-test="dw-rule-info" @mouseenter="showRuleTip" @mouseleave="hideRuleTip" aria-label="触发规则说明">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
            </span>
            <button v-if="dispatchMode === 'manual' && pendingDispatchCount > 0" type="button" class="batch-btn" data-test="dw-batch-dispatch" @click="emit('dispatch-all')">一键派发</button>
          </div>
          <div class="warning-head-row dispatch-row">
            <span class="dispatch-label">派发模式</span>
            <div class="mode-switch" role="group" aria-label="派发模式" data-test="dw-mode-switch">
              <button type="button" :class="{ active: dispatchMode === 'manual' }" data-test="dw-mode-manual" @click="emit('set-dispatch-mode', 'manual')">人工</button>
              <button type="button" :class="{ active: dispatchMode === 'auto' }" data-test="dw-mode-auto" @click="emit('set-dispatch-mode', 'auto')">自动</button>
            </div>
          </div>
          <div v-if="ruleTip" class="cell-tooltip" :style="tipStyle">未来 24h 预报雨量触发：≥130mm 低风险 / ≥160mm 中风险 / ≥185mm 高风险；升级立即生效，降级需连续 2 节点低于阈值</div>
        </div>
        <!-- 卡片列表（前 10 条，超高内滚） -->
        <div v-if="phase === 'error'" class="empty-state" data-test="dw-warning-empty">暂无预警村（数据缺失）</div>
        <div v-else-if="sortedWarnings.length === 0" class="empty-state" data-test="dw-warning-empty">暂无预警村</div>
        <div v-else class="warning-list">
          <div v-for="entry in listWarnings" :key="entry.village.code" class="warning-card" data-test="dw-warning-card" @click="emit('select-village', entry.village.code)">
            <div class="wc-head">
              <span class="wc-name">{{ entry.village.name }}</span>
              <span class="wc-status" :class="entry.level >= 2 ? 'todo' : 'observe'">{{ statusLabel(entry.level) }}</span>
              <span class="wc-level-dot" :style="{ background: levelColor(entry.level) }"></span>
              <span class="wc-rain">{{ future24Text(entry) }}</span>
            </div>
            <div class="ai-text"><span class="ai-chip">AI</span><span>{{ aiAdvice(entry.level) }}</span></div>
            <div class="wc-actions">
              <button
                v-if="!isDispatched(entry.village.code)"
                type="button"
                class="dispatch-btn"
                data-test="dw-dispatch-village"
                @click.stop="emit('dispatch-village', entry.village.code)"
              >派发任务</button>
              <button v-else type="button" class="dispatch-btn done" disabled data-test="dw-dispatched">已派发</button>
            </div>
          </div>
          <button v-if="sortedWarnings.length > PAGE_SIZE" type="button" class="view-all-bottom" data-test="dw-view-all" @click="emit('open-warning-drawer')">查看全部预警（{{ sortedWarnings.length }}）</button>
        </div>
      </section>

      <!-- 任务列表 tab（R5-12~R5-14, R6） -->
      <section v-if="activeTab === 'tasks'" class="tab-pane task-pane" data-test="dw-task-pane">
        <div v-if="phase === 'error'" class="empty-state" data-test="dw-task-empty">暂无任务（派发不可用）</div>
        <template v-else-if="phase === 'ready'">
          <div v-if="!visibleTask" class="task-list-pane">
            <div class="status-filter" aria-label="任务状态筛选">
              <button v-for="s in statusFilters" :key="s" type="button" class="sf-item" :class="[`sf-${sfKey(s)}`, { active: statusFilter === s }]" @click="statusFilter = s">{{ s }}</button>
            </div>
            <div v-if="filteredTasks.length === 0" class="empty-state">暂无任务</div>
            <button v-for="t in listTasks" :key="t.id" type="button" class="task-row" data-test="dw-task-row" @click="openTask(t.id)">
              <span class="task-main">
                <span class="task-eyebrow">{{ t.taskNo }}</span>
                <span class="task-name">{{ t.name }}</span>
                <span class="task-meta">
                  <i class="task-level-dot" :style="{ background: t.warningLevel ? levelColor(t.warningLevel) : '#94a3b8' }"></i>
                  {{ t.typeName }} · {{ t.villageName }}
                </span>
                <span v-if="t.released" class="released-hint" data-test="dw-task-released">⚠ 关联预警已解除</span>
              </span>
              <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
            </button>
            <button v-if="filteredTasks.length > 0" type="button" class="view-all-bottom" data-test="dw-view-all-tasks" @click="emit('open-task-drawer')">查看全部任务</button>
          </div>
          <!-- 任务详情（R5-13/R6） -->
          <div v-else class="task-detail">
            <div class="detail-header">
              <button type="button" class="back-btn" aria-label="返回任务列表" @click="closeTask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
              <span class="detail-title">{{ visibleTask.taskNo }}</span>
            </div>
            <div class="detail-group">
              <div class="group-label">基础信息</div>
              <div class="detail-meta">
                <div class="meta-row"><span class="meta-label">状态</span><span class="meta-value"><span class="task-status" :class="`st-${statusKey(visibleTask.status)}`">{{ visibleTask.status }}</span></span></div>
                <div class="meta-row"><span class="meta-label">任务类型</span><span class="meta-value">{{ visibleTask.typeName }}</span></div>
                <div class="meta-row"><span class="meta-label">任务描述</span><span class="meta-value">{{ visibleTask.name }}</span></div>
                <div class="meta-row"><span class="meta-label">预警等级</span><span class="meta-value"><i class="task-level-dot" :style="{ background: visibleTask.warningLevel ? levelColor(visibleTask.warningLevel) : '#94a3b8' }"></i>{{ visibleTask.warningLevel ? levelText(visibleTask.warningLevel) : '—' }}</span></div>
                <div class="meta-row"><span class="meta-label">关联预警</span><span class="meta-value">{{ visibleTask.villageName }}{{ visibleTask.released ? '（已解除）' : '' }}</span></div>
                <div class="meta-row"><span class="meta-label">创建时间</span><span class="meta-value">{{ visibleTask.createdAt }}</span></div>
              </div>
            </div>
            <div class="detail-group">
              <div class="group-label">处置说明</div>
              <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ visibleTask.sopAction }}</div></div>
              <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ visibleTask.requirement }}</div></div>
            </div>
            <div class="detail-group">
              <div class="group-label">变化记录</div>
              <div class="history-list" data-test="dw-task-history">
                <div v-for="(h, idx) in visibleTask.history" :key="idx" class="history-row"><span class="history-time">{{ h.time }}</span><span class="history-text">{{ h.text }}</span></div>
              </div>
            </div>
            <div class="detail-group">
              <div class="group-label">影像资料</div>
              <div v-if="visibleTask.status !== '已完成'" class="sec-body pending-evidence" data-test="dw-evidence-pending">待取证</div>
              <template v-else>
                <div v-if="visibleTask.evidence.length === 0" class="sec-body" data-test="dw-evidence-pending">待取证</div>
                <div v-else class="ev-grid" data-test="dw-evidence">
                  <button v-for="e in visibleTask.evidence" :key="e.url" type="button" class="ev-thumb" @click="openLightbox(e)">
                    <img :src="e.url" alt="证据缩略图" />
                    <span class="ev-time">{{ e.time }}</span>
                  </button>
                </div>
              </template>
              <p class="ev-demo-note">演示数据：占位图，仅用于演示取证流程</p>
            </div>
          </div>
        </template>
        <div v-else class="empty-state">暂无任务</div>
      </section>
    </div>

    <!-- 全部预警抽屉（R3-18） -->
    <Teleport to="body">
      <Transition name="side-drawer">
        <aside v-if="drawerOpen" class="dw-drawer" aria-label="全部预警" data-test="dw-drawer">
          <header class="dw-drawer-header">
            <div><span class="dw-drawer-eyebrow">预警村清单</span><h2 class="dw-drawer-title">全部预警</h2></div>
            <button type="button" class="dw-drawer-close" aria-label="关闭" @click="emit('close-warning-drawer')">×</button>
          </header>
          <div class="dw-drawer-list">
            <button v-for="entry in sortedWarnings" :key="entry.village.code" type="button" class="dw-drawer-card" @click="emit('select-village', entry.village.code)">
              <span class="dc-main">
                <span class="dc-name">{{ entry.village.name }}</span>
                <span class="dc-meta">{{ entry.village.countyCode }} · 未来24h {{ future24Text(entry) }}</span>
              </span>
              <span class="wc-status" :class="entry.level >= 2 ? 'todo' : 'observe'">{{ statusLabel(entry.level) }}</span>
              <i class="task-level-dot" :style="{ background: levelColor(entry.level) }"></i>
            </button>
          </div>
        </aside>
      </Transition>
    </Teleport>

    <!-- 全部任务抽屉（R5-14） -->
    <Teleport to="body">
      <Transition name="side-drawer">
        <aside v-if="taskDrawerOpen" class="dw-drawer" aria-label="全部任务" data-test="dw-task-drawer">
          <header class="dw-drawer-header">
            <div><span class="dw-drawer-eyebrow">任务清单</span><h2 class="dw-drawer-title">全部任务</h2></div>
            <button type="button" class="dw-drawer-close" aria-label="关闭" @click="closeTaskDrawer">×</button>
          </header>
          <div class="dw-drawer-tools">
            <input v-model.trim="taskQuery" type="search" placeholder="搜索任务名称或村" />
          </div>
          <div class="dw-drawer-list">
            <div v-if="filteredAllTasks.length === 0" class="empty-state">暂无任务</div>
            <button v-for="t in filteredAllTasks" :key="t.id" type="button" class="dw-drawer-card" data-test="dw-task-drawer-row" @click="selectFromTaskDrawer(t.id)">
              <span class="dc-main">
                <span class="dc-name">{{ t.name }}</span>
                <span class="dc-meta"><i class="task-level-dot" :style="{ background: t.warningLevel ? levelColor(t.warningLevel) : '#94a3b8' }"></i>{{ t.taskNo }} · {{ t.typeName }} · {{ t.villageName }}{{ t.released ? ' · ⚠ 关联预警已解除' : '' }}</span>
              </span>
              <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
            </button>
          </div>
        </aside>
      </Transition>
    </Teleport>

    <!-- 大图浮窗（R6-1） -->
    <Teleport to="body">
      <div v-if="lightbox" class="lightbox-overlay" @click.self="closeLightbox">
        <div class="lightbox">
          <img :src="lightbox.url" alt="证据大图" />
          <span class="lb-count">{{ lightbox.time }}</span>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisasterWarningStore } from '../../stores/disasterWarning'
import { DISASTER_WARNING_TABS, type DisasterWarningTab } from '../../features/disaster-warning/types'
import type { DisasterWarningPhase } from '../../stores/disasterWarning'
import {
  warnedVillagesAtNode, warningOverview,
  WARNING_STATUS_LABEL, WARNING_LEVEL_COLOR, aiAdviceForLevel,
} from '../../features/disaster-warning/disasterWarningSelectors'
import { DISASTER_TASK_STATUSES, type DisasterDispatchMode } from '../../stores/disasterWarning'
import type { DisasterWarningLevel as DWLevel } from '../../features/disaster-warning/types'

const PAGE_SIZE = 10

const props = defineProps<{
  phase: DisasterWarningPhase
  activeTab: DisasterWarningTab
  errorMessage: string
  regionName: string
  /** 当前下钻层级/编码（R4-3 灾损按层级刷新） */
  currentLevel: string
  currentCode: string
}>()
const emit = defineEmits<{
  close: []
  'select-tab': [tab: DisasterWarningTab]
  'select-village': [code: string]
  'dispatch-village': [code: string]
  'dispatch-all': []
  'set-dispatch-mode': [mode: DisasterDispatchMode]
  'open-warning-drawer': []
  'close-warning-drawer': []
  'open-task-drawer': []
}>()

const tabs = DISASTER_WARNING_TABS
const store = useDisasterWarningStore()
const closeLabel = computed(() => '退出受灾预警')

// ---- 预警监测（R3-9~R3-18） ----
const nodeIndex = computed(() => store.nodeIndex)
// ---- 面板静态数据：按节点查表（省市级零计算，ADR-0009） ----
const panelNode = computed(() => {
  if (!store.panel) return null
  return store.panel.perNode.find((n) => n.i === nodeIndex.value) ?? null
})
// 当前节点预警村（原始 w 顺序），village 从 warnings.villages 取
const warningEntries = computed(() => {
  if (!store.warnings) return []
  return warnedVillagesAtNode(store.warnings, nodeIndex.value)
})
// 预警村（已按 等级高→低 + 未来24h降序 预排序，直接查表，不再 sortWarnedVillages）
const sortedWarnings = computed(() => {
  const pn = panelNode.value
  const warnings = store.warnings
  if (!pn || !warnings) return []
  return pn.sorted.map((idx) => {
    const village = warnings.villages[idx]
    const pv = pn.byIdx[String(idx)]
    return village ? { villageIndex: idx, village, level: (pv?.level ?? 1) as DWLevel } : null
  }).filter((e) => e !== null) as Array<{ villageIndex: number; village: (typeof warnings.villages)[number]; level: DWLevel }>
})
const overview = computed(() => warningOverview(warningEntries.value))
const overviewText = computed(() => `预警村 ${overview.value.total}（高 ${overview.value.high} · 中 ${overview.value.mid} · 低 ${overview.value.low}）`)
const listWarnings = computed(() => sortedWarnings.value.slice(0, PAGE_SIZE))
const dispatchMode = computed(() => store.dispatchMode)
const pendingDispatchCount = computed(() => sortedWarnings.value.filter((e) => e.level >= 2 && !store.isDispatched(e.village.code)).length)

function statusLabel(level: number): string { return WARNING_STATUS_LABEL[level as DWLevel] ?? '—' }
function levelColor(level: number): string { return WARNING_LEVEL_COLOR[level as DWLevel] ?? '#94a3b8' }
function levelText(level: number): string { return level === 3 ? '高风险' : level === 2 ? '中风险' : level === 1 ? '低风险' : '—' }
function aiAdvice(level: number): string { return aiAdviceForLevel(level as DWLevel) }
// 未来 24h 预报雨量：直接查表（panel byIdx[idx].future24），不再实时 future24RainByGrid
function future24Text(entry: { villageIndex: number; village: { code: string } }): string {
  const pn = panelNode.value
  const pv = pn?.byIdx[String(entry.villageIndex)]
  return pv ? `未来24h ${pv.future24.toFixed(0)}mm` : ''
}
function isDispatched(code: string): boolean { return store.isDispatched(code) }

// 规则 ⓘ 提示
const ruleTip = ref<{ top: number; left: number } | null>(null)
function showRuleTip(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  ruleTip.value = { top: rect.bottom + 6, left: rect.left + rect.width / 2 }
}
function hideRuleTip() { ruleTip.value = null }
const tipStyle = computed(() => {
  if (!ruleTip.value) return {}
  return { left: `${ruleTip.value.left}px`, top: `${Math.max(0, ruleTip.value.top)}px`, transform: 'translateX(-50%)' }
})

// ---- 灾损预估（R4） ----
const lossTitle = computed(() => {
  const time = store.nodeTimeLabel
  return `${props.regionName} · 截至 ${time}`
})
const lossSummary = computed(() => {
  if (store.phase !== 'ready' || !store.panel) return { areaWanMu: 0, households: 0, amountWanYuan: 0 }
  const pn = panelNode.value
  if (!pn) return { areaWanMu: 0, households: 0, amountWanYuan: 0 }
  // 按当前层级过滤预警村（R4-3）
  const level = props.currentLevel
  const code = props.currentCode
  // 省级：直接查表（已预算好的省级灾损三项）
  if (!level || level === 'province') return pn.loss
  // 下钻市/县/乡/村：从 byIdx 按层级 filter 出该片区村，累计其已预算的 areaMu/amountYuan/households
  let areaMu = 0
  let households = 0
  let amountYuan = 0
  for (const idx of pn.sorted) {
    const pv = pn.byIdx[String(idx)]
    const v = store.warnings?.villages[idx]
    if (!pv || !v) continue
    if (level === 'city') { if (v.cityCode !== code) continue }
    else if (level === 'county') { if (v.countyCode !== code) continue }
    else if (level === 'township') { if (v.townshipCode !== code) continue }
    else { if (v.code !== code) continue }
    areaMu += pv.areaMu
    households += pv.households
    amountYuan += pv.amountYuan
  }
  return { areaWanMu: areaMu / 10000, households, amountWanYuan: amountYuan / 10000 }
})
const lossAreaText = computed(() => props.phase === 'error' ? '0' : formatWan(rollingArea.value))
const lossHouseholdsText = computed(() => props.phase === 'error' ? '0' : String(Math.round(rollingHouseholds.value)))
const lossAmountText = computed(() => props.phase === 'error' ? '0' : formatWan(rollingAmount.value))
// R4-2 数字随播放刷新：直接读预算好的 lossSummary（不做滚动动效——rAF 逐帧动画在数据变大时反复触发、每帧驱动模板重渲染，是卡顿主因之一）
const rollingArea = computed(() => lossSummary.value.areaWanMu)
const rollingHouseholds = computed(() => lossSummary.value.households)
const rollingAmount = computed(() => lossSummary.value.amountWanYuan)

const lossHint = computed(() => {
  if (props.phase === 'error') return '数据缺失，灾损预估不可用'
  if (props.phase === 'loading') return '加载中…'
  return '灾损预估随台风播放与村级预警联动刷新'
})

// 村级风险分布（R4-7）：分母 = 当前层级全部承保面积（含无风险村）
// 村码即层级编码：city=code[0:4]+'00'、county=code[0:6]、township=code[0:9]+'000'（与 check-codes 口径一致）
function adminCodesOf(code: string): { city: string; county: string; township: string } {
  return { city: `${code.slice(0, 4)}00`, county: code.slice(0, 6), township: `${code.slice(0, 9)}000` }
}
const riskBand = computed(() => {
  if (store.phase !== 'ready' || !store.underwriting) return []
  const level = props.currentLevel
  const code = props.currentCode
  let totalArea = 0
  const buckets = [
    { level: 0 as const, name: '无风险', count: 0, area: 0, coeff: 0.2 },
    { level: 1 as const, name: '低', count: 0, area: 0, coeff: 0.4 },
    { level: 2 as const, name: '中', count: 0, area: 0, coeff: 0.7 },
    { level: 3 as const, name: '高', count: 0, area: 0, coeff: 1.0 },
  ]
  const inRegion = (v: { code: string }) => {
    const admin = adminCodesOf(v.code)
    if (!level || level === 'province') return true
    if (level === 'city') return admin.city === code
    if (level === 'county') return admin.county === code
    if (level === 'township') return admin.township === code
    return v.code === code
  }
  for (const v of store.underwriting.villages) {
    if (!inRegion(v)) continue
    totalArea += v.insuredAreaMu
    const warned = warningEntries.value.find((e) => e.village.code === v.code)
    if (!warned) { buckets[0]!.count += 1; buckets[0]!.area += v.insuredAreaMu; continue }
    // 预警村：从 panel byIdx 读累计雨量/风险等级（免实时算格点）
    const riskLevel = riskLevelForCum(warned.villageIndex)
    buckets[riskLevel]!.count += 1
    buckets[riskLevel]!.area += v.insuredAreaMu
  }
  return buckets.map((b) => ({ ...b, pct: totalArea > 0 ? (b.area / totalArea) * 100 : 0, areaText: formatArea(b.area) }))
})

function riskLevelForCum(idx: number): 0 | 1 | 2 | 3 {
  const pv = panelNode.value?.byIdx[String(idx)]
  if (!pv) return 0
  if (pv.cumRain >= 150) return 3
  if (pv.cumRain >= 100) return 2
  if (pv.cumRain >= 50) return 1
  return 0
}
function formatWan(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 0.01) return value.toFixed(2)
  if (value < 100) return value.toFixed(1)
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function formatArea(mu: number): string {
  if (mu >= 10000) return `${(mu / 10000).toFixed(1)} 万亩`
  return `${Math.round(mu).toLocaleString('zh-CN')} 亩`
}
function bandSegStyle(seg: { level: number; pct: number }) {
  return { background: riskDotColor(seg.level), flex: `0 0 ${Math.max(0, seg.pct)}%` }
}
function riskDotColor(level: number): string {
  if (level === 3) return '#b91c1c'
  if (level === 2) return '#ca8a04'
  if (level === 1) return '#166534'
  return '#94a3b8'
}

// ---- 任务列表（R5-12~R5-14, R6） ----
const drawerOpen = computed(() => store.warningDrawerOpen)
const statusFilter = ref<string>('全部')
const statusFilters = ['全部', ...DISASTER_TASK_STATUSES]
const visibleTask = computed(() => store.visibleTask)
const filteredTasks = computed(() => {
  let tasks = store.tasks
  if (statusFilter.value !== '全部') tasks = tasks.filter((t) => t.status === statusFilter.value)
  return tasks
})
const listTasks = computed(() => [...filteredTasks.value].sort((a, b) => b.createdAtNode - a.createdAtNode).slice(0, PAGE_SIZE))
const statusKey = (s: string) => (s === '待领取' ? 'claim' : s === '进行中' ? 'doing' : 'done')
const sfKey = (s: string) => (s === '全部' ? 'all' : statusKey(s))
function openTask(id: string) { store.openTask(id) }
function closeTask() { store.closeTask() }

// 证据大图
const lightbox = ref<{ url: string; time: string } | null>(null)
function openLightbox(e: { url: string; time: string }) { lightbox.value = e }
function closeLightbox() { lightbox.value = null }

// 全部任务抽屉（R5-14）
const taskDrawerOpen = computed(() => store.taskDrawerOpen)
const taskQuery = ref('')
const filteredAllTasks = computed(() => {
  let tasks = store.tasks
  const q = taskQuery.value.trim().toLowerCase()
  if (q) tasks = tasks.filter((t) => [t.name, t.villageName, t.taskNo].some((f) => f.toLowerCase().includes(q)))
  return [...tasks].sort((a, b) => b.createdAtNode - a.createdAtNode)
})
function selectFromTaskDrawer(id: string) {
  store.openTask(id)
  store.closeTaskDrawer()
}
function closeTaskDrawer() { store.closeTaskDrawer() }
</script>

<style scoped>
.disaster-warning-panel {
  position: absolute; top: 12px; right: 12px; z-index: 1010;
  width: 380px; max-width: calc(100% - 24px); box-sizing: border-box;
  display: flex; flex-direction: column; overflow: hidden;
  max-height: min(calc(100vh - 160px), 65vh);
  border: 5px solid #2563eb; border-radius: 10px;
  background: #2563eb;
  box-shadow: 0 7px 22px rgba(15, 23, 42, 0.24);
  color: #0f172a; font-size: 12px;
}
.panel-header {
  height: 34px; flex: none; display: flex; align-items: stretch; justify-content: space-between; gap: 8px; padding: 0 4px 0 0; color: #fff;
}
.tab-list { display: flex; flex: 1; align-items: stretch; gap: 2px; padding: 3px 2px 0; min-width: 0; }
.tab-list button {
  height: 100%; min-width: 64px; padding: 0 12px; border: 0; border-radius: 6px 6px 0 0;
  background: transparent; color: #bfdbfe; font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.tab-list button:hover:not([aria-selected='true']) { color: #fff; background: rgba(255,255,255,0.1); }
.tab-list button[aria-selected='true'] { background: #fff; color: #1d4ed8; font-weight: 700; }
.tab-list button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.close-button {
  width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: #bfdbfe; cursor: pointer;
}
.close-button:hover { background: rgba(255,255,255,0.16); color: #fff; }
.close-button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.close-button svg { width: 15px; height: 15px; }
.panel-body { flex: 1 1 auto; min-height: 0; padding: 8px 10px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
.panel-status { padding: 8px 10px; margin-bottom: 8px; border-radius: 6px; background: #f1f5f9; color: #64748b; font-size: 11px; }
.panel-status.error { background: #fef2f2; color: #991b1b; }
.tab-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 0; }
.loss-title-row { display: flex; align-items: center; gap: 6px; }
.loss-title { font-size: 15px; font-weight: 700; color: #1e3a8a; }
.loss-subtitle { color: #64748b; font-size: 11px; }
.loss-metrics { display: flex; align-items: baseline; gap: 20px; margin: 10px 0 14px; }
.loss-metric { display: flex; align-items: baseline; gap: 5px; }
.loss-metric-label { color: #64748b; font-size: 10px; white-space: nowrap; }
.loss-metric-value { font-size: 18px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; line-height: 1.05; }
.loss-metric-unit { color: #94a3b8; font-size: 10px; white-space: nowrap; }
.loss-hint { margin: 0; color: #94a3b8; font-size: 11px; }
.empty-state { display: flex; align-items: center; justify-content: center; min-height: 120px; padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
/* 灾损预估：标题/指标/风险分布为概况区，说明文字跟内容自然流（不悬空置底） */
.loss-pane { gap: 12px; }
/* 预警监测：表头概况区（flex:none）+ 列表滚动区 */
.warning-pane { gap: 0; }
/* 风险分布色带（R4-7） */
.loss-band-wrap { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
.band-caption { font-size: 10px; color: #475569; }
.detail-band { display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: rgba(148, 163, 184, 0.14); }
.band-seg { transition: flex-basis 0.3s ease; }
.band-detail-rows { display: flex; flex-direction: column; gap: 6px; }
.band-detail-row { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #334155; }
.risk-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.risk-name { width: 48px; flex: none; }
.risk-count { flex: 1; color: #64748b; }
.risk-area { font-variant-numeric: tabular-nums; }
/* 预警监测（R3-9~R3-18） */
.warning-head { flex: none; border-bottom: 1px solid rgba(148, 163, 184, 0.3); padding-bottom: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; background: inherit; }
.warning-head-row { display: flex; align-items: center; gap: 8px; }
.warning-overview { font-size: 15px; font-weight: 700; color: #1e3a8a; flex: 1; }
.rule-info { display: inline-flex; align-items: center; color: #94a3b8; cursor: help; }
.rule-info svg { width: 15px; height: 15px; }
.batch-btn { flex: none; padding: 4px 12px; border: 0; border-radius: 7px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
.batch-btn:hover { background: #1d4ed8; }
.dispatch-row { justify-content: flex-end; }
.dispatch-label { font-size: 11px; color: #64748b; }
.mode-switch { display: inline-flex; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 999px; overflow: hidden; }
.mode-switch button { padding: 2px 10px; border: 0; background: #fff; color: #64748b; font-size: 11px; cursor: pointer; }
.mode-switch button.active { background: #2563eb; color: #fff; font-weight: 600; }
.cell-tooltip { position: fixed; z-index: 1250; padding: 6px 10px; border-radius: 7px; background: rgba(15, 23, 42, 0.9); color: #fff; font-size: 11px; max-width: 260px; line-height: 1.5; }
.warning-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.warning-card { padding: 15px 9px; border: 0; border-bottom: 1px solid rgba(148, 163, 184, 0.13); border-radius: 0; background: transparent; cursor: pointer; transition: background 0.12s ease; }
.warning-card:hover { background: #f8fafc; }
.wc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.wc-name { font-weight: 650; color: #0f172a; font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wc-status { flex: none; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.wc-status.todo { background: #fee2e2; color: #b91c1c; }
.wc-status.observe { background: #dcfce7; color: #166534; }
.wc-level-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.wc-rain { flex: none; color: #64748b; font-size: 12px; font-variant-numeric: tabular-nums; }
.ai-chip { flex: none; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; color: #fff; background: #6366f1; border-radius: 4px; padding: 1px 5px; line-height: 1.5; align-self: flex-start; }
.ai-text { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: #475569; line-height: 1.6; margin-bottom: 10px; }
.wc-actions { display: flex; justify-content: flex-end; }
.dispatch-btn { padding: 4px 12px; border: 1px solid #2563eb; border-radius: 7px; background: #fff; color: #2563eb; font-size: 12px; font-weight: 600; cursor: pointer; }
.dispatch-btn:hover { background: #2563eb; color: #fff; }
.dispatch-btn.done { border: 1px solid #94a3b8; background: #fff; color: #475569; cursor: not-allowed; }
.view-all-bottom { display: block; width: 100%; padding: 13px; border: 0; border-top: 1px solid #e2e8f0; background: transparent; color: #2563eb; font-size: 12px; font-weight: 600; cursor: pointer; }
.view-all-bottom:hover { background: #eef2f7; }
/* 任务列表（R5-12） */
.task-list-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.status-filter { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; padding-left: 2px; }
.sf-item { border: 0; border-radius: 999px; font-size: 11px; padding: 3px 10px; cursor: pointer; transition: opacity 0.12s ease, box-shadow 0.12s ease, font-weight 0.12s ease; }
.sf-item.active { font-weight: 700; box-shadow: 0 0 0 1.5px #2563eb; }
.sf-all { background: #e2e8f0; color: #475569; opacity: 0.75; }
.sf-all.active { opacity: 1; }
.sf-claim { background: #ffedd5; color: #c2410c; opacity: 0.6; }
.sf-claim.active { opacity: 1; }
.sf-doing { background: #fef9c3; color: #a16207; opacity: 0.6; }
.sf-doing.active { opacity: 1; }
.sf-done { background: #dcfce7; color: #166534; opacity: 0.6; }
.sf-done.active { opacity: 1; }
.task-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 18px 10px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.14); background: transparent; cursor: pointer; color: #334155; text-align: left; transition: background 0.12s ease; }
.task-row:hover { background: #f8fafc; }
.task-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.task-eyebrow { font-size: 10px; font-weight: 600; color: #94a3b8; font-variant-numeric: tabular-nums; letter-spacing: 0.03em; }
.task-name { font-weight: 600; font-size: 14px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-level-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; display: inline-block; }
.released-hint { font-size: 10px; color: #b45309; }
.task-status { flex: none; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.st-claim { background: #ffedd5; color: #c2410c; }
.st-doing { background: #fef9c3; color: #a16207; }
.st-done { background: #dcfce7; color: #166534; }
/* 任务详情（R5-13/R6） */
.task-detail { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px; }
.detail-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 10px 0 12px; background: #fff; border-bottom: 1px solid rgba(148,163,184,0.2); margin-bottom: 14px; }
.back-btn { width: 24px; height: 24px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #2563eb; cursor: pointer; }
.back-btn:hover { background: #eff6ff; color: #1d4ed8; }
.back-btn svg { width: 18px; height: 18px; }
.detail-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e3a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-group { padding: 14px; border-radius: 10px; background: #f8fafc; margin-bottom: 12px; }
.detail-group:last-child { margin-bottom: 0; }
.group-label { font-size: 11px; font-weight: 600; color: #2563eb; margin-bottom: 12px; letter-spacing: 0.02em; }
.detail-meta { display: flex; flex-direction: column; gap: 12px; }
.meta-row { display: flex; align-items: baseline; gap: 12px; font-size: 12px; color: #334155; }
.meta-label { width: 60px; flex: none; color: #64748b; }
.meta-value { flex: 1; color: #0f172a; display: flex; align-items: center; gap: 5px; overflow-wrap: anywhere; }
.detail-sec { margin-bottom: 16px; }
.sec-label { font-size: 11px; color: #64748b; margin-bottom: 5px; }
.sec-body { font-size: 12px; color: #334155; line-height: 1.65; white-space: pre-line; }
.history-list { display: flex; flex-direction: column; gap: 6px; }
.history-row { display: flex; gap: 8px; font-size: 11px; color: #475569; }
.history-time { flex: none; color: #94a3b8; font-variant-numeric: tabular-nums; }
.pending-evidence { color: #94a3b8; font-style: italic; }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ev-thumb { position: relative; border: 0; padding: 0; border-radius: 6px; overflow: hidden; cursor: pointer; background: #e2e8f0; }
.ev-thumb img { width: 100%; height: 64px; object-fit: cover; display: block; }
.ev-time { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 3px; }
.ev-demo-note { margin: 6px 0 0; font-size: 10px; color: #94a3b8; }
/* 全部预警抽屉（R3-18） */
.dw-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1150; width: min(520px, calc(100vw - 104px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(148,163,184,0.35); border-right: 0; border-radius: 16px 0 0 16px; background: rgba(248,250,252,0.98); box-shadow: -10px 18px 48px rgba(15,23,42,0.22); color: #0f172a; backdrop-filter: blur(18px); }
.dw-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.dw-drawer-eyebrow { display: block; color: #64748b; font-size: 11px; font-weight: 650; }
.dw-drawer-title { margin: 4px 0 0; color: #0f172a; font-size: 17px; line-height: 1.3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dw-drawer-close { width: 34px; height: 34px; flex: none; border: 0; border-radius: 50%; background: #e2e8f0; color: #334155; font-size: 24px; cursor: pointer; }
.dw-drawer-close:hover { background: #cbd5e1; }
.dw-drawer-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; }
.dw-drawer-card { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px; border: 1px solid transparent; border-radius: 10px; background: #fff; cursor: pointer; text-align: left; margin-bottom: 8px; transition: background 0.12s ease, border-color 0.12s ease; }
.dw-drawer-card:hover { background: #f1f5f9; border-color: #bfdbfe; }
.dc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dc-name { font-size: 13px; font-weight: 600; color: #0f172a; }
.dc-meta { font-size: 11px; color: #64748b; }
.lightbox-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; }
.lightbox { position: relative; }
.lightbox img { max-width: 78vw; max-height: 82vh; border-radius: 8px; box-shadow: 0 18px 60px rgba(0,0,0,0.45); }
.lb-count { position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%); color: #e2e8f0; font-size: 12px; background: rgba(15,23,42,0.55); padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.side-drawer-enter-active, .side-drawer-leave-active { transition: transform 0.25s ease; }
.side-drawer-enter-from, .side-drawer-leave-to { transform: translateX(100%); }
@media (max-width: 560px) { .disaster-warning-panel { width: calc(100% - 12px); right: 6px; } }
</style>
