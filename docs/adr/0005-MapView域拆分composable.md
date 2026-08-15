# ADR-0005：MapView 按业务域拆分 composable

状态：采纳

## 背景

`MapView.vue` 作为地图装配中枢长期增长：截至 2026-08-15 实测 script setup 约 1,900 行、260 个顶层声明、116 个函数、68 个本地 import，同时编排台风、天气、气象预警、降水/参保村风险、地块（AI + 手绘）、保单/种植档案六个域。`AGENTS.md` 已明确"逻辑不得堆回 MapView"，但拆分前的装配职责仍集中在组件内，任何单域改动都要在组件内追踪跨域引用。

## 决定

将 MapView 的域逻辑抽为四个 `useXxxMode` composable，MapView 收窄为地图核心 + 装配根 + 跨域协调：

- `web/src/features/typhoon/useTyphoonMode.ts`（355 行）
- `web/src/features/weather/useWeatherMode.ts`（419 行）
- `web/src/features/precipitation/usePrecipitationMode.ts`（394 行）
- `web/src/features/parcels/useParcelWorkbench.ts`（968 行）

MapView 从 2,105 行 / 260 个声明降至 912 行 / 91 个声明。composable 通过窄接口协作：

- 跨域共享 ref（`parcelMode`/`rosterOpen`/`parcelVisible`/`parcelOn`/`saveNotice`/`disasterActive` 等）hoist 在 MapView，按需注入；
- 台风/天气/降水依赖的 `hasUnsavedParcelWork`、`closeBusinessPanels` 等经 **holder 延迟绑定**避免循环依赖（后创建的域先占位，运行时再取值）；
- 每个 composable 暴露 `init(map)`/`destroy()` 管理图层与仓库生命周期，`onMounted`/`onBeforeUnmount` 只做装配；
- 天气↔降水互斥拆成 `enterPrecipitation`/`exitPrecipitation` 两个独立入口，避免单接口双语义。

## 原因

- 单域状态、watch、图层生命周期内聚，改动面从组件内追踪变为文件内定位；
- 与 `AGENTS.md` 的职责边界一致，为后续按域扩展（新数据源、新业务面板）提供明确落点；
- 每步按域拆分可独立验证（build + 单测 + 相关 e2e），回归可控。

## 被否方案

- **一次性整文件重写**：2105 行整体重排风险不可控，改为按域 5 个 commit 逐步迁移，每步验证后提交。
- **保持 MapView 现状**：装配职责继续膨胀，违背既有架构约束；拒绝。
- **composable 间直接互相调用**：enterWeatherMode 需要退出台风/降水，形成循环依赖；改为依赖注入 + holder 延迟绑定，依赖图保持无环。

## 后续

- 两个由拆分暴露的 bug 已单独修复：`typhoonRepository` 返回值快照 undefined（改 getter）；`parcelVillageCode` getter 值快照导致详情抽屉渲染抛错（改 ref）。
- 若后续继续拆分地图核心（render/flyTo/自动层级），需新 ADR 评估边界。
