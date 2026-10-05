# D923 前置证据 ②：`pre-audit-summary.sh` 接线可行性（CTO 裁定 7「接线优先，禁新建」）

- **卡号**：D923（K3 必经合并门禁）
- **证据件**：裁定 7「读全文 + 判输入/输出/退出码契约能否承载『按 PR 变更路径判定 + 读 K3 结论 → 三态』+ 实跑」
- **被读脚本**：`scripts/control-tower/pre-audit-summary.sh`（`wc -l` = **166**，与派单件所述一致）
- **测量时刻（截至）**：**2026-09-23T16:48+0800**（本地时）＝ 2026-09-23T08:48Z
- **被测仓库态（截至上述时刻）**：`main` @ `967a58e58292f4de3d49ad61ee263a357d88feac`，工作区干净
- **执行人**：d923-prep（编码成员）
- **性质**：**只给事实 + 实测值 + 建议**。本文件**不下「通过 / 不通过」结论**。

---

## 一、实跑：当前退出码与输出（原始输出，无截断）

### 1.1 文本模式（默认）

```
$ bash scripts/control-tower/pre-audit-summary.sh
── 机器预审汇总（U8 第0层, K3 语义终审前物理预检）──

  ✅ U1-bypass-reconcile: 绕过证据链对账
  ✅ U2-writeset-reconcile: dev doc 写集双向对账
  ❌ U3-artifact-repro: 生成器产物可复现
  ✅ U4-claims-table: 声称↔证据自证表
  ✅ U7-ct-test-gate: 控制塔脚本测试门禁

❌ 机器预审未过: 1 项未过 — 打回，不浪费 K3 语义大脑
$ echo $?
1
```

**退出码 = 1**（不是 D430 时代的 exit 2）。**「D430 死引用导致 exit 2 恒不通过」的现象已不复现**：U1/U2/U4/U7 四面门禁实测全绿（各自直跑退出码 0）。

```
$ bash scripts/control-tower/check-bypass-log.sh origin/main >/dev/null 2>&1; echo $?
0
$ bash scripts/workflow/check-dev-doc-write-set.sh >/dev/null 2>&1; echo $?
0
$ bash scripts/control-tower/ct-test-gate.sh >/dev/null 2>&1; echo $?
0
```

### 1.2 带 `--task-id`

```
$ bash scripts/control-tower/pre-audit-summary.sh --task-id D923
── 机器预审汇总（U8 第0层, K3 语义终审前物理预检）──

  ✅ U1-bypass-reconcile: 绕过证据链对账
  ✅ U2-writeset-reconcile: dev doc 写集双向对账
  ❌ U3-artifact-repro: 生成器产物可复现
  ✅ U4-claims-table: 声称↔证据自证表
  ✅ U7-ct-test-gate: 控制塔脚本测试门禁

风险分级: D923 → risk=medium
建议审计深度: 中风险 → 机器预审 + K3 抽查(偏全量)

❌ 机器预审未过: 1 项未过 — 打回，不浪费 K3 语义大脑
$ echo $?
1
```

### 1.3 `--json` 模式（**关键缺陷**）

```
$ bash scripts/control-tower/pre-audit-summary.sh --json
{"component": "pre-audit-summary", "verdict": "fail", "pass": 4, "fail": 1, "degraded": 0, "missing": 0, "risk": "?", "suggested_audit": "未标风险 → 默认按 medium（建议派活时由 CTO/创始人标 risk）", "gates": [{"gate": "U1-bypass-reconcile", "status": "pass", "desc": "绕过证据链对账"}, {"gate": "U2-writeset-reconcile", "status": "pass", "desc": "dev doc 写集双向对账"}, {"gate": "U3-artifact-repro", "status": "fail", "desc": "生成器产物可复现"}, {"gate": "U4-claims-table", "status": "pass", "desc": "声称↔证据自证表"}, {"gate": "U7-ct-test-gate", "status": "pass", "desc": "控制塔脚本测试门禁"}]}
$ echo $?
0
```

