# D1065 评估件：bypass.log merge=union 可合并性瓶颈 — 三方案评估

> 评估者: D1065 评估执行者（只读仓库 + /tmp，零仓库改动）｜2026-09-29｜基线 origin/main = c6787513
> 状态: **待 CTO 选型**（卡面流程：评估件先发 → CTO 选型 → 再实现）
> 派单前提实测：①main bypass.log 1925 行且持续增长 ②merge=union 在 .gitattributes:14 ③per-session 落点已存在（bypass-ledger.sh:11-24，D735 Stage 1，注入缝 SYNO_BYPASS_LEDGER_DIR/SYNO_BYPASS_SESSIONS_ROOT）

## 一、三条事实本机复现（/tmp 沙箱，原始输出摘录）

- **union 开 → 本机 clean**：`git merge-tree --write-tree` exit=0，featX/featY 两侧新增行并集齐全（4/4 行）
- **union 关（info/attributes 写 `-merge`）→ conflict**：exit=1，`CONFLICT (content): Merge conflict in .claude/bypass.log`，冲突列表唯一文件即它
- ⇒ 对照面成立：GitHub"合并后端尊重 union、可合并性计算不尊重"与本机行为自洽（可合并性走 -merge 口径即 dirty）
- 实况：`git log -p -- .claude/bypass.log | grep -c '^-20'` = **1109**——append-only 历史有违迹（D457 引入 union 前的手工解冲突丢行），佐证守恒判据必须可执行
- 更正：`.sessions/` 在 `.gitignore:86`（卡面写 :83，笔误）；git 内置 union driver 无需 install-hooks.sh:137-142 的注册（冗余保险）

## 二、读者清单（grep 实测 14 文件，方案 a 的切面图）

| 消费者 | 读哪个落点 | file:line |
|---|---|---|
| check-bypass-log.sh（D331 对账，pre-push 门禁 7）| **已接 bypass-ledger.sh sources（全源）** | check-bypass-log.sh:23-29；pre-push-check.sh:420-444 |
| post-commit.sh（写者）| **双写**：legacy+per-session | post-commit.sh:17-24 |
| Gatekeeper 熔断（24h≥3 硬阻断）| **仅 legacy** | pre-commit-check.sh:236-253,1059,1085-1086 |
| loop-context.sh | 仅 legacy | :85 |
| sop-gate.sh | git diff --quiet legacy | :71-75 |
| pre-push 逃生舱 | legacy（注入缝） | pre-push-check.sh:80-87 |
| 写集豁免 | 路径字面量 | declare-write-set.sh:48；check-pr-budget.sh:516 |
| fastlane | 单文件判据 | pre-commit-check.sh:355-383 |

## 三、方案评估表（摘要；全文判据见评估执行者报告）

| 方案 | 收益 | P0 风险 | 改动面 | 改坏即红判据（可执行） | 红线相容 |
|---|---|---|---|---|---|
| **a 追加面改 per-session + 合并期归并快照**（首选候选）| 根治 dirty；Stage 1 基建已铺一半 | **Gatekeeper 只读 legacy（pre-commit-check.sh:1085-1086）——切写不切读 = 熔断失明 = 实质放宽 bypass 检测**；须与写方切换同一 PR | 6-7 文件单域：post-commit.sh、pre-commit-check.sh、loop-context.sh:85、sop-gate.sh:71-75、synova-submit.sh:81-83、新增快照归并脚本 | `git log -p -- .claude/bypass.log \| grep -c '^-20'` 较基线 1109 增量=0；check-bypass-log.sh exit 0；注入缝判别夹具证熔断双源仍触发 | ✅（Gatekeeper 改双源=加固；check-pr-budget.sh 不碰本体）⚠️ pre-commit-check.sh 热点，需 CTO 排期 |
| **b bypass.log 退出 PR 内容面（CI 集中落账）** | 根治且仓库无高频文件 | 证据可丢失（.sessions 不进 git，机器丢失=断链）；时间线完整性降级（CI 时刻≠提交时刻）| 跨 CI/脚本/治理三域，超单域口径 | grep -c '^-20' 增量=0 + CI artifact HASH 全命中 | ⚠️ 守恒从"物理可验"退为"基建可活"，审计红线承受不起 |
| **c 合并助手 sync+push+等绿（缓解）** | 省人力；等待窗口可重叠并行 | 只治症状；与 D328 自动登记提交有交互面 | ≤2 文件 | dry-run：merge-tree 非 0 必须拒推（人造冲突分支判别）| ✅ 可作 a 的过渡止血 |

**推荐：a > c > b**；b 否决（守恒语义退化）。快照语义：per-session 账本为真相、主账本快照为纯并集投影（内容 ⊆ read 输出断言兜底），合并侧一次性归并（机器人/CTO session），写者不加。

## 四、第四建议（卡面未列）：可合并性本地预检门禁

把 CTO 实测②判据反转为 pre-push 前本地预检（实验 C 已证可复现 GitHub 口径）：
```bash
git fetch -q origin main && mb=$(git merge-base HEAD origin/main) && \
echo ".claude/bypass.log -merge" > .git/info/attributes && \
git merge-tree --write-tree "$mb" HEAD origin/main; rc=$?; rm .git/info/attributes; [ $rc -eq 0 ]
```
非 0 = "合并后将 dirty，先 sync main"——40 分钟失败反馈拉回本地秒级。改动 ≤1 文件（scripts/control-tower 域），可作方案 a 合入前独立止血件。

## 五、验收映射（落地后执行）

① 三条复现原始输出（上文§一 + CTO 侧 API 实测）② 本表 + 选型理由（待 CTO 填）③ 连续合并 ≥2 PR 无需为后者重推（两次 API 返回）④ 证据守恒 `wc -l ≥ 两侧新增之和` + `grep -c '^-20'` 增量=0 ⑤ GATE-INTEGRITY: OK
