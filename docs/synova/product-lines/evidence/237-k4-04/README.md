# #237 (K4-04) 图边读/写修好 — 交付证据 · 收尾三件

> **分支**：`fix/237-graph-triples-rebuild` ｜ **PR**：http://192.168.1.7:3000/synova-agent/SynovaAgent/pulls/343
> **建分支时基线 tip**：`68bf5759878a458b5e5ceb324a32878660155517` ｜ **本轮读数时点 HEAD**：`09240a496935900fdf902f25d5c5c4dcb8229cca`
> **交付人**：k4-04-impl ｜ 2026-10-11
> **状态**：**`可提请独立审计`**（复核员 v2 四项结论见 §八；**"通过与否"归 CTO 收件闸 ＋ K3 终审**）｜ Done ④ **未交付 ⇒ 已拆卡 `#345`**
> 🔴 K3 复审通过前**不得合并**。

---

## 一、前提冻结五样

| 项 | 值 / 证据 |
|---|---|
| 基线 sha | `68bf5759878a458b5e5ceb324a32878660155517`＝建分支时 `origin/local-main` tip；`merge-base(origin/local-main,HEAD)` 同值（D8 从 0 起算） |
| 分支 HEAD | `09240a496935900fdf902f25d5c5c4dcb8229cca`（`git ls-remote` 同 sha） |
| 写集 | **31 文件**，全落在允许路径（D8 全文见 `PR-BODY.md` (f)） |
| 判据命令 | D1–D10（派单 §六 原文 + CTO v2/v3 附加），逐条见 §三 |
| 前置满足 | `node v24.16.0` / `npm 11.13.0`；`npm ci --no-audit --no-fund` **exit 0**；`ink@5.2.1 ✔` 补丁已应用（铁律 40） |

## 二、交付物与来源（**两个对象 + 当点现测**；⛔ 不再用「逐字节一致 / delta=0」表述）

**来源口径**：**只读旧仓** `D:\novis-backup-20260526\Novis\synova-agent` 的**本地分支** `fix/1455-graph-triples-props @ a797bdcb4`
—— 🔴 **该对象未推送到 Gitea 远端**（复核员受控对照：已知对象 blob API `200 / 8534 B`、左对象 `400`；`git fetch <sha>` 与按 ref 取均失败）。
取回方式：实施员在本工作区同名本地分支逐字节 `git cat-file blob`，并以 `git hash-object -t blob` 自证 sha；复核员另在只读旧仓独立取到同一对象并自证 sha。

| 文件 | 对象 A（`a797bdcb4:<path>`） | 对象 B（`HEAD:<path>`） | 差 |
|---|---|---|---|
| `src/store/migrations/004-graph-triples-rebuild.ts` | sha `e47568b663edae57984095072a7f76d4e8ee9931`（8498 B） | sha `46e255d5540271684025465dfacf183ed1749052`（8534 B） | **+36 B / 净 +1 行（1 hunk / 2 删 3 增）· 全在 JSDoc 内 ⇒ 代码零改动** |
| `tests/store/migrations/004-graph-triples-rebuild.test.ts` | sha `78a05eb4ffed2092da597e81b9b28d13270c1964`（16652 B） | 同 sha（16652 B） | 0 B / 0 行 |
| `docs/synova/product-lines/evidence/issue1455-graph-triples-canonical-20261009.md` | sha `10e32f07c697d1899c2aefa3672e9bfba1830ff1`（30391 B） | 同 sha（30391 B） | 0 B / 0 行 |
| `src/store/schema-migration.ts` | sha `cc5feace6e03a7afa60158c5b6af2eb5cdbcb7ec`（5731 B） | 同 sha（5731 B） | 0 B / 0 行 |

另（新增件，非捡回）：`tests/adapters/sqlite-graph-store.legacy-schema.test.ts`（卡面 Done① 点名入口，6 例）、
`docs/synova/product-lines/evidence/k4-04-verify-review-20261011.md`（**独立复核件 v1.8 逐字节搬运**：源 `69928 B / sha256 A7037222…/ 654 个 0x0A / LF（CRLF=0）/ UTF-8 无 BOM`；`git rev-parse HEAD:<path>` = `c1313b22b7efb56dff861519ed78b9103c91dc43`；`bytes_eq=true / sha_eq=true`）、
`docs/synova/product-lines/evidence/237-k4-04/**`（判据原始输出 + 本件 + Z8 提案）、`.claude/claims/237.yaml`。

## 三、判据 D1–D10（原始输出文件见本目录）

