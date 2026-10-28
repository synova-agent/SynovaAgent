# 判据已知坑清单（gate-pitfalls）

> 归属：**治理线**（P4 门禁包，B6＝CTO 的眼睛）｜ as_of `#1096`（W6 批一，2026-10-28）｜
> 性质：**判据设计前的必读踩坑台账** —— 不是规范、不是判据真源（判据真源在各门禁脚本自己的头注契约里）。
> 🔴 **新增判据须先读本件** —— 下列每条都已在仓内实测踩过一次（附证据/先例）。不读就重犯的代价
> 是一轮门禁假红/假绿 ＋ 一次返工；`SYNO_CI=1` 下假绿更贵（红灯会失去信息量 ⇒ 逼出 `--no-verify`）。
> 维护口径：新坑按「现象 → 根因 → 判据写法」三行入库；**已修的坑留档不回删**（防复发），修法写进「判据写法」。

---

## 坑 1（首条 · Windows）：`os.path.relpath` 打印 `\`，基线与判据都写 `/` ⇒ **存量被算成新增**

- **现象**：Windows 上 `SYNO_CI=1 bash scripts/check-content-coupling.sh` ⇒ exit 1，输出
  `汇总: 存量 473 条（棘轮内）｜新增 473 条｜基线待下调 88 条` / `CONTENT-COUPLING: VIOLATION new=473`
  （实测，2026-10-28 本批）。同一提交在 mac/Linux CI 上是 rc=0（存量只报数）。**存量全变新增**即本坑复发。
- **根因**：`os.path.relpath(f, ROOT)`（`scripts/check-content-coupling.sh:383`、`:408`）在 Windows 产出
  `extensions\adapters\x.ts`；`CC-BASELINE` 段（同文件 `:157` 起 88 条）的键是正斜杠 `extensions/adapters/x.ts`。
  字典查不到 ⇒ 该键按 0 计 ⇒ `actual > baseline` ⇒ 判「新增」；反向地每个基线键实测都变 0 ⇒ 又报「待下调」。
- **判据写法**：**一切入字典/入基线的 repo 相对路径必须先归一**：
  `rel.replace(os.sep, "/").replace("\\", "/")`（同仓先例 `check-quality-delta.py:462`、`merge_writeset_gate.py:993`）。
  只归一写侧或只归一读侧都不算修好 —— **写侧与读侧必须过同一个归一函数**；并被 Windows/posix 双夹具钉死。

## 坑 2：`git grep A..B` 不是「A 到 B 的变更集」

- **现象**：`git grep -n <pat> gitea/local-main..HEAD` 直接报 `fatal: unable to resolve revision: gitea/local-main..HEAD`
  （实测 rc=**128**）；若外面套了 `$(…) || true`，结果变**空集** ⇒ 判据数出 0 处命中 ⇒ **假绿**。
- **根因**：`git grep` 的第二个位置参数是**tree/rev**，`git diff` 的 `A..B` 区间语法在这里不成立。
  「区间」只属于 `git diff` / `git rev-list` / `git log`。
- **判据写法**：判「区间内新增行」用 `git diff -U0 A B -- <path>` 再筛 `^+`（或
  `git grep <pat> $(git rev-list A..B)`，逐个 rev 查）。**区间命令必须断言「变更集非空」**：
  空集一律 exit 2（见坑 6），不许把「查不到」当「没问题」。

## 坑 3：自指判据 —— 判据扫到自己 ⇒ 恒红或恒绿

- **现象**：新判据写 `grep -rn '<模式>' scripts/`，模式字面量**出现在判据自己的注释/测试夹具里** ⇒ 永远命中自己；
  或为了躲自己而随手 `grep -v` 掉一个目录，结果把**真正的目标**也一起漏掉 ⇒ 恒绿。
- **根因**：判据的扫描面与判据自身重合（自指）。仓内已有四种正解：自排除（`check-silent-swallow.sh:104`
  `grep -v 'check-silent-swallow.sh'`）、自我保护（`.gitea/protected-files.txt` 首行＝清单自身、末行＝
  `gate-exemptions/**`，见 `check-gate-protection.sh` 已知限制 12）、夹具进独立目录、以及
  **自排除本身要有配对测试**（`tests/control-tower/check-gate-integrity-selfexclude.test.sh`）。
- **判据写法**：自指判据必须**显式**写自排除（点名自己的路径，禁止模糊 `grep -v`），并**加一条配对断言**
  「把自己放回扫描面 ⇒ 必红」（证明排除确实生效，而不是碰巧没命中）。

## 坑 4：`grep -c` 无匹配返回 **双 0** ⇒ `[: integer expected`

