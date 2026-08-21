---
name: commit-work
description: "Create high-quality git commits: review/stage intended changes, split into logical commits, and write clear commit messages (including Conventional Commits). Triggered by: commit, 提交, 提交代码, stage, craft a commit message, or split work into multiple commits."
---

# Commit work

## Goal
Make commits that are easy to review and safe to ship:
- only intended changes are included
- commits are logically scoped (split when needed)
- commit messages describe what changed and why

## Default Strategy
- **Always split into multiple commits** by logical boundaries (feature vs refactor, different directories/file groups, etc.) — do not ask the user.
- Commit style: Conventional Commits are required (type(scope): summary).
- Only ask the user when:
  - They explicitly request a single/squash commit.
  - Custom rules are needed (e.g., max subject length, required scopes).

## Commit Message Language Rule
- Default to Chinese for commit messages (subject and body).
- Use English only when the user explicitly requests English.

## Workflow (checklist)
1) Inspect the working tree before staging
   - `git status`
   - `git diff` (unstaged)
   - If many changes: `git diff --stat`
2) Decide commit boundaries (default: split)
   - Automatically split by logical boundaries: feature vs refactor, different directories/file groups, formatting vs logic, tests vs prod code, dependency bumps vs behavior changes.
   - If changes are mixed in one file, use patch staging (`git add -p`).
3) Stage only what belongs in the next commit
   - Prefer patch staging for mixed changes: `git add -p`
   - To unstage a hunk/file: `git restore --staged -p` or `git restore --staged <path>`
4) Review what will actually be committed
   - `git diff --cached`
   - Sanity checks:
     - no secrets or tokens
     - no accidental debug logging
     - no unrelated formatting churn
5) Describe the staged change in 1-2 sentences (before writing the message)
   - "What changed?" + "Why?"
   - If you cannot describe it cleanly, the commit is probably too big or mixed; go back to step 2.
6) Write the commit message
   - Use Conventional Commits (required):
     - `type(scope): short summary`
     - blank line
     - body (what/why, not implementation diary)
     - footer (BREAKING CHANGE) if needed
   - Prefer an editor for multi-line messages: `git commit -v`
   - Use `references/commit-message-template.md` if helpful.
7) Run the smallest relevant verification
   - Run the repo's fastest meaningful check (unit tests, lint, or build) before moving on.
8) Repeat for the next commit until the working tree is clean

## Deliverable
Provide:
- the final commit message(s)
- a short summary per commit (what/why)
- the commands used to stage/review (at minimum: `git diff --cached`, plus any tests run)

