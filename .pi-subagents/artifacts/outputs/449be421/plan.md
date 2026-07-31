# Implementation Plan

## Goal
在不改动原始地块 GeoJSON、既有隐藏/人工地块存储和真实业务系统的前提下，交付可复现的地块详情、种植档案、固定保单/清单/理赔摘要及地图三级联动 V1，并让 18 章验收项均有对应的自动或浏览器验证路径。

## 现状与最小边界

- `web/src/components/MapView.vue` 已降至约 996 行，地图装配、村级异步加载、`parcelLayerController`、人工地块工作模式和 Pinia 导航守卫仍由它协调；不应把业务查询和详情 DOM 重新堆回该文件。
- `web/src/map/parcelLayerController.ts` 是普通/人工/待保存地块的唯一渲染 owner，但正常态目前没有地块点击回调；需要增加“正常查看态选中”接口，并保留筛选/新增模式的点击语义。
- `web/src/features/parcels/parcelTypes.ts` 只有地块工作模式类型；业务实体应放在独立 `features/business`，不要污染现有人工地块类型。
- `web/src/utils/manualParcelStorage.ts` 的 `agri-map:manual-parcels:v1` 和隐藏集合 key 必须保持不变。业务数据、初始种植档案使用独立文件和独立 localStorage key。
- 现有 `MapView.vue`/`manualParcelStorage.ts` 仍使用 `window.confirm`、`window.alert`；V1 必须在详情关闭、切地块、切村、关闭地块层、写入失败、恢复初始档案等路径统一改为项目内确认/提示组件。

## Tasks

1. **Task 1：锁定业务数据契约、输入边界和版本策略**
   - File: `docs/地块详情与保单关联V1需求.md`（只在实施阶段必要时补充路径/决策记录）；`scripts/fixtures/parcel-policy-v1/README.md`（新建）
   - Changes: 记录 `schemaVersion`、固定业务日期 `2025-07-15`、所有金额单位为分、面积内部 4 位小数、运行时文件由脚本生成到本地 `web/public/data/business/`；说明该目录是受仓库硬约束不提交的运行产物，提交的是无敏感信息的生成输入/规则/校验脚本。
   - Acceptance: 实施前能由文档明确“源 fixture 在哪里、运行时 URL 是什么、哪个命令生成、哪些文件不能提交”；原始 GeoJSON 和现有 localStorage schema 无 diff。

2. **Task 2：建立业务 JSON schema 与 TypeScript 领域模型**
   - Files: `web/src/features/business/businessTypes.ts`、`web/src/features/business/businessSchema.ts`、`web/src/features/business/businessConstants.ts`
   - Changes:
     - 定义 `Party`（`id`、稳定 `platformPartyId`、`name`、`type`）、`Policy`、`EnrollmentList`、`EnrollmentItem`、`ParcelCoverage`、`CultivationRecord`、`ClaimSummary`，并显式使用 `PolicyInsuredMode = 'single_insured' | 'insured_roster'`。
     - `Policy` 单一型只能有 `insuredPartyId`，清单型只能有 `enrollmentListId`；清单项只能有一个 `insuredPartyId`；coverage 必须带 `policyId`/`parcelId`，清单型另带 `enrollmentItemId`。
     - `PolicyCoverage` 保存当前/历史签单快照所需的几何面积快照、承保面积（4 位小数）、地块保险金额分值；保单/清单/主体汇总保存生成结果，不依赖页面重新计算当前面积。
     - `ClaimSummary` 只允许保单级或被保险人/清单项级引用，严禁 `parcelId`；无报案用 `reportCount: 0` 表示，UI 不渲染零值状态。
     - 增加运行时 schema 校验和清晰错误类型，禁止不兼容版本写入本机。
   - Acceptance: 缺字段、错类型、22 位非数字保单号、非法主体类型、错误引用关系均被拒绝；测试覆盖实体引用完整性。

