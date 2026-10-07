# Task Brief — D331 第二段补孤儿豁免：判定改读共享真值（D1243 / 卡 #1312）

> 编号 **D1243**（用前三重核验：gate 免费 / main 零文件 / issue 标题零命中）
> 性质：**判据变更** ⇒ **提案 → K3 过审 → CTO 裁**（作者不自行合并）。
> 卡面来源：CTO 发现 + Lead 逐行核实 = **一个缺陷两半**（本卡 = **B 半**；A 半在 `synova-commit`，同卡不同文件）。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（pre-push 门禁 D331「版本 tag 锚点」）。
### b) 文件审计（实跑复现）
- **两段不对称**（同一个 D520，当年只治了一半）:
  - 第一段（`:198-203` 遍历所有 `V*.*.*` tag）: `git merge-base --is-ancestor "$t" HEAD || continue` ⇒ **有孤儿豁免**；
  - 第二段（`:204+` VERSION.md 最新版本）: `elif ! git merge-base --is-ancestor "$ver" HEAD` ⇒ **无孤儿豁免** ⇒ 直接 `TAG_FAIL`。
- **影响面（Lead 量化）**：`VERSION.md` 最新版本号**全局唯一** ⇒ **本机任一同名孤儿 tag ⇒ 全机、全分支、任何 push 全红**；
  D520 实证 ×3，全队 4 人（line B/F/E + Lead）**各自删过本地 tag** 才能继续。
- **复现（本卡实跑）**：沙箱内「VERSION.md `## V9.9.9` + 同名孤儿 tag + feature 推送」⇒ **EC=1（误红）**；
  修后 ⇒ **EC=0（黄）**。
### c) 决策
把第二段与第一段**对齐**（孤儿豁免），并把判定从「本机私有状态」改为读**共享真值**（`ls-remote`）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **CTO 类级洞察（本卡上位根因）**：「**判定面混入本机私有状态**」（R26 mock id / R28 探针写进真配置 /
  R32 本机孤儿 tag）共同根因 = **没划清「共享真值 vs 本机残留」**。
- **本仓既有范式**：D1219 给编号分配器补源时即「远端占用改由 `ls-remote` 权威查询」⇒ 本次**复用范式**，不新造。
- **反例（防放宽成纸老虎）**：main 上真锚点断裂必须**仍红** ⇒ 夹具设反例。
- **教训（本卡自己的）**：`git ls-remote` 的**执行位置**有隐藏顺序依赖 —— 本函数开头 `local … ver=` 会清空同名外层变量，
  我的远端态查询初版放在 `ver` 赋值**之前** ⇒ 查成空 pattern ⇒ **恒判「本机独有」** ⇒ **被自己的夹具 G′ 用例当场抓住**。
参考：第一性原理（判定只应依赖共享真值）+ 既有 ls-remote 范式 ⇒ 对齐式修 + 方向显式 + 反例钉住。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/pre-push-check.sh
- tests/control-tower/tag-ancestry.test.sh
- .claude/task-briefs/2026-10-08-D1243-tag-orphan-parity.md
- memory/notes/proposed/2026-10-08-d1243-tag-orphan-parity.md
- task-state/D1243.json

改动内容：
1. **第二段补孤儿豁免**：tag 存在但非 HEAD 祖先 ⇒ **feature 侧改黄色中间态（不阻断）**；**main 侧仍硬阻断**；
2. **判定读共享真值**：`git ls-remote --exit-code --tags origin refs/tags/$ver`，**显式捕获 rc**（0=远端存在／
   2=远端确无／其余=不可查）⇒ 三态可区分（**不把「空」与「失败」混为一谈**）；位置在 `ver` **赋值之后**；
3. **报文自证四项**：已推送／HEAD 祖先／本机独有（远端态）＋**解除命令**（feature 侧与 main 侧都给）；
4. **成功文案名副其实**：保留子串「孤儿 tag 已豁免」（他线夹具依赖，见下）+ 补「豁免范围 + 清单」；
5. **夹具**（并入既有 `tag-ancestry.test.sh`，覆盖矩阵原本**未覆盖**第二段的 feature 路径）：
   E 正向（孤儿+feature ⇒ 黄）· F 反例（同场景 main ⇒ 仍红）· G/G′（**本机残留 vs 共享真值**两态可区分）·
   H 变异体（去掉豁免 ⇒ E 重回红）。

不做什么（含文件路径）：
- **不改 `tests/control-tower/tag-bypass-wiring.test.sh`**（**他线夹具**）：它按字面量「孤儿 tag 已豁免」断言
  「豁免要说出来」⇒ 本卡**保留该子串**（修好后它才**名副其实**）⇒ 零跨线改动即两边全绿；
- **不改 `scripts/control-tower/synova-commit`**（本卡 A 半，同卡不同文件 —— n 一件一 PR）；
- 不改 `VERSION.md` / `.codex/control-tower/**` / `ci.yml`。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/tag-ancestry.test.sh`
处理：stdin 喂 `refs/heads/<branch>`（**PUSH_BRANCH 由 stdin 推导，环境变量会被覆盖**）+ 本地 bare origin
结果：夹具 **21 通过 / 0 失败**；旧夹具 `tag-consistency` / `tag-bypass-wiring` 均 **rc=0**。

## 架构层: 治理面（scripts + tests/control-tower）
#CRITERIA: D

## 同类登记（先报不改 —— CTO 类级洞察「判定面混入本机私有状态」）
| 位置 | 形态 | 说明 |
|---|---|---|
| `scripts/control-tower/synova-submit.sh:66` | `git tag -l 'V*'` 仅本地 | 同族：判定面只见本机 tag，无 ls-remote 权威查询 |
| `scripts/control-tower/synova-commit:198` | `git tag -l "$ver"` 仅本地 | **本卡 A 半**（同卡不同文件）⇒ 本卡不动 |
| （对照·已用共享真值） | `check-name-allocation.sh` / `alloc-task-id.sh` / `pre-push-check.sh` | D1219/本卡范式 |

## Done 标准
- [ ] verify: `bash tests/control-tower/tag-ancestry.test.sh` ⇒ `21 通过, 0 失败`
- [ ] verify: `bash tests/control-tower/tag-bypass-wiring.test.sh` ⇒ rc=0（他线夹具零回归）
- [ ] verify: 变异体 H ⇒ 去掉豁免后场景 E 重回红（EC=1）
- [ ] verify: `bash tests/control-tower/scan-fullwidth-vars.test.sh` ⇒ `tests/ 面违规 = 0`
- [ ] verify: `bash scripts/pre-commit-check.sh` ⇒ 13 组通过；`check-gate-integrity.sh` ⇒ OK
