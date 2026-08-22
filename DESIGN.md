---
name: 农险双精准地图 Demo
description: 面向内部技术验证的紧凑空间核查、台风态势与点位天气工作台。
colors:
  action-blue: "#2563eb"
  action-blue-hover: "#1d4ed8"
  typhoon-deep: "#1e40af"
  guard-blue: "#3b82f6"
  forecast-orange: "#f97316"
  map-cyan: "#38bdf8"
  map-hover-yellow: "#facc15"
  alarm-amber: "#b45309"
  canvas-slate: "#0f172a"
  ink-slate: "#475569"
  muted-slate: "#64748b"
  disabled-slate: "#94a3b8"
  panel-slate: "rgba(248, 250, 252, 0.96)"
  panel-white: "#ffffff"
  panel-border: "rgba(148, 163, 184, 0.34)"
  panel-hover: "#e2e8f0"
  hover-blue: "#eff6ff"
  active-blue: "#dbeafe"
  row-hover-cyan: "#ecfeff"
  drawing-purple: "#7e22ce"
  drawing-purple-hover: "#6b21a8"
  drawing-purple-tint: "#faf5ff"
  success-green: "#166534"
  restore-green: "#15803d"
  warning-yellow: "#eab308"
  danger-red: "#b91c1c"
  error-text: "#991b1b"
  error-bg: "#fef2f2"
  policy-purple: "#6d28d9"
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
  card: "12px"
  dialog: "14px"
  pill: "999px"
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
  typhoon-panel:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.panel}"
    padding: "0"
  policy-chip-large:
    backgroundColor: "#dcfce7"
    textColor: "{colors.success-green}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  policy-chip-group:
    backgroundColor: "#f3e8ff"
    textColor: "{colors.policy-purple}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  policy-chip-uninsured:
    backgroundColor: "#f1f5f9"
    textColor: "{colors.ink-slate}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
---

# Design System: 农险双精准地图 Demo

## Overview

**Creative North Star: "清晰的空间工具"**

这是一个以地图为主角的内部技术验证工作台。空间影像、行政边界、地块几何与台风路径是视觉主体；界面只以轻量、半透明的控制浮层停靠在地图边缘，不抢占地图的注意力。信息密度紧凑，但每个动作、状态与反馈都必须能快速扫读。

主操作以蓝色建立单一行动路径；地块绘制以紫色形成与查看、筛选明确分离的工作模式；台风以蓝边框面板营造专题态势的沉浸感；预警等级色、风圈色与状态色保持各自稳定的语义。桌面是主使用场景，窄视口时工具条保留触达性并允许横向滚动，而非压缩成难以辨认的图标堆。

**Key Characteristics:**
- 地图优先：UI 贴边悬浮，避免占据中心视野。
- 轻量层次：雾白面板、细边界与柔和阴影共同区分工具层。
- 操作可辨：蓝色用于提交与导航，紫色用于人工绘制，状态颜色不挪作装饰。
- 模式带边框：台风、时间轴、悬浮浮窗用蓝实线边框包裹整块，与雾白浮层形成明确模式区分。
- 数值可靠：计数、面积、风力、温度和状态数量使用等宽数字，避免跳动和误读。

## Colors

蓝色、青色和紫色分别承担操作、空间对象与人工绘制的稳定角色；状态色只在反馈、图例和高风险动作中出现。台风与天气的专题面沿用同一行动蓝，不引入第二套品牌色。

### Primary
- **行动蓝**：所有主按钮、可回跳导航、启用的图层入口、台风面板边框与头部、预警/天气浮窗头部使用 `{colors.action-blue}`；悬停使用 `{colors.action-blue-hover}`，深化态（时间轴已展开标签）使用 `{colors.typhoon-deep}`。
- **空间青**：行政边界、普通地块和默认图例边框使用 `{colors.map-cyan}`；它表达地图对象，而不是提交动作。

