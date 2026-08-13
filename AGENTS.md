# AGENTS.md

## 仓库目的

- 浙江农业保险地图 Demo：天地图底图、浙江省五级行政区划下钻、吉林一号影像、地块与保单业务，以及灾害风险/台风查看。
- 优先保证空间数据链路正确、地图交互稳定、受限数据不外泄。
- 仓库文件是事实来源；不要依赖未落盘的聊天上下文。

## 仓库地图

- `README.md`：项目概览、本地运行、数据准备、代理接入和版权限制。
- `PRODUCT.md`：稳定的产品定位、能力边界和术语。
- `DESIGN.md`：地图工作台的视觉令牌与组件模式。
- `docs/README.md`：项目文档总入口；从这里进入现役需求或历史归档。
- `web/src/`：Vue/Leaflet 前端；`web/src/components/MapView.vue` 负责装配，`web/src/map/`、`web/src/features/`、`web/src/stores/` 持有地图和业务逻辑。
- `server/`：APIHz 台风代理、资源保护、脱敏探针和测试。
- `scripts/`：边界、影像、地块预处理与数据链路检查。

## 事实来源

- 用户可见行为、业务规则和验收标准：`docs/README.md` 指向的对应现役需求。
- 产品边界与术语：`PRODUCT.md`；视觉与交互：`DESIGN.md`。
- 当前架构职责：对应源码和测试；`docs/archive/` 仅用于追溯历史决策和阶段性证据。
- 本地运行、环境变量、依赖和版权：`README.md`、`web/package.json`、`server/package.json`。
- 数据产物格式和生成规则：相应的 `scripts/*.py`。

若文档、代码或生成数据冲突，先实测，再修正拥有该事实的文档；不要在本文件复制详细规格。

## 工作闭环

1. 先从 `docs/README.md` 找到任务对应的 owner 文档和代码模块。
2. 改变用户可见行为、术语或验收条件时，同步对应现役需求。
3. 改地图装配时沿用 `web/src/map/`、`web/src/features/` 和视图组件的现有职责，避免把逻辑重新堆回 `MapView.vue`。
4. 改静态数据格式或路径时，同时检查生成脚本、`web/src/stores/drilldown.ts`、`web/src/api/data.ts` 和前端加载路径。
5. 按改动范围运行下面的验证命令，并记录实际结果；未运行时不要宣称完成。
6. 复杂跨模块工作先建立版本化专项计划；仓库当前没有统一计划目录，新增入口时同步 `docs/README.md`。

## 验证命令

```bash
pnpm --dir web test
pnpm --dir web build
pnpm --dir web test:e2e             # 修改前端交互/共用面板/下钻时（跑前先清理 8790/4173 残留端口）
pnpm --dir server test              # 修改 server（台风代理/预警/限流）时
python scripts/validate-data.py     # 修改数据脚本或层级链路时
python scripts/check-codes.py       # 修改编码归属逻辑时
git diff --check
```

## 硬约束

- 不提交 `.env.local`、天地图 Token 或 APIHz 凭据；示例见 `web/.env.local.example`、`server/.env.example`。
- `01-行政区划/`、`05-遥感数据/` 源数据已通过 Git LFS 入库（私有仓库 + 已授权数据，跟踪规则见 `.gitattributes`）；拉取后需 `git lfs pull` 取得实体。
- 不提交 `参考截图/`、`web/public/data/`、`web/public/tiles/` 或 `web/dist/`。
- 吉林一号影像、派生瓦片和 AI 地块 GeoJSON 不得公开分发（私有仓库内可用，但不得转为公开仓库、公开导出或外发）；锐多宝数据未获商业授权前不得对外发布。
- Delineate Anything 仅作为仓库外离线工具；不要复制其源码、环境或模型权重。
- AI 地块不得描述为确权、承保或测绘成果。
- 村是导航终点；不得用村点生成伪村界。更深层级和村界来源规则以现役地图需求为准。
- 保持天地图文字注记位于影像、地块和边界之上。

## 当前缺口

- 尚无独立全仓架构文档；当前架构以源码为准，历史实施决策见 `docs/archive/`。
- 尚无统一版本化执行计划目录和 CI；验证依赖本地命令。
- `scripts/` 尚无统一锁定的 Python 依赖文件；新增依赖时同步 `README.md`。

## 不应写在这里

- 详细产品规格、缩放阈值、模型参数或数据统计；放入 `docs/README.md` 路由的 owner 文档。
- 临时任务进度、会话状态、一次性调试记录或未验证猜测。
- 无法指向仓库文件、命令或检查器的空泛要求。
