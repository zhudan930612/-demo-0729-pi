# MapView.vue 分阶段拆分计划

> 状态：代码拆分完成，自动验证与真实浏览器地块点击冒烟通过
>
> 实施结果：`MapView.vue` 从 2,049 行 / 79.8 KB 降至 996 行 / 38.9 KB；纯状态测试从 13 项增至 28 项
>
> 目标文件：`web/src/components/MapView.vue`
>
> 原则：只做结构重构，不改变任何用户可见行为、空间数据口径或本机存储格式。

## 1. 背景与基线

截至制定本计划时，`MapView.vue` 实测：

| 指标 | 当前值 |
|---|---:|
| 总行数 | 2,049 行 |
| 文件大小 | 79.8 KB |
| Template | 213 行 |
| Script | 1,349 行 |
| Style | 486 行 |
| 函数 | 62 个 |
| `ref` / `computed` | 35 个 |
| 可变 `let` 状态 | 32 个 |
| 最近 25 个相关提交 churn | 3,183 行 |

主要耦合点：

- `renderParcelLayer()` 约 146 行，读取约 30 个共享绑定，同时渲染普通地块、人工地块、待保存地块和面积标签。
- `clearLayers()` 读取或重置约 34 个共享绑定，地图生命周期与业务编辑状态混合。
- 新增、筛选、编辑、图例、快捷键、弹窗和 Leaflet 图层都集中在同一 SFC。
- 现有 13 项单元测试覆盖几何与本机存储，但不覆盖 `MapView` 的交互状态转换。

## 2. 目标与非目标

### 2.1 目标

1. 将纯展示 UI、纯业务状态、Leaflet 图层控制按职责分开。
2. 让按钮与快捷键复用同一业务动作，减少分支漂移。
3. 为隐藏/恢复和人工地块批次状态补充可独立运行的单元测试。
4. 将 `MapView.vue` 最终控制在约 500～800 行，保留地图装配与跨模块协调职责。
5. 每个阶段可独立构建、提交和回滚，不允许跨阶段积压未验证修改。

### 2.2 非目标

- 不修改 `localStorage` key、版本或数据结构。
- 不修改普通地块、人工地块、隐藏地块的颜色和交互语义。
- 不修改行政区划下钻、影像加载、缩放阈值或 pane 层级。
- 不引入新的全局状态库、UI 组件库或 Leaflet 替代方案。
- 不顺带增加导入导出、后端同步、切割合并等新功能。

## 3. 目标目录

```text
web/src/
├── components/
│   ├── MapView.vue
│   └── map/
│       ├── ParcelEditToolbar.vue
│       ├── ParcelStatusCard.vue
│       └── ManualConfirmDialog.vue
├── features/
│   └── parcels/
│       ├── parcelTypes.ts
│       ├── parcelStyles.ts
│       ├── parcelFilterState.ts
│       ├── parcelFilterState.spec.ts
│       ├── manualBatchState.ts
│       └── manualBatchState.spec.ts
└── map/
    ├── parcelLayerController.ts
    ├── manualDrawingController.ts
    └── mapNavigationController.ts
```

目录是目标形态，不要求一次创建。只有当前阶段实际需要的文件才落盘。

## 4. 阶段一：拆纯 UI 组件

### 4.1 范围

仅移动模板、组件内交互外壳和对应样式。业务状态、Leaflet 实例、图层引用、保存逻辑和快捷键继续留在 `MapView.vue`。

按以下顺序执行，每一步完成后单独构建：

1. `ParcelStatusCard.vue`
2. `ManualConfirmDialog.vue`
3. `ParcelEditToolbar.vue`

### 4.2 `ParcelStatusCard.vue`

职责：

- 正常查看态显示“当前地块 / 合计面积”。
- 新增模式显示普通、隐藏普通、人工、本批新增图例。
- 筛选模式显示可见、待隐藏、已隐藏、待恢复图例。
- 无地块时显示独立影像说明。

建议接口：

