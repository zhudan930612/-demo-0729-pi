<template>
  <div class="lodging-overview" role="region" aria-label="水稻倒伏评估概览">
    <!-- 加载态 -->
    <div v-if="loading" class="status-block" role="status">
      <span class="status-icon">⟳</span> 评估数据计算中…
    </div>

    <template v-else-if="model">
      <!-- 标题 -->
      <header class="overview-header">
        <svg class="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
        <div class="header-text">
          <h2 class="overview-title">水稻倒伏评估</h2>
          <p class="overview-subtitle">{{ model.currentLevelName }}</p>
        </div>
      </header>

      <!-- KPI 统计区 -->
      <section class="stats" aria-label="评估统计">
        <div class="stat-panel">
          <div class="stat-row damage">
            <span class="stat-label"><i class="stat-dot" aria-hidden="true"></i>受损统计</span>
            <div class="stat-grid">
              <div class="stat-cell">
                <strong>{{ fmtArea(model.totalDamagedAreaMu) }}</strong>
                <span>受损面积(亩)</span>
              </div>
              <div class="stat-cell">
                <strong>{{ model.totalHouseholdCount }}</strong>
                <span>受损户数(户)</span>
              </div>
              <div class="stat-cell compensation">
                <strong>{{ fmtYuan(model.totalCompensation) }}</strong>
                <span>预估赔付</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 空态 -->
      <div v-if="isEmpty" class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>
        </svg>
        当前气象条件下无参保区域受损
      </div>

      <template v-else>
        <!-- 区域列表 -->
        <section class="affected" aria-label="受损区域">
          <h3 class="section-title">
            <span class="section-title-icon" aria-hidden="true">⚠</span>
            {{ isVillageLevel ? '受损地块 Top 10' : '最严重区域 Top 3' }}
          </h3>
          <ul v-if="topItems.length > 0" class="region-list">
            <li
              v-for="(item, idx) in topItems"
              :key="item.code"
              class="region-row"
              @click="emit('select-region', item.code)"
            >
              <div class="row-main">
                <div class="row-line1">
                  <span class="region-rank" :class="'rank-' + (idx + 1)">{{ idx + 1 }}</span>
                  <span class="region-name">{{ item.name }}</span>
                  <span class="damage-badge" :class="damageClass(item.damageRate)">
                    {{ damageText(item.damageRate) }}
                  </span>
                </div>
              </div>
              <span class="region-summary">
                <span class="rate-text">受损率 {{ item.damageRate }}%</span>
                <template v-if="item.areaMu !== undefined">
                  <span class="sep">·</span>
                  <span class="area-text">{{ fmtArea(item.areaMu) }} 亩</span>
                </template>
              </span>
            </li>
          </ul>
          <button
            v-if="isVillageLevel && model.totalParcelCount > 10"
            class="view-all-btn"
            @click="emit('view-all-parcels')"
          >
            查看全部 {{ model.totalParcelCount }} 个地块
            <svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </section>
      </template>

      <!-- 底部署名 -->
      <footer class="overview-footer">
        <p v-if="model.evaluatedAt" class="eval-time">
          <svg class="footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          {{ model.evaluatedAt }}
        </p>
        <p class="disclaimer">{{ disclaimerText }}</p>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DamageRate } from '../../features/lodging/lodgingCalc'

export interface LodgingOverviewItem {
  code: string
  name: string
  damageRate: DamageRate
  areaMu?: number
  compensation?: number
}

export interface LodgingOverviewModel {
  currentLevelName: string
  isVillageLevel: boolean
  totalDamagedAreaMu: number
  totalHouseholdCount: number
  totalCompensation: number
  totalParcelCount: number
  topItems: LodgingOverviewItem[]
  evaluatedAt: string
  isDemoMode: boolean
}

const props = defineProps<{
  model: LodgingOverviewModel | null
  loading: boolean
}>()

const emit = defineEmits<{
  'select-region': [code: string]
  'view-all-parcels': []
}>()

const isEmpty = computed(() => {
  if (!props.model) return true
  return props.model.totalDamagedAreaMu === 0 && props.model.totalCompensation === 0
})

const isVillageLevel = computed(() => props.model?.isVillageLevel ?? false)
const topItems = computed(() => props.model?.topItems ?? [])

const disclaimerText = computed(() => {
  if (!props.model) return ''
  return props.model.isDemoMode
    ? '评估基于模拟气象数据，仅供演示'
    : '评估基于当前气象快照，Demo 数据为模拟，不构成理赔依据'
})

