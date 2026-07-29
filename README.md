# 农险双精准地图 Demo

以天地图卫星影像为底图，浙江省 **省→市→县→乡→村** 五级下钻 + 分级行政边界展示；
村级叠加吉林一号 0.5m 高分影像（覆盖上虞章镇镇、嵊州三界镇共 17 村）。

详细需求与决策记录见 [docs/需求文档.md](docs/需求文档.md)。

## 技术栈

- 前端：`web/` —— Vue 3 + Vite + TypeScript + Leaflet + Pinia
- 数据预处理：`scripts/` —— Python（pyshp / shapely / rasterio / Pillow）

## 复现步骤

源数据（行政区划、遥感 TIF）不入库，需自备并放到约定目录：

```
01-行政区划/浙江四级边界加村点/   # 锐多宝浙江省界 + 11 地市 zip
01-行政区划/浙江村界数据/3浙江村界-备注省市县乡/  # 村界 SHP
05-遥感数据/                      # 吉林一号 TIF
```

```bash
pip install pyshp shapely rasterio pillow numpy

python scripts/prepare-boundaries.py     # 边界拆分 -> web/public/data/
python scripts/prepare-rs-tiles.py       # 影像切片 -> web/public/tiles/
python scripts/validate-data.py          # 数据链路校验(13 项)

cd web
cp .env.local.example .env.local         # 填入 VITE_TIANDITU_TOKEN
pnpm install
pnpm dev
```

## 版权说明

- 锐多宝行政区划数据仅限学术研究/内部验证，未取得商业授权前不得对外发布
- 吉林一号影像为商业数据，派生瓦片同样不得公开分发