```ts
type Props = {
  mode: ParcelMode
  parcelVisible: boolean
  parcelOn: boolean
  displayCount: number
  displayAreaText: string
  rsHint: string
  rsVisible: boolean
}
```

硬约束：

- 组件只决定卡片展示，不读取 store，不操作地图。
- 将 `.parcel-summary`、`.parcel-legend`、`.legend-*`、`.summary-*`、`.rs-hint` 样式原样迁入。
- DOM 文案、ARIA 标签和模式优先级保持不变。

### 4.3 `ManualConfirmDialog.vue`

职责：

- 展示统一确认弹窗。
- 处理遮罩点击、取消、确认和打开后的焦点定位。

建议接口：

```ts
type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
}

type Emits = {
  close: [confirmed: boolean]
}
```

硬约束：

- Promise 的创建与 resolve 仍由 `MapView.vue` 中的 `openManualDialog()` / `closeManualDialog()` 管理。
- 全局 `Esc` 规则仍由 `MapView.vue` 管理；弹窗组件只通过 `close(false)` 关闭。
- 保持 `role="alertdialog"`、`aria-modal`、标题与描述关联、打开后聚焦。

### 4.4 `ParcelEditToolbar.vue`

职责：

- 根据 `ParcelMode` 渲染启动、筛选、新增查看、绘制和历史编辑工具栏。
- 只发出动作事件，不调用存储、几何校验或 Leaflet API。

建议 props：

```ts
type Props = {
  mode: ParcelMode
  parcelOn: boolean
  hasFilterableParcels: boolean
  hiddenCount: number
  pendingHideCount: number
  pendingRestoreCount: number
  pendingChangeCount: number
  batchSavedCount: number
  draftPointCount: number
  batchHasChanges: boolean
  draftAreaText: string
}
```

建议 emits：

```ts
'start-manual' | 'start-filter' | 'restore-all' |
'save-filter' | 'cancel-filter' |
'start-drawing' | 'exit-drawing' | 'undo-manual' |
'save-batch' | 'cancel-batch' |
'save-manual-edit' | 'cancel-manual-edit'
```

硬约束：

- 保持按钮顺序、禁用条件、title、文案和 SVG 不变。
- 保持工具栏在村级才显示；是否处于村级仍由父组件决定。
- 对 `saveManualBatch()`、`cancelManualBatch()` 等异步函数，父组件用事件处理器承接，不在子组件吞掉 Promise。

### 4.5 阶段一完成标准

- 三个组件全部落盘，`MapView.vue` 不再包含其完整 DOM 和私有样式。
- `MapView.vue` 中所有业务函数签名、Leaflet 图层变量和存储 key 未改变。
- `MapView.vue` 总行数应下降到约 1,500 行以内；若未下降，检查是否遗留重复样式或模板。
- 桌面宽屏和窄屏下的工具栏、图例、统计、弹窗位置与拆分前一致。

### 4.6 阶段一提交边界

建议拆成三个独立提交：

```text
refactor(map): 拆分地块统计与图例组件
refactor(map): 拆分人工地块确认弹窗
refactor(map): 拆分地块操作工具栏
```

每个提交必须可单独构建和回滚。

## 5. 阶段二：抽取纯业务状态

### 5.1 前置条件

- 阶段一已完成并通过浏览器冒烟。
- 不存在待合并的用户可见功能修改。
- 先记录当前人工地块和隐藏记录的 `localStorage` 样例，重构后格式必须完全一致。

### 5.2 公共类型与样式

创建：

- `parcelTypes.ts`：`ParcelMode`、`ParcelId`、筛选与批次状态类型。
- `parcelStyles.ts`：`PARCEL_*`、`MANUAL_*` 的 `L.PathOptions` 常量。

要求：

- 只移动定义，不改变任何数值。
- 样式常量仍是唯一事实来源，图例 CSS 暂不强行由 TS 生成。

### 5.3 筛选状态模块

`parcelFilterState.ts` 使用纯函数，不读写 `localStorage`：