**`--json` 模式下 `verdict":"fail"` 但退出码 = 0。** 源码定位：

```
$ grep -n 'exit 0' scripts/control-tower/pre-audit-summary.sh
137:  exit 0
165:exit 0
```

`pre-audit-summary.sh:137` 位于 JSON 分支内，**在打印 JSON 后无条件 `exit 0`**，正常的三态判定（L158-165）被绕过。→ 任何 CI job 以 `--json` 消费它，**永远不会红**（fail-open）。

### 1.4 U3 门禁的真实失败原因：**不是业务失败，是脚本崩溃（AttributeError）**

```
$ python3 scripts/control-tower/gen-cto-health.py --strict
Traceback (most recent call last):
  File "/Users/wane/SynovaAgent/scripts/control-tower/gen-cto-health.py", line 613, in <module>
    sys.exit(main())
  File "/Users/wane/SynovaAgent/scripts/control-tower/gen-cto-health.py", line 563, in main
    t, ts_meta = analyze_task_state()
  File "/Users/wane/SynovaAgent/scripts/control-tower/gen-cto-health.py", line 305, in analyze_task_state
    spec_path = (d.get("spec") or {}).get("path")
AttributeError: 'str' object has no attribute 'get'
$ echo $?
1
```

不带 `--strict` 同样崩溃（同一 traceback，exit 1）：

```
$ python3 scripts/control-tower/gen-cto-health.py
（同上 traceback）
$ echo $?
1
```

**崩溃根因（实测）**：`gen-cto-health.py:305` 假定 `task-state/<D#>.json` 的 `spec` 字段是 **dict**（`{"path": ...}` 形态）。实测 **108 张卡的 `spec` 是字符串**：

```
$ python3 - <<'PY'
import json, glob
c=0
for f in sorted(glob.glob('task-state/*.json')):
    s=json.load(open(f,encoding='utf-8')).get('spec')
    if s is not None and not isinstance(s, dict): c+=1
print(c)
PY
108
```

按 `sorted(TASK_STATE_DIR.glob("*.json"))` 的迭代顺序，**第一个崩溃源是 `task-state/D598.json`**（`spec` = `"docs/plans/codex/implementation/SYNOVA-IMPL-D598-..."`）。

**引入时点（实测，用 `git cat-file --batch` 逐 blob 解析该提交时点的 task-state 全集）**：

| 时点 | task-state 卡数 | `spec` 为 dict | `spec` 为 null | `spec` 为 str |
|---|---|---|---|---|
| `1c084775`（`gen-cto-health.py` **最后一次改动**，2026-09-06） | 165 | 64 | 100 | **0** |
| `967a58e5`（main HEAD，截至 2026-09-23T16:48+0800） | 347 | 79 | 160 | **108** |

→ **2026-09-06 时 0 张 string-spec 卡，生成器可跑；此后卡面 schema 漂移出 108 张，生成器被首次触发即崩。** 这与证据 ③（audit 段 schema 异构）同族：`task-state/*.json` **没有 schema 约束**。

**连带影响（ctrl-tower-change 模式 1 语义）**：崩溃的 python 以 exit 1 退出，而 `run_gate()`（L74-87）把 `returncode==1` 映射为「业务 fail」，把其它非零映射为 `2=degraded`。→ **U3 的「检查本身执行失败」被误报为「检查发现问题」**；`pre-audit-summary.sh` 的三态输出在此处**不可信**。

---

## 二、脚本的输入 / 输出 / 退出码契约（读全文后逐项列出）

### 2.1 `@input`（源码实测）

```
$ sed -n '32,40p' scripts/control-tower/pre-audit-summary.sh
JSON_OUT="no"
TASK_ID=""
for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUT="yes" ;;
    --task-id) TASK_ID="${2:-}"; shift 2 ;;
    *) : ;;
  esac
done
```

**只有两个开关，没有任何「变更路径 / base ref / K3 结论」入口。**

