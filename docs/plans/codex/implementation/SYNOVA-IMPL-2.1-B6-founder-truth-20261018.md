---
status: proposed
日期: 2026-10-18
任务: 2.1 B6 控制台崩溃（`CTO-待办总账.md` §二 A 类第 2.1 条；🔴 **未立卡** ⇒ Issue 号待立卡后回填）
撰写: P4（门禁包负责人）· **独立于实现者**
依据: `agents/P4-门禁/AGENTS.md` §三/§十/§十二；`pre-plan-thinking` 9 问；`dev-doc-spec` v2（8 节＋3 条件）；`CTO-待办总账.md` 2.1／2.11
批次规模: **改 3 文件 / 净增约 45 行**（W1＋3 行｜W2＋约 40 行｜W3 −1 行）
前置口径: 创始人 2026-10-18 开工令 —— **B 类（修 bug，不改门禁语义）**；**做完可四条件自合并，不必等 CTO**
---

# SYNOVA-IMPL-2.1 · P4 交付 1：修 B6（`founder-truth.py` 崩溃 ⇒ CTO 的眼睛）

> 🔴 **本件是执行小队的唯一规格源**。口径已由创始人本轮开工令裁死：**只修崩溃、不改门禁语义**。
> 🔴 **两条硬红线**（写进判据）：**不碰 `judge()`**、**不改退出码语义** —— ⚪ 判据落地是 **2.11**（K3 过审后），不在本卡。
> 🔴 **冻结**：派单时给 **blob SHA**，实现方引用 blob，不引用可变工作树。

---

## 封面 · 四行开场包

```
① 批次名：P4-交付1-B6-founder-truth-修崩溃
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - scripts/control-tower/founder-truth.py            （:90-93 claim 行补 id/title/phys 三键，+3 行）
   - tests/control-tower/founder-truth.test.sh        （收紧 1 条假绿断言 ＋ 新增 3 条，+约 40 行）
   - scripts/control-tower/gate-integrity-baseline.txt（:120 删 1 行：取消隔离，让发现制重新执行本测试）
③ 判据（含"改坏必红"）：
   - 命令：SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 scripts/control-tower/founder-truth.py --offline  ⇒ 期望 exit 0/1（不是 2）、无 Traceback、含 `| #<n>  | claimed(claim) | 未核验（claim 无 D# 锚点） |`
   - 命令：bash tests/control-tower/founder-truth.test.sh  ⇒ 期望末行 `结果: N 通过, 0 失败`（N≥14，以实跑为准）、exit 0
   - 反例：沙箱副本删掉 claim 行的 phys 键 ⇒ 必崩 `KeyError: 'phys'` @:430；契约检查器喂缺键行 ⇒ 必报 missing=3
④ 域守则指针（**必须显式 read**，DSH 无法额外注入）：
   - scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ .gitea/AGENTS.md ｜ memory/notes/AGENTS.md
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | 创始人 2026-10-18 开工令（本轮任务＝交付 1：2.1 修 B6）；`agents/P4-门禁/AGENTS.md` §三/§十；🟡 **未立卡**（立卡后回填 Issue 号） |
| 2 | 归属包 / 产品线 | **P4 门禁**（**治理域**·门禁）｜域：`scripts/control-tower/`、`tests/control-tower/` |
| 3 | 写集 | 见 §2（W1–W3 文件级、两两不重叠；W4 = L1 交付件，**新建**） |
| 4 | 判据 | 见 §4（正常／降级／反例三条）＋ DS-1…DS-8 |
| 5 | 依赖 | 见 §7 前置（交付 0 已合；claims 数据面仍在；**无阻塞**） |
| 6 | 不做什么 | 见 §1 非目标（**逐条路径**） |
| 7 | 回执 | 见 §8（三信号 ＋ R2 ≤10 行；证据＝原始输出，**禁截断**） |

## 权威件回执（派单前实读，读过才写）

