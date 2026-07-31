---
name: 农险双精准地图 Demo
description: 面向内部技术验证的紧凑空间核查与地块操作工作台。
colors:
  action-blue: "#2563eb"
  action-blue-hover: "#1d4ed8"
  map-cyan: "#38bdf8"
  map-hover-yellow: "#facc15"
  canvas-slate: "#0f172a"
  ink-slate: "#475569"
  muted-slate: "#64748b"
  panel-slate: "rgba(248, 250, 252, 0.96)"
  panel-white: "#ffffff"
  panel-border: "rgba(148, 163, 184, 0.34)"
  panel-hover: "#e2e8f0"
  drawing-purple: "#7e22ce"
  drawing-purple-hover: "#6b21a8"
  success-green: "#166534"
  warning-yellow: "#eab308"
  danger-red: "#b91c1c"
typography:
  body:
    fontFamily: "PingFang SC, Microsoft YaHei, sans-serif"
  control:
    fontFamily: "PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  metric:
    fontFamily: "PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.05
rounded:
  swatch: "2px"
  crumb: "5px"
  hint: "6px"
  control: "7px"
  panel: "10px"
  dialog: "14px"
spacing:
  micro: "2px"
  tight: "4px"
  compact: "8px"
  control: "12px"
  panel: "20px"
components:
  action-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  action-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.control}"
  map-panel:
    backgroundColor: "{colors.panel-slate}"
    textColor: "{colors.canvas-slate}"
    rounded: "{rounded.panel}"
    padding: "4px"
  drawing-action:
    backgroundColor: "transparent"
    textColor: "{colors.drawing-purple}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
---

# Design System: 农险双精准地图 Demo

## Overview

**Creative North Star: "清晰的空间工具"**

这是一个以地图为主角的内部技术验证工作台。空间影像、行政边界和地块几何是视觉主体；界面只以轻量、半透明的控制浮层停靠在地图边缘，不抢占地图的注意力。信息密度紧凑，但每个动作、状态与反馈都必须能快速扫读。

主操作以蓝色建立单一行动路径；地块绘制以紫色形成与查看、筛选明确分离的工作模式；成功、警告、危险与地图悬停保持各自稳定的语义。桌面是主使用场景，窄视口时工具条保留触达性并允许横向滚动，而非压缩成难以辨认的图标堆。

**Key Characteristics:**
- 地图优先：UI 贴边悬浮，避免占据中心视野。
- 轻量层次：雾白面板、细边界与柔和阴影共同区分工具层。
- 操作可辨：蓝色用于提交与导航，紫色用于人工绘制，状态颜色不挪作装饰。
- 数值可靠：计数、面积和状态数量使用等宽数字，避免跳动和误读。

## Colors

蓝色、青色和紫色分别承担操作、空间对象与人工绘制的稳定角色；状态色只在反馈、图例和高风险动作中出现。

### Primary
- **行动蓝**：所有主按钮、可回跳导航和启用的地块图层使用 `{colors.action-blue}`；悬停使用 `{colors.action-blue-hover}`。
- **空间青**：行政边界、普通地块和默认图例边框使用 `{colors.map-cyan}`；它表达地图对象，而不是提交动作。

### Secondary
- **绘制紫**：新增、编辑人工地块、顶点和相关提示使用 `{colors.drawing-purple}`；绘制的悬停与确认对应用 `{colors.drawing-purple-hover}`。
- **定位黄**：边界悬停与需注意的地图定位反馈使用 `{colors.map-hover-yellow}`。

### Tertiary
- **成功绿**：保存成功、恢复动作和影像可用提示使用 `{colors.success-green}`。
- **警告黄**：已隐藏地块及其图例使用 `{colors.warning-yellow}`。
- **危险红**：保存失败、待隐藏和移除动作使用 `{colors.danger-red}`。

### Neutral
- **深石墨**：关键标题、指标和高对比图标使用 `{colors.canvas-slate}`。
- **操作灰**：默认控件文案、辅助标签与普通图标使用 `{colors.ink-slate}`；次级说明降至 `{colors.muted-slate}`。
- **雾白浮层**：地图工具条与统计卡使用 `{colors.panel-slate}`；确认对话框使用 `{colors.panel-white}`，并以 `{colors.panel-border}` 建立边缘。

**The Semantic Color Rule.** 蓝色、紫色、绿/黄/红的含义在所有地图状态、工具条、通知与图例中必须保持一致；不得因美化目的互换它们。

## Typography

**Display Font:** 无独立展示字体；地图工作台不使用装饰性大标题。<br>
**Body Font:** `{typography.body.fontFamily}`<br>
**Label/Mono Font:** 界面标签沿用正文；统计、面积和数量启用 `font-variant-numeric: tabular-nums`。

**Character:** 中文系统无衬线字体让控件在内网桌面环境下加载稳定、阅读直接。类型层级服务于地图操作：紧凑标签优先，只有关键数量适度放大。

### Hierarchy
- **Control**：`{typography.control.fontSize}`、`{typography.control.fontWeight}`、`{typography.control.lineHeight}`；用于按钮、面包屑、工具条和普通状态文案。
- **Metric**：`{typography.metric.fontSize}`、`{typography.metric.fontWeight}`、`{typography.metric.lineHeight}`；仅用于地块数量、面积和编辑批次数量。
- **Auxiliary**：10–12px、600–700；用于图例、影像提示、键盘提示和地图标注，不可替代主操作标签。

