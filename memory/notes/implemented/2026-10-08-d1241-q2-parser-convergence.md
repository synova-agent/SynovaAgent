# D1241 · Q2 解析器口径收敛（去副本 + 显式化 + 措辞两分）—— #1308 / D-C ③ 收口

- 状态: implemented（门禁减法 v2.0 第 2 批 D-C「四解析器归一」最后一块主线；父卡 #1224，子卡 #1308）
- 决策人: Lead（line G / D-C ③ 派单）+ 本记录沉淀执行序与四处取舍
- 依据: #1308 现象实测（line D 首次提交被 commit-msg D328 **真阻断**并定位到代码）+
  `memory/notes/implemented/2026-10-07-gate-reduction-v2.md`（六方案之二「四解析器归一」）

## 病根（一句话）

Q2 条目写成「反引号包裹 / 行内尾随说明 / 通配符 / 全角分隔符」时，`parse_q2` 提取出的 token
经 `match_path`（`re.escape` 字面量 + `(^|/)pat$`）**恒不中** ⇒ 该 brief 认领数**恒 0 且静默** ⇒
同文件的另一条裸路径 brief **1:0** 胜出 ⇒ 提交端以「提交声明与暂存文件归属不一致 — 疑似并行劫持」
暴露 ⇒ **措辞把排查引偏**（#1308 实测成本 ≈ 一次提交往返）。

## 三处改动（执行序 A → B → C，不得调换）

| 步 | 文件 | 改法 | 判定影响 |
|---|---|---|---|
| **A 措辞两分** | `scripts/commit-msg-check.sh:157/166` | 确有认领 ∧ 双方都有声明 ∧ 不一致 ⇒ 「疑似并行劫持」；确有认领 ∧ **消息侧零声明** ⇒ 「认领解析失败（非劫持）」 | **退出码零变更**（两类都仍 exit 1） |
| **B 去内联副本** | `scripts/workflow/resolve-commit-brief.sh` | 删掉 ImportError 分支里的 30 行内联 `parse_q2`/`match_path` 副本 → 显式 `RESOLVER-DEGRADED` + `sys.exit(3)`；顺带修 `sys.path` 用 `$ROOT` 的老错（改用脚本兄弟目录 `PARSER_DIR_W`，否则沙箱/异仓库里 import 必失败 = 副本被静默启用） | 单源（副本缺 D543/D749/claim/告警） |
| **C 显式化** | `scripts/control-tower/brief_parser.py` | 新增 `q2_entry_hazard()` + `_q2_warn()`；`parse_q2(text, source=)` 命中形态 ⇒ stderr `Q2-PARSE-WARN: <brief>:<行号> 「原文」…原因…` | **输出/异常/退出码零变更**（告警不是判定） |
| **口径固化** | `.dsh/skills/brief-compose/SKILL.md` + `.claude/…`（同内容）+ `scripts/workflow/generate-task-brief.py` | 写入「Q2 条目 = 裸路径、独立成行」正/反例 + 自检命令 + 裁决关系 | 文档 |

## 四处取舍（写清，供 K3 复核）

1. **告警而非失败**：存量 brief 命中该形态 19/265（2026-10-08 实测，include 段）；判红属**判据变更**
   （须 K3→CTO）。本卡只做「静默 0 匹配 → 可见」的加法：形态、输出、判定三者全不变。
2. **半径 = include 段**：exclude 段**不查**。实测 exclude 条目 178/265 是散文式范围声明
   （「不改 any prose here」型），逐条告警 = 噪音淹没信号；且 exclude 不参与认领/身份裁决，
   不产生 #1308 型误导。代价：exclude 段的静默不可匹配仍无告警（列入 PR 例外清单）。
3. **stderr 而非 stdout**：`--q2-include` 的 stdout 是路径流（5 处消费），掺入告警会被当路径消费
   —— 比静默更坏。消费侧透传：`commit-msg-check.sh` 读 resolver stderr 里的 `Q2-PARSE-WARN:` 并打印，
   使「根因」与「结论」同屏。
4. **同数字典序可见化**：`RESOLVER-TIE:`（stderr）标记「认领数并列 ∧ 身份锚点全未命中 ⇒ 按字典序取」
   —— 只打标记，不改裁决（D718 记录的误伤源正是这条最弱裁决）。
5. **告警显示两档（降噪）**：提交端首次接通后实测 **103 条**告警（±1 天窗口内 27 个候选 brief）
   —— 逐条展开会把判决行淹掉（噪音→忽视→绕过）。故 `commit-msg-check.sh` 只对**本提交任务**
   的 brief（消息声明的号 / resolver 解析出的 brief）逐条展开，其余折叠为「另有 N 条 / 涉及 M 个
   brief + 自检命令」。「不静默」由计数满足，明细在 `brief_parser.py --q2-include <brief>` 自检。

## 回滚方式

- 三步各自独立可回滚：A = 还原两处 `echo` 分支；B = 恢复内联副本（并还原 `$ROOT` import）；
  C = 删 `q2_entry_hazard`/`_q2_warn` 调用（`Q2-PARSE-WARN` 前缀消失，消费侧 grep 自然为空）。
- 无 schema/接口/开关变更；`SYNO_CLAIM_V2` 未开（claim 迁移级开关不由本卡翻）。

## 证据

- 夹具: `tests/control-tower/q2-parse-warn.test.sh`（三样本 + 端到端 1:0 复现 + TIE + H 措辞两分
  + 变异体 M1「删告警必红」/ M2「措辞压回必红」+ 对照组 + 三条接线）
- 断言反转: `tests/control-tower/brief-parser-strip.test.sh`（原「副本同步」断言 → 「禁第二套实现」）
