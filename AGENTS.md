# AGENTS.md

## 仓库目的

- 本仓库是浙江农业保险地图 Demo：天地图底图、浙江省五级行政区划下钻、吉林一号影像叠加和龙江村 AI 地块展示。
- 优先保证空间数据链路正确、地图交互稳定、受限数据不外泄。
- 仓库文件是事实来源；不要依赖未落盘的聊天上下文。

## 仓库地图

- `README.md`：项目概览、技术栈、数据目录与本地复现入口。
- `docs/需求文档.md`：产品行为、已确认决策、数据约束和验收标准。
- `web/`：Vue 3 + Vite + TypeScript 前端。
- `web/src/components/MapView.vue`：Leaflet 地图、图层、下钻、缩放导航和控制按钮的主要实现。
- `web/src/stores/drilldown.ts`：层级类型、下钻路径、子级数据 URL 和状态栈。
- `web/src/api/tianditu.ts`：天地图底图、注记和 pane 配置。
- `web/src/api/data.ts`：静态 JSON 请求与缓存。
- `scripts/prepare-boundaries.py`：行政边界拆分、简化和 manifest 生成。
- `scripts/prepare-rs-tiles.py`：吉林一号 TIF 转 XYZ 瓦片。
- `scripts/prepare-parcel-pilot.py`：龙江村地块试点裁片及模型结果导出。
- `scripts/check-codes.py`：行政区划编码一致性检查。
- `scripts/validate-data.py`：五级静态数据链路验证入口。

## 事实来源

- 产品行为与已确认取舍：`docs/需求文档.md`。
- 本地运行、数据准备与版权说明：`README.md`。
- 前端依赖和可用命令：`web/package.json`。
- 当前地图架构：`web/src/components/MapView.vue`、`web/src/stores/drilldown.ts`、`web/src/api/`。
- 数据产物格式与生成规则：对应的 `scripts/*.py`。
- 数据链路是否完整：`python scripts/validate-data.py`。

若文档与当前代码或生成数据冲突，先实测并修正文档；不要在本文件复制详细规格。

## 工作闭环

1. 先读本文件，再按任务读取上面的 owner 文件。
2. 修改用户可见行为前，核对 `docs/需求文档.md`；行为变化后同步该文档。
3. 修改数据格式时，同时检查生成脚本、`web/src/stores/drilldown.ts` 和前端加载路径。
4. 小步修改，避免顺带重构与当前任务无关的地图或数据逻辑。
5. 前端交付前运行：
   ```bash
   cd web && pnpm build
   ```
6. 数据脚本或层级链路变化后运行：
   ```bash
   python scripts/validate-data.py
   ```
7. 编码归属逻辑变化后补跑：
   ```bash
   python scripts/check-codes.py
   ```
8. 记录实际验证结果；未运行对应验证时不要宣称完成。

## 硬约束

- 不提交 `.env.local` 或天地图 Token；示例变量见 `web/.env.local.example`。
- 不提交 `01-行政区划/`、`05-遥感数据/`、`浙江太保双精准平台截图/`。
- 不提交 `web/public/data/`、`web/public/tiles/`、`web/dist/`；这些是本地生成或受版权约束的产物。
- 吉林一号影像、派生瓦片和 AI 地块 GeoJSON 不得公开分发。
- 锐多宝数据未获商业授权前不得对外发布；详细说明以 `README.md` 和 `docs/需求文档.md` 为准。
- Delineate Anything 仅作为仓库外离线工具；不要把其源码、环境或模型权重复制进本仓库。
- AI 地块是演示结果，不得描述为确权、承保或测绘成果。
- 村是导航终点；新增更深层级前必须先更新需求与数据方案。
- 不要用村点生成伪村界；村界来源规则见 `docs/需求文档.md`。
- 保持天地图文字注记位于影像、地块和边界之上。

## 当前缺口

- 尚无独立架构文档；地图架构暂以 `web/src/components/MapView.vue` 和 `web/src/stores/drilldown.ts` 为准。
- 尚无版本化执行计划目录；复杂跨文件工作应先在 `docs/` 增加专项计划，再实施。
- 尚无 CI；构建和数据校验目前依赖本地命令。
- `scripts/` 尚无统一锁定的 Python 依赖文件；新增依赖时同步 `README.md`。

## 不应写在这里

- 详细产品规格、缩放阈值表、地块模型参数或数据统计；放到 `docs/需求文档.md`。
- 临时任务进度、会话状态、一次性调试记录或未验证猜测。
- 无法指向仓库文件、脚本或检查命令的空泛要求。
