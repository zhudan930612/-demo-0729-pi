# Task for worker

在当前仓库实现 V1 纯业务基础模块（只改这些范围）：web/src/features/policy/policyTypes.ts、policyValidation.ts、cultivationState.ts、cultivationStorage.ts 及对应 Vitest 测试；读取 web/src/data/policy-v1.json 和 cultivation-v1.json 的结构。要求：固定业务日期 2025-07-15；金额 cents/Decimal-like integer 规则；50.00/50.01 分类；保单状态计算；承保面积边界、同期重复、汇总校验；种植档案唯一性、早稻+连作晚稻允许、单季互斥、期间不重叠、多命中最晚兜底、按村+地块 localStorage 覆盖/新增/恢复初始状态。不要实现 Vue UI，不修改 MapView。完成后运行该范围测试并报告。

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```