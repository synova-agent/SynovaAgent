# 决策 Note — D954 C 段空转修复（对账对象改指 base + 判别夹具 + infer_did 回退/--did）

- 状态: proposed（待 K3 复审 #741 新 head 后 git mv 到 implemented/）
- 日期: 2026-09-25
- 决策: CI 棘轮的 C 段（既有红基线对账）**必须对"已定态的对照面"取数**——对账对象由当前提交（head）改为 **base ref**，并**显式打印** `对账对象 = <ref> @ <sha>`；`--ci-reds` 追加消费 `disposition_due`（处置逾期 → 判红）；新增 `--root` 显式覆盖修 ROOT 随 cwd 漂移。

## 依据（K3 批次 5 定罪，可核）

- `ci.yml:364` 原为 `REF: ${{ github.event.pull_request.head.sha || github.sha }}` → gate job 取 head 时同批 job 多未定态 → `CI-RED-CHECK: 失败检查 0 项` ⇒ 棘轮**从未被行使**（同 SHA 终局实有 3 个 failure；gate 只跑 19s，红 job +71s/+119s/+27min 才定态）
- 判红口径（基线文件段头自述）：**仅 `conclusion == "failure"` 计入**（skipped/neutral/cancelled/未定态不计）
- base 锚（自取）：`origin/main` 上唯一 failure = `Vitest (2/2)`，**已登记** expires=2026-10-24

## 关键设计决定

1. **参数化而非硬编码**：`--base-ref <ref>`（PR: `pull_request.base.sha`；push: `git fetch origin main && git rev-parse origin/main`）；ref 不可解析 → **exit 2**（不判绿）。
2. **可核输出**：C 段必打印 `对账对象 = <ref> @ <sha>`，并进证据步公开注解 —— 使"棘轮对谁取数"成为可检索事实（上一轮的失败正是"看不见对账对象"）。
3. **`--root` 显式覆盖**（顺序：显式 `--root` > `git rev-parse` > 脚本相对兜底，且文件头预扫）：修 `:111` ROOT 随 cwd 漂移导致"读 A 树基线、认 B 树对账对象"的静默错判；`--base-ref` 的 sha 解析同样走 `git -C "$ROOT" rev-parse`。
4. **不改判据语义的动作不做**：SKIPPED（未传 `--base-ref`）保持"不判定 ≠ 通过"，用**双重对冲**（ci.yml 恒传 + 夹具断言 ci.yml 必传）而非把 SKIPPED 改成 exit 2 —— 后者属扩判据，交 CTO 决定。
5. **D814 未落地**：卡面"保持 `--first-parent` 语义不回退"**无对象**（`task-state/D814.json` = claimed/impl:null；全仓 `first-parent` 0 命中）→ 只在 docstring **留痕缺口**，不越界实现。

## 参考系

第一性原理（对未定态自我取数 = 恒空集，不可判；对账对象必须显式）＋ Anthropic 工程基线（判据三分 + 变异体改坏即红）＋ 仓内先例（M9 棘轮跨平台判定、D937 方言、D370 全角标点、D814 登记未实现）→ 结论：参数化 + 打印对账对象 + 判别夹具 + fail-closed 降级。
