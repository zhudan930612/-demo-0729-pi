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

      <!-- KPI 受损统计 -->
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
        当前无参保区域受损
      </div>

      <template v-else>
        <!-- 非村级：区域统计表 -->
        <LodgingRegionTable
          v-if="!model.isVillageLevel"
          title="区域统计"
          :rows="model.regionRows"
          @select-region="(code: string) => emit('select-region', code)"
        />

        <!-- 村级：地块列表（表格形式，与区域统计表对齐风格一致） -->
        <section v-else class="parcel-section" aria-label="受损地块">
          <h3 class="section-title">
            <span class="section-title-icon" aria-hidden="true">⚠</span>
            受损地块
          </h3>
          <div v-if="model.parcelRows.length > 0" class="parcel-table-wrapper">
            <table class="parcel-table">
              <colgroup>
                <col /><col /><col /><col /><col />
              </colgroup>
              <thead>
                <tr>
                  <th class="p-col-rank">#</th>
                  <th class="p-col-id">地块</th>
                  <th class="p-col-severity">程度</th>
                  <th class="p-col-rate">受损率</th>
                  <th class="p-col-area">受损面积</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, idx) in visibleParcelRows"
                  :key="row.parcelId"
                  class="parcel-row"
                  @click="emit('select-region', row.parcelId)"
                >
                  <td class="p-col-rank">
                    <span class="parcel-rank" :class="rankClass(idx)">{{ idx + 1 }}</span>
                  </td>
                  <td class="p-col-id">
                    <span class="parcel-id-text" :title="'地块#' + row.parcelId">#{{ row.parcelId }}</span>
                  </td>
                  <td class="p-col-severity">
                    <span class="severity-badge" :class="severityClass(row.severity)">
                      {{ severityLabel(row.severity) }}
                    </span>
                  </td>
                  <td class="p-col-rate">
                    <span class="rate-text">{{ formatRate(row.damageRate) }}</span>
                  </td>
                  <td class="p-col-area">
                    <span class="area-text">{{ fmtArea(row.damageAreaMu) }} 亩</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="model.totalParcelCount > PARCEL_CARD_LIMIT"
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
import type { RegionSeverity } from '../../features/lodging/lodgingCalc'
import LodgingRegionTable from './LodgingRegionTable.vue'
import type { RegionTableRow } from './LodgingRegionTable.vue'

/** 卡片内最多展示的地块数 */
const PARCEL_CARD_LIMIT = 30

export interface ParcelRow {
  parcelId: string
  severity: RegionSeverity
  damageRate: number
  damageAreaMu: number
  compensation: number
}

export interface LodgingOverviewModel {
  currentLevelName: string
  isVillageLevel: boolean
  /** 受损面积（亩）—— 口径 A */
  totalDamagedAreaMu: number
  /** 受损户数（按投保人去重） */
  totalHouseholdCount: number
  /** 预估赔付总额（元） */
  totalCompensation: number
  /** 当前视图范围内的总地块数（村级） */
  totalParcelCount: number
  /** 区域统计表行（非村级使用） */
  regionRows: RegionTableRow[]
  /** 地块列表行（村级使用） */
  parcelRows: ParcelRow[]
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

const visibleParcelRows = computed(() => {
  if (!props.model) return []
  return props.model.parcelRows.slice(0, PARCEL_CARD_LIMIT)
})

const disclaimerText = computed(() => {
  if (!props.model) return ''
  return props.model.isDemoMode
    ? '评估基于模拟受灾数据，仅供演示，不构成理赔依据'
    : '评估基于实际受灾数据，不构成理赔依据'
})

function rankClass(idx: number): string {
  if (idx === 0) return 'rank-1'
  if (idx === 1) return 'rank-2'
  if (idx === 2) return 'rank-3'
  return ''
}

function severityLabel(severity: RegionSeverity): string {
  switch (severity) {
    case 'heavy': return '重度'
    case 'medium': return '中度'
    case 'light': return '轻度'
    case 'none': return '—'
  }
}

function severityClass(severity: RegionSeverity): string {
  switch (severity) {
    case 'heavy': return 'severe'
    case 'medium': return 'mid'
    case 'light': return 'light'
    case 'none': return 'none'
  }
}

function formatRate(rate: number): string {
  if (rate <= 0) return '—'
  if (rate < 1) return rate.toFixed(1) + '%'
  return Math.round(rate) + '%'
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

/* ---------- 村级地块列表（表格） ---------- */
.parcel-section {
  padding: 8px 10px 6px;
}

.section-title {
  margin: 0 0 10px;
  font-size: 11.5px;
  font-weight: 700;
  color: #1e40af;
  display: flex;
  align-items: center;
  gap: 5px;
  letter-spacing: 0.01em;
}
.section-title-icon {
  font-size: 12px;
}

.parcel-table-wrapper {
  max-height: calc(60vh - 230px);
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.parcel-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  table-layout: fixed;
}

/* 列宽分配 */
.parcel-table colgroup col:nth-child(1) { width: 32px; }  /* 排名 */
.parcel-table colgroup col:nth-child(2) { width: auto; } /* 地块（自适应） */
.parcel-table colgroup col:nth-child(3) { width: 58px; } /* 程度 */
.parcel-table colgroup col:nth-child(4) { width: 56px; } /* 受损率 */
.parcel-table colgroup col:nth-child(5) { width: 72px; } /* 受损面积 */

.parcel-table th {
  padding: 8px 8px;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1.5px solid #e2e8f0;
  font-size: 10.5px;
  white-space: nowrap;
  letter-spacing: 0.02em;
  background: #fafbfc;
  position: sticky;
  top: 0;
  z-index: 1;
}

/* 表头对齐 */
.parcel-table th.p-col-rank { text-align: center; }
.parcel-table th.p-col-id { text-align: left; }
.parcel-table th.p-col-severity { text-align: center; }
.parcel-table th.p-col-rate { text-align: right; }
.parcel-table th.p-col-area { text-align: right; }

.parcel-table td {
  padding: 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}

.parcel-row {
  cursor: pointer;
  transition: background 0.12s ease;
}

.parcel-row:hover {
  background: #eff6ff;
}

.parcel-row:last-child td {
  border-bottom: none;
}

/* 数据对齐 */
.p-col-rank { text-align: center; }
.p-col-id { text-align: left; overflow: hidden; }
.p-col-severity { text-align: center; white-space: nowrap; }
.p-col-rate { text-align: right; font-variant-numeric: tabular-nums; }
.p-col-area { text-align: right; font-variant-numeric: tabular-nums; }

.parcel-rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  background: #e2e8f0;
  color: #475569;
}
.parcel-rank.rank-1 { background: #dc2626; color: #fff; }
.parcel-rank.rank-2 { background: #f97316; color: #fff; }
.parcel-rank.rank-3 { background: #eab308; color: #fff; }

.parcel-id-text {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  color: #1e293b;
}

.severity-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.4;
  white-space: nowrap;
}
.severity-badge.severe { background: #fef2f2; color: #dc2626; }
.severity-badge.mid { background: #fef3c7; color: #ca8a04; }
.severity-badge.light { background: #dcfce7; color: #16a34a; }
.severity-badge.none { background: #f1f5f9; color: #94a3b8; }

.rate-text {
  color: #334155;
  font-weight: 500;
  font-size: 12px;
}

.area-text {
  color: #475569;
  font-weight: 500;
  font-size: 12px;
}

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