| # | 结果 | 证据（文件 / 原始读数） |
|---|---|---|
| D1 | ✅ | `src/store/schema-migration.ts:15` import 命中（`GREP_EXIT=0`） |
| D2 | ✅ | a) **卡面点名件** `legacy-schema.test.ts`：**6 passed / EXIT=0**；b) **额外回归** `004-*.test.ts`：**16 passed / EXIT=0** |
| D3 | ✅ | `tests/store/`：**12 文件 / 107 例 / EXIT=0** |
| D4 | ✅ | 单跑「同形守卫」：**1 passed / 15 skipped**；12 列 `toEqual` 逐列（非计数式）＋ 新增件两处 `PRAGMA table_info` 动态等效 |
| D5 | ✅ | 造红 A **9 failed / 13 passed**；造红 B **12 failed / 10 passed**（`datatype mismatch` ×10，写面具名失败）；各自恢复后 **22 例绿**（复原以 `hash-object` 双端同 sha 证明） |
| D6 | ✅ | 真机 DDL 夹具 → 生产迁移路径 → `queryEdges()` **N=2**（具体值）→ `createEdge()` 成功 → **N=3**、`raw_props={"k":"v"}` |
| D7 | ✅ | ①`props` 在 + `props_json` 值迁入；②`canonical_12_equal=true` / `removed_extra=true`（不含 `confidence`/`source`）；③读写双通 |
| D8 | ✅ | `git diff --name-only $(git merge-base origin/local-main HEAD)..HEAD` = **31 文件**（口径＝merge-base，非死 SHA）；`src/adapters/**`・`scripts/audit/**`・`scripts/control-tower/**` **零命中** |
| D9 | ✅ | `SCANNED_FILES=4974 / TOKEN_HITS=0`（口径：工作树全部文件，排除 `.git` 与 `node_modules`） |
| D10 | ⚠️ | PR **#343**；CI 步骤③ **红**（**存量 + 环境**，见 §五）——**非本写集**；`pending=0` 未达成，**处置待 CTO** |

**Done⑤（CTO v3 口径，含加固读数）**：
```
[db] D:\novis-backup-20260526\Novis\synova-agent\data\synova.db      [file_bytes] 12959744
[mode_immutable1] FAILED: unable to open database file ⇒ 回落 readonly + query_only
[mode] readonly:true + PRAGMA query_only=1
[count] 14 | [has_props_json] true | [has_props] false | [id_type] INTEGER
[sha256_before] 771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a
[sha256_after]  771f0677eee12c9f0b0a5f75869d8548d0294b08eec40f2646bef64b54a6bd5a   [sha256_unchanged] true
```
⇒ 卡面前提**实测成立**；本体 sha256 前后一致（`-shm`/`-wal` mtime 变化按 CTO 裁定豁免）；克隆内无 `synova.db` ⇒ 单时点。

## 四、造红 A / 造红 B（临时改动，均已复原）

| 项 | 临时改动 | 红 | 恢复后 | 复原证明 |
|---|---|---|---|---|
| A（缺实现态） | `schema-migration.ts` 摘掉 004 的 import + 注册项 | `9 failed / 13 passed`、EXIT=1 | `22 passed`、EXIT=0 | `hash-object` == `cc5feace6…` |
| B（半修掩盖） | 004 改为"只 `ADD COLUMN props` + 回填、不重建" | `12 failed / 10 passed`、EXIT=1、**`datatype mismatch` ×10** | `22 passed`、EXIT=0 | `hash-object` == `e47568b66…` |

临时改动**只在工作区**、未 commit、未 push；复原后 `git status` 干净（HEAD 未变）。复核员已独立复做 C2/C3 双造红并确认判别性（红因子可区分：B 有 `datatype mismatch`、A 为 0）。

## 五、CI 状态与存量红归因（**CTO v4 §①：存量红点名放行；不收紧 `--changed`**）

- 步骤 **① 13 组门禁 ✅**、**② 架构边界 ✅**、**③ `vitest --changed origin/local-main` ❌**（run 307/308/309/310/319 同型）。
- **失败件 1**（存量红 · 卡 **`#347`**）`tests/tui-v2/chat-degradation.test.ts`（6 例，`ReactCurrentOwner`）：**不在写集**（`git diff --name-only $(merge-base)..HEAD -- tests/tui-v2/` = 0）＋ **零改动基线同样红**（run 281 另一分支与 run 319 失败用例名逐条对齐；本地完整 checkout 基线树 `6 failed`）。→ 双证据全文见 PR 正文 **(h)**。
- **失败件 2**（环境依赖）`tests/stream-tool-loop.test.ts:210`：**不在写集**（`-- tests/stream-tool-loop.test.ts` = 0）＋ **本地两态皆绿 / CI 收外部 LLM 文本**（verbatim：`expected '收到你的"测试错误"…' to contain '失败'`）。→ 见 PR 正文 **(h)**。
- **反证检查**（复核员独立重做，方法更强）：4 个绿 run 日志中两文件与 `ReactCurrentOwner` **全 0 命中** ⇒ **"找不到反例"成立**。
- ✅ **D10 判过三条**：(a) 红件逐条点名 + 双证据 见 (h)；(b) 存量卡 `#347` 已立；(c) 本卡写集内判据全绿（复核员 C1–C9 + D8）见 (i)。

