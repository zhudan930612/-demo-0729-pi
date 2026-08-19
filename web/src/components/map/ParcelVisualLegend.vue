<template>
  <div class="parcel-visual-legend" role="region" :aria-label="`${title} 图例`">
    <div class="legend-title">{{ title }}</div>

    <!-- 错误状态（Spec §11） -->
    <div v-if="error" class="legend-error">
      <span>{{ error }}</span>
      <button type="button" class="retry-btn" @click="$emit('retry')">重试</button>
    </div>

    <!-- 空数据状态（Spec §12） -->
    <div v-else-if="empty" class="legend-empty">{{ emptyText }}</div>

    <!-- 正常图例（带复选框筛选） -->
    <template v-else>
      <label
        v-for="entry in entries"
        :key="entry.key"
        class="legend-item"
        :class="{ disabled: !isEnabled(entry.key) }"
      >
        <input
          type="checkbox"
          :checked="isEnabled(entry.key)"
          class="legend-checkbox"
          @change="$emit('toggle-category', entry.key)"
        />
        <span class="legend-swatch" :style="swatchStyle(entry)" />
        <span class="legend-label">{{ entry.label }}</span>
      </label>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { LegendEntry } from '../../features/parcels/parcelVisualMode'

const props = defineProps<{
  title: string
  entries: LegendEntry[]
  /** 当前启用的分类键集合；未传则全部视为启用（向后兼容） */
  enabledCategories?: Set<string>
  error?: string
  empty?: boolean
  emptyText?: string
}>()

defineEmits<{
  retry: []
  'toggle-category': [key: string]
}>()

function isEnabled(key: string): boolean {
  return props.enabledCategories ? props.enabledCategories.has(key) : true
}

function swatchStyle(entry: LegendEntry) {
  return {
    backgroundColor: entry.color,
    borderColor: entry.borderColor,
  }
}
</script>

<style scoped>
.parcel-visual-legend {
  position: absolute;
  left: 12px;
  bottom: 110px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, .34);
  border-radius: 10px;
  background: rgba(248, 250, 252, .96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, .18), 0 1px 2px rgba(15, 23, 42, .12);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
.legend-title {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  margin-bottom: 2px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}
.legend-item:hover {
  background: rgba(241, 245, 249, .6);
  border-radius: 4px;
}
.legend-item.disabled .legend-swatch {
  opacity: .25;
}
.legend-item.disabled .legend-label {
  color: #94a3b8;
  text-decoration: line-through;
  text-decoration-color: rgba(148, 163, 184, .5);
}
.legend-checkbox {
  width: 13px;
  height: 13px;
  accent-color: #2563eb;
  margin: 0;
  cursor: pointer;
  flex: none;
}
.legend-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex: none;
  border: 1.5px solid;
  border-radius: 3px;
  opacity: .85;
}
.legend-label {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  line-height: 1;
}
.legend-error {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #dc2626;
  font-weight: 600;
}
.retry-btn {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #fff;
  color: #334155;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.retry-btn:hover {
  background: #f1f5f9;
}
.legend-empty {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 600;
}
</style>
