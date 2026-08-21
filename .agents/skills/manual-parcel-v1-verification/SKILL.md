---
name: "manual-parcel-v1-verification"
description: "验证本仓库村级手动画地块、AI 筛选和本机存储改动"
version: 1
created: "2026-07-30"
updated: "2026-07-30"
---
## When to Use
修改 web/src/components/MapView.vue 的人工地块绘制、AI 地块筛选、统计、导航保护，或 web/src/utils/parcelGeometry.ts、manualParcelStorage.ts 后使用。

## Procedure
1. 在 web/ 运行 pnpm test，确认几何阻断、空间警告和 localStorage 异常测试全部通过。
2. 在 web/ 运行 pnpm build，确认 vue-tsc 与 Vite 生产构建通过。
3. 运行 Impeccable detector：node C:/Users/zhudan/.agents/skills/impeccable/scripts/detect.mjs --json web/src/components/MapView.vue。
4. 运行 git diff --check，并确认 web/public/data、web/public/tiles、web/dist、.env.local 和受限源数据未进入待提交文件。
5. 浏览器手工走查一个有 AI 地块村和一个无 AI 村：新增、撤销、拖点、阻断校验、重叠/越界警告、刷新恢复、再编辑、删除、AI 筛选、统计、z=18.5 标签及未保存导航保护。

## Pitfalls
- 人工地块上下文必须在进入任意村时加载，不能依赖高分影像相交或 AI GeoJSON 请求成功。
- 模板依赖的异步状态必须是 Vue 响应式状态，普通变量不能作为 computed 的异步数据源。
- localStorage 的 getItem 和 setItem 都可能抛错；只有持久化成功后才更新正式图层。
- 确认离开未保存会话后，必须在层级重渲染前清掉地图 click 监听、草稿图层、顶点层和 dirty 状态。
- 人工地块与 AI 地块保持独立数据源；人工删除不得写入 AI hiddenIds。

## Verification
1. pnpm test 退出码为 0。
2. pnpm build 退出码为 0。
3. detector 返回空数组。
4. git diff --check 无 whitespace error。
5. 有 AI 村和无 AI 村的浏览器手工验收均通过。