# Task Brief — #1175 域守则补台账真源指针

#CRITERIA: D

## Q1: 问题
门禁总台账（唯一真源）只在 handbook，产品仓 `agents/P4-门禁/AGENTS.md` 无指针 ⇒ 接手者无法从产品仓一步跳到台账，易跑偏靠记忆。

## Q2: 范围
做：
agents/P4-门禁/AGENTS.md
gate-exemptions/2026-10-30-b0-ledger-pointer.md
docs/authority/DOCS-REGISTRY.yaml
不做：
- 不改 AGENTS.md 任何既有条款（只加 1 行）
- 不改 scripts/** 与 .gitea/**

## Q3: 验收
入口：`git diff gitea/main -- agents/P4-门禁/AGENTS.md`
处理：只有 +1 行、零删除
结果：`check-gate-protection --changed-base gitea/main` 0 失败、`doc-registry-gate.sh` rc=0

## 架构层: 不属五层业务（治理文档）

## Done 标准
- [x] AGENTS.md 仅 +1 行、零删除 verify: `git diff --numstat gitea/main -- agents/P4-门禁/AGENTS.md`
- [x] ①d 0 失败 verify: `bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root .`
- [x] 登记门禁绿 verify: `bash scripts/doc-system/doc-registry-gate.sh`
