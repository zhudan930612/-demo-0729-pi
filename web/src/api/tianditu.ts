import L from 'leaflet'

const TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string
const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

function tdtLayer(type: 'img_w' | 'cia_w' | 'vec_w' | 'cva_w') {
  return L.tileLayer(
    `https://t{s}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${TOKEN}`,
    {
      subdomains: SUBDOMAINS,
      maxZoom: 18, // 天地图最高 z18; z19 由前端放大(决策#16)
      updateWhenIdle: true,      // 缩放结束后再加载新瓦片, 动画期间不卡
      updateWhenZooming: false,
      keepBuffer: 3,             // 多留缓存瓦片, 回退缩放不白屏
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
    img: L.layerGroup([tdtLayer('img_w'), tdtLayer('cia_w')]),
    vec: L.layerGroup([tdtLayer('vec_w'), tdtLayer('cva_w')]),
  }
}
