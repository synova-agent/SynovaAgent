# A-02 · windows 平台敏感子集 —— 逐条理由 + 原始输出

> D1061 / PR-A ｜ 写者 coder-a ｜ 2026-09-29 ｜ CAP = `.synova-wt-squad-d1061-a`（branch `chore/d1061-a-ci-speedup`）
> 口径：**入库集合逐条给理由；入选理由不足者一律剔除**（队长 2026-09-29 裁定）。
> 判据单源：`scripts/control-tower/PLATFORM-CHECKLIST.md`（仓库自带，D520）——**不另立标准**。

---

## 0. 三条口径（先说清，再看数）

1. **剔「提及」留「执行」**：只收「该测试**断言链路上真的会执行**平台分歧命令」的套件。
   仅在注释里提到、或用可移植形式写法的，一律剔除。
2. **判据止于命令级**：本表**不主张**「该套件已在 windows 实测失败」——它是**保守超集**，
   语义为「失败模式本身随平台变（PATH/方言/编码/文件锁）」。宁可多跑不可漏跑。
3. **漏跑有兜底**：windows **全量**密封跑保留为夜间 `schedule` + 合并前
   `workflow_dispatch(ct_full_suite=true)` 一道（`ci.yml` 内，**禁删**）。

---

## 1. 全量密封清单（54 条 = 52 原有 + 本卡新增 2）

原始输出（禁 head 截断，全量）：

```
$ awk '/for t in \\/,/do$/' .github/workflows/ci.yml | grep -oE 'tests/[A-Za-z0-9_./-]+\.test\.(sh|py)' | sort -u | wc -l
54
$ awk '/for t in \\/,/do$/' .github/workflows/ci.yml | grep -oE 'tests/[A-Za-z0-9_./-]+\.test\.(sh|py)' | sort -u
tests/control-tower/alloc-task-id-lock.test.sh
tests/control-tower/alloc-task-id.test.sh
tests/control-tower/brief-parser-strip.test.sh
tests/control-tower/check-canary-drift.test.sh
tests/control-tower/check-citations.test.sh
tests/control-tower/check-dsh-anchor.test.sh
tests/control-tower/check-gate-integrity.test.sh
tests/control-tower/check-gitlinks.test.sh
tests/control-tower/check-k3-report.test.sh
tests/control-tower/check-name-allocation.test.sh
tests/control-tower/check-preset-bundles.test.sh
tests/control-tower/check-progress-freshness.test.sh
tests/control-tower/ci-ratchet-base.test.sh
tests/control-tower/ci-strict-visible.test.sh
tests/control-tower/claim-regex-narrow.test.sh
tests/control-tower/clone-config-init.test.sh
tests/control-tower/clone-shadow-commit.test.sh
tests/control-tower/ct-suite-select.test.sh
tests/control-tower/ct-test-gate.test.sh
tests/control-tower/d956-failmsg.test.sh
tests/control-tower/daily-cto-board-ratio.test.sh
tests/control-tower/fastlane-bypass-only.test.sh
tests/control-tower/fastlane-extended.test.sh
tests/control-tower/g12-day-window.test.sh
tests/control-tower/gate-failopen-net.test.sh
tests/control-tower/gate-stats.test.sh
tests/control-tower/grep-oP-regression.test.sh
tests/control-tower/incident-loop.test.sh
tests/control-tower/install-dsh-preset.test.sh
tests/control-tower/merge_writeset_gate.test.sh
tests/control-tower/parallel-main-tree-occupancy.test.sh
tests/control-tower/platform-checklist.test.sh
tests/control-tower/post-commit-marker.test.sh
tests/control-tower/post-commit.test.sh
tests/control-tower/q2-error-locating.test.sh
tests/control-tower/scan-fullwidth-vars.test.sh
tests/control-tower/simulate-ci-dedup.test.sh
tests/control-tower/simulate-ci.test.sh
tests/control-tower/skeleton-brief-gate.test.sh
tests/control-tower/synova-commit.test.sh
tests/control-tower/synova-submit.test.sh
tests/control-tower/tag-ancestry.test.sh
tests/control-tower/task-start-parallel.test.sh
tests/control-tower/verify-claims-table.test.sh
tests/control-tower/verify-doc.test.sh
tests/control-tower/verify-parallel-ci.test.sh
tests/control-tower/verify-parallel.test.sh
tests/control-tower/write-set-check.test.sh
tests/doc-system/check-doc-truth.test.sh
tests/doc-system/doc-categories.test.sh
tests/doc-system/doc-registry-gate.test.sh
tests/doc-system/doc-staleness.test.sh
tests/doc-system/doc-triage.test.sh
tests/doc-system/generate-chronicle-monthly.test.sh
```
（共 54 处，完整未截断）

---

## 2. 扫描器：粗筛（28 命中）

命令（对每条测试跑，排除注释行）：

