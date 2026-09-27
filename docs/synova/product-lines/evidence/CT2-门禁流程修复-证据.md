# CT2 — 门禁流程修复证据（task-2 / D1032）

> 任务: task-2（CT-FLOW）｜ 卡号: **D1032** ｜ 成员: flow-fix
> 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-flow`（分支 `fix/ct-flow-brief-ledger-20260927`）
> Base: `476bac39`（origin/main，2026-09-28 fetch 后 ff-only 同步；**未 rebase / 未 force push**）
> 主树 `/Users/wane/SynovaAgent` 零写入（读过 `task-state/D1032.json`、`.claude/task-briefs/*D1032*.md` 骨架作源）
> 证据口径: 全部数字来自命令原始输出；红证 = 删掉修复后同一套断言变红

---

## 0. 变更集（7 个文件 + 治理件）

| # | 文件 | 交付 |
|---|------|------|
| 1 | `scripts/workflow/resolve-commit-brief.sh` | CT-A1 多命中 fail-closed |
| 2 | `scripts/control-tower/check-name-allocation.sh` | CT-B `brief-dup` 同号检测面 |
| 3 | `scripts/hooks/post-commit.sh` | CT-2 账本真实状态（软失败被放行） |
| 4 | `tests/control-tower/resolve-commit-brief.test.sh` | 场景 12 夹具 + `SYNO_RESOLVER_UNDER_TEST` 变异缝 |
| 5 | `tests/control-tower/check-name-allocation.test.sh` | §9 夹具 + `SYNO_TOOL_UNDER_TEST` 变异缝 |
| 6 | `tests/control-tower/simulate-ci.test.sh` | `inner_detail` 完整透传 + 长输出夹具 + 子进程端到端断言 |
| 7 | `tests/control-tower/post-commit.test.sh` | CT-2 夹具 + `SYNO_HOOK_UNDER_TEST` 变异缝 |
| 8 | `.github/workflows/ci.yml` | **接线修复**：CT job 显式清单补 `resolve-commit-brief.test.sh`（改前零提及 ⇒ CT-A1 夹具 CI 永不执行；详见 M6 件 §5） |
| — | `docs/synova/product-lines/evidence/CT2-*` | 本证据 + M6 收尾（治理产物，D860 不计预算） |
| — | `task-state/D1032.json` + `.claude/task-briefs/2026-09-28-D1032-*.md` | D# 登记件（队长下发 D1032，治理产物） |

**未改**（写集内但最小连带不需要）：`scripts/control-tower/synova-commit`、`tests/control-tower/synova-commit.test.sh`、
`tests/control-tower/post-commit-marker.test.sh`、`tests/control-tower/clone-shadow-commit.test.sh`、`scripts/install-hooks.sh`（CTO 未批）。
其中后三者保持绿：CT-2 走**只增分支**改法，正常 PASS 行文本一字未动。

---

## 1. CT-A1 — `resolve-commit-brief.sh` 多命中 fail-closed

### 1.1 缺陷（卡面前提由队长冻结，此处为执行期复现）
`scripts/workflow/resolve-commit-brief.sh:210-232`（改前行号）：
`n = sum(1 for sf in staged for p in scope if match_path(sf, p))`（:218）→ `best = max(...)` →
`top.sort(key=锚点)` → `print(top[0])`。**同层并列静默取首位**（由字典序裁决，无告警）。

### 1.2 改前 / 改后（同一夹具：两个 brief 同数认领、无任何身份锚点）

**改前**（HEAD 版实现，`git show HEAD:scripts/workflow/resolve-commit-brief.sh`）：
```
--- 修复前: bash /tmp/ct2-prefix-resolve-commit-brief.sh 'scripts/a.sh' ---
/private/var/folders/.../T/tmp.RIKqHZltYP/.claude/task-briefs/2026-09-28-tie-noanchor-a.md
rc=0
```
（只输出 `-a.md`，`-b.md` 被静默丢弃）

**改后**（工作区实现）：
```
❌ resolve-commit-brief: 多命中并列且身份锚点无法裁决 — fail-closed（拒绝猜测 brief）
   stdout 不输出任何 brief 路径（调用方必须按「无确定 brief」处理）
   标记: SYNO_AMBIGUOUS_BRIEF count=1 candidates=2
   并列候选（需人工消歧: 指定 current-brief，或改用含 D# 的分支名）:
     - /private/var/folders/.../T/tmp.RIKqHZltYP/.claude/task-briefs/2026-09-28-tie-noanchor-a.md
     - /private/var/folders/.../T/tmp.RIKqHZltYP/.claude/task-briefs/2026-09-28-tie-noanchor-b.md
rc=2
```
契约保持：`stdout` 仍只承载 brief 路径（`scripts/control-tower/staging_guard.py:79` 取 stdout 首行当路径 ⇒ 并列时 stdout 为空，**不会把标记误当路径**）；诊断走 stderr；退出码 2 = 三态里的「未能得出确定结论」，同样阻断。

### 1.3 全量测试（改后）
```
bash tests/control-tower/resolve-commit-brief.test.sh
── 11. D718 共享文件同数认领（tie）→ 身份锚点 brief 必须胜出 ──
  ✅ 同数认领场景解析成功 (exit=0)
  ✅ 身份锚点（分支 D900）brief 在同数认领中胜出
  ✅ 陈旧共享 brief 不因字典序靠前而胜出
── 12. CT-A1: 同数认领 + 无任何身份锚点 → fail-closed（exit 2 + 点名全部候选）──
  ✅ 同数且无锚点 → exit 2（fail-closed，不猜 brief） (exit=2)
  ✅ 点名并列候选 A（完整路径）
  ✅ 点名并列候选 B（完整路径）
  ✅ 输出显式声明 fail-closed 语义
  ✅ stdout 为空（并列时绝不输出任何 brief 路径）
  结果: 37 通过, 0 失败
```
（既有场景 11「tie + 强锚点唯一」保持绿 = 既有正确语义未回归）

### 1.4 红证（改坏即红）
变异：镜像 `/tmp/ct2-mut/`（resolver + 兄弟 `brief_parser.py`），**只删 fail-closed 分支**（还原 `print(finalists[0])`），同一套断言：
```
SYNO_RESOLVER_UNDER_TEST=/tmp/ct2-mut/scripts/workflow/resolve-commit-brief.sh bash tests/control-tower/resolve-commit-brief.test.sh
── 12. CT-A1: 同数认领 + 无任何身份锚点 → fail-closed（exit 2 + 点名全部候选）──
  ❌ 同数且无锚点 → exit 2（fail-closed，不猜 brief） — exit=0 期望 2
  ✅ 点名并列候选 A（完整路径）
  ❌ 点名并列候选 B（完整路径） — 未找到: tie-noanchor-b
  ❌ 输出显式声明 fail-closed 语义 — 未找到: fail-closed
  ❌ stdout 非空: 1 行
  结果: 33 通过, 4 失败
rc=1
```
（红点恰好落在场景 12；其余 33 条全绿 ⇒ 该夹具是判别性的，不是「恒红网」）

---

## 2. CT-B — `check-name-allocation.sh` 同号检测（`brief-dup`）

### 2.1 缺陷
占用判定委派 `alloc-task-id.sh --check-id`，标签仅 5 类（`alloc-task-id.sh:252` 注释「唯一占用表 = task-state/D*.json；brief 不参与发号」）
⇒ 建 brief 复用已占号**无任何检测面**。

**前提升级（队长 2026-09-28 通报，本处独立实测）**：D1023 撞号已是 `origin/main` 既成事实，**三份**：
```
$ git ls-tree -r --name-only origin/main | grep "briefs.*D1023"
.claude/task-briefs/2026-09-26-D1023-ci-docsonly-whitelist.md
.claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md
.claude/task-briefs/2026-09-27-D1023-skill-lessons-ref.md
```
三份的任务身份（日期前缀后第一个 D#）逐份判定：
```
2026-09-26-D1023-ci-docsonly-whitelist.md → 身份 D1023
2026-09-26-D1023-commit-msg-decisions.md → 身份 D1023
2026-09-27-D1023-skill-lessons-ref.md → 身份 D1023
```
⇒ 规则**未漏第三份**（日期不同不影响；身份锚定只要求「日期前缀后紧跟 D#」，与日期值无关）。

### 2.2 改前 / 改后（同真实数据，仅换 checker 版本；`SYNO_BRIEF_DIR`=本工作树(=origin/main 数据)、`SYNO_TASK_STATE_DIR`=本工作树）

**改前**（`4afd4ce1` 版 checker，落 `/private/tmp/ct2-baseline` 的纯净工作树）：
```
❌ 冲突: D1023 不可用
   冲突位置: task-state:/Users/wane/SynovaAgent/.synova-wt-ct-flow/task-state/D1023.json
   冲突位置: origin-main:origin/main:task-state/D1023.json
   冲突位置: worktree-name:.synova-wt-d1023-861
rc=1
```
⇒ **只报占用三处，三份 brief 完全不报**（缺口坐实）。

**改后**（工作区 checker，同一环境变量）：
```
❌ 冲突: D1023 不可用
   冲突位置: brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-26-D1023-ci-docsonly-whitelist.md
   冲突位置: brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md
   冲突位置: brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-27-D1023-skill-lessons-ref.md
   冲突位置: task-state:/Users/wane/SynovaAgent/.synova-wt-ct-flow/task-state/D1023.json
   冲突位置: origin-main:origin/main:task-state/D1023.json
   冲突位置: worktree-name:.synova-wt-d1023-861
rc=1
```
`--json`（机器可读面）：
```json
{"id":"D1023","status":"conflict","degraded":false,"conflicts":["brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-26-D1023-ci-docsonly-whitelist.md","brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md","brief-dup:/Users/wane/SynovaAgent/.synova-wt-ct-flow/.claude/task-briefs/2026-09-27-D1023-skill-lessons-ref.md","task-state:/Users/wane/SynovaAgent/.synova-wt-ct-flow/task-state/D1023.json","origin-main:origin/main:task-state/D1023.json","worktree-name:.synova-wt-d1023-861"]}
```

### 2.3 全量测试（改后）
```
bash tests/control-tower/check-name-allocation.test.sh
── 9. CT-B 同号检测: 同 D# ≥2 份 brief → rc=1 + 点名全部；单份/交叉引用 → rc=0 ──
  ✅ 同 D# 两份 brief → rc=1（改前 rc=0 = 缺口）
  ✅ 点名新面标签 brief-dup
  ✅ 点名两条完整路径（A + B）
  ✅ 仅一份 brief → rc=0（无占用、无同号）
  ✅ 单份 brief 无 brief-dup（判别性成立）
  ✅ slug 交叉引用不误伤（身份 = 日期前缀后的第一个 D#）
结果: 27 通过, 0 失败
```

### 2.4 红证（改坏即红）
变异：`/tmp/ct2-mut-tool/check-name-allocation.sh`（**只删 brief-dup 段**，同目录保留 `alloc-task-id.sh` 供委派），同一套断言：
```
SYNO_TOOL_UNDER_TEST=/tmp/ct2-mut-tool/check-name-allocation.sh bash tests/control-tower/check-name-allocation.test.sh
── 9. CT-B 同号检测 ──
  ❌ 应 rc=1，实际 rc=0：✅ D99001 可用（可判定范围内未见占用，且命名一致）
  ❌ 缺 brief-dup 标签，实际输出: ✅ D99001 可用（可判定范围内未见占用，且命名一致）
  ❌ 未点名两条路径: ✅ D99001 可用（可判定范围内未见占用，且命名一致）
  ✅ 仅一份 brief → rc=0（无占用、无同号）
  ✅ 单份 brief 无 brief-dup（判别性成立）
  ✅ slug 交叉引用不误伤（身份 = 日期前缀后的第一个 D#）
结果: 24 通过, 3 失败
rc=1
```

### 2.5 已知取舍（如实登记，非隐藏）
「任务身份 = 日期前缀后第一个 D#」对**同一任务拆多份 brief**（本仓既有实践）也会点名：本工作树实测存量
**30 个 D#**（如 D593 有 5 份、D964 有 5 份）。检测器无法从文件名区分「同任务子 brief」与「两任务撞号」，
故选择 fail-closed 交人工消歧——漏判代价 = D1023 型合并撞车（不可逆：占用表/审计全污染），误判代价 = 一次人工确认。
**存量名单与建议见 M6 遗留清单。**

---

## 3. CT-2（L-BYPASS-LEDGER）— 软失败被放行 ⇒ 账本记真实状态

### 3.1 缺陷（执行期实测，改前原始账本行）
沙箱用**真实** `install-hooks.sh` 生成的 `.git/hooks/pre-commit` wrapper + **真实** `scripts/hooks/post-commit.sh`；
wrapper 内层 `pre-commit-check.sh` 桩 `exit 1`（= hard_check 命中）：
```
S  ——裸 git commit——
  ❌ 组1 类型安全: 1 处  [硬阻断]
  提交已拒绝
⚠️ 本地门禁未通过（exit=1）— 已放行，CI 将作为权威判定（merge 前必须绿）
commit_rc=0            ← 提交被放行

$ tail -5 .claude/bypass.log          ← 改前账本（原文）
2026-09-28T06:18:04+08:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=b1c1dbcabd4e9ae041fbc124781e775357cf2299

$ cat .claude/gate-soft-warnings.log   ← 同一提交的真实状态
2026-09-28T06:18:04+08:00 | GATE_FAIL_SOFT | exit=1 | branch=main

$ cat .sessions/<sid>/bypass.log       ← per-session 账本同款假 PASS 行
2026-09-28T06:18:04+08:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=b1c1dbcabd4e9ae041fbc124781e775357cf2299
```
⇒ 账本把「门禁 exit=1 但被软化放行」记成**纯 PASS**（审计不可复算门禁真实健康度）。
写假行的是 `scripts/hooks/post-commit.sh:100`（改前行号）；synova-commit:725 的 `DEGRADED-PASS` 反而是诚实的
（仅存在于「pre-commit 脚本缺失」降级路径）。

### 3.2 改后（真实脚本沙箱实测）
```
场景 A: 软失败被放行（复刻 wrapper 写入序: 先 append 软失败行，再写 marker）
$ grep -F 5e431dac… .claude/bypass.log
2026-09-28T06:26:27+08:00 | COMMITTED | pre-commit DEGRADED-PASS (soft-fail allowed ts=2026-09-28T06:18:04+08:00 exit=1) | HASH=b099aa1756b68b0ee3b398837e95ebd72dad5e4f

场景 B: 随后干净提交（只重写 marker，日志不追加）
$ grep -F 024b75c6… .claude/bypass.log
2026-09-28T06:26:28+08:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=024b75c6c8b938c24658f6337a1cd039f009d3cc
```
⇒ 软失败提交记真实状态；**下一干净提交不被串标**（mtime 窗口 + 「证据行 ts 已被账本消费」双判定；
首次实测**无消费判定时**同一沙箱内干净提交被误标为 DEGRADED —— 该缺陷在交付前被本夹具抓出并已修，见下）。

配对依据（零 date 方言依赖）：wrapper 顺序 = append 软失败行 → 写 marker ⇒ 同一轮两次写入 mtime 差 <1s；
下一轮干净提交会**重写 marker**（mtime 前移）而日志不变。窗口 `SYNO_SOFT_FAIL_WINDOW`（默认 5s）可调。

### 3.3 全量测试（改后）
```
bash tests/control-tower/post-commit.test.sh
── CT-2: 软失败被放行 → 账本真实状态；下一干净提交恢复纯 PASS（不串标）──
  ✅ 软失败放行 → 账本记 DEGRADED-PASS + 证据 ts/exit（真实状态）
  ✅ 同一 HASH 不同时存在纯 PASS 行（记录不矛盾）
  ✅ 下一干净提交恢复纯 PASS（mtime 窗口 + 消费判定生效）
结果: 15 通过, 0 失败
```

### 3.4 红证（改坏即红）
变异：`/tmp/ct2-mut-hook/post-commit.sh`（**只把 `_softfail_state` 调用置空**），同一套断言：
```
SYNO_HOOK_UNDER_TEST=/tmp/ct2-mut-hook/post-commit.sh bash tests/control-tower/post-commit.test.sh
── CT-2 ──
  ❌ 账本未记真实状态: 2026-09-28T06:26:55+08:00 | COMMITTED | pre-commit PASS (hook 层登记) | HASH=cdee7727…
  ❌ 软失败被记成纯 PASS（判据未满足）
  ✅ 下一干净提交恢复纯 PASS（mtime 窗口 + 消费判定生效）
结果: 13 通过, 2 失败
rc=1
```

### 3.5 最小连带验证（既有硬断言保持绿）
`tests/control-tower/post-commit-marker.test.sh:71`、`tests/control-tower/clone-shadow-commit.test.sh:64` 均**硬断言**
`COMMITTED | pre-commit PASS (hook 层登记) | HASH=<真实 HASH>` 原文——其沙箱无 `gate-soft-warnings.log`
⇒ `_softfail_state` 返回空 ⇒ 走原分支，文本一字未变。两文件**未改动**（保持绿，见 §5）。

---

## 4. simulate-ci — FAIL 时透传内层完整输出

### 4.1 缺陷（`HEAD` 版 `tests/control-tower/simulate-ci.test.sh:41`）
```bash
INNER=$(echo "$OUT" | grep -E "❌|FAIL" | tr '\n' '|' | tr -d '%' | cut -c1-400)
```
双重丢失：① 只留含 `❌|FAIL` 的行（内层失败信息不含这两个字样 ⇒ 全灭）；
② 截断 400 字符。且该透传只在「绿桩却失败」分支，红桩分支无透传。

### 4.2 改前 / 改后（同一真实运行产物：内层桩 40 行 + 末行标记，共 1594 字符，**不含 ❌/FAIL**）
```
改前（原实现表达式逐字取自 HEAD 版 :41）:
  字符数=98
  内容: ❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）|
        ← 只剩 simulate-ci.sh 自身摘要行；内层 1594 字符与末行标记**全部丢失**

改后（inner_detail，函数逐字取自改后测试文件）:
  字符数=2340
  首行: ═══════════════════════════════════════════════════════════
  末行: ❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）
  内层末行标记: 可见 ✅
```
`inner_detail()` 契约：完整透传（stdout+stderr 合并）；仅超上限 `SYNO_SIM_INNER_MAX`（默认 20000）才截断且**显式标注**原因与上限值；红桩分支与降级分支的失败断言同样透传。

### 4.3 新增夹具（判别性 + 端到端）
- 前置自校验：内层桩输出无 `❌/FAIL` 且 >400 字符（夹具成立性）；
- 断言：透传后字符数 >400、内层末行标记可见、内层尾部行可见、超限截断显式标注；
- **端到端**：父进程以「失败绿桩」注入方式运行**本测试文件自身**（子进程 cwd=沙箱 ⇒ 不递归重型路径），
  断言子进程的失败输出里必须出现内层末行标记 ⇒ 证明 `inner_detail` 真被断言分支调用（非死代码，防「接线了≠被执行」）。

### 4.4 全量测试结果
见 M6 收尾件 `CT2-M6收尾-自验结论与遗留清单.md` §1（含**既有红**的原始输出与归因）。

---

## 5. 证据可核命令清单（复算入口）

```bash
# CT-A1
bash -n scripts/workflow/resolve-commit-brief.sh
bash tests/control-tower/resolve-commit-brief.test.sh                     # 37/0
SYNO_RESOLVER_UNDER_TEST=/tmp/ct2-mut/scripts/workflow/resolve-commit-brief.sh \
  bash tests/control-tower/resolve-commit-brief.test.sh                   # 33/4（红证）
# CT-B
bash -n scripts/control-tower/check-name-allocation.sh
bash scripts/control-tower/check-name-allocation.sh --id D1023            # 三份 brief-dup（真实 origin/main 数据）
bash tests/control-tower/check-name-allocation.test.sh                    # 27/0
SYNO_TOOL_UNDER_TEST=/tmp/ct2-mut-tool/check-name-allocation.sh \
  bash tests/control-tower/check-name-allocation.test.sh                  # 24/3（红证）
# CT-2
bash -n scripts/hooks/post-commit.sh
bash tests/control-tower/post-commit.test.sh                              # 15/0
SYNO_HOOK_UNDER_TEST=/tmp/ct2-mut-hook/post-commit.sh \
  bash tests/control-tower/post-commit.test.sh                            # 13/2（红证）
# simulate-ci
bash -n tests/control-tower/simulate-ci.test.sh
bash tests/control-tower/simulate-ci.test.sh                              # 见 M6 件 §1
# 门禁自过（改门禁者先过门禁）
bash scripts/check-silent-swallow.sh --diff
bash scripts/workflow/check-silent-swallow.sh --utf8
```

> 变异镜像不随仓库交付（`/tmp/ct2-mut*`）；复算方式：按本文件 §1.4/§2.4/§3.4 描述的**单点变异**重建即可
> （删 fail-closed 分支 / 删 brief-dup 段 / 置空 `_softfail_state` 调用），再配 `SYNO_*_UNDER_TEST` 缝运行对应测试。