### Secondary
- **绘制紫**：新增、编辑人工地块、顶点和相关提示使用 `{colors.drawing-purple}`；绘制的悬停与确认对应用 `{colors.drawing-purple-hover}`，浅紫提示底使用 `{colors.drawing-purple-tint}`。
- **定位黄**：边界悬停、台风悬浮浮窗的时间戳使用 `{colors.map-hover-yellow}`。
- **警戒蓝**：台风 48 小时警戒线、时间轴标签与降水柱条使用 `{colors.guard-blue}`。
- **预测橙**：台风预测路径、风圈等级与编辑保存动作使用 `{colors.forecast-orange}`。

### Tertiary
- **成功绿**：保存成功、恢复动作和零降水提示使用 `{colors.success-green}`；恢复底使用 `{colors.restore-green}`。
- **警告黄**：已隐藏地块、24 小时警戒线及其图例使用 `{colors.warning-yellow}`。
- **危险红**：保存失败、待隐藏、移除动作与实时台风点使用 `{colors.danger-red}`；错误文字使用 `{colors.error-text}`、错误底使用 `{colors.error-bg}`。
- **预警琥珀**：NMC 预警图标占位与天气小时卡片警示注使用 `{colors.alarm-amber}`。

### Neutral
- **深石墨**：关键标题、指标、保单概览卡与提示浮层使用 `{colors.canvas-slate}`。
- **操作灰**：默认控件文案、辅助标签与普通图标使用 `{colors.ink-slate}`；次级说明降至 `{colors.muted-slate}`；禁用态使用 `{colors.disabled-slate}`。
- **雾白浮层**：地图工具条、统计卡、天气/预警面板使用 `{colors.panel-slate}`；确认对话框与详情浮窗使用 `{colors.panel-white}`，并以 `{colors.panel-border}` 建立边缘。
- **悬停蓝底**：按钮与行悬停使用 `{colors.hover-blue}`；激活入口使用 `{colors.active-blue}`；表格行选中使用 `{colors.row-hover-cyan}`。

**The Semantic Color Rule.** 蓝色、紫色、绿/黄/红的含义在所有地图状态、工具条、通知与图例中必须保持一致；不得因美化目的互换它们。

## Typography

**Display Font:** 无独立展示字体；地图工作台不使用装饰性大标题。<br>
**Body Font:** `{typography.body.fontFamily}`<br>
**Label/Mono Font:** 界面标签沿用正文；统计、面积、风力与数量启用 `font-variant-numeric: tabular-nums`。

**Character:** 中文系统无衬线字体让控件在内网桌面环境下加载稳定、阅读直接。类型层级服务于地图操作：紧凑标签优先，只有关键数量适度放大。

### Hierarchy
- **Control**：`{typography.control.fontSize}`、`{typography.control.fontWeight}`、`{typography.control.lineHeight}`；用于按钮、面包屑、工具条和普通状态文案。
- **Metric**：`{typography.metric.fontSize}`、`{typography.metric.fontWeight}`、`{typography.metric.lineHeight}`；仅用于地块数量、面积、保单统计和编辑批次数量。
- **Auxiliary**：10–12px、600–750；用于图例、影像提示、键盘提示、表格与地图标注，不可替代主操作标签。

**The Numbers Stay Still Rule.** 任何会变化的数量、面积、风力等级、温度或批次统计必须使用等宽数字；不要用动画或比例字体制造视觉跳动。

## Layout

全屏地图是唯一画布。左上角保留返回和路径定位，右下角纵向堆叠图层、村级地块工具入口与缩放控制，左下角保留统计、图例或影像状态。正常查看态悬停"地块工具"后，入口左侧弹出新增与筛选菜单；进入具体模式后保留该入口但设为不可点击，并在右上角放置完整模式工具栏。地图顶部中央只在绘制或点选天气时放置快捷键提示，通知位于其下方。

