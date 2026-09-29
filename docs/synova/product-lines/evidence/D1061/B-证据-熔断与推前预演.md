# D1061 · PR-B 证据 — 熔断 / 门禁健康一行 / 推前预演 / write_set / 路径尾括号

> 分支 `chore/d1061-b-gate-mechanism` ｜ 写者 `coder-b` ｜ BASE = `20b55eba`（origin/main）
> 口径：以下每条 = 命令原文 + **原始输出**（数字未经手写改写；关键输出不 `head` 截断）。
> 结论词仅用 `自验结论`；**不判"通过"**（通过与否归 CTO 收件闸 + K3 终审）。

---

## ★ CTO 附加① · 一行命令「我这样推之前该跑什么」

```bash
bash scripts/workflow/pre-push-preview.sh --fast        # ≤10s，全绿才推
```

进 `--full` 才追加真跑门禁（`SYNO_CI=1 bash scripts/pre-commit-check.sh`）：

```bash
bash scripts/workflow/pre-push-preview.sh --full
```

已接线进 `scripts/pre-push-check.sh` **门禁 8**（原门禁 0-7 一条未删，见 §五 接线实证）。
逃生舱：`SYNO_PREVIEW_SKIP=1` → 显式可见告警 + `degraded-events.log` 留痕（**不静默**）。

## ★ CTO 附加② · 门禁健康状态一行（D963 工作台面板读）

```bash
bash scripts/control-tower/gate-circuit-breaker.sh --health-line
```

冻结格式（键序固定、ASCII 前缀可检索）：

```
GATE-HEALTH: status=<OK|DEGRADED|KNOWN-FAULT> known=<n> expired=<n> sources=<n> checked_at=<ISO8601>
```

原始输出（实测，空登记表 + 无连续失败）：

```
GATE-HEALTH: status=OK known=0 expired=0 sources=2 checked_at=2026-09-29T02:06:01Z
```

字段语义：`known` = 生效中登记条数（`expires >= 今天`）；`expired` = 已过期登记条数（**不熔断且必须处理**）；
`sources` = 本次实际读到的独立数据源个数（登记表 / gate-hits 日志 / degraded 日志 ∈ 0..3）；
`status` 优先级 `DEGRADED > KNOWN-FAULT > OK`（DEGRADED = 登记表损坏 ‖ expired>0 ‖ 有门禁连续失败 ≥2）。
退出码：`0` = OK/KNOWN-FAULT（无需人介入）｜`1` = DEGRADED（需人介入）｜`2` = 熔断器自身故障。

---

## 一、四项交付实测（改前 → 改后）

| # | 交付 | 改前 | 改后（原始输出） |
|---|---|---|---|
| 1 | 熔断 + 元监控 | 无此能力（全仓 grep `gate-circuit-breaker` = 0） | `--health-line` 见上；`--should-skip` 三态见 §二 |
| 2 | 推前四件套 | 无本地推前闸 | `--fast` **实测 1.09s**；坏 brief **1.46s 即拦** |
| 3 | 建卡器 `write_set` | 骨架无该键（实测 `grep -c '"write_set"'` = 0） | 骨架含 `"write_set": []`，`alloc-task-id.test.sh` PASS=56 FAIL=0 |
| 4 | 路径尾括号 | `.claude/task-briefs/x-docs（系统性假红修复）.md` → 截断成 `.claude/task-briefs/x-docs` | **完整保留**（见 §三） |

### 1 · `--fast` 计时原始输出

```
$ /usr/bin/time -p bash scripts/workflow/pre-push-preview.sh --fast --json
{"mode": "fast", "branch": "chore/d1061-b-gate-mechanism",
 "checks": [{"id": "brief", "status": "skip", "rc": 0, "ms": 43, "note": "未绑定到 brief"},
            {"id": "d708", "status": "pass", "rc": 0, "ms": 154, "note": "rc=0"},
            {"id": "marks", "status": "pass", "rc": 0, "ms": 719, "note": "a=0 b=0 c=1"}],
 "suites_run": 3, "cases_run": 2, "total_ms": 916}
✅ 推前预演全绿 — 可以推送
rc=0
real 1.09
```

### 2 · 故意造 brief 格式错 → 本地即拦（卡面判据）

