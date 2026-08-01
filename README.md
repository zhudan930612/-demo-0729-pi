# 农险双精准地图 Demo

以天地图卫星影像为底图，浙江省 **省→市→县→乡→村** 五级下钻 + 分级行政边界展示；
乡镇级和村级叠加吉林一号 0.5m 高分影像（影像覆盖上虞章镇镇、嵊州三界镇共 17 村）；
龙江村试点展示 Delineate Anything v2 自动识别的演示地块。

当前需求与决策记录见 [docs/需求文档.md](docs/需求文档.md)。地块详情、种植档案与保单关联 V1 的业务规则及验收标准见 [docs/地块详情与保单关联V1需求.md](docs/地块详情与保单关联V1需求.md)。

## 技术栈

- 前端：`web/` —— Vue 3 + Vite + TypeScript + Leaflet + Pinia
- 台风代理：`server/` —— Node.js 内置 HTTP 服务，负责隐藏 APIHz 凭据并校验上游响应
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

### 6. 启动台风 API 代理并联调

台风功能通过独立 Node 服务访问 APIHz。APIHz 开发者 ID 和 KEY 只能由服务端读取，不得使用 `VITE_*` 变量，也不得写入浏览器代码或提交到仓库。

复制服务端环境变量示例：

Windows PowerShell：

```powershell
Copy-Item server/.env.example server/.env.local
```

macOS / Linux / Git Bash：

```bash
cp server/.env.example server/.env.local
```

编辑 `server/.env.local`，填写本机凭据：

```dotenv
APIHZ_DEVELOPER_ID=你的开发者ID
APIHZ_KEY=你的开发者KEY
PORT=8787
APIHZ_UPSTREAM_CONCURRENCY=6
APIHZ_CACHE_TTL_MS=30000
APIHZ_RATE_LIMIT_PER_MINUTE=60
```

`server/.env.local` 已被 Git 忽略。服务也兼容 `APIHZ_ID`，但优先读取 `APIHZ_DEVELOPER_ID`。生产环境应直接注入进程环境变量，不依赖文件。

在仓库根目录打开两个终端：

```bash
# 终端 1：Node 代理，默认只监听 127.0.0.1:8787
pnpm --dir server start

# 终端 2：Vite 前端
pnpm --dir web dev
```

Vite 将浏览器的 `/api` 请求转发至 `http://127.0.0.1:8787`。如本机代理端口不同，只设置非秘密变量 `DEV_API_PROXY_TARGET`，例如 `http://127.0.0.1:9000`；不要把 APIHz 凭据放入该变量。

可用以下命令检查代理：

```bash
curl http://127.0.0.1:8787/healthz
curl "http://127.0.0.1:8787/api/typhoons?year=2026"
```

`/healthz` 只返回进程状态和是否已配置，不回显凭据或资源限制数值。代理默认不开放 CORS，错误统一为 `{ "error": { "code", "message", "requestId" } }`，且不会记录完整上游 URL、查询参数或原始响应。服务默认限制 6 个全局上游请求、每 IP 每分钟 60 次请求，并对同一列表/详情请求做 in-flight 合并和 30 秒成功结果缓存；这些服务端优化不改变前端“进入模式时取得单次快照”的语义。失败响应不会缓存。

真实 API 技术探针：

```bash
pnpm --dir server probe:apihz
```

探针会安全加载 `server/.env.local`，也可读取已忽略的仓库根 `.env.local`；process environment 始终优先。默认写入当前年度 `server/reports/apihz-probe-summary.json` 脱敏聚合报告，不保存原始响应、台风编号、名称、坐标或凭据。可用非秘密变量 `PROBE_YEAR=2025` 复查某个过去年度；过去年度报告写入带年份文件，不覆盖当前年度主报告。无凭据时安全跳过并返回退出码 2。

生产部署采用同源反向代理：由 Nginx/网关通过 HTTPS 提供 `web/dist/`，把 `/api` 转发到仅在内网或 loopback 监听的 Node 服务。生产环境不使用 Vite 代理，不对 Node 服务开放任意跨域访问，并由进程管理器注入 `APIHZ_DEVELOPER_ID`、`APIHZ_KEY`。建议在公网网关同时配置按来源和路由的限流/连接上限，Node 内置限制作为第二层保护；若网关转发真实客户端地址，应由网关执行公网 IP 限流，因为 Node 默认只信任直连 socket IP，不信任可伪造的转发头。

### 7. 构建与预览发布包

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
python scripts/prepare-parcel-pilot.py enrich   # 为现有前端地块补面积/亩数和标注点（不重跑模型、不改几何）

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