**专题面右上停靠**：台风路径面板、天气面板、NMC 预警面板都停靠在右上角 `12px` 边缘，三者模式互斥、不同时出现。台风面板为蓝边框专题容器，天气与预警面板为雾白浮层。台风时间轴抽屉从地图底部向上展开（166px 高），地块详情与保单抽屉从右侧滑入（440px 地块、920px 保单）。

浮层使用 `{spacing.tight}` 至 `{spacing.compact}` 的内部间距，常规按钮高度固定为 34px。桌面布局以贴边、不遮挡中心视野为准；720px 以下缩小间距与辅助文案，520px 以下工具条与面板可横向滚动或近全宽，避免删减关键操作。

## Elevation & Depth

浮层依靠半透明雾白表面、细边界、背景模糊与短而柔的阴影，从影像和行政边界中分离出来。普通操作面板使用低层环境阴影；通知、地图提示和确认对话框提高阴影强度以表达临时性与优先级。台风与预警专题使用蓝色实线边框而非厚重阴影来建立模式感。浮层不应使用厚重卡片、渐变底或大面积不透明遮罩，确认对话框与保单概览深色卡除外。

### Shadow Vocabulary
- **工具浮层** (`0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12)`): 面包屑、控制栈与操作工具条。
- **统计卡** (`0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.1)`): 左下角低优先级持续信息。
- **专题面板** (`0 7px 22px rgba(15, 23, 42, 0.24)`): 台风路径面板与悬浮浮窗。
- **侧抽屉** (`-10px 18px 48px rgba(15, 23, 42, 0.22)`): 地块详情与保单抽屉，从右侧滑入。
- **详情浮窗** (`0 12px 30px rgba(15, 23, 42, 0.25)`): 天气/预警浮窗与浮层内浮窗。
- **确认对话框** (`0 22px 50px rgba(15, 23, 42, 0.3)`): 需要中断地图操作的风险确认。
- **短时通知** (`0 8px 22px rgba(15, 23, 42, 0.22), 0 2px 5px rgba(15, 23, 42, 0.16)`): 保存成功与业务错误横幅。

**The Edge-First Rule.** 工具和状态信息固定在地图边缘；只有短时通知与对话框可以进入中心区域。

## Shapes

形状语言是轻柔而功能化的圆角矩形：图例色块几乎直角（`{rounded.swatch}`），文字片段与键盘提示小圆角（`{rounded.crumb}`–`{rounded.hint}`），按钮使用 `{rounded.control}`，容器使用 `{rounded.panel}`，记录卡使用 `{rounded.card}`，确认对话框使用 `{rounded.dialog}`，保单类型使用 `{rounded.pill}` 全圆角。台风路径面板以 5px 实线蓝边框包裹整块并圆角收边；时间轴标签为胶囊形。所有可点控件通过尺寸、底色、颜色和焦点环表达可操作性；不要依赖圆角本身传达层级。

## Components

### Buttons
- **Shape:** 紧凑圆角（`{rounded.control}`）、固定 34px 高度；图标按钮为 36px 方形。
- **Primary:** 使用 `{components.action-primary.backgroundColor}` 和 `{components.action-primary.textColor}`；用于返回上级、新增地块、保存与确认、台风时间轴开关。
- **Hover / Focus:** 悬停切换至 `{components.action-primary-hover.backgroundColor}`；键盘焦点使用与主操作同色、3px 宽的半透明外圈和 2px 偏移。
- **Secondary / Ghost:** 透明或白色底，默认使用 `{colors.ink-slate}`；悬停以 `{colors.panel-hover}` 或 `{colors.hover-blue}` 提示。禁用态降低不透明度并保留状态说明。

### Map Panels
- **Style:** 使用 `{components.map-panel.backgroundColor}`、`{components.map-panel.rounded}` 与低层环境阴影；仅在地图边缘悬浮。
- **Content:** 工具条内按钮按 2–8px 间隔组织；分隔线只用于同一组内的不同意图，不能装饰性堆叠。
- **Backdrop:** 保持背景模糊，使影像仍可辨识而文字有稳定对比。
- **Control Stack:** 36px 方形图标按钮；激活入口用 `{colors.active-blue}` 底 + 深化蓝图标，并在弹层菜单选中项左侧放一条 3px 蓝竖条；单操作图标悬停显示深石墨浮层提示，带二级菜单的图标悬停只弹出菜单、不显示提示（避免与菜单同侧遮挡）；入口按钮不叠加浏览器原生 title 提示。

