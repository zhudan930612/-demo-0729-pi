# 农保云 Logo 设计与动效规格（Pixel2Motion v2）

> 工作区 `brand/p2m/`。注意：另有并发会话在 `brand/candidates/` 做候选探索，两处互不覆盖。

## 1. 产品语境（来源实测）

- 产品：**农保云AI智能风控管理平台**（`README.md` / `PRODUCT.md`）——天地图底图 + 浙江五级下钻 + 吉林一号高分影像 + AI/人工地块 + 台风/天气风险。
- Slogan：「看清每一个异常，管好每一分经营」（`web/src/components/LoginView.vue`）。
- 使用位置：登录页左品牌区 `.brand-mark`（原为通用叶片占位图标 + 绿色渐变底块）。
- 登录页视觉：全屏遥感影像 + 深靛蓝渐变，提交按钮渐变 `#34d399 → #22d3ee`（135°），品牌强调色 `#4be0b0`，图标为 stroke 风格（round cap/join）。

## 2. 设计概念：「巡田之眸」

一个 mark 讲完整产品故事：

| 部件 | id | 语义 | 几何 |
|---|---|---|---|
| 叶片轮廓 | `#leaf` | 农业、地块 | 闭合路径，2 段 cubic，叶尖朝右上 |
| 叶脉 | `#vein` | 生长、作物档案 | 主脉 1 段 cubic + 1 条侧脉（compound path） |
| 轨道弧 | `#orbit` | 高分遥感、卫星过境扫描 | 1 段 cubic 弧线，掠过叶尖上方 |
| 星点 | `#sat` | AI 监测之眼（"看清异常"） | 填充圆，落在轨道弧终点 |

- **复杂度等级**：L3（few-curve analytic paths）——4 元素、5 段曲线 + 1 圆；无 trace、无像素阶梯，smoothness gate 天然满足。
- **色彩**：全 mark 共用 `userSpaceOnUse` 渐变 `#34d399 → #22d3ee`（10,40 → 44,6），与登录页提交按钮渐变同源；星点纯色 `#22d3ee`。
- **结构（motion-ready）**：每部件独立 id；三条描边 `pathLength="1"`；叶片起点在叶柄 (14,38)，绘制方向 = 沿左缘向叶尖生长；`#sat` 用 `transform-box: fill-box` 圆心缩放；无烘焙 transform。

## 3. 几何 QA 记录

| 迭代 | 改动 | 目视结论 |
|---|---|---|
| 01 | 初版解析几何 | 成形但叶片偏瘦；渲染器未撑满容器导致看似偏移 |
| 02 | viewBox `0 -3 48 48` 居中；叶片左缘外推加宽；侧脉加长 | **接受**：构图居中，叶/轨/点层级清晰，深/浅底均成立，边缘平滑无阶梯 |

证据：`outputs/logo_on_dark.png`、`outputs/logo_on_light.png`、`final_render.png`（480px 渲染 ≈ 10 倍于使用尺寸，等效 zoom 检查）。

## 4. 动效简报

- **人格词**：精准、沉稳、生机 —— 工程化缓动；仅星点允许一次克制 overshoot。
- **使用场景**：登录页品牌区 splash reveal（1400ms）+ 静态终态；展示页附原子动效。
- **编排**（共享 1400ms 时钟；anticipation 15% / action 65% / follow-through 20%）：

| 时间窗 | 部件 | 动作 | 缓动（字面量） |
|---|---|---|---|
| 0–8% | 全体 | Staging 静默 | — |
| 8–52% | `#leaf` | draw-on（生长） | `cubic-bezier(0.4,0,0.2,1)` |
| 40–62% | `#vein` | draw-on（与叶片尾段重叠） | `cubic-bezier(0.4,0,0.2,1)` |
| 58–82% | `#orbit` | 轨道扫入 | `cubic-bezier(0.45,0,0.15,1)` |
| 74–88% | `#sat` | scale 0→1.18 pop（back-out） | `cubic-bezier(0.34,1.56,0.64,1)` |
| 88–100% | `#sat` | 回稳 1.18→1 | `cubic-bezier(0.4,0,0.2,1)` |

- **错峰**：相邻部件起点间隔 ≥ 8%（112ms），无两部件同起同止。
- **原则覆盖**：Staging、Slow In/Slow Out、Timing、Follow Through（叶脉/轨道重叠 + 星点回稳）、Appeal；Secondary Action（星点 pop 呼应轨道终点）。
- **规则遵守**：`@keyframes` 内全部字面 `cubic-bezier`（防 Chromium 丢弃 var() 退化 linear）；所有动画 `fill-mode: both`；reduced-motion 直接呈现终态。

## 5. 验收记录

- [x] 静态渲染 zoom 检查（480px，无阶梯、端点/间隙正确）
- [x] motion_strip 目视（无裁剪、级联而非齐步）——修复过一处 round-cap cap-dot 伪影（按 dash-math 表改 `dasharray: 1 1.2` + offset 1.1）
- [x] 缓动探针（dashoffset 非 linear 退化：t=400 叶片进度 73% vs linear 47%；t=1000 轨道 85% vs linear 44%）
- [x] Final Frame Contract：`?static=1` ≡ `?t=1400`（同管线 0/221952 字节差异）
- [ ] 登录页集成后 build + 定向测试