```
$ /usr/bin/time -p bash scripts/workflow/pre-push-preview.sh --fast --brief <坏 brief>
  ❌ ① brief 闸: 不通过（推送应被拦）  parseable=True criteria=C done_count=0
     [check-brief-parseable] ❌ brief 不可解析: …/bad-brief.md
       Done 标准无条目（至少 1 条）
  ❌ 推前预演未通过 — 请修复后再推（本地能抓的错别送 CI）
     - brief 不可解析（Done checkbox≥1 / #CRITERIA 必填）
rc=1
real 1.46
```

对照组（合规 brief）→ `✅ brief 闸: 通过  parseable=True criteria=C done_count=1` / `rc=0`。

---

## 二、熔断三态 + 到期棘轮原始输出

```
[1] 生效登记（expires=2999-12-31）→ should-skip
    ⚠️  门禁熔断: g-broken 命中生效中的故障登记 → 本次**跳过**
    rc=3
    degraded 留痕: {"component": "gate-circuit-breaker", "reason": "gate-circuit-breaker: 跳过已知故障门禁 g-broken（登记表 …/reg-active.json）", "schema": "control-tower/logs/degraded/v1", "time": "2026-09-29T10:06:21+0800"}
    health-line: GATE-HEALTH: status=KNOWN-FAULT known=1 expired=0 sources=2 checked_at=2026-09-29T02:06:21Z   rc=0

[2] 已过期登记（expires=2000-01-01）→ **不跳**（棘轮）
    ❌ 门禁熔断: g-broken 的登记**已过期** → 不跳过，按棘轮必须照跑
    rc=0
    health-line: GATE-HEALTH: status=DEGRADED known=0 expired=1 sources=2 checked_at=…   rc=1

[3] 登记表损坏 → fail-closed
    ❌ 熔断器自身故障: 登记表不可解析: Expecting value: line 2 column 1 (char 9)
       → fail-closed: **不跳过**该门禁（登记表损坏时不给熔断通道）
    rc=2

[4] 熔断口径 = 连续 2 次同因失败才告警（CTO 裁定，依据 P5 间歇 1/5）
    连续 1 次 → GATE-HEALTH: status=OK known=0 expired=0 sources=3 …        rc=0
    连续 2 次 → GATE-HEALTH: status=DEGRADED known=0 expired=0 sources=3 …  rc=1

[5] 缺 owner/evidence → selfcheck rc=1
    ❌ 1 条登记缺 owner 或 evidence（无责任人/无证据 = 不可审计）
```

---

## 三、路径尾括号根因（卡面 §〇② 四条格式摩擦之一）原始输出

```
$ python3 scripts/control-tower/brief_parser.py --all <fixture>
{"parseable": true,
 "q2_include": ["src/l3/foo.ts", "scripts/x.sh", ".claude/task-briefs/x-docs（系统性假红修复）.md"],
 "q2_exclude": ["scripts/audit/"], "criteria": "D", "layer": "scripts（控制塔域）", "done": [], "done_count": 0}
```

四条必须同时成立 —— 逐条实测：`改 src/l3/foo.ts（专家路由）`→`src/l3/foo.ts` ✅；
`不改 scripts/audit/（K3 专属红线）`→`scripts/audit/` ✅；`scripts/x.sh L750`→`scripts/x.sh` ✅；
`.claude/task-briefs/x-docs（系统性假红修复）.md`→**完整保留** ✅。
**钉住语义不回归**：`bash tests/control-tower/brief-parser-strip.test.sh` → `结果: 30 通过, 0 失败`（rc=0，该文件本卡**未改**）。

---

## 四、变异体「改坏即红」原始输出（四条，各自 revert 后复绿）