- **现象**：`N=$(grep -c '<pat>' f || echo 0)` 无匹配时变量是 `0\n0`（两行），下游 `[ "$N" -gt 0 ]` 报
  `integer expression expected` / `[: integer expected`；在 `set -e` 下门禁直接崩或静默跳过。
  实测：`printf 'x\n' | grep -c 'y'` ⇒ stdout `0`，rc=**1**。
- **根因**：`grep -c` 无匹配**既打印 `0` 又返回 1**，`|| echo 0` 于是追加了第二个 `0`（V4.5.1 历史事故）。
  Windows 上再叠一层：数字尾部带 `\r`。
- **判据写法**：`N=$(grep -c '<pat>' f | tr -d '\n\r' || true)`（**管道剥换行/CR 再 `|| true`**，顺序不可反）；
  或 `grep -q` + 显式分支。任何从 `grep -c` 出来的数都必须先 `tr -d '\n\r'` 再进 `[ ]`。

## 坑 5：`|| true` / `2>/dev/null` 把「判据故障」洗成「通过」

- **现象**：`OUT=$(cmd 2>/dev/null || true)` ⇒ 命令崩溃/不存在/被杀时变量为空，判据继续往下跑，最后 rc=0。
  最坏的形状：`cmd 2>/dev/null || true; [ -z "$OUT" ] && exit 0`（看不见＝没问题）。
- **根因**：吞错把「执行失败」和「执行成功但无输出」压成同一事实。D329 实证：裸 `python3 … || true` 连崩溃都吞。
- **判据写法**：① 新增行含 `2>/dev/null` 必须带 `# swallow-ok: <理由>`（pre-commit 组 2 扫）；
  ② **执行退出码一律走 `ga_run`**（`scripts/control-tower/gate-assert.sh`）：0/1/2 之外全部归 2（判据故障），
  绝不归 0；③ 唯一已知盲区：**判据内部自己吞错再返回 0，`ga_run` 也看不见** ⇒ 这是判据作者的锅，
  不是包装层的锅，必须在判据里禁止（配对测试断言执行行无 `|| true`）。

## 坑 6：空扫描面 / 空变更集 / 坏 base 被读成「通过」（信号量==0 ⇒ exit 2）

- **现象**：清单读不到、registry 缺失、base 不可解析、git 不可用、扫描面 0 文件 ⇒ 判据数出「0 违规」⇒ rc=0。
  **「看不见」被当成「没问题」** —— 这是本仓历史上最贵的假绿形态（D328 起反复复发）。
- **根因**：三态被折叠成两态：没有把「判不了」单独立成一态。`exit 2 = 检查自身失败` 是**阻断**，不是告警。
- **判据写法**：每个「读数」都要有**信号量**断言（条数/字节数/文件数 > 0），为 0 ⇒ `degraded:` + exit **2**；
  空集语义要**分类**而不是一律放行：纯文档 PR 的 SKIP 与「有代码却零测试」的异常必须分开判
  （先例：`.gitea/workflows/local-gates.yml` ③ 步的四分支）。不要写「有违规就红」而不写「没扫到就 2」。

## 坑 7：把 `126/127/128/137` 当失败码或当成功码（信号量语义）

- **现象**：`cmd; rc=$?` 之后写 `[ "$rc" -ne 0 ] && 红`，于是一次被 `SIGKILL`（137）或非法退出参数（128）
  被报成「业务红」；更坏的是写 `[ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]` 之类分支，把 137 顺手归进「1」或「0」。
- **根因**：`128+n` 是**信号**语义（判据没跑完），`126` 不可执行、`127` 命令不存在 —— 它们都不是判据结论。
  把它们当业务结论会污染台账（真红率/故障率不可分）。
- **判据写法**：退出码**只认** {0,1,2}；其余一律 `exit 2` 并在 stderr 点名 `判据故障: <code>`。
  共享实现 = `scripts/control-tower/gate-assert.sh` 的 `ga_run`（唯一真源 `ga_normalize_code`，
  `128` 那行是变异点，改 0 即「128 当通过」）。**不要在第二个地方再抄一份归一表**（双真源必然漂移）。

## 坑 8：`command -v` 只探「存在」不探「可用」（D328 P1-1）

- **现象**：`command -v python3` 通过，但该 `python3` 是坏 shim / WindowsApps 占位符 ⇒ 一执行就失败；
  若外面套了 `|| true`，判据静默漏拦。
- **根因**：存在性是文件系统事实，可用性是运行时事实，两者不等价。
- **判据写法**：探测后**必须试运行**（`"$c" -c 'import sys'`）或把首跑失败走三态归一（→ 2）；
  解释器探测统一 `for _c in python3 python py` 三级 + 试运行（仓内范式见 `check-gate-protection.sh:109-113`）。

## 坑 9：glob 语义（`*` 跨不跨 `/`、大小写、`**`）靠脑补

