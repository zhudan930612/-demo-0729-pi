<template>
  <article v-if="model" class="village-risk-card" :class="{ degraded: model.degraded }" role="region" :aria-label="`${model.villageName}风险详情`">
    <header class="card-header">
      <button type="button" class="back-button" aria-label="返回受灾列表" title="返回列表" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h2 id="village-risk-card-title">{{ model.villageName }}</h2>
      <span v-if="!model.degraded" class="risk-pill" :class="levelClass" :style="{ '--risk': riskColor(model.level) }">{{ model.levelText }}</span>
    </header>

    <template v-if="!model.degraded">
      <!-- 风险依据（信号行：峰值/连阴雨/台风/预警；等级徽标在头部） -->
      <section class="signals">
        <span class="section-kicker">风险依据</span>
        <dl v-if="model.signalRows.length > 0 || model.unavailableRows.length > 0">
          <div v-for="row in model.signalRows" :key="row" class="signal-row"><dt aria-hidden="true">▸</dt><dd>{{ row }}</dd></div>
          <div v-for="row in model.unavailableRows" :key="row" class="signal-row unavailable"><dt aria-hidden="true">!</dt><dd>{{ row }}</dd></div>
        </dl>
      </section>

      <!-- 保单概况：仅保单结构（承保概况不重复） -->
      <section class="policy">
        <span class="section-kicker">保单概况</span>
        <p v-if="model.policy" class="policy-line">保单 {{ model.policy.policyCount }} · 大户保单 {{ model.policy.bigHolderPolicyCount }} + 清单户 {{ model.policy.rosterHouseholdCount }}</p>
        <p v-else class="policy-line unavailable">保单数据暂不可用</p>
      </section>

      <!-- 防灾措施 -->
      <section class="measures">
        <span class="section-kicker">防灾措施</span>
        <span class="stage-chip" :class="{ dormant: model.dormant }">当前阶段：{{ model.stageLabel }}</span>
        <span v-if="model.stageNote" class="stage-note">{{ model.stageNote }}</span>
        <ul>
          <li v-for="item in model.measures" :key="item"><i class="measure-dot" aria-hidden="true">▸</i><span>{{ item }}</span></li>
        </ul>
      </section>

      <!-- 7 天降水趋势（常驻显示） -->
      <section class="trend">
        <span class="section-kicker">7 天降水趋势</span>
        <div class="trend-body">
          <div class="trend-bars">
            <div v-for="(stat, index) in model.trend?.stats ?? []" :key="index" class="trend-bar-col" :class="{ active: index === model.trend?.dayIndex }">
              <div class="trend-bar">
                <i class="trend-fill" :style="{ height: barHeight(stat) }"></i>
                <span class="trend-tip" role="tooltip">{{ trendTitle(index, stat) }}</span>
              </div>
              <span class="trend-day">{{ shortDay(index) }}</span>
            </div>
          </div>
        </div>
      </section>
    </template>

    <div v-else class="degraded-note" role="status">风险暂不可评定（{{ model.unavailableRows.join('；') }}）</div>

    <footer class="card-footer">风险按预报窗口峰值定级，措施仅供参考，以官方发布为准</footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VillageRiskCardModel } from '../../features/village-risk/villageRiskCardModel'
import type { VillageDayStat } from '../../features/village-risk/villageRisk'
import { RISK_STROKE_COLOR } from '../../map/villageRiskLayerController'

const props = defineProps<{
  model: VillageRiskCardModel | null
}>()
const emit = defineEmits<{ back: [] }>()

function riskColor(level: number): string {
  return RISK_STROKE_COLOR[level as 0 | 1 | 2 | 3] ?? RISK_STROKE_COLOR[0]
}
const levelClass = computed(() => (['none', 'low', 'mid', 'high'] as const)[props.model?.level ?? 0])


function shortDay(index: number): string {
  const raw = props.model?.trend?.days[index] ?? ''
  const parts = raw.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : `D${index + 1}`
}
function barHeight(stat: VillageDayStat): string {
  // 全局统一刻度：柱高 = 当日累计 / 7 天最大累计 × 100%（数值与柱高严格对应）
  const globalMax = Math.max(0.1, ...(props.model?.trend?.stats ?? []).map((s) => s.mean))
  return `${Math.max(2, Math.min(100, (stat.mean / globalMax) * 100))}%`
}
function trendTitle(_index: number, stat: VillageDayStat): string {
  return `累计 ${stat.mean.toFixed(1)}mm`
}
</script>

