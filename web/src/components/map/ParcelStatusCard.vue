<template>
  <section v-if="mode === 'batch' || mode === 'drawing'" class="parcel-summary parcel-legend" aria-label="新增地块图示说明">
    <div class="legend-title">图示说明</div>
    <div class="legend-grid">
      <div class="legend-item"><span class="legend-swatch existing" aria-hidden="true"></span><span>普通地块</span></div>
      <div class="legend-item"><span class="legend-swatch hidden" aria-hidden="true"></span><span>已隐藏普通地块</span></div>
      <div class="legend-item"><span class="legend-swatch manual" aria-hidden="true"></span><span>人工地块</span></div>
      <div class="legend-item"><span class="legend-swatch pending-manual" aria-hidden="true"></span><span>本批新增地块</span></div>
    </div>
  </section>

  <section v-else-if="mode === 'filter'" class="parcel-summary parcel-legend" aria-label="筛选地块图示说明">
    <div class="legend-title">图示说明</div>
    <div class="legend-grid">
      <div class="legend-item"><span class="legend-swatch existing" aria-hidden="true"></span><span>可见地块</span></div>
      <div class="legend-item"><span class="legend-swatch pending-hide" aria-hidden="true"></span><span>待隐藏</span></div>
      <div class="legend-item"><span class="legend-swatch hidden" aria-hidden="true"></span><span>已隐藏</span></div>
      <div class="legend-item"><span class="legend-swatch pending-restore" aria-hidden="true"></span><span>待恢复</span></div>
    </div>
  </section>

  <section v-else-if="parcelVisible && parcelOn" class="parcel-summary" aria-label="地块统计">
    <div class="summary-metrics">
      <div class="summary-metric">
        <span>当前地块</span>
        <strong>{{ displayCount.toLocaleString() }}</strong>
        <small>块</small>
      </div>
      <span class="summary-divider" aria-hidden="true"></span>
      <div class="summary-metric area">
        <span>合计面积</span>
        <strong>{{ displayAreaText }}</strong>
        <small>亩</small>
      </div>
    </div>
    <div v-if="rsHint" class="summary-imagery" :class="{ off: !rsVisible }">{{ rsHint }}</div>
  </section>

  <div v-else-if="rsHint" class="rs-hint" :class="{ off: !rsVisible }">{{ rsHint }}</div>
</template>

<script setup lang="ts">
import type { ParcelMode } from '../../features/parcels/parcelTypes'

defineProps<{
  mode: ParcelMode
  parcelVisible: boolean
  parcelOn: boolean
  displayCount: number
  displayAreaText: string
  rsHint: string
  rsVisible: boolean
}>()
</script>

<style scoped>
.parcel-summary {
  position: absolute;
  left: 12px;
  bottom: 24px;
  z-index: 1000;
  width: max-content;
  padding: 9px 11px 8px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 9px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.1);
  color: #0f172a;
  backdrop-filter: blur(8px);
}
.summary-metrics { display: flex; align-items: flex-end; gap: 9px; }
.parcel-legend { min-width: 242px; padding: 10px 11px 8px; }
.legend-title {
  margin-bottom: 8px;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.legend-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 13px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #475569;
  font-size: 11px;
  line-height: 1.25;
  white-space: nowrap;
}
.legend-swatch {
  flex: 0 0 auto;
  width: 24px;
  height: 13px;
  border: 2px solid #38bdf8;
  border-radius: 2px;
  background: rgba(14, 165, 233, 0.13);
}
.legend-swatch.hidden {
  border-width: 2.5px;
  border-style: dashed;
  border-color: #eab308;
  background: rgba(250, 204, 21, 0.18);
}
.legend-swatch.manual {
  border-color: #a855f7;
  background: rgba(192, 132, 252, 0.24);
}
.legend-swatch.pending-manual {
  border-style: dashed;
  border-color: #e879f9;
  background: rgba(192, 38, 211, 0.18);
}
.legend-swatch.pending-hide {
  border-width: 2.5px;
  border-color: #fb2c36;
  background: rgba(249, 115, 22, 0.46);
}
.legend-swatch.pending-restore {
  border-width: 2.5px;
  border-color: #22c55e;
  background: rgba(22, 163, 74, 0.34);
}
.summary-metric { display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 3px; }
.summary-metric > span { grid-column: 1 / -1; margin-bottom: 2px; color: #64748b; font-size: 10px; }
.summary-metric strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.summary-metric small { color: #64748b; font-size: 10px; }
.summary-metric.area { min-width: 88px; }
.summary-divider { width: 1px; height: 32px; background: #dbe3ed; }
.summary-imagery {
  margin: 8px -2px 0;
  padding-top: 7px;
  border-top: 1px solid #e2e8f0;
  color: #166534;
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
}
.summary-imagery.off { color: #6b7280; }
.rs-hint {
  position: absolute;
  left: 16px;
  bottom: 24px;
  z-index: 1000;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  font-size: 12px;
  color: #166534;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.rs-hint.off { color: #6b7280; }

@media (max-width: 720px) {
  .parcel-summary { padding: 8px 10px; }
  .parcel-legend { min-width: 228px; }
  .legend-grid { gap: 6px 10px; }
  .summary-metric strong { font-size: 17px; }
}
</style>