```bash
PAT='\bpython3?\b|date -d|date -v|date \+%s|grep -P|grep -oP|sed -i|gtimeout|(^|[^a-zA-Z_./-])timeout[[:space:]]'
while IFS= read -r t; do
  n=$(grep -vE '^[[:space:]]*#' "$t" | grep -cE "$PAT" | tr -d '\n\r'); echo "$n $t"
done < <(52 条原清单)
```

原始输出（28 条命中，共 28 行）：

```
11 tests/control-tower/post-commit-marker.test.sh
 9 tests/control-tower/incident-loop.test.sh
 8 tests/control-tower/scan-fullwidth-vars.test.sh
 6 tests/doc-system/check-doc-truth.test.sh
 6 tests/control-tower/install-dsh-preset.test.sh
 6 tests/control-tower/grep-oP-regression.test.sh
 6 tests/control-tower/g12-day-window.test.sh
 5 tests/control-tower/synova-commit.test.sh
 4 tests/control-tower/post-commit.test.sh
 4 tests/control-tower/platform-checklist.test.sh
 3 tests/control-tower/clone-shadow-commit.test.sh
 3 tests/control-tower/brief-parser-strip.test.sh
 3 tests/control-tower/alloc-task-id.test.sh
 3 tests/control-tower/alloc-task-id-lock.test.sh
 2 tests/control-tower/task-start-parallel.test.sh
 2 tests/control-tower/parallel-main-tree-occupancy.test.sh
 2 tests/control-tower/merge_writeset_gate.test.sh
 2 tests/control-tower/fastlane-bypass-only.test.sh
 2 tests/control-tower/check-progress-freshness.test.sh
 2 tests/control-tower/check-preset-bundles.test.sh
 2 tests/control-tower/check-dsh-anchor.test.sh
 2 tests/control-tower/check-citations.test.sh
 1 tests/doc-system/doc-triage.test.sh
 1 tests/doc-system/doc-staleness.test.sh
 1 tests/control-tower/q2-error-locating.test.sh
 1 tests/control-tower/gate-stats.test.sh
 1 tests/control-tower/check-k3-report.test.sh
 1 tests/control-tower/check-gate-integrity.test.sh
```
（共 28 处命中）

---

## 3. 剔除法：粗筛命中里**入选理由不足**的 5 条（逐条给出剔除依据）

| 套件 | 粗筛命中内容 | 剔除依据 |
|---|---|---|
| `post-commit-marker.test.sh` | 仅 `$(date +%s)` | `date +%s` 在 BSD/GNU/Git Bash **行为一致**，非 PLATFORM-CHECKLIST #5 所指的 `date -d`/`date -v` |
| `post-commit.test.sh` | 仅 `$(date +%s)` | 同上 |
| `clone-shadow-commit.test.sh` | 仅 `$(date +%s)` | 同上 |
| `fastlane-bypass-only.test.sh` | `date +%s` 计时 + `mktemp` | 同上；且 `mktemp` 是 PLATFORM-CHECKLIST 附录明列的「双平台安全命令」 |
| `check-doc-truth.test.sh` | `sed -i.bak 's/…/…/'` ×6 | 后缀**紧跟** `-i.bak` 是**可移植形式**；#9 的坑是 `sed -i ''`（独立空后缀），本文件未用该形式 |

⇒ 28 − 5 = **23 条入选**。

另两条**不在粗筛内**但被点名复核过，结论为**不入选**：

| 套件 | 复核结论 |
|---|---|
| `gate-failopen-net.test.sh` | 紧口径扫描**零命中**（全文无平台分歧命令，内容是门禁逻辑断言）。**实测 120s 成本高，但不属本子集** —— 这正是"成本高 ≠ 平台敏感"的判别点 |
| `verify-parallel-ci.test.sh` | 唯一命中是 `LC_ALL=C.UTF-8` 头块（52/52 全命中，零判别力） |

---

## 4. 入选集（23 条）+ 逐条入选理由