| 变异体 | 改法 | 原始输出（红） | revert 后 |
|---|---|---|---|
| ① breaker 去掉 `expires` 校验 | `print("ACTIVE" if e.get("active") else "EXPIRED")` → `print("ACTIVE")` | `❌ 边界: rc=3（过期必须不跳 = 0）` / `❌ 边界: 过期无告警` / `结果: 17 通过, 2 失败` rc=1 | rc=0 |
| ② preview 移除 brief 解析 | `BRC=$?` → `BRC=0` | `❌ 边界: rc=0（期望 1）` / `❌ 边界: 缺 #CRITERIA rc=0（期望 1）` / `结果: 14 通过, 2 失败` rc=1 | rc=0 |
| ③ alloc 骨架删 `write_set` 键 | 删 `"write_set": []` 行 | `❌ 11b 骨架缺 write_set 键（新卡三源皆空 → D708 fail-closed）` / `结果: PASS=54 FAIL=2 FIRST_FAIL=11b …` rc=1 | rc=0（PASS=56 FAIL=0） |
| ④ brief_parser 改回「先剥括号」 | 删 `if not PATH_SHAPE_RE.match(path):` 守卫 | `❌ 正常: 全角括号文件名被截断 → [... ".claude/task-briefs/x-docs", …]` / `❌ 正常: 半角括号文件名被截断 → …` / `结果: 9 通过, 2 失败` rc=1 | rc=0 |

> 变异体驱动的**自纠**：改坏运行时暴露出本卡 3 个**新测试文件自身**的 `$VAR（全角）` 变量边界缺陷
> （`unbound variable`，只在断言失败分支触发 ⇒ 绿跑时不可见）。已全量修复 **12 处** `$VAR` → `${VAR}`，
> 复扫 0 命中，三套测试复跑 `19/16/11 通过, 0 失败`。登记为「变异体不仅验被测物、也验夹具」的实证。

---

## 五、夹具 / 接线实证

```
$ bash tests/control-tower/gate-circuit-breaker.test.sh     → 结果: 19 通过, 0 失败   rc=0
$ bash tests/control-tower/pre-push-preview.test.sh         → 结果: 16 通过, 0 失败   rc=0
$ bash tests/control-tower/brief-parser-cjk-path.test.sh    → 结果: 11 通过, 0 失败   rc=0
$ bash tests/control-tower/alloc-task-id.test.sh            → 结果: PASS=56 FAIL=0     rc=0
   （含新增 11b: 骨架含 write_set 键 / 是合法 JSON 空数组）
```

接线（铁律 0-2 WIRE CHECK，打 file:line）：

```
$ grep -n "pre-push-preview.sh" scripts/pre-push-check.sh
456:PREVIEW="$SCRIPT_DIR/workflow/pre-push-preview.sh"
$ grep -c "SYNO_PREVIEW_SKIP" scripts/pre-push-check.sh → 1（逃生舱存在且有测试）
原门禁 0-7 逐条点名: 命中 8/8（一条未删）
```

---

## 六、存量 brief checkbox 比例实测（队长 ④ 结论，task-4 立论来源）

口径：`origin/main @ 20b55eba` 的 `.claude/task-briefs/*.md`（**150 件**），判据 = **真解析器** `brief_parser.parse_done()`：

```
total briefs                                  = 150
done_count==0（G12b「Done 标准无条目」判红）  = 9   (6.0%)
  ├─ A 有 `## Done 标准` 段但段内 0 条 checkbox = 9   (6.0%)   ← 纯格式摩擦
  └─ B 无 `## Done 标准` 段（真缺失）           = 0   (0.0%)
```

**真门禁逐个复核 → 9/9 判红**（`check-brief-parseable.sh` 全部 rc=1，报「Done 标准无条目」）。

归属：**不是生成器/存量漂移，是手写件绕过生成器** ——
`generate-task-brief.py` 的 `- [ ] 入口可触达:` 模板行**自 2026-06-14 `37abc153` 起就在**，
比这 9 件（2026-09-10~09-25）**早 3 个月且从未回退**；9 件全是手写（样例
`2026-09-10-D662-expert-residual-sweep.md` 的 7 条 Done 全为 `- verify:` 无 checkbox）。
**附带发现**：**8/9 同时缺 `#CRITERIA`**（另报一条 `#CRITERIA 缺失（必填 A-D）`）。
复跑命令：

```bash
# 存量比例（真解析器口径）
python3 - <<'PY'
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("bp", "scripts/control-tower/brief_parser.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
files = sorted(pathlib.Path(".claude/task-briefs").glob("*.md"))
zero = [f.name for f in files if len(m.parse_done(f.read_text(encoding="utf-8", errors="replace"))) == 0]
print(f"total={len(files)} done_count==0={len(zero)} ({len(zero)*100.0/len(files):.1f}%)")
PY
# 生成器 checkbox 起点
git log -1 --format='%ad %h' --date=short -S'- [ ] 入口可触达' -- scripts/workflow/generate-task-brief.py
```

