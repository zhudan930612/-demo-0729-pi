# Brand 设计资产（docs/brand）

本目录存放演示平台的**品牌/Logo 设计资产**——登录页品牌 mark 的视觉源与动效设计。**非运行时依赖**：登录 mark 为 `web/src/components/LoginView.vue` 内联 SVG，其几何/渐变与此处 `p2m/logo.svg` 一致（注释「与 docs/brand/p2m/motion.css 同一编排」）。

## 目录

- `p2m/logo.svg` — 登录品牌 mark 的矢量源（leaf + orbit，绿→青渐变）
- `p2m/logo_motion.html`、`motion.css`、`motion_spec.md` — 登录 splash reveal 动效的设计/编排（LoginView 内联 CSS 与之同编排，1400ms 共享时钟）
- `p2m/final_render.png` — Logo 静态渲染示意
- `p2m/tools/*` — 动效渲染/校验脚本（capture.mjs / login_check.mjs / make_strip.py / render.mjs）

## 说明

- 曾被删除的 `p2m/outputs/`（动效 QA 帧）与 `candidates/`（logo 选型候选）为一次性产物，已移除（回溯见 git 历史）。
- Logo 选型与使用以上述文件为准；若需调整登录 mark，建议从 `p2m/logo.svg` 改起并同步 LoginView 内联 SVG。
