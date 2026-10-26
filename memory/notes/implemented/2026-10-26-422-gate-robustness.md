# 2026-10-26 · 裁 422-R1/R2 门禁健壮性（#1048 #1049）

## 背景（裁定链）
Win 侧 M3 执行/复审（#1044）发现两族缺陷，Mac CTO 裁 422（R1=B类 / R2=A类政策已批），本批实现。

## 改了什么（四件 + 配对测试）
1. **R1-a Windows 路径归一（gate-protection）**：`os.path.relpath` 在 Windows 产出反斜杠 ⇒
   `git cat-file <sha>:<path>` 假触发 E_BAD_BASE（exit 2）。修法＝`_git_rel()` 公共 helper
   （`replace(os.sep,'/') + replace('\\','/')`），生产路径与 `GP_SELFTEST_REL` 自检缝**同源**（防测副本）。
2. **R1-b ESM specifier 归一（block-paths）**：`import(绝对路径)` 在 Windows 把 `d:` 当协议
   （组9 同族）。修法＝`block-paths-core.sourceImportSpec()`（先归一反斜杠再 `pathToFileURL`），
   `gen-block-paths` 改用；纯函数归 core 模块（零 import 纯库不动真源约束不变）。
3. **R2-a 对手集断言（merge-conditions）**：D-10 实证——`prs.tsv` 缺失时 `done < prs.tsv`
   循环零执行 ⇒ ② 判 `ok(比对 0 对)`（fail-open）。修法＝cond2 头部 `[ -s prs.tsv ] || die_degraded
   E_OPENPRS_EMPTY`（**在判定点断言自己的输入**）；测试缝 `SYNO_MERGE_COND_TEST_NO_PRS` 复现 D-10。
4. **R2-b 覆盖率 fail-closed（quality-delta + local-gates ①e）**：①e 覆盖率生成失败仅 warning
   ⇒ src 变更时 G5"未武装"而非红（看不见被当没问题）。修法＝`--coverage-required` 声索制扩展
   （沿用既有武装声索设计）：CI ①e 摘要缺失分支传 flag ⇒ 检查器判「src 变更 ∧ 未武装 ⇒
   E_COV_UNARMED exit 2」；`SYNO_QD_G5=0` 回滚语义优先（对照组已测）。

## 判别力（三处变异闭环，全部"摘掉修复 ⇒ 红；还原 ⇒ 绿"）
- 摘 `_git_rel` 归一化 ⇒ 自检缝例红（win 输出带反斜杠被抓）
- 摘 cond2 守卫 ⇒ 边界 L 例红（suite exit 1）
- 摘 quality-delta 致命块 ⇒ G5-14 红（suite exit 1）
另 block-paths：`sourceImportSpec` 改 `return p` ⇒ 2 例红。

## 已知限制
- R1 的真实 Windows 行为无法在 Mac CI 复现（CI 为 Mac）——以自检缝/纯函数单测锚定归一化语义；
  Win 侧下次本地跑即为真实验收（预期 E_BAD_BASE 假触发消失）。
- local-gates ①e 的 else 分支属 CI 面，本批以检查器侧测试覆盖判定逻辑，workflow 语法靠 CI 本身。

## 关联
卡：#1048 #1049（Done 硬要求全落）；裁定：裁 422（台账 14015 行起）；豁免：DOC-0305；
测试：4 件套全绿（27/14/99/34 通过 0 失败）。
