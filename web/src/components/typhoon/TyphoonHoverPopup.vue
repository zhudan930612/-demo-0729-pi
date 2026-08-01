<template>
  <div v-if="model" class="typhoon-hover" :class="model.kind" :style="popupStyle" role="tooltip">
    <template v-if="model.kind === 'center'">
      <header><strong>{{ model.nameCn }}</strong><span>{{ model.nameEn }} · {{ model.time }}</span></header>
      <dl>
        <div><dt>中心位置</dt><dd>{{ model.position }}</dd></div><div><dt>风速风力</dt><dd>{{ model.wind }}</dd></div>
        <div><dt>中心气压</dt><dd>{{ model.pressure }}</dd></div><div><dt>移速移向</dt><dd>{{ model.movement }}</dd></div>
        <div><dt>七级半径</dt><dd>{{ model.radius7 }}</dd></div><div><dt>十级半径</dt><dd>{{ model.radius10 }}</dd></div>
        <div><dt>十二级半径</dt><dd>{{ model.radius12 }}</dd></div><div><dt>参考位置</dt><dd>{{ model.referencePosition }}</dd></div>
      </dl>
      <p><b>未来趋势</b><em v-if="model.trendSource">{{ model.trendSource }}</em>{{ model.trend }}</p>
    </template>
    <template v-else>
      <header><strong>{{ model.title }}</strong><span>{{ model.typhoonName }} · {{ model.nodeTime }}</span></header>
      <div class="quadrants"><span>西北<b>{{ model.northwest }}</b></span><span>东北<b>{{ model.northeast }}</b></span><span>西南<b>{{ model.southwest }}</b></span><span>东南<b>{{ model.southeast }}</b></span></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TyphoonHoverViewModel } from '../../features/typhoon/typhoonHoverViewModel'
const props = defineProps<{ model: TyphoonHoverViewModel | null; x: number; y: number; viewportWidth: number; viewportHeight: number }>()
const popupStyle = computed(() => {
  const width = props.model?.kind === 'center' ? 330 : 250
  const height = props.model?.kind === 'center' ? 268 : 132
  const left = Math.max(8, Math.min(props.viewportWidth - width - 8, props.x + 18))
  const preferredTop = props.y - height / 2
  const top = Math.max(8, Math.min(props.viewportHeight - height - 8, preferredTop))
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
})
</script>

<style scoped>
.typhoon-hover{position:absolute;z-index:1200;box-sizing:border-box;padding:10px;border:1px solid rgba(148,163,184,.5);border-radius:8px;background:rgba(255,255,255,.98);box-shadow:0 10px 28px rgba(15,23,42,.26);color:#0f172a;pointer-events:none}.typhoon-hover header{display:grid;gap:2px;padding-bottom:7px;border-bottom:1px solid #e2e8f0}.typhoon-hover header strong{font-size:13px}.typhoon-hover header span{color:#64748b;font-size:10px}.typhoon-hover dl{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin:8px 0 0}.typhoon-hover dl div{min-width:0;display:grid;gap:1px}.typhoon-hover dt{color:#64748b;font-size:9px}.typhoon-hover dd{margin:0;overflow:hidden;color:#334155;font-size:10px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.typhoon-hover p{display:grid;grid-template-columns:auto auto 1fr;gap:5px;margin:8px 0 0;padding-top:7px;border-top:1px solid #e2e8f0;font-size:10px;line-height:1.4}.typhoon-hover p b{color:#475569}.typhoon-hover p em{align-self:start;padding:1px 4px;border-radius:4px;background:#eff6ff;color:#1d4ed8;font-size:8px;font-style:normal;font-weight:700}.quadrants{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}.quadrants span{display:grid;gap:2px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;color:#64748b;font-size:9px}.quadrants b{color:#0f172a;font-size:12px;font-variant-numeric:tabular-nums}@media(max-width:520px){.typhoon-hover.center{max-width:calc(100vw - 16px)}}
</style>