```ts
createParcelFilterState(hiddenIds)
toggleParcelFilterSelection(state, id)
restoreAllParcels(state)
calculateNextHiddenIds(state)
getParcelFilterCounts(state)
```

必须覆盖：

- 可见地块点击后进入/取消待隐藏。
- 已隐藏地块点击后进入/取消待恢复。
- 全部恢复不会覆盖待隐藏集合。
- 保存结果严格满足“原隐藏 + 待隐藏 - 待恢复”。
- 普通与人工地块 ID 使用同一集合时行为一致。

### 5.4 人工批次状态模块

`manualBatchState.ts` 只负责内存批次，不处理 Leaflet 或弹窗：

```ts
createManualBatchState()
addPendingManualParcel(state, feature)
updateManualParcel(state, feature, kind)
removeManualParcel(state, id, kind)
undoManualBatch(state)
commitManualBatch(currentFeatures, state)
resetManualBatch()
```

必须覆盖：

- 新地块移除后从待保存集合消失。
- 历史人工地块移除后进入待移除集合。
- 历史地块修改后再移除，不残留待修改记录。
- 取消批次恢复空状态，不修改正式人工地块。
- 提交结果同时正确合并新增、修改、移除。

### 5.5 阶段二完成标准

- 新增纯状态测试，`pnpm test` 测试数明显增加。
- 按钮、`N`、`Esc`、`Delete` 和地图点击最终调用相同状态动作。
- `MapView.vue` 不再直接散布对三个批次数组的重复增删逻辑。
- 存储模块 `manualParcelStorage.ts` 的数据结构和读写接口保持不变。

### 5.6 阶段二提交边界

```text
refactor(parcel): 提取地块类型与样式定义
refactor(parcel): 提取筛选状态与单元测试
refactor(parcel): 提取人工批次状态与单元测试
```

## 6. 阶段三：拆 Leaflet 控制器

### 6.1 前置条件

- 阶段二测试覆盖筛选和人工批次核心转换。
- 已完成新增、筛选、保存、取消、导航离开的浏览器冒烟。
- 不与新的地图功能开发并行进行。

### 6.2 `parcelLayerController.ts`

拥有：

- 普通地块、人工地块、待保存地块的 `L.GeoJSON` 引用。
- 正常、筛选、新增模式的样式与交互绑定。
- 面积标签和新增模式面积标签图层。
- `render()`、`clear()`、`updateAreaLabels()`。

不拥有：

- `localStorage` 写入。
- Vue 路由/行政下钻。
- 批次保存与确认弹窗。

### 6.3 `manualDrawingController.ts`

拥有：

- 开放折线/闭合编辑面的 Leaflet 图层。
- 顶点 marker、拖动反馈、面积 marker、地块下方移除 marker。
- 地图 click 事件注册与注销。

通过回调上报：

- 新增点。
- 点击首点闭合。
- 顶点拖动后的坐标。
- 点击移除。
- 点击地图空白失焦。

控制器不得直接修改业务批次数组。

### 6.4 `mapNavigationController.ts`

最后拆分，负责：

- 当前行政区域轮廓和子级边界。
- 高分影像加载与开关。
- 点击/缩放下钻、`flyToBounds`、自动层级切换。
- 地图基础清理与销毁。

地块业务拆分完成前不要先抽此模块，以免同时改变地图生命周期和业务状态。

### 6.5 阶段三完成标准

- 每个控制器明确拥有并清理自己的 Leaflet 图层与事件。
- 不允许同一图层引用同时由 `MapView.vue` 和控制器写入。
- `MapView.vue` 只保留地图创建、状态组合、控制器协调、store watch 和生命周期入口。
- `MapView.vue` 目标规模 500～800 行；若为保持清晰略超出，不为达成行数强行拆碎。

### 6.6 阶段三提交边界

```text
refactor(map): 提取地块图层控制器
refactor(map): 提取人工绘制控制器
refactor(map): 提取地图导航控制器
```

## 7. 每阶段验证

### 7.1 自动验证

