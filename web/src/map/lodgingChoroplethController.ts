import L from 'leaflet'
import type { Feature, Geometry } from 'geojson'
import type { DamageRate } from '../features/lodging/lodgingCalc'

/**
 * 倒伏评估 Choropleth 填色图图层控制器（需求 §3.2）
 * - 按行政区划面填色，颜色按受损率分档：0% 透明 / 30% 绿 / 60% 黄 / 100% 红
 * - pane < 450（不遮挡天地图文字注记与地块）
 * - 悬停 tooltip 显示区划名称 + 受损率
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

/** 受损率 → 填色（需求 §3.2：0% 透明 / 30% 绿 / 60% 黄 / 100% 红） */
export const DAMAGE_RATE_FILL_COLOR: Record<DamageRate, string> = {
  0: 'transparent',
  30: 'rgba(34, 197, 94, 0.45)',   // success-green
  60: 'rgba(234, 179, 8, 0.5)',    // warning-yellow
  100: 'rgba(239, 68, 68, 0.55)',  // danger-red
}

/** 受损率 → 描边色 */
export const DAMAGE_RATE_STROKE_COLOR: Record<DamageRate, string> = {
  0: 'transparent',
  30: '#16a34a',
  60: '#ca8a04',
  100: '#dc2626',
}

export const DAMAGE_RATE_TEXT: Record<DamageRate, string> = {
  0: '无受损',
  30: '轻度',
  60: '中度',
  100: '重度',
}

export interface ChoroplethEntry {
  /** 区划代码 */
  code: string
  /** 区划名称 */
  name: string
  /** 受损率 */
  damageRate: DamageRate
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
    pane.style.pointerEvents = 'none' // 不拦截点击，由 GeoJSON feature 单独处理
  }

  function render(): void {
    if (!map || !layerGroup) return
    layerGroup.clearLayers()
    if (!visible) return

    for (const entry of entries) {
      // 受损率 0% 不填色（透明），跳过渲染以提升性能
      if (entry.damageRate === 0) continue

      const fillColor = DAMAGE_RATE_FILL_COLOR[entry.damageRate]
      const strokeColor = DAMAGE_RATE_STROKE_COLOR[entry.damageRate]

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
          className: 'lodging-choropleth-feature', // 用于 CSS 移除点击边框
        },
        onEachFeature: (_feat, lyr) => {
          // 悬停 tooltip
          const rateText = DAMAGE_RATE_TEXT[entry.damageRate]
          lyr.bindTooltip(
            `<b>${entry.name}</b><br/>受损率 ${entry.damageRate}%（${rateText}）`,
            { sticky: true, direction: 'auto' }
          )
          // 点击回调
          lyr.on('click', (e) => {
            L.DomEvent.stopPropagation(e) // 阻止冒泡，避免触发地图点击
            options.onRegionClick?.(entry.code)
          })
          // 允许该 feature 接收事件
          const el = (lyr as L.Path).getElement()
          if (el) {
            (el as HTMLElement).style.pointerEvents = 'auto'
            ;(el as HTMLElement).style.outline = 'none' // 移除焦点边框
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