<style scoped>
.village-risk-card {
  box-sizing: border-box;
  background: #ffffff;
  color: #0f172a;
  font-size: 12px;
  line-height: 1.5;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  scrollbar-width: none;
}
.village-risk-card::-webkit-scrollbar { display: none; }

/* ---- 头部：返回 + 村名 + 等级徽标（蓝底白字） ---- */
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #2563eb;
  color: #fff;
}
.card-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.back-button {
  width: 26px; height: 26px; flex: none;
  display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 6px;
  background: rgba(255, 255, 255, 0.14); color: #fff; cursor: pointer;
  transition: background-color 0.15s ease;
}
.back-button:hover { background: rgba(255, 255, 255, 0.28); }
.back-button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.back-button svg { width: 14px; height: 14px; }

.risk-pill {
  flex: none;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--risk);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
}
.risk-pill.none { background: #94a3b8; }
.risk-pill.low { background: #166534; }
.risk-pill.mid { background: #ca8a04; }
.risk-pill.high { background: #b91c1c; }

/* ---- 区块通用 ---- */
section { padding: 12px 14px 11px; }
section + section { border-top: 1px solid rgba(148, 163, 184, 0.22); }
.section-kicker {
  display: block;
  margin-bottom: 8px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #2563eb;
}

/* ---- 风险依据 ---- */
.signals dl { margin: 0; display: flex; flex-direction: column; gap: 5px; }
.signal-row { display: flex; gap: 7px; align-items: baseline; }
.signal-row dt {
  color: #2563eb;
  font-size: 9px;
  width: 9px;
  flex: none;
  text-align: center;
  line-height: 1.5;
}
.signal-row dd { margin: 0; color: #334155; font-size: 12px; font-variant-numeric: tabular-nums; }
.signal-row.unavailable dt { color: #b45309; }
.signal-row.unavailable dd { color: #b45309; }

/* ---- 保单概况 ---- */
.policy .policy-line {
  margin: 1px 0 0;
  color: #334155;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.policy .policy-line.unavailable { color: #b45309; }

/* ---- 防灾措施 ---- */
.stage-chip {
  display: inline-flex;
  align-items: center;
  margin: 1px 0 8px; /* 与 kicker/▸ 图标同列，无台阶 */
  padding: 3px 10px;
  border-radius: 999px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1.4;
}
.stage-chip.dormant {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #64748b;
}
.measures ul { margin: 2px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.measures li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: #334155;
  font-size: 12.5px;
}
.measure-dot {
  flex: none;
  font-style: normal;
  color: #2563eb;
  font-size: 10px;
  line-height: 1.6;
}
.stage-note {
  display: block;
  margin: 0 0 4px;
  font-size: 10.5px;
  color: #b45309;
}

/* ---- 7 天趋势展开项 ---- */
.trend { padding-bottom: 10px; }
.trend-body { margin-top: 10px; }
.trend-bars { display: flex; gap: 8px; align-items: flex-end; }
.trend-bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.trend-bar {
  position: relative;
  width: 100%; max-width: 28px; height: 66px;
  border-radius: 4px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  box-sizing: border-box;
}
.trend-fill {
  position: absolute; left: 2px; right: 2px; bottom: 0;
  border-radius: 3px 3px 0 0;
  background: linear-gradient(180deg, #93c5fd, #60a5fa);
}
/* 峰值日：深蓝柱 + 蓝字日期 */
.trend-bar-col.active .trend-fill {
  background: linear-gradient(180deg, #2563eb, #1d4ed8);
}
/* hover 数值浮层（跟随柱顶） */
.trend-tip {
  position: absolute;
  bottom: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  color: #fff;
  font-size: 10px;
  line-height: 1.4;
  padding: 4px 7px;
  border-radius: 5px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
  z-index: 6;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.32);
}
.trend-bar:hover .trend-tip,
.trend-bar:focus-visible .trend-tip {
  opacity: 1;
}
.trend-bar:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.trend-day {
  width: 100%;
  text-align: center;
  font-size: 9.5px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.trend-bar-col.active .trend-day {
  color: #1d4ed8;
  font-weight: 700;
}

/* ---- 降级 ---- */
.degraded-note {
  padding: 14px;
  color: #b45309;
  font-size: 12.5px;
}

/* ---- 底部注记 ---- */
.card-footer {
  padding: 9px 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  background: #f8fafc;
  font-size: 10px;
  color: #475569;
  line-height: 1.5;
}
</style>
