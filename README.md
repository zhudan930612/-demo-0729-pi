# 农险双精准地图 Demo

以天地图卫星影像为底图，浙江省 **省→市→县→乡→村** 五级下钻 + 分级行政边界展示；
乡镇级和村级叠加吉林一号 0.5m 高分影像（影像覆盖上虞章镇镇、嵊州三界镇共 17 村）；
13 个影像覆盖村（章镇镇 8 村 + 三界镇 5 村）展示 Delineate Anything v2 自动识别的演示地块（龙江村为首个试点）；省级灾害风险模式展示 APIHz 实时/历史台风路径、预测、风圈、警戒线和时间轴。

- 文档总入口：[docs/README.md](docs/README.md)
- 地图与地块：[docs/requirements/需求文档.md](docs/requirements/需求文档.md)
- 地块详情、种植档案与保单：[docs/requirements/地块详情与保单关联V1需求.md](docs/requirements/地块详情与保单关联V1需求.md)
- 灾害风险与台风：[docs/requirements/灾害风险与台风查看需求.md](docs/requirements/灾害风险与台风查看需求.md)
- 天气查看（实时天气）：[docs/requirements/天气查看与和风天气API接入需求.md](docs/requirements/天气查看与和风天气API接入需求.md)
- 浙江省气象预警（NMC）：[docs/requirements/全国气象预警数据接入需求.md](docs/requirements/全国气象预警数据接入需求.md)
- 已完成计划与阶段性验收归档：[docs/archive/](docs/archive/)

## 技术栈

