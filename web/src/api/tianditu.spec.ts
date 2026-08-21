import { describe, expect, it, vi } from 'vitest'

// seam: createBasemaps() 返回结构。用记录型 fake 替换 leaflet，断言图层组结构与 tile URL/attribution/maxNativeZoom 配置。
const leaflet = vi.hoisted(() => {
  const tileLayers: Array<{ url: string; options: Record<string, unknown> }> = []
  const layerGroups: Array<{ layers: unknown[] }> = []
  return {
    tileLayers,
    layerGroups,
    tileLayer: (url: string, options: Record<string, unknown>) => {
      const layer = { type: 'tileLayer', url, options }
      tileLayers.push(layer)
      return layer
    },
    layerGroup: (layers: unknown[]) => {
      const group = { type: 'layerGroup', layers }
      layerGroups.push(group)
      return group
    },
  }
})

vi.mock('leaflet', () => ({ default: leaflet }))

import { createBasemaps } from './tianditu'

type FakeTileLayer = { type: 'tileLayer'; url: string; options: Record<string, unknown> }
type FakeGroup = { type: 'layerGroup'; layers: FakeTileLayer[] }

describe('createBasemaps 底图组结构', () => {
  it('含 4 个底图选项：卫星(img)/矢量(vec)/OSM 标准(osm)/OSM 地貌(topo)', () => {
    const basemaps = createBasemaps() as unknown as Record<string, FakeGroup>
    expect(Object.keys(basemaps).sort()).toEqual(['img', 'osm', 'topo', 'vec'])
  })

  it('天地图卫星/矢量底图定义保持不变（各含影像/注记两个图层）', () => {
    const basemaps = createBasemaps() as unknown as Record<string, FakeGroup>
    for (const key of ['img', 'vec'] as const) {
      const group = basemaps[key]
      expect(group.layers).toHaveLength(2)
      for (const layer of group.layers) {
        expect(layer.type).toBe('tileLayer')
        expect(new URL(layer.url).hostname).toContain('tianditu.gov.cn')
      }
    }
  })
})

describe('createBasemaps OSM 底图配置', () => {
  it('OSM 标准：tile.openstreetmap.org 瓦片、无独立注记层、官方版权文案、原生最高 z19', () => {
    const basemaps = createBasemaps() as unknown as Record<string, FakeGroup>
    const osm = basemaps.osm
    expect(osm.layers).toHaveLength(1) // 文字烘焙在瓦片中，无独立注记层
    const [layer] = osm.layers
    expect(new URL(layer.url).hostname).toBe('tile.openstreetmap.org')
    expect(layer.options.attribution).toBe('© OpenStreetMap contributors')
    expect(layer.options.maxNativeZoom).toBe(19)
  })

  it('OSM 地貌：tile.opentopomap.org 瓦片、版权文案含 OpenTopoMap、原生最高 z17', () => {
    const basemaps = createBasemaps() as unknown as Record<string, FakeGroup>
    const topo = basemaps.topo
    expect(topo.layers).toHaveLength(1) // 文字烘焙在瓦片中，无独立注记层
    const [layer] = topo.layers
    expect(new URL(layer.url).hostname).toBe('tile.opentopomap.org')
    expect(layer.options.attribution).toBe('© OpenStreetMap contributors / © OpenTopoMap (CC-BY-SA)')
    expect(layer.options.maxNativeZoom).toBe(17)
  })
})