- **现象**：豁免/保护路径用 `fnmatch` 思维写 `a*c` 以为只匹配一层，实际 `fnmatch('a/b/c','a*c') is True`
  ⇒ 把「名字像」的路径误判为受保护（`check-gate-protection.sh` 已知限制块有实测原文）。
- **根因**：`fnmatch` 的 `*` 跨 `/`；Gitea/gobwas glob 的 `*` 不跨 `/`、`**` 跨目录、大小写不敏感。
  两套语义混用 ⇒ 判据边界漂移。
- **判据写法**：glob 语义**写进头注并手写引擎**（禁 `import fnmatch` 整串 translate，先例
  `check-gate-protection.sh:50-53`）；对「多保护不多放行」的偏差方向显式声明（fail-closed）。

## 坑 10：判据依赖 `pwd` / 相对路径 ⇒ 换个目录跑结论就变

- **现象**：判据在仓根跑绿，在 `scripts/` 下跑红/绿不定；CI（检出目录不同）与本地结论不一致
  ⇒ 「跑的不是同一件事」，红因不可诊断。
- **根因**：路径基准没锚定到仓库根，或 `git` 命令没带 `-C`。
- **判据写法**：入口第一行锚 `ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"`（仓内范式），
  所有路径从 `$ROOT` 派生；同时提供 `--root` / 环境注入缝给测试（mktemp 沙箱），
  并写一条「从别的 cwd 跑仍同结论」的用例。

## 坑 11：中文/全角标点与变量边界（D370）＋ 豁免行三段式被破折号切坏

- **现象**：`echo "结果（$VAR）"` 在 `set -u` 下报 `VAR）: unbound variable` —— bash 把全角 `）` 当变量名字符。
  豁免行 `- <路径> — <理由> — <裁定号>` 里理由自身含 `—`/`–` ⇒ 被多切一段 ⇒ **该行不生效**（且计 failure）。
- **根因**：UTF-8 locale 下 bash 的标识符边界按字节/字符规则与直觉不同；豁免解析以破折号为界，是**格式契约**。
- **判据写法**：变量一律 `${VAR}` 花括号定界（禁裸 `$VAR` 紧贴中文/全角标点）；
  理由文本里禁写 `—`/`–`（要写「至」「到」或加括号）；写完后用 `bash -n` + 真实豁免校验器各跑一次。

## 坑 12：base 陈旧 / 无远端知识 / push 腿 diff 为空 ⇒ 假红或假绿

- **现象**：本地没 `git fetch` ⇒ `--changed-base gitea/local-main` 算出陈旧 merge-base ⇒ 把别人的变更算进本 PR；
  push 到 `local-main` 时 `merge-base == HEAD` ⇒ diff 为空 ⇒ 判据「全绿」，被读成「push 也拦了」。
- **根因**：判据只看得见本地仓库状态，不判新鲜度、不知道平台侧规则。拦截点其实在 PR 腿。
- **判据写法**：在头注「已知限制」里**逐条写清拦不到什么**（禁写成「已检测」）；CI 端用统一的 base 解析器
  （先例 `scripts/control-tower/resolve-ci-base.sh`，① 与 ①d 共用，禁两处漂移）；
  本地自检前先 `git fetch`，并把 merge-base sha 打进输出（可对账）。

## 坑 13：`grep -r` 与 `git grep` 的扫描面不同（untracked / 已删）

- **现象**：`grep -r` 把 untracked 临时文件、备份文件也算进扫描面 ⇒ 本地红、CI 绿；
  `git grep` 只扫 tracked ⇒ 新增未 add 的文件在提交前**判据看不见** ⇒ 提交后 CI 才红（或本地「绿」是空的）。
- **根因**：两个工具的正源不同（工作树 vs 索引/树）。判据没声明自己看哪一面。
- **判据写法**：头注里写明扫描面（`工作树` / `暂存区` / `base..HEAD`）；提交端判据用
  `git diff --cached --name-only`，CI 端用 `git diff <base>...HEAD`；两者口径差异写进「已知限制」，
  并用一条「untracked 不算」/「暂存区算」的夹具钉死。

---

## 附：本清单的使用顺序

1. 动手写判据前：把上面 13 条**逐条**对照自己的判据，命中哪条就照「判据写法」写。
2. 写完判据后：`bash -n` → 自检入口（若有）→ **配对测试的改坏即红**（把关键分支改坏，测试必须变红）。
3. 进 CI 前：`SYNO_CI=1` 跑一遍 ＋ 在 Windows 与 posix 各跑一遍（坑 1 只在一个平台暴露）。
4. 踩到新坑：按「现象 → 根因 → 判据写法」三行追加到本文件末尾，**不要只写在 PR 评论里**（评论三个月后没人看）。