每个提交前运行：

```bash
cd web
pnpm test
pnpm build
```

阶段末额外运行：

```bash
python scripts/validate-data.py
git diff --check
node C:/Users/zhudan/.agents/skills/impeccable/scripts/detect.mjs --json web/src/components/MapView.vue web/src/components/map
```

若改动涉及行政编码，再运行：

```bash
python scripts/check-codes.py
```

### 7.2 浏览器冒烟矩阵

| 场景 | 必验行为 |
|---|---|
| 正常查看 | 行政下钻、影像开关、地块开关、统计和面积标签正常 |
| 筛选模式 | 普通/人工地块可隐藏与恢复；全部恢复、保存、取消和图例正确 |
| 新增查看态 | 历史人工地块与待保存地块可选择、修形、移除；紫色样式正确 |
| 新增绘制态 | `N` 状态机、点击首点闭合、退出绘制、面积反馈正确 |
| 键盘操作 | `Esc` 等同取消；`Delete` 等同移除；`Ctrl/Cmd+Z` 等同撤销 |
| 持久化 | 保存后刷新结果保留；取消不改变正式记录；隐藏 ID 无残留 |
| 导航保护 | 有未保存操作时返回、面包屑、刷新和关闭页面仍提示 |
| 响应式 | 720px 与 520px 断点下工具栏、图例和弹窗不溢出 |

## 8. 防回归规则

- 不允许在同一提交中同时重构和修改产品行为。
- 不允许通过复制函数到新文件后保留旧实现；每个职责只能有一个事实来源。
- 不允许为了减少 props 把瞬时编辑状态直接放进全局 Pinia。
- 不允许控制器自行访问 `localStorage`；持久化继续通过现有存储函数完成。
- 不允许用整文件 `git checkout` / `restore` 回滚，以免覆盖并行或既有修改。

## 9. 停止与回滚条件

任一条件出现时停止当前阶段，不继续下一阶段：

- `pnpm test` 或 `pnpm build` 失败。
- 浏览器冒烟中出现图层重复、点击执行两次、地图自动退级或保存结果丢失。
- 新模块需要传入超过约 15 个独立参数且无法组合成清晰状态对象。
- 为抽离一个函数必须让两个模块相互导入。
- 无法明确某个 Leaflet 图层或事件由谁创建、更新、注销。

回滚方式：仅回滚当前阶段最近的独立提交，保留此前已验收阶段。

## 10. 实施结果与完成定义

### 10.1 实施结果

已完成：

- 三个计划 UI 组件，以及右侧 `MapControlStack.vue` 和外部 `MapView.css`。
- 地块类型/样式、筛选状态、人工批次状态、隐藏存储和对应测试。
- `manualDrawingController`、`parcelLayerController`、`mapNavigationController`、`parcelWorkModeController`。
- 异步 `render()` 卸载失效、导航 generation 隔离和面积标签事件 owner 收口。
- 自动验证：28 项前端测试、生产构建、13 项数据链路、编码检查、`git diff --check`、Impeccable UI 检测全部通过。

实际停止在 996 行，高于 500～800 行理想值。继续抽取人工工作流实测需要 23 个共享绑定，触发本计划“超过约 15 个独立参数且无法形成清晰状态对象”的停止条件；异步行政/影像 `render()` 继续留在父组件，避免将业务存储与导航控制器重新耦合。清晰的 owner 边界优先于强行达到行数。

待完成：按 7.2 浏览器冒烟矩阵进行真实 Leaflet 点击、拖动、快速连续导航和响应式视觉验收。

### 10.2 完成定义

全部阶段完成需同时满足：

1. `MapView.vue` 只承担地图装配、状态组合和跨模块协调。
2. UI 子组件不读取地图实例或业务存储。
3. 筛选与人工批次核心状态转换有单元测试。
4. Leaflet 图层和事件均有唯一 owner，并在切村和卸载时清理。
5. 自动验证和浏览器冒烟矩阵全部通过，需求文档无需因重构改变产品规格。
