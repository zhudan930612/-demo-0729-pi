import L from 'leaflet'
import type { Level } from '../stores/drilldown'
import type { VillageBoundary } from '../features/village-risk/villageRiskData'
import { RISK_LEVEL_TEXT, type RiskLevel } from '../features/village-risk/villageRisk'

/**
 * 参保村灾害风险标注图层控制器（需求 §4.2）
 * - 乡镇级及以上（county/township）：等级色圆点标记（白边、悬停村名、可点击）
 * - 村级（village）：村面淡色填充（pointer-events:none，不拦截地块点击）+ 等级色描边（可点击）
 * - 省市不显示；图例在乡镇级及以上显示
 * - pane：fill 435（< 地块 440，不拦截）、marker 457（可交互，高于注记 450）
 */

export const VILLAGE_RISK_PANES = {
  fill: { name: 'villageRiskFillPane', zIndex: 435 },
  marker: { name: 'villageRiskMarkerPane', zIndex: 457 },
} as const

export const RISK_FILL_COLOR: Record<RiskLevel, string> = {
  0: 'rgba(148, 163, 184, 0.22)',
  1: 'rgba(22, 101, 52, 0.22)',
  2: 'rgba(202, 138, 4, 0.26)',
  3: 'rgba(185, 28, 28, 0.28)',
}

export const RISK_STROKE_COLOR: Record<RiskLevel, string> = {
  0: '#94a3b8',
  1: '#166534',
  2: '#ca8a04',
  3: '#b91c1c',
}

export const RISK_MARKER_COLOR: Record<RiskLevel, string> = RISK_STROKE_COLOR

export interface VillageRiskEntry {
  village: VillageBoundary
  level: RiskLevel
}

export interface VillageRiskLayerCallbacks {
  onVillageClick?(code: string, point: { x: number; y: number }): void
}

export interface VillageRiskLayerController {
  mount(map: L.Map): void
  setData(entries: VillageRiskEntry[]): void
  setLevel(level: Level): void
  setVisible(visible: boolean): void
  setSelected(code: string | null): void
  clear(): void
  destroy(): void
}

