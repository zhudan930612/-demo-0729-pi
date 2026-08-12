<template>
  <div class="risk-overview" role="region" aria-label="未来 7 天受灾风险概览">
    <!-- 加载骨架 -->
    <div v-if="precipLoading && !model" class="status-block" role="status">风险数据加载中…</div>
    <!-- 降水快照失败空态 -->
    <div v-else-if="snapshotError" class="status-block error" role="status">降水预报数据暂不可用</div>

    <template v-else-if="model">
      <!-- 统计区：单卡两行（高风险/中风险等级行 + 指标 inline） -->
      <section class="stats" aria-label="受灾风险统计">
        <div class="stat-panel">
          <div class="stat-row high">
            <span class="stat-label"><i class="stat-dot" aria-hidden="true"></i>高风险 <b>{{ model.highCount }}</b> 村</span>
            <span class="stat-items">
              <span class="stat-item"><strong>{{ fmtArea(model.highStat.areaMu) }}</strong><em>亩</em></span>
              <span class="stat-item"><strong>{{ fmtYuan(model.highStat.sumInsuredYuan) }}</strong></span>
              <span class="stat-item"><strong>{{ model.highStat.householdCount }}</strong><em>户</em></span>
            </span>
          </div>
          <div class="stat-row mid">
            <span class="stat-label"><i class="stat-dot" aria-hidden="true"></i>中风险 <b>{{ model.midCount }}</b> 村</span>
            <span class="stat-items">
              <span class="stat-item"><strong>{{ fmtArea(model.midStat.areaMu) }}</strong><em>亩</em></span>
              <span class="stat-item"><strong>{{ fmtYuan(model.midStat.sumInsuredYuan) }}</strong></span>
              <span class="stat-item"><strong>{{ model.midStat.householdCount }}</strong><em>户</em></span>
            </span>
          </div>
        </div>
        <p v-if="model.policyAllFailed" class="policy-warn">保单数据暂不可用</p>
      </section>

      <!-- 受灾区域列表 -->
      <section class="affected" aria-label="受灾区域">
        <h3 class="section-title">受灾区域（点击进入村查看）</h3>
        <div v-if="model.rows.length === 0" class="empty-state">未来 7 天无高风险参保区域</div>
        <ul v-else class="village-list">
          <li v-for="row in model.rows" :key="row.code" class="village-row" @click="emit('select-village', row.code)">
            <div class="row-line1">
              <span class="village-name">{{ row.villageName }}</span>
              <span class="risk-badge" :class="levelClass(row.level)">{{ row.levelText }}</span>
              <span class="peak">{{ row.peakLabel }}</span>
            </div>
            <div class="row-line2">
              <template v-if="row.policyAvailable">
                {{ fmtArea(row.insuredAreaMu) }} 亩 · 保额 {{ fmtYuan(row.sumInsuredYuan) }} · {{ row.householdCount }} 户
              </template>
              <template v-else>保单数据暂不可用</template>
            </div>
          </li>
        </ul>
      </section>

      <!-- 底部署名 -->
      <footer class="risk-footer">
        <p v-if="model.updatedAt">数据时间 {{ model.updatedAt }}</p>
        <p>台风按上游预报覆盖时长评估（约 72h）</p>
        <p>降水预报数据 © Open-Meteo / ECMWF</p>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { VillageRiskOverviewModel } from '../../features/village-risk/villageRiskOverviewModel'

const props = defineProps<{
  model: VillageRiskOverviewModel | null
  precipLoading: boolean
  snapshotError: boolean
}>()
const emit = defineEmits<{ 'select-village': [code: string]; refresh: [] }>()

function levelClass(level: number): string {
  return (['none', 'low', 'mid', 'high'] as const)[level] ?? 'none'
}
function fmtArea(mu: number): string {
  return mu.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function fmtYuan(yuan: number): string {
  if (yuan >= 10_000) return `¥${(yuan / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}万`
  return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}
</script>

<style scoped>
.risk-overview{padding:8px;color:#0f172a;font-size:12px}
.status-block{margin:4px;padding:10px 8px;border-radius:6px;background:#f8fafc;color:#475569;font-size:11px}
.status-block.error{color:#b91c1c}
.stats{margin-bottom:8px}
.stat-panel{
  border-radius:8px;
  overflow:hidden;
  background:#f8fafc;
  border:1px solid #e2e8f0;
}
.stat-row{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:6px 10px;
}
.stat-row + .stat-row{border-top:1px solid #e2e8f0}
.stat-label{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;white-space:nowrap}
.stat-row.high .stat-label{color:#b91c1c}
.stat-row.mid .stat-label{color:#ca8a04}
.stat-label b{font-variant-numeric:tabular-nums}
.stat-dot{width:6px;height:6px;border-radius:50%;flex:none}
.stat-row.high .stat-dot{background:#b91c1c}
.stat-row.mid .stat-dot{background:#ca8a04}
.stat-items{display:inline-flex;align-items:baseline;gap:12px;min-width:0}
.stat-item{display:inline-flex;align-items:baseline;gap:3px;white-space:nowrap}
.stat-item strong{font-size:12.5px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;line-height:1.3}
.stat-item em{font-style:normal;font-size:9px;color:#64748b}
.policy-warn{margin:3px 0 0;color:#b45309;font-size:10.5px}
.section-title{margin:0 0 6px;font-size:11px;color:#2563eb}
.village-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;max-height:calc(60vh - 210px);overflow-y:auto}
.village-row{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;cursor:pointer;transition:border-color 0.12s ease,background-color 0.12s ease}
.village-row:hover{background:#eff6ff;border-color:#93c5fd}
.row-line1{display:flex;align-items:center;gap:7px;font-size:12px}
.village-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.risk-badge{padding:1px 6px;border-radius:999px;color:#fff;font-size:9.5px;font-weight:600;flex:none;letter-spacing:0.02em}
.risk-badge.mid{background:#ca8a04}
.risk-badge.high{background:#b91c1c}
.risk-badge.low{background:#166534}
.risk-badge.none{background:#94a3b8}
.peak{margin-left:auto;color:#334155;font-size:11px;font-variant-numeric:tabular-nums;flex:none;white-space:nowrap;line-height:1.3}
.row-line2{margin-top:3px;color:#64748b;font-size:10.5px;font-variant-numeric:tabular-nums}
.empty-state{padding:12px 8px;color:#94a3b8;font-size:11px}
.risk-footer{margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:9.5px}
.risk-footer p{margin:1px 0}
</style>
