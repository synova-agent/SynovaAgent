# Task Brief: P4 交付 0 —— 包自足性审查脚本（Issue #566）

> 分支: ct/p4-selfsufficiency-checker-2026-10-18 ｜ 规格: `docs/plans/codex/implementation/SYNOVA-IMPL-566-p4-package-selfsufficiency-checker-20261018.md`（dev doc，冻结）
> 依据: CTO 裁定 188 ｜ `agents/P4-门禁/AGENTS.md` §十二 ｜ handbook《包自足性审查-协议v2》（十项；第 11 项不属本脚本）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：治理线 · 门禁（P4）。本件把《包自足性审查协议 v2》第 1–10 项从"人记得做"变成"机器每包必跑"，产出 10 包 × 10 项红绿矩阵 ＋ 可贴派单的缺口清单，并内置"对改坏守则必红"的判别力自检。不触 L1–L5 业务代码。

**b) 文件审计**：`scripts/control-tower/` 现有 34 个 `.py`（含 `check-citations.py`／`check-required-contexts.py` 等同类门禁，可照其契约头/三态退出码范式）；`tests/control-tower/` 有 `*.test.sh` 配对惯例；`scripts/control-tower/ct-test-gate.sh`（CT-40）**强制** `scripts/control-tower/<name>.py ↔ tests/control-tower/<name>.test.sh` 配对 ⇒ 本件必须带配对测试。

**c) 决策**：无既有覆盖（`grep check-package-selfsufficiency` 仅命中规格与 skill）⇒ 新建。复用 `git cat-file`/`git ls-tree` 只读范式；不引入第三方依赖（python3.9 stdlib）。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：门禁三态退出码（0 通过 / 1 业务阻断 / 2 检查自身失败）＋ fail-closed；"看不见 ≠ 没问题"（信号量==0 ⇒ exit 2）；判别力自检（故意改坏 ⇒ 必须报红）。依据 `scripts/control-tower/AGENTS.md` 与 `ctrl-tower-change` 技能模式 1/5/6。

**b) 决策链**：CTO 裁定 188 —— Q1 无写集声明⇒✅；Q2 状态词集合扩集；Q3 域守则 ≥1 份＋"必须显式 read"；Q4 ②③=引用/④=目标（"除…"为排除项）；🟡 仍 exit 1 但须区分红/黄；人工结论落点=包守则 §十一。

**c) 历史教训**：协议 v2 出生史（判据无命令 9/10、不做无路径 10/10、事实落点 9/10 缺）；P4 的 2.5 `protected_file_patterns` 4 个候选名全 0 命中（机制不存在却被写成"改配置"）⇒ 落点必须机器核。references: `.dsh/skills/package-selfsufficiency-audit/SKILL.md` §历史事故。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行）：
- scripts/control-tower/check-package-selfsufficiency.py
- tests/control-tower/check-package-selfsufficiency.test.sh
- .claude/task-briefs/2026-10-18-p4-package-selfsufficiency-checker.md
- memory/notes/implemented/2026-10-18-p4-package-selfsufficiency-checker.md
- docs/plans/codex/implementation/SYNOVA-IMPL-566-p4-package-selfsufficiency-checker-20261018.md

不做什么（禁碰，含路径）：
- scripts/audit/
- scripts/control-tower/probe-sentinel.ts
- scripts/control-tower/probe-cycle-edges.ts
- scripts/control-tower/install-deps.sh
- agents/P4-门禁/AGENTS.md
- .gitea/workflows/local-gates.yml
- scripts/pre-commit-check.sh

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`python3 scripts/control-tower/check-package-selfsufficiency.py [--packages] [--json] [--ref] [--selfcheck]`。
**交互**：① 默认跑 ⇒ 打印 10×10 矩阵（✅/🔴/🟡）＋缺口清单＋信息级备注＋待人工确认＋汇总行；② `--selfcheck` ⇒ 三子例（基线 0 / 改坏 1 / 空仓 2）；③ 降级路径 stderr `degraded:` + exit 2。
**结果**（原始输出为准，禁截断）：见 dev doc §7 与 §11 DS-1…DS-11；核心 = 默认 exit 1、`--selfcheck` exit 1＋SELFCHECK-OK、配对测试 exit 0、pre-commit 13 组全过、脚本只读（git status 不变）。

## Q4 契约与测试

- 契约头必写 `@input/@output/@exit/@degraded`（铁律 47）；三态退出码；降级必 stderr `degraded:` + exit 2。
- 纯 stdlib、python3.9 兼容；UTF-8 强制；禁 `except: pass` / `|| true`。
- 配对测试走沙箱 git 仓（`git init`＋fixture），不依赖真实仓库状态；覆盖正常/降级/反例，断言 ≥6 条。
- `--selfcheck` 必须能对"③ 删掉命令"的改坏守则报红（inner exit 1）。

## 本任务在哪一层

基础设施（控制塔门禁脚本；不触 L1–L5 业务代码）

#CRITERIA: A

## Done 标准

- [ ] verify: cd .synova-wt-p4 && python3 scripts/control-tower/check-package-selfsufficiency.py; test $? -eq 1
- [ ] verify: cd .synova-wt-p4 && python3 scripts/control-tower/check-package-selfsufficiency.py --selfcheck; test $? -eq 1
- [ ] verify: cd .synova-wt-p4 && bash tests/control-tower/check-package-selfsufficiency.test.sh; test $? -eq 0
- [ ] verify: cd .synova-wt-p4 && python3 scripts/control-tower/check-package-selfsufficiency.py --ref nosuchref 2>&1 | grep -q "degraded:"
- [ ] verify: cd .synova-wt-p4 && python3 scripts/control-tower/check-package-selfsufficiency.py --json | python3 -m json.tool >/dev/null; test $? -eq 0
