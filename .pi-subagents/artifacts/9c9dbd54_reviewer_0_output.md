阻止验收：上次 5 项 blocker 中 3 项已修复、2 项仅部分修复；当前仍有 5 组 P0 未闭环。

## Review

### Correct

- **种植档案新增、编辑、删除已修复。**
  - 实际村代码由 `ParcelDetailPanel.vue:69,74` 的 `villageCode` prop 写入。
  - 预置记录与用户新增记录通过 `initialRecordKeys` 区分：`ParcelDetailPanel.vue:89-92`。
  - 用户新增记录更新、精确删除分别调用 `updateAddedCultivation`、`removeAddedCultivation`：`MapView.vue:410-420`。
- **切换地块的未保存确认已补上**：`MapView.vue:383-395`。
- **确认弹窗的 `Esc` 优先级已修复**：`MapView.vue:824-833` 先关闭确认弹窗，再处理清单和详情。
- **保单级理赔已展示**：`PolicyRosterDrawer.vue:1-4` 汇总报案户数、状态户数、估损及已赔；当前 fixture 复算为 2 户、核赔中 1、已结案 1、估损 2,720 元、已赔 920 元。
- **编译与现有自动测试通过**：8 个测试文件、40 项测试通过；生产构建成功。

### Blocker

1. **P0 — 确认清单仍可被准备脚本直接覆盖，空间复核指标是自动自证。**
   - `scripts/prepare-policy-confirmation.py:43-49` 自动分配主体、自动填写“通过”结论，并无条件覆盖确认文件。
   - `scripts/prepare-policy-confirmation.py:47` 将 `spatialGroupCount`、`primaryGroupAreaRatio`、`isolatedParcelIds` 固定写成 `1 / 1.0 / []`，没有实际空间分组或孤立地块分析。
   - 当前 54 户中 14 户跨度超过 350m，最大 838.3m；超过阈值的“人工复核”仍由脚本自动生成。
   - `scripts/validate-policy-fixture.py:16-37` 完全未校验空间指标和复核结论。
   - **AC-05、AC-07 仍不通过。**

2. **P0 — 未保存保护和同户切换上下文仍不完整。**
   - `MapView.vue:481-486` 进入筛选模式直接 `clearSelection()`；`MapView.vue:579-589` 进入新增模式同样直接清空，均绕过未保存确认。
   - `MapView.vue:383-394` 切地块虽已确认，但确认后无条件关闭清单并清空同户、整单高亮，未保留同一被保险人上下文。
   - **AC-16、AC-25 仍不通过。**

3. **P0 — 删除人工地块与清理种植档案不是原子操作。**
   - `MapView.vue:718-732` 先写入已删除人工地块的正式集合，再逐块调用 `removeCultivationForParcel()`。
   - 清理结果被忽略；若第二次 `localStorage` 写入失败，人工地块已删除但种植档案仍残留，且无法回滚。
   - **AC-17 仍不通过。**

4. **P0 — 历史快照和业务 JSON 异常加载仍未完成。**
   - `ParcelDetailPanel.vue:56` 历史保单只显示保单号、主体、面积和总保险金额，缺少历史分类、费率、补贴、自缴及历史理赔摘要，**AC-29 不通过**。
   - `policyRepository.ts:5-6,20-36` 仍用静态 import；`MapView.vue:231-234,387` 忽略加载错误并将失败解释成“暂无保单/空档案”，没有 404、错误区块或重试，**AC-35 不通过**。

5. **P0 — AC-38 交付门禁尚不能签署。**
   - `pnpm test`、`pnpm build`、数据校验和编码检查均通过。
   - 构建仍报告 965.94 kB 大 chunk 和插件耗时警告；本次未见格式检查、UI 联动测试或浏览器回归证据。
   - 保单级理赔、未保存导航、两级 `Esc`、人工地块删除联动均没有组件/集成测试。

### Note

- 当前无暂存文件；仅有运行环境生成的未跟踪 `.pi-subagents/artifacts/*` 文件。
- 本次严格只读，未修改任何文件。