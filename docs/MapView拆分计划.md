# MapView.vue 拆分计划

> 版本：v1（2026-07-30）
> 状态：计划

---

## 1. 现状

| 指标 | 当前值 | 健康阈值 |
|---|---:|---:|
| 总行数 | **2,049 行** | <600 |
| 文件大小 | 79.8 KB | <30 KB |
| `<script setup>` | **1,349 行** | <400 |
| `<template>` | 213 行 | <200 |
| `<style scoped>` | 486 行 | <300 |
| 函数 | **62 个** | <20 |
| `ref` / `computed` | **35 个** | <15 |
| 可变 `let` 状态 | **32 个** | <10 |
| 第二大源码文件 | 145 行 | — |
| 近 25 个相关提交 churn | **3,183 行** | — |

**根因**：地图、下钻、影像、AI 地块筛选、人工地块新增/编辑/移除/存储、图例、快捷键、弹窗全部塞在一个文件里，层层耦合。

---

## 2. 拆分原则

1. **不做大规模重写。** 每一阶段只提取一个高内聚职责到独立文件，提取后立即验证构建、测试和功能正常。
2. **每阶段一个独立提交。** 方便用 `git log --oneline -- MapView.vue` 回溯。
3. **共享状态通过 composable 回传。** 不新建 Pinia store 也不抽 Pinia 模块——当前的 `drilldown.ts` 已经承担了下钻路径状态，地块逻辑是纯地图交互状态，更适合 composable。
4. **保留回滚路径。** 每阶段开始前标记当前提交哈希，如果该阶段发现不可行则 `git checkout -- <文件>` 回退。

---

## 3. 三阶段计划

### 第一阶段：提取地块常量与样式（零耦合，无风险）

**目标**：将 11 个 `const XXX_STYLE` + 地块主题色常量从 `<script setup>` 移到独立文件，连 `<style scoped>` 中的重复颜色值一起提取。

**提取文件**：`web/src/utils/parcelStyle.ts`

**提取内容**：

```
- PARCEL_STYLE, PARCEL_EDIT_STYLE, PARCEL_HOVER_STYLE,
  PARCEL_PENDING_HIDE_STYLE, PARCEL_HIDDEN_STYLE,
  PARCEL_PENDING_RESTORE_STYLE,
  MANUAL_PARCEL_STYLE, MANUAL_PARCEL_SELECTED_STYLE,
  MANUAL_DRAFT_STYLE, MANUAL_PENDING_STYLE,
  THEME, HOVER, PARCEL_EDIT_MIN_ZOOM, PARCEL_AREA_LABEL_MIN_ZOOM
```

**改动范围**：`MapView.vue` 删 30 行 + 1 行 `import`；新建 `parcelStyle.ts` 约 55 行。

**验证**：

```bash
cd web && pnpm build
```

**风险**：无。纯常量提取，运行时零 diff。

**预计**：10 分钟。

---

### 第二阶段：提取 ParcelFilter composable（中等耦合，封闭边界）

**目标**：将 AI 地块筛选相关状态和函数提取为 `useParcelFilter` composable，保留 `renderParcelLayer` 中对筛选状态的消费在 MapView 中。

**提取文件**：`web/src/composables/useParcelFilter.ts`

**提取内容**：

| 类别 | 当前 in MapView |
|---|---|
| 类型 | `ParcelMode`, `ParcelId`, `ParcelEditRecord`, `ParcelEditStorage` |
| 常量 | `PARCEL_STORAGE_KEY`, `PARCEL_DATASET_VERSION` |
| 状态 | `hiddenParcelIds`, `pendingHideParcelIds`, `pendingRestoreParcelIds`, `hiddenParcelCount`, `pendingHideCount`, `pendingRestoreCount`, `pendingChangeCount` |
| 函数 | `parcelId()`, `readParcelStorage()`, `persistHiddenParcelIds()`, `loadHiddenParcelIds()`, `toggleParcelFilterSelection()`, `startParcelEditing()`, `saveParcelEdits()`, `cancelParcelEditing()`, `resetHiddenParcels()` |
| 交互 | `parcelEditStyle()`, `parcelEditActionLabel()`, `parcelEditTooltipClassName()` |

