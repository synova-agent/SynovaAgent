# K12-ENG P0-1 整改：删除类判据的复活守卫（K3 终审 P0-1）

- **状态**: implemented（2026-11-02）
- **任务**: #1271 K12-ENG；关联 #466 / #200；审计：K3 终审 P0-1
- **问题**：`extensions/adapters/{feishu,nemoclaw}/adapter.ts` 删除后，耦合门禁的 CC-BASELINE 仍登记其
  CC1 存量（t=1 v=1），而 notifications 4 个 adapter.ts 同样已删仍留基线条目 ⇒ **放回死码被棘轮吸收
  （RC=0）**；"零 .ts" 仅是一次性 `git ls-tree` 快照，无 runner。
- **决策**：下调这 6 条已失效的 CC1 存量基线（存量 221→215，只减不增），使**复活即 NEW**：
  `SYNO_CI=1 bash scripts/check-content-coupling.sh` ⇒ exit 1；pre-commit 的 CC 接入块按"新增 N>0"报出。
  判据语义零改动（不改 CC1–CC4，不改退出码契约；只清已删文件的历史基线）。
- **证据**：放回 `extensions/adapters/feishu/adapter.ts`（原死码）⇒ `SYNO_CI=1` 下 CC1 NEW=1、RC=1；
  删除后 ⇒ RC=0、`CONTENT-COUPLING: OK（新增 0）`。
- **回滚**：恢复被删的 6 行基线（单点段）＋删本豁免文件/登记。

## 追加：字面「零 .ts 常驻守卫」（K3 建议原文）
- 在 `check-content-coupling.sh` 的 bash 入口加 **CC0**：`extensions/adapters/**/*.ts` 存在即违规
  （本地只报数、CI(SYNO_CI=1)/STRICT 判红）；`--print-baseline` 跳过。
- 证据：放回 `extensions/adapters/feishu/adapter.ts` ⇒ 本地 `新增 1`（rc=0，按 local 契约）；
  `SYNO_CI=1` ⇒ **CC0 NEW=1 / `CONTENT-COUPLING: VIOLATION new=1` / rc=1**；常态 ⇒ 新增 0/rc=0。
