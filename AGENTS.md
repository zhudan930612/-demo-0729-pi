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
- `web/src/`：Vue/Leaflet 前端；`web/src/components/MapView.vue` 负责装配（地图核心 + 跨域协调），`web/src/map/`、`web/src/features/`、`web/src/stores/` 持有地图和业务逻辑；台风/天气/降水/地块四个域各有一个 `useXxxMode` 装配 composable（`web/src/features/<域>/useXxxMode.ts`），新增域装配逻辑放对应 composable，不堆回 MapView。
- `server/`：APIHz 台风代理、资源保护、脱敏探针和测试。
- `scripts/`：边界、影像、地块预处理与数据链路检查。

## 事实来源

- 用户可见行为、业务规则和验收标准：`docs/README.md` 指向的对应现役需求。
- 产品边界与术语：`PRODUCT.md`；视觉与交互：`DESIGN.md`。
- 项目语言与统一术语（含避免词）：`CONTEXT.md`；代码、文档、验收中的用词遵循其术语表，不得使用避免词。
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
7. **数据口径/空间形态类需求（地块归属/分组/布局/造数等，用户可见产物形态由数据决定）**：必须执行 dev-flow 的**形态预检**（编码前先给用户看可目视形态样例/图，确认业务形态再编码）与**产物目视预检**（编码后先给用户目视预检产物，形态不符先回需求变更，再进自动化验收）；纯自动化验收无法替代形态确认。
8. **简单改动走快路径**：改动只落在单个组件 / composable / 单图层时，先定位目标组件 → 确认改动范围（如「只改触发交互、不改二级交互」）→ 直接改。勿为简单 UI 改动考古 `DESIGN.md`/需求文档/历史 e2e；验证按「验证命令」分级，简单改动走定向层（build + 单测 + 定向 e2e），非必要不全量。
9. **git 中间态纪律**：测基线/回退用 git（先 commit 或 `git stash`），不用 `git checkout --` 覆盖工作区（会丢未提交改动）；不在仓库/工作区生成临时备份文件（如 `_backup_*.vue`）。本仓库 `.git/hooks/` 只有 git-lfs 差量钩子，**不拦截命令或参数中的 `push` 字样**（`git push`、`git stash push`、commit message 含 `push` 均可正常执行）。真正约束推送的是远端 main 分支保护：合并 main 需 1 个 code-owner 审批（仓库 owner 因 `enforce_admins=false` 可 bypass 直推，但不留审批记录）；禁强推（`allow_force_pushes=false`）。改动完成即 commit（不 push）再继续，防并发会话覆盖。

> **诊断纪律**：排查前端渲染/时序问题时，不要向源码加 `console.log` 临时日志——vite 编译失败后 dev server 会继续服务旧 bundle，误导排查。改用 e2e DOM 断言、页面 `console` 捕获或全局标记验证；临时改动后先确认 `vue-tsc`/build 干净再诊断。

## 验证命令（按改动面分级）

> **原则**：非必要不跑全量。简单改动只测改动击中的部分；大功能/跨模块/门槛时才全量。快速层必做，定向层按改动面，全量层作为兜底，不是默认。

### 快速层（必做，任何改动）

```bash
pnpm --dir web build        # vue-tsc 类型检查 + vite 编译
pnpm --dir web test         # vitest 单测（约 5 秒，可全量）
git diff --check
```

### 定向层（简单改动）

改动只落在一个组件 / composable / 单图层时，只跑击中的测试，不要全量：

```bash
# vitest 定向到受影响文件（示例）：
pnpm --dir web exec vitest run src/features/weather/useWeatherMode.ts
# playwright 定向到受影响 spec（示例：改 MapControlStack）：
pnpm --dir web exec playwright test e2e/weather.spec.ts e2e/nationalAlarms.spec.ts e2e/basemapMenu.spec.ts e2e/manualParcel.spec.ts
```

### 全量层（大改动 / 门槛）

触及**共用面板、下钻、跨域合成（MapView）、静态数据链路、区划规则**，或合并/发布前，跑全量（跑前先清理 8790/4173 残留端口）：

```bash
pnpm --dir web test:e2e
```

### 其它域

```bash
pnpm --dir server test              # 修改 server（台风代理/预警/限流）时
python scripts/validate-data.py     # 修改数据脚本或层级链路时
python scripts/validate-policy-fixture.py --all   # 修改保单/地块区划数据或脚本时（区域模式村 + 聚类村全量校验）
python scripts/check-codes.py       # 修改编码归属逻辑时
```

### 简单 vs 大改动判定

- **简单**：改动只落在一个组件 / composable / 单图层 / 单域 → 定向层。
- **大**：改动落到共享组件、`MapView`、下钻、多个域、静态数据格式 / 区划规则 → 全量层。
- **拿不准就全量**（全量是兜底，不是默认）。

## 硬约束

- 不提交 `.env.local`、天地图 Token 或 APIHz 凭据；示例见 `web/.env.local.example`、`server/.env.example`。
- `01-行政区划/`、`05-遥感数据/` 源数据已通过 Git LFS 入库（私有仓库 + 已授权数据，跟踪规则见 `.gitattributes`）；拉取后需 `git lfs pull` 取得实体。
- 不提交 `参考截图/`、`web/public/data/`、`web/public/tiles/` 或 `web/dist/`。
- 吉林一号影像、派生瓦片不得公开分发（私有仓库内可用，但不得转为公开仓库、公开导出或外发）；行政边界与 AI 地块 GeoJSON 按 ADR-0009/0010 随仓库公开分发（用户明确「要公开，调整约束」，授权合规风险未经核实；行政边界/村界经 git-lfs 分发）；锐多宝数据未获商业授权前不得对外发布。
- Delineate Anything 仅作为仓库外离线工具；不要复制其源码、环境或模型权重。
- AI 地块不得描述为确权、承保或测绘成果。
- 村是导航终点；不得用村点生成伪村界。更深层级和村界来源规则以现役地图需求为准。
- 保持天地图文字注记位于影像、地块和边界之上。

## 当前缺口

- 尚无独立全仓架构文档；当前架构以源码为准，历史实施决策见 `docs/archive/`，长期架构决策见 `docs/adr/`。
- 尚无统一版本化执行计划目录和 CI；验证依赖本地命令。
- `scripts/` 尚无统一锁定的 Python 依赖文件；新增依赖时同步 `README.md`。

## 不应写在这里

- 详细产品规格、缩放阈值、模型参数或数据统计；放入 `docs/README.md` 路由的 owner 文档。
- 临时任务进度、会话状态、一次性调试记录或未验证猜测。
- 无法指向仓库文件、命令或检查器的空泛要求。