| 输入 | 类型 | 实际用途（源码行） |
|---|---|---|
| `--json` | 布尔开关 | 改输出格式（L123-138） |
| `--task-id <D#>` | 字符串 | **仅**用于 `risk_of()` 查 `risk` 字段（L113-115） |

`risk_of()` 全文（唯一读 task-state 的地方）：

```
$ sed -n '53,59p' scripts/control-tower/pre-audit-summary.sh
risk_of() {
  local tid="$1"
  [ -z "$tid" ] && { echo "?"; return; }
  local f="$REPO_DIR/task-state/${tid}.json"
  [ -f "$f" ] || { echo "?"; return; }
  python3 -c "import json,sys; d=json.load(open('$f')); print(d.get('risk','medium'))" 2>/dev/null || echo "?"
}
```

**只读 `risk`，不读 `audit` / `verdict` / `status`。**

门禁清单是**5 条硬编码常量**（L43-51）：

```
$ sed -n '43,51p' scripts/control-tower/pre-audit-summary.sh
GATES=(
  "U1-bypass-reconcile|scripts/control-tower/check-bypass-log.sh|origin/main|绕过证据链对账"
  "U2-writeset-reconcile|scripts/workflow/check-dev-doc-write-set.sh||dev doc 写集双向对账"
  "U3-artifact-repro|scripts/control-tower/gen-cto-health.py|--strict|生成器产物可复现"
  "U4-claims-table|scripts/control-tower/verify-claims-table.sh|@DEV_DOCS|声称↔证据自证表"
  "U7-ct-test-gate|scripts/control-tower/ct-test-gate.sh||控制塔脚本测试门禁"
)
```

### 2.2 「无路径感知 / 无 K3 结论读取」的 grep 实证

```
$ grep -nE 'verdict|audit|diff|changed|git |CHANGED|paths?' scripts/control-tower/pre-audit-summary.sh | grep -v '#' ; echo "命中: $(grep -cE 'verdict|diff|changed_files|git ' scripts/control-tower/pre-audit-summary.sh)"
132:verdict = "fail" if fail_n > 0 else ("degraded" if (degraded_n + missing_n) > 0 else "pass")
133:print(json.dumps({"component": "pre-audit-summary", "verdict": verdict,
135:                  "risk": risk, "suggested_audit": suggest, "gates": results}, ensure_ascii=False))
命中: 2
```

**全脚本中与「verdict」相关的仅 2 处，且都是它自己输出 JSON 的键名；无一处 `git diff` / `changed` / `paths` / 读 `audit` 段的逻辑。**

### 2.3 `@output`

| 模式 | 形态 |
|---|---|
| 文本 | 5 行 `✅/❌/⚠️/⏳` 逐门禁 + 汇总行 + （若给 `--task-id`）risk 与建议审计深度 |
| `--json` | 单行 JSON：`{component, verdict, pass, fail, degraded, missing, risk, suggested_audit, gates[]}` |

### 2.4 `@exit`（L158-165）

| 码 | 条件 | 语义 |
|---|---|---|
| 0 | `FAIL_N == 0` 且 `DEGRADED_N + MISSING_N == 0` | 五门禁全过 |
| 1 | `FAIL_N > 0` | 有门禁业务失败 |
| 2 | `DEGRADED_N + MISSING_N > 0` | 有门禁降级/未落地 |

**例外**：`--json` 分支（L137）**无条件 exit 0**。

### 2.5 被测方内部单测（可参照的既有验收）

```
$ git grep -In 'pre-audit-summary' -- tests/ | head -3
tests/control-tower/pre-audit-summary.test.sh:17:TOOL="$REPO/scripts/control-tower/pre-audit-summary.sh"
tests/control-tower/pre-audit-summary.test.sh:22:echo "=== U8 pre-audit-summary 测试 ==="
tests/control-tower/pre-audit-summary.test.sh:50:if echo "$JSON" | python3 -c "..."
```

（本件**未跑**该测试 —— 派单禁令「禁跑重型验证」；`ct-test-gate.sh` 直跑退出码 0，说明其纳入的测试集当前为绿。）

---