3. **Task 3：实现金额、日期状态和承保关系纯函数**
   - Files: `web/src/features/business/businessCalculations.ts`、`web/src/features/business/businessCalculations.spec.ts`
   - Changes:
     - 用十进制计算（建议 `bigint` 分值 + 整数/字符串十进制乘法，或引入最小 decimal 实现；禁止二进制浮点直接计算）实现：地块金额、被保险人保费、补贴、自缴、保单加总。
     - 实现四舍五入到分、面积 4 位保存/2 位展示、比例高精度计算。
     - 用固定业务日期和期间推导 `待生效/保障中/已到期`，禁止读取浏览器当天日期；验证签单日期、期间和状态一致。
     - 实现按村/年度/产品/期间聚合，先将同被保险人内部面积求和并四舍五入 2 位后执行 `<=50.00`/`>=50.01` 分类；单一/清单互斥和同期地块重复检查。
   - Acceptance: 对 50.00、50.01、部分承保、补贴不整除分值、历史续保等边界有单测；所有汇总直接加总明细分值，自动复算完全一致。

4. **Task 4：实现固定参保确认清单、空间归集和 fixture 生成器**
   - Files: `scripts/generate-parcel-policy-v1.py`（新建）、`scripts/validate-business-data.py`（新建）、`scripts/fixtures/parcel-policy-v1/confirmed-parcels.json`（新建，脱敏输入）、`scripts/fixtures/parcel-policy-v1/party-seed.json`（新建，独立名单）、`scripts/fixtures/parcel-policy-v1/README.md`（新建）
   - Changes:
     - 读取本地龙江村基础 GeoJSON，排除无效几何/缺面积地块；规则初选仅生成候选，禁止覆盖已有 `confirmed-parcels.json`。确认文件每个基础地块恰有一条记录，至少含 `parcelId`、`enrolled`、`insuredPartyId`、`confirmedAt`、`confirmedBy`、版本和基础文件 hash；未参保项的被保险人字段为 null。
     - 用固定 seed 生成独立、非真实来源的主体名、稳定主体 ID、22 位项目内唯一保单号；不读取参考截图、姓名、证件、电话、银行信息、真实保单号。
     - 依据相邻/局部近邻和地块尺度形成经营单元，再分配被保险人、承保面积，最后聚合并执行 50 亩分类；不能先制造保单再拼地块。部分承保由少量固定确认项决定，不能用于凑保单数量。
     - 输出运行时 JSON（建议本地 `/data/business/v1/{manifest,parties,policies,enrollment-lists,enrollment-items,coverages,claims,cultivation-initial}.json`）和 `reports/parcel-policy-v1-{timestamp-or-input-hash}.json`。报告必须含参保/未参保数量及面积占比、空间组数、主要组占比、最大距离、孤立地块、分类、重复覆盖、主体数、单一保单数、清单户数和三类详情样例。
     - 对空间异常（主要组低于 70%、跨度超过约 350m、孤立拼接）输出异常和人工复核字段；生成在无确认文件、确认文件不全、基础 hash 不一致或校验失败时退出非零。
   - Acceptance: `python scripts/validate-business-data.py` 检查 1,533 基线时未参保不超过 `floor(total*0.1)`、参保不少于 90%，所有基础地块有确认记录；相同输入/seed 连续生成文件 hash、ID、归属和金额一致；只读确认清单保护测试通过。

5. **Task 5：加入业务数据加载仓库和查询索引**
   - Files: `web/src/api/businessData.ts`（新建）、`web/src/features/business/businessRepository.ts`（新建）、`web/src/features/business/businessRepository.spec.ts`
   - Changes:
     - 在现有 `fetchJSON` 之上实现带 schema 校验、版本检查、缓存和错误状态的 `BusinessRepository`；加载失败不能阻塞地图/地块层，只让业务面板显示可重试错误。
     - 暴露明确接口：`loadVillageBusiness(villageCode)`、`getParcelSnapshot(villageCode, parcelId)`、`getPolicyDetail(policyId)`、`getEnrollmentDetail(enrollmentListId)`、`getInsuredHighlights(policyId, insuredPartyId/enrollmentItemId)`、`getPolicyHighlights(policyId)`、`getClaimSummary(...)`。返回值应包含当前 coverage、历史 coverage、主体、保单快照和理赔摘要，不让组件自行跨表拼接。
     - 建立 `parcelId -> coverage[]`、`policyId -> coverage[]`、`insured key -> parcelId[]` 索引，过滤当前村、当前可展示和已隐藏状态由地图层协调而不是仓库偷偷改变地图。
   - Acceptance: 404、JSON 损坏、schema 不兼容均返回可识别错误且不写 localStorage；当前/历史分组、人工地块无业务记录、单一/清单关系查询有测试。

