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
      <!-- 风险依据（等级+峰值合并为首行） -->
      <section class="signals">
        <span class="section-kicker">风险依据</span>
        <p v-if="model.evidenceMain" class="evidence-main" :style="{ '--risk': riskColor(model.level) }">{{ model.evidenceMain }}</p>
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
        <span class="section-kicker">防灾措施 · 当前阶段：{{ model.stageLabel }}</span>
        <span v-if="model.stageNote" class="stage-note">{{ model.stageNote }}</span>
        <ul>
          <li v-for="item in model.measures" :key="item">{{ item }}</li>
        </ul>
      </section>

      <!-- 7 天降水趋势展开项 -->
      <section class="trend">
        <button type="button" class="trend-toggle" :aria-expanded="trendOpen" :aria-controls="trendId" @click="toggleTrend">
          <span class="trend-chevron" :class="{ open: trendOpen }" aria-hidden="true">▸</span>查看 7 天降水趋势
        </button>
        <div v-show="trendOpen" :id="trendId" class="trend-body">
          <div class="trend-bars">
            <div v-for="(stat, index) in model.trend?.stats ?? []" :key="index" class="trend-bar-col" :class="{ active: index === model.trend?.dayIndex }">
              <div class="trend-bar" :title="trendTitle(index, stat)">
                <i class="trend-range" :style="{ height: rangeHeight(stat), bottom: rangeBottom(stat) }"></i>
                <i class="trend-mean" :style="{ bottom: meanHeight(stat) }" aria-hidden="true"></i>
              </div>
              <span class="trend-day">{{ shortDay(index) }}</span>
            </div>
          </div>
          <p class="trend-note">村级每日范围（min~max）与均值；柱色高亮该村峰值日</p>
        </div>
      </section>
    </template>

    <div v-else class="degraded-note" role="status">风险暂不可评定（{{ model.unavailableRows.join('；') }}）</div>

    <footer class="card-footer">风险按预报窗口峰值定级，措施仅供参考，以官方发布为准</footer>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { VillageRiskCardModel } from '../../features/village-risk/villageRiskCardModel'
import type { VillageDayStat } from '../../features/village-risk/villageRisk'
import { RISK_STROKE_COLOR } from '../../map/villageRiskLayerController'

const props = defineProps<{
  model: VillageRiskCardModel | null
}>()
const emit = defineEmits<{ back: [] }>()

const trendOpen = ref(false)
const trendId = 'village-risk-trend'

function riskColor(level: number): string {
  return RISK_STROKE_COLOR[level as 0 | 1 | 2 | 3] ?? RISK_STROKE_COLOR[0]
}
const levelClass = computed(() => (['none', 'low', 'mid', 'high'] as const)[props.model?.level ?? 0])

function toggleTrend() { trendOpen.value = !trendOpen.value }

function shortDay(index: number): string {
  const raw = props.model?.trend?.days[index] ?? ''
  const parts = raw.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : `D${index + 1}`
}
function rangeHeight(stat: VillageDayStat): string {
  const max = Math.max(stat.max, 0.1)
  const minPct = Math.max(0, Math.min(100, (stat.min / max) * 100))
  return `${Math.max(minPct + 4, Math.min(100, (stat.max / max) * 100))}%`
}
function rangeBottom(stat: VillageDayStat): string {
  const max = Math.max(stat.max, 0.1)
  return `${Math.max(0, Math.min(100, (stat.min / max) * 100))}%`
}
function meanHeight(stat: VillageDayStat): string {
  const max = Math.max(stat.max, 0.1)
  return `${Math.max(0, Math.min(96, (stat.mean / max) * 100))}%`
}
function trendTitle(index: number, stat: VillageDayStat): string {
  return `${shortDay(index)} 累计 ${stat.min.toFixed(1)}~${stat.max.toFixed(1)}mm，均值 ${stat.mean.toFixed(1)}mm`
}
</script>

<style scoped>
.village-risk-card {
  box-sizing: border-box;
  border: 3px solid #2563eb;
  border-radius: 0 0 10px 10px;
  background: #ffffff;
  color: #0f172a;
  font-size: 12px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
.village-risk-card.degraded { border-color: #94a3b8; }
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #2563eb;
  color: #fff;
}
.card-header h2 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.back-button {
  width: 26px; height: 26px; flex: none; display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 5px;
  background: rgba(255, 255, 255, 0.16); color: #fff; cursor: pointer;
}
.back-button:hover { background: rgba(255, 255, 255, 0.3); }
.back-button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.back-button svg { width: 14px; height: 14px; }
.risk-pill {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--risk);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.risk-pill.none { background: #94a3b8; }
.risk-pill.low { background: #166534; }
.risk-pill.mid { background: #ca8a04; }
.risk-pill.high { background: #b91c1c; }

section { padding: 8px 12px; border-top: 1px solid rgba(148, 163, 184, 0.2); }
.section-kicker { display: block; font-size: 10px; font-weight: 600; color: #2563eb; margin-bottom: 5px; }
.evidence-main { margin: 2px 0 6px; font-size: 15px; font-weight: 700; color: var(--risk, #0f172a); }
.signals dl { margin: 0; display: flex; flex-direction: column; gap: 3px; }
.signal-row { display: flex; gap: 6px; align-items: baseline; }
.signal-row dt { color: #2563eb; font-size: 10px; width: 10px; }
.signal-row dd { margin: 0; color: #334155; font-variant-numeric: tabular-nums; }
.signal-row.unavailable dt { color: #b45309; }
.signal-row.unavailable dd { color: #b45309; }

.policy .policy-line { margin: 2px 0 0; color: #334155; font-variant-numeric: tabular-nums; }
.policy .policy-line.unavailable { color: #b45309; }

.measures ul { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.measures li { padding-left: 14px; position: relative; color: #334155; }
.measures li::before { content: '▸'; position: absolute; left: 0; color: #2563eb; }
.stage-note { display: block; font-size: 10px; color: #b45309; margin-bottom: 2px; }

.trend-toggle {
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 2px 0; border: 0; background: transparent;
  color: #1d4ed8; font-size: 11px; font-weight: 600; cursor: pointer;
}
.trend-toggle:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; border-radius: 4px; }
.trend-chevron { transition: transform 0.15s ease; }
.trend-chevron.open { transform: rotate(90deg); }
.trend-body { margin-top: 6px; }
.trend-bars { display: flex; gap: 6px; align-items: flex-end; }
.trend-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.trend-bar {
  position: relative;
  width: 100%; max-width: 26px; height: 64px;
  border-radius: 3px;
  background: #eef2f7;
}
.trend-bar-col.active .trend-bar { background: #dbeafe; box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.4); }
.trend-range {
  position: absolute; left: 4px; right: 4px; bottom: 0;
  border-radius: 2px;
  background: linear-gradient(180deg, #2563eb, #3b82f6);
}
.trend-mean {
  position: absolute; left: 1px; right: 1px; height: 2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.35);
}
.trend-day { font-size: 9px; color: #64748b; }
.trend-note { margin: 6px 0 0; font-size: 9.5px; color: #94a3b8; }

.degraded-note { padding: 10px 12px; color: #b45309; font-size: 12px; }

.card-footer { padding: 6px 12px; border-top: 1px solid rgba(148, 163, 184, 0.2); font-size: 9.5px; color: #94a3b8; }
</style>
