import type { BasemapKey, Basemaps } from '../api/tianditu'

/** 底图切换依赖的最小地图接口；removeLayer/addLayer 与 addTo 等价（Leaflet 图层挂载机制） */
export interface BasemapSwitchMap {
  removeLayer(layer: unknown): unknown
  addLayer(layer: unknown): unknown
}

/**
 * 切换底图：移除当前底图图层组、添加目标底图图层组。
 * 只做图层组替换——不重建地图实例、不改变中心/缩放；返回新的当前底图。
 */
export function switchBasemap(
  map: BasemapSwitchMap,
  basemaps: Basemaps,
  current: BasemapKey,
  target: BasemapKey,
): BasemapKey {
  if (target === current) return current
  map.removeLayer(basemaps[current])
  map.addLayer(basemaps[target])
  return target
}
