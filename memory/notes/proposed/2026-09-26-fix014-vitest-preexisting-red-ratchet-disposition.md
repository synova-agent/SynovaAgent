# 决策 Note — FIX-014：main `Vitest (2/2)` 既有红登记补 D954 `disposition_due`（含责任人）

- 状态: proposed（待独立审计后 git mv 到 implemented/）
- 日期: 2026-09-26
- 卡: FIX-014（台账 `docs/synova/coordination/问题修复台-20260925.md`；FIX-### 不占 D# 号段）
- 决策: 既有红棘轮条目 `Vitest (2/2)` / `Vitest (1/2)` **必须补 `disposition_due` + 具名 owner**；登记**只加不删**，且**不改变红的性质**（基线命中 ≠ 绿）。

## 依据（可核）

- 台账判据（FIX-014）：另开卡 + 按 D954 棘轮登记（含 `disposition_due` + 责任人）；**不得豁免计绿**。
- 实测缺口：main 版 `scripts/control-tower/ci-red-baseline.txt` 数据行 6 条，`grep -c disposition_due` = **0**；`Vitest (2/2)` `owner=UNASSIGNED`。
- 消费实现：`scripts/control-tower/check-gate-integrity.sh:749` 取 `disposition_due`，`:757-765` 逾期判红；`:678` 默认棘轮路径（`SYNO_CI_RED_BASELINE` 为注入缝）。
- 上游 K3 定罪与 D954 背景：`docs/synova/audit-reports/2026-09-24-K3批次4-PR745-746-747.md:161`（disposition_due 零消费 → SLA 是文档承诺不是门禁）；`memory/notes/proposed/2026-09-25-d954-ci-reds-base-ref.md`（D954 补消费）。
- 复现实证：main push run 36146340288 @ ef299746，`Vitest (2/2)` = failure（job 108108419949，`tests/l3/graphbridge-wiring.test.ts:79`）；父提交 0f709900（run 36129254913）同用例同 file:line 亦 failure ⇒ **既存红，非本推送引入**。

## 关键设计决定

1. **只加不删**：既有 6 条基线一条不删、不放宽；本次仅两行补键 + 一行表头注释（棘轮只允许收紧）。
2. **加严项而非替代项**：`disposition_due` 在期放行、逾期判红；键缺失按 D954 明文**不回溯** ⇒ `expires` 仍是兜底硬门。（删键不红属既有语义，如实登记为未清项，不在本卡改判据。）
3. **登记 ≠ 计绿**：C 段只输出「基线命中 N 项」；`Vitest (2/2)` job 仍真 exit 1、run 全站仍 failure。PR 侧 `Vitest (${{ matrix.shard }})` = skipped 记「未执行」，**不得计绿**。
4. **确定性证据**：`owner` 由 `UNASSIGNED` 改为台账属主 `Mac-小队`；`disposition_due` 与 `expires` 对齐（2026-10-24 / 2026-10-25），使「处置期限」成为可被 C 段物理判红的日期，而非文档承诺。
5. **不改判据语义**：分片名归一化、D721 放行分支在 main push 不可达（ci.yml）——两处均属判据/CI 变更，只登记事实，另立卡，本卡不动。

## 参考系

第一性原理（登记表的价值 = 有期限的追责，而非无期限豁免）＋ Anthropic 工程基线（失败可见 + 到期可判 + 改名即红）＋ 仓内先例（D954 夹具 D4 已断言「逾期 → exit 1；未到期 rc=0；无键不回溯」）→ 结论：补键 + 具名 owner + 只加不删 + 登记不改红。

## 夹具（改坏即红，可复跑）

```
bash scripts/control-tower/check-gate-integrity.sh --patterns-only --root "$PWD" \
  --base-ref origin/main --ci-reds /tmp/fix014-checkruns.json
(a) 在期 → GATE-INTEGRITY: OK (exit 0)
(b) disposition_due 改过去日期 → VIOLATION: CI 红处置逾期 (exit 1)
(c) 删除 Vitest (2/2) 条目 → VIOLATION: 未登记 CI 失败 (exit 1)
```
原始输出：`docs/synova/product-lines/evidence/FIX-014-20260926.md` §4。
