---
状态: implemented
日期: 2026-09-28
决策: 提交链路三处「静默猜测/失真记录」收口——brief 并列 fail-closed、同号 brief 检测、软失败放行记真实状态；并把 CT-A1 夹具接入 CI
理由: 三处都是「门禁看着在工作、实际给出错误答案」的形态：① resolver 同层并列静默取首位（陈旧 brief 可恒胜且零告警，D718 型误伤复发面）；② checker 只查 5 类占用标签、brief 明确不参与发号 ⇒ D1023 三份同号在 origin/main 既成事实且**无任何检测面**；③ 账本把 pre-commit exit=1 被 wrapper 软化放行的那次提交记成纯 PASS（真实状态只在旁路日志）。另有接线缺口：CT-A1 夹具所在测试文件改前在 ci.yml 零登记 ⇒ 夹具"只在本地跑过、CI 永不执行"。
---

# CT 提交链路收口（D1032 / task-2）

## 一句话

把「歧义就猜、失真就记、测试不跑」三件事各自堵死：并列 brief 拒绝猜测、同号 brief 必须点名、软失败放行必须记真实状态，并把判别性夹具真的接进 CI。

## 问题（触发场景）

1. **CT-A1**：`scripts/workflow/resolve-commit-brief.sh:210-232`——认领计数并列时 `top.sort(...) + print(top[0])`，
   由字典序裁决（陈旧 brief 可恒胜），**且零告警**。认领制是「提交引用哪份 brief」的唯一物理依据。
2. **CT-B**：`scripts/control-tower/check-name-allocation.sh` 的占用判定委派 `alloc-task-id.sh --check-id`，
   标签仅 5 类（`alloc-task-id.sh:252`「唯一占用表 = task-state/D*.json；brief 不参与发号」）
   ⇒ 建 brief 复用已占号无检测面。实证：`origin/main` 上 D1023 有**三份** brief
   （`2026-09-26-…commit-msg-decisions` / `2026-09-26-…ci-docsonly-whitelist` / `2026-09-27-…skill-lessons-ref`）。
3. **L-BYPASS-LEDGER**：`.git/hooks/pre-commit` wrapper（`install-hooks.sh` 生成）在 pre-commit **exit≠0** 时
   写 `gate-soft-warnings.log` 的 `GATE_FAIL_SOFT | exit=N` 后**仍放行**提交；`scripts/hooks/post-commit.sh`
   随后把该提交登记为 `COMMITTED | pre-commit PASS (hook 层登记)` ⇒ 账本与真实状态矛盾（审计不可复算门禁健康度）。
4. **simulate-ci 诊断黑洞**：失败断言只给 `grep -E "❌|FAIL" | cut -c1-400`（不含标记的内层输出全灭 + 截断 400 字符）。
5. **接线缺口**：`tests/control-tower/resolve-commit-brief.test.sh` 在 `ci.yml` 的 CT job **显式清单**里零登记
   （无 glob 兜底）⇒ 新夹具不会在 CI 跑。

## 决定

- **CT-A1**：锚点分层（强 → 弱）后**仍并列 ⇒ fail-closed**：stdout 不输出任何路径（保持「stdout 只走路径」契约，
  避免 `staging_guard.py` 把标记当路径），诊断走 stderr，`exit 2`（三态：未能得出确定结论）。
- **CT-B**：新增 `brief-dup` 检测面。任务身份 = 文件名**日期前缀后的第一个 D#**（`YYYY-MM-DD[-_ ]D###…`），
  slug 里的交叉引用（`-FIX-D572-`）不算身份；同号 ≥2 份 ⇒ rc=1 + 点名全部路径 + `--json` 同步可见。
- **CT-2（账本）**：`post-commit.sh` 只**增**一条分支——读到本轮 pre-commit 的 `GATE_FAIL_SOFT` 证据时，
  写 `COMMITTED | pre-commit DEGRADED-PASS (soft-fail allowed ts=… exit=…)`；**正常 PASS 行文本一字不动**
  （`post-commit-marker.test.sh:71` / `clone-shadow-commit.test.sh:64` 的硬断言保持绿）。
  配对依据 = 文件写入序（wrapper 先 append 证据行、后写 marker ⇒ mtime 同轮相差 <1s）+「该证据行 ts 已被账本消费」。
  失效方向为「多标 DEGRADED」，不误标 PASS。
- **simulate-ci**：断言信息**完整透传**内层输出（上限 `SYNO_SIM_INNER_MAX`，默认 20000；超限显式标注），红桩分支同样透传。
- **接线**：`ci.yml` CT 清单补 `tests/control-tower/resolve-commit-brief.test.sh` 一行。

## 判据（每条都由「改坏即红」夹具证明，删掉修复即变红）

| 交付 | 夹具 | 改后 | 红证 |
|------|------|------|------|
| CT-A1 | 两 brief 同数无锚点 | rc=2 + 点名两条 | 删 fail-closed 分支 → 37 通过变 33/4（红点恰在场景 12） |
| CT-B | 两份同 D# brief / 单份 / slug 交叉引用 | 两份 rc=1 点名；单份 rc=0 | 删 brief-dup 段 → 27 通过变 24/3 |
| CT-2 | 软失败放行 + 随后干净提交 | DEGRADED-PASS(ts/exit)，干净提交仍纯 PASS | 置空 `_softfail_state` → 15 通过变 13/2 |
| simulate-ci | 内层 >400 字符且不含 ❌/FAIL | 透传 2340 字符含末行标记（旧实现仅 98 字符） | 三条互斥断言（标记/尾部/长度） |

## 考虑过的其他方案

1. **CT-2 改 `install-hooks.sh` 的 wrapper 产出新状态标记** —— 否决（本轮）：CTO 只批 `post-commit.sh`；实测 wrapper 已写
   `GATE_FAIL_SOFT`，只需 post-commit 读，零字节改 wrapper 更小连带。
2. **CT-2 只在 synova-commit 侧记真状态** —— 否决：写假 PASS 行的是 `post-commit.sh:100`，只改 synova-commit 会让假 PASS 行继续存在。
3. **CT-B 用「文件名里任意 D#」判定** —— 否决：实测会把 `2026-09-05-D578-FIX-D572-…` 这类交叉引用误判为 D572 的 brief（存量 42 个 D# 会被误报，锚定后 30 个）。
4. **CT-A1 在 stdout 输出机器标记** —— 否决：`staging_guard.py:79` 取 stdout 首行当路径，标记会被当路径读；改走 stderr。

## 后果 / 遗留

- 同号检测对**同一任务拆多份 brief**（本仓既有实践）也会点名：存量 30 个 D#（如 D593 ×5、D964 ×5）⇒ 需 CTO 决定数据侧收口或规则豁免（禁一次性特例）。
- CT-A1 的 `exit 2` 在既有调用方（`pre-commit-check.sh:772` 等 `2>/dev/null || true`）被当作「无 brief」跳过 ⇒ 只保证「绝不给出错误 brief」，链内硬阻断需另立项改调用方。
- 既有红（与本卡无关，已用纯净基线对照证明）：`tests/control-tower/precommit-groups-injection.test.sh` g12 `NOT_RED`，连带使 `simulate-ci.test.sh` 的「绿桩→exit 0」用例红。
- 证据件：`docs/synova/product-lines/evidence/CT2-门禁流程修复-证据.md`、`CT2-M6收尾-自验结论与遗留清单.md`。

## 取代

无。（同时把 `tests/control-tower/resolve-commit-brief.test.sh` 从「CI 零登记」接上——见后果节遗留。）