| 件 | 位置 | as_of | 读了什么（不是"提过"） |
|---|---|---|---|
| P4 包守则 | `agents/P4-门禁/AGENTS.md` §三/§十/§十二 | `3d379a786` | B6 三条判据／事实落点 2.1 与执行顺序／合并例外／交付 0 规格 |
| 控制塔域守则 | `scripts/control-tower/AGENTS.md` | `3d379a786` | 三态退出码（0/1/2，信号量==0 ⇒ exit 2）／"改坏确实红"留档 |
| 控制塔测试域守则 | `tests/control-tower/AGENTS.md` | `3d379a786` | 零失败才合并／断言不可空壳 |
| 门禁 CI 域守则 | `.gitea/AGENTS.md` | `3d379a786` | 改门禁须独立送审／CI 权威口径 |
| 过程留痕域守则 | `memory/notes/AGENTS.md` | `3d379a786` | 非平凡变更须引四态 Note（铁律 49） |
| `pre-plan-thinking` | `.dsh/skills/pre-plan-thinking/SKILL.md` | `3d379a786` | 9 问顺序 ＋「每问留证据」判据 |
| `dev-doc-spec` v2 | `.dsh/skills/dev-doc-spec/SKILL.md` | `3d379a786` | 8 节必填＋3 条件／封面四行／§5 怎么跑／§8 交什么 |
| `dsh-code-standards` | `.dsh/skills/dsh-code-standards/SKILL.md` | `3d379a786` | 12 项强制项／四既有约定／交付前验证清单 8 条 |
| `CTO-待办总账.md` | handbook 工作副本（`.handbook-p4/`） | 2026-10-18 | 2.1 未立卡／2.11＝⚪ 判据落地（K3 过审后）／2.3 存量基线 |
| `CTO冷启动入口.md` | handbook 工作副本（`.handbook-p4/`） | 2026-10-18 | §2.5 团队机制（P4 不得自建小队）／§三 在飞（交付 0 已合、交付 1＝本卡） |

---

## §〇pre · `pre-plan-thinking` 9 问（**逐问留证据；答不出不许动笔**）

> 证据全量在 `docs/evidence/p4-b6/`（**已被 `.gitignore:81 evidence/` 覆盖 ⇒ 不入库、不脏树**；命令原样可复跑）。
> 🔴 **禁 `head` 截断**：本件摘录均标注「摘录」，全量见对应 `.out`。

| # | 问 | 证据（命令 ⇒ 原始输出，摘录） | 落到 |
|---|---|---|---|
| **①** | 问题：谁在什么场景遇到什么？不做什么？ | `python3 scripts/control-tower/founder-truth.py` ⇒ `exit=1` ＋ `KeyError: 'phys'`（`scripts/control-tower/founder-truth.py:430`）。<br>爆炸半径实测：`generate-dashboard.read_physical_facts()` ⇒ **六维全 `unknown`**，reason 全为 `物理核验降级: 'phys'`（`run-01`／附录 A.2） | §1／§3 |
| **②** | 现状：怎么跑？谁调用？改它波及谁？ | 调用方：`tests/control-tower/founder-truth.test.sh:21`；`scripts/control-tower/generate-dashboard.py:151-156`（`read_physical_facts` → `collect/judge/north_star_alignment`）。<br>数据面（实测）：`.claude/claims/*.yaml` **30** 个；`task-state/*.json` **468** 个；`bypass.log` 2904 B；`PRODUCT-BRIEF.md` 6723 B。<br>跑一遍的原始输出：**9 行**（stderr 1 行迁移期提示 ＋ Traceback），见 `run-01.out` | §3 |
| **③** | 有没有现成的？ | `grep -l "claims" scripts/control-tower/*.py`（除 founder-truth）⇒ **4** 件：`claim_store.py`／`brief_parser.py`／`merge_writeset_gate.py`／`gen-cto-health.py`。<br>⇒ claim **解析**已有单一真源（`claim_store.iter_claims`）；但**没有**任何 "claims → 面板行" 的现成映射 ⇒ 结论：**扩展现有 `collect()` 的行结构**，不新建件、本卡不引入 `claim_store`（见 §6） | §6 |
| **④** | 最小改动：最少改哪里？ | **必须改**：claim 行补 3 键（+3 行）／测试加固（+3 条、收紧 1 条）／取消隔离（−1 行）。<br>**想改但不必要（全部划掉）**：`judge()` 加 ⚪ 分支（= 2.11）／顶层 `try/except → exit 2`／改用 `iter_claims`／修 `generate-dashboard` 的 except／重生成 `SEALED-MANIFEST`（`.github/**` 不在写集） | §2 |
| **⑤** | 最危险的假设：错了最可能是哪条？**先实测** | 假设「只缺 `phys` 一个键」⇒ **实测为假**：`claim row keys = ['claimed','hist','migration','num','source','task_id']`；<br>只补 `phys` ⇒ `north_star_alignment` 抛 `KeyError: 'id'`；补 `id` ⇒ 抛 `KeyError: 'title'` ⇒ **缺 3 键**（附录 A.3） | §3／§7 |
| **⑥** | 失败路径：失败会静默还是报错？**先写反例** | 反例 A（根因）：沙箱副本删掉 claim 行 `phys` ⇒ `KeyError: 'phys'` @:430（附录 A.4）。<br>反例 B（假绿）：旧断言 `grep -qE "🟢|🟡|🔴|⚪"` 在**崩溃输出**上 ⇒ **GREEN（假绿，traceback 源码行含 🟢）**；新断言 `grep -q "小结：🟢"` 在崩溃输出上 ⇒ **RED**，在修复预演输出上 ⇒ **GREEN**（附录 A.5） | §4 |
| **⑦** | 边界：明确不做什么？谁负责那些？ | 逐条路径见 §1 非目标：`scripts/audit/**`（K3）／`scripts/control-tower/probe-*.ts`（M6）／`scripts/control-tower/install-deps.sh`（M1）／`.github/**`／`generate-dashboard.py`／`judge()`／退出码语义 | §1／§7 |
| **⑧** | 可观测：哪个命令/数字能证明它对？ | 一条命令即判：`bash tests/control-tower/founder-truth.test.sh` ⇒ 末行 `结果: 14 通过, 0 失败`、exit 0（N 以实跑为准，N≥14）；<br>辅助：`--offline` 输出末行 `小结：🟢 …` 且无 `Traceback` | §4 |
| **⑨** | 拆步：能拆成可独立验证的步吗？能回滚吗？ | 3 步：**W1** 修行契约（跑通即绿）→ **W2** 测试加固（先有 🔴 再转绿）→ **W3** 取消隔离（门禁重新执行）。<br>每步独立判据、独立回滚（单文件 revert 不牵连） | 封面／§8 |

