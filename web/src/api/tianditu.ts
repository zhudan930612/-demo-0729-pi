import L from 'leaflet'

const TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string
const TRACESTRACK_KEY = import.meta.env.VITE_TRACESTRACK_KEY as string
const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

function tdtLayer(type: 'img_w' | 'cia_w' | 'vec_w' | 'cva_w', zIndex: number) {
  return L.tileLayer(
    `https://t{s}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${TOKEN}`,
    {
      subdomains: SUBDOMAINS,
      maxNativeZoom: 18, // 天地图瓦片最高 z18; z19 由 Leaflet 自动放大 z18 瓦片
      maxZoom: 19,
      keepBuffer: 3,     // 多留缓存瓦片, 回退缩放不白屏
      zIndex,
      pane: type === 'cia_w' || type === 'cva_w' ? 'annotationPane' : 'tilePane',
      attribution: '天地图',
    },
  )
}

/** OSM 标准免 token 瓦片 + Tracestrack Topo 地貌瓦片（key 经 URL 参数）；文字注记烘焙在瓦片中，无独立注记层 */
function osmLayer(url: string, attribution: string, maxNativeZoom: number) {
  return L.tileLayer(url, {
    maxNativeZoom, // z>maxNativeZoom 由 Leaflet 放大该级瓦片（模糊属预期）
    maxZoom: 19,
    keepBuffer: 3,  // 多留缓存瓦片, 回退缩放不白屏
    zIndex: 1,
    attribution,
  })
}

export interface Basemaps {
  /** 卫星影像底图 + 影像注记 (决策#9, 默认) */
  img: L.LayerGroup
  /** 矢量底图 + 矢量注记 */
  vec: L.LayerGroup
  /** OSM 标准: OpenStreetMap 街道瓦片 (tile.openstreetmap.org, 免 token) */
  osm: L.LayerGroup
  /** OSM 地貌: Tracestrack Topo 地形瓦片 (tile.tracestrack.com, 需 key；@1x=256px 与其余底图统一) */
  topo: L.LayerGroup
}

/** 底图选项键：img/vec/osm/topo，与 Basemaps 键一一对应 */
export type BasemapKey = keyof Basemaps

export function createBasemaps(): Basemaps {
  return {
    img: L.layerGroup([tdtLayer('img_w', 1), tdtLayer('cia_w', 4)]),
    vec: L.layerGroup([tdtLayer('vec_w', 1), tdtLayer('cva_w', 4)]),
    osm: L.layerGroup([
      osmLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', 19),
    ]),
    topo: L.layerGroup([
      osmLayer(`https://tile.tracestrack.com/topo__/{z}/{x}/{y}@1x.png?key=${TRACESTRACK_KEY}`, '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>', 19),
    ]),
  }
}