### Typhoon Panel（签名组件）
- **Shell:** 右上角 390px 宽、5px 实线 `{colors.action-blue}` 边框包裹，蓝色头部 34px 白字，内部白色卡片列表。
- **Header:** 标题 14px 白字，关闭按钮为浅蓝字、悬停加深。
- **Cards:** 白色卡片 7px 圆角；展开态标题加粗并以内 2px 蓝框标记焦点；历史卡片无焦点框、关闭按钮仅悬停显示。
- **Node Table:** 表头粘性置顶浅灰底，选中行 `{colors.active-blue}` 底 + 左侧 3px 蓝竖条 + 加粗；实时点红色、历史点绿色。
- **Timeline Drawer:** 底部 166px 抽屉、蓝实线边框与蓝色月行；时间轴标签为胶囊，已展开深蓝、聚焦黄边、禁用灰。极端数量使用限定宽度横向滚动条带。
- **Hover Popup:** 3px 蓝边框包裹的白色详情浮窗，头部蓝底白字，时间戳黄色强调；不随相机移动。

### Weather & Alarm Panels（雾白浮层）
- **Weather Panel:** 右上 378px 雾白面板，选中地区行 `{colors.hover-blue}` 底 + 左侧 3px 蓝竖条；预警 chips 用预警等级色边框（`--warning` 动态色）与浅色底标签。
- **Weather Marker:** 108×42 紧凑双栏地图标牌：左侧 42px 实色天气图标块，右侧白底依次显示行政名称与未来 24 小时最高/最低温度（如 `35/26°C`）；整体使用 `{colors.action-blue}` 边框，锚点在左下角以保持图标对应政府驻地查询点。实时天气按当前层级展示全部政府驻地标牌集合（省级 11 市、市级区县、县级乡镇），进入即先显示骨架（通用加载图标 + `--`）再逐项替换；每项成功/失败独立更新。`Ctrl` 临时点显示“地图点选”、改紫色图标块 + 紫色外圈；标牌摘要失败态红色图标块 + 浅红底；选中标牌增加清晰蓝外圈反馈。
- **Weather Marker Layout:** 密集标牌先按 108×42 真实尺寸做碰撞检测；重叠时按稳定行政代码排序执行确定性、可逆的屏幕偏移（先上/下后左/右环序），保留全部独立标牌与原始查询坐标，不丢弃、不合并、不缩小到不可点；地图平移/缩放后重新计算偏移，浮窗锚定被选标牌实际显示位置。
- **Weather Popup:** 360px 白色浮窗、头部浅灰；位置天气浮窗优先停靠在天气标牌右侧，保留至少 12px 间距且不覆盖标牌，右侧空间不足时切到标牌左侧；预警模式下头部用等级色填充。当前天气卡背景随本地时段切换：白天（06:00–17:59）浅蓝 `#50AADF`，夜间（18:00–05:59）深海军蓝 `#1e3a5f`，卡内文字、图标与分隔线均为白色系；黄色温度区间条与两端温度标签在两种背景下保持一致。
- **National Alarm Panel:** 右上 360×520px 固定雾白面板，行 hover/selected 为 `{colors.hover-blue}` 底 + 浅蓝边框；刷新按钮旋转态。
- **National Alarm Popup:** 360px 白色浮窗、`{colors.action-blue}` 头部白字，正文保留段落换行；重试按钮为蓝色。
- **Alarm Icon:** 地图图标为 34×26 方形官方 PNG，drop-shadow 落地；hover/selected 黄边、键盘焦点蓝边。