---

## §1 做什么

**目标（一句话）**：`scripts/control-tower/founder-truth.py` 在 `.claude/claims/` 有数据时**不再崩溃**，把迁移期 claim 行**显式标注为未核验**，并让它重新被门禁发现制执行。

**可观测结果**：
1. `--offline` 跑通、无 `Traceback`、claim 行标注 `未核验（claim 无 D# 锚点）`；
2. `generate-dashboard.read_physical_facts()` 的六维从 `unknown` 恢复为物理事实；
3. 配对测试 `founder-truth.test.sh` **零失败**，且被 CI 发现制重新纳入执行集。

**非目标（逐条列路径；L2 不许碰）**：
- ❌ `judge()` 的判定语义 —— 「⚪ 判据落地」= **2.11**，K3 过审后另开卡（`CTO-待办总账.md` 2.11）
- ❌ 退出码语义（0/1/2 三态）—— 本卡不动 `main()` 的 `return`
- ❌ `scripts/audit/**`（K3 专属）｜`scripts/control-tower/probe-*.ts`（M6 独占）｜`scripts/control-tower/install-deps.sh`（M1 域）
- ❌ `scripts/control-tower/generate-dashboard.py`（它的 `except` 已显式降级；本卡只让它**因上游修好而恢复**）
- ❌ `.github/**`（不在 P4 写集；`SEALED-MANIFEST` 对"新增方向"本来就不告警）
- ❌ `FACE-TOTAL`／`QUARANTINE-TOTAL` 棘轮注释 —— 存量基线归 **2.3**（CTO 裁）；**禁本卡上调**
- ❌ 顶层 `try/except → exit 2`（意外崩溃兜底属另一张卡；本卡用「三键齐」消除已知崩溃路径）

---

## §2 在哪做（**file:line ＋ 写集；两两不重叠**）

### W1 `scripts/control-tower/founder-truth.py`（+3 行）

- **改动点**：`:90-93`（`collect()` 里 claim 行构造）—— 现只有 6 键，补 3 键：

```python
rows.append({
    "task_id": f"#{_cp.stem}", "id": f"#{_cp.stem}", "title": "",
    "num": None, "claimed": "claimed(claim)",
    "phys": "未核验（claim 无 D# 锚点）",   # ← 诚实降级标注：不得写成"无提交记录"（那是假陈述）
    "hist": False, "source": str(_cp.relative_to(REPO)), "migration": True,
})
```

- **不许动**：`:119-127`（task-state／hist 行已有 `id`＋`phys`）；`:131-147` `judge()`；`:422-477` `main()` 的任何 `return`。
- **依据**：消费方逐处核过（`grep -n '\["phys"\]\|\["id"\]\|\["title"\]'`）：`:229/:231/:237`（北星）、`:304/:313`（告警）、`:330/:333`（HTML）、`:430-432/:449-450`（文本面板）——**只用到 `id/title/claimed/phys`**，三键齐即全链路可达。