## 三、能否承载「按 PR 变更路径判定 + 读 K3 结论 → 三态」：逐条实测

裁定 3 的目标语义（供对照）：
> ① K3 PASS → 绿；② K3 CONDITIONAL/FAIL → 红 + 附理由；③ K3 无结论 → 红 +「排队中」提示。20% 抽样路径永不阻断，只记录。交付物是一个**永远会跑的 CI job**。

| # | 裁定 3 要求 | `pre-audit-summary.sh` 现状 | 实测证据 | 结论 |
|---|---|---|---|---|
| 1 | **输入 PR 变更路径** | 无此输入 | §2.1（只有 `--json`/`--task-id`）+ §2.2（0 处 diff/paths 逻辑） | ❌ **不能承载** |
| 2 | **读 K3 结论（`task-state/*.json` 的 `audit.verdict`）** | 只读 `risk` | §2.1 `risk_of()` 全文；§2.2 grep = 2 处均为自身输出键 | ❌ **不能承载** |
| 3 | 三态退出码（绿/红/降级） | 有，但**语义是「五门禁聚合」，不是「K3 结论」** | §1.1 实跑（U3 崩→报 ❌ 而非 ⚠️） | ⚠️ **形态在、语义不对** |
| 4 | 三态必须可靠（红=真红） | U3 崩溃被映射为「业务失败」而非「执行失败」 | §1.4 traceback + `run_gate` L74-87 的 returncode 映射 | ❌ **当前红是误报** |
| 5 | CI job 消费必须不会被 fail-open | `--json` 模式恒 exit 0 | §1.3（`verdict":"fail"` 却 `exit 0`）+ L137 | ❌ **fail-open** |
| 6 | 门禁要能按 PR 传入文件清单 | `run_gate` 的 args 是 `GATES` 常量字符串，无注入缝 | §2.1 `GATES` + L102 `run_gate "$gscript" $gargs`（`gargs` 为静态值） | ❌ **不能承载** |
| 7 | 20% 抽样路径「只记录不阻断」 | 无抽样概念 | §2.2 | ❌ **不能承载** |

**判定（事实性，不含通过/不通过）**：截至 2026-09-23T16:48+0800，`pre-audit-summary.sh` 的输入/输出/退出码契约**不具备**「按 PR 变更路径判定」与「读 K3 结论」两项能力，且存在两处已实证的可靠性缺陷（`--json` fail-open；U3 把崩溃报成业务失败）。**把它作为 D923 三态门禁的宿主，需同时改契约与修缺陷。**

---

## 四、若仍走「接线」路线：可用的具体接线点（file:line）

> 以下为**可行性清单**，不是推荐结论；标注了每点的代价。

### 接线点 1（脚本内最小改动，**代价最高**）

`scripts/control-tower/pre-audit-summary.sh:43-51` — 在 `GATES` 数组追加一条：

```bash
"U9-k3-merge-gate|scripts/control-tower/<新脚本>.sh||K3 结论三态门禁"
```

- 效果：新门禁被聚合进现有 5 条，跟随同一套 `pass/fail/degraded/missing` 统计与 `RESULTS` 渲染（L90-110）。
- **代价 / 风险**：
  - `run_gate`（L64-88）**不向子脚本传 PR 变更清单**，`gargs` 是静态字符串 → 子脚本只能自行从环境（`GITHUB_BASE_REF` / `GITHUB_HEAD_REF`）推导，**这是未文档化的隐式契约**；
  - 该门禁会在**每次调用** pre-audit-summary 时运行，无「仅 PR 上下文」条件；
  - 若前置于 `--json` 分支（L123），**新门禁的红色在 `--json` 下会被 exit 0 吞掉**（§1.3）；
  - U3 崩溃未修时，**pre-audit-summary 永远 exit 1**，新门禁的绿/红无法从聚合退出码分辨。

### 接线点 2（`run_gate` 增加超时/输入缝，**需改核心函数**）

`scripts/control-tower/pre-audit-summary.sh:64-88` — `run_gate()` 目前把 `$gargs` 原样展开（L102）。要传 PR 文件清单，需在此函数签名或环境注入上开缝。