**The Numbers Stay Still Rule.** 任何会变化的数量、面积、批次统计必须使用等宽数字；不要用动画或比例字体制造视觉跳动。

## Layout

全屏地图是唯一画布。左上角保留返回和路径定位，右上角放置村级地块操作，右下角纵向堆叠图层与缩放控制，左下角保留统计、图例或影像状态。地图顶部中央只在绘制时放置快捷键提示，通知位于其下方。

浮层使用 `{spacing.tight}` 至 `{spacing.compact}` 的内部间距，常规按钮高度固定为 34px。桌面布局以贴边、不遮挡中心视野为准；720px 以下缩小间距与辅助文案，520px 以下工具条可横向滚动，避免删减关键操作。

## Elevation & Depth

浮层依靠半透明雾白表面、细边界、背景模糊与短而柔的阴影，从影像和行政边界中分离出来。普通操作面板使用低层环境阴影；通知、地图提示和确认对话框提高阴影强度以表达临时性与优先级。浮层不应使用厚重卡片、渐变底或大面积不透明遮罩，确认对话框除外。

### Shadow Vocabulary
- **工具浮层** (`0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12)`): 面包屑、控制栈与操作工具条。
- **统计卡** (`0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.1)`): 左下角低优先级持续信息。
- **确认对话框** (`0 22px 50px rgba(15, 23, 42, 0.3)`): 需要中断地图操作的风险确认。

**The Edge-First Rule.** 工具和状态信息固定在地图边缘；只有短时通知与对话框可以进入中心区域。

## Shapes

形状语言是轻柔而功能化的圆角矩形：图例色块几乎直角，文字片段小圆角，按钮和键盘提示使用 `{rounded.control}`，容器使用 `{rounded.panel}`，确认对话框使用 `{rounded.dialog}`。所有可点控件通过尺寸、底色、颜色和焦点环表达可操作性；不要依赖圆角本身传达层级。

## Components

### Buttons
- **Shape:** 紧凑圆角（`{rounded.control}`）、固定 34px 高度；图标按钮为 36px 方形。
- **Primary:** 使用 `{components.action-primary.backgroundColor}` 和 `{components.action-primary.textColor}`；用于返回上级、新增地块、保存与确认。
- **Hover / Focus:** 悬停切换至 `{components.action-primary-hover.backgroundColor}`；键盘焦点使用与主操作同色、3px 宽的半透明外圈和 2px 偏移。
- **Secondary / Ghost:** 透明或白色底，默认使用 `{colors.ink-slate}`；悬停以 `{colors.panel-hover}` 提示。禁用态降低不透明度并保留状态说明。

### Map Panels
- **Style:** 使用 `{components.map-panel.backgroundColor}`、`{components.map-panel.rounded}` 与低层环境阴影；仅在地图边缘悬浮。
- **Content:** 工具条内按钮按 2–8px 间隔组织；分隔线只用于同一组内的不同意图，不能装饰性堆叠。
- **Backdrop:** 保持背景模糊，使影像仍可辨识而文字有稳定对比。

### Breadcrumb Navigation
- **Style:** 返回按钮在路径左侧，当前层级以深色和较高字重锁定；可回跳层级只用蓝色和浅蓝悬停底表达可操作性。
- **Responsive:** 窄视口保持单行并允许路径横向滚动，不截断当前层级。

### Parcel Toolbar
- **Default:** 新增地块为蓝色主动作，筛选为次级动作；没有可筛选对象时筛选入口禁用且提供原因。
- **Edit:** 绘制相关动作转为紫色；筛选的隐藏、恢复与待保存状态用语义色点和等宽计数表达，不以颜色单独传达状态。

### Status Cards & Legends
- **Metrics:** 当前地块与合计面积并列，数值使用 `{typography.metric.fontSize}`；单位和字段名退至辅助层级。
- **Legend:** 两列紧凑排列，边框、填充、虚线必须与地图上的实际地块状态一致。

### Confirmation Dialog
- **Style:** 白色实体面板配深色遮罩；风险图标和确认按钮使用紫色绘制语义，仅在人工地块批次确认中使用。
- **Focus:** 打开后聚焦对话框；点击遮罩与“取消”均为非确认操作。

## Do's and Don'ts

### Do:
- **Do** 让地图、边界和地块始终是最大面积的视觉主体，工具仅贴边出现。
- **Do** 使用 `{colors.action-blue}` 表达主操作和可回跳导航，并保留悬停、禁用与键盘焦点状态。
- **Do** 让人工绘制始终使用 `{colors.drawing-purple}`，让图例、顶点、工具条与提示保持同步。
- **Do** 将状态颜色与明确文字、图标或线型一起使用，尤其是隐藏、恢复、失败与警告。
- **Do** 保持浮层紧凑、半透明、可读，并在窄屏保留操作触达性。

### Don't:
- **Don't** 用大标题、营销式横幅、装饰性渐变或全屏卡片压过地图画布。
- **Don't** 把蓝色、紫色或状态色当作可互换的装饰色。
- **Don't** 将地块统计、图例和图层控制散落在中心地图区域。
- **Don't** 只靠颜色区分地块状态，或在状态计数中使用比例数字。
- **Don't** 为追求“玻璃感”牺牲文字对比度或让面板不透明到遮蔽空间信息。
