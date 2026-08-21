---
name: "typhoon-feature-verification"
description: "验证本仓灾害风险与台风功能的代理、前端、数据链路和真实浏览器关键流程"
version: 1
created: "2026-08-01"
updated: "2026-08-01"
---
## When to Use
用于修改 `server/` 台风代理、`web/src/features/typhoon/`、`web/src/map/typhoonLayerController.ts`、台风组件或 MapView 灾害模式生命周期后。

## Procedure
1. 运行 `pnpm --dir server test`，确认代理安全、限流、缓存、断开与探针报告测试通过。
2. 运行 `cd web && pnpm test && pnpm build`，确认台风纯算法、会话、图层意图、动画、交互和生产构建通过。
3. 运行 `python scripts/validate-data.py`；涉及行政编码或最终全回归时再运行 `python scripts/check-codes.py`。
4. 使用已忽略的根 `.env.local` 启动 Node 代理和 Vite；真实浏览器验证灾害入口、回省、多个实时台风、历史时间轴/动画、hover、退出清理，以及 1440/720/520 浮层不重叠。
5. 执行 `git diff --check` 和秘密扫描；只报告凭据匹配计数，不输出凭据值。

## Pitfalls
- Vite 端口可能已被占用并自动切到下一端口；浏览器冒烟必须读取实际启动日志，不能默认 5173。
- 当前年度可能有活动台风，不能冒充已覆盖真实当前无活动时刻；过去年度 start=0 只证明 API 返回结构。
- Leaflet 自定义 pane 的 DOM class 会把驼峰 pane 名转为连字符形式，浏览器断言需检查实际 DOM。
- 不要提交真实 API 响应、台风标识/坐标、受限地图截图、`.env.local` 或浏览器运行目录。

## Verification
1. server node:test 全绿。
2. web Vitest 与生产构建全绿。
3. 数据校验全绿，工作树干净。
4. 真实浏览器 Console 0 error；退出后专题图层清零且相机未改变。
5. 最终 fresh-context reviewer 无 blocker/high。