# Code Context

## Files Retrieved
1. `docs/地块详情与保单关联V1需求.md`（全文重点第1-10节，尤其第5-10节）- V1 的实体、固定业务规则、数据生成约束、详情入口和页面信息架构事实来源。
2. `docs/MapView拆分计划.md`（第1-5节）- 当前地图拆分后的职责边界；明确 MapView 仍是装配/协调层，禁止把新业务逻辑重新堆回去。
3. `web/src/components/MapView.vue`（第1-150、约第429-986行）- 地图生命周期、村级地块加载、状态协调、导航 guard 和 Leaflet 装配入口。
4. `web/src/api/data.ts`（第1-23行）- 当前唯一通用 JSON 请求封装及缓存；仅有遥感信息类型，无 V1 业务 API。
5. `web/src/features/parcels/parcelTypes.ts`（第1-4行）- 当前类型仅有 ParcelId 与五态 ParcelMode，无详情/承保领域类型。
6. `web/src/map/parcelLayerController.ts`（第1-299行）- 普通/人工地块图层、筛选交互、面积标签与渲染快照接口。
7. `web/src/features/parcels/manualBatchState.ts`（第1-66行）- 人工地块批次纯状态与提交逻辑；仅服务 localStorage 人工地块编辑。
8. `web/src/utils/manualParcelStorage.ts`（第1-144行）- 人工地块按村独立 localStorage v1 存储，字段仅几何/面积/时间/来源等。
9. `web/package.json`（第1-31行）- Vue 3、Leaflet、Pinia、Vitest；无路由、表格/抽屉 UI 或业务数据依赖。
10. `web/src/stores/drilldown.ts`（第1-76行）- 五级下钻和 NavigationGuard；可作为详情关闭/未保存保护的协调入口。
11. `web/src/features/parcels/*.spec.ts`、`web/src/utils/*.spec.ts`（文件存在，约第1-114行）- 覆盖筛选、批次、隐藏存储和几何/人工存储纯函数；没有组件交互或 V1 业务规则测试。

## Key Code

- `MapView.vue` 当前 template 已装配 `ParcelEditToolbar`、`ManualConfirmDialog`、`ParcelStatusCard`、`MapControlStack`；script setup 仍约 995 行，持有 `parcelMode`、`parcelOn`、人工批次、隐藏集合、Leaflet controller 等状态。村级入口条件是 `store.current.level === 'village'`（约第7行）。
- 村级数据加载在 `MapView.vue` 约第780行：`fetchJSON<FeatureCollection>(/data/parcels/${crumb.code}.geojson)`（当前代码实际为 `/data/parcels/...`）；V1 固定业务数据尚无加载调用。行政边界/影像也都直接由该组件协调。
- `api/data.ts` 的 `fetchJSON<T>` 只做 URL Promise 缓存、HTTP 状态检查和 `r.json()`；没有 schema 校验、版本校验、业务错误模型或专项 fetch 函数。
- `parcelLayerController.ts` 的 `ParcelLayerSnapshot` 只描述 `parcelSource`、人工地块、隐藏/待隐藏集合与编辑状态；`ParcelLayerCallbacks` 只有筛选切换和人工编辑回调，地块点击在 idle 模式不会产生详情选择事件。
- `manualParcelStorage.ts` 以 `agri-map:manual-parcels:v1` 存储，人工地块属性是 id、村代码、source、面积、label 点、创建/更新时间等；V1 明确固定业务数据只能关联稳定基础地块 ID，因此不能复用该存储承载保单。
- `drilldown.ts` 的 `canNavigate()` 会调用全局 guard；详情切换、村切换、返回上级可接入同一 guard，但需求要求未保存种植档案使用项目内自定义确认，而非浏览器原生 confirm。

## Architecture

当前链路：`App.vue` → `MapView.vue`；Pinia `drilldown` 维护五级路径；MapView 用 `api/data.ts` 加载边界、村数据、RS 信息，并创建 `map/*Controller` 管理 Leaflet；`features/parcels/*` 负责筛选/批次纯状态；`utils/*Storage` 负责浏览器本地人工地块数据。没有独立 V1 业务领域层、业务数据 JSON、详情面板、保单抽屉、种植档案存储或业务规则校验。

