已完成只读勘察，结果已写入：

`E:\各产品线\农险demo开发0729-pi\.pi-subagents\artifacts\outputs\417e03d2\context.md`

重点结论：

- V1 保单、被保险人、投保清单、承保明细、理赔摘要、种植档案和详情面板目前均未实现。
- 最小接入点是 `web/src/map/parcelLayerController.ts` 的正常查看态地块点击回调。
- `MapView.vue` 应只增加选择状态和生命周期协调，不应承载详情模板及业务规则。
- 当前没有固定业务 JSON、生成脚本、校验脚本或保险领域类型。
- 主要阻塞风险是：固定业务输入缺失、基础地块 ID 与人工地块边界、未保存档案保护、业务数据 schema 校验。
- 未修改任何文件，未运行 `pnpm test` 或 `pnpm build`。