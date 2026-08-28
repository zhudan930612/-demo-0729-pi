import L from 'leaflet'
import type { Level } from '../stores/drilldown'
import type { DisasterWarningLevel, DisasterWarningVillage } from '../features/disaster-warning/types'
import { WARNING_LEVEL_COLOR, WARNING_LEVEL_TEXT, WARNING_MARKER_RADIUS } from '../features/disaster-warning/disasterWarningSelectors'

/**
 * 受灾预警村级标记图层（R3-6~R3-8、R3-19/R3-20/R3-22）。
 * - 县/乡镇级视角：展开为村级**水波纹脉冲标记**（实心点 + 圆环逐层向外扩散渐隐循环，
 *   各等级频率一致、与等级同色，尺寸 高=基础1.5×、中=基础）；**低风险不上图、也不进预警监测列表**（预警监测仅显示中/高风险村）。
 * - 省/市级视角：按区县聚合为**预警徽标**（⚠ + 中/高风险村数，底色=该县最高等级色，落政府驻地/边界质心）。
 * - 村级视角：显示本村及同乡镇预警村（R3-22）。
 * - 点击徽标 = 下钻该区县；点击村脉冲 = 进入村级视角。
 * - pane 层级低于天地图文字注记（<450），不遮挡行政边界。
 */
export const DISASTER_WARNING_PANES = {
  pulse: { name: 'disasterWarningPulsePane', zIndex: 440 },
  badge: { name: 'disasterWarningBadgePane', zIndex: 445 },
} as const

export interface DisasterWarningMarkerEntry {
  village: DisasterWarningVillage
  level: DisasterWarningLevel
}

export interface DisasterWarningLayerSnapshot {
  /** 当前播放节点预警村（mode 已按层级过滤：省市=全部、县/乡镇=本区域、村=本村+同乡镇；低风险已剔除） */
  entries: DisasterWarningMarkerEntry[]
  /** 当前地图层级 */
  level: Level
  /** 区县徽标落点（countyCode → [lon, lat]，政府驻地/边界质心） */
  countySeats?: Map<string, [number, number]>
}

export interface DisasterWarningLayerCallbacks {
  onBadgeClick?(countyCode: string, point: { x: number; y: number }): void
  onVillageClick?(code: string, point: { x: number; y: number }): void
}

export interface DisasterWarningLayerController {
  mount(map: L.Map): void
  render(snapshot: DisasterWarningLayerSnapshot): void
  clear(): void
  destroy(): void
}

