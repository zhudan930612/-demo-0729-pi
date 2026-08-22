# 贡献指南（协作者流程与规则）

> 本文件写给**协作者 / 新成员**，讲清楚作为协作者「怎么参与、怎么提交、怎么被合并」。
> 权威细节（完整验证命令、硬约束原文、agent 执行规范）在 [`AGENTS.md`](./AGENTS.md)；术语口径与**读文档顺序**在 [`CONTEXT.md`](./CONTEXT.md)。本文件只做提炼与导航，**不再复制**权威文件原文，避免两份规则漂移。

## 先读什么

新进入仓库，**读什么文档的顺序**见 [`CONTEXT.md`](./CONTEXT.md) 的「新会话/新人指引」；本文件只讲协作流程本身。概括如下：

1. [`README.md`](./README.md)——项目做什么、怎么运行、数据怎么准备、版权限制
2. 本文件——协作流程与规则
3. [`AGENTS.md`](./AGENTS.md)——详细验证命令、硬约束、git 纪律（本文件权威来源）
4. [`CONTEXT.md`](./CONTEXT.md)——统一术语与避免词（写代码、文档、验收都要遵守）

## 协作模型

- 你以**协作者（write）**身份开发：推送功能分支、提 PR。
- **不能直接推 main**（受保护分支，推会被 GH006 拒）。
- 合入 main 需要 **code owner 批准**（审批者限定仓库 owner，见 `.github/CODEOWNERS`）。
- **协作者不能批准自己的 PR**（GitHub 硬规则）——你的 PR 需由 owner（其他审批人）Review → Approve → Merge。

## 分支策略

> **每功能一分支闭环（必守）**：每个新功能单独开一个分支 → 完成并合并到 main 后 → **删除本地分支** → **重新拉取最新 main** → 再开下一个功能分支。不要复用、不要在一个分支上堆多个功能，也不要在旧分支上继续提交。

- 从一个干净基线拉分支，命名建议 `feat/`、`fix/`、`refactor/`、`docs/` 前缀 + 简短描述（如 `feat/xxx`）。
- **改动完成即 `git commit`（不 push）再继续**——防止并发会话/multiple 终端覆盖你未提交的改动。
- 测基线 / 回退用 git（`git commit` 或 `git stash`）；**不要用 `git checkout --`** 覆盖工作区（会丢改动）。
- 不在工作区生成临时备份文件（如 `_backup_*.vue`）。

## 提交与合并流程

### 1. 同步基线

```bash
git checkout main && git pull --ff-only   # 避免基于过期 main 提交
git checkout -b feat/你的功能
```

### 2. 开发并验证

按「验证门槛」跑对应层级的验证，通过后再提交。改动完成即 commit（不 push）。

### 3. 推送并提 PR

```bash
git push -u origin <功能分支>
gh pr create --base main --head <功能分支> --title "..." --body "..."
```

PR 说明里写清楚：改了哪些行为、为什么改、跑了哪层验证。

### 4. 等 code owner 审批合并

- 你的 PR 需 owner **Review → Approve → Merge**。
- 合并命令建议带 `--delete-branch`，会**自动删除远端 + 本地工作分支**，无需再手动删。
- 合并后远程分支由 GitHub 自动删除（仓库已配 `delete_branch_on_merge=true`）。

> 注意：`gh pr merge --delete-branch` 删的是本地工作分支和远端分支，但**不会删 `.git` 里的 remote-tracking 引用**（`origin/xxx`），需 `git fetch --prune` 清掉。别把残留的 `origin/xxx` 当成「没删干净」。

### 5. 收尾：删本地分支并重拉基线，再开下一个功能

```bash
git checkout main && git pull --ff-only   # 回 main 并拉最新
# 若本地功能分支没被自动删，手动删：
git branch -d <功能分支>                   # 未合并会被 -d 拒绝，安全
```

- 合并完成后**删除本地功能分支**（`--delete-branch` 通常已自动删，若没删就 `git branch -d`）。
- **重新拉取最新 main** 再开下一个功能分支，避免基于过期代码开发。
- 一个功能一个分支，不要在旧分支上继续，也不要在同一个分支堆多个功能。

### 冲突处理

- 两拨功能不重叠 → 手工合并共存；重叠 → 按语义取舍。
- 疑难冲突停下向用户展示，让用户决定，**不要无脑选 `ours`/`theirs`**。

## 验证门槛（按改动面分级）

> 原则来自 AGENTS.md：**非必要不跑全量**，简单改动只测改动击中的部分。快速层必做。

### 快速层（任何改动，必做）

```bash
pnpm --dir web build        # vue-tsc 类型检查 + vite 编译
pnpm --dir web test         # vitest 单测
git diff --check
```

### 定向层（只动一个组件 / composable / 单图层）

只跑击中的测试，不全量：

```bash
pnpm --dir web exec vitest run src/features/weather/useWeatherMode.ts
```

### 全量层（大改动 / 合并 / 发布前）

触及**共用面板、下钻、跨域合成（MapView）、静态数据链路、区划规则**，或合并/发布前：

```bash
pnpm --dir web test:e2e      # 跑前先清理 8790/4173 残留端口
```

### 其它域

```bash
pnpm --dir server test                          # 改 server 时
python scripts/validate-data.py                 # 改数据脚本/层级链路时
python scripts/validate-policy-fixture.py --all # 改保单/地块区划时
python scripts/check-codes.py                   # 改编码归属时
```

**判定**：改动落在单组件/composable/单图层/单域 → 定向层；落到共享组件、MapView、下钻、多域、静态数据格式/区划规则 → 全量层；**拿不准就全量**。

## 硬约束速览（详情见 AGENTS.md）

- **安全**：不提交 `.env.local`、天地图 Token、APIHz / 和风凭据；凭据由服务端读取，前端不用 `VITE_*` 传凭据。
- **数据**：`01-行政区划/`、`05-遥感数据/` 用 Git LFS 入库（需 `git lfs pull`）；不提交 `参考截图/`、`web/public/data/`、`web/public/tiles/`、`web/dist/`。
- **版权**：吉林一号影像、派生瓦片、AI 地块 GeoJSON 不得公开分发；锐多宝数据未获商业授权前不外发；Delineate Anything 仅作仓库外离线工具；演示结果**不得描述为确权、承保或测绘成果**。
- **地图**：村是导航终点，不得用村点生成伪村界；保持天地图文字注记位于影像、地块和边界之上。

## 数据/形态类需求的工作方式

**数据口径 / 空间形态类需求**（地块归属、分组、布局、造数等，产物形态由数据决定）：
- **编码前**：先给用户看可目视的形态样例/图，确认业务形态再编码。
- **编码后**：先给用户目视预检产物，形态不符先回需求变更，再进自动化验收。
- 纯自动化验收**无法替代**形态确认。

## 术语纪律

代码、文档、验收中的用词须遵循 [`CONTEXT.md`](./CONTEXT.md) 术语表，**不得使用避免词**。术语口径变化须同步 CONTEXT.md 与受影响的现役需求文档。

## 常见坑

- **强推** `--force` → 覆盖远程提交，禁止；被拒后用 `pull --rebase`。
- **未跑测试就提交/提 PR** → 产物可能编译失败/测试红；提 PR 前确认 CI / GitGuardian 安全扫描通过。
- **基于过期 main 提交** → 开发前 `git checkout main && git pull --ff-only`。
- **无脑选 ours/theirs** → 丢另一分支功能。
- **工作区不干净就提 PR** → 未提交改动混进合并；提 PR 前确认 `git status --short` 干净。
