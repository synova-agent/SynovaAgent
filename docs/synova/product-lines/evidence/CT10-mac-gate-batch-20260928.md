# CT10-mac — 门禁凑批 9 卡（D1055）

> 任务: D1055 ｜ 分支: `fix/ct10-mac-gates-20260928` ｜ 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct10-mac`
> 成员: ct10-exec（A）｜ 日期: 2026-09-28 ｜ 域: **mac**（与 win golden D1056 分属两个 PR）
> ⚠️ **全文只说「自验结论」，不说「审计通过」**（审计权归 K3）。

## 〇、本批落地范围（先给结论，避免读者以为 9 卡全落地）

| 卡 | 状态 | 说明 |
|----|------|------|
| ① ownership +2 | ✅ 完整落地 | 改前 exit 1 → 改后 exit 0；红→绿证 |
| ④ F-2 跨大小写 D# | ✅ 完整落地 | **额外发现同族第二缺陷：4 位号全失效** |
| ⑦ `--at` 端到端 | ✅ 完整落地 | writer 补 `--at`；calc-progress machine 路径消费 `at` |
| ⑧ 夹具化 | ✅ 完整落地 | 真实 brief 依赖清零；移开两 brief 仍绿 |
| ② A2 假绿 | ✅ 完整落地 | 点级覆盖门；**口径与卡面不符，见 §二** |
| ⑤ diff-filter + PYBIN | ⚠️ **半件** | PYBIN（`pre-dispatch-check.sh:59`）✅ 落地；`A→ACMR` **实测后建议不做**（见 §七 R2） |
| ⑥ 控制塔 3 发现 | ❌ 未动 | 三件目标文件**均不在本卡写集**（见 §七 R3） |
| ⑨ D809 触发器 | ❌ 未动 | 需更大语义变更 + 未定位「三口径」，见 §七 R4 |
| ⑩ O-3 删除类覆盖 | ❌ 未动 | 与 ⑤ 的 R/C 缺口同族，需 CTO 裁定，见 §七 R5 |

---

## 一、① ownership domain_neutral +2

**改前（复现，原始输出）**
```
$ python3 scripts/control-tower/check-ownership.py scripts/archive/gen-survey.py tests/control-tower/grep-oP-regression.test.sh
win  scripts/archive/gen-survey.py
mac  tests/control-tower/grep-oP-regression.test.sh

❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域（无归属 0，域判定豁免 0）
exit=1
```

**改后**
```
·   domain-neutral  scripts/archive/gen-survey.py
·   domain-neutral  tests/control-tower/grep-oP-regression.test.sh

✅ PASS 0 个文件同域: 无归属（无归属 0，域判定豁免 2）
exit=0
```

**为什么这两条是"不可分对"**（实测，不是推测）
```
$ head -c 3 scripts/archive/gen-survey.py | xxd
00000000: efbb bf                                  ...
$ sed -n '206,207p' tests/control-tower/grep-oP-regression.test.sh
#   scripts/archive/ scripts/*.py (6)          — .py 的 BOM 属 PEP 263 可容忍，但仍应清
BOM_PENDING="scripts/archive/gen-survey.py
```
`grep-oP-regression.test.sh` 的 `BOM_PENDING` 棘轮清单语义 = 「全仓 BOM 集合必须与清单**逐条一致**」
（:196-199 自述：新增 BOM → 红；清单条目被清掉却没删 → 也红）。故清 ① 的 BOM 必须**同批**改 ② 的清单。

**改坏即红**
```
$ python3 - <<'PY'   # 摘掉 domain_neutral 末尾两条
... 注入 mutation ...
mutation 已注入
$ python3 scripts/control-tower/check-ownership.py scripts/archive/gen-survey.py tests/control-tower/grep-oP-regression.test.sh
❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] ...
exit=1 (期望 1)
已还原
还原后 exit=0 (期望 0)
```

**条目数 / CODEOWNERS drift**
```
$ python3 -c "... load_ownership(pathlib.Path('docs/synova/coordination/ownership.yaml')) ..."
domain_neutral count = 16 (改前 14)
两新增在列 = True | True

