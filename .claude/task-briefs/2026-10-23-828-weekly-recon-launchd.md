# Task Brief: P6 · #828 — 周对账 launchd 定时接线（安装器＋配对测试＋豁免/登记 · 单卡）

#CRITERIA: A

## Q0: 定位（项目拼图 + 文件审计）
- **问题**：#808 已交付周对账脚本（`weekly-recon.sh`，五指标快照→基线比对→差异进唯一对账卡），但**无触发器**——只能人工跑，「不再人工盘点」只完成一半；既有 6 件 `~/Library/LaunchAgents/com.synova.*.plist` 全手工铺，无 install/verify 工具（`scripts/backup/install-backup-launchd.sh` 只有 install、无 verify、无测试）。
- **本卡**：#828（P6 · 治理线·运维接线件，非探针语义）。唯一契约 `.handbook/派单件/2026-10-22-规格-828-周对账定时接线.md` §4（判据 1/2/3/4/5/6）；编码指令 `.handbook/派单件/编码指令-828-周对账定时接线-2026-10-22.md`。
- **动到的件（逐文件）**：`scripts/control-tower/weekly-recon-launchd.sh`（新：install/verify/uninstall 三态安装器）；`tests/control-tower/weekly-recon-launchd.test.sh`（新：T1~T9 判据测试，HOME 隔离＋路径注入假 launchctl）；`tests/control-tower/AGENTS.md`（改：加 1 行报备）；`gate-exemptions/2026-10-22-p6-828-weekly-recon-launchd.md`（新：受保护路径豁免，5 行含自覆盖）；`docs/authority/DOCS-REGISTRY.yaml`（改：登记 DOC-0240）；`memory/notes/implemented/2026-10-22-828-weekly-recon-launchd.md`（新：铁律 49 四态 Note）；`.claude/claims/828.yaml`（新：claim 声明载体）；本件（声明件）。
- **现状实测**：`bash tests/control-tower/weekly-recon-launchd.test.sh` ⇒ `PASS=81 FAIL=0 / ALL PASS（T1–T9）`；既有 `bash tests/control-tower/weekly-recon.test.sh` ⇒ `PASS=94 FAIL=0`（无回归；本体 `weekly-recon.sh` 零改动）。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）
- **复用范式（禁重复建设）**：plist 结构照抄 `~/Library/LaunchAgents/com.synova.weekly-selfcheck.plist`（Weekday 0 → 1，时刻 08:00）；三态退出码（`scripts/control-tower/AGENTS.md`＋根件 §8）；`@降级`＋`SYNO_GATE_DEGRADED_LOG` JSONL（`check-gate-protection.sh` 同形）；UTF-8 强制（D732/D313 M5）；受保护路径豁免三段式（`gate-exemptions/README.md`＋#623 自覆盖）。
- **历史教训**：dual-repo-sync `on.schedule`「配了≠在跑」（默认分支≠local-main ⇒ 定时键从不登记，本卡不用 Gitea schedule）；a9345d6a5 灌板通道自始被跳过 ⇒ 判据必须有物理证据（verify 输出＋launchd 日志）；本体零改动（#808 契约冻结）⇒ 只接线不动 `weekly-recon.sh`。
- **红队**：①「配了＝在跑」是 a9345d6a5＋dual-repo-sync 双教训 ⇒ 判据②要两个自动周节实证（2026-10-26 W44／2026-11-02 W45），本批只交代码段；②全新安装无日志会让 `verify` 假红 ⇒ 设计 `LOG_FRESH(none-yet)` 宽限（plist mtime 8 天内）；③DSH shell 内 `launchctl list` 可能空 ⇒ `launchctl print` 兜底判注册态；④测试禁触真 launchd ⇒ HOME 重定向＋PATH 注入假 `launchctl`。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/control-tower/weekly-recon-launchd.sh
- tests/control-tower/weekly-recon-launchd.test.sh
- tests/control-tower/AGENTS.md
- gate-exemptions/2026-10-22-p6-828-weekly-recon-launchd.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/implemented/2026-10-22-828-weekly-recon-launchd.md
- .claude/claims/828.yaml
- .claude/task-briefs/2026-10-23-828-weekly-recon-launchd.md
不做什么：
- scripts/control-tower/weekly-recon.sh — 本体零改动（判据 4 机器验 diff）
- scripts/audit/
- .gitea/workflows/
- scripts/pre-commit-check.sh
- scripts/backup/install-backup-launchd.sh — 只借 plist 范式，不改
- src/
- extensions/
- package.json
- /Users/wane/SynovaAgent — 主树禁写