### Side Drawers（地块详情与保单）
- **Style:** 从右侧滑入，440px（地块）/ 920px（保单）宽，左侧 16px 圆角，雾白模糊底；720px 以下全屏。
- **Header:** 白色头部带下边框，主标题 17px 加粗；关闭按钮为 34px 圆形浅灰。
- **Detail Sections:** 白色信息块 12px 圆角；分区标题带蓝色小字 kicker；定义列表两列（标签/值）用 1px 浅底分隔。
- **Policy Overview:** 深石墨卡白字展示保单统计，数值用等宽数字。
- **Policy Chips:** 保单类型全圆角 chip：大额绿底绿字、团体紫底紫字、未投保灰底灰字；地图图例用同色系描边小色块。
- **Records & Empty:** 记录卡白底 12px 圆角；空状态为虚线边框居中占位。
- **Roster Table:** 表格行 hover/selected 用 `{colors.row-hover-cyan}` 底；分页按钮禁用态降低不透明度。

### Breadcrumb Navigation
- **Style:** 返回按钮在路径左侧，当前层级以深色和较高字重锁定；可回跳层级只用蓝色和浅蓝悬停底表达可操作性。
- **Responsive:** 窄视口保持单行并允许路径横向滚动，不截断当前层级。

### Parcel Toolbar
- **Default:** 正常查看态将"地块工具"作为右下角功能栏的第一个图标；单操作图标使用一致的深色悬停提示。悬停地块工具后在左侧弹出紧凑、等宽、同色的新增与筛选菜单；没有可筛选对象时筛选入口禁用且提供原因。
- **Active mode:** 选择操作后关闭菜单，右下角入口保留但进入禁用态，同时在右上角显示完整模式工具栏；保存或取消退出模式后恢复入口可用状态。
- **Edit:** 绘制相关动作使用紫色；筛选的隐藏、恢复与待保存状态用语义色点和等宽计数表达，不以颜色单独传达状态。

### Status Cards & Legends
- **Metrics:** 当前地块与合计面积并列，数值使用 `{typography.metric.fontSize}`；单位和字段名退至辅助层级。
- **Legend:** 两列紧凑排列，边框、填充、虚线必须与地图上的实际地块状态一致。台风图例的实线（实际路径）、橙色虚线（预测）、浅青面（风圈）与黄/蓝警戒线必须与图层渲染一致。

### Confirmation Dialog
- **Style:** 白色实体面板配深色遮罩；风险图标和确认按钮使用紫色绘制语义，仅在人工地块批次确认中使用。
- **Focus:** 打开后聚焦对话框；点击遮罩与"取消"均为非确认操作。

## Do's and Don'ts

### Do:
- **Do** 让地图、边界和地块始终是最大面积的视觉主体，工具仅贴边出现。
- **Do** 使用 `{colors.action-blue}` 表达主操作和可回跳导航，并保留悬停、禁用与键盘焦点状态。
- **Do** 让人工绘制始终使用 `{colors.drawing-purple}`，让图例、顶点、工具条与提示保持同步。
- **Do** 用蓝色实线边框（台风面板、时间轴、悬浮浮窗）包裹专题模式，与雾白浮层明确区分。
- **Do** 将状态颜色与明确文字、图标或线型一起使用，尤其是隐藏、恢复、失败与警告。
- **Do** 保持浮层紧凑、半透明、可读，并在窄屏保留操作触达性。

### Don't:
- **Don't** 用大标题、营销式横幅、装饰性渐变或全屏卡片压过地图画布。
- **Don't** 把蓝色、紫色或状态色当作可互换的装饰色。
- **Don't** 将地块统计、图例和图层控制散落在中心地图区域。
- **Don't** 只靠颜色区分地块或台风状态，或在状态计数中使用比例数字。
- **Don't** 为追求"玻璃感"牺牲文字对比度或让面板不透明到遮蔽空间信息。
- **Don't** 在台风与天气/预警之间引入第二套品牌蓝，破坏模式间的同一性。
