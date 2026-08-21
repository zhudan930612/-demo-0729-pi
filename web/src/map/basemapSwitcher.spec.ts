import { describe, expect, it, vi } from 'vitest'
import { switchBasemap } from './basemapSwitcher'
import type { Basemaps, BasemapKey } from '../api/tianditu'

type NamedLayer = { name: BasemapKey; addTo: ReturnType<typeof vi.fn>; removeLayer: ReturnType<typeof vi.fn> }

function fakeBasemaps(): Basemaps {
  const make = (name: BasemapKey): NamedLayer => ({ name, addTo: vi.fn(), removeLayer: vi.fn() })
  return { img: make('img'), vec: make('vec'), osm: make('osm'), topo: make('topo') } as unknown as Basemaps
}

/** 记录型假地图：仅记录被调用的方法，getCenter/getZoom 返回固定值 */
function spyMap() {
  const calls: string[] = []
  const map = {
    getCenter: vi.fn(() => ({ lat: 29.5, lng: 120.5 })),
    getZoom: vi.fn(() => 7.5),
    setView: vi.fn(() => calls.push('setView')),
    flyTo: vi.fn(() => calls.push('flyTo')),
    fitBounds: vi.fn(() => calls.push('fitBounds')),
    removeLayer: (layer: unknown) => { calls.push(`removeLayer:${(layer as NamedLayer).name}`) },
    addLayer: (layer: unknown) => { calls.push(`addLayer:${(layer as NamedLayer).name}`) },
  }
  return { map, calls }
}

describe('switchBasemap 底图切换（验收 1.2/1.3：切换不改变中心/缩放、不重建地图）', () => {
  it('移除当前底图图层组并添加目标底图图层组，返回新的当前底图', () => {
    const { map, calls } = spyMap()
    const basemaps = fakeBasemaps()
    const next = switchBasemap(map, basemaps, 'img', 'osm')
    expect(next).toBe('osm')
    expect(calls).toEqual(['removeLayer:img', 'addLayer:osm'])
  })

  it('切换不改变中心/缩放，且仅做图层组替换（同一地图实例，无任何视野/重建方法调用）', () => {
    const { map, calls } = spyMap()
    const basemaps = fakeBasemaps()
    const centerBefore = map.getCenter()
    const zoomBefore = map.getZoom()
    switchBasemap(map, basemaps, 'vec', 'topo')
    expect(map.getCenter()).toEqual(centerBefore)
    expect(map.getZoom()).toBe(zoomBefore)
    expect(calls).toEqual(['removeLayer:vec', 'addLayer:topo'])
  })

  it('切换到当前已选底图不产生任何变化', () => {
    const { map, calls } = spyMap()
    const basemaps = fakeBasemaps()
    const next = switchBasemap(map, basemaps, 'osm', 'osm')
    expect(next).toBe('osm')
    expect(calls).toEqual([])
  })

  it('连续切换正确移除旧组、添加新组并更新当前值', () => {
    const { map, calls } = spyMap()
    const basemaps = fakeBasemaps()
    let current: BasemapKey = 'img'
    current = switchBasemap(map, basemaps, current, 'topo')
    current = switchBasemap(map, basemaps, current, 'vec')
    expect(current).toBe('vec')
    expect(calls).toEqual(['removeLayer:img', 'addLayer:topo', 'removeLayer:topo', 'addLayer:vec'])
  })
})
