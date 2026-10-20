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
· 头部尺寸同步 18.3 KB → 19.4 KB（19,867 B）；最坏账 62,875 ≤ 65,536
```

## 为什么放根件而不是新技能
根 `AGENTS.md` **一定注入**（路径链最外层）⇒ 10 个 L1 **都会看到**。
新建 skill 只在被调用时加载 ⇒ 没人知道有这个 skill ⇒ 等于没接。

## 验证
- 两个工具的 CLI 我现场跑过（`--help` / `--selfcheck`），命令不是猜的
- `check-doc-truth.sh` 全绿 ｜ ①d 6 通过 0 失败
- 文件 19,867 B ≤ 65,536；最坏账 62,875 ≤ 65,536

## 已知限制
- 根件只放**指针**，不放工具内部判据逻辑（避免双真源）
- 各包守则（10 份）未同步引用 —— 若 L1 只读包守则不读根件会漏；后续可考虑在包守则 §八 加一行指针
