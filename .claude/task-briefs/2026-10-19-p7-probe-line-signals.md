# Task Brief: #602 —— P7-2 三信号探针（`probe-line-signals.ts`）

> 分支: ct/p7-probe-20261019（实施会话自建；一人一事一分支）｜ 规格: `docs/plans/codex/implementation/SYNOVA-IMPL-602-line-signals-probe-20261019.md`（**dev doc，冻结 blob 派单时给**）
> 依据: 创始人 2026-10-19 口径裁定「**回执 A**」｜ P7 守则 §三「三信号可跑」｜ handbook `常设授权条例.md` §四（① 判据通过率 ② 例外清单 ③ 在飞/卡数）
> 本卡由 **L1（P7 包负责人）产出**，随 dev doc 落 main；**实施会话只读使用，不得改写**（口径变更 ⇒ 退回 L1 → CTO）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：治理线 · 自证（P7）。**把"回执三信号"从人算变成机算** —— CTO 问「某线进度/在飞/例外」时一条命令出，不靠人报。🔴 **「线」＝ handbook §五 的报告线（产品线／治理线／CTO／K3／基座线），按路径切；不是包 P1–P10**（包写集天然重叠，实测 17 open PR 13–16 个 cross-line）。不触 L1–L5 业务代码。

**b) 文件审计**：`scripts/control-tower/` 131 件；已有 **探针契约单一实现** `probe-ladder.ts`（13 探针／`RESULT=`／三态）、**信号发射** `emit-signal.py`（`.codex/signals/`）、**四条件机器判定** `check-merge-conditions.sh`（#597＋#604），**没有**按线聚合三信号的编排层（全树 grep「回执三信号」0 实现）。⚠️ **关键实测**：17 个 open PR 仅 3 个分支带包前缀；`task-state/*.json` **无 line/package 字段** ⇒ **必须多判据映射 ＋ unknown/cross-line 兜底**（dev doc §4bis）。

**c) 决策**：**复用 8 项 ＋ 新建 1 件**；**不做** B 口径健康三信号（`gen-cto-health.py` 已在算）；**线集读 handbook §五（5 条报告线，禁硬编码）**。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：三态退出码（0/1/**2**）＋ **信号量==0 ⇒ exit 2**（看不见≠没问题）；**fail-closed**（取不到不许当 0）；探针只读、可复跑、同一状态两次同结果。依据 `scripts/control-tower/AGENTS.md`、`ctrl-tower-change`。

**b) 决策链**：**创始人 2026-10-19「回执 A」**（A = 回执三信号；B = 健康三信号不做）；映射口径待 CTO 批（dev doc 附录 B-7-a）＋ **写集扩 1 行**待批（B-7-b）。

**c) 历史教训**：① **"看不见"被当没问题**（#582 的 `total_count=0` 教训）⇒ 0 open PR 与 API 失败都必须 exit 2、但 reason 可区分；② **只见 needle 抓不住拼接**（#597 漏判、#604 修补）⇒ 本件映射与聚合的对错必须由**输出级**断言守；③ 写死数量必过期（教训 161/167）⇒ **线集读 handbook §五（5 条报告线），禁硬编码**；`--line` 只接受报告线名。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行）：
- scripts/control-tower/probe-line-signals.ts
- tests/control-tower/probe-line-signals.test.sh
- memory/notes/implemented/2026-10-19-p7-probe-line-signals.md
- （无 registry：P7 §四 `docs/**` 已覆盖，无需扩）

不做什么（禁碰，含路径）：
- scripts/control-tower/check-merge-conditions.sh
- scripts/control-tower/gen-cto-health.py
- scripts/control-tower/probe-ladder.ts
- scripts/control-tower/emit-signal.py
- docs/plans/codex/implementation/SYNOVA-IMPL-602-line-signals-probe-20261019.md
- scripts/audit/
- .gitea/workflows/local-gates.yml
- src/
- extensions/

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`npx tsx scripts/control-tower/probe-line-signals.ts [--all|--line <产品线|治理线|CTO|K3|基座线>] [--json] [--selfcheck]`。
**交互**：① `--all` ⇒ 每线一行 `①(merge-conditions)=p/n|n/a(0) ②=n ③=n 在飞` ＋ 末行 `LINE-SIGNALS: lines=<n> exceptions=<n> gaps=<n>`；② `--line <报告线>` ⇒ 单线 + 例外逐条；③ `--json` ⇒ 固定键（含 mapping）；④ `--selfcheck` ⇒ 7 子例（A 基线／B 计数明细不一致／C 无 PR 当 100%／D 根级失败／E 混入 B 口径／F 跨线硬归），末行 `SELFCHECK-OK: 7/7`。
**结果**：三态 0/1/2；unknown/cross-line **不丢**；无在飞 PR 显示 `n/a`（非 100%）；只读（运行前后 `git status` 不变）。

## Q4 契约与测试

- 头部契约必写 `@input/@output/@exit/@degraded/@authority`（铁律 47）；三态退出码；降级 stderr `degraded:` + exit 2；UTF-8；**禁第三方新依赖**（用仓内 tsx）。
- 夹具注入缝 `SYNO_LINE_SIGNALS_FIXTURE`（零网络，schema 见 dev doc §4.3）；**每个子例只让目标条件红**。
- **降级粒度**：逐项降级（单 PR 的 `E_MERGE_BASE` 等）⇒ 进 exceptions、整体 exit **1**；仅根级 API/git/JSON 失败 ⇒ exit **2**。
- 输出级断言：unknown/cross-line 计数 = 明细条数；口径守卫（只允许 A 三信号键）。
- 配对测试覆盖 7 子例 + 三态 + 只读证明；`--selfcheck` 与 W2 **两处**都必须能红。

## 本任务在哪一层

基础设施（控制塔探针；不触 L1–L5 业务代码）

#CRITERIA: A

## Done 标准

- [ ] verify: cd <worktree> && source ~/.nvm/nvm.sh && npx tsx scripts/control-tower/probe-line-signals.ts --selfcheck; test $? -eq 0 && npx tsx scripts/control-tower/probe-line-signals.ts --selfcheck 2>&1 | grep -q "SELFCHECK-OK: 7/7"
- [ ] verify: cd <worktree> && bash tests/control-tower/probe-line-signals.test.sh; test $? -eq 0
- [ ] verify: cd <worktree> && source ~/.nvm/nvm.sh && npx tsx scripts/control-tower/probe-line-signals.ts --all >/tmp/ls.out 2>&1; test $? -le 1; grep -q "^LINE-SIGNALS:" /tmp/ls.out
- [ ] verify: cd <worktree> && source ~/.nvm/nvm.sh && SYNO_GITEA_API=http://127.0.0.1:1/api/v1 npx tsx scripts/control-tower/probe-line-signals.ts --all >/dev/null 2>/tmp/ls.err; test $? -eq 2; grep -q "degraded:" /tmp/ls.err
- [ ] verify: cd <worktree> && source ~/.nvm/nvm.sh && npx tsx scripts/control-tower/probe-line-signals.ts --all --json | python3 -m json.tool >/dev/null; test $? -eq 0
- [ ] verify: cd <worktree> && git status --porcelain | grep -qv "^$" && echo DIRTY || echo READONLY-OK
- [ ] verify: cd <worktree> && bash scripts/pre-commit-check.sh; test $? -eq 0