6. **Task 6：实现种植档案领域规则与本机覆盖存储**
   - Files: `web/src/features/cultivation/cultivationTypes.ts`、`web/src/features/cultivation/cultivationRules.ts`、`web/src/features/cultivation/cultivationRules.spec.ts`、`web/src/features/cultivation/cultivationStorage.ts`、`web/src/features/cultivation/cultivationStorage.spec.ts`
   - Changes:
     - 初始 fixture 与 localStorage 完全分离；建议 key `agri-map:cultivation-overrides:v1`，结构为 `{version:1,villages:{[villageCode]:{overrides:{[businessKey]:record}, additions:{[businessKey]:record}}}}`。业务 key 为 `村代码 + 地块 ID + 年度 + 季节`。
     - 实现有效档案合并、编辑预置变为 override、用户新增/删除、恢复单地块初始状态；预置记录不可删除，年度和季节不可编辑；所有写入先构造完整新 JSON，再单次 `setItem`，失败保留编辑现场且不部分提交。
     - 校验季节枚举、作物/品种、日期 `YYYY-MM-DD`、开始早于结束、同年度季节唯一性、早稻+连作晚稻允许、单季稻与两者互斥、所有记录期间不重叠。
     - `getCurrentRecord(records, '2025-07-15')` 按日期命中；异常多命中时报告错误但摘要选开始日期最晚者；无命中显示当前未种植并选择距业务日期最近的当年记录。
   - Acceptance: 多年度/多季节、互斥、重叠、无命中、多命中兜底、写失败、恢复取消/确认、预置不可删和新增可删均有纯单测；人工地块删除接口可调用 `removeCultivationForParcel(villageCode, parcelId)` 清除孤立档案。

7. **Task 7：增加详情选择状态和 MapView/Leaflet 关键接口**
   - Files: `web/src/features/parcels/parcelSelectionState.ts`（新建）、`web/src/features/parcels/parcelSelectionState.spec.ts`、`web/src/map/parcelLayerController.ts`、`web/src/components/MapView.vue`
   - Changes:
     - `parcelLayerController` 增加 `selectedParcelId`、highlight tier/coverage context 快照和 `onParcelSelect(feature)` 回调；普通/人工地块在 `idle` 且图层开启时可点击，`filter/batch/drawing/editing` 完全不触发详情。保留现有筛选和人工编辑回调。
     - 增加 `clearSelection()`、`setCoverageHighlight({currentParcelId, insuredParcelIds, policyParcelIds})`，渲染三级样式：当前地块主高亮、同被保险人次级、同保单其他被保险人第三级；均只作用于当前村/当前可见地块，不改变 hidden 集合。
     - MapView 只协调状态：`selectedParcelId`、`detailOpen`、`detailTab`、`detailSubDrawer`、`highlightContext`、`cultivationDirty`、业务仓库加载状态。进入编辑/筛选/新增、空白点击、Esc、切村/面包屑、关闭地块图层、隐藏/删除当前地块时清理选择和高亮。
     - 选择人工地块时其来源/几何面积照常显示，但仓库没有 coverage；所有人工地块默认无保单。
   - Acceptance: 正常态普通/人工点击可打开，四种工作模式不打开；隐藏地块不会被高亮重新显示；三级样式有独立单测和浏览器操作说明。

