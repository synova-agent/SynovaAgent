---
状态: implemented
日期: 2026-10-22
任务: "#828 周对账定时接线（launchd 安装器，本体零改动）"
决策: 新增 scripts/control-tower/weekly-recon-launchd.sh 三态安装器（install/verify/uninstall，幂等 cmp＋plist 必需键值校验＋日志新鲜度判别）＋配对测试 tests/control-tower/weekly-recon-launchd.test.sh；weekly-recon.sh 本体零改动。
理由: #808 已交付周对账脚本却无触发器（只能手动跑，「不再人工盘点」只完成一半）；既有 6 件 plist 全靠手工铺、无 install/verify 工具 ⇒ 补这个缺口（复用 weekly-selfcheck.plist 结构范式，Weekday 0→1）。
---

# 决策 Note — #828 周对账 launchd 定时接线

## 现状（接线前）
- `scripts/control-tower/weekly-recon.sh`（#808 merge 4b696c59c）契约完备：`--baseline/--dry-run`、三态退出码、单卡按 ISO 周滚动；但**无触发器** —— 只能人工跑，「不再人工大盘点」只完成一半。
- `~/Library/LaunchAgents/` 已有 6 件 synova.* plist（`weekly-selfcheck` 每周日 08:00 实跑），全部手工铺，无 install/verify 工具；`scripts/backup/install-backup-launchd.sh` 只 install，无 verify、无测试（本卡不复用其缺口，只借 plist 范式）。
- Gitea `on.schedule` 不可用：默认分支 ≠ local-main，定时键从不登记（dual-repo-sync 头注教训）。

## 决定
- 新建 `scripts/control-tower/weekly-recon-launchd.sh`：`install`（heredoc 生成 `~/Library/LaunchAgents/com.synova.weekly-recon.plist` → `launchctl bootstrap gui/$(id -u)`）/ `verify`（逐项 `PLIST_OK`/`LAUNCHCTL_OK`/`LOG_FRESH(...)`，缺件 exit 1）/ `uninstall`（幂等 bootout＋删 plist）；三态 0/1/2，降级走 `degraded: code=` ＋ `SYNO_GATE_DEGRADED_LOG` JSONL。
- plist 只含 Label、ProgramArguments（`/bin/bash` ＋ 本体绝对路径）、StartCalendarInterval（Weekday=1/Hour=8/Minute=0）、StandardOutPath/StandardErrorPath、RunAtLoad=false；**无 token/明文凭据、无 EnvironmentVariables**（token 只在执行时由 weekly-recon.sh 读）。
- 新建配对测试（HOME 重定向＋PATH 注入假 launchctl，*不触系统 launchd*）：T1 install 内容、T2 幂等（反例 c sha256 不变）、T3 verify 全过、T4 反例 b（摘 StartCalendarInterval ⇒ verify 必红）、T5 反例 a（uninstall 后 verify exit 1）、T6 日志新鲜度三态、T7 自身失败 exit 2、T8 WIRE、T9 契约头＋`bash -n`。
- 受保护路径走 `gate-exemptions/2026-10-22-p6-828-weekly-recon-launchd.md`（5 行三段式含自覆盖）＋ DOC-0240 登记；本体 `weekly-recon.sh` 零改动（判据 4 机器验 diff）。

## 依据
- #828 规格 §4（唯一判据准绳：判据 1 接线在位 / 2 连跑 2 周零人工 / 3 反例≥3 / 4 本体零改动 / 5 无回归 / 6 WIRE）；编码指令 §3.2 安装器契约、§3.3 测试隔离、§3.4 真安装只做一次。
- 既有约定复用：三态退出码（`scripts/control-tower/AGENTS.md`＋根件 §8）｜`@降级`＋`SYNO_GATE_DEGRADED_LOG` JSONL｜UTF-8 强制（D732/D313 M5）｜plist 结构范式（`com.synova.weekly-selfcheck.plist`）。
- 实测：`bash tests/control-tower/weekly-recon-launchd.test.sh` ⇒ ALL PASS（81 断言）；既有 `bash tests/control-tower/weekly-recon.test.sh` 全绿（无回归）。

## 生效时点
- 代码段合并后由 P6 在本机执行一次 `install` ＋ `verify`（真安装只做一次），原始输出贴 #828。
- 首个自动周节：**2026-10-26（W44）**；第二个：**2026-11-02（W45）** ⇒ 两节齐（判据 2）才收口卡，**卡不因代码合了就关**。

## 已知限制（Known Limitations）
- macOS-only（launchd 无跨平台等价物；**Win 不适用**）。
- launchd 给任务的 PATH 是最小 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`）⇒ 自动跑时 `weekly-recon.sh` 的 AUDIT 指标多为 `AUDIT=unavailable:0`（npm 不在 PATH）——**指标级缺失**，不改变 weekly-recon 退出码；人工跑（登录 shell）不受影响。
- DSH shell 内 `launchctl list <label>` 可能为空（rc 1）⇒ 安装器以 `launchctl print gui/<uid>/<label>` 兜底判注册态（两者皆败才判未注册）。
- 全新安装尚无日志 ⇒ `verify` 给 `LOG_FRESH(none-yet)` 宽限（plist mtime 8 天内），保判据①「install 后 verify exit 0」；首个周节后转 `LOG_FRESH(<8d>)`。
- `verify` 只判「安装态」，不判「周节是否进 #811」——后者是判据 2，归 #828 观察段＋独立复核；`plutil -extract` 需 macOS 10.12+。
