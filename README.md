# 农险双精准地图 Demo

以天地图卫星影像为底图，浙江省 **省→市→县→乡→村** 五级下钻 + 分级行政边界展示；
村级叠加吉林一号 0.5m 高分影像（覆盖上虞章镇镇、嵊州三界镇共 17 村）；
龙江村试点展示 Delineate Anything v2 自动识别的演示地块。

详细需求与决策记录见 [docs/需求文档.md](docs/需求文档.md)。

## 技术栈

- 前端：`web/` —— Vue 3 + Vite + TypeScript + Leaflet + Pinia
- 数据预处理：`scripts/` —— Python（pyshp / shapely / rasterio / Pillow）
- 地块识别：仓库外运行 [Delineate Anything v2](https://github.com/Lavreniuk/Delineate-Anything)，结果裁界后导出静态 GeoJSON

## 从 GitHub 拉取并启动

### 1. 准备环境

- Git
- Node.js 20.19+ 或 22.12+
- pnpm 9 或更高版本；未安装时执行：`npm install -g pnpm`
- 可用的天地图 API Token

### 2. 拉取代码

```bash
git clone https://github.com/zhudan930612/-demo-0729-pi.git
cd ./-demo-0729-pi
```

### 3. 准备本地数据

出于体积和版权限制，GitHub 仓库**不包含**以下运行数据：

```text
web/public/data/    # 行政边界、manifest、遥感信息及 AI 地块
web/public/tiles/   # 吉林一号 XYZ 影像瓦片
```

首次运行前，需要从项目维护者处取得内部数据包，并将其中的 `data/` 和 `tiles/` 放入 `web/public/`。目录至少应包含：

```text
web/public/
├── data/
│   ├── boundary/
│   ├── villages/
│   ├── manifest.json
│   └── rs.json
└── tiles/
    └── rs/
```

没有这些数据时，前端可以启动，但行政区划下钻和高分影像无法正常展示。

### 4. 配置天地图 Token

进入前端目录：

```bash
cd web
```

Windows PowerShell：

```powershell
Copy-Item .env.local.example .env.local
```

macOS / Linux / Git Bash：

```bash
cp .env.local.example .env.local
```

编辑 `web/.env.local`：

```dotenv
VITE_TIANDITU_TOKEN=你的天地图Token
```

`.env.local` 已被 Git 忽略，禁止提交 Token。

### 5. 安装依赖并启动

```bash
pnpm install
pnpm dev
```

浏览器访问终端显示的地址，默认是：

```text
http://localhost:5173
```

### 6. 构建与预览发布包

```bash
pnpm build
pnpm preview --host 0.0.0.0
```

- 构建产物位于 `web/dist/`
- 本机预览默认地址为 `http://localhost:4173`
- 同一局域网访问时，使用 `http://本机局域网IP:4173`

## 从源数据完整复现

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
python scripts/prepare-parcel-pilot.py prepare  # 龙江村试点裁片（模型推理需独立 Python 3.11 环境）

cd web
cp .env.local.example .env.local         # 填入 VITE_TIANDITU_TOKEN
pnpm install
pnpm dev
```

## 版权说明

- 锐多宝行政区划数据仅限学术研究/内部验证，未取得商业授权前不得对外发布
- 吉林一号影像为商业数据，派生瓦片及 AI 识别地块 GeoJSON 同样不得公开分发
- Delineate Anything 采用 AGPL-3.0；本项目仅将其作为仓库外离线预处理工具，模型源码和权重不入库
- AI 地块为零样本演示结果，不是确权、承保或测绘成果