- **代价**：改的是聚合器内核，影响 U1/U2/U3/U4/U7 五条既有门禁 → 属「门禁的门禁」级变更（ctrl-tower-change 最高风险档）。

### 接线点 3（**不改 pre-audit-summary，改 CI**）—— 现有 PR 级路径感知门禁的既有先例

`ci.yml` 的 `quality` job 已存在**完全同构的接线形态**，可直接复用其模式：

```
$ sed -n '100,104p' .github/workflows/ci.yml
      - name: Merge write-set reconciliation (D708)
        if: steps.docsonly.outputs.docs_only != 'true'
        run: |
          python3 scripts/control-tower/merge_writeset_gate.py \
            --base origin/main --head HEAD --branch "${GITHUB_HEAD_REF:-$GITHUB_REF_NAME}"
```

以及同 job 内既有的「按变更路径分支」步骤（`ci.yml:20-25`，D515 docs-only 检测）：

```
      - name: Detect docs-only change (D515)
        id: docsonly
        run: |
          if git diff --name-only origin/main...HEAD | grep -qvE '\.(md|json)$|task-state/|\.claude/'; then
```

**可复用点清单**：

| 复用点 | 位置 | 提供的能力 |
|---|---|---|
| PR 变更集计算 | `scripts/control-tower/merge_writeset_gate.py`（485 行，契约见其 docstring L30-45：`--base/--head/--branch/--json`，三态 `0/1/2`） | **已有** `--base origin/main --head HEAD` 的 PR 变更文件集 + 三态退出码 |
| PR 变更集计算（轻量） | `scripts/control-tower/check-pr-budget.sh:1-30`（`--base/--head/--files/--quiet`，三态 `0/1/2`） | 同上，且支持 `--files` **显式注入变更集**（测试缝） |
| CI 触发条件 | `ci.yml:20-25`（`docs_only` step output） | 现成的「纯文档 PR 跳过」门控 |
| K3 报告解析 | `scripts/product-lines/parse-k3-report.py`（105 行，契约 L12-21：`@input docs/synova/audit-reports/*.json`、`@exit 0/2`） | 解析审计 JSON → 证据记录；**但见下方限制** |
| 判定/风险分级来源 | `task-state/<D#>.json` 的 `audit.verdict` | D923 需读的就是这一段（现状见证据 ③） |

**接线点 3 的两条实测限制（必须先知道）**：
1. `parse-k3-report.py` 读的是 `docs/synova/audit-reports/*.json`（**双轨 JSON**），不是 `task-state` 的 `audit` 段。实测该目录下被跟踪的 JSON 只有 3 个，且全是 D602 的日志夹具，**无一份 `verdicts[]` 形态的审计报告**：

```
$ git ls-files 'docs/synova/audit-reports/*.json'
docs/synova/audit-reports/D602-ipc-notification-evidence-20260909/logs/tickets-after-restart.json
docs/synova/audit-reports/D602-ipc-notification-evidence-20260909/logs/tickets-after.json
docs/synova/audit-reports/D602-ipc-notification-evidence-20260909/logs/tickets-before.json
$ git ls-files 'docs/synova/audit-reports/*' | grep -c '\.json$'
3
```

故 `parse-k3-report.py` 的调用方 `scripts/product-lines/refresh-all.sh:53` 走的是**显式降级分支**（`else echo "⚠ A6 降级: 审计 JSON 双轨未落地..."`）。**它不是 D923 的现成 K3 结论读取器。**
2. `merge_writeset_gate.py` 的语义是「写集对账」，**不读 K3**；复用它是复用**变更集计算 + 三态惯例**，不是复用判定逻辑。

### 接线点 4（判定语义来源）

`task-state/<D#>.json` 的 `audit.verdict` 是唯一在库的 K3 结论字段。实测分布（详见证据 ③）：