**输入接口**：

```ts
interface UseParcelFilterOptions {
  villageCode: ComputedRef<string>
  parcelSource: ComputedRef<FeatureCollection | null>
  manualParcels: ComputedRef<ManualParcelFeature[]>
  map: ShallowRef<L.Map | null>
  parcelMode: Ref<ParcelMode>
  parcelOn: Ref<boolean>
  // 渲染触发回调——composable 不持有渲染函数
  onSave: (finalHidden: Set<ParcelId>) => void
}
```

**输出接口**：

```ts
interface UseParcelFilterReturn {
  hiddenParcelIds: Ref<Set<ParcelId>>
  hasFilterableParcels: ComputedRef<boolean>
  hiddenParcelCount: Ref<number>
  pendingHideCount: Ref<number>
  pendingRestoreCount: Ref<number>
  pendingChangeCount: ComputedRef<number>
  parcelEditStyle: (id: ParcelId) => L.PathOptions
  toggleParcelFilterSelection: (id: ParcelId) => void
  startParcelEditing: () => void
  saveParcelEdits: () => void
  cancelParcelEditing: () => void
  resetHiddenParcels: () => void
}
```

**MapView 保留不变**：`renderParcelLayer()`（约 146 行）、`render()`、地块点击选择、选中高亮。这些函数依赖 `renderParcelLayer` 内的局部闭包状态（如 `layer.on('click', ...)`），提取代价大于收益，等第三阶段用子组件解决。

**验证**：

```bash
cd web && pnpm test
cd web && pnpm build
# 手动：进入村级 → 筛选地块 → 隐藏/恢复/保存 → 确认数据正确
```

**风险**：中等。`parcelEditStyle` 和 `toggleParcelFilterSelection` 在 `renderParcelLayer` 中被多层闭包引用。需要确保 composable 初始化时机在 `renderParcelLayer` 首次调用之前。

**预计**：45 分钟。

---

### 第三阶段：提取 ManualParcel composable + Legend 子组件（高风险，需冻结需求后执行）

**子阶段 3A — ManualParcel composable**

**目标**：将人工地块的新增、编辑、移除、保存、快捷键和状态管理提取为 `useManualParcel` composable。

**提取文件**：`web/src/composables/useManualParcel.ts`

**提取内容**（约 600 行，当前 MapView 中人工地块相关代码）：

| 分组 | 包含 |
|---|---|
| 常量 | `MANUAL_PARCEL_NOTICE_KEY`（复用） |
| 状态 | `manualDraftPoints`, `manualDraftDirty`, `pendingManualParcels`, `pendingManualEdits`, `pendingRemovedManualIds`, `editingManualOriginal`, `editingPendingManualId`, `editingBatchManualKind` |
| 计算 | `batchSavedCount`, `batchHasChanges`, `manualDistinctPointCount`, `manualDraftAreaText` |
| 图层 | `manualParcelLayer`, `pendingManualLayer`, `manualDraftLayer`, `manualVertexLayer`, `manualDraftAreaMarker`, `pendingActionMarker`, `batchAreaLabelLayer` |
| 函数 | `startManualDrawing`, `startBatchDrawing`, `exitBatchDrawing`, `cancelManualBatch`, `onManualMapClick`, `onBatchMapClick`, `undoManualPoint`, `finishManualDrawing`, `startPendingManualEditing`, `finishPendingManualEditing`, `saveManualBatch`, `removeBatchManualParcel`, `renderManualDraft`, `renderPendingManualParcels`, `clearManualDraftLayers` |
| 弹窗 | `manualDialog` 相关状态与键盘阻断 |

**输入接口**：

```ts
interface UseManualParcelOptions {
  villageCode: ComputedRef<string>
  manualParcels: Ref<ManualParcelFeature[]>
  parcelMode: Ref<ParcelMode>
  parcelOn: Ref<boolean>
  map: ShallowRef<L.Map | null>
  beforeUnloadHandler: Ref<((e: BeforeUnloadEvent) => void) | null>
  onSave: (nextFeatures: ManualParcelFeature[]) => void
  onRefresh: () => void  // 保存成功后刷新地图
}
```