### W2 `tests/control-tower/founder-truth.test.sh`（+约 40 行）

- `:16-17` 更新"⚠️ 既存红"注释：本卡修复后应全绿；**历史既存红口径作废**（写明依据＝本卡实测）。
- `:61-66` **收紧假绿断言**：把 `grep -qE "🟢|🟡|🔴|⚪"` 改为 `grep -q "小结：🟢" <<< "$OUT"`（理由见附录 A.5：旧断言在崩溃输出上恒真）。
- **新增 3 条断言**（插在 HTML 段之后、FIX-008 段之前）：
  1. **无崩溃**：`OUT` 不含 `Traceback`，且 `GENRUN --offline` 的 `exit ∈ {0,1}`（不许 2、不许崩）。
  2. **claim 行标注**：`grep -qE '^\| #[0-9]+ +\| claimed\(claim\) \| 未核验' <<< "$OUT"`（**不硬编码 issue 号**）。
  3. **契约成对反例（⒜/⒝ 同形，沿用 FIX-008 范式）**：内联 `python3 - "$GEN"`：
     - ⒜ 真行：`collect(offline=True)` ⇒ `missing=0` 且 `claims>0`；
     - ⒝ 合成 legacy claim 行（`{task_id,num,claimed,hist,source,migration}`，**缺 3 键**）⇒ 同一检查器必报 `missing=3`；
     - 断言：`⒜ missing==0` ∧ `⒝ missing==3`（两者同时成立判据才有判别力）。
- **不许动**：FIX-008 ⒜/⒝ 段（`:101-139`，已绿且与本卡无关）；`GENRUN`／`OUTDIR` 注入缝（`:27-29`）。

### W3 `scripts/control-tower/gate-integrity-baseline.txt`（−1 行）

- **改动点**：`:120` 删除单行 `tests/control-tower/founder-truth.test.sh`（**取消隔离**）。
- **理由（实测）**：`sealed-tests.sh --quarantine | grep -c founder-truth` ⇒ **1**；`--list | grep -c founder-truth` ⇒ **0** ⇒ 本测试**当前被排除在 CI 执行集之外**（迁移期提交 `9af6dace9` 的回归因此无人拦）。
- **不许动**：`# FACE-TOTAL=151`、`# QUARANTINE-TOTAL=77` 两行（77 是**上界**，删到 76 合法；上调属 2.3，归 CTO）。

### W4（**不属 L2 写集**；**新建**）`memory/notes/proposed/2026-10-18-p4-b6-founder-truth.md`

- 四态 Note（铁律 49），**由 L1 在验收后写**（路径**新建**，不在本 PR 的写集内）；先例：交付 0 的 `memory/notes/implemented/2026-10-18-p4-package-selfsufficiency-checker.md`（PR #567 已由 CTO 验收）。

**写集两两不重叠**：W1（产品文件）／W2（测试）／W3（台账）互不重叠；W4 由 L1 独占。

---

## §3 凭什么做（**现状证据，逐条可复跑**）