$ python3 scripts/control-tower/check-ownership.py --emit-codeowners > /tmp/co-new.txt; diff /tmp/co-new.txt .github/CODEOWNERS
✅ CODEOWNERS 逐字节一致（drift 0）
```
（`emit_codeowners(rules, github)` 签名不含 `domain_neutral` ⇒ 无需重建 CODEOWNERS，**故未越写集触碰 `.github/**`**。）

**既有测试**
```
$ bash tests/control-tower/check-ownership.test.sh
  ✅ drift: .github/CODEOWNERS 与生成结果逐字节一致
  ✅ 全部通过: 58 项
exit=0 elapsed=3s
```

---

## 二、② A2 假绿（run-machine-evidence.sh）——口径实测 + 修复

### 2.1 🔴 卡面口径与实测不符（逐行点名，先给准确清单）

卡面称「**6 静默跳过 + 3 grep 错位**」。实测（读全文 154 行 + 逐点跑）：

**静默/降级点实测 = 4 处（不是 6）**

| 行 | 行为 | 性质 |
|----|------|------|
| `:48` | 无 `test:` 绑定验收点 → 黄字 + **exit 0** | 真静默（无 degraded 信号；但此时确无点可写，危害低） |
| `:86` | 套件未定位 → 黄字 + `continue`（**登记缺失**） | 🔴 **真静默 + 假绿源头**（见 2.2） |
| `:118` | `SYNO_A2_SKIP_WRITE=1` → **exit 0** | 有意逃生舱（D774，注释已写明理由），非缺陷 |
| `:140` | 同日同源去重 → **exit 0** | 幂等语义，正当 |

对照 fail-closed 点：`:91`（无匹配测试文件 → exit 2）、`:105`（vitest 不存在 → exit 2）✅

**grep 定位点实测 = 1 处（不是 3）**：`:77` `xargs grep -l "$s" | head -1`；
`:80` 是**文件名 glob 回退**（`find -name "*${s}*.test.ts"`），不是 grep。

### 2.2 假绿是怎么产生的（实测数字）

`POINTS`（写进证据的验收点）= 全量 test 绑定验收点；`TEST_FILES`（真跑的）= 能定位到的套件。
**两者从不做交集** ⇒ 未定位套件的验收点照样被写 `pass`。

```
$ python3 -  # 复刻 :77/:80 定位逻辑，逐个套件统计
套件总数 32 | 可定位 15 | 未定位 17
--- 未定位（:86 静默跳过）---
  ? audit-chain / causal-edge-transfer / compaction 套件 / credential-partition /
    customer-config-package 套件 / dsh-agent-loop 锚点 + GS-01 工具调用留痕 / param-calibration /
    settings-applies-live / settings-applies-restart / spill-policy / tenant-isolation /
    time-window-aggregation / token-meter 套件 / usage-by-tenant /
    webhook-inbound-boundary / webhook-outbound / 会话线程
```
即：**32 个套件里 17 个（53%）从未跑过，其验收点却被写成 pass。** 这是"检查没跑 == 检查通过"族的活体样本。

（附带实测：已定位的 15 个里存在**错配**，如 `conversation-engine → tests/contract/llm-failover.test.ts`、
`compute-cash-runway → tests/contract/l4-contract.test.ts` —— `grep -l | head -1` 取首个命中，非确定性归属。
本卡**未**修该错配：正确修法需在 `product-lines.yaml` 里显式声明 suite→file 映射，**该文件不在写集**，见 §七 R1。）

### 2.3 修法（点级覆盖门，非一刀切）

脚本自带契约（`:18`）已写：`@degraded — 测试套件不存在/超时 → 显式 log + **不写 pass 证据**（fail-closed 铁律 11）`。
代码与自己的契约不一致 —— 修复 = 让代码兑现契约。

- `:86` 未定位套件**登记**到 `UNLOCATED`（原文案「跳过该套件」→「登记为未覆盖，不写 pass」）
- 新增 §3b：`EVIDENCE_POINTS` = 只含「全部 `test:` 套件都定位到」的验收点；未覆盖点**显式点名排除**；
  `EVIDENCE_POINTS` 为空 → **exit 2**（对齐 `:91`）
- 去重块与 `evidence-writer` 调用改用 `EVIDENCE_POINTS`（原为全量 `POINTS`）

**为什么不一刀切 `exit 2`**：17/32 未定位 ⇒ 一刀切会让**已覆盖的 15 个套件也失去证据**，
以"诚实"之名打掉真阳性。正确粒度是**点级**。

### 2.4 行为验证（不是 grep 静态判据）

```
$ python3 /tmp/ct10mac-probe/gate2.py ""              # 未覆盖集=空
35                                                    # ⇒ 与旧行为一致（无回归）

$ python3 /tmp/ct10mac-probe/gate2.py "audit-chain"
34                                                    # ⇒ 少 1 点
因 audit-chain 未定位而被排除的点: ['24-4']            # ⇒ 该点不再被写成 pass（改前会）

$ python3 /tmp/ct10mac-probe/gate2.py "<全部 32 套件>"
未覆盖集=全部 32 套件 → covered = '20-2,20-3,21-3,25-6'
```
⚠️ **如实记录**：最后一例**未**触发 `exit 2` —— 因这 4 个点的 `test:` 套件名不在「按 `evidence: [...]` 正则
抽取的 32 套件」集合内（抽取面与 `list-test-points.py` 的点集口径不完全重合）。
⇒ **`exit 2` 分支是构造存在、本轮未在真实数据上触发**；不宣称它已被实测覆盖。
```
$ bash -n scripts/product-lines/run-machine-evidence.sh
bash -n OK
```

---

## 三、④ F-2 跨大小写 D# 抽取（+ 同族第二缺陷）

### 3.1 卡面事实复现

```
$ # B2 出库报告原文条目（docs/synova/product-lines/evidence/D1050-B2/excluded-briefs.json）
{
  "path": ".claude/task-briefs/2026-09-24-B3-d922-fixture-registry.md",
  "d_number": null,
  "task_state_status": "__no_did__",
  "recent_14d": true,
  "exclusion_codes": ["X5"],
  "reasons": ["近 14 天有活动：git log 末次触碰 2026-09-25 ≥ 2026-09-14"]
}
```
⇒ **复现成立**：小写 `d922` → `d_number=null` → `task_state_status=__no_did__` → **X4 永不生效**，
该件只靠 X5（近 14 天）**偶然**留下。

**X4 判据已落地核实**（`X4 = task-state status ∈ {claimed, in_progress, spec_done}`）：
```
$ python3 -c "import json;print(json.load(open('task-state/D922.json'))['status'])"
spec_done
```
⇒ 该件**本就该由 X4 保留**（在飞程序卡 D922），不靠 X5。

（"全量扫描风险面恰好 1 件"✅ 成立：`d_number` 为空的共 4 件 ——
`B3-d922-fixture-registry.md` / `B5-taskstate-backfill.md` / `M9-gate-integrity.md` / `brief.md`，
后三件文件名里**确实没有 D#**，只有 d922 那件是"有小写 D# 却抽不到"。）

### 3.2 🔴 额外发现：同族第二缺陷（4 位号全失效）

`D_RE = re.compile(r"\bD(\d{3})\b")` 的 `\d{3}` 是**恰好 3 位**：
```
$ python3 -c "import re;R=re.compile(r'\bD(\d{3})\b');[print(repr(s),'→',R.findall(s)) for s in ['D922','d922','D1055','D355-D360']]"
'D922'     → ['922']
'd922'     → []
'D1055'    → []          ← 4 位号整条抽不到
'D355-D360'→ ['355', '360']
```
影响面（实测）：
```
$ ls .claude/task-briefs/ | grep -oE "[Dd][0-9]{4}" | sort -u | wc -l
8            # D1007 D1014 D1023 D1028 D1031 D1034 D1044 D1050
$ ls task-state/ | grep -E "^D[0-9]{4}\.json$" | wc -l
7
```
⇒ 注册表已进入 4 位号时代，`aggregate-todos.py` 对**当前所有在飞任务**的 D# 引用都是瞎的。

### 3.3 修改

| 位置 | 改前 | 改后 |
|------|------|------|
| `aggregate-todos.py:54` | `r"\bD(\d{3})\b"` | `r"\b[Dd](\d{3,})\b"` |
| `aggregate-todos.py:101` | `r"D(\d{3})\s*-\s*D(\d{3})"` | `r"[Dd](\d{3,})\s*-\s*[Dd](\d{3,})"` |

**为何用 `{3,}` 而非卡面建议的 `\d+`**：纯 `\d+` 会把 `D1`/`d2` 这类 1-2 位噪音抽成 `D001`/`D002`
并写进 `todos.depends` ⇒ **造出一个不存在的依赖**（宁缺勿造）。仓内 `task-state` 实测下限 = D356
（B2 报告 `registry_d_number_floor: 356`），`{3,}` 对真实任务号完备，只滤噪音。

**改后实测**
```
$ python3 -c "... 加载 aggregate-todos.py，打印 D_RE.findall ..."
'D922'                                       → ['922']
'd922'                                       → ['922']    ← F-2 修复
'D1055'                                      → ['1055']   ← 第二缺陷修复
'2026-09-24-B3-d922-fixture-registry.md'     → ['922']    ← 当事件修复
'D355-D360'                                  → ['355', '360']
'D922 = spec_done'                           → ['922']
'D1'                                         → []         ← 不造 D001
'd2'                                         → []         ← 不造 D002
'xd922y'                                     → []
'Merge 800724d8 into 1234567890abcdef'       → []         ← 不误吞 SHA（task-1 CT-C 同族陷阱）
'abc4d123f'                                  → []         ← 同上
```

### 3.4 同族扩展（⑤ 范围内，`pre-dispatch-check.sh`）

`pre-dispatch-check.sh:28` 亦为 `grep -oE 'D[0-9]{3}'` ⇒ 派单文档里的 4 位号整条漏检。改为
`grep -oE '[Dd][0-9]{3,}' | tr 'a-z' 'A-Z' | sort -u`。**行为验证**（拿本卡派单文本当夹具）：
```
$ bash scripts/control-tower/pre-dispatch-check.sh /tmp/ct10mac-probe/dispatch-fixture.md
── ① 任务号真实性（禁臆写，需 task-state 存在）──
  ✅ D1031 已登记          ← 改前：小写 d1031 抽不到，此条不存在
  ⚠️ D1055 无 task-state（新建须走 alloc-task-id.sh）   ← 改前：4 位号整条不存在
  ✅ D922 已登记
```

---

## 四、⑦ `--at` 端到端（writer 产出 → calc-progress 消费）

### 4.1 改前：writer 不产出 `at`，machine 路径不消费 `at`

- `evidence-writer.py` 参数表无 `--at`；`record` dict 无 `at` 键（实测 `grep -n '"at"'` 零命中）
- `calc-progress.py:669` machine 分支：`git_touched_after(line_modules, latest["date"], git_cmd)`
  —— 与 `:631`/`:646`（passes 路径，传 `evidence_at=latest.get("at")`）**口径不一致**

### 4.2 改后

- writer：新增 `--at`（缺省 = 当前时刻），写入 `record["at"]`；非法格式 → **exit 2**（fail-closed，不静默丢弃）
- calc-progress：`:658` 同日以 `(date, at)` 决胜；`:669` 改 `latest.get("at") or latest["date"]`

### 4.3 行为验证（stub `git_cmd` 记录 **实际收到的 `--since=`**，不是读源码）

```
$ STUB_LOG=... python3 /tmp/ct10mac-probe/probe7.py
A 单条带 at      → status = pending_k3
B 同日两条(08/19) → status = pending_k3
C 无 at（回退）   → status = pending_k3
=== stub 实际收到的 --since ===
1 log --since=2026-09-28T19:30:00 ... -- scripts/product-lines     ← A：消费 at ✅
2 log --since=2026-09-28T19:30:00 ... -- scripts/product-lines     ← B：同日取较晚 at ✅
3 log --since=2026-09-28T00:00:00 ... -- scripts/product-lines     ← C：无 at 回退 date-only ✅
```

**改坏即红**（把 `:658`/`:669` 回退成 date-only）
```
mutation 已注入（回退到 date-only）
=== 改坏后 stub 收到的 --since ===
1 log --since=2026-09-28T00:00:00 ...
2 log --since=2026-09-28T00:00:00 ...      ← B 退化为"取首条"，at 决胜失效
3 log --since=2026-09-28T00:00:00 ...
已还原
=== 还原后 --since ===
1 log --since=2026-09-28T19:30:00 ...
2 log --since=2026-09-28T19:30:00 ...
3 log --since=2026-09-28T00:00:00 ...      ← 回退路径保持
```

**writer 侧**
```
$ python3 scripts/product-lines/evidence-writer.py --type test --date 2026-09-28 --at 2026-09-28T19:30:00 \
    --verdict pass --points 7-1 --source "ct10 probe" --out-dir /tmp/ct10mac-ev
{ "schema": 1, "record_type": "test", "source": "ct10 probe",
  "date": "2026-09-28", "at": "2026-09-28T19:30:00", ... }

$ python3 ... --at "not-a-time" ...
ERROR --at 格式非法: 'not-a-time'（需 ISO8601，如 2026-09-28T19:30:00）
exit=2

$ python3 ... （不给 --at）
at = 2026-09-28T19:56:12        ← 缺省 = 当前时刻
```

---

## 五、⑧ 夹具化（brief-parseable.test.sh）

### 5.1 改前：两个真实仓 brief 被当夹具

`:98` 用 `.claude/task-briefs/D312-baseline-tools.md`；`:110` 用 `.claude/task-briefs/2026-08-02-D286-GraphStore-unify.md`。
⇒ 这两件生产资产被永久绑进测试：出库/归档必须为测试让路。

### 5.2 改后：自带临时夹具（`$TMP_DIR/bp-fixture-{q2,legacy}.md`）

原断言契约**逐条保留**（`--q2-include` 能抽出 `hook-git-guard.sh` / `baseline-check.sh`；
legacy 形态只报 `#CRITERIA 缺失`，不报 Q2 / 架构层假失败）。

```
$ bash tests/control-tower/brief-parseable.test.sh
  ✅ 自带夹具提取到 hook-git-guard.sh
  ✅ 自带夹具提取到 baseline-check.sh
  ✅ legacy 夹具报 #CRITERIA 缺失（真实缺失项）
  ✅ legacy 夹具不报 Q2 假失败（python 可用时）
  ✅ legacy 夹具不报架构层假失败（夹具有 L4）
  ✅ checker 有 PYBIN 解析（D317 跨平台回退）
  结果: 12 通过, 0 失败     exit=0
```

### 5.3 改坏即红（真正的行为对照，不是 grep）

把两个真实 brief **物理移开**后跑两侧：

| 侧 | 结果 |
|----|------|
| **改前**版本（`git show HEAD:…`）+ 两 brief 移开 | `7 通过, 2 失败` — `❌ D312 brief 不存在` / `❌ D286 brief 不存在`，**exit=1（红）** |
| **改后**版本 + 两 brief 移开 | `12 通过, 0 失败`，**exit=0（绿）** |

⇒ 依赖已真正解除（不是靠注释声明）。两 brief 均 tracked，操作后 `git checkout --` 还原，
`git status --short` 仅剩本卡 7 个有意改动。

---

## 六、⑤ PYBIN（`pre-dispatch-check.sh`）

**改前**：`:59` `python3 "$CITE_PY" "${CITE_ARGS[@]}"` —— 裸 `python3`
（`:107` 的 curl|python3 已带 D520 豁免声明，未动）。

**改后**：新增 PYBIN 三级探测（与 `check-pr-budget.sh:94-96` / `check-gate-integrity.sh:146-148` 同款），
并且**只探存在性不够** —— 必须 `-c "import sys"` 试运行（ctrl-tower-change 模式 1：损坏 shim 会静默漏拦）。
PYBIN 全不可用 → **显式 degraded 提示**，不当作通过。

**验证**
```
$ bash -n scripts/control-tower/pre-dispatch-check.sh
OK
$ bash scripts/control-tower/pre-dispatch-check.sh /tmp/ct10mac-probe/dispatch-fixture.md
── ⑥ 引用可核验（D919: 全量不截断 + 含 .md/.html/.txt + 仓外根 + 错误码可归因）──
  ✅ 引用全部可核验（0 条）        ← 经 $PYBIN 执行成功，且未打印 PYBIN degraded
```

---

## 七、自验结论与遗留清单

### 自验结论

**自验结论：可提请独立审计**（⚠️ 其中 ⑤ 为半件，见下表）。

| 统判据 | 状态 | 依据 |
|--------|------|------|
| ① 每条有「改坏即红」反例 | ✅（①②④⑦⑧） | §一（摘 domain_neutral → FAIL）、§二（35→34 点）、§三（`d922`→`[]`）、§四（`--since` 回 `T00:00:00`）、§五（移开 brief → exit 1） |
| ② 改前/改后原始输出 | ✅ | 逐节给出 |
| ③ 不留「未接线/待后续」 | ⚠️ **部分** | ⑤⑨⑩ 未落地、⑥ 未动 —— **均给出实测理由与归属**，非静默跳过（见下） |
| ④ 数字来自命令原始输出 | ✅ | 全文数字均附命令 |

⚠️ **不宣称「门禁被验证」**：本次只证明上述 5 卡的判据宽度/可见性被修正，**不**表示门禁整体可信度已提升。
⚠️ **本批暴露的既有缺陷（已如实记录，未掩盖）**：A2 有 17/32 套件不可定位（53%）；已定位的 15 个里存在 suite→file **错配**。

### 遗留清单

| # | 遗留项 | 性质 | 建议 | 归属 |
|---|--------|------|------|------|
| **R1** | A2 套件**错配**（`grep -l \| head -1` 取首个命中，如 `conversation-engine → tests/contract/llm-failover.test.ts`）；且 17/32 套件根本不可定位 | 真实缺陷（本卡只做了"不再谎报 pass"，未修归属正确性） | 正解 = 在 `docs/synova/product-lines/product-lines.yaml` 显式声明 suite→测试文件映射 —— **该文件不在本卡写集**，需扩写集 | 队长 / CTO |
| **R2** | ⑤ 的 `--diff-filter=A→ACMR` **建议不做** | **实测反对** | `pre-commit-check.sh:458` `NEW_IMPL` 靠该变量判断"新实现文件须配对测试"；放宽到 ACMR ⇒ **修改过的** src/ 文件也被当新增 ⇒ 组 2 全队误报。真正的缺口是 **rename/copy 对 A 不可见**，应**新增** `R/C` 变量而非放宽 `A`（与 ⑩ O-3 同族） | CTO |
| **R3** | ⑥ 三条发现（无参默认 base 误导 / devdoc 写集表首列 ID 致 S2 静默失效 / `synova-commit` no-op exit 0）**未动** | **写集外** | 目标文件 `devdoc_writeset.py` / `merge_writeset_gate.py` / `synova-commit` 均不在本卡 `write_scopes`。我自己只复现到：`check-pr-budget.sh` 无参在本树输出 `0 文件 / PASS`（**未复现**「385 假阳性」）；`grep -n "tests/ci" ci.yml` 零命中（与本批 R1 无关的另一件） | 队长 / CTO |
| **R4** | ⑨ D809「三口径打架」复原触发器**未动** | 需更大语义变更 | 已定位候选面：`calc-progress.py:245`（「两源对账：V1 断言表该线撤回行 vs 提交件该线值」）、`:260`（不一致即 `sys.exit` 要求人工裁决）、`:330/:336`（撤回集 ∩ 分母 / `state_unknown = uncommitted − 撤回数`）、`:475-481`（`read_withdrawn_points` 读 V1 表「证据」列 = pending_wiring）。「三口径」= **V1 断言表撤回标记 / 提交件推算 / yaml 点集**；缺的是"接线完成后把 `pending_wiring` 改回 `test`"的提醒机制 | 队长 / CTO |
| **R5** | ⑩ O-3（G6 跳过 / G10 幽灵 / G12 仅 ACMR ⇒ 删除类 PR 缺门禁覆盖）**未动** | 需 CTO 裁定 + 可能扩写集 | 与 R2 同族；`scripts/pre-commit-check.sh` 虽在写集内，但"给 G6/G10/G12 补删除类覆盖"是**门禁语义变更**，不应在凑批里夹带 | CTO |
| **R6** | ② 的 `exit 2`（零覆盖）分支**未在真实数据上触发** | 如实记录 | 因抽取面与 `list-test-points.py` 口径不完全重合，仍有 4 点恒被覆盖；分支为构造存在，不宣称已实测 | 后续 |

---

## 八、`git diff --stat`（原始输出）

```
$ git diff --stat
 docs/synova/coordination/ownership.yaml       |  12 ++-
 scripts/control-tower/pre-dispatch-check.sh   |  17 ++++-
 scripts/product-lines/aggregate-todos.py      |  16 +++-
 scripts/product-lines/calc-progress.py        |   9 ++-
 scripts/product-lines/evidence-writer.py      |  22 +++++-
 scripts/product-lines/run-machine-evidence.sh |  52 ++++++++++++-
 tests/control-tower/brief-parseable.test.sh   | 101 ++++++++++++++++++++++----
 7 files changed, 199 insertions(+), 30 deletions(-)

$ git diff --numstat
11	1	docs/synova/coordination/ownership.yaml
14	3	scripts/control-tower/pre-dispatch-check.sh
14	2	scripts/product-lines/aggregate-todos.py
7	2	scripts/product-lines/calc-progress.py
20	2	scripts/product-lines/evidence-writer.py
48	4	scripts/product-lines/run-machine-evidence.sh
85	16	tests/control-tower/brief-parseable.test.sh
```
（另有本卡治理产物未计入 `git diff`：本证据文件、`task-state/D1055.json`、D1055 brief。）

## 九、语法/编译自检

```
$ bash -n scripts/control-tower/pre-dispatch-check.sh
OK
$ bash -n scripts/product-lines/run-machine-evidence.sh
bash -n OK
$ bash -n tests/control-tower/brief-parseable.test.sh
bash -n OK
$ python3 -m py_compile scripts/product-lines/{aggregate-todos,calc-progress,evidence-writer}.py
（见 §十 原始输出）
```

## 十、Agent 自检 5 问

1. **接线检查**：①/⑤ 用被改脚本自身跑出改后输出（`check-ownership.py` / `pre-dispatch-check.sh`）；
   ⑦ 用 stub 观察 `git_cmd` 实际收到的 `--since=`；② 用 `--skip-vitest` 实跑 + 门控逻辑行为探针；
   ⑧ 用真实 brief 移开/还原做行为对照。**均非纸面声明**。
2. **异常处理**：⑦ 的 `--at` 非法 → exit 2（fail-closed，不静默丢弃）；⑤ PYBIN 全不可用 → 显式 degraded；
   ② 未覆盖 → 显式点名 + 排除，全无覆盖 → exit 2。均无空吞。
3. **类型安全**：无 `as any`/`as never`/`as unknown as`（本批以 .sh/.py 为主）。
4. **测试质量**：⑧ 夹具 12 断言全绿 + 真实 brief 移开对照；①②④⑦ 均给出 mutation 判别输出。
5. **残留清理**：mutation 全部 `trap`/显式还原（`git status --short` 仅 7 个有意改动）；
   探针文件 `/tmp/ct10mac-probe/*`、`/tmp/ct10mac-ev/*` 均在仓外；无临时探针留在仓内。
