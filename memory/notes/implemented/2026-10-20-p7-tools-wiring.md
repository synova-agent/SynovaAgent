# 2026-10-20 · P7 两件工具接进根件（四条件机器凭证 / 三信号机器算）

> **类型**：implemented ｜ **裁定**：裁 223 ｜ **触发**：CTO 验收 P7 时发现「工具没接线」

## 发现（验收时现场核的，不是听 P7 说）

P7 交付了两件工具，自检全绿：
- `scripts/control-tower/check-merge-conditions.sh`（1351 行，selfcheck 13/13）
- `scripts/control-tower/probe-line-signals.ts`（1831 行，selfcheck 8/8）

**但接线核验（铁律 0-2：grep 零结果 = 未完成）**：
```
check-merge-conditions.sh  调用方 = 自己 + 1 个 review JSON      ← 无 pre-commit / CI / hook
probe-line-signals.ts      调用方 = 自己 + 自己的测试
引用处 = 只有 agents/P7-*/AGENTS.md + P7 的 handbook 派单件
        .dsh/skills/        零命中
        根 AGENTS.md        零命中
        其他 9 个包守则      零命中
```
⇒ **工具做出来了，只有 P7 知道有这东西。** 而"四条件"和"三信号"是**全线自合并/全线回执**的公共判据。

## 改了什么（AGENTS.md §12，唯一一处）

```
· 四条件自合 ⇒ 加【机器凭证】check-merge-conditions.sh --pr <N>
  末行 CAN-自合并 / NO: <条件名>；三态 0/1/2（2≠通过）⇒ 贴进 PR 正文
· 加 ② 共享追加白名单说明（都追加到同一登记表 ⇒ 仍算不重叠）
· 回执三信号 ⇒ 加【机器算】probe-line-signals.ts --line <线> / --all
  含 token 三级查找 + 无 tsx 时的 node fallback
· 头部尺寸同步（rebase 后真值见文末补记）
```

## 为什么放根件而不是新技能
根 `AGENTS.md` **一定注入**（路径链最外层）⇒ 10 个 L1 **都会看到**。
新建 skill 只在被调用时加载 ⇒ 没人知道有这个 skill ⇒ 等于没接。

## 验证
- 两个工具的 CLI 我现场跑过（`--help` / `--selfcheck`），命令不是猜的
- `check-doc-truth.sh` 全绿 ｜ ①d 6 通过 0 失败
- 文件尺寸与最坏账按 rebase 后真值见文末补记

## rebase 补记（2026-10-22 · P7）

本件随 PR #661 rebase 到 `local-main`（#798 根件减肥 / #777 §15 评审分层已入主线）后补充：
- **冲突解法**：根件头部取主线结构（保留 `#798` 预算警戒行与 §15），只并入本 PR 的 §12「机器凭证／机器算」五行；**不新增第二口径**。
- **`.gitignore` hunk 已在上游**（主线第 98 行已有 `.claude/mirror-sync.pending`）⇒ rebase 时丢弃，无冲突。
- **头部真值（实测 `wc -c`）**：本件 **21.8 KB（22,326 B）**；理论最坏账 **65,334 B** ≤ 65,536（余量 **202 B**）；实战占用 = 本件 + 域守则实际 19,710 = **42,036 B**。
- **§12 实际并入内容**（5 行）：四条件 ⇒ `check-merge-conditions.sh --pr <N>` 末行 `CAN-自合并`/`NO:`、三态 0/1/2、② 共享追加白名单；三信号 ⇒ `probe-line-signals.ts --line <线|--all>`（末行 `LINE-SIGNALS`，无 tsx 用 `node --experimental-strip-types`）。


## 已知限制
- 根件只放**指针**，不放工具内部判据逻辑（避免双真源）
- 各包守则（10 份）未同步引用 —— 若 L1 只读包守则不读根件会漏；后续可考虑在包守则 §八 加一行指针
