# Task Brief: P7-1 —— 四条件自证检查器（Issue #582）

> 分支: ct/p7-impl-20261018（实施会话自建；一人一事一分支）｜ 规格: `docs/plans/codex/implementation/SYNOVA-IMPL-582-merge-conditions-20261018.md`（**dev doc，已合 main；文件名＝Issue 号；冻结 blob `a22509208b08fa6a`**）
> 依据: 创始人 2026-10-18 开工令（一条命令判四条件；③ 凭据形态由 P7 设计）｜ 五裁 B1–B5（dev doc 附录 B）＋ C 批（附录 C，已随 PR #584 落盘）｜ `agents/P7-交付自证与真值/AGENTS.md` §三/§四/§八之三
> 本卡由 **L1（P7 包负责人）产出**，随 dev doc 之后落 main；**实施会话只读使用，不得改写本卡**（口径变更 ⇒ 退回 L1 → CTO）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：治理线 · 自证（P7）。本件把「四条件自合并」（① CI 全绿 pending=0 ② 零写集重叠 ③ 已过独立复核 ④ 串行）从**人口头判断**变成**一条命令的机器判定**，输出 `CAN-自合并 / NO: <哪条> / degraded:` 三态。它决定 P1–P6 能否不问 CTO 就合，**不触 L1–L5 业务代码**。

**b) 文件审计**：`scripts/control-tower/` 现有 131 件（`check-*` 26／`probe-*` 28）；写集机器已有三件（`devdoc_writeset.py` 内核、`verify-parallel.sh` 405 行 4 模式、`check-dev-doc-write-set.sh` 172 行）；CI 状态查询件实测只有 `scripts/project/pr-queue-scan.py:427`（GitHub 口径，可照抄其 check-runs→status 回退）；仓内**无**复核凭据件（9 件含 receipt/attest 字样的都不是 PR 复核）。`ct-test-gate.sh`（CT-40）**强制** `scripts/control-tower/<name>.sh ↔ tests/control-tower/<name>.test.sh` 配对 ⇒ 必须带配对测试。

**c) 决策**：**复用 7 项 ＋ 新建 1 件**（编排层无现成件）；**不扩 `verify-parallel.sh`**（它在 CI 的 `--ci-pr` 路径上、属 P4 主域，改共享守卫＝回归风险）。③ 凭据本批走 **T1 `attested`**（回执＋指纹＋时序），`proven`（原生 review）⏸ 待裁 B6-a、**不实现**。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：三态退出码（0 通过 / 1 真红 / **2 检查自身失败**）＋ fail-closed；**「看不见 ≠ 没问题」**（信号量==0 ⇒ exit 2）；判别力自检（故意改坏 ⇒ 必须报红）。依据 `scripts/control-tower/AGENTS.md` 与 `ctrl-tower-change` 技能模式 1/5/6。

**b) 决策链**：创始人五裁（B1 写集补 tests/+task-briefs/ ／ B2 ④=S1∧S2 ／ B3 接受身份局限＋**③ 必须写 `③=ok(attested)` 禁只写 ok** ／ B4 Issue 自建追认 ／ B5 **不引离线 CI 缓存**）；C 批（守则 ②⑦ 已落 #584）。

**c) 历史教训**：① **「看不见」被 Gitea 报成 `pending`**（`total_count=0`，实测提交 `0c8179665`）⇒ 必须 exit 2；② **PR 的 `base.sha` 不是分支点**（14 个 open PR 的 base.sha 全等于 tip，但 `merge-base --is-ancestor` 14/14 不成立）⇒ ④ 必须用 merge-base；③ **`origin/local-main` 是陈旧镜像**（落后 359）⇒ S1 必须 `git ls-remote` 取远端真值；④ 写集/数字**写死必过期**（教训 161/167）⇒ 现状一律 as_of 或现场取。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行）：
- scripts/control-tower/check-merge-conditions.sh
- tests/control-tower/check-merge-conditions.test.sh
- docs/synova/reviews/README.md
- memory/notes/implemented/2026-10-18-p7-merge-conditions.md
- docs/authority/DOCS-REGISTRY.yaml

不做什么（禁碰，含路径）：
- scripts/audit/
- scripts/control-tower/founder-truth.py
- tests/control-tower/founder-truth.test.sh
- scripts/control-tower/gate-integrity-baseline.txt
- .gitea/workflows/local-gates.yml
- scripts/pre-commit-check.sh
- scripts/control-tower/verify-parallel.sh
- scripts/control-tower/devdoc_writeset.py
- scripts/control-tower/merge_writeset_gate.py
- scripts/workflow/check-dev-doc-write-set.sh
- agents/P7-交付自证与真值/AGENTS.md
- src/

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`bash scripts/control-tower/check-merge-conditions.sh [--pr <N>] [--selfcheck] [--json] [--diff-fingerprint] [--print-receipt-template] [--offline]`。