## 六、遗留清单 / 未决项

1. **Done④ 未交付 ⇒ 已拆卡 `#345`**；口径＝与 `queryNodes` 的 **D355 先例同款**（`log.error` + `"no such column"` 识别 + **仍返回 `[]`**）；`degraded` 另案。
2. **DDL：CTO 已逐字批（12 列 canonical）** —— `confidence` / `source` / `props_json` **三列被移除属既定取舍**；「`props_json` 值并入 `props` 不丢」的**断言出处（用例名 + `file:line`）见 PR 正文 (j)**（`004-*.test.ts:101/:127/:154/:186/:251` 与 `legacy-schema.test.ts:104/:133`）。
3. ✅ **CI 步骤③ 红按「存量红点名放行」判过**；存量卡 `#347`；**不收紧 `--changed`**。
4. **本地 git hooks 未安装**（`.git/hooks` 仅 `.sample`）⇒ 本地 13 组未跑；权威门禁＝Gitea CI。**CTO v4 §①-⑦：不立卡**，开工令将补 `npm run hooks:install`。
5. **证据件编码事故（本批第 2 次，已升级 CTO）**：首版 9 份 + `CI-repro-*.txt` 2 份因本机 `pwsh` 实为 **PowerShell 5.1**、`*>` 产 **UTF-16LE**；另有 3 份被 `Out-File -Encoding utf8` 加 **BOM**。已全部转 **UTF-8 无 BOM**；**从 HEAD 复检 21 份 `bad_committed=0`**。
6. **Z8 提案**（`PROPOSAL-skill-tool-discipline.md`）＝**落点已由 CTO v4 §①-③ 改定为 `docs/synova/product-lines/evidence/**`（写集内）**，不碰 `.dsh/skills/**`（技能面 diff = 0）；条目 3/6 已按复核员交叉核补写；复核员第 10 条**只登记、待裁**。
7. **即时生效令合规（CTO v4 §①-⑤）**：本件与 PR 正文**均未引用 `check-file-driven.sh` 的事后复跑读数**。
8. K3 复审通过前**不合并**。

## 七、归属逐张收口

| 项 | 归属 | 状态 |
|---|---|---|
| Done ① ② ③（旧库读/写 + 反例判别） | 本卡 | 交付（D2/D5/D6；复核员 C1/C2/C3 已独立复跑） |
| Done ⑤（真库读数，含加固） | 本卡 | 交付（`readonly + query_only=1`，本体 sha256 前后一致） |
| Done ④（读路径不静默） | **已拆卡 `#345`** | 未交付（PR 正文 C5′ 显式声明） |
| DDL（`confidence`/`source`/`props_json` 移除） | **CTO 已逐字批** | ✅ 已批；断言出处见 (j) |
| CI 步骤③ 红（存量 + 环境） | **CTO：存量红点名放行** | ✅ 判过（双证据 + `#347`） |
| 资产来源与取回方式 | 本卡 | 只读旧仓本地分支逐字节取回 + 自证 sha；复核员独立复取 |
| Z8 工具纪律清单 | 提案（落点 `evidence/**`）→ **K3 → CTO** | 提案件已入仓，未落地 |

## 八、独立复核结论（M6 回写 · 摘要；**四项原文照贴见 `PR-BODY.md` 同名节**）

- **复核员**：`独立复核员 k4-04-verify` ｜ **复核件**：`docs/synova/product-lines/evidence/k4-04-verify-review-20261011.md`（**v1.8**：69928 B / 654 行 / blob `c1313b22b7efb56dff861519ed78b9103c91dc43`）｜ **对象**：新 head `09240a496935900fdf902f25d5c5c4dcb8229cca`（base `68bf57598…`）
- **结论原文**：
  > **`自验结论`：新 head `09240a496` 上全部可执行判据（C1/C2/C3/C4/C5′/C6/C7/C8/C9 ＋ D8）均通过复核员独立重跑，未发现与判据冲突之处 ⇒ `可提请独立审计`。** ⚠️ **"通过与否"归 CTO 收件闸 ＋ K3 终审**；本条不含审计结论，也不替代三项 CTO 决策。
- 四项（a 与实测不一致处 / b 无法核实处 / c 跑不通处 / d 能否据此独立开工）**原文照贴**于 `PR-BODY.md` §「独立复核四项结论」；本件仅作摘要，**不替代原文**。