8. **Task 8：实现右侧详情面板与双页签信息架构**
   - Files: `web/src/components/map/ParcelDetailPanel.vue`（新建）、`web/src/components/map/ParcelSummary.vue`（新建）、`web/src/components/map/CultivationTab.vue`（新建）、`web/src/components/map/CoverageTab.vue`（新建）、`web/src/components/map/ClaimSummary.vue`（新建）、`web/src/components/map/BusinessErrorState.vue`（新建）、`web/src/components/map/MapView.css`
   - Changes:
     - 右侧固定 panel 顶部固定摘要：短/完整 ID、村、来源、几何亩/平方米、当前作物/未标注、当前承保面积或 `—`、状态及关闭按钮；当前作物与承保标的不一致只提醒，不阻止保存且不改核查状态。
     - 默认页签：当前有效 coverage 存在时承保信息，否则档案；只有历史 coverage 也默认档案，摘要为当前未承保。阅读态优先，档案编辑时底部固定取消/保存。
     - 承保页按 current/history 分组，显示地块 coverage、单一被保险人或清单当前项、保单参数/金额/状态、理赔摘要；不显示承保机构。历史页只读使用 fixture snapshot。
     - 复制完整 22 位保单号用 `navigator.clipboard`，失败显示可理解提示；窄屏 panel 改为全屏详情层，保单完整清单再进入二级全屏。
     - 组件仅消费 repository view model 和 emit，不访问 Leaflet、Pinia 或 localStorage。
   - Acceptance: 覆盖有当前、无当前、仅历史、人工新增四类面板；档案保存/取消和错误重试不白屏；无报案只显示“保障期内暂无报案”。

9. **Task 9：实现种植档案编辑交互和统一未保存确认**
   - Files: `web/src/components/map/CultivationEditor.vue`（新建）、`web/src/components/map/ConfirmDialog.vue`（新建或扩展现有 `ManualConfirmDialog.vue`）、`web/src/features/cultivation/cultivationViewModel.ts`（新建）、`web/src/components/MapView.vue`、`web/src/stores/drilldown.ts`、`web/src/components/Breadcrumb.vue`
   - Changes:
     - 编辑表单支持搜索候选品种+自定义输入、日期、核查状态、备注；预置记录只允许覆盖，新增记录可删除；恢复初始档案需二次确认。
     - 将导航守卫接口从同步 `() => boolean` 扩展为异步 `() => boolean | Promise<boolean>`（或在 store action 外由 MapView 统一 `await canNavigate()`）；`drill/back/backTo` 和 Breadcrumb 事件必须等待同一自定义确认，确认后才清选择/草稿，取消保持面板、地图图层和编辑现场不变。
     - 详情关闭、切地块、关闭宽抽屉、关闭地块图层、进入工作模式、切村和离开村全部先走 `confirmUnsavedCultivation()`；宽抽屉 Esc 第一次回保单详情，第二次关详情，未保存确认优先。
     - 移除本需求相关路径中的 `window.confirm`/`window.alert`；保存错误使用 `saveNotice`/错误组件，避免浏览器原生弹窗。
   - Acceptance: AC-13～20、AC-26～28 的确认优先级和取消后状态保持可重复操作；写入失败不丢表单；人工地块删除后无 cultivation 孤儿。

10. **Task 10：实现完整投保清单二级抽屉及分页搜索**
    - Files: `web/src/components/map/EnrollmentDrawer.vue`（新建）、`web/src/features/business/enrollmentViewModel.ts`（新建）、对应 `*.spec.ts`、`MapView.vue`
    - Changes: 桌面右侧宽抽屉保留地图，窄屏全屏二级页；顶部使用保单级固定汇总；名称/主体编号搜索，每页 20 行，显示总户数和结果数；每行只显示一户清单汇总及 `报案次数 + 最近状态`，金额理赔只在详情；行点击调用 `setCoverageHighlight` 并保持行选中；点击其他地块关闭抽屉并切新详情。
    - Acceptance: 搜索/分页不改变整单汇总；一户多块仍一行；无报案显示“暂无报案”；二级 Esc 层级和当前被保险人上下文正确。

