---
状态: implemented
日期: 2026-10-11
决策: 修两条畸形 claim（1348/1466）—— 解除"全局提交阻断"（CTO 自认的存量缺陷）
理由: |
  实测：`claim_store --coverage` 返回 `status: invalid`（broken 2 条）⇒ `pre-commit-check.sh:1659 HARD_FAIL++`
  ⇒ `:2009` 判定"提交已拒绝" ⇒ **所有线、所有提交被阻断**（本地与 CI 同脚本，双端同阻）。
  来源经 git log 实测：**两条都是 CTO（synova-cto）2026-10-09 的提交**（07f25419b / 3c27f4fb5），
  经 PR #210 / #212 合入 local-main ⇒ **存量潜伏缺陷，非本次引入**，但影响面 = 全线。
  执行方（K12-21 窗口）未自行修：属跨线写集 + 其写集不含 `.claude/claims/**`，**未越权，处置正确**。
---

# 修法（**只改形态，不动判定语义**）

| 文件 | 缺陷 | 修法 |
|---|---|---|
| `.claude/claims/1348.yaml:26` | `note: >` 块标量内的续行以 `→` 开头，被解析器判为"非法列表项" | 折为**单行引号标量** |
| `.claude/claims/1466.yaml:15-17` | `done:` 条目写成 `- "verify(ref=HEAD): <命令>"` ⇒ 解析器找不到 `verify:` 载荷 | 改为 **`- verify: <命令>`**，ref 移入上一行注释 |
| `.claude/claims/1466.yaml:35` | `note: >-`（带 strip 指示符）同型续行问题 | 折为**单行引号标量** |

**验证**：`python3 scripts/control-tower/claim_store.py --coverage --root .` ⇒ `status: ok` ｜ broken **0** ｜ exit **0**。

# 相关
- 影响面：全局（所有 session 的所有提交）｜严重级：**阻断级**
- 纪律：修形态不改判据；未用 `--no-verify`
- 同族建议（留待治理线）：claim 解析器应对"块标量续行"与"`verify(...)` 变体"给出**更可读的报错**（现在是"不是合法列表项"，指不到真因）