---

## 七、未清项 / 边界（如实登记）

1. **`ci.yml` 接线未做** —— 单写者顺位 coder-a → coder-b，须待 PR-A 合并后 rebase 再加；本 PR 不含 ci.yml。
2. **`task-state/D1061.json` 未由我创建/修改** —— 该文件不在 main（`git ls-tree origin/main` 零命中），且 PR-A(task-1) 声明为**首写者**；为避免同文件双写冲突，PR-B 条目由 coder-a 侧并集或 merge 时补齐（**偏差已报队长**）。
3. **`README` 落位（队长已裁定，已执行）** —— 卡面「进 README」**不进仓库根 `README.md`**（产品向、且不在本卡写集）。落位改为 **`pre-push-preview.sh` 头注释 + `--help` 输出**（均在写集内）；CTO 要的是"能用"，该行原样进队长给 CTO 的最终回执。可见性复跑证据：

```
$ bash scripts/workflow/pre-push-preview.sh --help | head -5
pre-push-preview.sh — D1061 任务 4: 推前四件套（本地秒级预演）

★ 一行命令（CTO 附加①，可直接嵌进推送前流程）:
     bash scripts/workflow/pre-push-preview.sh --fast        # ≤10s，全绿才推

$ grep -n "bash scripts/workflow/pre-push-preview.sh --fast" scripts/workflow/pre-push-preview.sh
9:#      bash scripts/workflow/pre-push-preview.sh --fast        # ≤10s，全绿才推
79:echo "   一行命令: bash scripts/workflow/pre-push-preview.sh --fast"
```
4. 熔断登记表当前为**空表**（无已知门禁故障）——诚实状态，不代表"故障已清零"。
5. `--fast` 只覆盖三种红；windows 平台差异类红不在其中（归 PR-A 的 windows 敏感子集）。

---

## 八、接线判别性自证：「作者被自己的门禁拦下」（改坏即红 / 接线了≠被执行）

本 PR **第一次 `git push` 被我自己新接的门禁 8 拦下**（`push rc=1`）——因为该分支当时**没有 S1 写集声明**
（`task-state/D1061.json` 不在 main，也不在本分支）。**这不是装饰**：门禁先拦住了它的作者。
原始输出（保留原样）：

```
── 门禁 8: 推前预演 (D1061 · fast ≤10s / full 可选) ─────
══ 推前预演（D1061 任务 4 · 模式 fast）══════════════════════
   分支: chore/d1061-b-gate-mechanism
   一行命令: bash scripts/workflow/pre-push-preview.sh --fast

  ⚠️  ① brief: 绑定不到 brief（无 --brief / 无 current-brief / 分支名无 D#）→ SKIP（显式，不静默）
     ⚠️ 结论: degraded — 无任何写集声明（S1 task-state.write_set / S2 dev doc 写集表 / S3 task brief Q2 三源皆空）且变更含源码文件 → fail-closed 阻断
  ❌ ② D708 写集对账: 不通过（rc=2 —— 夹带/声明源空）
     a) 代码/测试/脚本/CI 面残留: 0 个文件（期望 0，扫描根: src tests scripts .github）
     b) 仓库面残留（排除 docs）: 0 个文件（期望 0）
     c) 反向判别（探针必须命中）: 1（期望 ≥1，=0 说明探针失效＝假绿）
  ✅ ③ 夹具三面自测: 通过

  ⚠️  降级（可见，不计通过也不计红）:
     - brief 绑定失败 → 跳过 brief 闸

  ❌ 推前预演未通过 — 请修复后再推（本地能抓的错别送 CI）
     - D708 写集对账 rc=2

  ❌ 门禁 8: 推前预演未通过 — 推送已拒绝 (D1061 任务 4)
error: failed to push some refs to 'github.com:tangbaobao520/SynovaAgent.git'
```

