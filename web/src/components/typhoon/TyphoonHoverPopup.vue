<template>
  <div v-if="model" class="typhoon-hover" :class="model.kind" :style="popupStyle" role="tooltip">
    <template v-if="model.kind === 'center'">
      <header><strong>{{ model.nameCn }}({{ model.nameEn }})</strong><time>{{ model.time }}</time></header>
      <dl>
        <div><dt>中心位置</dt><dd>{{ model.position }}</dd></div>
        <div><dt>风速风力</dt><dd>{{ model.windSpeed }}，<b>{{ model.intensity }}</b></dd></div>
        <div><dt>中心气压</dt><dd>{{ model.pressure }}</dd></div>
        <div><dt>移速移向</dt><dd>{{ model.movement }}</dd></div>
        <div><dt>七级半径</dt><dd>{{ model.radius7 }}</dd></div>
        <div><dt>十级半径</dt><dd>{{ model.radius10 }}</dd></div>
        <div><dt>十二级半径</dt><dd>{{ model.radius12 }}</dd></div>
      </dl>
    </template>
    <template v-else-if="model.kind === 'forecast'">
      <header><strong>{{ model.title }}</strong><time>{{ model.provider }}</time></header>
      <dl>
        <div><dt>发布时间</dt><dd>{{ model.publishedTime }}</dd></div>
        <div><dt>未来时间</dt><dd>{{ model.futureTime }}</dd></div>
        <div><dt>中心位置</dt><dd>{{ model.position }}</dd></div>
        <div><dt>最大风速</dt><dd>{{ model.windSpeed }}</dd></div>
        <div><dt>中心气压</dt><dd>{{ model.pressure }}</dd></div>
        <div><dt>风力</dt><dd>{{ model.intensity }}</dd></div>
      </dl>
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
  const nodePopup = props.model?.kind === 'center' || props.model?.kind === 'forecast'
  const width = props.model?.kind === 'center' ? 270 : props.model?.kind === 'forecast' ? 232 : 112
  const height = props.model?.kind === 'center' ? 258 : props.model?.kind === 'forecast' ? 232 : 110
  const preferredLeft = nodePopup ? props.x - width / 2 : props.x + 18
  const left = Math.max(8, Math.min(props.viewportWidth - width - 8, preferredLeft))
  const preferredTop = nodePopup ? props.y - height - 34 : props.y - height / 2
  const top = Math.max(8, Math.min(props.viewportHeight - height - 8, preferredTop))
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
})
</script>

<style scoped>
.typhoon-hover{position:absolute;z-index:1200;box-sizing:border-box;padding:4px;border:3px solid #2563eb;border-radius:9px;background:#2563eb;box-shadow:0 10px 28px rgba(15,23,42,.3);color:#0f172a;pointer-events:none}.typhoon-hover header{min-height:30px;display:flex;align-items:center;gap:7px;padding:2px 3px 5px;color:#fff;white-space:nowrap}.typhoon-hover header strong{overflow:hidden;font-size:13px;text-overflow:ellipsis}.typhoon-hover header time{margin-left:auto;color:#facc15;font-size:12px;font-weight:800}.typhoon-hover header span{overflow:hidden;color:#dbeafe;font-size:10px;text-overflow:ellipsis}.typhoon-hover dl{margin:0;padding:7px 8px;border-radius:7px;background:rgba(248,250,252,.94)}.typhoon-hover dl div{min-height:30px;display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;border-bottom:1px solid #cbd5e1}.typhoon-hover dl div:last-child{border-bottom:0}.typhoon-hover dt{color:#64748b;font-size:13px}.typhoon-hover dd{margin:0;overflow:hidden;color:#475569;font-size:12px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.typhoon-hover dd b{color:#ef4444;font-weight:700}.typhoon-hover.forecast{width:232px}.typhoon-hover.forecast header time{color:#facc15}.typhoon-hover.forecast dl div{grid-template-columns:66px minmax(0,1fr)}.typhoon-hover.forecast dl div:last-child dd{color:#ef4444;font-weight:700}.typhoon-hover.wind{padding:5px 7px;border:0;border-radius:7px;background:rgba(255,255,255,.96);box-shadow:0 5px 16px rgba(15,23,42,.22)}.typhoon-hover.wind header{min-height:0;padding:0 0 4px;border-bottom:1px solid #cbd5e1;color:#475569}.typhoon-hover.wind header strong{font-size:13px}.typhoon-hover.wind header span{display:none}.quadrants{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;padding:4px 0 0;background:transparent}.quadrants span{display:grid;gap:1px;padding:0;border:0;border-radius:0;color:#334155;font-size:12px}.quadrants b{color:#3b82f6;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}@media(max-width:520px){.typhoon-hover.center,.typhoon-hover.forecast{max-width:calc(100vw - 16px)}}
</style>
