# 质量审查-OSM底图接入-V1

> 质量审查执行：独立 reviewer agent（fresh context，专读实现，不重验行为）
> 日期：2026-08-21
> 审查范围：git diff 83402a0..HEAD（feat/osm-basemap，6 文件 +440/-7）

## 必须修（1 项）

| 位置 | 问题 | 建议改法 | 处理 |
|---|---|---|---|
| `web/src/api/tianditu.spec.ts` + `MapView.vue:540` | 冻结 seam「R1 切换逻辑」要求 `switchBasemap` **单测**断言「切换不改变中心/缩放、不重建地图」；实际交付 `switchBasemap` 零单测，「不重建地图」无直接断言（仅 e2e 经 `window.__map` 间接覆盖）。违反「按 seam 执行、不得另选 seam」 | 把切换逻辑抽为可注入 map/basemaps 的独立可测模块补单测（断言 removeLayer/addTo + getCenter/getZoom 不变 + 地图实例未重建） | 已回编码 agent 修复 |

## 建议（本期可不做）

| 位置 | 问题 | 建议改法 | 处理 |
|---|---|---|---|
| `MapView.vue:345/540`、`MapControlStack.vue:98/99/112` | `'img'\|'vec'\|'osm'\|'topo'` 联合类型 5 处逐字重复 | `tianditu.ts` 导出 `BasemapKey` 类型统一复用 | 随必须修一并处理 |
| `MapView.vue:860` | `window.__map` 是 seam 表外测试钩子（DEV-only，无安全/泄漏问题） | 在验收清单 seam 表登记为 e2e 专用 seam（DEV-only） | 主 agent 更新验收清单 seam 表 |
| `MapControlStack.vue:120`（既有，非本次引入） | 需求 C4「方向键选择」未实现（onKeydown 仅 Escape），2 项菜单时即存在 | 后续补 radiogroup 方向键导航 | 记录，不在本期范围 |

## 已确认良好

- **术语一致**：代码/测试用「OSM 标准」「OSM 地貌」「OSM 底图」「版权标注」，`web/src`、`web/e2e` 无「街景/谷歌/Google」避免词，与 CONTEXT.md 术语表一致
- **无凭据/受限数据外泄**：OSM 两源免 token；天地图 token 仅存 `tdtLayer`；e2e 补测断言瓦片 URL 无 `tk/token/key/username/password`；无新增凭据、无 `.env` 变更
- **组件模式沿用**：菜单项 `menu-action` + `role="radio"` + `selected` + `aria-checked`，与既有 radiogroup 模式一致；无新 CSS/样式体系
- **seam 内测试正确**：`createBasemaps` 单测期望值（tile URL 域名、attribution 文案、maxNativeZoom 19/17）来自需求 C1/清单 1.4，非从实现倒推
- **范围克制**：diff 仅 3 源 + 3 测试文件，无新依赖、无非测试新文件、无 package.json 改动、无 console.log
- **天地图注记置顶规则未受影响**：annotationPane 逻辑不变，切回无残留（e2e 1.4 覆盖）
- **switchBasemap 实现本身正确**：4 项类型闭合（Basemaps 4 键齐全）、removeLayer/addTo 沿用原机制、`!basemaps` 守卫保留

## 总体评价

生产代码改动小、正确、命名清晰、无越界、无安全/泄漏问题，规范与术语遵从度高。唯一必须修是**测试 seam 纪律**（switchBasemap 缺单测、「不重建地图」无直接断言、`window.__map` 未登记），修完后实现质量合格。
