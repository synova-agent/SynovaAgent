# Task Brief: CTO 入口面重写 — CLAUDE.md 退役 + AGENTS.md 升 V7.0

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
入口层（A 类：README/AGENTS/STATE）。本任务 = **指令面重写**（非产品代码）。
CC 已退役（D1146/2026-10-05）⇒ `CLAUDE.md` 成遗物（最后提交 10-05，7 天无人动），
且与 `AGENTS.md` 重复（行级相似度 42.6%）、**占注入预算 67%** ⇒ `AGENTS.md` 被系统性省略。

### b) 文件审计
`AGENTS.md` 28,189 B ｜ `CLAUDE.md` 43,692 B ｜ 合计 71,881 B > 65,536 预算（110%）。
引 `CLAUDE.md` 的脚本/测试：实测 16 个文件。

### c) 决策
**重写 + 退役**（依据：CTO 裁定 059 ＋ 2026-10-02《指令面与 GitHub 三层总方案》§3 第 1 步）。

## Q1: 调研
- 铁律 0-2（测试先行）、铁律 47（契约优先）。
- **DSH 注入机制**（实测）：字节预算是硬上限，**超预算时"drops whole broader files
  before truncating the most-specific file"** ⇒ `AGENTS.md` 被 omitted 即由此而来。
- 历史教训：**"三件必须同批"**（否则 check-doc-truth / check-brief-vs-code /
  weekly-selfcheck 必红）。

## Q2: 范围
做什么：
- AGENTS.md
- CLAUDE.md
- scripts/check-brief-vs-code.sh
- scripts/control-tower/weekly-selfcheck.sh
- scripts/doc-system/check-doc-truth.sh
- tests/control-tower/brief-template-decision.test.sh
- tests/control-tower/verify-doc.test.sh
- tests/control-tower/weekly-selfcheck.test.sh
- tests/doc-system/check-doc-truth.test.sh
- tests/doc-system/doc-truth-probe.test.sh

不做什么（含文件路径）：
- 不改 scripts/ci/verify-doc.sh（存量红，非本件）
- 不改 src/deploy/content-registry.ts
- 不改 scripts/audit 下的任何脚本
- 不改 scripts/pre-commit-check.sh
- 不改 docs/synova/coordination/施工项登记.ts
- 不改 scripts/check-as-any.sh.md

## Q3: 验收 — 入口 → 交互 → 结果
入口：`git commit`（pre-commit 13 组）
处理：改 `AGENTS.md`/`CLAUDE.md` + 引用同步
结果：注入预算 71,881 B（110% ❌）→ **16,335 B（24% ✅）**

## 架构层: −1 运行时（入口/指令面）
#CRITERIA: A

## 写集
- AGENTS.md
- CLAUDE.md
- scripts/check-brief-vs-code.sh
- scripts/control-tower/weekly-selfcheck.sh
- scripts/doc-system/check-doc-truth.sh
- tests/control-tower/brief-template-decision.test.sh
- tests/control-tower/verify-doc.test.sh
- tests/control-tower/weekly-selfcheck.test.sh
- tests/doc-system/check-doc-truth.test.sh
- tests/doc-system/doc-truth-probe.test.sh
- .claude/task-briefs/2026-10-12-cto-入口面重写-CLAUDE退役-AGENTS升V7.md

## Done 标准
### 本件判据（逐条可跑）
- [ ] verify: `bash scripts/doc-system/check-doc-truth.sh; echo rc=$?`（expectExit 0）
- [ ] verify: `bash tests/doc-system/check-doc-truth.test.sh`（expectExit 0）
- [ ] verify: `bash tests/doc-system/doc-truth-probe.test.sh`（expectExit 0）
- [ ] verify: `bash tests/control-tower/weekly-selfcheck.test.sh`（expectExit 0）
- [ ] verify: `bash tests/control-tower/brief-template-decision.test.sh`（expectExit 0）
- [ ] verify: `test $(( $(wc -c < AGENTS.md) + $(wc -c < CLAUDE.md) )) -le 36864`（预算 ≤36 KB）
### 附加模板项
- [ ] 反例（改坏即红）：把 `AGENTS.md` 头部版本号改掉 ⇒ `check-doc-truth.sh` 必红（留原始输出）
- [ ] 三态：未实现必须 exit 2（0=通过／1=失败／2=未实现 —— 禁假绿）

---
## 状态（事实台账 · 不由本 brief 合成结论）
- 2026-10-12：本卡建立（CTO 入口面重写，三件同批）