```
PASS                123
CONDITIONAL PASS     25
FAIL                  5
CONDITIONAL_PASS      3
pass                  2
NOT-AUDITABLE         2
null                  1
自由文本              3   （"无 K3（V5.1.3 tag 锚点闭环）" / "CTO 验收通过（非 K3）" / "DONE"）
```

**9 种取值形态 → 三态映射需要显式归一化表**（大小写、空格 vs 下划线、非 K3 语义的 3 条自由文本）。另：**183 张卡完全没有 audit 段或 `audit: null`**（无结论 → 按裁定 3 属「排队中 → 红」）。

---

## 五、我的建议（附理由；**不构成通过/不通过判定**）

> 派单口径是「接线优先，禁新建」。以下建议按该口径给出，并如实说明每一档的代价。

1. **不建议把 `pre-audit-summary.sh` 作为 D923 的宿主。** 理由（全部为 §三 的实测项）：它没有路径输入（§2.1/§2.2）、不读 K3 结论（§2.1）、`--json` fail-open（§1.3/L137）、且当前因 U3 崩溃恒 exit 1（§1.4）—— 把它当宿主等于让 D923 的 CI job **一开始就永久红**，且红的原因与 K3 无关。
2. **若 CTO 仍要求「不新建脚本」，可走接线点 1 + 接线点 2 的组合**，但**必须先修 U3 崩溃**（`gen-cto-health.py:305` 对 `spec` 为字符串的卡做类型防御，或统一 108 张卡的 `spec` 字形），否则新门禁的红绿不可分辨。同时 `--json` 分支的 `exit 0`（L137）**必须一并处理**，否则 D923 的 CI job 用 JSON 消费即 fail-open。
3. **建议把「变更路径判定」的宿主放在 CI 层（接线点 3 的形态）而不是 pre-audit-summary**：`ci.yml` 的 `quality` job 已有 D708 步骤实证了「PR 变更集 + 三态 + 按条件跳过」这一整套模式（`ci.yml:100-104`），新增一个 job 与它平级即可，**不动聚合器内核**。这一档的代价最小、回归面最窄。
4. **建议 D923 的判据输入统一为 `task-state/<D#>.json` 的 `audit` 段**（接线点 4），并要求先补齐证据 ③ 给出的「统一 schema + backfill 清单」，否则三态映射会踩到 9 种 verdict 形态与 183 张无结论卡。
5. **D430 同型风险提示**：本脚本的历史事故（死引用 → exit 2 恒不通过）与本次 U3 崩溃属**同类**（「门禁自己坏了，却表现为业务不通过」）。按 ctrl-tower-change 模式 1，**门禁的执行失败（exit 2）必须与业务失败（exit 1）在聚合层保持可分**；当前 `run_gate` 的映射（L81）在「python 崩溃 exit 1」时会把执行失败归为业务失败 —— **这是本条建议要 CTO 注意的结构性缺口，不是 D923 引入的。**

---

## 附录：本件用到的完整命令清单（可逐条复跑）

```bash
wc -l scripts/control-tower/pre-audit-summary.sh                       # 166
bash scripts/control-tower/pre-audit-summary.sh; echo $?               # 输出见 §1.1；exit 1
bash scripts/control-tower/pre-audit-summary.sh --json; echo $?        # 输出见 §1.3；exit 0
bash scripts/control-tower/pre-audit-summary.sh --task-id D923; echo $?  # 输出见 §1.2；exit 1
python3 scripts/control-tower/gen-cto-health.py --strict; echo $?      # traceback；exit 1
bash scripts/control-tower/check-bypass-log.sh origin/main; echo $?    # 0
bash scripts/workflow/check-dev-doc-write-set.sh; echo $?              # 0
bash scripts/control-tower/ct-test-gate.sh; echo $?                    # 0
grep -n 'exit 0' scripts/control-tower/pre-audit-summary.sh            # 137, 165
grep -cE 'verdict|diff|changed_files|git ' scripts/control-tower/pre-audit-summary.sh   # 2
git ls-files 'docs/synova/audit-reports/*.json'                        # 3 条，全为 D602 日志夹具
```