11. **Task 11：接入理赔摘要与机构中立/敏感字段扫描**
    - Files: `web/src/components/map/ClaimSummary.vue`、`web/src/features/business/claimCalculations.ts`、`web/src/features/business/claimCalculations.spec.ts`、`scripts/validate-business-data.py`、`scripts/scan-business-safety.py`（新建）
    - Changes: 实现被保险人级和保单级加总；被保险人区块标题固定为“该被保险人理赔摘要”，清单列只放次数和最近状态；处理中至少有估损，已结案有估损/已赔；保单级统计报案户数、三状态户数、估损和已赔。
    - 扫描 fixture、页面源码、日志/报告中禁止的真实敏感字段、承保机构、Logo、演示/合成/虚构标识和 22 位以外的真实保单号。机构类型仍允许“村集体”，业务界面不显示承保机构字段。
    - Acceptance: claim 自动加总与页面一致；无报案不显示一排 0；安全扫描非零即阻断生成/构建验收。

12. **Task 12：补齐 fixture 初始档案、数据报告和本地运行入口**
    - Files: `scripts/generate-parcel-policy-v1.py`、`scripts/validate-business-data.py`、`README.md`、`.gitignore`（按现有规则确认，不扩大受限数据提交范围）
    - Changes: 生成所有当前有效参保基础地块的 2025 水稻记录，及确认文件指定的部分当前未参保地块；覆盖早稻/单季稻/连作晚稻并少量需复核，保证初始数据无作物-水稻不一致。补充 `python scripts/generate-parcel-policy-v1.py --input ... --output web/public/data/business/v1` 和校验命令；运行产物、报告、敏感源数据继续不入库。
    - Acceptance: 生成后可定位单一型、清单型、无当前保单三类地块；fixture hash 稳定；`python scripts/validate-data.py` 原有 13 项仍通过。

13. **Task 13：按模块闭环验证、提交和最终回归**
    - Files: `docs/地块详情与保单关联V1需求.md` 第 19 章验收记录（实施时填写）；建议 `docs/地块详情与保单关联V1实施计划.md`（若团队需要长期执行记录）
    - Changes: 按“schema/校验 → 参保造数 → 初始档案 → 存储规则 → 详情入口 → 承保详情 → 清单 → 高亮 → 理赔 → 安全/兼容 → 全量回归”逐模块验收，一个模块一个独立 commit；记录命令、退出码、报告路径、浏览器截图/录屏、fixture hash、业务日期和基础地块 hash。
    - Acceptance: 每个模块验收不通过不得提交；最终工作区干净，P0/P1 均通过后才允许合并 `feat/parcel-policy-v1`。

## 关键接口（实施前应冻结）

```ts
// web/src/api/businessData.ts
export interface BusinessRepository {
  loadVillageBusiness(villageCode: string): Promise<BusinessLoadResult>
  getParcelSnapshot(villageCode: string, parcelId: string): ParcelBusinessSnapshot
  getPolicyDetail(policyId: string): PolicyDetailViewModel
  getEnrollmentDetail(enrollmentListId: string): EnrollmentDetailViewModel
  getHighlightTargets(policyId: string, insuredKey: string): {
    insuredParcelIds: string[]
    policyParcelIds: string[]
  }
}

// web/src/features/cultivation/cultivationStorage.ts
export interface CultivationStore {
  readEffective(villageCode: string, parcelId: string): CultivationRecord[]
  saveOverride(villageCode: string, key: string, record: CultivationRecord): StorageResult
  addRecord(villageCode: string, record: CultivationRecord): StorageResult
  removeAddedRecord(villageCode: string, key: string): StorageResult
  restoreInitial(villageCode: string, parcelId: string): StorageResult
  removeForParcel(villageCode: string, parcelId: string): StorageResult
}

// web/src/map/parcelLayerController.ts
interface ParcelLayerCallbacks {
  onParcelSelect(feature: Feature): void // 仅 idle、可见、图层开启时调用
  onCoverageHighlightChange?(context: CoverageHighlightContext): void
}
```

`getParcelSnapshot` 应返回已经按当前村过滤并分好 `currentCoverages`/`historicalCoverages` 的 view model；组件不直接依赖原始 JSON 表。`ParcelLayerSnapshot` 增加选中/高亮状态后，hidden 地块过滤仍由现有 controller 执行，不能通过联动重新显示隐藏地块。

## Files to Modify