| # | 事实性前提 | 命令 ⇒ 原始输出（摘录；全量见 `docs/evidence/p4-b6/`） |
|---|---|---|
| F1 | 现状崩溃 | `python3 scripts/control-tower/founder-truth.py` ⇒ `exit=1`；`File ".../founder-truth.py", line 430, in <genexpr> green = sum(... judge(r["claimed"], r["phys"]) ...)`；`KeyError: 'phys'` |
| F2 | 崩溃点伪装成"真红" | 同上 `exit=1` —— 三态契约里 1 = **真红**，即"疑似虚报"；检查自身失败混进了业务阻断位（本卡不改退出码，但修复后不再走这条路） |
| F3 | claim 行缺 **3** 键 | 实测 `claim row keys = ['claimed','hist','migration','num','source','task_id']`；只补 `phys` ⇒ `KeyError: 'id'`；补 `id` ⇒ `KeyError: 'title'`（附录 A.3） |
| F4 | 消费方只用到 4 键 | `grep -n '\["phys"\]\|\["id"\]' scripts/control-tower/founder-truth.py` ⇒ 14 处，全在 `id/title/claimed/phys` 范围（`:229/:231/:237/:304/:313/:330/:333/:340/:430-432/:449-450/:452`） |
| F5 | 爆炸半径 = 六维雷达全瞎 | `generate-dashboard.read_physical_facts()` ⇒ 六维 `{"status":"unknown","reason":"物理核验降级: 'phys'"}`；调用链 `src/routes/cockpit.ts:27` → `generate-dashboard.py`（`scripts/control-tower/probe-delivery-hygiene.sh:50` 自述） |
| F6 | 根因提交 | `git log -1 --format='%h %ad %s' -S'"migration": True' -- scripts/control-tower/founder-truth.py` ⇒ `9af6dace9 2026-10-07`，标题「迁移期消费者显式降级（K3 R6/R7 · E4，禁静默空白）」；该提交只写了 6 键 |
| F7 | 配对测试存在但**被隔离** | `bash scripts/control-tower/sealed-tests.sh --quarantine \| grep -c founder-truth` ⇒ `1`；`--list \| grep -c` ⇒ `0` |
| F8 | 测试现状 **5 过 6 败** | `bash tests/control-tower/founder-truth.test.sh` ⇒ 末行 `结果: 5 通过, 6 失败`、`exit=1`（附录 A.2） |
| F9 | 旧断言有**假绿** | 崩溃输出上：旧断言 `grep -qE "🟢|🟡|🔴|⚪"` ⇒ GREEN；新断言 `grep -q "小结：🟢"` ⇒ RED（附录 A.5） |
| F10 | 修补方案**已预演跑通** | 仅在内存里给 claim 行补 3 键（不改产品文件）⇒ `main()` 返回 `rc=1`、**无 Traceback**、1204 行输出、claim 行 `| #1031  | claimed(claim) | 未核验（claim 无 D# 锚点） | ⚪ 进行中 |`、`小结：🟢 真实 298 · 🟡 待复核 66 · 🔴 疑似虚报 50`（活跃 497 ＋ 历史 190）（附录 A.6） |

**若 F1–F10 任一不成立 ⇒ 停，退回 L1**（说明现场已变，规格需重核）。

---

## §4 怎么算做完（**三路径 ＋ DS；反例必红**）

### 正常路径

```bash
# N1 跑通不崩、claim 行标注（真仓库，隔离输出目录）
SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 scripts/control-tower/founder-truth.py --offline > /tmp/n1.out 2>&1
echo "exit=$?"                       # 期望 0 或 1（🔴 50 个 ⇒ 1；不许 2、不许崩）
grep -c "Traceback" /tmp/n1.out      # 期望 0
grep -cE '^\| #[0-9]+ +\| claimed\(claim\) \| 未核验（claim 无 D# 锚点） \|' /tmp/n1.out   # 期望 30（claim 条数，以实跑为准）
grep -q "小结：🟢" /tmp/n1.out && echo PANEL-OK

# N2 配对测试零失败
bash tests/control-tower/founder-truth.test.sh; echo "exit=$?"    # 期望末行「结果: N 通过, 0 失败」、exit=0
```

### 降级路径（**必须仍可触发**）

```bash
GIT_DIR=$(mktemp -d) SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 scripts/control-tower/founder-truth.py --offline; echo "exit=$?"
# 期望 exit=2，stderr 含「degraded: git 不可用」；且不崩（无 Traceback）
```

### 🔴 反例（**改坏必红**，三条，缺一不可）

```bash
# R1 根因反例：沙箱副本删掉 claim 行的 phys 键 ⇒ 必崩（证明"三键齐"是治因，不是掩盖）
SBX=$(mktemp -d); mkdir -p "$SBX/scripts/control-tower" "$SBX/.claude/claims" "$SBX/task-state"
sed 's/"phys": "未核验（claim 无 D# 锚点）",//' scripts/control-tower/founder-truth.py \
  > "$SBX/scripts/control-tower/founder-truth.py"
printf 'writeset: []\n' > "$SBX/.claude/claims/9999.yaml"
SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 "$SBX/scripts/control-tower/founder-truth.py" --offline; echo "exit=$?"
# 期望：Traceback ... KeyError: 'phys'（若仍 exit 0 ⇒ 规格未生效，退回）

# R2 判据判别力：W2 的契约检查器对"缺三键的合成行"必须报 missing=3（由 N2 的断言覆盖）

# R3 假绿反例：把伪造的崩溃输出喂给收紧后的断言 ⇒ 必红
python3 scripts/control-tower/founder-truth.py > /tmp/boom.out 2>&1   # 若本机已修复则用手造 traceback 文本
grep -q "小结：🟢" /tmp/boom.out; echo "exit=$?"   # 期望 1（= 断言失败）——若 0 说明断言又变恒真
```

