# Task Brief — D935 M1 ownership presets 域修正（窄卡）

> 生成: 2026-09-24 | 任务: D935 | 认领: synova-squad-lead（队长）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图

控制塔门禁链（`scripts/control-tower/`）。本任务修 **D733 域判定表**的一条漏登记：
`docs/synova/presets/**` 未在 `docs/synova/coordination/ownership.yaml` 登记 → 落 `**` 兜底被判 `win`
→ 与同 PR 的 mac 文件混装即触发 D734「变更跨域」硬拦。

消费者链（`check-ownership.py` 是 ownership.yaml 的唯一机器消费者）：
`ownership.yaml` → `check-ownership.py`（单域/断言两模式）→ `check-pr-budget.sh` ② →
`scripts/pre-commit-check.sh`（D734 块，CI 注入 `SYNO_CI=1` 转硬）。

### b) 文件审计

| 结论 | 证据（命令 + 原始输出） |
|---|---|
| 文件存在 | `ls -la scripts/control-tower/check-ownership.py` → `12184 bytes`；`docs/synova/coordination/ownership.yaml` → `200 行` |
| 实测误判面 | `python3 scripts/control-tower/check-ownership.py docs/synova/dispatch/x.md docs/authority/y.md docs/synova/research/z.md docs/synova/presets/w.md` → `mac/mac/mac/win`，exit 1 |
| **前提纠正** | 派单件称"四处误判"，**实测仅 1 处成立**（`presets`）；另三处已由 D914（`c7046c07`，PR #708 于 2026-09-22 21:18 合入）修掉 |
| 归属权威源 | `docs/synova/coordination/TASK-ROUTING.md:37`「…+ coordination + **DSH 预设与技能** → **Mac DSH**」；同表 `:108` 复述 |
| 兄弟路径先例 | `ownership.yaml:155`（`.claude/skills/**`→mac）、`:161`（`.dsh/**`→mac）同源 L37；`presets` 是唯一漏登兄弟 |
| CODEOWNERS 生成契约 | `check-ownership.py:148-179` 由 rules 生成；测试 `check-ownership.test.sh:12` §7 断言**逐字节相等** → 改 yaml 必须重跑 `--emit-codeowners` |
| 真实阻塞复现 | `bash scripts/control-tower/check-pr-budget.sh --files "<D931 8 件写集>"` → `❌ ② 变更跨域`，exit 1 |

### c) 决策

**复用**既有机制（不新建）：D733 已提供「rules 列表 + 最后匹配者胜出 + `--owner` 断言」三件，
本卡**只补一条规则**。**不新建**任何脚本、**不改**解析算法（改算法/兜底语义 = M1b 卡，见 §另开卡）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **同类第 4 次**（`task-state/D911.json` 自述缺陷② 第 5 次）：D782/D793/D795 各打过一次"漏登记 → 落兜底误判"
  补丁，本件是同一模式的又一次。**治本在机制**（新增目录登记门禁）而非逐条补规则 → 归 M1b/`⑨`。
- 历史教训：`D758`（证据目录豁免）、`D914`（CTO 三目录）——两次都是"兄弟路径已明列、本条漏登"，
  与本次 **同型**。故本卡只做**最小可比变更**，不借机改口径。
- 铁律 0-2（接线验收）：判别性夹具必须"删掉即报红"，否则等于没接线。

参考：第一性原理（门禁必须能被独立复算 → 证据只认命令+原始输出）+ Anthropic 基线（治理变更须配
判别性夹具 + 变异体验证）+ 开源实证（CODEOWNERS「最后匹配者胜出」是既有契约，不因本卡改动）
+ 收敛（结论 = 只在 rules 追加一条显式规则，零算法变更）。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：

- `docs/synova/coordination/ownership.yaml` — `rules:` 内新增一条
  `glob: "docs/synova/presets/**" / owner: "mac"`（源 = `TASK-ROUTING.md:37`），
  置于 Mac 例外区 `docs/synova/research/**` 之后、`.github/workflows/**` 之前
- `.github/CODEOWNERS` — 由 `python3 scripts/control-tower/check-ownership.py --emit-codeowners` **重新生成**
  （契约强制：测试 §7 逐字节断言；禁止手改）
- `tests/control-tower/check-ownership.test.sh` — 新增 **判别性夹具**：
  正常 = `docs/synova/presets/... --owner mac` → exit 0；**改坏即红** = 用 mktemp 沙箱复制 yaml 并删除该规则
  → 同一路径 `--owner mac` 必须 exit 1（证明判据真读数据，非 grep 型静态判据）

