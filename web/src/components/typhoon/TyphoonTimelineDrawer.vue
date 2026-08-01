<template>
  <div class="history-dock" :class="{ open }">
    <Transition name="timeline-drawer">
      <section id="typhoon-history-timeline" v-show="open" class="timeline-drawer" aria-label="当前年度历史台风时间轴">
        <header class="timeline-header">
          <div><strong>{{ model.year }} 年历史台风</strong><span v-if="model.loading" role="status">历史数据加载中</span></div>
          <div class="scroll-actions" aria-label="时间轴左右查看">
            <button type="button" aria-label="向左查看历史台风" @click="scrollBy(-1)">‹</button>
            <button type="button" aria-label="向右查看历史台风" @click="scrollBy(1)">›</button>
          </div>
        </header>
        <p v-if="model.limitMessage" class="limit-note" role="status">{{ model.limitMessage }}</p>
        <div v-if="model.empty" class="timeline-empty">当前年度暂无历史台风</div>
        <div v-else ref="viewportRef" class="timeline-viewport">
          <div class="timeline-track" :style="{ width: `${model.trackWidthPx}px`, height: `${Math.max(86, model.laneCount * 34 + 42)}px` }">
            <div class="month-row" aria-hidden="true">
              <span v-for="month in model.months" :key="month" :style="{ width: `${100 / model.months.length}%` }">{{ month }}月</span>
            </div>
            <div class="month-grid" aria-hidden="true"><i v-for="month in model.months" :key="month" :style="{ width: `${100 / model.months.length}%` }"></i></div>
            <button
              v-for="label in model.labels"
              :key="label.id"
              :ref="(element) => setLabelRef(label.id, element)"
              type="button"
              class="timeline-label"
              :class="{ opened: label.opened, focused: label.focused }"
              :disabled="label.disabled"
              :title="label.disabledReason || label.title"
              :aria-pressed="label.opened"
              :aria-label="`${label.title}${label.opened ? '，已打开' : ''}${label.disabledReason ? `，${label.disabledReason}` : ''}`"
              :style="{ left: `${label.leftPercent}%`, width: `${label.widthPercent}%`, top: `${34 + label.lane * 34}px` }"
              @click="emit('toggle-history', label.id)"
            >
              <span>{{ label.text }}</span>
              <i v-if="label.indicatorPercent !== null" class="node-indicator" :style="{ left: `${label.indicatorPercent}%` }" :aria-label="label.indicatorLabel" role="img"></i>
            </button>
          </div>
        </div>
      </section>
    </Transition>
    <button
      type="button"
      class="history-toggle"
      :aria-expanded="open"
      aria-controls="typhoon-history-timeline"
      @click="emit('toggle-drawer')"
    >{{ open ? '收回历史台风' : '查看历史台风' }}</button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { TyphoonTimelineViewModel } from '../../features/typhoon/typhoonTimelineViewModel'
const props = defineProps<{ open: boolean; model: TyphoonTimelineViewModel; focusedTyphoonId: string | null }>()
const emit = defineEmits<{ 'toggle-drawer': []; 'toggle-history': [typhoonId: string] }>()
const viewportRef = ref<HTMLElement | null>(null)
const labelRefs = new Map<string, Element>()
function setLabelRef(id: string, element: unknown) {
  if (element instanceof Element) labelRefs.set(id, element)
  else labelRefs.delete(id)
}
function scrollBy(direction: -1 | 1) { viewportRef.value?.scrollBy({ left: direction * Math.max(280, viewportRef.value.clientWidth * .72), behavior: 'smooth' }) }
watch(() => [props.open, props.focusedTyphoonId, props.model.labels.length] as const, async ([open, focused]) => {
  if (!open || !focused) return
  await nextTick()
  labelRefs.get(focused)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
})
</script>