最小可落地架构（不引入后端、不改原始地块 GeoJSON）：
1. 新增 `web/src/features/insurance/insuranceTypes.ts`：地块摘要、主体、保单、清单、清单项、承保明细、种植档案、理赔摘要及版本化只读数据包类型；承保面积单独字段，金额/期间/状态字段明确。
2. 新增 `web/src/api/insuranceData.ts`：通过现有 `fetchJSON` 加载村级固定 JSON（按村缓存），做最小结构校验和固定日期 `2025-07-15` 状态计算/一致性校验；不使用浏览器当天日期。
3. 新增 `web/src/features/insurance/insuranceSelectors.ts`：按基础 parcel ID 查询当前/历史承保、被保险人汇总、默认页签与作物不一致提醒；把 50 亩分类与重复承保校验放在生成脚本/校验层，前端只消费固定结果。
4. 新增 `web/src/features/insurance/plantingArchiveStorage.ts`：按村+parcel ID、版本化 localStorage 保存多年度/季节档案，暴露 dirty 状态和读写失败结果；不要与人工几何 key 混用。
5. 新增 `web/src/components/map/ParcelDetailPanel.vue` 与 `PolicyListDrawer.vue`：固定右侧详情、档案/承保双页签、宽抽屉；组件只接 props/emits，未保存保护由父级状态协调。
6. 将 `parcelLayerController` 的 idle 点击回调扩展为 `onSelectParcel(id, source/feature)`，由 MapView 或更小的地图业务协调 composable 管理 selectedParcelId、panel open、Esc/空白点击/图层开关/模式互斥；避免把复杂详情模板塞回 MapView。
7. 新增业务 JSON 生成/校验脚本（建议 `scripts/generate-insurance-data.py`、`scripts/validate-insurance-data.py`），固定种子、确认清单版本、空间归集报告和 50 亩规则产物；生成数据放 `web/public/data/`，受仓库硬约束不可提交。

## Existing capability vs V1 gap

- 已有：五级下钻；村级基础 GeoJSON 按需加载；Leaflet 普通地块/人工地块显示；地块筛选、隐藏恢复、手动画图、修形、删除、批量保存；geometry 校验；localStorage 本机持久化；导航 guard。
- 完全缺失（高严重度）：地块 idle 点击选择/详情面板；V1 地块摘要；种植档案读写、未保存保护和多年度/季节展示；固定保单/投保清单/被保险人/承保明细/理赔摘要 JSON；当前/历史分组；保单/清单/被保险人地图联动；固定日期状态和 50 亩分类验证。
- 现有 `parcelTypes.ts` 不能扩展领域模型而不混淆职责；`api/data.ts` 没有数据包校验，直接 `any` 风险高。
- package 没有 router/UI 组件库并非阻塞：V1 可用当前 SFC + CSS 和父子事件实现；引入依赖会扩大范围。

## Suggested file changes (priority)

1. **P0 数据与类型**：`web/src/features/insurance/insuranceTypes.ts`、`web/src/api/insuranceData.ts`、`web/src/features/insurance/insuranceSelectors.ts`、`scripts/generate-insurance-data.py`、`scripts/validate-insurance-data.py`；必要时在 `web/src/api/data.ts` 保留通用底层但不要继续使用 `any`。
2. **P0 地图选择与面板**：`web/src/map/parcelLayerController.ts`（idle click callback/高亮清理）、`web/src/components/MapView.vue`（仅状态协调与生命周期）、新增 `web/src/components/map/ParcelDetailPanel.vue`、`PolicyListDrawer.vue`。
3. **P0 本地档案**：新增 `web/src/features/insurance/plantingArchiveStorage.ts` 及 dirty/confirm 状态测试；复用 `drilldown.ts` guard 接口。
4. **P1 测试**：新增 selector、状态计算、业务 JSON schema/重复承保/承保面积约束测试；补 `MapView`/面板交互测试（当前 Vitest 配置看起来仅适合纯 TS，组件测试基础设施未见）。
5. **P1 文档/验收**：同步 `docs/需求文档.md`（当前行为变更），并在 README/脚本说明固定数据与受限产物，不提交 JSON/影像/瓦片。

