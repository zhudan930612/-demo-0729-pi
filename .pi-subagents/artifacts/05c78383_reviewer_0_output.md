先阻止合并：当前工作树存在多项 P0，种植档案 CRUD、未保存保护、空间造数和异常加载均未达到 V1 验收条件。

## Review

### Correct

- **前端类型检查、单元测试和生产构建通过。**
  - `cd web && pnpm test`：8 个测试文件、40 项测试全部通过。
  - `cd web && pnpm build`：`vue-tsc -b` 与 Vite 构建通过。
- **现有 fixture 的基础业务检查通过。**
  - 当前参保 1,450 / 1,533 块，未参保 83 块。
  - 当前有效保单没有重复地块。
  - 当前 fixture 的 50 亩分类、面积上限、22 位保单号及初始档案覆盖通过 `scripts/validate-policy-fixture.py`。
- **金额抽查正确。**
  - 额外按“逐地块四舍五入到分，再汇总”复算，当前所有清单项和保单的保额均与 fixture 一致。
- **没有暂存文件。**
  - `git diff --cached --name-status` 为空。

### Fixed

- 未修改任何文件；本次为严格只读审查。

### Blocker

#### 1. P0 — 种植档案新增记录无法编辑或删除，删除路径还会清空整块地的全部本机档案

**证据：**

- `web/src/components/map/ParcelDetailPanel.vue:89-90`
  - `isInitial()` 在 `props.records` 中查找当前记录；由于 `props.records` 本身就是全部有效记录，任何记录都会被判为初始记录。
  - 结果是用户新增记录的“删除”按钮永远不会显示。
- `web/src/components/map/ParcelDetailPanel.vue:92`
  - 编辑任意已有记录都会传递 `Boolean(editingKey)`，因此用户新增记录也被当作初始记录保存。
- `web/src/components/MapView.vue:406-409`
  - `isInitial=true` 会调用 `saveCultivationOverride()`；用户新增记录不在初始 fixture 中，保存必然返回“只能覆盖初始档案”。
- `web/src/components/MapView.vue:412-415`
  - 删除事件调用 `removeCultivationForParcel()`。
- `web/src/features/policy/cultivationStorage.ts:93-112`
  - 已有精确删除 API 是 `removeAddedCultivation()`，但 `removeCultivationForParcel` 实际是 `restoreInitialCultivation` 的别名，会删除该地块全部 overrides 和 additions。

**影响：**

- AC-19 的“用户新增记录可删除”失败。
- 用户新增档案保存后无法再次编辑。
- 一旦删除事件被触发，会误删同一地块其他本机覆盖和新增记录。

**修复建议：**

1. 为有效记录附加稳定来源标识，例如 `source: 'initial' | 'override' | 'addition'`，或向组件传入初始记录 key 集合。
2. 编辑用户新增记录时提供独立的 `updateAddedCultivation()`。
3. 删除单条用户记录必须调用 `removeAddedCultivation(villageCode, record)`。
4. `restoreInitialCultivation()` 只用于“恢复初始档案”操作。

---

#### 2. P0 — 在其他地块上点击会直接丢弃未保存编辑，同户地块切换也无法保持联动上下文

**证据：**

- `web/src/components/MapView.vue:380-390`
  - `selectParcel()` 没有检查 `cultivationEditing`，直接替换当前地块、记录和保单上下文。
  - 同时无条件清空被保险人和整单高亮。
- `web/src/components/MapView.vue:1083-1084`
  - 基础地块与人工地块点击均直接调用 `selectParcel()`，没有经过未保存确认流程。
- `web/src/components/map/ParcelDetailPanel.vue:81`
  - 地块 ID 变化后调用 `cancelEdit()`，未保存表单随即被丢弃。

**影响：**

- AC-16“未保存时切换地块须确认”失败。
- AC-25“点击同户其他地块后保持同一保单、被保险人上下文和承保页签”失败。
- 用户只需误点另一地块即可无提示丢失编辑内容。

**修复建议：**

1. 将地块点击统一改为异步 `requestSelectParcel(nextParcel)`。
2. 有未保存编辑时先打开项目确认弹窗；取消后不得改变任何选择、页签或高亮。
3. 如果目标地块属于当前被保险人和保单，保留被保险人高亮、保单上下文及承保页签。
4. 只有切换到无关地块时才关闭宽抽屉并重建上下文。

---

#### 3. P0 — 参保确认文件不是人工确认输入，造数也不是空间归集；所有经营主体均超过空间跨度原则值

**证据：**

- `scripts/generate-policy-fixture.py:35-47`
  - 脚本每次运行都会重新生成并覆盖 `parcel-confirmation-v1.json`，与注释声称的“immutable input”相反。
  - 参保记录的 `insuredPartyId` 全部写成 `"pending"`，没有保存最终被保险人归属。
- `web/src/data/parcel-confirmation-v1.json:8-13` 起
  - 实际确认记录使用 `"insuredPartyId": "pending"`，不能证明人工确认了主体归属。
- `scripts/generate-policy-fixture.py:31-36,73-109`
  - 地块先按数字 ID 排序，再按连续 60 块或累计面积切片分组；没有使用相邻、近邻、局部尺度或经营单元空间关系。
- `scripts/validate-policy-fixture.py:17-37`
  - 只检查确认记录数量和 ID 唯一性，没有检查确认记录主体与最终 coverage 主体一致，也没有计算空间组、主要组面积占比、最大距离或孤立地块。
