import L from 'leaflet'
import type { Feature, Geometry } from 'geojson'

/**
 * 倒伏评估 Choropleth 填色图图层控制器（需求 §3.2，v2.0）
 * - 按行政区划面填色，颜色按受损率连续值分档：0% 透明 / (0,30%) 绿 / [30,60%) 黄 / [60,100%] 红
 * - pane < 450（不遮挡天地图文字注记与地块）
 * - 悬停 tooltip 显示区划名称 + 受损率（精确百分比）
 */

export const CHOROPLETH_PANE = { name: 'lodgingChoroplethPane', zIndex: 420 } as const

// 注入 CSS 移除点击边框
let styleInjected = false
function ensureStyle(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.lodging-choropleth-feature:focus,
.lodging-choropleth-feature:active,
.leaflet-interactive:focus,
.leaflet-interactive:active {
  outline: none !important;
  box-shadow: none !important;
}
`
  document.head.appendChild(style)
}

// ========== 连续值受损率 → 颜色 ==========

/** 绿色（轻度） */
const COLOR_LIGHT = 'rgba(34, 197, 94, 0.45)'
const STROKE_LIGHT = '#16a34a'

/** 黄色（中度） */
const COLOR_MEDIUM = 'rgba(234, 179, 8, 0.5)'
const STROKE_MEDIUM = '#ca8a04'

/** 红色（重度） */
const COLOR_HEAVY = 'rgba(239, 68, 68, 0.55)'
const STROKE_HEAVY = '#dc2626'

/** 根据连续值受损率返回填充颜色 */
export function fillColorForRate(damageRate: number): string {
  if (damageRate <= 0) return 'transparent'
  if (damageRate < 30) return COLOR_LIGHT
  if (damageRate < 60) return COLOR_MEDIUM
  return COLOR_HEAVY
}

/** 根据连续值受损率返回描边颜色 */
export function strokeColorForRate(damageRate: number): string {
  if (damageRate <= 0) return 'transparent'
  if (damageRate < 30) return STROKE_LIGHT
  if (damageRate < 60) return STROKE_MEDIUM
  return STROKE_HEAVY
}

/** 根据连续值受损率返回文本描述 */
export function severityText(damageRate: number): string {
  if (damageRate <= 0) return '无受损'
  if (damageRate < 30) return '轻度'
  if (damageRate < 60) return '中度'
  return '重度'
}

export interface ChoroplethEntry {
  /** 区划代码 */
  code: string
  /** 区划名称 */
  name: string
  /** 受损率（连续值 0~100%） */
  damageRate: number
  /** GeoJSON 几何 */
  geometry: Geometry
}

export interface ChoroplethLayerCallbacks {
  onRegionClick?(code: string): void
}

export interface ChoroplethLayerController {
  mount(map: L.Map): void
  setData(entries: ChoroplethEntry[]): void
  setVisible(visible: boolean): void
  clear(): void
  destroy(): void
}

export function createChoroplethLayerController(
  options: ChoroplethLayerCallbacks = {}
): ChoroplethLayerController {
  let map: L.Map | null = null
  let entries: ChoroplethEntry[] = []
  let visible = false
  let layerGroup: L.GeoJSON | null = null

  function ensurePane(target: L.Map): void {
    const pane = target.getPane(CHOROPLETH_PANE.name) ?? target.createPane(CHOROPLETH_PANE.name)
    pane.style.zIndex = String(CHOROPLETH_PANE.zIndex)
    pane.style.pointerEvents = 'none'
  }

  function render(): void {
    if (!map || !layerGroup) return
    layerGroup.clearLayers()
    if (!visible) return

    for (const entry of entries) {
      if (entry.damageRate <= 0) continue

      const fillColor = fillColorForRate(entry.damageRate)
      const strokeColor = strokeColorForRate(entry.damageRate)
      const rateText = severityText(entry.damageRate)

      const feature: Feature = {
        type: 'Feature',
        properties: {
          code: entry.code,
          name: entry.name,
          damageRate: entry.damageRate,
        },
        geometry: entry.geometry,
      }

      const layer = L.geoJSON(feature, {
        pane: CHOROPLETH_PANE.name,
        style: {
          fillColor,
          fillOpacity: fillColor === 'transparent' ? 0 : 1,
          color: strokeColor,
          weight: 1.5,
          opacity: strokeColor === 'transparent' ? 0 : 0.8,
          className: 'lodging-choropleth-feature',
        },
        onEachFeature: (_feat, lyr) => {
          // 悬停 tooltip：显示区划名称 + 精确受损率
          const rateDisplay = entry.damageRate < 1
            ? entry.damageRate.toFixed(1)
            : Math.round(entry.damageRate).toString()
          lyr.bindTooltip(
            `<b>${entry.name}</b><br/>受损率 ${rateDisplay}%（${rateText}）`,
            { sticky: true, direction: 'auto' }
          )
          // 点击回调
          lyr.on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            options.onRegionClick?.(entry.code)
          })
          const el = (lyr as L.Path).getElement()
          if (el) {
            (el as HTMLElement).style.pointerEvents = 'auto'
            ;(el as HTMLElement).style.outline = 'none'
          }
        },
      })
      layerGroup.addLayer(layer)
    }
  }

  function resetAll(): void {
    entries = []
    visible = false
    layerGroup?.clearLayers()
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePane(target)
      ensureStyle()
      layerGroup = L.geoJSON(undefined, { pane: CHOROPLETH_PANE.name })
      layerGroup.addTo(target)
      render()
    },

    setData(next: ChoroplethEntry[]) {
      entries = next
      render()
    },

    setVisible(next: boolean) {
      visible = next
      render()
    },

    clear() {
      resetAll()
    },

    destroy() {
      resetAll()
      layerGroup?.remove()
      layerGroup = null
      map = null
    },
  }
}