let styleInjected = false
function ensureStyle() {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.village-risk-marker-wrap { position: relative; width: 14px; height: 14px; }
.village-risk-marker {
  display: block; width: 12px; height: 12px; margin: 1px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: var(--risk-color);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.45);
  cursor: pointer; padding: 0;
}
.village-risk-marker-wrap.selected .village-risk-marker {
  width: 14px; height: 14px; margin: 0;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35), 0 1px 3px rgba(15, 23, 42, 0.45);
}
.village-risk-legend {
  position: absolute; left: 12px; top: 64px; z-index: 1000;
  display: flex; align-items: center; gap: 10px;
  padding: 5px 10px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.14);
  font-size: 10px; color: #475569; line-height: 1;
}
.village-risk-legend-item { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.village-risk-legend-dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.5); }
.village-risk-legend-note { color: #94a3b8; white-space: nowrap; }
`
  document.head.appendChild(style)
}

export function buildVillageMarkerHtml(entry: VillageRiskEntry): string {
  const color = RISK_MARKER_COLOR[entry.level]
  return `<button type="button" class="village-risk-marker" style="--risk-color:${color}" aria-label="${entry.village.name}，${RISK_LEVEL_TEXT[entry.level]}，点击查看风险详情"></button>`
}

export function createVillageRiskLayerController(options: VillageRiskLayerCallbacks = {}): VillageRiskLayerController {
  let map: L.Map | null = null
  let entries: VillageRiskEntry[] = []
  let level: Level = 'province'
  let visible = false
  let selectedCode: string | null = null
  let fillGroup: L.LayerGroup | null = null
  let markerGroup: L.LayerGroup | null = null
  let strokeGroup: L.LayerGroup | null = null
  let selectionMarker: L.Marker | null = null
  let legendEl: HTMLDivElement | null = null

  function ensurePane(target: L.Map, name: string, zIndex: number): HTMLElement {
    const pane = target.getPane(name) ?? target.createPane(name)
    pane.style.zIndex = String(zIndex)
    if (name === VILLAGE_RISK_PANES.fill.name) pane.style.pointerEvents = 'none'
    return pane
  }

  function villageLatLng(village: VillageBoundary): [number, number] {
    return [village.centroid.lat, village.centroid.lon]
  }

  function clickPoint(latlng: L.LatLng): { x: number; y: number } {
    if (!map) return { x: 0, y: 0 }
    const point = map.latLngToContainerPoint(latlng)
    return { x: point.x, y: point.y }
  }

  function render() {
    fillGroup?.clearLayers()
    markerGroup?.clearLayers()
    strokeGroup?.clearLayers()
    selectionMarker?.remove()
    selectionMarker = null
    if (legendEl) legendEl.style.display = 'none'
    if (!map || !visible) return
    if (level === 'village') {
      // 村级高亮：淡色填充（不拦截）+ 等级色描边（可点击开卡片）
      for (const entry of entries) {
        const latlngs = entry.village.polygons.map((polygon) =>
          polygon[0]?.map(([lon, lat]) => [lat, lon] as [number, number]) ?? [])
        for (const ring of latlngs) {
          if (ring.length < 3) continue
          const fill = L.polygon(ring, {
            pane: VILLAGE_RISK_PANES.fill.name,
            interactive: false,
            fillColor: RISK_FILL_COLOR[entry.level],
            fillOpacity: 1,
            color: 'transparent',
            weight: 0,
          })
          fillGroup?.addLayer(fill)
          const stroke = L.polygon(ring, {
            pane: VILLAGE_RISK_PANES.marker.name,
            interactive: true,
            fill: false,
            color: RISK_STROKE_COLOR[entry.level],
            weight: selectedCode === entry.village.code ? 4 : 2,
            opacity: 1,
          })
          stroke.bindTooltip(entry.village.name, { direction: 'top', offset: [0, -6] })
          stroke.on('click', () => options.onVillageClick?.(entry.village.code, clickPoint(stroke.getBounds().getCenter())))
          strokeGroup?.addLayer(stroke)
        }
      }
      if (selectedCode) {
        const entry = entries.find((e) => e.village.code === selectedCode)
        if (entry) {
          const icon = L.divIcon({
            className: 'village-risk-marker-wrap selected',
            html: buildVillageMarkerHtml(entry),
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          })
          selectionMarker = L.marker(villageLatLng(entry.village), { icon, pane: VILLAGE_RISK_PANES.marker.name, keyboard: false })
          selectionMarker.addTo(map)
        }
      }
    } else if (level === 'county' || level === 'township') {
      // 乡镇级及以上：等级色圆点标记
      for (const entry of entries) {
        const icon = L.divIcon({
          className: `village-risk-marker-wrap${selectedCode === entry.village.code ? ' selected' : ''}`,
          html: buildVillageMarkerHtml(entry),
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        })
        const marker = L.marker(villageLatLng(entry.village), { icon, pane: VILLAGE_RISK_PANES.marker.name })
        marker.bindTooltip(entry.village.name, { direction: 'top', offset: [0, -8] })
        marker.on('click', () => options.onVillageClick?.(entry.village.code, clickPoint(marker.getLatLng())))
        markerGroup?.addLayer(marker)
      }
      if (legendEl) legendEl.style.display = 'flex'
    }
  }

  function resetAll() {
    entries = []
    level = 'province'
    visible = false
    selectedCode = null
    fillGroup?.clearLayers()
    markerGroup?.clearLayers()
    strokeGroup?.clearLayers()
    selectionMarker?.remove()
    selectionMarker = null
    if (legendEl) legendEl.style.display = 'none'
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePane(target, VILLAGE_RISK_PANES.fill.name, VILLAGE_RISK_PANES.fill.zIndex)
      ensurePane(target, VILLAGE_RISK_PANES.marker.name, VILLAGE_RISK_PANES.marker.zIndex)
      fillGroup = L.layerGroup([], { pane: VILLAGE_RISK_PANES.fill.name })
      markerGroup = L.layerGroup([], { pane: VILLAGE_RISK_PANES.marker.name })
      strokeGroup = L.layerGroup([], { pane: VILLAGE_RISK_PANES.marker.name })
      fillGroup.addTo(target)
      markerGroup.addTo(target)
      strokeGroup.addTo(target)
      ensureStyle()
      if (!legendEl) {
        legendEl = document.createElement('div')
        legendEl.className = 'village-risk-legend'
        legendEl.style.display = 'none'
        legendEl.setAttribute('aria-label', '参保村风险等级图例')
        legendEl.innerHTML = `
          <span class="village-risk-legend-item"><i class="village-risk-legend-dot" style="background:#b91c1c"></i>高</span>
          <span class="village-risk-legend-item"><i class="village-risk-legend-dot" style="background:#ca8a04"></i>中</span>
          <span class="village-risk-legend-item"><i class="village-risk-legend-dot" style="background:#166534"></i>低</span>
          <span class="village-risk-legend-item"><i class="village-risk-legend-dot" style="background:#94a3b8"></i>无风险</span>
          <span class="village-risk-legend-note">未参保村不标注</span>`
        target.getContainer().appendChild(legendEl)
      }
      render()
    },
    setData(next: VillageRiskEntry[]) {
      entries = next
      render()
    },
    setLevel(next: Level) {
      level = next
      render()
    },
    setVisible(next: boolean) {
      visible = next
      render()
    },
    setSelected(code: string | null) {
      selectedCode = code
      render()
    },
    clear() {
      // 闭包快照清理教训：clear() 必须重置全部状态与图层，避免残留重绘
      resetAll()
    },
    destroy() {
      resetAll()
      if (legendEl) { legendEl.remove(); legendEl = null }
      map = null
    },
  }
}
