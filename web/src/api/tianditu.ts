import L from 'leaflet'

const TOKEN = import.meta.env.VITE_TIANDITU_TOKEN as string
const SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

function tdtLayer(type: 'img_w' | 'cia_w') {
  return L.tileLayer(
    `https://t{s}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${TOKEN}`,
    {
      subdomains: SUBDOMAINS,
      maxZoom: 18, // 天地图影像最高 z18; z19 由前端放大(决策#16)
      updateWhenIdle: true,      // 缩放结束后再加载新瓦片, 动画期间不卡
      updateWhenZooming: false,
      keepBuffer: 3,             // 多留缓存瓦片, 回退缩放不白屏
      attribution: '天地图影像',
    },
  )
}

/** 天地图卫星影像底图 + 影像注记 (决策#9) */
export function addTiandituLayers(map: L.Map) {
  tdtLayer('img_w').addTo(map)
  tdtLayer('cia_w').addTo(map)
}