<style scoped>
.history-dock { position:absolute; left:10px; right:64px; bottom:10px; z-index:1000; pointer-events:none; }
.timeline-drawer,.history-toggle { pointer-events:auto; }
.timeline-drawer { height:154px; box-sizing:border-box; padding:8px 10px 9px; overflow:hidden; border:1px solid rgba(148,163,184,.34); border-radius:10px 10px 0 0; background:rgba(248,250,252,.97); box-shadow:0 -6px 20px rgba(15,23,42,.16); backdrop-filter:blur(8px); }
.timeline-header { height:26px; display:flex; align-items:center; justify-content:space-between; gap:10px; }.timeline-header>div:first-child { display:flex; align-items:baseline; gap:9px; }.timeline-header strong { color:#0f172a; font-size:12px; }.timeline-header span { color:#64748b; font-size:10px; }
.scroll-actions { display:flex; gap:3px; }.scroll-actions button { width:28px; height:24px; padding:0; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; font-size:18px; cursor:pointer; }.scroll-actions button:hover { background:#e2e8f0; }.scroll-actions button:focus-visible,.history-toggle:focus-visible,.timeline-label:focus-visible { outline:3px solid rgba(37,99,235,.28); outline-offset:2px; }
.limit-note { margin:0 0 3px; color:#b45309; font-size:10px; font-weight:650; }.timeline-empty { height:92px; display:grid; place-items:center; color:#64748b; font-size:12px; }
.timeline-viewport { width:100%; height:110px; overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; }.timeline-track { position:relative; min-width:100%; }.month-row { position:absolute; inset:0 0 auto; height:26px; display:flex; border-bottom:1px solid #cbd5e1; }.month-row span { box-sizing:border-box; padding:5px 7px; border-right:1px solid #e2e8f0; color:#64748b; font-size:10px; font-weight:700; }.month-grid { position:absolute; top:26px; bottom:0; left:0; right:0; display:flex; }.month-grid i { box-sizing:border-box; border-right:1px dashed #e2e8f0; background:rgba(255,255,255,.24); }
.timeline-label { position:absolute; min-width:50px; height:27px; display:block; padding:0 8px; overflow:visible; border:1px solid #cbd5e1; border-radius:7px; background:#fff; color:#334155; font:inherit; font-size:10px; font-weight:700; line-height:25px; text-align:left; cursor:pointer; white-space:nowrap; }.timeline-label span { display:block; overflow:hidden; text-overflow:ellipsis; }.timeline-label:hover:not(:disabled) { border-color:#60a5fa; background:#eff6ff; }.timeline-label.opened { border-width:2px; border-color:#2563eb; background:#dbeafe; color:#1e3a8a; line-height:23px; }.timeline-label.focused { box-shadow:0 0 0 3px rgba(37,99,235,.16); }.timeline-label:disabled { cursor:not-allowed; border-style:dashed; color:#94a3b8; background:#f8fafc; }
.node-indicator { position:absolute; bottom:-5px; width:9px; height:9px; border:2px solid #fff; border-radius:50%; background:#b91c1c; box-shadow:0 0 0 1px #7f1d1d; transform:translateX(-50%); }
.history-toggle { display:block; min-width:126px; height:34px; margin-left:auto; padding:0 12px; border:1px solid #cbd5e1; border-radius:7px; background:#2563eb; box-shadow:0 4px 14px rgba(15,23,42,.2); color:#fff; font:inherit; font-size:12px; font-weight:700; cursor:pointer; }.open .history-toggle { border-radius:0 0 7px 7px; }
.timeline-drawer-enter-active,.timeline-drawer-leave-active { transition:opacity 180ms ease,transform 220ms cubic-bezier(.22,1,.36,1); }.timeline-drawer-enter-from,.timeline-drawer-leave-to { opacity:0; transform:translateY(100%); }
@media(max-width:720px){.history-dock{left:8px;right:56px;bottom:8px}.timeline-drawer{height:144px;padding-inline:8px}.timeline-viewport{height:100px}}
@media(max-width:520px){.history-dock{left:8px;right:52px}.history-toggle{margin-left:0}.timeline-track{min-width:720px}}
@media(prefers-reduced-motion:reduce){.timeline-drawer-enter-active,.timeline-drawer-leave-active{transition:none}.timeline-viewport{scroll-behavior:auto}}
</style>