修法后第二次 push `rc=0`，同一门禁打印 `✅ ② D708 写集对账: 通过（rc=0）` / `✅ 全部门禁通过 — 允许推送`。
**判据**：同一门禁、同一分支，一次红一次绿 ⇒ 该门禁**真的在判定**，且不是恒真/恒假的摆设。

## 九、变异体顺带暴露的**夹具自身缺陷**（可复用经验）

四个变异体运行时暴露出本卡**三套新测试文件本身**的缺陷：`$VAR` 紧贴**全角标点**时，
bash（UTF-8 locale）把全角括号当**变量名字符** ⇒ `set -u` 下 `unbound variable`。
**它只在断言失败分支触发 ⇒ 绿跑时完全不可见**——即"夹具的报错路径从未被测过"。
这与 `ctrl-tower-change` **模式 2** 同源，且实证了「**变异体不只验被测物，也验夹具**」。

| 文件 | 修复处数 |
|---|---|
| `tests/control-tower/gate-circuit-breaker.test.sh` | 6 |
| `tests/control-tower/pre-push-preview.test.sh` | 4 |
| `tests/control-tower/brief-parser-cjk-path.test.sh` | 2 |
| **合计** | **12** |

原文样例（改前）与改法：`no "边界: rc=$RC（过期必须不跳 = 0）"` → `no "边界: rc=${RC}（过期必须不跳 = 0）"`。
复扫结果：三文件命中 **0**；三套测试复跑 `19 / 16 / 11 通过, 0 失败`。
**建议沉淀**：控制塔脚本/夹具新增时，把"`$VAR` 紧贴全角标点"纳入静态扫描（现无此扫描）。

## 十、`task-state/D1061.json` 写集口径（队长裁定，已执行）

本卡拆两条 PR（PR-A 提速线 / PR-B 机制线），两条 PR 都需要 D708 的 S1 声明源。
`task-state/D1061.json` 的 `write_set` 取 **PR-A ∪ PR-B 并集（22 条）**：
- 理由：D708 按 `origin/main..HEAD` 对账 ⇒ 并集使**任一侧先合并、另一侧后 rebase 都不夹带**，
  且不因对侧先合并而误红（若各写各的半套，先合并者会让后合并者整片红）。
- 队长裁定（2026-09-29）：coder-a 侧同名文件内容不同时，**以本 PR-B 的"并集 22 条"版为准**；
  PR-A 先合并后 PR-B rebase 时，**保留并集版**为 base 之后的最终形态。

---

## 十一、接线判据升级：grep 型弱判据 → 行为判别子 + 定位式调用点判别（verifier 复核后的必修）

### 问题（verifier 变异体复核暴露；坑清单第 7 条「禁 grep 型静态判据当验收」）
原接线断言是**纯 grep 型**：
```
WIRE="$(grep -n "pre-push-preview.sh" "$REPO/scripts/pre-push-check.sh" | head -3)"
[ -n "$WIRE" ] && ok "接线: …" || no "接线: …未调用 preview"
```
缺陷：**文件里出现字符串 ≠ 被调用** —— `pre-push-check.sh` 的**缺件 fail-open 分支**（"pre-push-preview.sh 缺失 → 跳过"）也含同名串
⇒ 该断言**在"删掉 preview 文件"时永不红**，不构成判别性证据。**实测确认**：本条被判为 grep 型弱判据，仅保留「声明在场」的信息量并**降级标注**。

### 修法 1 · 行为判别子（夹具层，**不做端到端**）
新增两个注入缝（镜像既有 `SYNO_SYNC_ONLY` 惯例，非新范式）：
- `SYNO_PREVIEW_ONLY=1` → 只跑门禁 8（隔离单测）
- `SYNO_PREVIEW_CMD=<shell 命令>` → 用桩替代真实 preview

```
$ STUB_FAIL='echo "STUB: 强制 preview 失败"; exit 1'
$ SYNO_PREVIEW_ONLY=1 SYNO_PREVIEW_CMD="$STUB_FAIL" bash scripts/pre-push-check.sh
── 门禁 8: 推前预演 (D1061 · fast ≤10s / full 可选) ─────
STUB: 强制 preview 失败

  ❌ 门禁 8: 推前预演未通过 — 推送已拒绝 (D1061 任务 4)
rc=1                                        ← 判别子A：rc 非 0

$ STUB_OK='echo "STUB: 强制 preview 通过"; exit 0'
$ SYNO_PREVIEW_ONLY=1 SYNO_PREVIEW_CMD="$STUB_OK" bash scripts/pre-push-check.sh
── 门禁 8: 推前预演 (D1061 · fast ≤10s / full 可选) ─────
STUB: 强制 preview 通过
rc=0                                        ← 判别子B：正向对照，排除"恒红"
```