### DS（交付声明，逐条可核验）

| # | 声明 | 核验命令 | 期望 |
|---|---|---|---|
| DS-1 | claim 行三键齐 | `python3 - "$GEN" <<< ... 缺键检查` | `missing=0`，且 `claims>0` |
| DS-2 | 不再 KeyError | N1 | `grep -c Traceback` = 0 |
| DS-3 | 显式标注、不伪装事实 | N1 | 含 `未核验（claim 无 D# 锚点）` |
| DS-4 | 判定语义未变 | `git diff` 只含 3 个写集文件 | `judge()`/`main()` 0 改动 |
| DS-5 | 六维恢复 | `generate-dashboard.read_physical_facts()` | 不再出现 `物理核验降级: 'phys'` |
| DS-6 | 重新进 CI 发现制 | `SYNO_BASE_REF=origin/local-main bash scripts/control-tower/sealed-tests.sh --list \| grep -c founder-truth` | `1`（改前 `0`） |
| DS-7 | 门禁未新增违规 | `SYNO_BASE_REF=origin/local-main bash scripts/control-tower/check-gate-integrity.sh` | `exit 0` 且末行 `GATE-INTEGRITY: OK`（改前同样 OK，见附录 A.7） |
| DS-8 | 测试零失败 | N2 | `0 失败`、exit 0 |

---

## §5 怎么跑（**L2 fresh 必问的四件：取树／依赖／运行／落盘**）

```bash
# 取树（不在主树干活；主树落后且禁写）
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-p4b6-$(date +%m%d) -B ct/p4-b6-$(date +%m%d) gitea/local-main
cd /Users/wane/SynovaAgent/.synova-wt-p4b6-$(date +%m%d)

# 依赖：无（python3 标准库即可；macOS 实测 Python 3.9.6；无 pip/npm 依赖）
python3 --version

# 运行（不经服务，无端口、无 daemon）
SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 scripts/control-tower/founder-truth.py --offline
bash tests/control-tower/founder-truth.test.sh

# 🔴 门禁类命令必须给 base，否则会看到"继承态红"（不是本卡引入，勿去修）
export SYNO_BASE_REF=origin/local-main
bash scripts/control-tower/sealed-tests.sh --list | grep -c founder-truth      # 改前 0 → 改后 1
bash scripts/control-tower/check-gate-integrity.sh                              # 期望 exit 0 / GATE-INTEGRITY: OK

# 落盘：证据放 docs/evidence/p4-b6/（.gitignore:81 `evidence/` ⇒ 不入库、不脏树）；原始输出全量，禁 head 截断

# 自检（证明环境对）
python3 -c "import sys; print(sys.version.split()[0])" && git rev-parse --short HEAD
```

---

## §6 有什么基础（**禁止重复建设**）

| 能力 | 盘点命令 | 命中 | 结论 |
|---|---|---|---|
| 控制塔脚本总量 | `ls -1 scripts/control-tower \| wc -l`；`find scripts/control-tower -maxdepth 1 -name 'check-*' \| wc -l`；`ls -1 scripts/control-tower/probe-* \| wc -l` | **131** 件／`check-*` **26**／`probe-*` **28** | 复用现有件（本卡不新建脚本）⚠️ 包守则 §八之三 写的「136 件／check-* 62」与实测不符（见附录 B-3） |
| claim 解析单一真源 | `grep -c "^def iter_claims" scripts/control-tower/claim_store.py` | **1**（`iter_claims`） | **本卡不复用**：只补行字段、不改解析口径；**若将来要按 claim 内容核验 ⇒ 必须改用 `iter_claims`（禁再手搓 glob）** |
| 迁移期 claim 的既有处理范式 | `grep -l "claims" scripts/control-tower/*.py`（除 founder-truth） | **4** 件（`gen-cto-health.py` 只计数不造行 ⇒ 正确范式） | 复用范式：**加行就要给全字段** |
| 输出目录注入缝（测试隔离） | `grep -c "SYNO_FOUNDER_OUT_DIR" scripts/control-tower/founder-truth.py` | **2** | 复用（FIX-008 已有；新测试沿用 `GENRUN`） |
| 三态退出码约定 | `grep -l "exit 2" scripts/control-tower/*.sh \| wc -l` | **38** 件 | 复用（本卡不改语义，只保证不再落入"崩=1"） |
| 判别力自检范式（成对反例） | `grep -rl "反例\|改坏" tests/control-tower/*.sh \| wc -l` | **47** 件 | 复用（新断言照 FIX-008 ⒜/⒝ 同形） |
| 配对测试（CT-40） | `ls -1 tests/control-tower/founder-truth.test.sh` | **1** | 复用并加固，不新建测试文件 |
| 隔离台账／发现制 | `bash scripts/control-tower/sealed-tests.sh --quarantine \| wc -l` | **77** | 复用其"删条目=取消隔离"的既有能力（禁上调棘轮） |

