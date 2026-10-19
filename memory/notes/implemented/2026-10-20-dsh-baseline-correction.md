# 2026-10-20 · DSH 基线纠偏 ＋ 「DSH = 开发工具，不是产品运行时」

> **类型**：implemented ｜ **裁定**：裁 222（CTO）｜ **上游**：创始人 2026-10-20 令「DSH 版本改为 0.2.1-rc.2，源码也要给对」

## 为什么
旧锚 `docs/synova/coordination/DSH-断面.json` 写 `0.1.7-rc.1 @ /Users/wane/src/deepseek-harness-017`，
**该 path 已删除** ⇒ `check-dsh-anchor.py` 长期 **DEGRADED(exit 2)**，且它是 `soft_check` ⇒ 报了没人管。

同时全仓散布多个 DSH 版本串（0.1.7-alpha.2 / 0.1.7-rc.1 / 0.2.0-rc.2），**互相矛盾**。

## 核心口径（本次确立，最重要）
**DSH 是「开发时用的工具」，不是 Synova 的产品运行时依赖。**
- 实测 `grep -rn "from '@deepseek-ai/dsh'" src/ packages/` ⇒ **零命中**
- `package.json` 的 dependencies / devDependencies 里 **无 dsh**
- Synova 自己的运行时 = `src/agent/tool-loop-executor.ts` + `src/providers/base.ts` + `conversation-engine.ts`
- ⇒ **客户装的是 Synova，机器上没有 DSH** ⇒「DSH 升级要不要跟」在产品侧**不存在**
- ⇒ **禁把 DSH 版本写进「产品支持范围」**

## 改了什么（6 件活件）
1. `AGENTS.md` 根件：加【DSH 口径】段（含实测命令 + 当前版本 + 源码路径 + 禁止条款）
2. `docs/synova/STATE.md`：锚定 `dsh-v0.2.0-rc.2` → `dsh-v0.2.1-rc.2`；离线恢复命令指向新 worktree
3. `docs/synova/presets/synova-cto/persona-block.yml`：源码构建 `0.1.7-alpha.2 @00102833` → `0.2.1-rc.2 @687f282e86`
4. `docs/synova/presets/synova-squad-lead/cordis.patch.yml`：头注释 `DSH 0.1.7-rc.1` → `0.2.1-rc.2`
5. `.github/workflows/ci.yml:1590`：蓝本注释 `dsh-v0.2.0-rc.2` → `dsh-v0.2.1-rc.2`
6. `docs/synova/coordination/DSH-断面.json`：current 重建（0.2.1-rc.2 / 687f282e86 / 新 worktree 路径）；
   旧 `0.1.7-rc.1` 入 `superseded`（理由：path 已删 + 已升级）；`known_versions` 补 `0.2.1-rc.2`；
   `policy.scope` 新增「本文件只锚开发工具面，产品不引本文件」

## 不改（历史/生成物，按 DOC-CONTRACT §7 存量不返工）
`memory/notes/**`（本 Note 除外）／`.claude/task-briefs/**`／`docs/synova/research/**`／
`docs/synova/product-lines/evidence/**`／`docs/plans/**`／`task-state/*.json`／`package-lock.json`／
`product-progress.json`／`pr-queue.json`／`tests/control-tower/check-dsh-anchor.test.sh`（fixture）

## 验证
- `check-dsh-anchor.py`：**DEGRADED(2) → OK(0)**『DSH-ANCHOR: OK [事实源 0.2.1-rc.2 @ 687f282e86 ｜ 扫描 39 份]』
- `SYNO_CI=1 pre-commit-check.sh` ⇒ **12 组全通过**
- 源码已拉：`/Users/wane/src/dsh-src-0.2.1-rc.2`（独立 worktree，tag `dsh-v0.2.1-rc.2`，commit `687f282e86`）

## 已知限制
- `dsh --version` 报的是 **PATH 上另一个 dsh（0.1.6-alpha.2）**，**不是** app 跑的 0.2.1-rc.2
  ⇒ **不能拿它当锚**；app 版本应从 `/Applications/DeepSeek Harness.app` 的 Info.plist 或 asar 读。
- `tests/control-tower/check-dsh-anchor.test.sh` 的 fixture 仍用 0.1.7-rc.1（测试数据，不影响实物）