- 只读空间诊断结果：
  - 6 个当前单一型主体最大质心跨度分别约为 **1,028.5m、1,182.2m、1,663.2m、731.7m、1,283.1m、1,273.7m**。
  - 所有 45 个当前被保险人的最大跨度都超过约 350m。
- `web/src/data/policy-v1.report.json:13-18`
  - `spatialReview` 只有版本、确认时间、确认人和一条 grouping 文本，没有需求要求的实际空间指标和复核结论。

**影响：**

- AC-05 人工确认清单完整性失败。
- AC-07 空间经营合理性失败。
- AC-08 生成报告字段失败。
- 现有校验命令虽然退出码为 0，但没有校验最关键的空间规则。

**修复建议：**

1. 将确认文件改为生成器只读输入，缺失或 schema 不符时直接失败，禁止脚本覆盖。
2. 每条参保记录保存最终稳定 `insuredPartyId`，并验证其与 coverage 一致。
3. 基于几何相邻、局部近邻和经营单元形成主体归属，不能按数字 ID 切片。
4. 输出每个主体的空间组数、主要组承保面积占比、最大跨度和孤立地块。
5. 超过约 350m 的主体必须有逐主体人工复核结论；无结论时校验失败。

---

#### 4. P0 — 业务 JSON 异常加载方案未实现，损坏数据会被静默伪装成“无保单”

**证据：**

- `web/src/features/policy/policyRepository.ts:5-6`
  - 保单和种植档案通过静态模块 import 打包进主 bundle，不存在需求定义的运行时 404、重试流程。
- `web/src/features/policy/policyRepository.ts:20-36`
  - repository 只返回同步 `{data,error}`，没有重试 API。
- `web/src/components/MapView.vue:228-234`
  - 加载错误只被保存到局部结果中；页面实际只使用 `.data`，没有展示 `policyLoad.error` 或 `cultivationLoad.error`。
- `web/src/components/MapView.vue:382-384`
  - `policyFixture` 为空时会构造一个“无当前保单、无历史保单”的正常上下文。

**影响：**

- 保单 schema 错误时，用户看到的是“暂无关联保单”，无法区分真实未参保与数据损坏。
- 初始档案损坏时，用户看到空档案，且没有失败区块和重试入口。
- AC-35 的 404、格式错误、schema 不兼容、可重试和不白屏要求未实现。

**修复建议：**

1. 使用运行时 fetch 加载独立版本化 JSON，并保存 `idle/loading/ready/error` 状态。
2. 保单与种植档案分别提供错误区块和重试操作。
3. 数据错误时禁止将其解释为业务上的“未参保”或“无档案”。
4. 增加 404、非法 JSON、schema 不兼容的组件或集成测试。

---

#### 5. P0 — 详情面板把村代码硬编码为龙江村，其他村的人工地块无法保存种植档案

**证据：**

- `web/src/components/map/ParcelDetailPanel.vue:74`
  - 新档案固定使用 `villageCode: '330604102014'`。
- `web/src/components/MapView.vue:406-407`
  - 保存时使用实际 `parcelVillageCode`。
- `web/src/features/policy/cultivationStorage.ts:81`
  - 两者不一致时明确返回“村代码不匹配”。

**影响：**

- 在龙江村以外的任意村为人工地块添加档案，提交都会失败。
- 违反“普通地块与人工地块均可保存种植档案”和按村代码隔离规则。

**修复建议：**

- 向 `ParcelDetailPanel` 传入实际 `villageCode`，`blank()` 必须使用该 prop；不要在业务组件硬编码示范村代码。

### Note

#### P0 — 历史快照与保单级理赔汇总尚未闭环

- `web/src/components/map/ParcelDetailPanel.vue:56`
  - 历史保单只展示保单号、主体、地块承保面积和整单保险金额。
  - 未展示历史承保分类、费率、补贴、自缴、清单汇总和历史理赔摘要。
- `web/src/features/policy/policySelectors.ts:56-66`
  - 已实现 `summarizePolicyClaims()`，但当前 MapView 和抽屉没有使用。
- `web/src/components/map/PolicyRosterDrawer.vue:1-4`
  - 只有逐户“理赔”文本列，没有保单级报案户数、分状态户数、估损和已赔汇总。

这使 AC-29 和 AC-31 仍为未实现状态。

#### P0 — 确认弹窗的 `Esc` 分支顺序会重新发起关闭操作

- `web/src/components/MapView.vue:821-832`
  - 代码先处理 `selectedParcel`，后处理 `manualDialog.open`。
  - 地块编辑确认弹窗已经打开时按 `Esc`，会再次调用 `requestCloseDetail()`，而不是关闭当前弹窗。
- `MapView.vue` 只维护一个 `manualDialogResolve`，重复打开会使等待中的关闭或导航确认存在无法正常完成的风险。

修复时应把 `manualDialog.open` 判断放在所有详情、抽屉和工作模式快捷键之前。

#### P1 — 当前工作树没有新增 UI/联动测试

现有 40 项测试均通过，但当前相对 HEAD 的详情面板、宽抽屉、地块点击、高亮、导航确认和异常加载没有配套测试。真实 Leaflet 点击、两级 `Esc`、窄屏抽屉和存储失败仍需浏览器验收。