**结论**：**零新建**；本卡只是给现有行结构补齐字段 ＋ 加固现有测试 ＋ 一条台账行。

---

## §7 前置与红线

**前置（未满足则停）**：

| 前置 | 判据 | 未满足 |
|---|---|---|
| 分支从 `gitea/local-main` 取（非主树） | `git merge-base --is-ancestor gitea/local-main HEAD; echo $?` ⇒ `0` | 停，重取树 |
| 写集零重叠 | 只改 W1–W3 三文件 | 停，退回 L1 |
| 交付 0（PR #567）已合入 | `git log --oneline gitea/local-main --grep="#567"` 有命中（实测 merge `03992e23c`／实现 `b62fe610e`；⚠️ `origin/local-main` 是陈旧引用，滞后 gitea 侧） | 停，报 L1 |
| 生产数据面仍在（claims 30／task-state 468） | `ls -1 .claude/claims/*.yaml \| wc -l` ⇒ 30（±） | 若 claims=0 ⇒ **本卡无法复现**，停并报 L1 |

**全局红线（逐条路径）**：

```
 ❌ scripts/audit/**（K3 专属）｜❌ scripts/control-tower/probe-*.ts（M6）｜❌ scripts/control-tower/install-deps.sh（M1）
 ❌ judge()／main() 退出码（= 2.11，K3 过审后）｜❌ .github/**（不在写集）｜❌ generate-dashboard.py
 ❌ FACE-TOTAL／QUARANTINE-TOTAL 上调（= 2.3，CTO 裁）｜❌ 主树写码｜❌ git stash
 ❌ 交付件缺 typed error／缺"已知限制"／缺判别力自检 ⇒ L1 不收（本卡沿用既有 `@input/@output/@exit/@degraded` 头）
```

**合并条件（⚠️ 有一处口径冲突，必须由 CTO 一句话定）**：
- 创始人本轮令：**B 类 ⇒ 四条件自合并，不必等 CTO**；
- `agents/P4-门禁/AGENTS.md` §十「合并例外」/ 裁 188：**P4 的 PR 一律不得自合并**（因 P4 改的正是门禁）。
- ⇒ 本件**不自行裁决**：默认按创始人令执行，并在回执「例外清单」点名此冲突；若 CTO 一句话维持合并例外，则本 PR 走"独立复核 ＋ CTO 批"。

---

## §8 交什么（给 L1）

```
 R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据路径 ｜ 未决项
 证据留存：<repo>/docs/evidence/p4-b6/（原始输出全量，禁截断；不入库）
 回执三信号：① 判据通过率（绿/红）② 例外清单 ③ 在飞数
 🔴 不判"通过"：只能给 自验结论 / 可提请独立复核 / 退回（附理由与失败点原文）
```

---

## C1 契约（有脚本改动 ⇒ 必填）

```
 行契约（collect() 返回的 rows 元素）——所有消费方共用：
   {id:str, title:str, claimed:str, phys:str, num:int|None, hist:bool}
   · claim 行额外带 {task_id, source, migration:True}
   · phys 取值域（现有 judge 识别的字面）："degraded" | "已提交且进 main" | "已提交未进 main" | 其它（⇒ ⚪）
   · 本卡新增字面："未核验（claim 无 D# 锚点）" ⇒ 落入 judge 的默认分支 ⚪（**不改 judge**）
 @input / @output / @exit / @degraded：文件头 `:11-18` 原样保留，不改
 错误码：不新增；已知崩溃路径由"三键齐"消除
 降级：git 不可用 ⇒ phys="degraded" ⇒ exit 2（既有，不变）
```

## C2 边界值（有集合/数量参数 ⇒ 必填）

| 边界 | 期望 |
|---|---|
| `.claude/claims/` 不存在 | 不产生 claim 行、不崩、照常 exit 0/1 |
| `.claude/claims/` 存在但 0 个 `*.yaml` | 同上；stderr 不打迁移期行（`_claim_n==0`） |
| claim 文件名非纯数字（如 `_archived`） | 跳过（现状 `stem.isdigit()`，不改） |
| claims=1 ／ =30 ／ 未来更多 | 每行都带三键；行数 = claims 数（实测 30） |
| `task-state/TEMPLATE.json` | 跳过（现状，不改） |
| `phys` 文本含中文/括号/`#` | sed 反例脚本按**整串精确匹配**删键，避免半串残留 |
| git 不可用 | phys="degraded"、exit 2、无 Traceback |

