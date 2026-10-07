# Task Brief — docs-only 判定：push 下 base 解析 + 空变更集第三态（D1238 / 卡 #1323）

> 编号 **D1238**（用前三重核验：gate 免费 / main 零文件 / issue 标题零命中；D1236、D1237 的 issue 命中
> 分别是**本卡自己**的旧号与 Lead 新立的 D1237 卡）
> 卡 = **#1323**（Lead 原写 #1236，已更正留痕）· 属**门禁语义变更** ⇒ 编入 **K3 批六**，作者不自行合并。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（CI 门禁）。`ci.yml` 的 `Detect docs-only change (D515)` 判定：纯文档变更 ⇒ 早退（省 CI 墙钟）。
### b) 文件审计（实跑）
- 病灶：`elif git diff --name-only origin/main...HEAD | grep -qvE "$DS_RE"; then` ⇒ **push 到 main** 时
  `HEAD == origin/main` ⇒ 变更集**空** ⇒ `grep -qvE` 无行命中**返 1** ⇒ 落 `else` ⇒ `docs_only=true`
  ⇒ 该 job 早退。
- **结构事实（与派单前提不同，实测）**：该判定块在 `ci.yml` 内**内联 9 份**（9 个 job 各一 step，
  **逐字节同源** sha `3836d02b73a7`）⇒ 「改一处源」不成立 ⇒ 本次 **9 份同改**。
- 代理证据：近 5 个 main run 的 `GATE-INTEGRITY-CHECK` 出现次数 = `0,0,0,0,2` ⇒ **间歇性失明**
  （取决于 runner 内 `origin/main` 是否已被 fetch 成推送后的值）⇒ 这正是它长期不被发现的原因。
### c) 决策
`s/dist to base`：push ⇒ `github.event.before`；PR/merge_group ⇒ `origin/<base_ref>`；空集 ⇒ 显式全量。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **引用纪律**：`:74` 原注释**已写下**该行为（「空变更集 ⇒ 仍按 docs-only（原语义保留）」）
  ⇒ 这是**已知行为 + 其分支后果从未被检验**，**不是**"漏了个边界" ⇒ 定级应更高。
- **不对称是修法论据**：同段对「判据不可读」与「origin/main 不可解析」**都已** fail-closed，
  唯独空集没有 ⇒ 修它 = **补齐既有原则**，方向与那两处一致（不可判 ⇒ 全量，绝不误跳）。
- **铁律 11**：空集 ≠ 纯文档 ⇒ 必须显式第三态（`::warning` + 非 docs-only），禁静默归因。
- **D1206 同口径**：结构断言要防"日后改回去无人知"⇒ 夹具必须断言 push 下 base **不是** origin/main。
参考：第一性原理（不可判 ⇒ 保守侧）+ 同段既有两处 fail-safe 范式 ⇒ 同向补齐。

## Q2: 范围 — 正确的最简方案
做什么：
- .github/workflows/ci.yml
- tests/control-tower/docsonly-diff-base.test.sh
- .claude/task-briefs/2026-10-08-D1238-docsonly-empty-diff.md
- memory/notes/proposed/2026-10-08-d1238-docsonly-empty-diff.md
- task-state/D1238.json

改动内容：
1. **9 份同改**：base 解析（push ⇒ `GITHUB_EVENT_BEFORE`；全零 SHA/不可解析 ⇒ 显式全量）+
   **保留**原 `origin/main` fail-safe 行（D1023 守卫按该字面量计数 9，保留即不破该守卫）+
   新增 `$DS_BASE` fail-safe + **空变更集第三态**（`::warning` + `docs_only=false`）；
2. 头部注释更正（`:74` 那条失效注释 ⇒ 记录新语义 + 9 副本结构留痕）；
3. **新夹具**（新文件，避免与在飞 #1168 的 `ci-signal-classify.test.sh` 写集重叠）：
   **从 ci.yml 提取判定块原文执行**（零副本），含先红后绿 / 反例 / 全零边界 / 结构断言 / PR 回归。

不做什么（含文件路径）：
- **不改任何 job `name:`**（12 必需 context 的唯一产出者 —— 红线；已用 ruby 逐条比对证实一致）
- 不改 `.github/ci-criteria.txt` 的 `DOCSONLY_WHITELIST_RE`（判据单源，与本次 base 解析无关）
- 不改 `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh`（**线 B 写集**；本次靠"保留
  原 fail-safe 字面量"使其继续 30/30 通过，未触碰）
- 不改 `tests/control-tower/ci-signal-classify.test.sh`（**线 B 写集**；实测仍 87/87）
- 不做 9 副本去重（结构调整，属另卡）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/docsonly-diff-base.test.sh`
处理：沙箱三提交（docs / +code / +docs-only）+ 受控 `GITHUB_EVENT_NAME`/`GITHUB_EVENT_BEFORE`/`GITHUB_OUTPUT`
结果：10/10 通过；其中"先红"用 `origin/main` 版块**复现** docs_only=true，"后绿"用本分支块得 false。

## 架构层: 治理面（.github/workflows + tests/control-tower）
#CRITERIA: D

## 变更点 / 旧口径 vs 新口径 / 回滚（供 K3 批六）
| 项 | 旧口径 | 新口径 |
|---|---|---|
| push 事件 base | `origin/main`（⇒ 与 HEAD 同一提交 ⇒ 空集 ⇒ **早退**） | `github.event.before`（推送前提交） |
| base 全零 SHA | 未覆盖 | **显式全量** + 告警 |
| base 不可解析 | 覆盖（origin/main 版，**保留**）+ 新增 `$DS_BASE` 版 | **显式全量** + 告警 |
| 空变更集 | **静默归为 docs-only**（早退） | **显式第三态**：`::warning` + `docs_only=false`（全量） |
| PR/merge_group | `origin/<base_ref>` | **不变**（夹具 E 回归钉住） |
| 真 docs-only | 早退 | **仍早退**（夹具 B 反例钉住） |
| 回滚 | — | 单文件：9 份块改回 `elif git diff --name-only origin/main...HEAD \| grep -qvE "$DS_RE"` |

## Done 标准
- [ ] verify: `bash tests/control-tower/docsonly-diff-base.test.sh` ⇒ `10 通过, 0 失败`
- [ ] verify: `bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` ⇒ `RESULT: 30 PASS / 0 FAIL`
- [ ] verify: `ruby -ryaml` 比对 ⇒ 13 个 job 的 id+name 与 origin/main **逐条一致**
- [ ] verify: `bash tests/control-tower/ci-signal-classify.test.sh` ⇒ `87 通过, 0 失败`
- [ ] verify: `bash scripts/pre-commit-check.sh` ⇒ 13 组通过；`scan-fullwidth-vars.test.sh` ⇒ 棘轮 0
- [ ] verify（合并后）: main 上 `GATE-INTEGRITY-CHECK` 出现次数 **> 0**（正向判据）
