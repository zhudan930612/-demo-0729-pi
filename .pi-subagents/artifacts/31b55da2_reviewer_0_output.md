先修复 `web/src/features/policy/parcelNumber.ts:15-17` 的编号归一化碰撞；当前不能按“全局唯一”验收通过。

## Review

- **Blocker（P0）**：`web/src/features/policy/parcelNumber.ts:15-17`
  - 展示编号对基础地块执行 `padStart(4, '0')`，对人工地块删除 `manual-` 并转大写，因此不是对源 ID 的单射映射。
  - 已验证的碰撞：
    - 基础源 ID `7` 与 `0007` 都生成 `DK-330604102014-B-0007`。
    - 人工源 ID `manual-a1b2` 与 `manual-A1B2` 都生成 `DK-330604102014-M-A1B2`。
  - `web/src/utils/manualParcelStorage.ts:35-59` 只要求人工地块 ID 是字符串，没有限制大小写或强制 `manual-` 前缀；因此格式化函数本身无法保证全局唯一。
  - `web/src/features/policy/parcelNumber.spec.ts:13-19` 只验证村、来源命名空间，没有覆盖同一命名空间内的归一化碰撞。
  - 建议保留稳定源 ID 的原始字符串，或先建立并验证不会碰撞的规范化约束，再补充上述碰撞测试。

- **Correct**：没有修改源 ID 或现有业务键。
  - `web/src/components/map/ParcelDetailPanel.vue:144` 仅通过计算属性生成展示编号。
  - 保单查询、种植档案和高亮仍使用原始 `parcel.id`：`web/src/components/MapView.vue:394-405`、`web/src/components/MapView.vue:427-451`。
  - 人工地块编辑仍复用原始 ID：`web/src/utils/manualParcelStorage.ts:123-141`。

- **Correct**：其余文案和信息架构调整符合要求。
  - 地类属性“耕地”：`web/src/components/map/ParcelDetailPanel.vue:11-14`、`:26-30`。
  - “几何面积”已改为“地块面积”：`web/src/components/map/ParcelDetailPanel.vue:14`、`:29`。
  - 保单状态仅出现在“所属保单”区块：`web/src/components/map/ParcelDetailPanel.vue:66-96`。
  - 主区块顺序为“地块档案 → 所属保单 → 分项清单 → 理赔摘要”：`web/src/components/map/ParcelDetailPanel.vue:21-120`。
  - 需求文档同步了同一规则：`docs/地块详情与保单关联V1需求.md:252-280`、`:733-739`。

- **Correct**：静态复核未发现编辑、完整清单和高亮事件断路。
  - 面板事件绑定保持完整：`web/src/components/MapView.vue:45-73`。
  - 档案编辑、保存、删除链路仍连接：`web/src/components/map/ParcelDetailPanel.vue:37-63`、`:151-160`，对应父组件 `web/src/components/MapView.vue:420-437`。
  - 被保险人及整单高亮仍连接：`web/src/components/map/ParcelDetailPanel.vue:88`、`:112-114`，对应 `web/src/components/MapView.vue:440-467`。
  - 测试通过 9 个文件、43 个测试；生产构建通过。

- **Note**：本次是只读源码复核，没有进行浏览器内点击、滚动、抽屉和三级高亮视觉手测；这是剩余风险，不改变上述唯一编号阻断结论。