## C3 失效条件（**新增规则/门禁 ⇒ 必填**）

- **何时可撤**：迁移期结束（`.claude/claims/` 退役、`task-state` 恢复唯一真源）⇒ 删 claim 行处理 ＋ W2 对应断言 ＋ W3 台账行，并在 `agents/P4-门禁/AGENTS.md` §十一 记一次审查记录。
- **前提变更不得带病续跑**：若 2.11 落地了显式 ⚪ 判据（judge 新增分支），则本卡的 `phys` 文案与断言 `未核验（claim 无 D# 锚点）` **必须同批更新**（否则文案与判据分叉）；届时由 L1 出新规格，L2 不得自行改判据。

---

## 附录 A · 证据（全量在 `docs/evidence/p4-b6/`；以下为**摘录**）

```
A.1 run-01.out（9 行）：[迁移期] …claim 30 条 / Traceback / line 430 / KeyError: 'phys'
A.2 test-before.out：结果: 5 通过, 6 失败（正常/北星/诚信/降级/HTML/FIX-008⒜-HTML）
A.3 缺键实测：keys=['claimed','hist','migration','num','source','task_id']
     只补 phys → KeyError 'id'；补 id → KeyError 'title'；补 title → north_star_alignment OK
A.4 根因反例（删 phys 键）：KeyError: 'phys'（同 :430）
A.5 假绿对比：崩溃输出上 旧断言 GREEN / 新断言 RED；预演输出上 新断言 GREEN
A.6 dryrun-fixed.out（1204 行）：main() rc=1、Traceback 0 次、claim 行 30 条、
     「小结：🟢 真实 298 · 🟡 待复核 66 · 🔴 疑似虚报 50」（活跃 497 ＋ 历史 190）
A.7 门禁基线（改前，带 base）：sealed --list exit=0（99 条，含 founder-truth 0 条）；
     check-gate-integrity exit=0 / GATE-INTEGRITY: OK；不带 base ⇒ slack 21>10 假红（继承态，勿修）
```

## 附录 B · 例外清单（**不自行处理，报 L1 → CTO**）

1. **合并条件冲突**：创始人令（B 类可自合） vs 包守则 §十/裁 188（P4 不得自合并）—— 见 §7，需 CTO 一句话。
2. **2.1 未立卡**：任务编号缺位（"任务唯一编号 = Issue 号"）⇒ 本件以「2.1」代替，立卡后回填 Issue 号。
3. **包守则数字漂移**：§八之三 写「136 件／check-* 62」，实测 **131 件／check-* 26**（全树 `check-*` 60）⇒ 属事实级偏差，本卡不动（改守则归 P4 后续／P6 事实面），仅登记。
4. **继承态 slack 红**：`--list` 不带 base ⇒ `slack 21 > SLACK-CAP 10` 判红（`origin/main`/`local-main` 同样如此）⇒ 属 **2.3 存量基线**，本卡与 2.11 均不处理。
5. **`2.11` 依赖**：claim 行的颜色语义（⚪ "进行中" vs 🟡 "未核验"）**留待 2.11**（K3 过审后）；本卡只保证"不崩 ＋ 显式标注物理核验口径"。

## 附录 C · 派单内部一致性自检（教训：同一单两条要求对同一路径互斥）

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W3 全在「必须改」；§1 非目标逐条是**不同路径**（audit／probe／install-deps／.github／generate-dashboard／judge）⇒ 零互斥 |
| 判据 vs 红线 | 反例 R1 在**沙箱副本**变异（不写仓库）＋ DS-4 要求 `judge()`/`main()` 零 diff ⇒「改坏必红」不破「不改语义」 |
| 测试断言 vs 数据面 | 新断言用正则匹配 claim 行（**不硬编码 issue 号**）⇒ claims 数量变化不误红 |
| 台账行 vs 棘轮 | 只删隔离条目（77→76 ≤ 上界 77），**不碰** FACE-TOTAL／QUARANTINE-TOTAL ⇒ 不与 2.3 冲突 |
| 合并条件 | §7 已把「创始人令 vs 包守则合并例外」标为**待 CTO 一句话**，本件不自行裁决 |
