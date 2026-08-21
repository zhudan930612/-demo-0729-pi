<template>
  <section class="region-table-section" aria-label="区域统计">
    <h3 class="section-title">
      <span class="section-title-icon" aria-hidden="true">📊</span>
      {{ title }}
    </h3>

    <div v-if="rows.length === 0" class="empty-table">
      暂无区域数据
    </div>

    <table v-else class="region-table">
      <colgroup>
        <col /><col /><col /><col /><col />
      </colgroup>
      <thead>
        <tr>
          <th class="col-rank">排名</th>
          <th class="col-name">区域</th>
          <th class="col-severity">受损程度</th>
          <th class="col-rate">受损率</th>
          <th class="col-area">受损面积</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, idx) in rows"
          :key="row.code"
          class="region-row"
          @click="emit('select-region', row.code)"
        >
          <td class="col-rank">
            <span class="rank-badge" :class="rankClass(idx)">{{ idx + 1 }}</span>
          </td>
          <td class="col-name">
            <span class="name-text" :title="row.name">{{ row.name }}</span>
          </td>
          <td class="col-severity">
            <span class="severity-badge" :class="severityClass(row.severity)">
              {{ severityLabel(row.severity) }}
            </span>
          </td>
          <td class="col-rate">
            <span class="rate-text">{{ formatRate(row.damageRate) }}</span>
          </td>
          <td class="col-area">
            <span class="area-text">{{ formatArea(row.damagedAreaMu) }} 亩</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import type { RegionSeverity } from '../../features/lodging/lodgingCalc'

export interface RegionTableRow {
  code: string
  name: string
  severity: RegionSeverity
  damageRate: number
  damagedAreaMu: number
}

defineProps<{
  title: string
  rows: RegionTableRow[]
}>()

const emit = defineEmits<{
  'select-region': [code: string]
}>()

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

function formatArea(mu: number): string {
  return mu.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
</script>

<style scoped>
.region-table-section {
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

.empty-table {
  padding: 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 11.5px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px dashed #e2e8f0;
}

.region-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  table-layout: fixed;
}

/* 列宽分配：排名固定，区域自适应，其余固定 */
.region-table colgroup col:nth-child(1) { width: 36px; }  /* 排名 */
.region-table colgroup col:nth-child(2) { width: auto; } /* 区域（自适应） */
.region-table colgroup col:nth-child(3) { width: 58px; } /* 受损程度 */
.region-table colgroup col:nth-child(4) { width: 56px; } /* 受损率 */
.region-table colgroup col:nth-child(5) { width: 72px; } /* 受损面积 */

.region-table th {
  padding: 8px 8px;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1.5px solid #e2e8f0;
  font-size: 10.5px;
  white-space: nowrap;
  letter-spacing: 0.02em;
  background: #fafbfc;
}

/* 表头对齐与数据一致 */
.region-table th.col-rank { text-align: center; }
.region-table th.col-name { text-align: left; }
.region-table th.col-severity { text-align: center; }
.region-table th.col-rate { text-align: right; }
.region-table th.col-area { text-align: right; }

.region-table td {
  padding: 9px 8px;
  border-bottom: 1px solid #f1f5f9;
  color: #0f172a;
  vertical-align: middle;
}

.region-row {
  cursor: pointer;
  transition: background 0.12s ease;
}

.region-row:hover {
  background: #eff6ff;
}

.region-row:last-child td {
  border-bottom: none;
}

/* 数据单元格对齐 */
.col-rank {
  text-align: center;
}

.col-name {
  text-align: left;
  overflow: hidden;
}

.col-severity {
  text-align: center;
  white-space: nowrap;
}

.col-rate {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.col-area {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.rank-badge {
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

.rank-badge.rank-1 { background: #dc2626; color: #fff; }
.rank-badge.rank-2 { background: #f97316; color: #fff; }
.rank-badge.rank-3 { background: #eab308; color: #fff; }

.name-text {
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
</style>
