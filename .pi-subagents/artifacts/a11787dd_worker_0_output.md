已实现 V1 纯业务基础模块，未修改 Vue UI、MapView 或范围外业务文件。

Changed files:
- `web/src/features/policy/policyTypes.ts`
- `web/src/features/policy/policyValidation.ts`
- `web/src/features/policy/policyValidation.spec.ts`
- `web/src/features/policy/cultivationState.ts`
- `web/src/features/policy/cultivationState.spec.ts`
- `web/src/features/policy/cultivationStorage.ts`
- `web/src/features/policy/cultivationStorage.spec.ts`

实现内容：
- 固定业务日期：`2025-07-15`
- 金额使用 cents 整数规则，面积使用 4 位小数十进制字符串
- 承保面积分类：
  - 四舍五入后 `≤ 50.00`：分户清单
  - 四舍五入后 `≥ 50.01`：单一被保险人保单
- 保单状态：待生效、保障中、已到期
- 承保面积边界：`0 < 承保面积 ≤ 几何面积`
- 同期重复承保检测
- 保额、保费、补贴、自缴金额汇总校验
- 种植档案：
  - 村代码 + 地块 ID + 年度 + 季节唯一
  - 早稻 + 连作晚稻允许
  - 单季稻与早稻/连作晚稻互斥
  - 种植期间不重叠
  - 多条当前命中时按开始日期最晚记录兜底
  - 无当前命中时返回当前未种植及当年最近记录
- `localStorage`：
  - 按村 + 地块隔离
  - 初始记录覆盖
  - 用户新增与删除
  - 单地块恢复初始状态
  - 写入失败不丢失已有数据

验证：
- 范围测试：`3` 个业务测试文件，`12` 项测试通过
- 通过完整现有 Vitest：`8` 个测试文件，`40` 项测试通过
- `vue-tsc -b --pretty false` 通过
- 发现仓库已有其他任务产生的 staged `.pi-subagents` 文件；本次未修改或暂存这些文件