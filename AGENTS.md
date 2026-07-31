# AGENTS.md

## 仓库目的

- 本仓库是浙江农业保险地图 Demo：天地图底图、浙江省五级行政区划下钻、吉林一号影像叠加和龙江村 AI 地块展示。
- 优先保证空间数据链路正确、地图交互稳定、受限数据不外泄。
- 仓库文件是事实来源；不要依赖未落盘的聊天上下文。

## 仓库地图

- `README.md`：项目概览、本地运行、数据准备和版权限制。
- `PRODUCT.md`：稳定的产品定位、用户、能力边界与受限数据约束。
- `DESIGN.md`：地图工作台的视觉令牌、组件模式和界面边界。
- `docs/需求文档.md`：当前地图与地块功能、已确认决策、数据约束和验收标准。
- `docs/地块详情与保单关联V1需求.md`：下一期地块详情与保单关联的需求边界；未实施前不得当作当前行为。
- `docs/MapView拆分计划.md`：地图模块拆分的架构决策、实施结果与回归清单。
- `web/src/components/MapView.vue`：地图装配、状态协调和 Leaflet 生命周期。
- `web/src/map/`：导航、图层、工作模式与手动画图控制器。
- `web/src/features/parcels/`：地块筛选、批量编辑、样式、类型及单元测试。
- `web/src/stores/drilldown.ts`、`web/src/api/`：下钻状态、静态数据请求与天地图配置。
- `scripts/`：边界、影像、地块预处理和数据链路检查；逐个脚本是其产物格式的事实来源。

## 事实来源

- 当前产品行为与验收：`docs/需求文档.md`；跨期需求以 `docs/地块详情与保单关联V1需求.md` 为准。
- 产品边界与术语：`PRODUCT.md`；视觉与交互样式：`DESIGN.md`。
- 地图模块职责和拆分后的回归路径：`docs/MapView拆分计划.md`、`web/src/map/`、`web/src/features/parcels/`。
- 本地运行、依赖、受限数据和版权：`README.md`、`web/package.json`。
- 数据产物格式和生成规则：相应的 `scripts/*.py`；全链路检查入口为 `python scripts/validate-data.py`。

若文档、代码或生成数据冲突，先实测，修正拥有该事实的文档；不要在本文件复制详细规格。

## 工作闭环

1. 先读本文件，再按任务进入上面的 owner 文档和模块。
2. 改变用户可见行为、术语或验收条件前后，同步 `docs/需求文档.md`；跨期需求同时核对对应 V1 文档。
3. 改动地图装配时先读 `docs/MapView拆分计划.md`；按职责修改 `web/src/map/`、`web/src/features/parcels/` 或视图组件，避免把逻辑重新堆回 `MapView.vue`。
4. 改动静态数据格式或路径时，同时检查生成脚本、`web/src/stores/drilldown.ts`、`web/src/api/data.ts` 与前端加载路径。
5. 前端改动至少运行：
   ```bash
   cd web && pnpm test && pnpm build
   ```
6. 数据脚本或层级链路改动后运行：
   ```bash
   python scripts/validate-data.py
   ```
   编码归属逻辑变化时，再运行 `python scripts/check-codes.py`。
7. 记录实际验证结果；未运行对应验证时不要宣称完成。

## 硬约束

- 不提交 `.env.local` 或天地图 Token；示例变量见 `web/.env.local.example`。
- 不提交 `01-行政区划/`、`05-遥感数据/`、`参考截图/`。
- 不提交 `web/public/data/`、`web/public/tiles/`、`web/dist/`；这些是本地生成或受版权约束的产物。
- 吉林一号影像、派生瓦片和 AI 地块 GeoJSON 不得公开分发。
- 锐多宝数据未获商业授权前不得对外发布；详细说明以 `README.md` 和 `docs/需求文档.md` 为准。
- Delineate Anything 仅作为仓库外离线工具；不要把其源码、环境或模型权重复制进本仓库。
- AI 地块是演示结果，不得描述为确权、承保或测绘成果。
- 村是导航终点；新增更深层级前必须先更新需求与数据方案。
- 不要用村点生成伪村界；村界来源规则见 `docs/需求文档.md`。
- 保持天地图文字注记位于影像、地块和边界之上。

## 当前缺口

- 尚无独立的全仓架构文档；地图架构以 `docs/MapView拆分计划.md`、`web/src/map/` 和 `web/src/features/parcels/` 为准。
- 尚无统一的版本化执行计划目录；复杂跨模块工作先在 `docs/` 增加专项计划，再实施。
- 尚无 CI；构建、单测和数据校验当前依赖本地命令。
- `scripts/` 尚无统一锁定的 Python 依赖文件；新增依赖时同步 `README.md`。

## 不应写在这里

- 详细产品规格、缩放阈值表、地块模型参数或数据统计；放到 `docs/需求文档.md`。
- 临时任务进度、会话状态、一次性调试记录或未验证猜测。
- 无法指向仓库文件、脚本或检查命令的空泛要求。