function damageText(rate: DamageRate): string {
  const map: Record<DamageRate, string> = { 0: '无', 30: '轻度', 60: '中度', 100: '重度' }
  return map[rate] ?? '-'
}

function damageClass(rate: DamageRate): string {
  const map: Record<DamageRate, string> = { 0: 'none', 30: 'light', 60: 'mid', 100: 'severe' }
  return map[rate] ?? ''
}

function fmtArea(mu: number): string {
  return mu.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function fmtYuan(yuan: number): string {
  if (yuan >= 10_000) {
    return `¥${(yuan / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}万`
  }
  return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}
</script>

<style scoped>
.lodging-overview {
  padding: 0;
  color: #0f172a;
  font-size: 12px;
  display: flex;
  flex-direction: column;
}

/* ---------- 加载/空态 ---------- */
.status-block {
  margin: 8px;
  padding: 14px 12px;
  border-radius: 8px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.status-icon { font-size: 14px; animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  margin: 8px;
  padding: 18px 12px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #64748b;
  font-size: 11.5px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.empty-icon { width: 24px; height: 24px; color: #94a3b8; }

/* ---------- 标题 ---------- */
.overview-header {
  padding: 12px 12px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  border-bottom: 1px solid #e2e8f0;
}
.header-icon {
  width: 22px;
  height: 22px;
  color: #dc2626;
  flex: none;
}
.header-text {
  min-width: 0;
  flex: 1;
}
.overview-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.overview-subtitle {
  margin: 2px 0 0;
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 统计区 ---------- */
.stats {
  padding: 8px 8px 4px;
}
.stat-panel {
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(180deg, #fef2f2 0%, #fff 100%);
  border: 1px solid #fecaca;
}
.stat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.stat-row.damage .stat-label {
  color: #dc2626;
}
.stat-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
  flex: none;
  letter-spacing: 0.02em;
}
.stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: #dc2626;
  box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.18);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.stat-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
  padding: 2px 0;
}
.stat-cell strong {
  font-size: 13.5px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.stat-cell.compensation strong {
  color: #dc2626;
}
.stat-cell span {
  font-size: 9px;
  color: #64748b;
  white-space: nowrap;
  letter-spacing: 0.01em;
}

/* ---------- 区域列表 ---------- */
.affected {
  padding: 6px 8px 4px;
}
.section-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  color: #1e40af;
  display: flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 0.01em;
}
.section-title-icon {
  font-size: 12px;
}
.region-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(60vh - 230px);
  overflow-y: auto;
}
.region-row {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, box-shadow 0.12s ease;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.region-row:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  box-shadow: 0 1px 3px rgba(59, 130, 246, 0.08);
}
.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.row-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.region-rank {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  flex: none;
  background: #e2e8f0;
  color: #475569;
}
.region-rank.rank-1 { background: #dc2626; color: #fff; }
.region-rank.rank-2 { background: #f97316; color: #fff; }
.region-rank.rank-3 { background: #eab308; color: #fff; }
.region-name {
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #0f172a;
}
.damage-badge {
  padding: 1px 7px;
  border-radius: 999px;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  flex: none;
  letter-spacing: 0.02em;
}
.damage-badge.severe { background: #dc2626; }
.damage-badge.mid { background: #ca8a04; }
.damage-badge.light { background: #16a34a; }
.damage-badge.none { background: #94a3b8; }

.region-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #334155;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex: none;
  white-space: nowrap;
}
.rate-text { color: #475569; }
.sep { color: #cbd5e1; }
.area-text { color: #64748b; }

.view-all-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  margin-top: 8px;
  padding: 9px 10px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  color: #2563eb;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.view-all-btn:hover {
  background: #eff6ff;
  border-color: #3b82f6;
}
.arrow-icon {
  width: 12px;
  height: 12px;
}

/* ---------- 底部 ---------- */
.overview-footer {
  margin-top: auto;
  padding: 8px 12px 10px;
  border-top: 1px solid #f1f5f9;
  color: #94a3b8;
  font-size: 9.5px;
}
.overview-footer p {
  margin: 2px 0;
}
.eval-time {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #64748b;
  font-size: 10px;
  font-weight: 500;
}
.footer-icon {
  width: 11px;
  height: 11px;
}
.disclaimer {
  font-style: italic;
  color: #94a3b8;
}
</style>
