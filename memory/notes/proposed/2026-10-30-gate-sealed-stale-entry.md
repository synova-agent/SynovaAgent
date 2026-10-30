# #1026 claim／sealed 隔离台账：删除陈旧条目 `brief-parseable.test.sh`（CI fail-closed 解阻断）

- **状态**: proposed（待 L1/K3 确认后转 implemented）
- **日期**: 2026-10-30
- **批次**: 门禁数据修复（非语义变更）｜分支 `ct/gate-sealed-stale`（base `gitea/local-main b8edf9860`）
- **授权**: 创始人 2026-10-30「你不就是处理门禁的么，你不改门禁谁该」——一次性数据修复授权；记录于 Gitea **#1158**
- **claim 归属**: 该文件写集挂在已关闭的 **#1026**（`FACE-TOTAL 173→197`）名下，故按 claim 机制在 subject scope 声明 `#1026`

## 一、现状（做之前）

- `scripts/control-tower/gate-integrity-baseline.txt` **第 96 行** 条目 `tests/control-tower/brief-parseable.test.sh` **指向不存在的文件**
  （仓内实际：`brief-parser-strip.test.sh` / `brief_parser.test.sh` / `check-brief-parseable.test.sh`；该测试在 #1072 已改名）。
- 影响链：`sealed-tests.sh --list` **RC=1** → `.github/workflows/ci.yml:668-671` `|| { exit 1; }` **fail-closed 早退**
  → CI 恒红 → **阻断全部合并**（M6 PR #1163 因此 merge-hold）。
- 该台账头注释**自带违规判据 (b)**：「本段条目指向不存在的文件 → 违规（台账过期，**须删条目**）」。

## 二、决定（做了什么）

> v2（2026-10-30，目标分支切 main 后）：main 上 sealed 另撞 **SLACK-CAP**（scan=209 − FACE-TOTAL=197 = 12 > 10）⇒ 同 diff **显式上调 FACE-TOTAL 197→204**（余量 5，落 3~5 口径；禁自动上调）。

- **删该条目**（1 行）。不选「改名为 `check-brief-parseable.test.sh` 保留隔离」，理由：
  ① 该测试独立跑通 **33 通过 / 0 失败**；② 发现制（D-F/②）对新增/改名测试**零登记自动纳入执行集**；
  ③ 台账头注释明文「须删条目」。

## 三、依据与证据（本轮实测）

- 前：`bash scripts/control-tower/sealed-tests.sh --list` ⇒ **RC=1**，stderr：`隔离台账条目指向不存在的文件: tests/control-tower/brief-parseable.test.sh —— 须删条目`
- 后：同命令 ⇒ **RC=0**，执行集 **135 条**；`check-gate-integrity.sh` 中 `CI-REGISTRY: … 台账失效 0`
- 不动的量：`FACE-TOTAL=197`／`SLACK-CAP`／`QUARANTINE-TOTAL` 一律未改（非语义变更）
- 备注：`check-gate-integrity.sh` 仍报 **2 条 FIXTURE-POWER 违规**（`docsonly-diff-base.test.sh` / `hooks-install.test.sh`），
  为**存量**、与本次改动无关（本件未触及这两个文件），另案处理。

## 四、边界与失效条件

- 本件**只删过期条目**，不改判据语义、不删测试、不调棘轮上下限。
- 若将来台账格式升级（如改为自动生成），「手删条目」这一步应被生成器取代 ⇒ 本 Note 失效。