| # | 套件 | 入选理由（触发点 = 该测试断言链路上真的会执行的平台分歧命令） |
|---|---|---|
| 1 | `alloc-task-id.test.sh` | 断言链内**显式平台分支**：python 相对路径 stat 探针 → `PLATFORM-DIFF` 走「持锁超时」分支（:258-276） |
| 2 | `alloc-task-id-lock.test.sh` | 同上（:24-39）；**文件锁**语义（Windows 无 POSIX flock 等价） |
| 3 | `brief-parser-strip.test.sh` | 裸 `python3` 子进程调解析器（:30,:31）→ PATH/shim 差异（D328/D513） |
| 4 | `check-citations.test.sh` | python 三级探测后子进程调用（:7,:13）；无 python 即 **fail-open 跳过**，行为随平台变 |
| 5 | `check-dsh-anchor.test.sh` | 裸 `python3` 拼命令串（:3）→ Windows 无 `python3.exe` 即整测试失败 |
| 6 | `check-gate-integrity.test.sh` | **grep ERE 方言敏感已实锤**（:70-82 注释记 #768/#774 windows 断案）：`^+++` 在 BSD rc=2 / GNU rc 0-1 → 断言载荷与分支随方言变 |
| 7 | `check-k3-report.test.sh` | 裸 `python3` 拼命令串（:3） |
| 8 | `check-preset-bundles.test.sh` | python 三级探测 + 子进程调用（:13,:38） |
| 9 | `check-progress-freshness.test.sh` | python 三级探测 + 子进程调用（:12,:15）；无 python 即 `exit 2` 失败 |
| 10 | `g12-day-window.test.sh` | **`date -v`(BSD) / `date -d`(GNU) 双方言回退链**（:12-15）——PLATFORM-CHECKLIST #5 原案 |
| 11 | `gate-stats.test.sh` | 裸 `python3 -` heredoc 子进程（:18） |
| 12 | `grep-oP-regression.test.sh` | **`grep -P`/`grep -oP` 方言回归网本身**：断言就是「BSD grep 无 -P → 检查静默失效」（:10-21） |
| 13 | `incident-loop.test.sh` | 多次裸 `python3` 子进程 + `command -v python3` 探针（:24-63） |
| 14 | `install-dsh-preset.test.sh` | 大量裸 `python3` heredoc 变异体执行（:45,:68,:211,:316）+ 平台转储（:188） |
| 15 | `merge_writeset_gate.test.sh` | python 三级探测 + 子进程调用（:6）；无 python 即**显式失败** |
| 16 | `parallel-main-tree-occupancy.test.sh` | 裸 `python3 -c` 子进程（:20,:36） |
| 17 | `platform-checklist.test.sh` | **平台清单自身的夹具**：CRLF 清洗 / 裸 python3 / `grep -P` / `timeout` 缺失 8 条逐条断言（:14-51） |
| 18 | `q2-error-locating.test.sh` | 裸 `python3 -` heredoc 子进程（:44） |
| 19 | `scan-fullwidth-vars.test.sh` | python 三级探测（:28,:243）+ 显式 `grep -P` 假绿陷阱负例（:62-80） |
| 20 | `synova-commit.test.sh` | 多次裸 `python3` 子进程调 `session_registry.py`（:24-52） |
| 21 | `task-start-parallel.test.sh` | 裸 `python3` 子进程调 `session_registry.py`（:24,:25） |
| 22 | `doc-staleness.test.sh` | 以 `python3 os.utime` **替代 GNU-only `touch -d`**（:18，注释记 D782）——选型理由本身即平台分歧 |
| 23 | `doc-triage.test.sh` | 同 doc-staleness（:19，D782） |

⇒ **23 / 54**。落 `scripts/control-tower/ct-suite-map.json` 的 `platform_sensitive.windows`，
逐条理由另以 `windows_reasons` 字段同文件可视化（夹具断言二者覆盖一致）。

---

## 5. 「成本高 ≠ 平台敏感」—— 用实测秒数交叉验一遍

windows 腿逐套件实测（源自前提实测 N1 段，CI run `36457345292` 行首 ISO 时间戳推算）：

| 套件 | windows 实测 | 本子集内？ | 说明 |
|---|---|---|---|
| `simulate-ci.test.sh` | 1051s | ✗ | **不是平台敏感**，是**递归重跑**——由 N1 修复消解（见 A-01） |
| `gate-failopen-net.test.sh` | 120s | ✗ | 门禁逻辑断言，无平台分歧命令（紧口径零命中） |
| `alloc-task-id-lock.test.sh` | 99s | ✅ | 文件锁 + 显式 PLATFORM-DIFF 分支 |
| `check-gate-integrity.test.sh` | 72s | ✅ | grep ERE 方言（#774 windows 断案） |
| `platform-checklist.test.sh` | 45s | ✅ | 平台清单夹具 |
| `verify-parallel-ci.test.sh` | 36s | ✗ | 仅 LC_ALL 头块命中（零判别力） |
| `scan-fullwidth-vars.test.sh` | 21s | ✅ | python 子进程 + grep -P 假绿负例 |
| `merge_writeset_gate.test.sh` | 16s | ✅ | python 子进程 |
| `ct-test-gate.test.sh` | 15s | ✗ | 无命中 |
| `alloc-task-id.test.sh` | 15s | ✅ | 显式 PLATFORM-DIFF |
| `install-dsh-preset.test.sh` | 14s | ✅ | python 子进程密集 |
| `synova-commit.test.sh` | 11s | ✅ | python 子进程 |
| 其余 40 条 | 合计 103s | 混合 | 入选 12 条 / 未入选 28 条 |

> 口径声明：**入选集与「windows 实测耗时」无相关性假设**——高耗时未入选（`gate-failopen-net` 120s、
> `verify-parallel-ci` 36s、`ct-test-gate` 15s），低耗时入选（多条 ≤11s）。这是本表**有意**的结果：
> 子集回答的是「平台分歧风险」，不是「省钱」。