### 修法 2 · 调用点判别（**定位式**，把判据限定在生产尾部区间）
只 grep 全文件仍不判别（fail-open 分支会满足它）。故判据**限定自调用点注释起至文件末的区间**，三条并列：
```
$ 基线
  ✅ 调用点判别: 定位到生产尾部区间（204 字节）
  ✅ 调用点判别: 生产尾部**实际调用** run_gate8_preview
  ✅ 调用点判别: 失败路径报文点名门禁 8
  ✅ 调用点判别: 失败路径确有 exit 1（硬阻断）

$ 变异体: 摘掉尾部 `if ! run_gate8_preview; then … exit 1; fi`
  ❌ 调用点判别: 生产尾部未调用门禁 8（接线断裂）
  ❌ 调用点判别: 失败路径报文缺失
  ❌ 调用点判别: 失败路径无 exit 1
  结果: 21 通过, 3 失败   rc=1        ← revert 后 24 通过, 0 失败 rc=0
```

### 为什么**不做**端到端（附理由，防后来者"补一个更真的"重复踩坑）
端到端跑完整 `pre-push-check.sh` 会被 **golden-case F1 门禁**先拦，并触发 **`vitest --changed` 重型回归**
——代价与收益不成比例（本判据的目标只是"门禁 8 在判定且在调用点上"，`SYNO_PREVIEW_ONLY` 已隔离达成）。
**残留局限（如实登记）**：判别子 A/B 走的是 `SYNO_PREVIEW_ONLY` 早退路径调用**同一个函数**；
"生产尾部是否调用"由修法 2 的**定位式结构判据**覆盖（非行为层）。两层合起来：
函数判定正确性 = 行为层证据；调用点存在性 = 定位式结构证据。**二者缺一即留假绿口子。**

### 另：`pre-push-check.sh` 缺件 fail-open **不作为缺陷项**
沿用既有语义「脚本缺失 = CI 降级信号」+ **可见**告警（非静默）——这是设计意图，不是漏拦。按此口径登记，不定性为缺陷。

---

## 十二、接线的**第二层**自证：我第一版判别子也是假的（被自己的变异体抓住）

> 队长 2026-09-29 要求原样留存这段——它比"我做对了"更有价值。

**第一版（错）**：我加了 `SYNO_PREVIEW_ONLY=1` 早退缝 + `SYNO_PREVIEW_CMD` 桩，
判别子 A（失败桩 → rc≠0 且点名）与 B（通过桩 → rc=0）**都通过**，我一度认为接线已证。

**它是假的**：我随即跑"**摘掉门禁 8 的生产调用**"这个变异体 —— 结果 **仍然 20 通过 / 0 失败**。
原因：早退缝**自己调用了同一个函数** `run_gate8_preview`，所以判别子 A/B 证明的是
「**这个函数判定正确**」，**完全没有证明**「**生产尾部真的调用了它**」。摘掉调用后早退缝照样能跑通。
→ 与 verifier 抓出的 grep 断言缺陷是**同一类错误的两个变体**：
　**都属「证明了判定、没证明接线」**。

**修法**：追加**定位式调用点判别** —— 把判据**限定在生产尾部区间**（自调用点注释起至文件末），
三条并列（实际调用 / 报文点名 / `exit 1`）。此时再摘掉调用 → **3 条必红**（实测）。

**教训（可复用）**：
1. **"判别子自身也要有变异体"**：任何"我加了判别性夹具"的声称，都必须再问一句
   「**把被测接线摘掉，它还红吗？**」——否则只是把假绿从被测物搬到了夹具。
2. **测试里的旁路（早退缝/注入缝）会悄悄改变被证命题**：缝走的是函数，生产走的是调用点；
   两者是**不同的命题**，不能用前者替代后者。
