import L from 'leaflet'
import type { Level } from '../stores/drilldown'
import type { DisasterWarningLevel, DisasterWarningVillage } from '../features/disaster-warning/types'
import { WARNING_LEVEL_COLOR } from '../features/disaster-warning/disasterWarningSelectors'
import { fetchJSON } from '../api/data'
import type { FeatureCollection } from 'geojson'

/**
 * 受灾预警村级图层（R3-6~R3-8、R3-19/R3-20/R3-22）。
 * - 县/乡镇/村级视角：**移除放射点脉冲标记**，改为按预警等级给**村边界**（面）上色高亮；
 *   村界几何来自 /data/villages/{townshipCode}.geojson（复用下钻村界数据，非村点伪造）；低风险不上图。
 * - 省/市级视角：按区县聚合为**预警徽标**（⚠ + 中/高风险村数，底色=该县最高等级色，落政府驻地/边界质心）。
 * - 点击徽标 = 下钻该区县；点击村边界 = 进入村级视角。
 * - pane 层级低于天地图文字注记（<450），不遮挡行政边界。
 */
export const DISASTER_WARNING_PANES = {
  boundary: { name: 'disasterWarningBoundaryPane', zIndex: 438 },
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
/** 预警徽标样式（放射点脉冲样式已随边界高亮方案移除） */
function ensureBadgeStyle() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
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
  let boundaryLayer: L.LayerGroup | null = null
  let badgeLayer: L.LayerGroup | null = null
  let rendered: DisasterWarningLayerSnapshot | null = null
  // 乡镇村界缓存：key=townshipCode（村界几何静态不变，跨节点复用，不重复取）
  const boundaryCache = new Map<string, FeatureCollection>()
  // 已绘制村界：风险升级/降级只改样式，新增/解除才增删图层。
  const renderedBoundaries = new Map<string, { level: 2 | 3; layer: L.GeoJSON }>()

  function ensurePanes(target: L.Map) {
    for (const pane of Object.values(DISASTER_WARNING_PANES)) {
      const element = target.getPane(pane.name) ?? target.createPane(pane.name)
      element.style.zIndex = String(pane.zIndex)
    }
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

  /** 拉取某乡镇村界（缓存；同乡镇只取一次）。 */
  async function loadTownshipBoundary(townshipCode: string) {
    if (boundaryCache.has(townshipCode)) return
    try {
      const fc = await fetchJSON<FeatureCollection>(`/data/villages/${townshipCode}.geojson`)
      boundaryCache.set(townshipCode, fc ?? ({ type: 'FeatureCollection', features: [] } as FeatureCollection))
    } catch {
      // 村界数据缺失：该乡镇无村界可高亮（不影响其它乡镇/徽标）
      boundaryCache.set(townshipCode, { type: 'FeatureCollection', features: [] } as FeatureCollection)
    }
  }

  /** 县/乡镇/村级：按预警等级给村边界面上色（R3-6/R3-22）。 */
  function drawBoundaries(snapshot: DisasterWarningLayerSnapshot) {
    if (!map || !boundaryLayer) return
    const next = new Map(snapshot.entries.filter((entry) => entry.level >= 2)
      .map((entry) => [entry.village.code, entry] as const))

    for (const [code, current] of renderedBoundaries) {
      const desired = next.get(code)
      if (!desired) {
        boundaryLayer.removeLayer(current.layer)
        renderedBoundaries.delete(code)
      } else {
        if (current.level !== desired.level) {
          const color = WARNING_LEVEL_COLOR[desired.level]
          current.layer.setStyle({ color, weight: 3, opacity: 1, fillColor: color, fillOpacity: 0.3 })
          current.level = desired.level as 2 | 3
        }
        next.delete(code)
      }
    }

    // 仅为新增中/高风险村创建图层，低风险不上图。
    for (const entry of next.values()) {
      const fc = boundaryCache.get(entry.village.townshipCode)
      if (!fc) continue
      const feature = fc.features.find((f) => String(f.properties?.code) === entry.village.code)
      if (!feature) continue
      const color = WARNING_LEVEL_COLOR[entry.level]
      const layer = L.geoJSON(feature, {
        pane: DISASTER_WARNING_PANES.boundary.name,
        style: { color, weight: 3, opacity: 1, fillColor: color, fillOpacity: 0.3 },
        bubblingMouseEvents: false,
        onEachFeature: (_feature, layer) => {
          layer.on('click', (event) => {
            stop(event)
            callbacks.onVillageClick?.(entry.village.code, pointerPosition(map!, event))
          })
        },
      }).addTo(boundaryLayer)
      renderedBoundaries.set(entry.village.code, { level: entry.level as 2 | 3, layer })
    }
  }

  async function ensureAndDrawBoundaries(snapshot: DisasterWarningLayerSnapshot) {
    // 该视图涉及的乡镇可能跨多个，逐乡镇确保村界已加载后再统一绘制
    const townshipCodes = [...new Set(snapshot.entries.map((e) => e.village.townshipCode))]
    await Promise.all(townshipCodes.map(loadTownshipBoundary))
    if (rendered !== snapshot) return // 已用更新的快照重渲，丢弃过期结果
    drawBoundaries(snapshot)
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePanes(target)
      ensureBadgeStyle()
      boundaryLayer = L.layerGroup().addTo(target)
      badgeLayer = L.layerGroup().addTo(target)
      if (rendered) this.render(rendered)
    },
    render(snapshot: DisasterWarningLayerSnapshot) {
      rendered = snapshot
      if (!map) return
      const provinceCity = snapshot.level === 'province' || snapshot.level === 'city'
      if (provinceCity) {
        boundaryLayer?.clearLayers()
        renderedBoundaries.clear()
        renderBadges(snapshot)
      } else {
        badgeLayer?.clearLayers()
        void ensureAndDrawBoundaries(snapshot)
      }
    },
    clear() {
      boundaryLayer?.clearLayers()
      badgeLayer?.clearLayers()
      boundaryCache.clear()
      renderedBoundaries.clear()
      rendered = null
    },
    destroy() {
      boundaryLayer?.remove()
      badgeLayer?.remove()
      boundaryLayer = null
      badgeLayer = null
      boundaryCache.clear()
      renderedBoundaries.clear()
      map = null
      rendered = null
    },
  }
}
