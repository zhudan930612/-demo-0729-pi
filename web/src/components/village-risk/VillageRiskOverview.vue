<template>
  <div class="risk-overview" role="region" aria-label="未来 7 天受灾风险概览">
    <!-- 加载骨架 -->
    <div v-if="precipLoading && !model" class="status-block" role="status">风险数据加载中…</div>
    <!-- 降水快照失败空态 -->
    <div v-else-if="snapshotError" class="status-block error" role="status">降水预报数据暂不可用</div>

    <template v-else-if="model">
      <!-- 统计区：单卡两行（等级行 + 三指标：数字上/说明下） -->
      <section class="stats" aria-label="受灾风险统计">
        <div class="stat-panel">
          <div class="stat-row high">
            <span class="stat-label"><i class="stat-dot" aria-hidden="true"></i>高风险 <b>{{ model.highCount }}</b> 村</span>
            <div class="stat-grid">
              <div class="stat-cell"><strong>{{ fmtArea(model.highStat.areaMu) }}</strong><span>承保面积(亩)</span></div>
              <div class="stat-cell"><strong>{{ fmtWanYuan(model.highStat.sumInsuredYuan) }}</strong><span>承保金额(万元)</span></div>
              <div class="stat-cell"><strong>{{ model.highStat.householdCount }}</strong><span>承保户数(户)</span></div>
            </div>
          </div>
          <div class="stat-row mid">
            <span class="stat-label"><i class="stat-dot" aria-hidden="true"></i>中风险 <b>{{ model.midCount }}</b> 村</span>
            <div class="stat-grid">
              <div class="stat-cell"><strong>{{ fmtArea(model.midStat.areaMu) }}</strong><span>承保面积(亩)</span></div>
              <div class="stat-cell"><strong>{{ fmtWanYuan(model.midStat.sumInsuredYuan) }}</strong><span>承保金额(万元)</span></div>
              <div class="stat-cell"><strong>{{ model.midStat.householdCount }}</strong><span>承保户数(户)</span></div>
            </div>
          </div>
        </div>
        <p v-if="model.policyAllFailed" class="policy-warn">保单数据暂不可用</p>
      </section>

      <!-- 受灾区域列表 -->
      <section class="affected" aria-label="受灾区域">
        <h3 class="section-title">受灾区域</h3>
        <div v-if="model.rows.length === 0" class="empty-state">未来 7 天无高风险参保区域</div>
        <ul v-else class="village-list">
          <li v-for="row in model.rows" :key="row.code" class="village-row" @click="emit('select-village', row.code)">
            <div class="row-main">
              <div class="row-line1">
                <span class="village-name">{{ row.villageName }}</span>
                <span class="risk-badge" :class="levelClass(row.level)">{{ row.levelText }}</span>
              </div>
              <div class="row-line2">
                <span class="peak">峰值 {{ row.peakLabel }}</span>
              </div>
            </div>
            <span v-if="row.policyAvailable" class="policy-summary">
              {{ fmtArea(row.insuredAreaMu) }} 亩 · 保额 {{ fmtYuan(row.sumInsuredYuan) }} · {{ row.householdCount }} 户
            </span>
            <span v-else class="policy-summary">保单数据暂不可用</span>
          </li>
        </ul>
      </section>

      <!-- 底部署名 -->
      <footer class="risk-footer">
        <p v-if="model.updatedAt">数据时间 {{ model.updatedAt }}</p>
        <p>台风按上游预报覆盖时长评估（约 72h）</p>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { VillageRiskOverviewModel } from '../../features/village-risk/villageRiskOverviewModel'

defineProps<{
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
/** 金额数字（万元，纯数值；币种与单位在说明文字中） */
function fmtWanYuan(yuan: number): string {
  return (yuan / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
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
  display:flex;align-items:center;gap:10px;
  padding:6px 10px;
}
.stat-row + .stat-row{border-top:1px solid #e2e8f0}
.stat-label{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;white-space:nowrap;flex:none}
.stat-row.high .stat-label{color:#b91c1c}
.stat-row.mid .stat-label{color:#ca8a04}
.stat-label b{font-variant-numeric:tabular-nums}
.stat-dot{width:6px;height:6px;border-radius:50%;flex:none}
.stat-row.high .stat-dot{background:#b91c1c}
.stat-row.mid .stat-dot{background:#ca8a04}
.stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:1;min-width:0}
.stat-cell{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0}
.stat-cell strong{font-size:13px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;line-height:1.25;white-space:nowrap}
.stat-cell span{font-size:9px;color:#64748b;white-space:nowrap}
.policy-warn{margin:3px 0 0;color:#b45309;font-size:10.5px}
.section-title{margin:0 0 6px;font-size:11px;color:#2563eb}
.village-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;max-height:calc(60vh - 210px);overflow-y:auto}
.village-row{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:9px 10px;cursor:pointer;transition:border-color 0.12s ease,background-color 0.12s ease;display:flex;align-items:center;justify-content:space-between;gap:10px}
.village-row:hover{background:#eff6ff;border-color:#93c5fd}
.row-main{min-width:0;display:flex;flex-direction:column;gap:4px}
.row-line1{display:flex;align-items:center;gap:7px;font-size:12px}
.village-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.risk-badge{padding:1px 6px;border-radius:999px;color:#fff;font-size:9.5px;font-weight:600;flex:none;letter-spacing:0.02em}
.risk-badge.mid{background:#ca8a04}
.risk-badge.high{background:#b91c1c}
.risk-badge.low{background:#166534}
.risk-badge.none{background:#94a3b8}
.policy-summary{margin-left:auto;color:#334155;font-size:11px;font-variant-numeric:tabular-nums;flex:none;white-space:nowrap}
.row-line2{color:#94a3b8}
.peak{color:#94a3b8;font-size:10.5px;font-variant-numeric:tabular-nums}
.empty-state{padding:12px 8px;color:#94a3b8;font-size:11px}
.risk-footer{margin-top:8px;padding-top:6px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:9.5px}
.risk-footer p{margin:1px 0}
</style>