## 验收风险 / residual risks

- **阻塞级**：V1 依赖固定业务数据，但当前仓库没有输入确认清单、主体归属或版本化业务 JSON；没有这些事实输入不能声称满足空间经营单元、参保比例、50 亩分类和历史快照验收。
- **高**：当前 `parcelLayerController` 只在 filter/batch/drawing 等模式绑定交互；新增 idle 选择需确保普通隐藏地块、人工地块、模式切换、图层关闭、村切换时统一清除选择与高亮。
- **高**：人工地块可变且浏览器本地；固定保单仅允许稳定基础地块 ID。新增/修改人工地块不能错误显示承保关系，需显式 source/ID 判定。
- **高**：种植档案 localStorage 需要 schema/version/migration 和可靠 dirty guard；刷新/切换村/关闭页面保护无法仅靠现有简单 guard 完成。
- **中**：右侧固定面板与宽抽屉的窄屏布局、键盘 Esc、焦点管理、空白点击、图层开关无现成组件测试，需人工浏览器冒烟。
- **中**：V1 要求页面不显示“演示数据/合成数据”等，但仓库现有产品把地块称演示产物；需严格区分业务界面文案与开发/版权说明，避免文案冲突。
- **中**：`fetchJSON` 缓存按 URL 永久保留 Promise，失败也缓存；V1 业务数据加载失败后的重试/错误呈现需专项设计。
- **中**：业务固定日期与保单状态必须服务端/生成数据确定，不能用 `new Date()`；前端类型和 selector 测试应锁定日期。
- **验证状态**：本次只读勘察未运行 `pnpm test`/`pnpm build`，未修改文件；不要据此宣称构建通过。

## Start Here

先打开 `docs/地块详情与保单关联V1需求.md` 第5-10节，再打开 `web/src/map/parcelLayerController.ts` 和 `web/src/components/MapView.vue`。前者锁定业务边界，后两者决定最小的点击选择接入点，避免把 V1 面板和保单逻辑重新堆进地图装配组件。

## Supervisor coordination

无需协调；本次按只读要求完成勘察。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已检查 V1 需求、MapView 拆分计划、MapView、API、类型、图层控制器、存储、package 和测试，并按路径/严重度记录现有能力、架构缺口与残余风险。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "只读文件检索与 wc/grep（未运行测试）",
      "result": "passed",
      "summary": "完成目标模块和需求文档勘察；未执行 pnpm test/build。"
    }
  ],
  "validationOutput": [
    "review-findings: 已记录 V1 完全缺失领域层、数据包、详情入口、档案存储和联动。",
    "residual-risks: 已记录固定业务输入缺失、ID边界、未保存保护、响应式布局和数据加载失败等风险。"
  ],
  "residualRisks": [
    "固定业务数据/确认清单尚不存在，空间经营单元、参保比例和50亩分类无法验收。",
    "未运行 pnpm test 或 pnpm build。"
  ],
  "noStagedFiles": true,
  "diffSummary": "只读勘察；工作区无修改。",
  "reviewFindings": [
    "blocker: web/src/features/insurance、业务 JSON、生成/校验脚本均不存在，V1 核心业务链路尚未实现。",
    "high: web/src/map/parcelLayerController.ts 当前无 idle 地块选择回调，无法打开 V1 详情。",
    "high: web/src/api/data.ts 仅提供无 schema 校验的通用 fetchJSON，且无保单/档案 API。",
    "medium: web/package.json 无组件测试/路由基础设施；可先不加依赖，用现有 Vue/CSS 实现。"
  ],
  "manualNotes": "未修改文件；产物和受限数据必须遵守 AGENTS.md，不要提交 web/public/data、影像或瓦片。"
}
```