- `web/src/components/MapView.vue` - 详情选择、业务仓库生命周期、清理/未保存确认、三级高亮和现有地图控制器协调。
- `web/src/map/parcelLayerController.ts` - idle 地块点击、选中样式、三级高亮，同时保留现有筛选/人工编辑 owner。
- `web/src/features/parcels/parcelTypes.ts` - 如需共享 `ParcelSelection`/高亮类型，仅增加类型，不改现有模式语义。
- `web/src/features/parcels/parcelStyles.ts` - 增加三种业务高亮样式，保持既有编辑样式数值和语义不变。
- `web/src/stores/drilldown.ts`、`web/src/components/Breadcrumb.vue` - 支持异步导航守卫或由外层统一等待确认。
- `web/src/components/map/MapView.css` - 详情 panel、二级宽抽屉和窄屏全屏布局；不得产生横向页面滚动。
- `web/src/api/data.ts` - 仅在需要时抽取通用错误/重试能力；不要改变现有边界、影像 URL。
- `README.md` - 增加本地业务 fixture 生成、验证、受限数据和不提交规则。
- `scripts/validate-data.py` - 若接入统一入口，仅追加业务校验调用，不破坏既有 13 项输出。

## New Files

- `web/src/features/business/businessTypes.ts` - 业务实体、枚举、schema 版本类型。
- `web/src/features/business/businessSchema.ts` - JSON 运行时解析与引用校验。
- `web/src/features/business/businessConstants.ts` - 固定日期、期间、产品和计价参数。
- `web/src/features/business/businessCalculations.ts` / `*.spec.ts` - 十进制金额、面积、分类、状态和汇总规则。
- `web/src/api/businessData.ts` - 业务 JSON 请求、缓存和错误状态。
- `web/src/features/business/businessRepository.ts` / `*.spec.ts` - 业务索引和详情查询。
- `web/src/features/business/enrollmentViewModel.ts` / `*.spec.ts` - 清单搜索、分页、整单汇总。
- `web/src/features/business/claimCalculations.ts` / `*.spec.ts` - 理赔两级汇总。
- `web/src/features/cultivation/cultivationTypes.ts`、`cultivationRules.ts`、`cultivationStorage.ts`、对应 tests - 档案规则、合并和本机覆盖。
- `web/src/features/parcels/parcelSelectionState.ts` / `*.spec.ts` - 选中、tab、抽屉和高亮纯状态。
- `web/src/components/map/ParcelDetailPanel.vue`、`ParcelSummary.vue`、`CultivationTab.vue`、`CultivationEditor.vue`、`CoverageTab.vue`、`EnrollmentDrawer.vue`、`ClaimSummary.vue`、`BusinessErrorState.vue`、`ConfirmDialog.vue` - 详情 UI 组合。
- `scripts/generate-parcel-policy-v1.py` - 脱敏固定业务数据和初始档案生成。
- `scripts/validate-business-data.py` - schema、分类、空间、金额、状态、覆盖率和重复承保校验。
- `scripts/scan-business-safety.py` - 敏感字段/机构中立/禁止文案扫描。
- `scripts/fixtures/parcel-policy-v1/*` - 确认清单、独立主体 seed、版本和输入 hash；不放真实来源资料。

运行时生成文件写入 `web/public/data/business/v1/`，依照仓库硬约束视为本地/受限产物，不列为提交文件；实施前检查 `.gitignore` 是否已覆盖，且不要用 `git add -f` 强行提交。

## Dependencies

1. Task 1 冻结路径和版本后，Task 2/4/6 才能落地；Task 2 的实体契约先于 Task 3/5/8/10/11。
2. Task 4 必须先完成确认清单和生成报告，Task 5 才能有稳定 fixture；Task 3 是 Task 4 和前端金额展示的共同底层规则。
3. Task 6 可与 Task 4 并行，但初始 cultivation fixture 依赖 Task 4 的最终参保集合。
4. Task 7 先于 Task 8/10；Task 7 的 selection/highlight 接口是 MapView 接入的边界。
5. Task 6、7 完成后才能可靠实现 Task 9 的未保存确认和人工地块删除联动。
6. Task 8 先于 Task 10/11 的最终 UI；Task 10/11 可在 repository/view model 稳定后并行开发。
7. Task 13 依赖所有模块及生成产物，不能用最终全量回归替代每模块验收。

