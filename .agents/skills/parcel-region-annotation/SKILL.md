---
name: "parcel-region-annotation"
description: "按《docs/地块成片区划规则.md》把参保村地块划分为大户区域+团单：红框检测、像素→经纬度校准、归属计算、可视化确认、固化。用于本仓库参保村地块重新区划（龙江/大钱/清潭/新魏家庄/新三联已完成，后续地块区划直接按此执行）。"
version: 4
created: "2026-08-20"
updated: "2026-08-20"
---
## When to Use
任何需要按用户红框参考图划分地块（大户区域/团单/未参保）的任务，或新增参保村地块区划时。权威规则见《docs/地块成片区划规则.md》（R1-R9 + 执行流程 + 检查清单 + 常见问题）。

## Procedure
1. 读取《docs/地块成片区划规则.md》确认 R1-R9 与本村取值（mergeMeters、未参保处理）
2. 收图确认：村代码、红框数量；文字复述规则获用户确认
3. 红框检测：原始红色像素簇外轮廓（cv2 findContours+approxPolyDP，阈值 r>110 且 r-g>35 且 r-b>35），禁骨架化；长方形用 bbox 矩形；叠加图验证与用户红线重合
4. 映射校准：检测地块点（绿/蓝紫/土黄多边形中心），与村 parcels label 网格搜索匹配 zoom/center（Web Mercator）
5. project-check 强制验证：全部 label 投影到用户图，与图中地块重合、无系统性偏移；检测点质量差时缩小到红框内检测点匹配
6. 归属计算（按规则 R2/R3/R4/R5/R6）：区域内全部含未参保归大户、区域外 mergeMeters 内级联归并、其余参保块一块一户团单、区域外未参保保留（每村确认）
7. 可视化确认：PIL 划分图（大户色/团单/未参保+红框）给用户确认红框对齐、区域完整、团单范围、未参保保留清单、数量；用户要求扩展红框则调整边界
8. 固化：区域多边形+mergeMeters 落盘 scripts/data/{村代码}-regions-2025.json；prepare-policy-confirmation.py 区域模式生成确认/fixture；REGION_CONFIGS/REGION_MODE_VILLAGES/聚类测试 OTHER 参考村同步
9. 验证并提交：unittest、validate-policy-fixture --all、validate-data、check-codes、web test 全过；确定性两轮哈希一致；web/src 零改动；git 提交；需求文档 A4 同步

## Pitfalls
- 归并规则每村单独确认（勿沿用上一村）：龙江 100m 归并、大钱/新魏家庄/新三联 0——先问用户再定 mergeMeters
- 红框骨架化/侵蚀严重收缩（47~95px≈200~400m），必须用原始像素簇外轮廓或 bbox 矩形
- cv2 approxPolyDP 碎片化轮廓输出乱序顶点，in_poly 大面积判错——多边形须验证绕序，长方形用 bbox
- 每张截图 zoom/center 不同，必须独立校准；未做 project-check 前不要用于归属
- 未参保处理每村独立确认（龙江 782 转参保 vs 新魏家庄 425 保留均用户拍板），保留清单随方案图确认
- 红框范围按用户看图反馈扩展是常态（下方/右侧/上方），先出方案图
- 用户可能直接指示特殊模式（整个村一个团单，regions 空）
- 检测点质量差（山体/居民区误检）时缩小到红框内检测点匹配
- 新增区域村同步：prepare REGION_CONFIGS、validate REGION_MODE_VILLAGES、聚类测试 OTHER 参考村（016→018→020）
- 视觉模型判断颜色/对齐不可靠——归属与对齐用定量统计（框内色点、成片最近邻 ≤200m）

## Verification
1. 归属定量验证：区域内 0 团单、大户组内最近邻 ≤200m（isolatedParcelIds 空）、团单严格一块一户、无重复归属
2. 团单块全部在红框区域外（硬约束）
3. project-check 图：label 投影与用户图地块重合
4. validate-policy-fixture --all / validate-data / check-codes / web test 全部退出码 0
5. 同一输入两次 prepare+generate 产物哈希一致
6. git diff --stat HEAD -- web/src 除 web/src/data 数据产物外为空
7. 需求文档 A4 记录用户确认结果与最终统计