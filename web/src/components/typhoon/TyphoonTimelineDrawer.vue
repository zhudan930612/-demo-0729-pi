<template>
  <div class="history-dock" :class="{ open }" :style="{ '--drawer-height': `${drawerHeight}px` }">
    <button
      type="button"
      class="history-toggle"
      :aria-expanded="open"
      aria-controls="typhoon-history-timeline"
      @click="emit('toggle-drawer')"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg>
      <span>{{ open ? '收回历史台风' : '查看历史台风' }}</span>
    </button>

    <Transition name="timeline-drawer">
      <section id="typhoon-history-timeline" v-show="open" class="timeline-drawer" aria-label="当前年度历史台风时间轴">
        <header class="timeline-header">
          <strong>{{ model.year }} 年历史台风</strong>
          <span v-if="model.loading" role="status">历史数据加载中</span>
        </header>
        <p v-if="model.limitMessage" class="limit-note" role="status">{{ model.limitMessage }}</p>
        <div v-if="model.empty" class="timeline-empty">当前年度暂无历史台风</div>
        <div v-else class="timeline-viewport">
          <div class="timeline-track" :style="{ height: `${trackHeight}px` }">
            <div class="month-grid" aria-hidden="true"><i v-for="month in model.months" :key="month" :style="{ width: `${100 / model.months.length}%` }"></i></div>
            <button
              v-for="label in model.labels"
              :key="label.id"
              type="button"
              class="timeline-label"
              :class="{ opened: label.opened, focused: label.focused }"
              :disabled="label.disabled"
              :title="label.disabledReason || label.title"
              :aria-pressed="label.opened"
              :aria-label="`${label.title}${label.opened ? '，已打开' : ''}${label.disabledReason ? `，${label.disabledReason}` : ''}`"
              :style="{ left: `${label.leftPercent}%`, width: `${label.widthPercent}%`, top: `${10 + label.lane * 36}px` }"
              @click="emit('toggle-history', label.id)"
            >
              <span>{{ label.text }}</span>
              <i v-if="label.indicatorPercent !== null" class="node-indicator" :style="{ left: `${label.indicatorPercent}%` }" :aria-label="label.indicatorLabel" role="img"></i>
            </button>
            <div class="month-row" aria-hidden="true">
              <span v-for="month in model.months" :key="month" :style="{ width: `${100 / model.months.length}%` }">{{ month }}月</span>
            </div>
          </div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TyphoonTimelineViewModel } from '../../features/typhoon/typhoonTimelineViewModel'
const props = defineProps<{ open: boolean; model: TyphoonTimelineViewModel; focusedTyphoonId: string | null }>()
const emit = defineEmits<{ 'toggle-drawer': []; 'toggle-history': [typhoonId: string] }>()
const trackHeight = computed(() => props.model.empty ? 72 : Math.max(76, props.model.laneCount * 36 + 42))
const drawerHeight = computed(() => 48 + trackHeight.value + (props.model.limitMessage ? 18 : 0))
</script>

<style scoped>
.history-dock{--drawer-height:166px;position:absolute;left:10px;right:64px;bottom:10px;z-index:1000;height:0;pointer-events:none}.timeline-drawer,.history-toggle{pointer-events:auto}.history-toggle{position:absolute;left:0;bottom:0;z-index:2;min-width:136px;height:38px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 13px;border:1px solid #1d4ed8;border-radius:8px;background:#2563eb;box-shadow:0 4px 14px rgba(15,23,42,.22);color:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:bottom 240ms cubic-bezier(.22,1,.36,1),border-radius 180ms ease}.history-toggle svg{width:15px;height:15px;transition:transform 220ms ease}.history-dock.open .history-toggle{bottom:var(--drawer-height);border-radius:8px 8px 0 0}.history-dock.open .history-toggle svg{transform:rotate(180deg)}.timeline-drawer{position:absolute;left:0;right:0;bottom:0;height:var(--drawer-height);box-sizing:border-box;padding:8px 10px 10px;overflow:hidden;border:2px solid #2563eb;border-radius:0 10px 10px 10px;background:rgba(248,250,252,.98);box-shadow:0 -6px 20px rgba(15,23,42,.18);backdrop-filter:blur(8px)}.timeline-header{height:27px;display:flex;align-items:baseline;gap:9px}.timeline-header strong{color:#0f172a;font-size:12px}.timeline-header span{color:#64748b;font-size:10px}.history-toggle:focus-visible,.timeline-label:focus-visible{outline:3px solid rgba(37,99,235,.32);outline-offset:2px}.limit-note{height:18px;margin:0;color:#b45309;font-size:10px;font-weight:650}.timeline-empty{height:72px;display:grid;place-items:center;color:#64748b;font-size:12px}.timeline-viewport{width:100%;overflow:visible}.timeline-track{position:relative;width:100%;box-sizing:border-box;padding-bottom:24px;background:#dbeafe}.month-grid{position:absolute;inset:0 0 24px;display:flex}.month-grid i{box-sizing:border-box;border-right:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.08)}.month-row{position:absolute;left:0;right:0;bottom:0;height:24px;display:flex;background:#2563eb;color:#fff}.month-row span{box-sizing:border-box;padding:4px 7px;border-right:2px solid rgba(255,255,255,.82);font-size:11px;font-weight:700;text-align:center}.timeline-label{position:absolute;height:27px;box-sizing:border-box;display:block;padding:0 4px;overflow:visible;border:0;border-radius:12px;background:#3b82f6;box-shadow:0 1px 2px rgba(30,64,175,.2);color:#fff;font:inherit;font-size:11px;font-weight:700;line-height:27px;text-align:center;cursor:pointer;white-space:nowrap}.timeline-label span{display:block;overflow:hidden;text-overflow:ellipsis}.timeline-label:hover:not(:disabled){background:#1d4ed8}.timeline-label.opened{background:#1e40af;box-shadow:0 0 0 3px rgba(30,64,175,.22)}.timeline-label.focused{outline:2px solid #fbbf24;outline-offset:2px}.timeline-label:disabled{cursor:not-allowed;background:#94a3b8}.node-indicator{position:absolute;bottom:-5px;width:9px;height:9px;border:2px solid #fff;border-radius:50%;background:#f97316;box-shadow:0 0 0 1px #c2410c;transform:translateX(-50%)}.timeline-drawer-enter-active,.timeline-drawer-leave-active{transition:opacity 180ms ease,transform 240ms cubic-bezier(.22,1,.36,1)}.timeline-drawer-enter-from,.timeline-drawer-leave-to{opacity:0;transform:translateY(100%)}@media(max-width:720px){.history-dock{left:8px;right:56px;bottom:8px}}@media(max-width:520px){.history-dock{left:8px;right:8px}.history-toggle{min-width:132px}.timeline-label{padding-inline:4px;font-size:10px}}@media(prefers-reduced-motion:reduce){.timeline-drawer-enter-active,.timeline-drawer-leave-active,.history-toggle,.history-toggle svg{transition:none}}
</style>