## Risks

- **状态覆盖歧义（需产品确认）**：需求固定业务日期为 `2025-07-15`，只明确 2024 历史期和 2025-05-01～11-30 当前期；按规则只能自然得到“已到期”和“保障中”，没有“待生效”保单。若 AC-04 必须有三种状态样例，需要明确是否新增一组固定未来期间 fixture；实施前不要擅自伪造第三个业务期间。
- **确认清单是人工输入，不可算法替代**：空间规则只能发现异常，不能代替“检查地图 + 人工确认”。缺少最新版龙江村基础 GeoJSON 或确认文件 hash 时，生成器必须失败，不能自动重新分配主体。
- **规模与前端性能**：约 1,533 个多边形加三级高亮可能导致重复重建图层。应复用现有 Canvas controller，优先 setStyle/索引更新；详情只加载当前村业务 JSON，不能全省加载主体/coverage。
- **异步导航守卫兼容性**：把 Pinia `drill/back/backTo` 改成 async 可能影响 `Breadcrumb.vue` 和缩放自动下钻；若不改 store，必须在所有导航入口集中 await 同一守卫，禁止一部分路径仍使用原生 `window.confirm`。
- **地块 ID 类型**：现有 AI GeoJSON 的 `id` 可能是数字，业务 JSON 需要序列化为稳定字符串；repository 和 controller 统一 `String(id)`，不能让 `1` 与 `"1"` 形成两个 coverage key。
- **历史快照不可回算**：coverage、主体关系、面积和金额必须存签单快照；页面不能用当前地块面积或 cultivation 记录重算历史。生成器应保存并校验快照字段。
- **安全边界**：不要把 fixture 运行产物、受限影像、真实资料、截图或敏感日志加入提交；安全扫描必须覆盖 JSON、源码文案和验收截图目录。
- **缺少真实浏览器自动化基础设施**：当前仓库只有 Vitest/build/Python 校验，没有 CI 或 E2E；必须通过可重复操作说明和截图/录屏完成 AC-11、16、21、24～29、35～36，不能把单测结果当浏览器验收。

## Validation Commands

实施阶段按模块执行，不要等最后一次才执行：

```bash
cd web && pnpm test
cd web && pnpm build
python scripts/validate-business-data.py
python scripts/generate-parcel-policy-v1.py --check
python scripts/scan-business-safety.py
python scripts/validate-data.py
python scripts/check-codes.py
cd .. && git diff --check
```

生成器的可复现验证应在临时目录运行两次并比较所有 JSON/report hash；前端异常加载验证需分别模拟 404、格式错误和 schema 不兼容，确认地图仍可用。

## Acceptance Report

本次仅进行仓库阅读和开发计划编制，没有修改源文件、没有生成业务产物、没有运行测试/构建/数据命令。以下报告对应本计划交付，而不是 V1 已实现声明。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "已基于 docs/地块详情与保单关联V1需求.md、docs/MapView拆分计划.md、docs/需求文档.md 及当前 web/src 与 scripts 架构，给出按依赖排序的最小模块边界、schema/fixture 生成、详情面板、MapView 接口、验证命令和残余风险。"
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "未运行命令；本任务明确要求只制定计划且不修改文件。"
  ],
  "residualRisks": [
    "固定业务日期与待生效状态样例存在需求歧义，需产品确认是否增加未来保险期间 fixture。",
    "空间归集和参保确认必须由项目人员审阅检查地图后提供确认清单，计划不能替代人工业务确认。",
    "真实浏览器交互、窄屏布局、Leaflet 高亮和异常加载尚未验证。"
  ],
  "noStagedFiles": true,
  "diffSummary": "无代码或文档源文件变更；仅输出实施计划 artifact。",
  "reviewFindings": [
    "no blockers in the plan; implementation is blocked only if the confirmed parcel list, base GeoJSON hash, or status-period decision is unavailable"
  ],
  "manualNotes": "计划文件已按要求写入指定 artifact 路径。执行 V1 前先确认待生效状态口径，再准备脱敏 confirmed-parcels.json 和基础地块 hash。"
}
```