import L from 'leaflet'

const TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string
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

export interface Basemaps {
  /** 卫星影像底图 + 影像注记 (决策#9, 默认) */
  img: L.LayerGroup
  /** 矢量底图 + 矢量注记 */
  vec: L.LayerGroup
}

export function createBasemaps(): Basemaps {
  return {
    img: L.layerGroup([tdtLayer('img_w', 1), tdtLayer('cia_w', 4)]),
    vec: L.layerGroup([tdtLayer('vec_w', 1), tdtLayer('cva_w', 4)]),
  }
}