## Q3: 验收（入口 → 交互 → 结果）
- **入口**：`bash scripts/control-tower/weekly-recon-launchd.sh install|verify|uninstall`（Mac-only；生产默认 `~/Library/LaunchAgents/com.synova.weekly-recon.plist`、日志 `/tmp/synova-recon-launchd.log`）；测试入口 `bash tests/control-tower/weekly-recon-launchd.test.sh`（HOME/$TMP 隔离＋PATH 注入假 launchctl，**绝不触系统 launchd**）。
- **交互**：install 用 heredoc 生成确定性 plist（只含 Label／ProgramArguments=`/bin/bash`＋本体绝对路径／StartCalendarInterval Weekday=1,Hour=8,Minute=0／日志路径／RunAtLoad=false；无 token、无 EnvironmentVariables）→ `launchctl bootstrap gui/$(id -u)`；二跑 `cmp` 字节相同且已注册 ⇒ `NOOP already-installed`＋`sha256=`；相同但未注册 ⇒ 只补 bootstrap 不重写；不同 ⇒ 先 bootout 再落新 plist＋bootstrap。verify 逐项 `PLIST_OK`/`LAUNCHCTL_OK`/`LOG_FRESH(<8d|none-yet)`，缺件 exit 1，plutil 解析失败/launchctl 异常 ⇒ `degraded: code=`＋exit 2。uninstall 幂等（已注册 bootout＋删 plist；未安装 ⇒ `NOOP not-installed`）。
- **结果**：测试 ALL PASS（T1 install 内容/键集合/无凭据、T2 幂等 sha256 不变＋同字节未注册不重写、T3 verify 三项、T4 反例 b 摘 StartCalendarInterval 必红且可恢复、T5 反例 a uninstall 后 verify exit 1＋幂等、T6 日志新鲜度三态、T7 launchctl 不可用/非 Darwin ⇒ exit 2、T8 WIRE、T9 契约头＋`bash -n`）；三态退出码 0/1/2。

## Q4 契约与测试
- 输入：子命令 `install|verify|uninstall`（恰好 1 个；其它/缺参/多参 ⇒ usage＋exit 2 `E_USAGE`）；注入缝（生产有默认）`SYNO_LAUNCHAGENTS_DIR`／`SYNO_LAUNCHCTL`（缺省裸名，令 PATH 假件生效）／`SYNO_RECON_LOG`／`SYNO_RECON_SH`（变异测试在 /tmp 副本锚真本体）／`SYNO_GATE_DEGRADED_LOG`。
- 输出：install `INSTALLED|REINSTALLED|BOOTSTRAPPED`＋`sha256=`／`NOOP already-installed`；verify 逐项 `PLIST_OK|PLIST_BAD(...)|LAUNCHCTL_OK|LAUNCHCTL_UNREGISTERED`＋`LOG_FRESH(<8d|none-yet)|LOG_STALE(>8d|absent)`；uninstall `REMOVED`／`NOOP not-installed`。
- 退出码三态：0 = 成功；1 = 真红（verify 缺件／bootstrap 被拒 `E_BOOTSTRAP_REJECTED`）；2 = 自身/环境失败（非 Darwin／HOME 空／launchctl·plutil 不可用／plist 写失败或解析失败／launchctl 异常），全部带 `code=`（typed error 表见脚本头注）。
- 降级：stderr `degraded: code=<CODE> <原因>` ＋ `SYNO_GATE_DEGRADED_LOG` JSONL（time/component/code/phase/retryable）；缺件（业务真红）不走 degraded。
- 测试：三态（0=ALL PASS／1=断言失败／2=环境失败）＋`bash -n`＋契约头要素断言；判别力＝反例 b/c 与「同字节未注册不重写」；变异注入缝 `SYNO_RECON_LAUNCHD_INSTALLER`。

## 本任务在哪一层
治理线·运维接线（P6 包）；不改产品架构层（不涉宪章 ⓪①②③④⑤⑥／−1 运行时；只动 `scripts/control-tower/` 治理面＋`tests/control-tower/` 测试域＋`docs/authority/` 登记＋仓外 launchd 用户域）。

## Done 标准（至少一条可验证）
- [x] 配对判据测试全绿（T1~T9，含反例 a/b/c 与 exit 2 判别）→ `verify: bash tests/control-tower/weekly-recon-launchd.test.sh`
- [x] 既有周对账测试无回归 → `verify: bash tests/control-tower/weekly-recon.test.sh`
- [x] 受保护路径豁免 5 条全合规（含自覆盖）→ `verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/local-main`
- [x] 新文档已登记台账（DOC-0240）→ `verify: bash scripts/doc-system/doc-registry-gate.sh`
- [x] WIRE CHECK 非零（本测试＋报备行＋安装器）→ `verify: grep -rn "weekly-recon-launchd" tests/ scripts/`
- [x] 写集逐文件对账（本体零改动）→ `verify: git diff --name-only gitea/local-main..HEAD`
- [x] 12 组提交端门禁通过 → `verify: env -u SYNO_CLAIM_V2 bash scripts/pre-commit-check.sh`
- [x] brief 可被同源解析器解析 → `verify: bash scripts/workflow/check-brief-parseable.sh .claude/task-briefs/2026-10-23-828-weekly-recon-launchd.md`
