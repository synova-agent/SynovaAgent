# D1204 — DOC-CONTRACT 三闸 K3 逃逸收敛 + 过渡表出口机器化 + SIGPIPE 假红硬化

状态: proposed
日期: 2026-10-07
决策: 门禁判据的「三处逃逸面」就地收敛（不加新闸、不新增判据源）；过渡表出口条件改机器可判、存量改动态派生；测试管道改「先落文件再 grep」
理由: 门禁漏拦 = 假绿，比没有门禁更危险；判据双写必腐（214→215 实证）；SIGPIPE 假红腐蚀整条链信任（V3.9 教训：软机制 0% 有效）

## 一句话

K3 独立复核实测出的两个 P1 逃逸 + 一个 P2 后门，加上一个 P1 可执行性缺口与一条假红 flake，全部就地修复并配「改坏即红」夹具。

## 问题

1. **X1 同名兄弟前缀**（P1）: `dir/**` 只匹配子树 ⇒ `docs/plans.md`（同名**文件**非目录）、
   `docs/synova/coordinationX/y.md` 被**放行**。阻断清单形同可绕过。
2. **X2 rename 逃逸**（P1）: 闸 3 只取 `--diff-filter=A` ⇒ `git mv 既有文档 → 阻断目录`
   （R100）不进清单，实测**三闸 PASS**。
3. **X3 README 索引后门**（P2）: `**/README.md` 无同址约束 ⇒ 新建顶层 `reports/README.md` 放行，
   可在任意未授权目录用一份 README 开张。
4. **过渡表出口条件不可机器判定**（P1，K3 §R3）: 「迁出仓库」无判据；`transition_hits` 只在 stdout、
   复审时无数据可取；存量 `as_of=214` 与实测 `215`（今测 229）**合并当刻即腐**。
5. **SIGPIPE 假红**（#1214）: `set -uo pipefail` × `echo "$OUT" | grep -q …` ⇒ 右侧提前退出给左侧 SIGPIPE(141)
   ⇒ 真接线被判成接线缺失。实测连跑 10 次有 2 次「45 通过 1 失败」，失败项恒为 ⑧ 接线。

## 决定

- **X1**: `match_path(..., closure=True)` **只给阻断清单开前缀闭包**（多拦 = fail-closed）；
  白名单恒为严格子树（放宽 = 漏拦，`docs/**` 会放过 `docs-old/`）。代价：`docs/plans-old/**` 等同前缀路径一并阻断，显式接受。
- **X2**: 闸 3 取 `--diff-filter=ACR` + `--name-status` **目标路径**（末列）。`M`(修改) 仍不在清单内（§7 存量不返工）。
- **X3**: `**/NAME` 豁免须**同址有代码**（父目录含 ≥1 非文档文件）——即契约原意「包/目录自己的契约文档随代码走」。
- **#1252**: 过渡表第 4 列改机器 DSL `tracked-count:<路径模式>=<N>`；缺失/不可解析 ⇒ degraded exit 2；
  存量**动态派生**（`git ls-files` × 模式，单源），第 5 列只作可选交叉校验（声明≠实测 ⇒ 任何模式判红）；
  台账 + `transition_hits` 落 artifact `.codex/control-tower/logs/doc-contract-transition.json`；
  「已达出口」在 `--baseline` 复审模式判红，逐 PR 模式只出 NOTE（台账是契约自身棘轮，不是每 PR 判据）。
- **#1214**: 全部断言改 grep **落盘文件**（先例 `hard-gate-convergence.test.sh` 的 `PC_CODE_FILE` 模式）；
  `grep -v … | grep -q …` 改「先落去注释文件再 grep」；`grep -v … | head -1` 同族一并收口。

## 考虑过的其他方案

- X1 备选「阻断清单直接写 `docs/plans`」：只堵一条路径，下一行还会踩同一坑 ⇒ 改匹配语义，一次堵一类。
- X3 备选「README 限定在白名单目录内」：会连坐 `packages/*/README.md`（契约 §3 明写要放行）⇒ 改判「同址有没有代码」。
- #1252 备选「声明值 ≠ 实测 ⇒ 红」（保留手写数）：仍是双源，每次存量变动都要改契约 ⇒ 动态派生 + 交叉校验。
- 「已达出口」备选「所有模式判红」：任何 0 个 task-briefs 的合法夹具/分支被连坐（假红）⇒ 复审模式判红。

## 后果

- 闸 3 的**误拦面**略增（同前缀无关路径），换来同名兄弟/rename/索引三类逃逸闭合；契约 §3 已把口径与代价写死。
- 过渡台账新增 artifact 写入（每次门禁运行）——与既有 `.codex/control-tower/logs/degraded-events.log`
  同址同惯例（运行期产物，未 gitignore；`.gitignore` 增行不属本卡写集，已列例外）。
- 存量列不再写数 ⇒ 复审改看 artifact，契约文本不再「合并即腐」。

## 取代

候选清单（grep）:

```
grep -rn "validate_doc_contract\|DOC-CONTRACT" scripts/ tests/ .github/ | grep -v node_modules
```

判定: **不取代** —— 本卡是 D1193 判据的**收敛补丁**，不推翻 D1193 的方向（阻断优先于白名单 / md+html 同判 /
判据解析自契约块三条全部保留）；D1193 的接线与决策文件（`decisions/process/2026-10-07-doc-contract-gate-wiring.md`）继续有效。