let styleInjected = false
/** 水波纹脉冲动效样式：实心点 + 圆环逐层向外扩散渐隐循环（各等级同频） */
function ensurePulseStyle() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.dw-pulse { position: relative; width: 0; height: 0; }
.dw-pulse-dot {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px; border-radius: 50%; background: currentColor;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.85);
}
.dw-pulse-ring {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid currentColor; box-sizing: border-box;
  animation: dw-pulse-wave 1.6s ease-out infinite;
}
.dw-pulse-ring.r2 { animation-delay: 0.53s; }
.dw-pulse-ring.r3 { animation-delay: 1.06s; }
@keyframes dw-pulse-wave {
  0%   { opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
  70%  { opacity: 0;   transform: translate(-50%, -50%) scale(3.4); }
  100% { opacity: 0;   transform: translate(-50%, -50%) scale(3.4); }
}
.dw-badge {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 999px;
  border: 1.5px solid rgba(255,255,255,0.9);
  box-shadow: 0 3px 10px rgba(15,23,42,0.4);
  color: #fff; font-size: 12px; font-weight: 700; line-height: 1;
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.dw-badge .warn-flag { font-size: 11px; }
`
  document.head.appendChild(style)
}

function pointerPosition(map: L.Map, event: L.LeafletEvent): { x: number; y: number } {
  const mouse = event as L.LeafletMouseEvent
  const point = mouse.containerPoint ?? map.latLngToContainerPoint(mouse.latlng)
  return { x: point.x, y: point.y }
}

function stop(event: L.LeafletEvent) {
  const originalEvent = (event as L.LeafletMouseEvent).originalEvent
  if (originalEvent) L.DomEvent.stopPropagation(originalEvent)
}

export function createDisasterWarningLayerController(callbacks: DisasterWarningLayerCallbacks = {}): DisasterWarningLayerController {
  let map: L.Map | null = null
  let pulseLayer: L.LayerGroup | null = null
  let badgeLayer: L.LayerGroup | null = null
  let rendered: DisasterWarningLayerSnapshot | null = null

  function ensurePanes(target: L.Map) {
    for (const pane of Object.values(DISASTER_WARNING_PANES)) {
      const element = target.getPane(pane.name) ?? target.createPane(pane.name)
      element.style.zIndex = String(pane.zIndex)
    }
  }

  function pulseIcon(level: DisasterWarningLevel): L.DivIcon {
    const scale = level === 3 ? 1.5 : 1 // 高=基础1.5×、中=基础（R3-6）
    const size = Math.max(14, WARNING_MARKER_RADIUS[level] * 2 * scale)
    const color = WARNING_LEVEL_COLOR[level]
    return L.divIcon({
      className: 'dw-pulse',
      html: `<span class="dw-pulse-dot" style="color:${color}"></span><span class="dw-pulse-ring" style="color:${color}"></span><span class="dw-pulse-ring r2" style="color:${color}"></span><span class="dw-pulse-ring r3" style="color:${color}"></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    })
  }

  function badgeIcon(count: number, maxLevel: 2 | 3): L.DivIcon {
    const color = WARNING_LEVEL_COLOR[maxLevel]
    return L.divIcon({
      className: 'dw-badge-wrap',
      html: `<span class="dw-badge" style="background:${color}"><span class="warn-flag">⚠</span>${count}</span>`,
      iconSize: undefined,
    })
  }

  /** 省/市级：区县聚合徽标（R3-19） */
  function renderBadges(snapshot: DisasterWarningLayerSnapshot) {
    if (!map || !badgeLayer) return
    badgeLayer.clearLayers()
    const byCounty = new Map<string, { count: number; maxLevel: 2 | 3 }>()
    for (const entry of snapshot.entries) {
      if (entry.level < 2) continue // 低风险不上图
      const code = entry.village.countyCode
      const current = byCounty.get(code)
      if (current) {
        current.count++
        if (entry.level === 3) current.maxLevel = 3
      } else {
        byCounty.set(code, { count: 1, maxLevel: entry.level as 2 | 3 })
      }
    }
    const seats = snapshot.countySeats
    for (const [countyCode, agg] of byCounty) {
      const seat = seats?.get(countyCode)
      if (!seat) continue // 无落点（数据缺失）不显示徽标
      const marker = L.marker([seat[1], seat[0]], {
        pane: DISASTER_WARNING_PANES.badge.name,
        icon: badgeIcon(agg.count, agg.maxLevel),
        keyboard: true,
        title: `预警 ${agg.count} 村`,
        alt: `预警 ${agg.count} 村`,
        bubblingMouseEvents: false,
      }).addTo(badgeLayer)
      marker.on('click', (event) => { stop(event); callbacks.onBadgeClick?.(countyCode, pointerPosition(map!, event)) })
      marker.on('mouseover', (event) => { stop(event); marker.setZIndexOffset(50) })
      marker.on('mouseout', (event) => { stop(event); marker.setZIndexOffset(0) })
    }
  }

  /** 县/乡镇/村级：村级脉冲（R3-6/R3-22） */
  function renderPulses(snapshot: DisasterWarningLayerSnapshot) {
    if (!map || !pulseLayer) return
    pulseLayer.clearLayers()
    // R3-6 低风险不上图、也不进预警监测列表；mode 已过滤层级，这里防御性再剔除
    for (const entry of snapshot.entries) {
      if (entry.level < 2) continue
      const icon = pulseIcon(entry.level)
      const marker = L.marker([entry.village.lat, entry.village.lon], {
        pane: DISASTER_WARNING_PANES.pulse.name,
        icon,
        keyboard: true,
        title: `${entry.village.name}（${WARNING_LEVEL_TEXT[entry.level]}风险）`,
        alt: `${entry.village.name}`,
        bubblingMouseEvents: false,
      }).addTo(pulseLayer)
      marker.on('click', (event) => { stop(event); callbacks.onVillageClick?.(entry.village.code, pointerPosition(map!, event)) })
    }
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePanes(target)
      ensurePulseStyle()
      pulseLayer = L.layerGroup().addTo(target)
      badgeLayer = L.layerGroup().addTo(target)
      if (rendered) this.render(rendered)
    },
    render(snapshot: DisasterWarningLayerSnapshot) {
      rendered = snapshot
      if (!map) return
      const provinceCity = snapshot.level === 'province' || snapshot.level === 'city'
      if (provinceCity) {
        pulseLayer?.clearLayers()
        renderBadges(snapshot)
      } else {
        badgeLayer?.clearLayers()
        renderPulses(snapshot)
      }
    },
    clear() {
      pulseLayer?.clearLayers()
      badgeLayer?.clearLayers()
      rendered = null
    },
    destroy() {
      pulseLayer?.remove()
      badgeLayer?.remove()
      pulseLayer = null
      badgeLayer = null
      map = null
      rendered = null
    },
  }
}