不做什么：

- 不改 `scripts/control-tower/check-ownership.py`（解析算法 / `resolve_owner` 语义一律不动）
- 不改 `docs/synova/coordination/ownership.yaml` 的兜底语义（`**` 规则与其 `default: true` 保持原样）
- 不改 `scripts/control-tower/check-pr-budget.sh`
- 不改 `.github/workflows/ci.yml`（**热点文件单写者**：#724/#728 在改同一清单，CTO 已裁定本卡不碰）
- 不改 `scripts/audit/**`（K3 红线）
- 不做生成式映射 / 最长前缀 / fail-closed 兜底（= M1b 卡，按 #730 新基线全量重写）

## Q3: 验收 — 入口 → 交互 → 结果

入口：`python3 scripts/control-tower/check-ownership.py <路径> [--owner mac]`；
      `bash tests/control-tower/check-ownership.test.sh`；
      `SYNO_CI=1 bash scripts/pre-commit-check.sh`

处理：ownership.yaml 追加一条规则 → 重生成 CODEOWNERS → 新增判别性夹具

结果（四项全贴原始输出，缺一不可）：

① **判别性夹具**：正常判 mac 的原始输出 + **改坏（删规则）即红**的原始输出
② **变基预演**（CTO 指定口径）：取 D931 真实写集
   `git diff --name-only origin/main...origin/fix/d931-squad-lead-team` → staged →
   `SYNO_CI=1 bash scripts/pre-commit-check.sh` → D733/D734 两组**不再报错**（贴命令 + 原始输出）
③ **本地 D733/D734 两组全绿**原始输出（`check-ownership.test.sh` / `check-pr-budget.test.sh`）
④ **不引入任何兜底放行**：未登记路径行为保持现状（本卡不改语义）

## 架构层

scripts（控制塔）

## 写集

| 文件 | 类别 |
|---|---|
| `docs/synova/coordination/ownership.yaml` | task |
| `.github/CODEOWNERS` | task |
| `tests/control-tower/check-ownership.test.sh` | task |
| `task-state/D935.json` | builtin（卡登记，D860 治理产物豁免） |
| `.claude/task-briefs/2026-09-24-D935-M1-ownership-presets-域修正.md` | builtin（本 brief） |
| `memory/notes/proposed/2026-09-24-d935-ownership-presets-domain.md` | builtin（铁律 49 决策 Note） |
| `docs/synova/product-lines/evidence/D935-20260924/**` | builtin（自验证据，D860 豁免） |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本） |

## §另开卡（M1b，不在本卡写集）

CTO 2026-09-24 裁定：**M1b = 按 `docs/synova/coordination/模块归属-MacWin-20260923.md`（#730 新基线）全量重写**，
含 `electron/**` 由 Mac 改判 Win、`src/l3|l4|...` 由兜底 Win 改判 Mac、`extensions/**` 拆分、
**最长前缀优先** + **未登记 = fail-closed**、改解析算法、重写 ownership.yaml、动 `.github/workflows/ci.yml`。
**必过 K3**（门禁语义变更）。本卡仅记录"已提 M1b"，不实施。

## §M2 写集冲突（已由 CTO 裁定）

本卡 3 个文件与在飞卡 **D911**（`status: claimed`，`risk: high`，5 个工作树活跃）的 write_set **100% 重叠**。
依据 `TASK-ROUTING.md` §串行点「写集重叠 → 停手问创始人」，已上报。
**CTO 裁定 A**：M1 先合（微补丁优先），CTO 令 D911 暂停这 3 个文件的写。本卡据此开工。

## Done 标准

- [ ] verify: `python3 scripts/control-tower/check-ownership.py docs/synova/presets/install-squad-lead.sh docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md` → 两行均 `mac`
- [ ] verify: `bash tests/control-tower/check-ownership.test.sh` → 全绿（含新增判别性夹具）
- [ ] verify: `bash tests/control-tower/check-pr-budget.test.sh` → 全绿
- [ ] verify: 判别性夹具反例——删该规则后同一断言必须 exit 1（改坏即红）
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` 在 D931 写集预演下 D733/D734 不再报错
- [ ] verify: `.github/CODEOWNERS` == `--emit-codeowners` 输出（逐字节，测试 §7 覆盖）