- 前端：`web/` —— Vue 3 + Vite + TypeScript + Leaflet + Pinia
- 台风代理：`server/` —— Node.js 内置 HTTP 服务，负责隐藏 APIHz 凭据并校验上游响应
- 数据预处理：`scripts/` —— Python（pyshp / shapely / rasterio / Pillow）与政府驻地坐标表 Node 生成脚本
- 地块识别：仓库外运行 [Delineate Anything v2](https://github.com/Lavreniuk/Delineate-Anything)，结果裁界后导出静态 GeoJSON

## 从 GitHub 拉取并启动

### 1. 准备环境

- Git
- Node.js 20.19+ 或 22.12+
- pnpm 9 或更高版本；未安装时执行：`npm install -g pnpm`
- Python 3.10+（仅生成数据需要）：`pip install pyshp shapely rasterio pillow numpy`
- 可用的天地图 API Token（**必填**，地图底图）
- （可选）APIHz 开发者凭据（台风）、和风天气凭据（实时天气）；不配置时对应功能不可用，其余功能正常

### 2. 拉取代码

```bash
git clone https://github.com/zhudan930612/-demo-0729-pi.git
cd ./-demo-0729-pi
```

拉取后需取得 LFS 源数据实体（仓库私有，需已授权账号）：

```bash
git lfs pull   # 拉取 01-行政区划/、05-遥感数据/ 实际文件（约 2.1 GB）
```

### 3. 准备本地数据

源数据 `01-行政区划/`、`05-遥感数据/` 已通过 Git LFS 入库（私有仓库 + 已授权数据，跟踪规则见 `.gitattributes`）。但以下**运行产物**仍不入库：

```text
web/public/data/    # 行政边界、manifest、遥感信息及 AI 地块（脚本可生成）
web/public/tiles/   # 吉林一号 XYZ 影像瓦片（脚本可生成）
```

运行数据由脚本从源数据生成（需 Python 依赖：pyshp / shapely / rasterio / pillow / numpy）：

```bash
pip install pyshp shapely rasterio pillow numpy
bash scripts/prepare-all.sh              # 完整生成（含影像切片，约 15-40 分钟）
bash scripts/prepare-all.sh --skip-tiles # 跳过影像切片（约 6 分钟，影像用已有瓦片或稍后补跑）
```

脚本按顺序执行：边界/村界/天气索引生成 → 空间索引校验 → 脚本单元测试 → 影像切片（可选）→ 13 项数据链路校验，任一步失败即停。产物包含 `web/public/data/`、`web/public/tiles/`（未跳过时）与服务端私有 `.dev-runtime/weather-data/`（含 `weather/index-v2.json`）。

没有这些数据时，前端可以启动，但行政区划下钻和高分影像无法正常展示。

> **顺序提示**：数据生成放在依赖安装之后、启动之前即可（互不依赖）。**首次启动前至少完整跑一次 `prepare-all.sh --skip-tiles`（约 6 分钟）**，否则页面能打开但地图没有边界、无法下钻；影像可在之后补跑完整命令生成。后续所有命令均从**仓库根目录**执行。

### 4. 配置天地图 Token（前端）

```bash
cp web/.env.local.example web/.env.local          # Windows PowerShell: Copy-Item
```

编辑 `web/.env.local`：

```dotenv
VITE_TIANDITU_TOKEN=你的天地图Token
```

`.env.local` 已被 Git 忽略，禁止提交 Token。

### 5. 安装依赖并启动前端

```bash
pnpm install --dir web
pnpm --dir web dev
```

浏览器访问终端显示的地址，默认是：

```text
http://localhost:5173
```

只需地图、影像、地块与本机业务功能时可先单独启动前端；“查看台风”/“天气”还必须按下一节启动 Node 代理。

页面打开后先显示登录门禁：默认演示账号 `admin` / `admin123`，登录后才会进入地图。登录接口由 Node 代理的模拟登录服务提供（`POST /api/auth/login`，会话校验 `GET /api/auth/session`）；演示账号与有效期可用 `AUTH_USERNAME` / `AUTH_PASSWORD` / `AUTH_TOKEN_TTL_MS` 覆盖，仅限内部验证，接统一身份体系前不应视为真实安全边界。

### 6. 启动后端代理并联调（终端 1）

台风与天气通过独立 Node 服务访问 APIHz / 和风天气。APIHz 开发者 ID 和 KEY、和风凭据只能由服务端读取，不得使用 `VITE_*` 变量，也不得写入浏览器代码或提交到仓库。

复制服务端环境变量示例（从仓库根）：

```bash
cp server/.env.example server/.env.local   # Windows PowerShell: Copy-Item server/.env.example server/.env.local
```

编辑 `server/.env.local`，填写本机凭据：

```dotenv
APIHZ_DEVELOPER_ID=你的开发者ID
APIHZ_KEY=你的开发者KEY
PORT=8787
APIHZ_UPSTREAM_CONCURRENCY=6
APIHZ_CACHE_TTL_MS=30000
APIHZ_CACHE_MAX_ENTRIES=128
APIHZ_RATE_LIMIT_PER_MINUTE=60
APIHZ_RATE_LIMIT_MAX_CLIENTS=2048

# 天气服务（凭据/Host 仅限服务端）
QWEATHER_AUTH_MODE=api-key
QWEATHER_API_HOST=你的专属APIHost
QWEATHER_PROJECT_ID=你的项目ID
QWEATHER_CREDENTIAL_ID=你的凭据ID
QWEATHER_API_KEY=轮换后的APIKEY
WEATHER_DATA_DIR=../.dev-runtime/weather-data
# 可选地址增强线路；不可提交真实线路
APIHZ_ADDRESS_URL=
# 仅 loopback 缓存管理接口使用
WEATHER_ADMIN_TOKEN=本机随机管理令牌
# 可选：模拟登录（mock）演示账号与会话有效期（毫秒），默认 admin / admin123
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123
AUTH_TOKEN_TTL_MS=43200000
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

### 启动检查清单

两个服务都起来后，按顺序确认：

1. **后端健康**：`curl http://127.0.0.1:8787/healthz` 返回 `{"ok":true,...}`
2. **前端页面**：浏览器打开 http://localhost:5173 ，用演示账号登录后看到天地图底图
3. **行政区划下钻**：点击省→市→县→乡→村，边界逐级出现；乡镇/村级显示吉林一号影像（需已生成 tiles）
4. **台风**（需 APIHz 凭据）：进入灾害风险模式，台风路径/风圈/时间轴正常
5. **天气**（需和风凭据 + 已生成数据）：查看天气面板，实时/分钟降水/24 小时预报正常
6. **气象预警**：预警面板展示浙江省当前预警列表，地图有预警图标

可用以下命令检查代理：

```bash
curl http://127.0.0.1:8787/healthz
curl "http://127.0.0.1:8787/api/typhoons?year=2026"
curl "http://127.0.0.1:8787/api/weather?contextLevel=province&contextCode=330000&target=admin"
curl "http://127.0.0.1:8787/api/national-weather-alarms"
```

`/healthz` 只返回进程状态和是否已配置，不回显凭据或资源限制数值。代理默认不开放 CORS，错误统一为 `{ "error": { "code", "message", "requestId" } }`，且不会记录完整上游 URL、查询参数或原始响应。服务默认限制 6 个全局上游请求、每 IP 每分钟 60 次请求，并对同一列表/详情请求做 in-flight 合并和 30 秒成功结果缓存；缓存最多保留 128 条、限流窗口最多跟踪 2048 个直连 IP，均会在后续访问时全量回收过期项，满载时按最旧/LRU 顺序淘汰。这些服务端优化不改变前端“进入模式时取得单次快照”的语义。失败响应不会缓存。

天气首期已实现：和风天气的实时、分钟降水与 24 小时预报已完成脱敏真实探针和真实 Chrome 关键链路验收，验收摘要见 [`docs/archive/天气查看V1验收记录.md`](./docs/archive/天气查看V1验收记录.md)；"气象预警"模块已由 NMC 浙江预警接管并取代（服务端新增 `/api/national-weather-alarms` 列表/详情/手动刷新路由，固定全省完整列表、图标锚定经核验政府驻地坐标、浮窗仅标题/发布时间/官方正文且无外链，行为以 [`docs/requirements/全国气象预警数据接入需求.md`](docs/requirements/全国气象预警数据接入需求.md) 为准），和风预警请求已下线。实时天气已升级为多级政府驻地标牌：服务端 `/api/weather/markers` 按当前层级以 NDJSON 流返回子级目标骨架与逐项摘要（省→11 市、市→区县、县→乡镇，乡镇/村/地块无预置标牌只可 `Ctrl + 左键`），标牌坐标来自边界校验后的政府驻地表；点击标牌请求 `target=seat` 完整详情，服务端自行取同一可信坐标。可选 `APIHZ_ADDRESS_URL` 当前未配置，地址增强真实链路尚未验收，界面按标牌完整行政路径或地图点选位置文案降级，不阻断实时天气三个模块。前端仅请求本站 `/api/weather`、`/api/weather/markers` 与 `/api/national-weather-alarms`，天气与台风模式互斥；天气保持当前行政视角，支持多级常驻标牌、桌面 `Ctrl + 左键单击` 临时点、标牌摘要与浮窗独立失败及每 10 分钟刷新。QWeather Icons 通过 npm 包 `qweather-icons` 本地构建，不使用运行时 CDN；包代码与随包图标/字体资源的 MIT License 原文和归属保存在 [`web/THIRD_PARTY_NOTICES.md`](./web/THIRD_PARTY_NOTICES.md)，构建时同步复制到 `web/dist/THIRD_PARTY_NOTICES.md`。该声明不代表或变更另行提供的 CC BY 4.0 设计源文件许可。

天气代理严格消费服务端私有的 `WEATHER_DATA_DIR/weather/index-v2.json` 及其边界引用：`target=admin` 不接受浏览器坐标；`target=parcel` 要求村上下文且点在村界内；`target=picked` 要求点在浙江省真实省界内；`target=seat` 只接受市/县/乡镇代码，坐标由服务端从边界校验后的政府驻地表（`server/data/government-seats-v1.json`）解析，不接受浏览器坐标。`/api/weather/markers` 只接受 `contextLevel/contextCode`，首个事件为目标骨架后逐项 `ready/error`，断连即取消。非法请求在任何上游调用前拒绝。和风天气的实时、分钟降水、24 小时预报独立缓存与返回（“气象预警”模块已由 NMC 浙江预警接管，和风预警请求下线，见下方预警代理说明），地址增强失败只降级地址模块。天气缓存按实时 10 分钟、分钟降水 5 分钟、逐小时 30 分钟、地址 30 天新鲜期管理；到期刷新失败可保留上次成功结果。清缓存只允许 loopback 使用 `DELETE /api/weather/cache` 并携带 `X-Weather-Admin-Token`，未配置令牌或匿名请求均拒绝。

天气关键路径可用非敏感 fixture 在系统 Chrome 中回归，不访问和风天气、APIHz 或天地图：

```bash
pnpm --dir web test:e2e
```

真实 API 技术探针：

```bash
pnpm --dir server probe:apihz
# 仅在确认当前 KEY 未曾暴露后运行；报告文件为本机忽略产物
QWEATHER_KEY_ROTATED_CONFIRMED=yes PROBE_WEATHER_LAT=本机测试纬度 PROBE_WEATHER_LON=本机测试经度 pnpm --dir server probe:weather
```

探针会安全加载 `server/.env.local`；process environment 始终优先。默认写入当前年度 `server/reports/apihz-probe-summary.json` 脱敏聚合报告，不保存原始响应、台风编号、名称、坐标或凭据。可用非秘密变量 `PROBE_YEAR=2025` 复查某个过去年度；过去年度报告写入带年份文件，不覆盖当前年度主报告。无凭据时安全跳过并返回退出码 2。

生产部署采用同源反向代理：由 Nginx/网关通过 HTTPS 提供 `web/dist/`，把 `/api` 转发到仅在内网或 loopback 监听的 Node 服务。生产环境不使用 Vite 代理，不对 Node 服务开放任意跨域访问，并由进程管理器注入 `APIHZ_DEVELOPER_ID`、`APIHZ_KEY`。建议在公网网关同时配置按来源和路由的限流/连接上限，Node 内置限制作为第二层保护；若网关转发真实客户端地址，应由网关执行公网 IP 限流，因为 Node 默认只信任直连 socket IP，不信任可伪造的转发头。

### 7. 构建与预览发布包

```bash
pnpm --dir web build
pnpm --dir web preview --host 0.0.0.0
```

- 构建产物位于 `web/dist/`
- 本机预览默认地址为 `http://localhost:4173`
- 同一局域网访问时，使用 `http://本机局域网IP:4173`

## 从源数据完整复现

源数据（行政区划、遥感 TIF）已通过 Git LFS 入库（`git lfs pull` 后位于约定目录）：

```
01-行政区划/浙江四级边界加村点/   # 锐多宝浙江省界 + 11 地市 zip
01-行政区划/浙江村界数据/3浙江村界-备注省市县乡/  # 村界 SHP
05-遥感数据/                      # 吉林一号 TIF
```

```bash
pip install pyshp shapely rasterio pillow numpy

python scripts/prepare-boundaries.py     # 前端边界 -> web/public/data/；服务端天气副本 -> .dev-runtime/weather-data/
python scripts/weather_spatial_index.py --validate-only  # 校验私有天气索引、边界引用与完整父链 covers
python -m unittest discover -s scripts/tests -p "test_*.py"  # 非敏感小型 fixture 测试
python scripts/prepare-rs-tiles.py       # 影像切片 -> web/public/tiles/
python scripts/validate-data.py          # 数据链路校验(13 项)
python scripts/prepare-parcel-pilot.py prepare  # 村裁片（默认龙江村；--village {村代码} 指定其他村；模型推理需独立 Python 3.11 环境）
python scripts/prepare-parcel-pilot.py enrich   # 为现有前端地块补面积/亩数和标注点（不重跑模型、不改几何）
TIANDITU_GEOCODER_KEY=... node scripts/generate-government-seats.mjs  # 一次性生成政府驻地坐标表（省/市/县 102 条）写入 server/data/government-seats-v1.json（天地图地理编码；密钥只从环境变量读取）
TIANDITU_GEOCODER_KEY=... node scripts/generate-government-seats.mjs --full  # 追加乡镇级坐标（1390 乡镇）至同一表；天地图乡镇级重名地名常返回省外同名点，匹配分 <60 的乡镇标记 unresolved 不参与定位；断点续跑+每200条checkpoint
node scripts/generate-government-seats.mjs --output-only              # 离线校验坐标表结构与覆盖范围（不访问天地图；--full 时校验全量）
python scripts/check-government-seats.py  # 政府驻地表 vs 天气空间索引：代码/名称/层级匹配、评分门槛、候选驻地点位于自身+完整父链+省界范围内，输出各层级可用数与最大单县乡镇数（无坐标明细）

cp web/.env.local.example web/.env.local  # 填入 VITE_TIANDITU_TOKEN
pnpm install --dir web
pnpm --dir web dev
```

私有 `weather/index-v2.json` 只保存五级父子关系、最终边界文件引用和每个可信行政面在“自身 + 完整父链 + 浙江省界”共同交集内的代表点，不复制几何。服务端必须同时读取私有索引与其引用的最终 GeoJSON，并用完整父链面几何做授权校验；索引或边界缺失、损坏、几何无效、行政代码重复/名称冲突、代表点越出自身或任一父级时应拒绝加载，不能用包围盒降级放行。已确认的源数据错码/错归属只能通过受版本控制的 `scripts/data/weather-village-corrections-v1.json` 修正：规则记录源文件签名、记录序号、伴随源的 `objectid`、旧值、新值/丢弃动作、理由和公开来源；生成器仅在所有签名与旧值精确匹配时应用，源数据漂移或规则未命中均 fail closed。当前规则将凤凰村修正为统计用区划码 `330182108264`，丢弃错误归入三都镇的湖岑畈村重复记录，并将更楼街道湖岑畈村由源旧码 `330182003009` 修正为连续多期区划目录代码 `330182003206`；仓库已提交数据中没有旧码引用。四级边界源中的已确认乡镇错标同样必须经 `scripts/data/weather-township-corrections-v1.json` 的 ZIP/成员签名和要素旧值精确匹配修正；当前规则只丢弃误标为东阳市 `330783005000` 的“赤溪街道”小面，保留该代码的江北街道和兰溪市 `330781005000` 的赤溪街道。村界源还混有末三位为 `000` 的乡镇本级/围垦面记录；生成器按 12 位统计用区划代码结构排除这些非村级记录并输出计数，避免其冒充村节点。其余经源签名、行政代码结构和现役四级边界父链交叉核验确认的错归属记录同样写入版本化修正规则；无法可靠归属的省界外/海岛杂面 fail closed 丢弃。无村面文件的 38 个乡镇由 `scripts/data/weather-missing-villages-allowlist-v1.json` 精确约束，集合漂移即拒绝生成。不得绕过规则文件在脚本中增加静默特殊判断。前端边界位于未提交的 `web/public/data/`；天气代理只使用未提交的 `.dev-runtime/weather-data/` 私有副本，防止浏览器取得服务端授权索引。浙江预警地图图标固定锚定仓库内受控表 `server/data/government-seats-v1.json`（省、11 市、90 区县经核验政府驻地坐标，记录行政代码、名称、层级、查询名称、坐标、匹配分与生成时间；运行索引默认从 `server/data/` 读取，可用 `GOVERNMENT_SEATS_FILE` 覆盖相对 `server/` 的路径）；运行时不查询天地图或其他地理编码服务，坐标缺失、低于约定匹配分、名称/层级不一致或不在行政面及完整父链内时拒绝加载预警空间索引，不能退回面内代表点、几何中心或包围盒。同一表还可包含 `--full` 生成的乡镇级坐标（1390 条，天地图对乡镇重名地名会返回省外同名点，故匹配分 <60 的乡镇标记为 `unresolved` 不参与定位）；预警运行索引只读取省/市/县子集，其余层级条目忽略。

## 版权说明

- 锐多宝行政区划数据仅限学术研究/内部验证；本仓库私有环境下已获授权可 LFS 入库，未取得商业授权前不得对外发布
- 吉林一号影像为商业数据，派生瓦片及 AI 识别地块 GeoJSON 同样不得公开分发（私有仓库内可用，不得转为公开仓库或外发）
- Delineate Anything 采用 AGPL-3.0；本项目仅将其作为仓库外离线预处理工具，模型源码和权重不入库
- AI 地块为零样本演示结果，不是确权、承保或测绘成果
