# 决策 Note — FIX-006：取号 O(1)（消除字符串累加）+ 拒绝面使用读取面同源

- 状态: proposed（待独立复核后 git mv 到 implemented/）
- 日期: 2026-09-26
- 卡: 台账 FIX-006（同类第 3 次 🔴）｜分支 `fix/fix006-alloc-task-id`（base = `origin/main` @ `ef299746`）
- 决策: ① worktree task-state 扫描改**追加写临时文件**（O(1)/次）取代 bash 字符串累加（O(n²)）；② `_occupy_locations` 新增 ⑥「其它 worktree 的 task-state」检查，优先复用读取面索引文件（缺失时按号定向探测）。

## 依据（可核）

- 累加点实测 **1 处**（台账"5 处"不成立）：`alloc-task-id.sh:295-296`（双层循环内字符串累加）。
- 实测计时（真仓只读 dry-run，`SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1`）：修前 **94s** → 修后 **7s**（同输出 `D1009`）；规模 worktree 308。
- 成对反例（沙箱两 worktree）：⒜ 未占用名 rc=0；⒝ 已占用名（另一 worktree 的 task-state）修前 **rc=0 漏判** → 修后 **rc=1 + 点名 `worktree-task-state`**。

## 关键设计决定

1. **临时文件兼索引**：扫描结果落 `WT_USED_FILE`（`num<TAB>path`），末尾 `cut -f1` 读入占用表；同一文件供拒绝面 `awk` 复用 ⇒ 读取面与拒绝面**同源**。
2. **索引缺失不静默**：`--check-id` 只读模式不跑读取面 ⇒ 退化为按号定向探测（每 worktree 一次 `-f`），而非"没索引就放行"。
3. **收紧而非放宽**：⒝ 由漏判改为拒绝；既有 ①–⑤ 检查一处未删；现有 53 条断言原样通过（→58）。
4. **零烧号**：取证全程 `--dry-run` / `--check-id`，不建壳、不消耗真号。

## 参考系

第一性原理（占用判定必须单一事实源）＋ Anthropic 基线（修前/修后 + 变异体判别）＋ 仓内先例（D940 同热路径首次优化 258s→数秒）→ 结论：O(1) 追加 + 拒绝面复用读取面 + 成对反例。

## blast radius

- 调用方：`synova-commit`（内部取号）、`check-name-allocation.sh`（复用 `--check-id`，同一份 `_occupy_locations`）。
- 影响：取号入口 94s→7s（不再撞 30s 锁等待）；拒绝面新增一类冲突来源（`worktree-task-state`），对外输出仅多一行点名。