3. 两层证据缺一即留口子：**行为层 = 函数判定正确性**；**结构层（定位式）= 调用点存在性**。
   本次最终判据 = 行为判别子 A/B **并列** 定位式调用点三条。

---

## 十三、5④ 完备化：同一族**第三个**截断点（全角冒号）+ 结论「声明源可靠性与解析器复杂度成反比」

### 实战定位（#879 / D1058 的 D708 夹带红）
用 #867 的 CT-C gate 复刻 CI 合成 merge 地形（`#867` 入 main 前预验），D# 已正确推断为 `D1058`，但**仍判夹带**：
```
❌ block — 检测到 3 个写集外文件（夹带）
   声明写集 2 条: pre-dispatch-check.sh | 本卡 brief / task-state     ← 第二条是**散文占位**
   夹带: brief 自身 / task-state/D1058.json / memory/notes/…d1058-dispatch-gate.md
```
修掉散文占位后**仍剩 1 个**，gate 回显暴露真因：
```
· .claude/task-briefs/2026-09-29-D1058-派单闸门落地   ← S3:brief.Q2-include     ← 被截断！
```
真实文件名是 `…2026-09-29-D1058-派单闸门落地：R8-修复-+-§〇-归属-回执-点-id-三项检查.md`
—— 被 **`re.split(r"[:：]| — ", raw, 1)[0]`** 在**全角冒号**处切断。

### 同一族的三个截断点（一张图看完）
| # | 分隔符切分 | 被吃掉的名字样例 | 定位批次 |
|---|---|---|---|
| ① | `re.split(r"[:：]| — ", …)` **全角冒号** | `…派单闸门落地：R8-修复…` → `…派单闸门落地` | **本卡（D1061）** |
| ② | `re.split(r"[（(]", …)` 全角括号 | `…-docs（系统性假红修复）.md` → `…-docs` | 红因 B / #878 |
| ③ | `re.sub(r"\s+L\d+$", …)` 行号后缀（**有意**） | `scripts/x.sh L750` → `scripts/x.sh` | D543（保留） |

**顺序是根因**：原实现是「**先①冒号 → 后②括号**」，故只修②对①型名字**不完备**。

### 修法（队长裁定：把形状优先**提到两个切分之前**，判据范围不变、只改顺序）
```python
if PATH_SHAPE_RE.match(raw.strip()):     # 形状命中 ⇒ 整段保留，不做任何切分
    path = raw.strip()
else:
    path = re.split(r"[:：]| — ", raw, 1)[0].strip()      # 回退①
    if not PATH_SHAPE_RE.match(path):
        path = re.split(r"[（(]", path, 1)[0].strip()      # 回退②
path = re.sub(r"\s+L\d+$", "", path)                        # ③ 保留（钉住语义）
```

**实测（真实样本，非构造）**：
```
$ python3 scripts/control-tower/brief_parser.py --all <D1058 brief>
   scripts/control-tower/pre-dispatch-check.sh
   .claude/task-briefs/2026-09-29-D1058-派单闸门落地：R8-修复-+-§〇-归属-回执-点-id-三项检查.md   ← 完整保留 ✅
   task-state/D1058.json
   memory/notes/proposed/2026-09-28-d1058-dispatch-gate.md
```
**变异体（把形状优先挪回两刀之后）**：
```
❌ 正常: 全角冒号文件名被截断 → [ … ".claude/task-briefs/2026-09-29-D1058-派单闸门落地", … ]
结果: 11 通过, 1 失败   rc=1        ← revert 后 12 通过, 0 失败 rc=0
```
**钉住语义零回归**：`brief-parser-strip.test.sh` 仍 `30 通过, 0 失败`。

### 结论（队长 ③，升级为可复用原则，进 B 证据与回执）
> **声明源的可靠性与解析器复杂度成反比：S1（`task-state.write_set`，JSON 机器块）> S3（散文 Q2）。**
> **门禁的主源应为 S1，S3 只作兜底**；把 Q2 散文当主源 = 把门禁成败押在一个**有 3 个已知截断点**的解析器上。
> 这正是本卡「建卡器初始化 `write_set`」（5③）为何是**系统性**修复而非补丁 ——
> #878/#882 靠 S1 解锁、#879 也靠 S1 绕过截断，两处实战都指向同一结论。