**交互**：① `--pr <N>` ⇒ 四行条件证据 ＋ 机器行 `MERGE-COND: can|no|degraded …` ＋ 末行 `CAN-自合并` / `NO: <条件名>` / `degraded: <原因>`；② `--selfcheck` ⇒ **12 个判定点**（A 基线／B ①／C ②／D1–D4 ③／E ④S1／F 信号量 0／G ④S2／H 身份未分离仍绿+warn／I ② fail-closed）＋ 末行 `SELFCHECK-OK: 12/12`；③ 降级一律 stderr `degraded:` ＋ exit 2。

**结果**（原始输出为准，禁截断）：见 dev doc §4.4 DS-1…DS-14 与 §4.3.1 子例表。核心 = `--selfcheck` exit 0 且 12/12；真仓 `--pr <N>` 出四行证据且红得有据；配对测试 12 判定点全绿；脚本**只读**（运行前后 `git status --porcelain` 不变）；`docs/synova/reviews/README.md` 含 **Known Limitations**（③ 的身份局限，裁 B3-2）。

## Q4 契约与测试

- 契约头必写 `@input/@output/@exit/@degraded/@authority`（铁律 47）；三态退出码；降级必 stderr `degraded:` + exit 2；UTF-8 强制；禁 `except: pass` / `|| true`。
- bash 3.2 ＋ git ≥2.20 ＋ python3.9 stdlib ＋ curl；**禁第三方依赖**；`--selfcheck` 零网络（夹具在系统临时目录）。
- ③ 判定：T1 回执 `syno-review-receipt/v1`，R1–R9（R2 **逐字段**含 `independence=="fresh-session"`；R3 指纹 `sha256(git diff -M --full-index --binary <mb> <head> -- . ':(exclude)docs/synova/reviews/**')`；R7 时序；R9 warn **恒打印**）；**输出禁只写 `③=ok`**。
- 判别力：`--selfcheck` 与配对测试**两处**都必须能红（子例 B–I）；**任一不符 ⇒ `SELFCHECK-FAIL` ＋ exit 2**。
- 夹具**必须照 dev doc §4.3.0 的契约**（git 图＋fixture JSON 字段；基线零重叠；**只让目标条件红**）。

## 本任务在哪一层

基础设施（控制塔门禁脚本；不触 L1–L5 业务代码）

#CRITERIA: A

## Done 标准

- [ ] verify: cd <worktree> && bash scripts/control-tower/check-merge-conditions.sh --selfcheck; test $? -eq 0 && bash scripts/control-tower/check-merge-conditions.sh --selfcheck 2>&1 | grep -q "SELFCHECK-OK: 12/12"
- [ ] verify: cd <worktree> && bash tests/control-tower/check-merge-conditions.test.sh; test $? -eq 0
- [ ] verify: cd <worktree> && bash scripts/control-tower/check-merge-conditions.sh --pr 558 >/tmp/mc.out 2>&1; test $? -eq 1; grep -q "^MERGE-COND: no" /tmp/mc.out
- [ ] verify: cd <worktree> && SYNO_GITEA_API=http://127.0.0.1:1/api/v1 bash scripts/control-tower/check-merge-conditions.sh --pr 558 >/dev/null 2>/tmp/mc.err; test $? -eq 2; grep -q "degraded:" /tmp/mc.err
- [ ] verify: cd <worktree> && bash scripts/control-tower/check-merge-conditions.sh --pr 558 --offline >/dev/null 2>/tmp/mc2.err; test $? -eq 2 && grep -q "degraded:" /tmp/mc2.err
- [ ] verify: cd <worktree> && git status --porcelain | grep -qv "^$" && echo DIRTY || echo READONLY-OK   # 期望输出 READONLY-OK
- [ ] verify: cd <worktree> && grep -q "Known Limitations" docs/synova/reviews/README.md; test $? -eq 0
- [ ] verify: cd <worktree> && bash scripts/pre-commit-check.sh; test $? -eq 0
- [ ] verify: cd <worktree> && python3 scripts/control-tower/check-package-selfsufficiency.py --packages P7 >/dev/null; test $? -eq 1   # ① 仍红 = 缺 probe-line-signals.ts（下一批），②⑦ 不得回退