**子阶段 3B — Legend 子组件**

**目标**：将左下角的图例 / 统计卡片提取为独立组件，由 `MapView.vue` 根据 `parcelMode` 传入必要数据渲染。

**提取文件**：`web/src/components/ParcelLegend.vue`

**接口**：

```ts
interface Props {
  mode: 'idle' | 'filter' | 'batch' | 'drawing'
  parcelVisible: boolean
  parcelOn: boolean
  count: number
  areaMu: number
  rsHint: string
}
```

**子阶段 3C — Dialog 子组件**

**目标**：将自定义确认弹窗提取为 `ManualConfirmDialog.vue`，由 composable 通过回调控制打开/关闭。

**提取文件**：`web/src/components/ManualConfirmDialog.vue`

**接口**：

```ts
interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
}
interface Emits {
  confirm: []
  cancel: []
}
```

**验证（全阶段）**：

```bash
cd web && pnpm test && pnpm build
# 完整手动验证：
# 1. 进入村级 → 新增地块 → 绘制 → 闭合 → 修形 → 移除 → 保存 → 刷新后确认
# 2. 筛选地块 → 隐藏/恢复 AI 和人工地块 → 保存 → 确认
# 3. 取消 / Esc → 确认
# 4. 返回上级 → 确认导航守卫
```

**风险**：高。`renderParcelLayer` 同时渲染 AI 和人工地块，且通过闭包共享 `toggleParcelFilterSelection`、`hiddenParcelIds`、`parcelEditStyle` 等。需要确保 composable 之间状态一致，或者将 `renderParcelLayer` 也一并提取。

**子阶段 3D（可选）— RenderParcel 分离**

如果 3A 后发现 `renderParcelLayer` 依然太复杂（>150 行），可将其拆为独立的 `renderParcels.ts` 工具函数，接收 composable 回传的筛选状态纯参数化调用。

---

## 4. 提交计划

| 阶段 | 提交信息 | 变更行数估计 |
|---|---|---|
| 1 | `refactor(parcel): 提取地块常量与样式定义` | ~85 行 |
| 2 | `refactor(parcel): 提取 AI 地块筛选为 useParcelFilter composable` | ~180 行 |
| 3A | `refactor(parcel): 提取人工地块逻辑为 useManualParcel composable` | ~600 行 |
| 3B | `refactor(parcel): 提取左下角图例为 ParcelLegend 子组件` | ~120 行 |
| 3C | `refactor(parcel): 提取确认弹窗为 ManualConfirmDialog 子组件` | ~80 行 |
| 3D | `refactor(parcel): 拆分 renderParcelLayer 为可测试函数` | ~150 行 |

每阶段提交前运行完整验证：

```bash
cd web && pnpm test && pnpm build
python scripts/validate-data.py
git diff --check
```

---

## 5. 拆分后预期

| 文件 | 职责 | 预估行数 |
|---|---:|---:|
| `MapView.vue` | 地图初始化、下钻、影像、布局编排、状态组合 | ~700 |
| `composables/useParcelFilter.ts` | AI 地块筛选状态与操作 | ~200 |
| `composables/useManualParcel.ts` | 人工地块新增/编辑/移除/存储 | ~450 |
| `components/ParcelLegend.vue` | 左下角图例与统计卡片 | ~80 |
| `components/ManualConfirmDialog.vue` | 自定义确认弹窗 | ~60 |
| `utils/parcelStyle.ts` | 地块样式常量与主题色 | ~55 |

`MapView.vue` 从 **2,049 行 → 约 700 行**（-65%），单一函数不超过 60 行。

---

## 6. 不做的事（范围外）

- 不新建 Pinia store。
- 不改动 `drilldown.ts` store 结构。
- 不改动路由、`main.ts`、`App.vue`。
- 不改动测试文件（composable 提取后仅添加集成测试）。
- 不改动 Python 数据脚本。
- 不改动已有 git 历史。

---

## 7. 回滚方案

每阶段开始前：

```bash
git tag refactor-checkpoint-<阶段名>
```

阶段验证不通过则：

```bash
git checkout refactor-checkpoint-<阶段名> -- web/src/components/MapView.vue <新建文件>
```
